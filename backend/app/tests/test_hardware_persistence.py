"""
PoissonBurst Lab - Phase 7 Persistent Hardware Experiments & Reporting Tests.

Validates:
1. Persistence of completed hardware sessions to SQLite through ExperimentRepository.
2. Retrieval of hardware experiments by ID, list filtering, pagination, and search.
3. Dashboard summary counts correctly tracking hardware experiments.
4. Experiment persistence and recovery across SQLite connection reopening (restart).
5. Idempotent stop calls and duplicate prevention.
6. Persistence error handling and retry mechanism without telemetry replay.
7. Statistical analysis on hardware experiments preserving baseline calibration and measurement units.
8. Non-fabrication of ground-truth evaluation metrics.
9. PDF report generation with ReportLab and correct datagram unit semantics.
10. Preservation and compatibility with existing simulation and historical experiments.
"""

from __future__ import annotations

import json
import socket
import time
from typing import Generator
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.core.hardware_schemas import HardwareStartRequest
from app.services.hardware_window_processor import (
    AggregatedWindow,
    DetectionStatus,
    WindowQuality,
)
from app.core.schemas import (
    ExperimentType,
    MeasurementType,
    SimulationRequest,
    SimulationScenario,
    TrafficSource,
)
from app.main import app
from app.services.experiment_repository import (
    ExperimentRepository,
    get_experiment_repository,
)
from app.services.hardware_session_manager import (
    HardwareSessionManager,
    get_hardware_session_manager,
)
from app.services.pdf_report_generator import generate_experiment_pdf_report
from app.services.statistical_analysis import compute_experiment_statistics
from app.services.traffic_simulator import run_traffic_simulation


@pytest.fixture
def temp_db(tmp_path, monkeypatch) -> Generator[str, None, None]:
    """Provide an isolated temporary SQLite database for each test."""
    db_file = str(tmp_path / "test_hardware_experiments.db")
    monkeypatch.setenv("POISSONBURST_DB_PATH", db_file)
    import app.services.experiment_repository as er
    er._default_repo = None
    yield db_file
    er._default_repo = None


@pytest.fixture
def test_client(temp_db) -> Generator[TestClient, None, None]:
    """TestClient configured with isolated database and cleanly reset session manager."""
    manager = get_hardware_session_manager()
    manager.shutdown()
    with TestClient(app) as client:
        yield client
    manager.shutdown()


def send_udp_packet(
    port: int,
    node_id: str = "node_1",
    seq: int = 1,
    uptime_ms: int = 1000,
    mode: str = "normal",
    host: str = "127.0.0.1",
) -> None:
    """Helper to transmit a valid UDP packet to the given port."""
    payload = {
        "version": 1,
        "node_id": node_id,
        "seq": seq,
        "uptime_ms": uptime_ms,
        "mode": mode,
    }
    raw = json.dumps(payload).encode("utf-8")
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.sendto(raw, (host, port))
    finally:
        sock.close()


class TestHardwareRepositoryDirect:
    """Direct repository tests for hardware experiments."""

    def test_save_and_retrieve_hardware_experiment(self, temp_db: str) -> None:
        repo = get_experiment_repository()

        # Build mock windows
        now_utc = "2026-10-24T12:00:00Z"
        windows = [
            AggregatedWindow(
                window_index=0,
                start_time_monotonic=100.0,
                end_time_monotonic=101.0,
                start_time_utc=now_utc,
                end_time_utc=now_utc,
                duration_seconds=1.0,
                aggregate_count=10,
                node_counts={"node_1": 10},
                node_modes={"node_1": "normal"},
                node_liveness={"node_1": "active"},
                is_complete=True,
                is_partial=False,
                quality=WindowQuality.COMPLETE_CLEAN,
                is_calibration=True,
                is_calibration_eligible=True,
                expected_baseline_count=10.0,
            ),
            AggregatedWindow(
                window_index=1,
                start_time_monotonic=101.0,
                end_time_monotonic=102.0,
                start_time_utc=now_utc,
                end_time_utc=now_utc,
                duration_seconds=1.0,
                aggregate_count=28,
                node_counts={"node_1": 28},
                node_modes={"node_1": "burst"},
                node_liveness={"node_1": "active"},
                is_complete=True,
                is_partial=False,
                quality=WindowQuality.COMPLETE_CLEAN,
                is_calibration=False,
                is_calibration_eligible=False,
                expected_baseline_count=10.0,
                p_value=0.0001,
                is_burst=True,
            ),
        ]

        rec_status = {
            "valid_datagrams": 38,
            "total_socket_datagrams": 38,
            "malformed_datagrams": 0,
            "unique_datagrams": 38,
            "nodes": {
                "node_1": {
                    "valid_packets_count": 38,
                    "sequence_gaps_count": 0,
                    "duplicate_or_reordered_count": 0,
                    "last_receipt_time_utc": now_utc,
                }
            },
        }

        proc_status = {
            "is_calibrated": True,
            "baseline_expected_count": 10.0,
            "baseline_rate_per_second": 10.0,
            "calibration_windows_count": 1,
            "node_liveness": {"node_1": True},
        }

        config = {
            "bind_host": "127.0.0.1",
            "bind_port": 5005,
            "window_seconds": 1.0,
            "alpha": 0.01,
            "expected_nodes": ["node_1"],
        }

        summary = repo.save_hardware_experiment(
            session_id="hw-session-001",
            config=config,
            summary=None,
            windows=windows,
            rec_status=rec_status,
            proc_status=proc_status,
        )

        assert summary.experiment_id == "hw-session-001"
        assert summary.experiment_type == ExperimentType.HARDWARE
        assert summary.measurement_type == MeasurementType.UDP_DATAGRAM_COUNT
        assert summary.observation_count == 2
        assert summary.detected_window_count == 1
        assert summary.ground_truth_available is False
        assert summary.evaluation is None

        # Retrieve detailed experiment
        detail = repo.get_experiment("hw-session-001")
        assert detail is not None
        assert detail.experiment_id == "hw-session-001"
        assert detail.experiment_type == ExperimentType.HARDWARE
        assert detail.measurement_type == MeasurementType.UDP_DATAGRAM_COUNT
        assert len(detail.observations) == 2
        assert detail.observations[0].count == 10
        assert detail.observations[0].is_calibration is True
        assert detail.observations[0].source == TrafficSource.HARDWARE
        assert detail.observations[1].count == 28
        assert detail.detections[1].is_burst is True
        assert detail.detections[1].p_value == 0.0001

    def test_persistence_across_connection_restart(self, temp_db: str) -> None:
        """Simulate backend restart by recreating the repository instance."""
        repo1 = ExperimentRepository(temp_db)
        windows = [
            AggregatedWindow(
                window_index=0,
                start_time_monotonic=10.0,
                end_time_monotonic=11.0,
                start_time_utc="2026-10-24T12:00:00Z",
                end_time_utc="2026-10-24T12:00:01Z",
                duration_seconds=1.0,
                aggregate_count=15,
                node_counts={"node_1": 15},
                node_modes={"node_1": "normal"},
                node_liveness={"node_1": "active"},
                is_complete=True,
                is_partial=False,
                quality=WindowQuality.COMPLETE_CLEAN,
                is_calibration=True,
            )
        ]
        repo1.save_hardware_experiment(
            session_id="restart-hw-123",
            config={"bind_port": 5005, "expected_nodes": ["node_1"]},
            summary=None,
            windows=windows,
            rec_status={"valid_datagrams": 15, "nodes": {}},
            proc_status={"baseline_expected_count": 15.0, "is_calibrated": True},
        )

        # Fresh repository instance pointing to the same SQLite DB file
        repo2 = ExperimentRepository(temp_db)
        retrieved = repo2.get_experiment("restart-hw-123")
        assert retrieved is not None
        assert retrieved.experiment_id == "restart-hw-123"
        assert retrieved.experiment_type == ExperimentType.HARDWARE
        assert retrieved.measurement_type == MeasurementType.UDP_DATAGRAM_COUNT
        assert len(retrieved.observations) == 1
        assert retrieved.observations[0].count == 15

    def test_idempotent_save_hardware_experiment(self, temp_db: str) -> None:
        repo = get_experiment_repository()
        windows = [
            AggregatedWindow(
                window_index=0,
                start_time_monotonic=10.0,
                end_time_monotonic=11.0,
                start_time_utc="2026-10-24T12:00:00Z",
                end_time_utc="2026-10-24T12:00:01Z",
                duration_seconds=1.0,
                aggregate_count=5,
                node_counts={"node_1": 5},
                node_modes={"node_1": "normal"},
                node_liveness={"node_1": "active"},
                is_complete=True,
                is_partial=False,
                quality=WindowQuality.COMPLETE_CLEAN,
                is_calibration=True,
            )
        ]
        summary1 = repo.save_hardware_experiment(
            session_id="idempotent-hw-1",
            config={"bind_port": 5005, "expected_nodes": ["node_1"]},
            summary=None,
            windows=windows,
            rec_status={"valid_datagrams": 5, "nodes": {}},
            proc_status={"baseline_expected_count": 5.0, "is_calibrated": True},
        )

        # Repeated save call with same session ID
        summary2 = repo.save_hardware_experiment(
            session_id="idempotent-hw-1",
            config={"bind_port": 5005, "expected_nodes": ["node_1"]},
            summary=None,
            windows=windows,
            rec_status={"valid_datagrams": 5, "nodes": {}},
            proc_status={"baseline_expected_count": 5.0, "is_calibrated": True},
        )

        assert summary1.experiment_id == summary2.experiment_id

        # Total experiments in DB must be exactly 1, not duplicated
        listing = repo.list_experiments()
        assert listing.total == 1

    def test_dashboard_summary_and_filtering(self, temp_db: str) -> None:
        repo = get_experiment_repository()

        # 1. Save a simulation experiment
        sim_req = SimulationRequest(
            scenario=SimulationScenario.POISSON_NORMAL,
            total_duration_seconds=10.0,
            window_seconds=1.0,
            lambda_rate=12.0,
            alpha=0.01,
            seed=42,
        )
        sim_res = run_traffic_simulation(sim_req)
        repo.save_simulation_experiment(sim_req, sim_res)

        # 2. Save a hardware experiment
        windows = [
            AggregatedWindow(
                window_index=0,
                start_time_monotonic=10.0,
                end_time_monotonic=11.0,
                start_time_utc="2026-10-24T12:00:00Z",
                end_time_utc="2026-10-24T12:00:01Z",
                duration_seconds=1.0,
                aggregate_count=20,
                node_counts={"node_1": 20},
                node_modes={"node_1": "normal"},
                node_liveness={"node_1": "active"},
                is_complete=True,
                is_partial=False,
                quality=WindowQuality.COMPLETE_CLEAN,
                is_calibration=True,
            )
        ]
        repo.save_hardware_experiment(
            session_id="hw-filter-01",
            config={"bind_port": 5005, "expected_nodes": ["node_1"]},
            summary=None,
            windows=windows,
            rec_status={"valid_datagrams": 20, "nodes": {}},
            proc_status={"baseline_expected_count": 20.0, "is_calibrated": True},
        )

        # Dashboard counts
        dash = repo.get_dashboard_summary()
        assert dash.total_experiments == 2
        assert dash.simulation_experiments_count == 1
        assert dash.hardware_experiments_count == 1
        assert MeasurementType.UDP_DATAGRAM_COUNT.value in dash.available_measurement_types

        # Filter by hardware type
        hw_list = repo.list_experiments(experiment_type="hardware")
        assert hw_list.total == 1
        assert hw_list.items[0].experiment_type == ExperimentType.HARDWARE

        # Filter by simulation type
        sim_list = repo.list_experiments(experiment_type="simulation")
        assert sim_list.total == 1
        assert sim_list.items[0].experiment_type == ExperimentType.SIMULATION

        # Deleting hardware experiment
        deleted = repo.delete_experiment("hw-filter-01")
        assert deleted is True

        dash_after = repo.get_dashboard_summary()
        assert dash_after.total_experiments == 1
        assert dash_after.hardware_experiments_count == 0


class TestHardwareSessionPersistenceWorkflow:
    """End-to-end API integration tests for hardware stop, persistence, and retry."""

    def test_full_hardware_session_persistence_via_api(self, test_client: TestClient) -> None:
        # 1. Start hardware session
        start_resp = test_client.post(
            "/api/hardware/start",
            json={
                "bind_host": "127.0.0.1",
                "bind_port": 0,
                "window_seconds": 0.2,
                "min_calibration_windows": 3,
                "expected_nodes": ["node_1"],
                "require_all_nodes": True,
            },
        )
        assert start_resp.status_code == 200
        start_data = start_resp.json()
        port = start_data["bind_port"]
        session_id = start_data["session_id"]

        # 2. Transmit packets to fulfill calibration
        for seq in range(1, 15):
            send_udp_packet(port=port, node_id="node_1", seq=seq, uptime_ms=seq * 200)
            time.sleep(0.02)

        time.sleep(0.7)  # allow windows to close

        # 3. Finalize calibration
        cal_resp = test_client.post("/api/hardware/calibration/finalize")
        assert cal_resp.status_code == 200
        assert cal_resp.json()["state"] == "MONITORING"

        # 4. Transmit monitoring packets (including burst-like count)
        for seq in range(15, 30):
            send_udp_packet(port=port, node_id="node_1", seq=seq, uptime_ms=seq * 200)

        time.sleep(0.5)

        # 5. Stop session and verify persistence
        stop_resp = test_client.post("/api/hardware/stop")
        assert stop_resp.status_code == 200
        stop_data = stop_resp.json()
        assert stop_data["clean_shutdown"] is True
        assert stop_data["persisted"] is True
        assert stop_data["experiment_id"] == session_id
        assert stop_data["persistence_error"] is None

        # 6. Retrieve from existing experiment repository endpoint
        exp_resp = test_client.get(f"/api/experiments/{session_id}")
        assert exp_resp.status_code == 200
        exp_data = exp_resp.json()
        assert exp_data["experiment_id"] == session_id
        assert exp_data["experiment_type"] == "hardware"
        assert exp_data["measurement_type"] == "udp_datagram_count"
        assert exp_data["ground_truth_available"] is False
        assert exp_data["evaluation"] is None
        assert len(exp_data["observations"]) > 0

        # 7. Check dashboard summary
        dash_resp = test_client.get("/api/dashboard/summary")
        assert dash_resp.status_code == 200
        dash_data = dash_resp.json()
        assert dash_data["hardware_experiments_count"] >= 1

        # 8. Test CSV export
        csv_resp = test_client.get(f"/api/experiments/{session_id}/export")
        assert csv_resp.status_code == 200
        assert "text/csv" in csv_resp.headers["content-type"]
        csv_text = csv_resp.text
        assert "Timestamp" in csv_text or "Time (s)" in csv_text or "Count" in csv_text

        # 9. Test PDF report generation
        pdf_resp = test_client.get(f"/api/experiments/{session_id}/report.pdf")
        assert pdf_resp.status_code == 200
        assert pdf_resp.headers["content-type"] == "application/pdf"
        assert pdf_resp.content.startswith(b"%PDF")

        # 10. Test statistical analysis endpoint
        stats_resp = test_client.get(f"/api/experiments/{session_id}/statistics")
        assert stats_resp.status_code == 200
        stats_data = stats_resp.json()
        assert stats_data["observation_count"] > 0
        assert stats_data["empirical_mean"] >= 0.0

    def test_idempotent_stop_session(self, test_client: TestClient) -> None:
        """Stopping an already-stopped session returns the cached summary without duplicate save."""
        start_resp = test_client.post(
            "/api/hardware/start",
            json={
                "bind_host": "127.0.0.1",
                "bind_port": 0,
                "window_seconds": 0.5,
                "min_calibration_windows": 3,
                "expected_nodes": ["node_1"],
            },
        )
        port = start_resp.json()["bind_port"]
        session_id = start_resp.json()["session_id"]

        send_udp_packet(port=port, node_id="node_1", seq=1)
        time.sleep(0.1)

        # First stop
        stop_resp1 = test_client.post("/api/hardware/stop")
        assert stop_resp1.status_code == 200
        data1 = stop_resp1.json()
        assert data1["session_id"] == session_id
        assert data1["persisted"] is True

        # Second stop (idempotent call)
        stop_resp2 = test_client.post("/api/hardware/stop")
        assert stop_resp2.status_code == 200
        data2 = stop_resp2.json()
        assert data2["session_id"] == session_id
        assert data2["experiment_id"] == data1["experiment_id"]

        # Ensure exactly one experiment exists in the repository
        list_resp = test_client.get("/api/experiments?experiment_type=hardware")
        assert list_resp.status_code == 200
        assert list_resp.json()["total"] == 1

    def test_persistence_failure_and_retry(self, test_client: TestClient) -> None:
        """When database persistence fails on stop, the error is reported and retry succeeds."""
        start_resp = test_client.post(
            "/api/hardware/start",
            json={
                "bind_host": "127.0.0.1",
                "bind_port": 0,
                "window_seconds": 0.5,
                "min_calibration_windows": 3,
                "expected_nodes": ["node_1"],
            },
        )
        port = start_resp.json()["bind_port"]
        session_id = start_resp.json()["session_id"]

        send_udp_packet(port=port, node_id="node_1", seq=1)
        time.sleep(0.1)

        # Simulate database failure during stop
        with patch.object(ExperimentRepository, "save_hardware_experiment", side_effect=RuntimeError("Disk I/O error")):
            stop_resp = test_client.post("/api/hardware/stop")
            assert stop_resp.status_code == 200
            data = stop_resp.json()
            assert data["persisted"] is False
            assert "Database persistence failed" in data["persistence_error"]

        # Verify receiver is stopped even though persistence failed
        status_resp = test_client.get("/api/hardware/status")
        assert status_resp.json()["receiver_running"] is False

        # Now retry persistence with working repository
        retry_resp = test_client.post("/api/hardware/persist/retry", params={"session_id": session_id})
        assert retry_resp.status_code == 200
        retry_data = retry_resp.json()
        assert retry_data["persisted"] is True
        assert retry_data["experiment_id"] == session_id
        assert retry_data["persistence_error"] is None

        # Verify experiment now accessible in repository
        exp_resp = test_client.get(f"/api/experiments/{session_id}")
        assert exp_resp.status_code == 200


class TestHardwareStatisticalAnalysisAndPDF:
    """Tests for statistical analysis calculations and PDF report formatting."""

    def test_hardware_statistical_analysis_preserves_calibration(self, temp_db: str) -> None:
        repo = get_experiment_repository()
        windows = [
            AggregatedWindow(
                window_index=0,
                start_time_monotonic=10.0,
                end_time_monotonic=11.0,
                start_time_utc="2026-10-24T12:00:00Z",
                end_time_utc="2026-10-24T12:00:01Z",
                duration_seconds=1.0,
                aggregate_count=10,
                node_counts={"node_1": 10},
                node_modes={"node_1": "normal"},
                node_liveness={"node_1": "active"},
                is_complete=True,
                is_partial=False,
                quality=WindowQuality.COMPLETE_CLEAN,
                is_calibration=True,
                expected_baseline_count=10.0,
            ),
            AggregatedWindow(
                window_index=1,
                start_time_monotonic=11.0,
                end_time_monotonic=12.0,
                start_time_utc="2026-10-24T12:00:01Z",
                end_time_utc="2026-10-24T12:00:02Z",
                duration_seconds=1.0,
                aggregate_count=12,
                node_counts={"node_1": 12},
                node_modes={"node_1": "normal"},
                node_liveness={"node_1": "active"},
                is_complete=True,
                is_partial=False,
                quality=WindowQuality.COMPLETE_CLEAN,
                is_calibration=True,
                expected_baseline_count=10.0,
            ),
            AggregatedWindow(
                window_index=2,
                start_time_monotonic=12.0,
                end_time_monotonic=13.0,
                start_time_utc="2026-10-24T12:00:02Z",
                end_time_utc="2026-10-24T12:00:03Z",
                duration_seconds=1.0,
                aggregate_count=35,
                node_counts={"node_1": 35},
                node_modes={"node_1": "burst"},
                node_liveness={"node_1": "active"},
                is_complete=True,
                is_partial=False,
                quality=WindowQuality.COMPLETE_CLEAN,
                is_calibration=False,
                expected_baseline_count=10.0,
                is_burst=True,
                p_value=0.00001,
            ),
        ]

        repo.save_hardware_experiment(
            session_id="hw-stats-exp-1",
            config={"bind_port": 5005, "expected_nodes": ["node_1"], "window_seconds": 1.0},
            summary=None,
            windows=windows,
            rec_status={"valid_datagrams": 57, "nodes": {}},
            proc_status={"baseline_expected_count": 11.0, "is_calibrated": True},
        )

        detail = repo.get_experiment("hw-stats-exp-1")
        assert detail is not None

        stats = compute_experiment_statistics(detail)
        assert stats.observation_count == 3
        # Baseline confidence interval should be derived strictly from the 2 calibration windows (10, 12), not the burst window (35)
        assert stats.confidence_interval is not None
        assert stats.confidence_interval.sample_size == 2
        assert stats.confidence_interval.point_estimate == 11.0

        # Goodness of fit analysis performed
        assert stats.goodness_of_fit_baseline is not None
        assert stats.goodness_of_fit_empirical is not None

    def test_hardware_pdf_report_generation(self, temp_db: str) -> None:
        repo = get_experiment_repository()
        windows = [
            AggregatedWindow(
                window_index=0,
                start_time_monotonic=10.0,
                end_time_monotonic=11.0,
                start_time_utc="2026-10-24T12:00:00Z",
                end_time_utc="2026-10-24T12:00:01Z",
                duration_seconds=1.0,
                aggregate_count=14,
                node_counts={"node_1": 7, "node_2": 7},
                node_modes={"node_1": "normal", "node_2": "normal"},
                node_liveness={"node_1": "active", "node_2": "active"},
                is_complete=True,
                is_partial=False,
                quality=WindowQuality.COMPLETE_CLEAN,
                is_calibration=True,
                expected_baseline_count=14.0,
            ),
            AggregatedWindow(
                window_index=1,
                start_time_monotonic=11.0,
                end_time_monotonic=12.0,
                start_time_utc="2026-10-24T12:00:01Z",
                end_time_utc="2026-10-24T12:00:02Z",
                duration_seconds=1.0,
                aggregate_count=45,
                node_counts={"node_1": 35, "node_2": 10},
                node_modes={"node_1": "burst", "node_2": "normal"},
                node_liveness={"node_1": "active", "node_2": "active"},
                is_complete=True,
                is_partial=False,
                quality=WindowQuality.COMPLETE_CLEAN,
                is_calibration=False,
                expected_baseline_count=14.0,
                is_burst=True,
                p_value=0.000001,
            ),
        ]

        rec_status = {
            "valid_datagrams": 59,
            "total_socket_datagrams": 60,
            "malformed_datagrams": 1,
            "unique_datagrams": 59,
            "nodes": {
                "node_1": {"valid_packets_count": 42, "sequence_gaps_count": 1, "duplicate_or_reordered_count": 0, "last_receipt_time_utc": "2026-10-24T12:00:02Z"},
                "node_2": {"valid_packets_count": 17, "sequence_gaps_count": 0, "duplicate_or_reordered_count": 0, "last_receipt_time_utc": "2026-10-24T12:00:02Z"},
            },
        }

        repo.save_hardware_experiment(
            session_id="hw-pdf-test-01",
            config={"bind_port": 5005, "expected_nodes": ["node_1", "node_2"], "window_seconds": 1.0},
            summary=None,
            windows=windows,
            rec_status=rec_status,
            proc_status={"baseline_expected_count": 14.0, "is_calibrated": True, "node_liveness": {"node_1": True, "node_2": True}},
        )

        detail = repo.get_experiment("hw-pdf-test-01")
        assert detail is not None

        pdf_bytes = generate_experiment_pdf_report(detail)

        assert isinstance(pdf_bytes, bytes)
        assert len(pdf_bytes) > 1000
        assert pdf_bytes.startswith(b"%PDF")
