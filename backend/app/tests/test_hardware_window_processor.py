"""
PoissonBurst Lab - Unit and Integration Tests for HardwareWindowProcessor.

Validates:
1. Configuration parameter validation and defaults.
2. Tumbling observation-window aggregation and half-open boundary semantics.
3. Multi-node counting, sequence tracking, and deduplication.
4. Baseline calibration from clean windows and strict burst-contamination rejection.
5. Statistical burst detection using the authoritative Poisson engine.
6. Statistical independence: detector decision is independent of source mode metadata.
7. Data quality tracking (missing nodes, sequence gaps, partial windows).
8. Thread safety, concurrent packet ingestion, and lifecycle state transitions.
9. End-to-end localhost UDP integration using real HardwareReceiver and HardwareSimulator.
"""

from __future__ import annotations

import threading
import time
from typing import List
import pytest

from app.core.schemas import MeasurementType, TrafficSource
from app.services.hardware_receiver import HardwareReceiver, TelemetryPacket
from app.services.hardware_simulator import HardwareSimulator, SimulatedNodeConfig
from app.services.hardware_window_processor import (
    AggregatedWindow,
    CalibrationResult,
    DetectionStatus,
    HardwareWindowProcessor,
    HardwareWindowProcessorConfig,
    NodeLivenessState,
    ProcessorState,
    WindowQuality,
)


def make_packet(
    node_id: str = "node_1",
    seq: int = 1,
    monotonic_time: float = 100.0,
    mode: str = "normal",
    uptime_ms: int = 1000,
) -> TelemetryPacket:
    """Helper to construct a deterministic TelemetryPacket."""
    return TelemetryPacket(
        version=1,
        node_id=node_id,
        seq=seq,
        uptime_ms=uptime_ms,
        mode=mode,
        received_time_utc="2026-10-24T12:00:00Z",
        received_time_monotonic=monotonic_time,
        source_address=("127.0.0.1", 5005),
    )


# =============================================================================
# 1. Configuration Validation Tests
# =============================================================================

class TestConfigValidation:
    """Tests for HardwareWindowProcessorConfig parameter constraints."""

    def test_default_config(self):
        cfg = HardwareWindowProcessorConfig()
        assert cfg.window_seconds == 1.0
        assert set(cfg.expected_node_ids) == {"node_1", "node_2", "node_3", "node_4"}
        assert cfg.min_calibration_windows == 10
        assert cfg.alpha == 0.01
        assert cfg.require_all_nodes is True

    @pytest.mark.parametrize("bad_w", [0.0, -1.0, 301.0])
    def test_invalid_window_seconds(self, bad_w: float):
        with pytest.raises(ValueError, match="window_seconds must be in"):
            HardwareWindowProcessorConfig(window_seconds=bad_w)

    def test_empty_expected_nodes(self):
        with pytest.raises(ValueError, match="expected_node_ids cannot be empty"):
            HardwareWindowProcessorConfig(expected_node_ids=[])

    def test_invalid_node_id(self):
        with pytest.raises(ValueError, match="Invalid expected node_id"):
            HardwareWindowProcessorConfig(expected_node_ids=["node_1", "invalid_node"])

    @pytest.mark.parametrize("bad_min", [0, -5])
    def test_invalid_min_calibration_windows(self, bad_min: int):
        with pytest.raises(ValueError, match="min_calibration_windows must be at least 1"):
            HardwareWindowProcessorConfig(min_calibration_windows=bad_min)

    @pytest.mark.parametrize("bad_alpha", [0.0, 1.0, -0.05, 1.5])
    def test_invalid_alpha(self, bad_alpha: float):
        with pytest.raises(ValueError, match="Significance level alpha must be in"):
            HardwareWindowProcessorConfig(alpha=bad_alpha)


# =============================================================================
# 2. Observation-Window Aggregation & Boundary Semantics
# =============================================================================

class TestWindowAggregationDeterministic:
    """Validates half-open intervals [start, end), multi-node counts, and empty windows."""

    def test_half_open_boundary_assignment(self):
        cfg = HardwareWindowProcessorConfig(
            window_seconds=1.0,
            expected_node_ids=["node_1"],
            require_all_nodes=False,
        )
        proc = HardwareWindowProcessor(config=cfg)
        proc.start_session(mode=ProcessorState.MONITORING, start_monotonic=100.0)

        # Event at window start (100.0) belongs to window 0
        proc.process_packet(make_packet("node_1", seq=1, monotonic_time=100.0))

        # Event inside window (100.5) belongs to window 0
        proc.process_packet(make_packet("node_1", seq=2, monotonic_time=100.5))

        # Event right before boundary (100.999) belongs to window 0
        proc.process_packet(make_packet("node_1", seq=3, monotonic_time=100.999))

        # Event EXACTLY on boundary (101.0) moves to window 1
        proc.process_packet(make_packet("node_1", seq=4, monotonic_time=101.0))

        # Window 0 must now be complete
        windows = proc.get_windows()
        assert len(windows) == 1
        w0 = windows[0]
        assert w0.window_index == 0
        assert w0.start_time_monotonic == 100.0
        assert w0.end_time_monotonic == 101.0
        assert w0.duration_seconds == 1.0
        assert w0.aggregate_count == 3  # packets 1, 2, 3
        assert w0.node_counts["node_1"] == 3
        assert w0.is_complete is True
        assert w0.is_partial is False

        # Advance to 102.0 to close window 1
        proc.advance_time(102.0)
        windows = proc.get_windows()
        assert len(windows) == 2
        w1 = windows[1]
        assert w1.window_index == 1
        assert w1.start_time_monotonic == 101.0
        assert w1.end_time_monotonic == 102.0
        assert w1.aggregate_count == 1  # packet 4
        assert w1.node_counts["node_1"] == 1

    def test_multi_node_aggregate_and_per_node_counts(self):
        cfg = HardwareWindowProcessorConfig(
            window_seconds=1.0,
            expected_node_ids=["node_1", "node_2", "node_3", "node_4"],
        )
        proc = HardwareWindowProcessor(config=cfg)
        proc.start_session(mode=ProcessorState.MONITORING, start_monotonic=10.0)

        # Ingest packets from each node in window 0 [10.0, 11.0)
        proc.process_packet(make_packet("node_1", seq=1, monotonic_time=10.1))
        proc.process_packet(make_packet("node_1", seq=2, monotonic_time=10.2))
        proc.process_packet(make_packet("node_2", seq=1, monotonic_time=10.3))
        proc.process_packet(make_packet("node_3", seq=1, monotonic_time=10.4))
        proc.process_packet(make_packet("node_3", seq=2, monotonic_time=10.5))
        proc.process_packet(make_packet("node_3", seq=3, monotonic_time=10.6))
        proc.process_packet(make_packet("node_4", seq=1, monotonic_time=10.7))

        proc.advance_time(11.0)
        windows = proc.get_windows()
        assert len(windows) == 1
        w = windows[0]
        assert w.aggregate_count == 7
        assert w.node_counts == {"node_1": 2, "node_2": 1, "node_3": 3, "node_4": 1}

    def test_empty_completed_windows_emitted(self):
        """When time elapses with no packets, legitimate zero-count windows are emitted."""
        cfg = HardwareWindowProcessorConfig(
            window_seconds=1.0,
            expected_node_ids=["node_1"],
            require_all_nodes=False,
        )
        proc = HardwareWindowProcessor(config=cfg)
        proc.start_session(mode=ProcessorState.MONITORING, start_monotonic=50.0)

        # Jump from 50.0 to 53.5
        proc.advance_time(53.5)

        windows = proc.get_windows()
        assert len(windows) == 3
        for idx, w in enumerate(windows):
            assert w.window_index == idx
            assert w.aggregate_count == 0
            assert w.is_complete is True
            assert w.start_time_monotonic == 50.0 + idx * 1.0
            assert w.end_time_monotonic == 50.0 + (idx + 1) * 1.0

    def test_partial_final_window_on_stop(self):
        """Session stopped prematurely marks the active window as partial."""
        cfg = HardwareWindowProcessorConfig(
            window_seconds=1.0,
            expected_node_ids=["node_1"],
            require_all_nodes=False,
        )
        proc = HardwareWindowProcessor(config=cfg)
        proc.start_session(mode=ProcessorState.MONITORING, start_monotonic=0.0)

        proc.process_packet(make_packet("node_1", seq=1, monotonic_time=0.2))
        proc.process_packet(make_packet("node_1", seq=2, monotonic_time=1.2))  # window 1

        # Stop at 1.4s (window 1 spans 1.0 to 2.0, so at 1.4s it is partial)
        proc.stop_session(stop_monotonic=1.4)

        completed = proc.get_windows(include_partial=False)
        assert len(completed) == 1
        assert completed[0].window_index == 0
        assert completed[0].is_complete is True

        all_wins = proc.get_windows(include_partial=True)
        assert len(all_wins) == 2
        p_win = all_wins[1]
        assert p_win.window_index == 1
        assert p_win.is_complete is False
        assert p_win.is_partial is True
        assert p_win.quality == WindowQuality.PARTIAL
        assert p_win.duration_seconds == 0.4
        assert p_win.aggregate_count == 1
        assert p_win.detection_status == DetectionStatus.UNAVAILABLE


# =============================================================================
# 3. Sequence Tracking and Deduplication Tests
# =============================================================================

class TestSequenceSemanticsAndDeduplication:
    """Validates sequence tracking, duplicate exclusion, and gap accounting."""

    def test_duplicate_packets_excluded_from_arrival_count(self):
        cfg = HardwareWindowProcessorConfig(
            window_seconds=1.0,
            expected_node_ids=["node_1"],
            require_all_nodes=False,
        )
        proc = HardwareWindowProcessor(config=cfg)
        proc.start_session(mode=ProcessorState.MONITORING, start_monotonic=0.0)

        # Send seq=1, then duplicate seq=1, then seq=2
        proc.process_packet(make_packet("node_1", seq=1, monotonic_time=0.1))
        proc.process_packet(make_packet("node_1", seq=1, monotonic_time=0.2))  # duplicate!
        proc.process_packet(make_packet("node_1", seq=2, monotonic_time=0.3))

        proc.advance_time(1.0)
        w = proc.get_windows()[0]

        # Only 2 unique arrivals counted, 1 duplicate recorded
        assert w.aggregate_count == 2
        assert w.node_counts["node_1"] == 2
        assert w.node_duplicates_count["node_1"] == 1

    def test_sequence_gap_does_not_add_extra_arrivals(self):
        cfg = HardwareWindowProcessorConfig(
            window_seconds=1.0,
            expected_node_ids=["node_1"],
            require_all_nodes=False,
        )
        proc = HardwareWindowProcessor(config=cfg)
        proc.start_session(mode=ProcessorState.MONITORING, start_monotonic=0.0)

        # Send seq=1, then seq=5 (loss of packets 2, 3, 4)
        proc.process_packet(make_packet("node_1", seq=1, monotonic_time=0.1))
        proc.process_packet(make_packet("node_1", seq=5, monotonic_time=0.2))

        proc.advance_time(1.0)
        w = proc.get_windows()[0]

        # Only 2 packets actually received and counted
        assert w.aggregate_count == 2
        assert w.node_counts["node_1"] == 2
        assert w.node_gaps_count["node_1"] == 1
        assert w.quality == WindowQuality.COMPLETE_WITH_GAPS


# =============================================================================
# 4. Baseline Calibration Tests
# =============================================================================

class TestBaselineCalibration:
    """Validates calibration from clean windows and burst contamination exclusion."""

    def test_clean_baseline_estimation(self):
        cfg = HardwareWindowProcessorConfig(
            window_seconds=1.0,
            min_calibration_windows=5,
            expected_node_ids=["node_1"],
            require_all_nodes=False,
        )
        proc = HardwareWindowProcessor(config=cfg)
        proc.start_calibration(start_monotonic=0.0)

        # 5 complete windows with counts: [20, 22, 18, 19, 21] (mean = 20.0)
        counts = [20, 22, 18, 19, 21]
        seq = 1
        for win_idx, cnt in enumerate(counts):
            base_t = win_idx * 1.0
            for i in range(cnt):
                t = base_t + (i / 100.0)
                proc.process_packet(make_packet("node_1", seq=seq, monotonic_time=t, mode="normal"))
                seq += 1

        proc.advance_time(5.0)
        cal_res = proc.finalize_calibration()

        assert cal_res.eligible_windows_count == 5
        assert cal_res.excluded_windows_count == 0
        assert cal_res.expected_count_per_window == 20.0
        assert cal_res.rate_per_second == 20.0
        assert proc.is_calibrated is True
        assert proc.state == ProcessorState.MONITORING

    def test_burst_mode_contamination_excluded_from_calibration(self):
        cfg = HardwareWindowProcessorConfig(
            window_seconds=1.0,
            min_calibration_windows=3,
            expected_node_ids=["node_1"],
            require_all_nodes=False,
        )
        proc = HardwareWindowProcessor(config=cfg)
        proc.start_calibration(start_monotonic=0.0)

        # Window 0: normal count 10
        for i in range(10):
            proc.process_packet(make_packet("node_1", seq=i + 1, monotonic_time=0.0 + i * 0.05, mode="normal"))

        # Window 1: burst count 50 (CONTAMINATED)
        for i in range(50):
            proc.process_packet(make_packet("node_1", seq=20 + i, monotonic_time=1.0 + i * 0.01, mode="burst"))

        # Window 2: normal count 10
        for i in range(10):
            proc.process_packet(make_packet("node_1", seq=100 + i, monotonic_time=2.0 + i * 0.05, mode="normal"))

        # Window 3: normal count 10
        for i in range(10):
            proc.process_packet(make_packet("node_1", seq=150 + i, monotonic_time=3.0 + i * 0.05, mode="normal"))

        proc.advance_time(4.0)

        windows = proc.get_windows()
        assert len(windows) == 4
        # Window 1 was contaminated
        assert windows[1].quality == WindowQuality.BURST_CONTAMINATED
        assert windows[1].is_calibration_eligible is False
        assert "Burst-mode telemetry detected" in str(windows[1].ineligibility_reason)

        cal_res = proc.finalize_calibration()
        assert cal_res.eligible_windows_count == 3  # Windows 0, 2, 3
        assert cal_res.excluded_windows_count == 1  # Window 1 excluded!
        # Mean of [10, 10, 10] = 10.0 (uncontaminated by the 50 in window 1!)
        assert cal_res.expected_count_per_window == 10.0

    def test_insufficient_calibration_data_raises_error(self):
        cfg = HardwareWindowProcessorConfig(
            window_seconds=1.0,
            min_calibration_windows=5,
            expected_node_ids=["node_1"],
            require_all_nodes=False,
        )
        proc = HardwareWindowProcessor(config=cfg)
        proc.start_calibration(start_monotonic=0.0)

        # Only 2 windows
        proc.advance_time(2.0)

        with pytest.raises(ValueError, match="Insufficient eligible calibration windows"):
            proc.finalize_calibration()


# =============================================================================
# 5. Poisson Burst Detection Tests
# =============================================================================

class TestDetectorIntegration:
    """Validates Poisson burst detection on monitoring windows using core/poisson.py."""

    def test_normal_traffic_evaluated_as_not_burst(self):
        cfg = HardwareWindowProcessorConfig(
            window_seconds=1.0,
            min_calibration_windows=3,
            expected_node_ids=["node_1"],
            require_all_nodes=False,
        )
        proc = HardwareWindowProcessor(config=cfg)
        proc.start_calibration(start_monotonic=0.0)

        # Calibrate baseline = 20.0
        for w_idx in range(3):
            for i in range(20):
                proc.process_packet(make_packet("node_1", seq=w_idx * 50 + i, monotonic_time=w_idx * 1.0 + i * 0.02))
        proc.advance_time(3.0)
        proc.finalize_calibration()

        # Monitoring window: arrival count 21 (normal, near baseline)
        for i in range(21):
            proc.process_packet(make_packet("node_1", seq=300 + i, monotonic_time=3.0 + i * 0.03))
        proc.advance_time(4.0)

        windows = proc.get_windows()
        mon_w = windows[3]
        assert mon_w.aggregate_count == 21
        assert mon_w.is_burst is False
        assert mon_w.detection_status == DetectionStatus.NORMAL
        assert mon_w.p_value is not None
        assert mon_w.p_value > 0.01

    def test_high_arrival_count_triggers_burst_detection(self):
        cfg = HardwareWindowProcessorConfig(
            window_seconds=1.0,
            min_calibration_windows=3,
            expected_node_ids=["node_1"],
            require_all_nodes=False,
        )
        proc = HardwareWindowProcessor(config=cfg)
        proc.start_calibration(start_monotonic=0.0)

        # Baseline = 20.0
        for w_idx in range(3):
            for i in range(20):
                proc.process_packet(make_packet("node_1", seq=w_idx * 50 + i, monotonic_time=w_idx * 1.0 + i * 0.02))
        proc.advance_time(3.0)
        proc.finalize_calibration()

        # Monitoring window: arrival count 55 (statistically massive burst!)
        for i in range(55):
            proc.process_packet(make_packet("node_1", seq=400 + i, monotonic_time=3.0 + i * 0.01))
        proc.advance_time(4.0)

        windows = proc.get_windows()
        burst_w = windows[3]
        assert burst_w.aggregate_count == 55
        assert burst_w.is_burst is True
        assert burst_w.detection_status == DetectionStatus.BURST
        assert burst_w.p_value is not None
        assert burst_w.p_value < 1e-6


# =============================================================================
# 6. Statistical Independence Tests (Ground Truth Separation)
# =============================================================================

class TestDetectorStatisticalIndependence:
    """Proves that detector decisions are made strictly by Poisson math,

    not by reading the telemetry packet's mode field.
    """

    def test_burst_mode_flag_does_not_force_burst_decision(self):
        """Packet says mode='burst', but count is normal (20) -> must be NOT burst!"""
        cfg = HardwareWindowProcessorConfig(
            window_seconds=1.0,
            min_calibration_windows=3,
            expected_node_ids=["node_1"],
            require_all_nodes=False,
        )
        proc = HardwareWindowProcessor(config=cfg)
        proc.start_calibration(start_monotonic=0.0)

        for w_idx in range(3):
            for i in range(20):
                proc.process_packet(make_packet("node_1", seq=w_idx * 50 + i, monotonic_time=w_idx * 1.0 + i * 0.02, mode="normal"))
        proc.advance_time(3.0)
        proc.finalize_calibration()

        # Monitoring window: 20 packets, but telemetry reports mode='burst'
        for i in range(20):
            proc.process_packet(make_packet("node_1", seq=300 + i, monotonic_time=3.0 + i * 0.02, mode="burst"))
        proc.advance_time(4.0)

        mon_w = proc.get_windows()[3]
        assert mon_w.node_modes["node_1"] == "burst"
        # Detector evaluated observed count (20) vs lambda (20.0) -> NOT a burst!
        assert mon_w.is_burst is False
        assert mon_w.detection_status == DetectionStatus.NORMAL

    def test_normal_mode_flag_does_not_prevent_burst_decision(self):
        """Packet says mode='normal', but count is 60 -> must be flagged as BURST!"""
        cfg = HardwareWindowProcessorConfig(
            window_seconds=1.0,
            min_calibration_windows=3,
            expected_node_ids=["node_1"],
            require_all_nodes=False,
        )
        proc = HardwareWindowProcessor(config=cfg)
        proc.start_calibration(start_monotonic=0.0)

        for w_idx in range(3):
            for i in range(20):
                proc.process_packet(make_packet("node_1", seq=w_idx * 50 + i, monotonic_time=w_idx * 1.0 + i * 0.02, mode="normal"))
        proc.advance_time(3.0)
        proc.finalize_calibration()

        # Monitoring window: 60 packets, but telemetry says mode='normal'
        for i in range(60):
            proc.process_packet(make_packet("node_1", seq=300 + i, monotonic_time=3.0 + i * 0.01, mode="normal"))
        proc.advance_time(4.0)

        mon_w = proc.get_windows()[3]
        assert mon_w.node_modes["node_1"] == "normal"
        # Statistical engine independently identified the burst!
        assert mon_w.is_burst is True
        assert mon_w.detection_status == DetectionStatus.BURST


# =============================================================================
# 7. Data Quality & Node Availability Tests
# =============================================================================

class TestDataQualityAndNodeAvailability:
    """Tests missing node detection and quality flagging."""

    def test_missing_expected_node_invalidates_calibration(self):
        cfg = HardwareWindowProcessorConfig(
            window_seconds=1.0,
            min_calibration_windows=3,
            expected_node_ids=["node_1", "node_2"],
            require_all_nodes=True,
        )
        proc = HardwareWindowProcessor(config=cfg)
        proc.start_calibration(start_monotonic=0.0)

        # Only node_1 transmits, node_2 never seen
        for w_idx in range(3):
            for i in range(10):
                proc.process_packet(make_packet("node_1", seq=w_idx * 50 + i, monotonic_time=w_idx * 1.0 + i * 0.05))

        proc.advance_time(3.0)
        windows = proc.get_windows()
        for w in windows:
            assert w.quality == WindowQuality.MISSING_NODES
            assert w.is_calibration_eligible is False

        with pytest.raises(ValueError, match="Insufficient eligible calibration windows"):
            proc.finalize_calibration()

    def test_conversion_to_traffic_observation_schema(self):
        cfg = HardwareWindowProcessorConfig(window_seconds=1.0, expected_node_ids=["node_1"], require_all_nodes=False)
        proc = HardwareWindowProcessor(config=cfg, experiment_id="exp-hw-test")
        proc.start_session(mode=ProcessorState.MONITORING, start_monotonic=10.0)

        proc.process_packet(make_packet("node_1", seq=1, monotonic_time=10.2))
        proc.advance_time(11.0)

        w = proc.get_windows()[0]
        obs = w.to_traffic_observation(experiment_id="exp-hw-test", session_start_monotonic=10.0)

        assert obs.source == TrafficSource.HARDWARE
        assert obs.measurement_type == MeasurementType.UDP_DATAGRAM_COUNT
        assert obs.count == 1
        assert obs.experiment_id == "exp-hw-test"
        assert obs.window_seconds == 1.0
        assert obs.time_seconds == 0.0


# =============================================================================
# 8. Lifecycle, State Machine & Thread-Safety Tests
# =============================================================================

class TestLifecycleAndConcurrency:
    """Validates session state machine transitions and concurrent packet processing."""

    def test_state_machine_transitions(self):
        proc = HardwareWindowProcessor()
        assert proc.state == ProcessorState.IDLE

        proc.start_calibration()
        assert proc.state == ProcessorState.CALIBRATING

        with pytest.raises(RuntimeError, match="Session is already active"):
            proc.start_calibration()

        proc.stop_session()
        assert proc.state == ProcessorState.STOPPED

        proc.reset()
        assert proc.state == ProcessorState.IDLE

    def test_concurrent_packet_processing_thread_safe(self):
        cfg = HardwareWindowProcessorConfig(
            window_seconds=0.5,
            expected_node_ids=["node_1", "node_2", "node_3", "node_4"],
            require_all_nodes=False,
        )
        proc = HardwareWindowProcessor(config=cfg)
        proc.start_session(mode=ProcessorState.MONITORING, start_monotonic=0.0)

        # Concurrently feed packets from 4 separate threads
        def worker(nid: str):
            for seq in range(1, 101):
                t = seq * 0.005
                proc.process_packet(make_packet(nid, seq=seq, monotonic_time=t))

        threads = [threading.Thread(target=worker, args=(f"node_{i}",)) for i in range(1, 5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        proc.advance_time(1.0)
        status = proc.get_status()
        assert status["total_completed_windows"] == 2


# =============================================================================
# 9. Real Localhost UDP Integration with Receiver and Simulator
# =============================================================================

class TestLocalhostIntegrationPipeline:
    """Full pipeline: HardwareSimulator -> UDP Socket -> HardwareReceiver -> HardwareWindowProcessor."""

    def test_end_to_end_localhost_integration(self):
        # 1. Configure processor for single node with short 0.2s windows
        proc_cfg = HardwareWindowProcessorConfig(
            window_seconds=0.2,
            min_calibration_windows=3,
            expected_node_ids=["node_1"],
            require_all_nodes=False,
        )
        processor = HardwareWindowProcessor(config=proc_cfg)
        processor.start_calibration()

        # 2. Launch real HardwareReceiver on ephemeral port, piping packets into processor
        with HardwareReceiver(
            host="127.0.0.1",
            port=0,
            on_packet_received=processor.process_packet,
        ) as receiver:
            # 3. Launch simulator for node_1 at 25 Hz for 0.8s
            sim_node = SimulatedNodeConfig(
                node_id="node_1",
                normal_rate_hz=25.0,
                random_seed=42,
            )
            sim = HardwareSimulator(
                destination_host="127.0.0.1",
                destination_port=receiver.port,
                nodes=[sim_node],
                duration_seconds=0.8,
            )

            with sim:
                time.sleep(0.85)

            # 4. Finalize calibration on real received data
            cal_res = processor.finalize_calibration()
            assert cal_res.eligible_windows_count >= 3
            assert processor.is_calibrated is True
            assert processor.state == ProcessorState.MONITORING
            assert processor.baseline_expected_count is not None
            assert processor.baseline_expected_count > 0.0

            # 5. Stop processor session
            processor.stop_session()
            assert processor.state == ProcessorState.STOPPED

            status = processor.get_status()
            assert status["total_completed_windows"] >= 3
            assert status["total_observed_arrivals"] > 10


# =============================================================================
# 10. Phase 4.1 Statistical Correctness & Liveness Isolation Tests
# =============================================================================

class TestZeroArrivalLivenessAndStatisticalCorrectness:
    """Validates that legitimate Poisson zero-arrival windows do not bias baseline calibration."""

    def test_healthy_node_zero_arrival_window_eligible_for_calibration(self):
        """A complete window with 0 datagrams from an active node remains eligible for calibration."""
        cfg = HardwareWindowProcessorConfig(
            window_seconds=1.0,
            expected_node_ids=["node_1", "node_2", "node_3", "node_4"],
            require_all_nodes=True,
            stale_node_timeout_seconds=5.0,
            min_calibration_windows=2,
        )
        proc = HardwareWindowProcessor(config=cfg)
        # All 4 nodes active at T=0.0
        proc.start_calibration(
            start_monotonic=0.0,
            initial_active_nodes=["node_1", "node_2", "node_3", "node_4"],
        )

        # Window 0: node_1, node_2, node_3 send 1 packet each; node_4 has 0 arrivals
        proc.process_packet(make_packet("node_1", seq=1, monotonic_time=0.2))
        proc.process_packet(make_packet("node_2", seq=1, monotonic_time=0.4))
        proc.process_packet(make_packet("node_3", seq=1, monotonic_time=0.6))

        proc.advance_time(1.0)
        windows = proc.get_windows()
        assert len(windows) == 1
        w0 = windows[0]

        assert w0.aggregate_count == 3
        assert w0.node_counts == {"node_1": 1, "node_2": 1, "node_3": 1, "node_4": 0}
        assert w0.node_liveness["node_4"] == "active"
        assert w0.quality == WindowQuality.COMPLETE_CLEAN
        assert w0.is_calibration_eligible is True
        assert w0.ineligibility_reason is None

    def test_zero_count_window_not_classified_as_missing_nodes(self):
        """A completely silent window (0 arrivals from all nodes) is not missing-nodes if nodes are active."""
        cfg = HardwareWindowProcessorConfig(
            window_seconds=1.0,
            expected_node_ids=["node_1"],
            require_all_nodes=True,
            stale_node_timeout_seconds=5.0,
            min_calibration_windows=1,
        )
        proc = HardwareWindowProcessor(config=cfg)
        proc.start_calibration(start_monotonic=0.0, initial_active_nodes=["node_1"])

        # Advance time by 1.0s without any incoming packets (0 arrivals)
        proc.advance_time(1.0)
        w0 = proc.get_windows()[0]

        assert w0.aggregate_count == 0
        assert w0.node_counts["node_1"] == 0
        assert w0.node_liveness["node_1"] == "active"
        assert w0.quality == WindowQuality.COMPLETE_CLEAN
        assert w0.is_calibration_eligible is True

    def test_consecutive_zero_arrival_windows_do_not_disconnect_node(self):
        """Several consecutive windows with zero arrivals do not cause disconnection if within timeout."""
        cfg = HardwareWindowProcessorConfig(
            window_seconds=0.5,
            expected_node_ids=["node_1"],
            require_all_nodes=True,
            stale_node_timeout_seconds=3.0,
            min_calibration_windows=4,
        )
        proc = HardwareWindowProcessor(config=cfg)
        proc.start_calibration(start_monotonic=0.0)

        # Node sends a packet in window 0 at T=0.1s
        proc.process_packet(make_packet("node_1", seq=1, monotonic_time=0.1))
        proc.advance_time(0.5)  # Window 0 [0.0, 0.5)

        # Windows 1, 2, 3, 4 (spanning T=0.5s to T=2.5s) receive 0 packets
        # Elapsed since last arrival: 2.5 - 0.1 = 2.4s <= 3.0s (stale timeout)
        proc.advance_time(2.5)

        windows = proc.get_windows()
        assert len(windows) == 5
        for w in windows:
            assert w.quality == WindowQuality.COMPLETE_CLEAN
            assert w.is_calibration_eligible is True
            assert w.node_liveness["node_1"] == "active"

        # Calibration successfully aggregates counts [1, 0, 0, 0, 0]
        cal_res = proc.finalize_calibration(current_monotonic=2.5)
        assert cal_res.eligible_windows_count == 5
        assert cal_res.expected_count_per_window == 0.2  # 1 / 5 = 0.2

    def test_silent_node_exceeding_timeout_marked_stale(self):
        """A node silent beyond stale_node_timeout_seconds is marked stale and excluded from calibration."""
        cfg = HardwareWindowProcessorConfig(
            window_seconds=1.0,
            expected_node_ids=["node_1", "node_2"],
            require_all_nodes=True,
            stale_node_timeout_seconds=2.0,
            min_calibration_windows=2,
        )
        proc = HardwareWindowProcessor(config=cfg)
        proc.start_calibration(start_monotonic=0.0, initial_active_nodes=["node_1", "node_2"])

        # Node 1 sends constantly, Node 2 sends only at T=0.1s then dies
        proc.process_packet(make_packet("node_1", seq=1, monotonic_time=0.1))
        proc.process_packet(make_packet("node_2", seq=1, monotonic_time=0.1))
        proc.advance_time(1.0)  # Window 0: clean

        proc.process_packet(make_packet("node_1", seq=2, monotonic_time=1.2))
        proc.advance_time(2.0)  # Window 1: Node 2 silent for 1.9s <= 2.0s: still clean

        proc.process_packet(make_packet("node_1", seq=3, monotonic_time=2.2))
        proc.advance_time(3.0)  # Window 2: Node 2 silent for 2.9s > 2.0s: STALE!

        windows = proc.get_windows()
        assert len(windows) == 3
        assert windows[0].quality == WindowQuality.COMPLETE_CLEAN
        assert windows[0].is_calibration_eligible is True

        assert windows[1].quality == WindowQuality.COMPLETE_CLEAN
        assert windows[1].is_calibration_eligible is True

        w2 = windows[2]
        assert w2.quality == WindowQuality.MISSING_NODES
        assert w2.is_calibration_eligible is False
        assert w2.node_liveness["node_2"] == "stale"
        assert w2.node_liveness["node_1"] == "active"
        assert "Expected node(s) unobserved or stale: ['node_2']" in str(w2.ineligibility_reason)

    def test_legitimate_zeros_included_in_baseline_mean(self):
        """Validates that zeros are mathematically included in baseline mean calculation."""
        cfg = HardwareWindowProcessorConfig(
            window_seconds=1.0,
            expected_node_ids=["node_1"],
            require_all_nodes=True,
            stale_node_timeout_seconds=5.0,
            min_calibration_windows=5,
        )
        proc = HardwareWindowProcessor(config=cfg)
        proc.start_calibration(start_monotonic=0.0, initial_active_nodes=["node_1"])

        # Window sequence: [4, 0, 4, 0, 2] -> sum = 10, N = 5 -> mean = 2.0
        # If zeros were filtered out: mean of [4, 4, 2] would be 10/3 = 3.333
        seq = 1
        # Window 0: 4 arrivals
        for _ in range(4):
            proc.process_packet(make_packet("node_1", seq=seq, monotonic_time=0.1))
            seq += 1
        proc.advance_time(1.0)

        # Window 1: 0 arrivals
        proc.advance_time(2.0)

        # Window 2: 4 arrivals
        for _ in range(4):
            proc.process_packet(make_packet("node_1", seq=seq, monotonic_time=2.1))
            seq += 1
        proc.advance_time(3.0)

        # Window 3: 0 arrivals
        proc.advance_time(4.0)

        # Window 4: 2 arrivals
        for _ in range(2):
            proc.process_packet(make_packet("node_1", seq=seq, monotonic_time=4.1))
            seq += 1
        proc.advance_time(5.0)

        cal_res = proc.finalize_calibration(current_monotonic=5.0)
        assert cal_res.eligible_windows_count == 5
        # Must be exactly 2.0, proving zeros are fully included
        assert cal_res.expected_count_per_window == 2.0
        assert cal_res.rate_per_second == 2.0


# =============================================================================
# 11. Statistical Regression Test (Four Nodes, 0.2s Windows, Natural Poisson Zeros)
# =============================================================================

class TestFourNodeZeroArrivalStatisticalRegression:
    """Section 8 regression test: 4 nodes, expected rate 5 Hz each, window 0.2s.

    Demonstrates that natural zero arrivals from healthy nodes do not bias calibration.
    """

    def test_four_node_zero_arrival_calibration_unbiased(self):
        """Construct 10 complete 0.2s windows for 4 nodes where 7 of 10 windows contain

        at least one node with zero arrivals. Verify that all 10 windows are eligible
        and that the baseline mean equals the true aggregate expectation (4.0).
        """
        cfg = HardwareWindowProcessorConfig(
            window_seconds=0.2,
            expected_node_ids=["node_1", "node_2", "node_3", "node_4"],
            require_all_nodes=True,
            stale_node_timeout_seconds=5.0,
            min_calibration_windows=10,
        )
        proc = HardwareWindowProcessor(config=cfg)
        proc.start_calibration(
            start_monotonic=0.0,
            initial_active_nodes=["node_1", "node_2", "node_3", "node_4"],
        )

        # Planned counts per window across [node_1, node_2, node_3, node_4]:
        # Each window totals 4 arrivals (matching lambda_window = 4 * (5 * 0.2) = 4.0)
        # Windows 1, 2, 3, 4, 5, 7, 8 have one or more nodes with ZERO arrivals!
        window_counts = [
            (1, 1, 1, 1),  # Win 0: sum=4 (all positive)
            (1, 2, 1, 0),  # Win 1: sum=4 (node_4 has 0 arrivals!)
            (0, 1, 2, 1),  # Win 2: sum=4 (node_1 has 0 arrivals!)
            (1, 0, 1, 2),  # Win 3: sum=4 (node_2 has 0 arrivals!)
            (2, 1, 0, 1),  # Win 4: sum=4 (node_3 has 0 arrivals!)
            (0, 0, 2, 2),  # Win 5: sum=4 (node_1 and node_2 have 0 arrivals!)
            (1, 1, 1, 1),  # Win 6: sum=4 (all positive)
            (0, 2, 0, 2),  # Win 7: sum=4 (node_1 and node_3 have 0 arrivals!)
            (2, 0, 2, 0),  # Win 8: sum=4 (node_2 and node_4 have 0 arrivals!)
            (1, 1, 1, 1),  # Win 9: sum=4 (all positive)
        ]

        seqs = {"node_1": 1, "node_2": 1, "node_3": 1, "node_4": 1}
        node_ids = ["node_1", "node_2", "node_3", "node_4"]

        for win_idx, counts in enumerate(window_counts):
            t_base = win_idx * 0.2
            for nid_idx, cnt in enumerate(counts):
                nid = node_ids[nid_idx]
                for k in range(cnt):
                    t = t_base + 0.02 + (k * 0.03)
                    proc.process_packet(make_packet(nid, seq=seqs[nid], monotonic_time=t, mode="normal"))
                    seqs[nid] += 1
            proc.advance_time(t_base + 0.2)

        windows = proc.get_windows()
        assert len(windows) == 10

        # CRITICAL VERIFICATION: Not a single window was rejected for having 0 arrivals!
        for idx, w in enumerate(windows):
            assert w.quality == WindowQuality.COMPLETE_CLEAN, f"Window {idx} had quality {w.quality}"
            assert w.is_calibration_eligible is True, f"Window {idx} marked ineligible: {w.ineligibility_reason}"
            assert w.aggregate_count == 4

        # Finalize calibration
        cal_res = proc.finalize_calibration(current_monotonic=2.0)
        assert cal_res.eligible_windows_count == 10
        assert cal_res.excluded_windows_count == 0

        # Mathematically exact baseline: 40 / 10 = 4.0 arrivals per window
        assert cal_res.expected_count_per_window == 4.0
        # Equivalent rate per second: 4.0 / 0.2 = 20.0 events/sec
        assert cal_res.rate_per_second == 20.0

