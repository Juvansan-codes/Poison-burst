"""
PoissonBurst Lab - Hardware Session Manager Service.

Orchestrates the lifecycle of the HardwareReceiver and HardwareWindowProcessor components,
coordinating single-session execution, thread safety, calibration transitions, real-time
status inspection, live window retrieval, and clean socket release.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.core.hardware_schemas import (
    HardwareCalibrationFinalizeResponse,
    HardwareLiveWindowsResponse,
    HardwareStartRequest,
    HardwareStartResponse,
    HardwareStatusResponse,
    HardwareStopResponse,
    HardwareWindowSchema,
)
from app.services.hardware_receiver import HardwareReceiver
from app.services.hardware_window_processor import (
    HardwareWindowProcessor,
    HardwareWindowProcessorConfig,
    ProcessorState,
)
from app.services.experiment_repository import get_experiment_repository

logger = logging.getLogger(__name__)


# =============================================================================
# Custom Hardware Session Exceptions
# =============================================================================

class HardwareSessionError(Exception):
    """Base exception for hardware session manager errors."""
    pass


class ConflictingOperationError(HardwareSessionError):
    """Raised when an operation conflicts with the current session state."""
    pass


class NoActiveSessionError(HardwareSessionError):
    """Raised when an operation requires an active session, but none exists."""
    pass


class InsufficientCalibrationDataError(HardwareSessionError):
    """Raised when calibration finalization fails due to insufficient eligible data."""
    pass


class ReceiverStartupError(HardwareSessionError):
    """Raised when the HardwareReceiver fails to bind or initialize socket."""
    pass


# =============================================================================
# Hardware Session Manager Service
# =============================================================================

class HardwareSessionManager:
    """Coordinates HardwareReceiver and HardwareWindowProcessor lifecycle for the application."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._session_id: Optional[str] = None
        self._receiver: Optional[HardwareReceiver] = None
        self._processor: Optional[HardwareWindowProcessor] = None
        self._config: Optional[HardwareStartRequest] = None
        self._started_at_utc: Optional[str] = None
        self._last_error: Optional[str] = None
        self._last_summary: Optional[HardwareStopResponse] = None
        self._stopped_sessions: Dict[str, Dict[str, Any]] = {}

    @property
    def session_id(self) -> Optional[str]:
        with self._lock:
            return self._session_id

    @property
    def is_active(self) -> bool:
        with self._lock:
            if not self._processor or not self._receiver:
                return False
            return self._processor.state in (ProcessorState.CALIBRATING, ProcessorState.MONITORING)

    def start_session(self, req: HardwareStartRequest) -> HardwareStartResponse:
        """Start a new hardware receiving and processing session."""
        with self._lock:
            # Check for existing active session
            if self.is_active:
                raise ConflictingOperationError(
                    f"A hardware session ({self._session_id}) is already active. "
                    "Stop the current session before starting a new one."
                )

            # Clean up any leftover stopped resources
            self._cleanup_resources_locked()

            session_id = str(uuid.uuid4())
            now_utc = datetime.now(timezone.utc).isoformat()
            self._last_error = None
            self._last_summary = None

            # 1. Initialize processor with requested statistical settings
            proc_config = HardwareWindowProcessorConfig(
                window_seconds=req.window_seconds,
                expected_node_ids=req.expected_nodes,
                min_calibration_windows=req.min_calibration_windows,
                alpha=req.alpha,
                require_all_nodes=req.require_all_nodes,
                stale_node_timeout_seconds=req.stale_node_timeout_seconds,
            )
            processor = HardwareWindowProcessor(config=proc_config, experiment_id=session_id)
            processor.start_calibration()

            # 2. Initialize receiver and wire packet callback to processor
            receiver = HardwareReceiver(
                host=req.bind_host,
                port=req.bind_port,
                on_packet_received=processor.process_packet,
            )

            # 3. Start receiver socket listener
            try:
                receiver.start()
            except Exception as err:
                logger.error(f"Failed to start hardware receiver on {req.bind_host}:{req.bind_port}: {err}")
                # Ensure complete rollback on receiver startup failure
                try:
                    receiver.stop()
                except Exception:
                    pass
                try:
                    processor.stop_session()
                except Exception:
                    pass
                self._last_error = str(err)
                self._cleanup_resources_locked()
                raise ReceiverStartupError(
                    f"Failed to bind UDP socket on {req.bind_host}:{req.bind_port}: {err}"
                ) from err

            # 4. Commit session state
            self._session_id = session_id
            self._receiver = receiver
            self._processor = processor
            self._config = req
            self._started_at_utc = now_utc

            actual_port = receiver.port
            logger.info(
                f"Hardware session {session_id} started successfully on {req.bind_host}:{actual_port} "
                f"(window={req.window_seconds}s, alpha={req.alpha})"
            )

            return HardwareStartResponse(
                session_id=session_id,
                state=processor.state.value,
                bind_host=req.bind_host,
                bind_port=actual_port,
                window_seconds=req.window_seconds,
                alpha=req.alpha,
                expected_nodes=list(req.expected_nodes),
                min_calibration_windows=req.min_calibration_windows,
                stale_node_timeout_seconds=req.stale_node_timeout_seconds,
                require_all_nodes=req.require_all_nodes,
                started_at_utc=now_utc,
                message=f"Hardware session started on {req.bind_host}:{actual_port}. Collecting baseline calibration.",
            )

    def finalize_calibration(self) -> HardwareCalibrationFinalizeResponse:
        """Explicitly finalize the baseline calibration period."""
        with self._lock:
            if not self.is_active or not self._processor or not self._session_id:
                raise NoActiveSessionError("No active hardware session available to calibrate.")

            if self._processor.state != ProcessorState.CALIBRATING:
                raise ConflictingOperationError(
                    f"Cannot finalize calibration: session is currently in state {self._processor.state.value}, "
                    "expected CALIBRATING."
                )

            try:
                cal_res = self._processor.finalize_calibration()
            except ValueError as val_err:
                logger.warning(f"Calibration finalization rejected: {val_err}")
                self._last_error = str(val_err)
                raise InsufficientCalibrationDataError(str(val_err)) from val_err

            return HardwareCalibrationFinalizeResponse(
                session_id=self._session_id,
                state=self._processor.state.value,
                eligible_windows_count=cal_res.eligible_windows_count,
                excluded_windows_count=cal_res.excluded_windows_count,
                exclusion_reasons=cal_res.exclusion_reasons,
                expected_count_per_window=cal_res.expected_count_per_window,
                rate_per_second=cal_res.rate_per_second,
                window_seconds=cal_res.window_seconds,
                alpha=cal_res.alpha,
                calibrated_at_utc=cal_res.calibrated_at_utc,
            )

    def get_status(self) -> HardwareStatusResponse:
        """Return comprehensive status snapshot of receiver and processor."""
        with self._lock:
            if not self._processor or not self._receiver or not self._session_id:
                return HardwareStatusResponse(
                    has_active_session=False,
                    session_id=None,
                    state="IDLE",
                    receiver_running=False,
                    last_error=self._last_error,
                )

            # In a real-time session, advance timeline to close any due windows
            if self._processor.session_start_monotonic is not None and self._processor.session_start_monotonic > 1000.0:
                self._processor.advance_time(time.monotonic())

            rec_status = self._receiver.get_status()
            proc_status = self._processor.get_status()

            # Format per-node details
            node_counts = {nid: n["valid_packets_count"] for nid, n in rec_status["nodes"].items()}
            node_last_seen = {nid: n["last_receipt_time_utc"] for nid, n in rec_status["nodes"].items()}
            node_gaps = {nid: n["sequence_gaps_count"] for nid, n in rec_status["nodes"].items()}
            node_duplicates = {nid: n["duplicate_or_reordered_count"] for nid, n in rec_status["nodes"].items()}
            node_boot_ids = {nid: n.get("active_boot_id") for nid, n in rec_status["nodes"].items()}
            node_boot_transitions = {nid: n.get("boot_transitions_count", 0) for nid, n in rec_status["nodes"].items()}

            return HardwareStatusResponse(
                has_active_session=self.is_active,
                session_id=self._session_id,
                state=proc_status["state"],
                receiver_running=rec_status["is_running"],
                bind_host=rec_status["bind_host"],
                bind_port=rec_status["bind_port"],
                total_socket_datagrams=rec_status["total_socket_datagrams"],
                valid_datagrams=rec_status["valid_datagrams"],
                malformed_datagrams=rec_status["malformed_datagrams"],
                unique_datagrams=rec_status["unique_datagrams"],
                node_liveness=proc_status.get("node_liveness", {}),
                node_last_seen_utc=node_last_seen,
                node_counts=node_counts,
                node_gaps=node_gaps,
                node_duplicates=node_duplicates,
                node_boot_ids=node_boot_ids,
                node_boot_transitions=node_boot_transitions,
                calibration_windows_count=proc_status["calibration_windows_count"],
                completed_windows_count=proc_status["total_completed_windows"],
                burst_windows_count=proc_status["burst_windows_count"],
                is_calibrated=proc_status["is_calibrated"],
                baseline_expected_count=proc_status["baseline_expected_count"],
                baseline_rate_per_second=proc_status["baseline_rate_per_second"],
                last_error=self._last_error,
            )

    def get_live_windows(
        self,
        limit: int = 50,
        after_window_index: Optional[int] = None,
    ) -> HardwareLiveWindowsResponse:
        """Retrieve recent observation windows."""
        with self._lock:
            if not self._processor or not self._session_id:
                return HardwareLiveWindowsResponse(
                    session_id=None,
                    state="IDLE",
                    total_windows=0,
                    returned_windows_count=0,
                    windows=[],
                )

            # In a real-time session, advance timeline to close any due windows
            if self._processor.session_start_monotonic is not None and self._processor.session_start_monotonic > 1000.0:
                self._processor.advance_time(time.monotonic())

            all_completed = self._processor.get_windows(include_partial=False)
            total_windows = len(all_completed)

            # Filter by after_window_index if provided
            if after_window_index is not None:
                filtered = [w for w in all_completed if w.window_index > after_window_index]
            else:
                filtered = list(all_completed)

            # Bounded slice
            sliced = filtered[-limit:] if after_window_index is None else filtered[:limit]

            schemas = []
            for w in sliced:
                schemas.append(
                    HardwareWindowSchema(
                        window_index=w.window_index,
                        start_time_monotonic=w.start_time_monotonic,
                        end_time_monotonic=w.end_time_monotonic,
                        start_time_utc=w.start_time_utc,
                        end_time_utc=w.end_time_utc,
                        duration_seconds=w.duration_seconds,
                        aggregate_count=w.aggregate_count,
                        node_counts=w.node_counts,
                        node_modes=w.node_modes,
                        node_liveness=w.node_liveness,
                        node_boot_ids=getattr(w, "node_boot_ids", {}),
                        is_complete=w.is_complete,
                        is_partial=w.is_partial,
                        quality=w.quality.value,
                        is_calibration=w.is_calibration,
                        is_calibration_eligible=w.is_calibration_eligible,
                        ineligibility_reason=w.ineligibility_reason,
                        expected_baseline_count=w.expected_baseline_count,
                        p_value=w.p_value,
                        is_burst=w.is_burst,
                        alpha=w.alpha,
                        detection_status=w.detection_status.value,
                        detection_unavailable_reason=w.detection_unavailable_reason,
                    )
                )

            return HardwareLiveWindowsResponse(
                session_id=self._session_id,
                state=self._processor.state.value,
                total_windows=total_windows,
                returned_windows_count=len(schemas),
                windows=schemas,
            )

    def stop_session(self) -> HardwareStopResponse:
        """Cleanly terminate the active hardware session and persist experiment to SQLite."""
        with self._lock:
            # 1. Idempotency: if no active session, but a stopped session summary exists, return it
            if not self.is_active or not self._processor or not self._receiver or not self._session_id:
                if self._last_summary:
                    logger.info(f"Returning cached summary for stopped session {self._last_summary.session_id} (idempotent stop).")
                    return self._last_summary
                raise NoActiveSessionError("No active hardware session to stop.")

            session_id = self._session_id
            config_dict = self._config.model_dump() if self._config else {}

            # 2. Stop receiver socket listener first (guaranteed stopped)
            try:
                self._receiver.stop()
            except Exception as err:
                logger.error(f"Error stopping receiver: {err}")

            # 3. Stop processor and finalize partial window
            try:
                self._processor.stop_session()
            except Exception as err:
                logger.error(f"Error stopping processor: {err}")

            # 4. Gather final summary stats
            rec_status = self._receiver.get_status()
            proc_status = self._processor.get_status()
            completed_windows = self._processor.get_windows(include_partial=False)

            total_valid = rec_status["valid_datagrams"]
            unique_valid = rec_status.get("unique_datagrams", total_valid)
            dup_valid = total_valid - unique_valid if total_valid >= unique_valid else 0
            pw_data = proc_status.get("partial_window")
            pw_datagrams = pw_data.get("aggregate_count", 0) if pw_data else 0
            node_counts = {nid: n["valid_packets_count"] for nid, n in rec_status["nodes"].items()}
            burst_count = sum(1 for w in completed_windows if w.is_burst is True)
            unavail_count = sum(
                1 for w in completed_windows if w.detection_status.value == "unavailable"
            )
            has_partial = proc_status["partial_window"] is not None

            # 5. Build preliminary summary response
            summary = HardwareStopResponse(
                session_id=session_id,
                final_state="STOPPED",
                total_valid_datagrams=total_valid,
                unique_datagrams=unique_valid,
                duplicate_datagrams=dup_valid,
                partial_window_datagrams=pw_datagrams,
                node_counts=node_counts,
                completed_windows_count=len(completed_windows),
                partial_windows_count=1 if has_partial else 0,
                burst_detections_count=burst_count,
                unavailable_detections_count=unavail_count,
                is_calibrated=proc_status["is_calibrated"],
                baseline_expected_count=proc_status["baseline_expected_count"],
                clean_shutdown=True,
                message=f"Hardware session {session_id} stopped cleanly.",
                experiment_id=None,
                persisted=False,
                persistence_error=None,
            )

            # 6. Attempt SQLite persistence via ExperimentRepository
            try:
                repo = get_experiment_repository()
                exp_summary = repo.save_hardware_experiment(
                    session_id=session_id,
                    config=config_dict,
                    summary=summary,
                    windows=completed_windows,
                    rec_status=rec_status,
                    proc_status=proc_status,
                )
                summary.persisted = True
                summary.experiment_id = exp_summary.experiment_id
                summary.message = f"Hardware session {session_id} stopped cleanly and saved to SQLite."
                logger.info(f"Hardware session {session_id} successfully persisted to SQLite as experiment '{exp_summary.experiment_id}'.")
            except Exception as persist_err:
                logger.error(f"Database error persisting hardware session {session_id}: {persist_err}", exc_info=True)
                summary.persisted = False
                summary.persistence_error = f"Database persistence failed: {type(persist_err).__name__}"
                summary.message = (
                    f"Hardware session {session_id} stopped cleanly, but database persistence failed. "
                    "Session observations are preserved in memory for retry."
                )

            # 7. Preserve finalized session data in memory for retries & caching
            self._stopped_sessions[session_id] = {
                "session_id": session_id,
                "config": config_dict,
                "summary": summary,
                "windows": completed_windows,
                "rec_status": rec_status,
                "proc_status": proc_status,
            }
            self._last_summary = summary

            # 8. Clean up active socket listener and processor references
            self._cleanup_resources_locked()

            return summary

    def retry_persistence(self, session_id: Optional[str] = None) -> HardwareStopResponse:
        """Retry persisting a stopped hardware session whose previous save failed."""
        with self._lock:
            target_id = session_id or (self._last_summary.session_id if self._last_summary else None)
            if not target_id or target_id not in self._stopped_sessions:
                raise NoActiveSessionError(f"No stopped session data available for session ID '{target_id}'.")

            session_data = self._stopped_sessions[target_id]
            summary: HardwareStopResponse = session_data["summary"]

            # If already persisted, return summary directly
            if summary.persisted and summary.experiment_id:
                return summary

            try:
                repo = get_experiment_repository()
                exp_summary = repo.save_hardware_experiment(
                    session_id=target_id,
                    config=session_data["config"],
                    summary=summary,
                    windows=session_data["windows"],
                    rec_status=session_data["rec_status"],
                    proc_status=session_data["proc_status"],
                )
                summary.persisted = True
                summary.experiment_id = exp_summary.experiment_id
                summary.persistence_error = None
                summary.message = f"Hardware session {target_id} successfully persisted to SQLite on retry."
                self._last_summary = summary
                logger.info(f"Hardware session {target_id} successfully persisted to SQLite on retry.")
                return summary
            except Exception as err:
                logger.error(f"Retry persistence failed for hardware session {target_id}: {err}", exc_info=True)
                summary.persisted = False
                summary.persistence_error = f"Retry failed: {type(err).__name__}"
                self._last_summary = summary
                return summary

    def shutdown(self) -> None:
        """Application shutdown hook to clean up all background threads and sockets."""
        with self._lock:
            if self.is_active:
                logger.info("FastAPI shutdown detected. Cleaning up active hardware session...")
                try:
                    self.stop_session()
                except Exception as err:
                    logger.debug(f"Exception during shutdown cleanup: {err}")
            self._cleanup_resources_locked()
            self._last_summary = None
            self._stopped_sessions.clear()

    def _cleanup_resources_locked(self) -> None:
        """Internal helper to release receiver and processor references."""
        if self._receiver:
            try:
                self._receiver.stop()
            except Exception:
                pass
            self._receiver = None

        if self._processor:
            try:
                self._processor.stop_session()
            except Exception:
                pass
            self._processor = None

        self._session_id = None
        self._config = None


# Global singleton instance
_session_manager: Optional[HardwareSessionManager] = None
_manager_lock = threading.Lock()


def get_hardware_session_manager() -> HardwareSessionManager:
    """Return the global HardwareSessionManager singleton instance."""
    global _session_manager
    with _manager_lock:
        if _session_manager is None:
            _session_manager = HardwareSessionManager()
        return _session_manager
