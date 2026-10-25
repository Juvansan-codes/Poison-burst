"""
PoissonBurst Lab - Observation-Window Aggregation, Baseline Calibration & Burst Detection Service.

Processes streaming UDP telemetry datagrams from the HardwareReceiver service, tumbling
them into fixed-duration observation windows, calibrating an empirical Poisson baseline
from designated clean normal-traffic windows, and independently evaluating subsequent
monitoring windows using the core Poisson burst detection engine.

Key Principles:
1. Tumbling, half-open observation windows [window_start, window_end).
2. Uses monotonic receiver-arrival timestamps for all window boundaries and calculations.
3. Multi-node aggregation: tracks aggregate total and isolated per-node counts.
4. Independent device liveness tracking: zero arrivals during an observation window do NOT
   imply a node is disconnected or missing. Legitimate Poisson zeros are fully preserved.
5. Inactivity-based stale timeout: a node is considered stale/disconnected only if no arrivals
   occur for longer than a configurable threshold (stale_node_timeout_seconds, default: 5.0s).
6. Sequence deduplication: duplicate or out-of-order packets are excluded from arrival counts.
7. Sequence gaps represent lost transmissions, NOT extra observed events.
8. Calibration purity: windows reporting burst-mode telemetry (mode='burst') are strictly
   excluded from baseline estimation to prevent threshold contamination.
9. Statistical independence: the detector evaluates observed counts vs. the calibrated
   Poisson baseline; it NEVER relies on the telemetry mode field to declare a burst.
10. Reusable, thread-safe service ready for future FastAPI hardware integration.
"""

from __future__ import annotations

import collections
import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
import threading
import time
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from app.core.poisson import BurstDetectionResult, detect_burst, estimate_baseline_rate
from app.core.schemas import MeasurementType, TrafficObservation, TrafficSource
from app.services.hardware_receiver import TelemetryPacket

logger = logging.getLogger(__name__)

SUPPORTED_NODE_IDS: Set[str] = {"node_1", "node_2", "node_3", "node_4"}


class ProcessorState(str, Enum):
    """Lifecycle state machine for the HardwareWindowProcessor session."""
    IDLE = "IDLE"
    CALIBRATING = "CALIBRATING"
    MONITORING = "MONITORING"
    STOPPED = "STOPPED"


class NodeLivenessState(str, Enum):
    """Device liveness classification for an expected traffic node."""
    NEVER_OBSERVED = "never_observed"
    ACTIVE = "active"
    STALE = "stale"


class WindowQuality(str, Enum):
    """Data quality classification of an observation window."""
    COMPLETE_CLEAN = "complete_clean"
    COMPLETE_WITH_GAPS = "complete_with_gaps"
    BURST_CONTAMINATED = "burst_contaminated"
    MISSING_NODES = "missing_nodes"
    PARTIAL = "partial"


class DetectionStatus(str, Enum):
    """Outcome status of the statistical detector for a window."""
    NORMAL = "normal"
    BURST = "burst"
    UNAVAILABLE = "unavailable"
    CALIBRATING = "calibrating"


@dataclass
class HardwareWindowProcessorConfig:
    """Configuration parameters for HardwareWindowProcessor."""
    window_seconds: float = 1.0
    expected_node_ids: Sequence[str] = field(
        default_factory=lambda: ["node_1", "node_2", "node_3", "node_4"]
    )
    min_calibration_windows: int = 10
    alpha: float = 0.01
    require_all_nodes: bool = True
    stale_node_timeout_seconds: float = 5.0
    max_stored_windows: int = 1000

    def __post_init__(self) -> None:
        if self.window_seconds <= 0.0 or self.window_seconds > 300.0:
            raise ValueError(
                f"window_seconds must be in (0.0, 300.0], got {self.window_seconds}."
            )
        if not self.expected_node_ids:
            raise ValueError("expected_node_ids cannot be empty.")
        for nid in self.expected_node_ids:
            if nid not in SUPPORTED_NODE_IDS:
                raise ValueError(
                    f"Invalid expected node_id '{nid}'. Must be one of: {sorted(list(SUPPORTED_NODE_IDS))}."
                )
        if self.min_calibration_windows < 1:
            raise ValueError(
                f"min_calibration_windows must be at least 1, got {self.min_calibration_windows}."
            )
        if not (0.0 < self.alpha < 1.0):
            raise ValueError(
                f"Significance level alpha must be in (0.0, 1.0), got {self.alpha}."
            )
        if self.stale_node_timeout_seconds <= 0.0:
            raise ValueError("stale_node_timeout_seconds must be positive.")
        if self.max_stored_windows < 10:
            raise ValueError("max_stored_windows must be at least 10.")


@dataclass
class AggregatedWindow:
    """Structured representation of a single observation window."""
    window_index: int
    start_time_monotonic: float
    end_time_monotonic: float
    start_time_utc: str
    end_time_utc: str
    duration_seconds: float

    # Traffic arrival counts
    aggregate_count: int
    node_counts: Dict[str, int]
    node_modes: Dict[str, str]
    node_liveness: Dict[str, str] = field(default_factory=dict)

    # Diagnostics & Quality
    node_first_seq: Dict[str, Optional[int]] = field(default_factory=dict)
    node_last_seq: Dict[str, Optional[int]] = field(default_factory=dict)
    node_gaps_count: Dict[str, int] = field(default_factory=dict)
    node_duplicates_count: Dict[str, int] = field(default_factory=dict)
    node_boot_ids: Dict[str, Optional[str]] = field(default_factory=dict)
    is_complete: bool = True
    is_partial: bool = False
    quality: WindowQuality = WindowQuality.COMPLETE_CLEAN

    # Calibration context
    is_calibration: bool = False
    is_calibration_eligible: bool = False
    ineligibility_reason: Optional[str] = None

    # Detection context
    expected_baseline_count: Optional[float] = None
    p_value: Optional[float] = None
    is_burst: Optional[bool] = None
    alpha: Optional[float] = None
    detection_status: DetectionStatus = DetectionStatus.UNAVAILABLE
    detection_unavailable_reason: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to a JSON-serializable dictionary."""
        d = asdict(self)
        d["quality"] = self.quality.value
        d["detection_status"] = self.detection_status.value
        d["node_liveness"] = dict(self.node_liveness)
        return d

    def to_traffic_observation(
        self,
        experiment_id: Optional[str] = None,
        session_start_monotonic: Optional[float] = None,
    ) -> TrafficObservation:
        """Convert into a core TrafficObservation model for downstream pipelines."""
        time_sec = (
            round(self.start_time_monotonic - session_start_monotonic, 3)
            if session_start_monotonic is not None
            else None
        )
        return TrafficObservation(
            timestamp=self.start_time_utc,
            count=self.aggregate_count,
            source=TrafficSource.HARDWARE,
            measurement_type=MeasurementType.UDP_DATAGRAM_COUNT,
            ground_truth=None,  # Real/hardware observations are unlabeled ground truth
            experiment_id=experiment_id,
            window_seconds=self.duration_seconds,
            time_seconds=time_sec,
            expected_baseline_count=self.expected_baseline_count,
            is_calibration=self.is_calibration,
        )


@dataclass(frozen=True)
class CalibrationResult:
    """Summary of baseline estimation outcome."""
    eligible_windows_count: int
    excluded_windows_count: int
    exclusion_reasons: Dict[str, int]
    expected_count_per_window: float
    rate_per_second: float
    window_seconds: float
    alpha: float
    calibrated_at_utc: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class HardwareWindowProcessor:
    """Aggregates streaming UDP telemetry into fixed observation windows, establishes

    a calibrated Poisson baseline, and executes statistical burst detection.
    """

    def __init__(
        self,
        config: Optional[HardwareWindowProcessorConfig] = None,
        experiment_id: Optional[str] = None,
    ) -> None:
        self.config = config or HardwareWindowProcessorConfig()
        self.experiment_id = experiment_id

        self._lock = threading.RLock()
        self._state: ProcessorState = ProcessorState.IDLE
        self._session_start_monotonic: Optional[float] = None
        self._session_start_utc: Optional[str] = None

        # Per-node tracking across session
        self._expected_nodes: Set[str] = set(self.config.expected_node_ids)
        self._node_last_seq: Dict[str, Optional[int]] = {nid: None for nid in self._expected_nodes}
        self._node_last_seen_monotonic: Dict[str, Optional[float]] = {nid: None for nid in self._expected_nodes}
        self._node_active_boot_id: Dict[str, Optional[str]] = {nid: None for nid in self._expected_nodes}
        self._node_retired_boot_ids: Dict[str, Set[str]] = {nid: set() for nid in self._expected_nodes}
        self._node_boot_transitions_count: Dict[str, int] = {nid: 0 for nid in self._expected_nodes}
        self._node_boot_transitions: Dict[str, List[Dict[str, Any]]] = {nid: [] for nid in self._expected_nodes}

        # Window state
        self._current_window_index: int = 0
        self._current_window_start_mono: Optional[float] = None
        self._current_window_end_mono: Optional[float] = None
        self._current_node_counts: Dict[str, int] = {nid: 0 for nid in self._expected_nodes}
        self._current_node_modes: Dict[str, str] = {nid: "normal" for nid in self._expected_nodes}
        self._current_node_first_seq: Dict[str, Optional[int]] = {nid: None for nid in self._expected_nodes}
        self._current_node_last_seq: Dict[str, Optional[int]] = {nid: None for nid in self._expected_nodes}
        self._current_node_gaps: Dict[str, int] = {nid: 0 for nid in self._expected_nodes}
        self._current_node_duplicates: Dict[str, int] = {nid: 0 for nid in self._expected_nodes}
        self._current_has_burst_mode: bool = False

        # In-memory history
        self._completed_windows: collections.deque[AggregatedWindow] = collections.deque(
            maxlen=self.config.max_stored_windows
        )
        self._partial_window: Optional[AggregatedWindow] = None

        # Calibration state
        self._calibration_result: Optional[CalibrationResult] = None
        self._calibrated_baseline_count: Optional[float] = None

    @property
    def state(self) -> ProcessorState:
        with self._lock:
            return self._state

    @property
    def is_calibrated(self) -> bool:
        with self._lock:
            return self._calibrated_baseline_count is not None

    @property
    def baseline_expected_count(self) -> Optional[float]:
        with self._lock:
            return self._calibrated_baseline_count

    @property
    def baseline_rate_per_second(self) -> Optional[float]:
        with self._lock:
            if self._calibrated_baseline_count is not None:
                return self._calibrated_baseline_count / self.config.window_seconds
            return None

    @property
    def session_start_monotonic(self) -> Optional[float]:
        with self._lock:
            return self._session_start_monotonic


    def start_session(
        self,
        mode: ProcessorState = ProcessorState.CALIBRATING,
        start_monotonic: Optional[float] = None,
        initial_active_nodes: Optional[Sequence[str]] = None,
    ) -> None:
        """Start a new processing session in CALIBRATING or MONITORING mode."""
        with self._lock:
            if self._state in (ProcessorState.CALIBRATING, ProcessorState.MONITORING):
                raise RuntimeError(
                    f"Session is already active in state {self._state.value}. Call stop_session() first."
                )

            now_mono = start_monotonic if start_monotonic is not None else time.monotonic()
            now_utc = datetime.now(timezone.utc).isoformat()

            self._state = mode
            self._session_start_monotonic = now_mono
            self._session_start_utc = now_utc

            # Reset per-node tracking
            self._node_last_seq = {nid: None for nid in self._expected_nodes}
            self._node_last_seen_monotonic = {nid: None for nid in self._expected_nodes}
            self._node_active_boot_id = {nid: None for nid in self._expected_nodes}
            self._node_retired_boot_ids = {nid: set() for nid in self._expected_nodes}
            self._node_boot_transitions_count = {nid: 0 for nid in self._expected_nodes}
            self._node_boot_transitions = {nid: [] for nid in self._expected_nodes}

            if initial_active_nodes is not None:
                for nid in initial_active_nodes:
                    if nid in self._expected_nodes:
                        self._node_last_seen_monotonic[nid] = now_mono

            # Initialize first window boundaries
            self._current_window_index = 0
            self._current_window_start_mono = now_mono
            self._current_window_end_mono = now_mono + self.config.window_seconds
            self._reset_current_window_counters()

            self._completed_windows.clear()
            self._partial_window = None
            if mode == ProcessorState.CALIBRATING:
                self._calibration_result = None
                self._calibrated_baseline_count = None

            logger.info(
                f"HardwareWindowProcessor session started in mode {mode.value} at T={now_mono:.4f}"
            )

    def start_calibration(
        self,
        start_monotonic: Optional[float] = None,
        initial_active_nodes: Optional[Sequence[str]] = None,
    ) -> None:
        """Convenience method to start a calibration session."""
        self.start_session(
            mode=ProcessorState.CALIBRATING,
            start_monotonic=start_monotonic,
            initial_active_nodes=initial_active_nodes,
        )

    def mark_node_active(
        self,
        node_id: str,
        timestamp_monotonic: Optional[float] = None,
    ) -> None:
        """Record an explicit liveness observation for an expected node."""
        with self._lock:
            if node_id in self._expected_nodes:
                ts = timestamp_monotonic if timestamp_monotonic is not None else time.monotonic()
                self._node_last_seen_monotonic[node_id] = ts

    def get_node_liveness(
        self,
        current_monotonic: Optional[float] = None,
    ) -> Dict[str, NodeLivenessState]:
        """Compute independent liveness status for each expected node."""
        with self._lock:
            if current_monotonic is not None:
                ref_mono = current_monotonic
            elif self._session_start_monotonic is not None and self._session_start_monotonic < 1000.0:
                ref_mono = self._current_window_start_mono or 0.0
            else:
                ref_mono = time.monotonic()

            result: Dict[str, NodeLivenessState] = {}
            for nid in self._expected_nodes:
                last_seen = self._node_last_seen_monotonic.get(nid)
                if last_seen is None:
                    result[nid] = NodeLivenessState.NEVER_OBSERVED
                elif (ref_mono - last_seen) > self.config.stale_node_timeout_seconds:
                    result[nid] = NodeLivenessState.STALE
                else:
                    result[nid] = NodeLivenessState.ACTIVE
            return result

    def _reset_current_window_counters(self) -> None:
        """Clear accumulator variables for the active window."""
        self._current_node_counts = {nid: 0 for nid in self._expected_nodes}
        self._current_node_modes = {nid: "normal" for nid in self._expected_nodes}
        self._current_node_first_seq = {nid: None for nid in self._expected_nodes}
        self._current_node_last_seq = {nid: None for nid in self._expected_nodes}
        self._current_node_gaps = {nid: 0 for nid in self._expected_nodes}
        self._current_node_duplicates = {nid: 0 for nid in self._expected_nodes}
        self._current_has_burst_mode = False

    def process_packet(self, packet: TelemetryPacket) -> None:
        """Ingest a validated UDP telemetry packet from HardwareReceiver.

        Thread-safe callback handler. Excludes packets from non-expected nodes,
        deduplicates sequences, and places unique arrivals into the appropriate window.
        """
        with self._lock:
            if self._state not in (ProcessorState.CALIBRATING, ProcessorState.MONITORING):
                logger.debug(
                    f"Discarding telemetry packet for {packet.node_id}: processor in state {self._state.value}."
                )
                return

            if packet.node_id not in self._expected_nodes:
                logger.debug(
                    f"Ignoring telemetry from node '{packet.node_id}' (not in expected nodes {self._expected_nodes})."
                )
                return

            pkt_mono = packet.received_time_monotonic

            # Advance window timeline if packet arrival timestamp is at or past current window boundary
            if self._current_window_end_mono is not None and pkt_mono >= self._current_window_end_mono:
                self._advance_time_internal(pkt_mono)

            # Check sequence ordering, deduplication, and reboot transitions
            is_v2 = (packet.version >= 2 and packet.boot_id is not None)
            is_unique = True
            is_gap = False
            gap_size = 0

            if not is_v2:
                # Protocol V1: Strict monotonic sequence tracking (no reboot detection)
                prev_seq = self._node_last_seq.get(packet.node_id)
                if prev_seq is not None:
                    expected_seq = (prev_seq + 1) & 0xFFFFFFFF
                    if packet.seq == expected_seq:
                        is_unique = True
                    elif packet.seq > prev_seq:
                        is_unique = True
                        is_gap = True
                        gap_size = packet.seq - prev_seq - 1
                    else:
                        if prev_seq > 4_000_000_000 and packet.seq < 1_000_000:
                            is_unique = True
                        else:
                            is_unique = False
            else:
                # Protocol V2: Boot-aware sequence tracking and reboot recovery
                active_boot = self._node_active_boot_id.get(packet.node_id)
                retired_boots = self._node_retired_boot_ids.setdefault(packet.node_id, set())

                if active_boot is None:
                    # First observation of this node under Protocol V2
                    self._node_active_boot_id[packet.node_id] = packet.boot_id
                    is_unique = True
                elif packet.boot_id == active_boot:
                    # Normal sequence check within active boot session
                    prev_seq = self._node_last_seq.get(packet.node_id)
                    if prev_seq is not None:
                        expected_seq = (prev_seq + 1) & 0xFFFFFFFF
                        if packet.seq == expected_seq:
                            is_unique = True
                        elif packet.seq > prev_seq:
                            is_unique = True
                            is_gap = True
                            gap_size = packet.seq - prev_seq - 1
                        else:
                            if prev_seq > 4_000_000_000 and packet.seq < 1_000_000:
                                is_unique = True
                            else:
                                is_unique = False
                elif packet.boot_id in retired_boots:
                    # Delayed packet from a previously retired boot session
                    # Policy: Do NOT switch session back. Exclude from unique arrivals.
                    is_unique = False
                else:
                    # New, previously unseen boot_id -> REBOOT DETECTED!
                    retired_boots.add(active_boot)
                    self._node_boot_transitions_count[packet.node_id] = (
                        self._node_boot_transitions_count.get(packet.node_id, 0) + 1
                    )
                    self._node_boot_transitions.setdefault(packet.node_id, []).append({
                        "from_boot_id": active_boot,
                        "to_boot_id": packet.boot_id,
                        "last_seq_before_reboot": self._node_last_seq.get(packet.node_id),
                        "initial_seq_after_reboot": packet.seq,
                        "received_mono": pkt_mono,
                    })
                    self._node_active_boot_id[packet.node_id] = packet.boot_id
                    is_unique = True

            # Update per-node session tracking
            self._node_last_seen_monotonic[packet.node_id] = pkt_mono
            if is_unique:
                self._node_last_seq[packet.node_id] = packet.seq

            # Record into current window
            if self._current_node_first_seq[packet.node_id] is None:
                self._current_node_first_seq[packet.node_id] = packet.seq
            self._current_node_last_seq[packet.node_id] = packet.seq
            self._current_node_modes[packet.node_id] = packet.mode

            if packet.mode == "burst":
                self._current_has_burst_mode = True

            if is_gap:
                self._current_node_gaps[packet.node_id] += 1

            if is_unique:
                # Valid unique arrival
                self._current_node_counts[packet.node_id] += 1
            else:
                # Exclude duplicate / reordered from arrival count
                self._current_node_duplicates[packet.node_id] += 1

    def advance_time(self, target_monotonic: float) -> List[AggregatedWindow]:
        """Advance the processor timeline deterministically to target_monotonic.

        Finalizes any observation windows that have completed their full duration.
        Returns the newly finalized windows.
        """
        with self._lock:
            return self._advance_time_internal(target_monotonic)

    def _advance_time_internal(self, target_monotonic: float) -> List[AggregatedWindow]:
        """Internal lock-protected window finalization loop."""
        finalized: List[AggregatedWindow] = []

        if self._state not in (ProcessorState.CALIBRATING, ProcessorState.MONITORING):
            return finalized

        if self._current_window_end_mono is None:
            return finalized

        while target_monotonic >= self._current_window_end_mono:
            # Current window is complete!
            win = self._build_and_evaluate_window(
                is_complete=True,
                is_partial=False,
                window_end_mono=self._current_window_end_mono,
            )
            self._completed_windows.append(win)
            finalized.append(win)

            # Move boundary forward by exactly window_seconds
            self._current_window_index += 1
            self._current_window_start_mono = self._current_window_end_mono
            self._current_window_end_mono += self.config.window_seconds
            self._reset_current_window_counters()

        return finalized

    def _build_and_evaluate_window(
        self,
        is_complete: bool,
        is_partial: bool,
        window_end_mono: float,
    ) -> AggregatedWindow:
        """Construct AggregatedWindow, check calibration eligibility, and run detector."""
        start_mono = self._current_window_start_mono or 0.0
        dur = round(window_end_mono - start_mono, 4)

        # Timestamps
        start_utc = datetime.now(timezone.utc).isoformat()
        end_utc = datetime.now(timezone.utc).isoformat()

        agg_count = sum(self._current_node_counts.values())
        node_counts = dict(self._current_node_counts)
        node_modes = dict(self._current_node_modes)

        # Independent node liveness evaluation at window_end_mono
        node_liveness_dict: Dict[str, NodeLivenessState] = {}
        unhealthy_nodes: List[str] = []
        for nid in self._expected_nodes:
            last_seen = self._node_last_seen_monotonic.get(nid)
            if last_seen is None:
                st = NodeLivenessState.NEVER_OBSERVED
                unhealthy_nodes.append(nid)
            elif (window_end_mono - last_seen) > self.config.stale_node_timeout_seconds:
                st = NodeLivenessState.STALE
                unhealthy_nodes.append(nid)
            else:
                st = NodeLivenessState.ACTIVE
            node_liveness_dict[nid] = st

        all_expected_nodes_healthy = (len(unhealthy_nodes) == 0)

        # Quality evaluation
        has_gaps = any(g > 0 for g in self._current_node_gaps.values())

        if is_partial:
            quality = WindowQuality.PARTIAL
        elif self._current_has_burst_mode:
            quality = WindowQuality.BURST_CONTAMINATED
        elif self.config.require_all_nodes and not all_expected_nodes_healthy:
            quality = WindowQuality.MISSING_NODES
        elif has_gaps:
            quality = WindowQuality.COMPLETE_WITH_GAPS
        else:
            quality = WindowQuality.COMPLETE_CLEAN

        # Calibration eligibility
        is_calib_session = (self._state == ProcessorState.CALIBRATING)
        is_eligible = False
        ineligibility_reason: Optional[str] = None

        if is_calib_session:
            if not is_complete:
                is_eligible = False
                ineligibility_reason = "Incomplete/partial window"
            elif self._current_has_burst_mode:
                is_eligible = False
                ineligibility_reason = "Burst-mode telemetry detected (mode=burst)"
            elif self.config.require_all_nodes and not all_expected_nodes_healthy:
                is_eligible = False
                ineligibility_reason = (
                    f"Expected node(s) unobserved or stale: {sorted(unhealthy_nodes)}"
                )
            else:
                is_eligible = True

        # Detection evaluation
        p_val: Optional[float] = None
        is_burst: Optional[bool] = None
        alpha_used: Optional[float] = None
        det_status = DetectionStatus.UNAVAILABLE
        det_unavail_reason: Optional[str] = None

        if is_calib_session:
            det_status = DetectionStatus.CALIBRATING
            det_unavail_reason = "Calibration in progress; baseline not yet established"
        elif is_partial:
            det_status = DetectionStatus.UNAVAILABLE
            det_unavail_reason = "Partial window at session boundary"
        elif self._calibrated_baseline_count is None:
            det_status = DetectionStatus.UNAVAILABLE
            det_unavail_reason = "Baseline calibration not established"
        elif self.config.require_all_nodes and not all_expected_nodes_healthy:
            det_status = DetectionStatus.UNAVAILABLE
            det_unavail_reason = (
                f"Expected node(s) unobserved or stale: {sorted(unhealthy_nodes)}"
            )
        else:
            # Authoritative detection evaluation using core/poisson.py:detect_burst
            try:
                res: BurstDetectionResult = detect_burst(
                    observed_count=agg_count,
                    expected_rate=self._calibrated_baseline_count,
                    alpha=self.config.alpha,
                )
                p_val = res.p_value
                is_burst = res.is_burst
                alpha_used = res.alpha
                det_status = DetectionStatus.BURST if res.is_burst else DetectionStatus.NORMAL
            except Exception as err:
                det_status = DetectionStatus.UNAVAILABLE
                det_unavail_reason = f"Detection error: {err}"

        return AggregatedWindow(
            window_index=self._current_window_index,
            start_time_monotonic=start_mono,
            end_time_monotonic=window_end_mono,
            start_time_utc=start_utc,
            end_time_utc=end_utc,
            duration_seconds=dur,
            aggregate_count=agg_count,
            node_counts=node_counts,
            node_modes=node_modes,
            node_liveness={nid: st.value for nid, st in node_liveness_dict.items()},
            node_first_seq=dict(self._current_node_first_seq),
            node_last_seq=dict(self._current_node_last_seq),
            node_gaps_count=dict(self._current_node_gaps),
            node_duplicates_count=dict(self._current_node_duplicates),
            node_boot_ids=dict(self._node_active_boot_id),
            is_complete=is_complete,
            is_partial=is_partial,
            quality=quality,
            is_calibration=is_calib_session,
            is_calibration_eligible=is_eligible,
            ineligibility_reason=ineligibility_reason,
            expected_baseline_count=self._calibrated_baseline_count,
            p_value=p_val,
            is_burst=is_burst,
            alpha=alpha_used,
            detection_status=det_status,
            detection_unavailable_reason=det_unavail_reason,
        )

    def finalize_calibration(self, current_monotonic: Optional[float] = None) -> CalibrationResult:
        """Evaluate collected calibration windows, establish the baseline expected count,
        and transition the processor to MONITORING mode.
        """
        with self._lock:
            if self._state != ProcessorState.CALIBRATING:
                raise RuntimeError(
                    f"Cannot finalize calibration: processor is in state {self._state.value}, expected CALIBRATING."
                )

            # Advance up to current monotonic time to close any due window
            if current_monotonic is not None:
                self._advance_time_internal(current_monotonic)
            elif self._session_start_monotonic is not None and self._session_start_monotonic > 1000.0:
                # Real-time wallclock session
                self._advance_time_internal(time.monotonic())

            # Collect completed calibration windows
            calib_windows = [w for w in self._completed_windows if w.is_calibration]
            eligible = [w for w in calib_windows if w.is_calibration_eligible]
            excluded = [w for w in calib_windows if not w.is_calibration_eligible]

            reasons: Dict[str, int] = collections.defaultdict(int)
            for w in excluded:
                reason = w.ineligibility_reason or "Unknown reason"
                reasons[reason] += 1

            if len(eligible) < self.config.min_calibration_windows:
                raise ValueError(
                    f"Insufficient eligible calibration windows: collected {len(eligible)} eligible "
                    f"(required >= {self.config.min_calibration_windows}). "
                    f"Excluded {len(excluded)} windows. Exclusion breakdown: {dict(reasons)}."
                )

            # Authoritative estimation using core/poisson.py:estimate_baseline_rate
            eligible_counts = [w.aggregate_count for w in eligible]
            lambda_hat_window = estimate_baseline_rate(eligible_counts)
            lambda_rate_sec = lambda_hat_window / self.config.window_seconds

            self._calibrated_baseline_count = lambda_hat_window
            self._calibration_result = CalibrationResult(
                eligible_windows_count=len(eligible),
                excluded_windows_count=len(excluded),
                exclusion_reasons=dict(reasons),
                expected_count_per_window=round(lambda_hat_window, 4),
                rate_per_second=round(lambda_rate_sec, 4),
                window_seconds=self.config.window_seconds,
                alpha=self.config.alpha,
                calibrated_at_utc=datetime.now(timezone.utc).isoformat(),
            )

            # Transition to MONITORING
            self._state = ProcessorState.MONITORING
            logger.info(
                f"Calibration finalized successfully from {len(eligible)} windows. "
                f"Baseline expected count per window = {lambda_hat_window:.3f} "
                f"({lambda_rate_sec:.3f} datagrams/sec). Transitioned to MONITORING."
            )
            return self._calibration_result

    def stop_session(self, stop_monotonic: Optional[float] = None) -> None:
        """Cleanly terminate the session and seal any active partial window."""
        with self._lock:
            if self._state == ProcessorState.STOPPED or self._state == ProcessorState.IDLE:
                return

            if stop_monotonic is not None:
                now_mono = stop_monotonic
            elif self._session_start_monotonic is not None and self._session_start_monotonic < 1000.0:
                # Deterministic simulation mode
                now_mono = self._current_window_start_mono or 0.0
            else:
                now_mono = time.monotonic()

            # Finalize due windows
            self._advance_time_internal(now_mono)

            # If there is remaining duration in current window, mark as partial
            if self._current_window_start_mono is not None and now_mono > self._current_window_start_mono:
                partial_win = self._build_and_evaluate_window(
                    is_complete=False,
                    is_partial=True,
                    window_end_mono=now_mono,
                )
                self._partial_window = partial_win

            self._state = ProcessorState.STOPPED
            logger.info("HardwareWindowProcessor session stopped cleanly.")

    def reset(self) -> None:
        """Reset the processor to pristine IDLE state."""
        with self._lock:
            self._state = ProcessorState.IDLE
            self._session_start_monotonic = None
            self._session_start_utc = None
            self._current_window_index = 0
            self._current_window_start_mono = None
            self._current_window_end_mono = None
            self._reset_current_window_counters()
            self._completed_windows.clear()
            self._partial_window = None
            self._calibration_result = None
            self._calibrated_baseline_count = None
            self._node_last_seq = {nid: None for nid in self._expected_nodes}
            self._node_last_seen_monotonic = {nid: None for nid in self._expected_nodes}

    def get_windows(self, include_partial: bool = False) -> List[AggregatedWindow]:
        """Return snapshot copy of completed observation windows."""
        with self._lock:
            res = list(self._completed_windows)
            if include_partial and self._partial_window is not None:
                res.append(self._partial_window)
            return res

    def get_status(self, current_monotonic: Optional[float] = None) -> Dict[str, Any]:
        """Return comprehensive thread-safe status snapshot."""
        with self._lock:
            if current_monotonic is not None:
                now_mono = current_monotonic
            elif self._session_start_monotonic is not None and self._session_start_monotonic < 1000.0:
                now_mono = self._current_window_start_mono or 0.0
            else:
                now_mono = time.monotonic()

            elapsed_sec = (
                round(now_mono - self._session_start_monotonic, 2)
                if self._session_start_monotonic is not None
                else 0.0
            )

            completed = list(self._completed_windows)
            total_completed = len(completed)
            total_arrivals = sum(w.aggregate_count for w in completed)

            burst_windows_count = sum(1 for w in completed if w.is_burst is True)
            calib_windows_count = sum(1 for w in completed if w.is_calibration)

            liveness = {
                nid: st.value
                for nid, st in self.get_node_liveness(now_mono).items()
            }

            return {
                "state": self._state.value,
                "window_seconds": self.config.window_seconds,
                "expected_node_ids": list(self._expected_nodes),
                "alpha": self.config.alpha,
                "session_start_utc": self._session_start_utc,
                "elapsed_seconds": elapsed_sec,
                "total_completed_windows": total_completed,
                "total_observed_arrivals": total_arrivals,
                "calibration_windows_count": calib_windows_count,
                "burst_windows_count": burst_windows_count,
                "is_calibrated": self._calibrated_baseline_count is not None,
                "baseline_expected_count": self._calibrated_baseline_count,
                "baseline_rate_per_second": self.baseline_rate_per_second,
                "stale_node_timeout_seconds": self.config.stale_node_timeout_seconds,
                "node_liveness": liveness,
                "calibration_result": self._calibration_result.to_dict() if self._calibration_result else None,
                "partial_window": self._partial_window.to_dict() if self._partial_window else None,
            }
