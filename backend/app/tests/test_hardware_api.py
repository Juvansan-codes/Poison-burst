"""
PoissonBurst Lab - Hardware Session FastAPI Integration Tests.

Validates:
1. Hardware session lifecycle (start, status, calibrate, live polling, stop).
2. Ephemeral UDP port allocation and receiver bind reporting.
3. UDP datagram transmission from localhost to the API-managed receiver.
4. Error handling: conflicting operations, missing session, and insufficient calibration data.
5. Live window polling, limit slicing, and incremental after_window_index queries.
6. Statistical detector evaluation via live API.
7. Clean socket release and resource teardown.
"""

from __future__ import annotations

import json
import socket
import threading
import time
from typing import Generator
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.hardware_session_manager import get_hardware_session_manager

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_hardware_session() -> Generator[None, None, None]:
    """Ensure every test begins and ends with no active hardware session."""
    manager = get_hardware_session_manager()
    manager.shutdown()
    yield
    manager.shutdown()


def send_udp_datagram(
    port: int,
    node_id: str = "node_1",
    seq: int = 1,
    uptime_ms: int = 1000,
    mode: str = "normal",
    host: str = "127.0.0.1",
) -> None:
    """Helper to transmit a raw UDP datagram directly to the API-bound receiver port."""
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


# =============================================================================
# 1. Hardware Session Lifecycle Tests
# =============================================================================

class TestHardwareSessionLifecycle:
    """Tests for starting, inspecting, and stopping hardware sessions via REST."""

    def test_status_when_no_active_session(self):
        response = client.get("/api/hardware/status")
        assert response.status_code == 200
        data = response.json()
        assert data["has_active_session"] is False
        assert data["session_id"] is None
        assert data["state"] == "IDLE"
        assert data["receiver_running"] is False
        assert data["valid_datagrams"] == 0

    def test_start_session_ephemeral_port_success(self):
        payload = {
            "bind_host": "127.0.0.1",
            "bind_port": 0,  # OS allocates ephemeral port
            "window_seconds": 1.0,
            "alpha": 0.01,
            "expected_nodes": ["node_1", "node_2"],
            "min_calibration_windows": 3,
            "stale_node_timeout_seconds": 5.0,
            "require_all_nodes": False,
        }
        response = client.post("/api/hardware/start", json=payload)
        assert response.status_code == 200
        data = response.json()

        assert data["session_id"] is not None
        assert data["state"] == "CALIBRATING"
        assert data["bind_host"] == "127.0.0.1"
        assert data["bind_port"] > 0  # Verified OS ephemeral port allocation!
        assert data["window_seconds"] == 1.0
        assert data["alpha"] == 0.01
        assert data["expected_nodes"] == ["node_1", "node_2"]

        # Confirm status reflects the active session
        status_res = client.get("/api/hardware/status")
        assert status_res.status_code == 200
        status_data = status_res.json()
        assert status_data["has_active_session"] is True
        assert status_data["receiver_running"] is True
        assert status_data["bind_port"] == data["bind_port"]
        assert status_data["state"] == "CALIBRATING"

    def test_repeated_start_returns_409_conflict(self):
        payload = {"bind_host": "127.0.0.1", "bind_port": 0}
        res1 = client.post("/api/hardware/start", json=payload)
        assert res1.status_code == 200

        # Attempt starting a second concurrent session
        res2 = client.post("/api/hardware/start", json=payload)
        assert res2.status_code == 409
        assert "already active" in res2.json()["detail"]

    def test_invalid_configuration_returns_400_or_422(self):
        # Invalid alpha
        res_bad_alpha = client.post("/api/hardware/start", json={"alpha": 1.5})
        assert res_bad_alpha.status_code in (400, 422)

        # Invalid window_seconds
        res_bad_window = client.post("/api/hardware/start", json={"window_seconds": 0.0})
        assert res_bad_window.status_code in (400, 422)

        # Invalid node ID
        res_bad_node = client.post("/api/hardware/start", json={"expected_nodes": ["node_99"]})
        assert res_bad_node.status_code in (400, 422)

    def test_stop_session_success(self):
        start_res = client.post("/api/hardware/start", json={"bind_host": "127.0.0.1", "bind_port": 0})
        assert start_res.status_code == 200
        session_id = start_res.json()["session_id"]

        stop_res = client.post("/api/hardware/stop")
        assert stop_res.status_code == 200
        stop_data = stop_res.json()

        assert stop_data["session_id"] == session_id
        assert stop_data["final_state"] == "STOPPED"
        assert stop_data["clean_shutdown"] is True

        # Status returns IDLE / inactive
        status_res = client.get("/api/hardware/status")
        assert status_res.json()["has_active_session"] is False
        assert status_res.json()["receiver_running"] is False

    def test_stop_when_no_active_session_returns_404(self):
        res = client.post("/api/hardware/stop")
        assert res.status_code == 404
        assert "No active hardware session" in res.json()["detail"]

    def test_no_hardware_resources_started_before_api_request(self):
        """Confirm application startup does not bind port or spawn threads automatically."""
        manager = get_hardware_session_manager()
        assert manager.is_active is False
        assert manager.session_id is None
        assert manager._receiver is None

        # Verify default UDP port 5005 is not held open
        probe_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            probe_sock.bind(("127.0.0.1", 5005))
        finally:
            probe_sock.close()

    def test_receiver_startup_failure_and_rollback(self):
        """Verify controlled receiver startup conflict triggers clean rollback with no leaked sockets/threads."""
        manager = get_hardware_session_manager()

        # Create a blocking socket on localhost to occupy a port
        conflict_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        conflict_sock.bind(("127.0.0.1", 0))
        occupied_port = conflict_sock.getsockname()[1]

        try:
            # Attempt to start hardware session on the occupied port
            payload = {
                "bind_host": "127.0.0.1",
                "bind_port": occupied_port,
                "window_seconds": 1.0,
            }
            res = client.post("/api/hardware/start", json=payload)
            assert res.status_code == 500
            err_data = res.json()
            assert "Failed to bind UDP socket" in err_data["detail"]
            assert "Traceback" not in res.text

            # Verify manager state rolled back completely
            assert manager.is_active is False
            assert manager.session_id is None
            assert manager._receiver is None
            assert manager._processor is None

            # Verify status endpoint reflects inactive state
            status_res = client.get("/api/hardware/status")
            assert status_res.status_code == 200
            status_data = status_res.json()
            assert status_data["has_active_session"] is False
            assert status_data["receiver_running"] is False
            assert status_data["last_error"] is not None
        finally:
            # Release the blocking socket
            conflict_sock.close()

        # Verify a subsequent valid session can start successfully after the conflict is resolved
        valid_res = client.post(
            "/api/hardware/start",
            json={"bind_host": "127.0.0.1", "bind_port": 0, "window_seconds": 1.0},
        )
        assert valid_res.status_code == 200
        valid_data = valid_res.json()
        assert valid_data["state"] == "CALIBRATING"
        assert manager.is_active is True

        # Clean teardown
        stop_res = client.post("/api/hardware/stop")
        assert stop_res.status_code == 200
        assert manager.is_active is False


# =============================================================================
# 2. Localhost UDP Packet Ingestion & Routing via API
# =============================================================================

class TestHardwareApiPacketIngestion:
    """Sends real UDP datagrams over localhost to verify receiver-to-processor piping."""

    def test_valid_telemetry_packet_counted(self):
        start_res = client.post(
            "/api/hardware/start",
            json={
                "bind_host": "127.0.0.1",
                "bind_port": 0,
                "expected_nodes": ["node_1"],
                "window_seconds": 0.5,
            },
        )
        assert start_res.status_code == 200
        port = start_res.json()["bind_port"]

        # Transmit 3 datagrams to the API socket
        send_udp_datagram(port, node_id="node_1", seq=1, uptime_ms=100)
        send_udp_datagram(port, node_id="node_1", seq=2, uptime_ms=200)
        send_udp_datagram(port, node_id="node_1", seq=3, uptime_ms=300)

        # Allow worker thread brief processing time
        time.sleep(0.1)

        status_res = client.get("/api/hardware/status")
        assert status_res.status_code == 200
        s = status_res.json()
        assert s["total_socket_datagrams"] == 3
        assert s["valid_datagrams"] == 3
        assert s["malformed_datagrams"] == 0
        assert s["node_counts"]["node_1"] == 3

    def test_malformed_datagram_rejected_without_crashing_api(self):
        start_res = client.post(
            "/api/hardware/start",
            json={"bind_host": "127.0.0.1", "bind_port": 0, "expected_nodes": ["node_1"]},
        )
        port = start_res.json()["bind_port"]

        # Send raw non-JSON garbage bytes
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.sendto(b"INVALID_NON_JSON_CORRUPTED_BYTES", ("127.0.0.1", port))
        sock.close()

        # Follow up with a valid packet
        send_udp_datagram(port, node_id="node_1", seq=1)
        time.sleep(0.1)

        status = client.get("/api/hardware/status").json()
        assert status["total_socket_datagrams"] == 2
        assert status["malformed_datagrams"] == 1
        assert status["valid_datagrams"] == 1
        assert status["receiver_running"] is True  # API and listener stayed alive!


# =============================================================================
# 3. Calibration Finalization & Monitoring Transitions
# =============================================================================

class TestHardwareApiCalibration:
    """Validates baseline calibration finalization and error handling via REST."""

    def test_finalize_calibration_insufficient_data_returns_409(self):
        # Requires 5 calibration windows
        start_res = client.post(
            "/api/hardware/start",
            json={
                "bind_host": "127.0.0.1",
                "bind_port": 0,
                "window_seconds": 1.0,
                "min_calibration_windows": 5,
            },
        )
        assert start_res.status_code == 200

        # Immediately attempt to finalize calibration (0 windows available)
        finalize_res = client.post("/api/hardware/calibration/finalize")
        assert finalize_res.status_code == 409
        assert "Insufficient eligible calibration windows" in finalize_res.json()["detail"]

        # State remains CALIBRATING, not broken
        assert client.get("/api/hardware/status").json()["state"] == "CALIBRATING"

    def test_successful_calibration_finalization_transitions_to_monitoring(self):
        # 0.2s windows, requires 3 windows
        start_res = client.post(
            "/api/hardware/start",
            json={
                "bind_host": "127.0.0.1",
                "bind_port": 0,
                "window_seconds": 0.2,
                "min_calibration_windows": 3,
                "expected_nodes": ["node_1"],
                "require_all_nodes": False,
            },
        )
        assert start_res.status_code == 200
        port = start_res.json()["bind_port"]

        # Send packets across 4 consecutive 0.2s windows
        seq = 1
        for _ in range(4):
            for _ in range(5):
                send_udp_datagram(port, node_id="node_1", seq=seq, mode="normal")
                seq += 1
                time.sleep(0.01)
            time.sleep(0.2)

        finalize_res = client.post("/api/hardware/calibration/finalize")
        assert finalize_res.status_code == 200
        data = finalize_res.json()

        assert data["state"] == "MONITORING"
        assert data["eligible_windows_count"] >= 3
        assert data["expected_count_per_window"] > 0.0
        assert data["rate_per_second"] > 0.0

        # Confirm status updated to MONITORING
        status = client.get("/api/hardware/status").json()
        assert status["state"] == "MONITORING"
        assert status["is_calibrated"] is True
        assert status["baseline_expected_count"] == data["expected_count_per_window"]

    def test_finalize_calibration_when_already_monitoring_returns_409(self):
        """Finalizing calibration when already in MONITORING state must be rejected."""
        start_res = client.post(
            "/api/hardware/start",
            json={
                "bind_host": "127.0.0.1",
                "bind_port": 0,
                "window_seconds": 0.1,
                "min_calibration_windows": 1,
                "require_all_nodes": False,
            },
        )
        port = start_res.json()["bind_port"]
        send_udp_datagram(port, node_id="node_1", seq=1)
        time.sleep(0.15)

        # First finalization succeeds
        res1 = client.post("/api/hardware/calibration/finalize")
        assert res1.status_code == 200
        assert res1.json()["state"] == "MONITORING"

        # Repeated finalization rejected with 409 Conflict
        res2 = client.post("/api/hardware/calibration/finalize")
        assert res2.status_code == 409
        assert "MONITORING" in res2.json()["detail"]
        assert "Traceback" not in res2.text

    def test_finalize_calibration_when_stopped_returns_404(self):
        """Finalizing calibration after stopping must return 404 Not Found."""
        start_res = client.post("/api/hardware/start", json={"bind_host": "127.0.0.1", "bind_port": 0})
        assert start_res.status_code == 200
        client.post("/api/hardware/stop")

        res = client.post("/api/hardware/calibration/finalize")
        assert res.status_code == 404
        assert "No active hardware session" in res.json()["detail"]


# =============================================================================
# 4. Live Windows Query and Incremental Polling Tests
# =============================================================================

class TestHardwareApiLiveWindows:
    """Tests GET /api/hardware/live for window inspection and pagination."""

    def test_live_windows_empty_when_no_session(self):
        res = client.get("/api/hardware/live")
        assert res.status_code == 200
        data = res.json()
        assert data["session_id"] is None
        assert data["state"] == "IDLE"
        assert data["windows"] == []

    def test_live_windows_retrieval_and_limit(self):
        start_res = client.post(
            "/api/hardware/start",
            json={
                "bind_host": "127.0.0.1",
                "bind_port": 0,
                "window_seconds": 0.1,
                "expected_nodes": ["node_1"],
                "require_all_nodes": False,
            },
        )
        port = start_res.json()["bind_port"]

        # Run 4 windows
        for seq in range(1, 5):
            send_udp_datagram(port, node_id="node_1", seq=seq)
            time.sleep(0.12)

        live_res = client.get("/api/hardware/live?limit=2")
        assert live_res.status_code == 200
        data = live_res.json()

        assert data["returned_windows_count"] <= 2
        assert len(data["windows"]) <= 2
        for w in data["windows"]:
            assert "window_index" in w
            assert "aggregate_count" in w
            assert "quality" in w
            assert "detection_status" in w

    def test_live_windows_incremental_polling(self):
        start_res = client.post(
            "/api/hardware/start",
            json={
                "bind_host": "127.0.0.1",
                "bind_port": 0,
                "window_seconds": 0.1,
                "expected_nodes": ["node_1"],
                "require_all_nodes": False,
            },
        )
        port = start_res.json()["bind_port"]

        for seq in range(1, 4):
            send_udp_datagram(port, node_id="node_1", seq=seq)
            time.sleep(0.12)

        # Poll windows strictly after index 0
        live_res = client.get("/api/hardware/live?after_window_index=0")
        assert live_res.status_code == 200
        data = live_res.json()
        for w in data["windows"]:
            assert w["window_index"] > 0


# =============================================================================
# 5. Concurrency and Lifespan Teardown Tests
# =============================================================================

class TestHardwareApiConcurrencyAndTeardown:
    """Validates concurrent status polling and clean resource release."""

    def test_concurrent_status_polling_safe(self):
        start_res = client.post(
            "/api/hardware/start",
            json={
                "bind_host": "127.0.0.1",
                "bind_port": 0,
                "window_seconds": 0.1,
                "expected_nodes": ["node_1", "node_2"],
                "require_all_nodes": False,
            },
        )
        port = start_res.json()["bind_port"]

        # Concurrently send packets and poll status from multiple threads
        def packet_sender():
            for i in range(1, 25):
                send_udp_datagram(port, node_id="node_1", seq=i)
                time.sleep(0.01)

        def status_poller():
            for _ in range(10):
                r = client.get("/api/hardware/status")
                assert r.status_code == 200
                time.sleep(0.01)

        t1 = threading.Thread(target=packet_sender)
        t2 = threading.Thread(target=status_poller)
        t3 = threading.Thread(target=status_poller)

        t1.start()
        t2.start()
        t3.start()

        t1.join()
        t2.join()
        t3.join()

        # Final stop
        stop_res = client.post("/api/hardware/stop")
        assert stop_res.status_code == 200
        assert stop_res.json()["clean_shutdown"] is True


# =============================================================================
# 6. FastAPI Lifespan Application Shutdown Tests
# =============================================================================

class TestHardwareFastApiLifespan:
    """Exercises cleanup through the actual FastAPI lifespan context manager."""

    def test_fastapi_lifespan_shutdown_cleans_active_session(self):
        manager = get_hardware_session_manager()
        assert manager.is_active is False

        rec_ref = None
        worker_ref = None
        assigned_port = None

        with TestClient(app) as test_client:
            # Start hardware session within active lifespan
            start_res = test_client.post(
                "/api/hardware/start",
                json={"bind_host": "127.0.0.1", "bind_port": 0, "window_seconds": 1.0},
            )
            assert start_res.status_code == 200
            assigned_port = start_res.json()["bind_port"]
            assert assigned_port > 0

            assert manager.is_active is True
            rec_ref = manager._receiver
            assert rec_ref is not None
            assert rec_ref.is_running is True
            worker_ref = rec_ref._worker_thread
            assert worker_ref is not None
            assert worker_ref.is_alive() is True

        # Now context has exited, triggering app lifespan shutdown hook!
        assert manager.is_active is False
        assert rec_ref.is_running is False
        assert rec_ref._socket is None
        # Verify background listener thread terminated
        worker_ref.join(timeout=1.0)
        assert not worker_ref.is_alive()

        # Verify processor released
        assert manager._processor is None
        assert manager._session_id is None

        # Verify cleanup is idempotent when called again
        manager.shutdown()
        assert manager.is_active is False

        # Verify the previously bound port is fully released and can be bound by a new socket
        probe_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            probe_sock.bind(("127.0.0.1", assigned_port))
        finally:
            probe_sock.close()


# =============================================================================
# 7. Complete End-to-End API-to-Detector Workflow Test
# =============================================================================

class TestHardwareApiEndToEndWorkflow:
    """Verifies the complete API -> UDP socket -> processor -> detector pipeline."""

    def test_complete_api_to_detector_workflow(self):
        # 1. Start hardware session on ephemeral port
        start_res = client.post(
            "/api/hardware/start",
            json={
                "bind_host": "127.0.0.1",
                "bind_port": 0,
                "window_seconds": 0.2,
                "min_calibration_windows": 3,
                "alpha": 0.01,
                "expected_nodes": ["node_1", "node_2"],
                "require_all_nodes": False,
            },
        )
        assert start_res.status_code == 200
        data = start_res.json()
        port = data["bind_port"]
        assert data["state"] == "CALIBRATING"

        # 2. Accumulate 4 clean calibration windows
        # Window duration is 0.2s. In each window, send 2 packets from node_1 and 2 from node_2.
        seq_1 = 1
        seq_2 = 1
        for w_idx in range(4):
            send_udp_datagram(port, node_id="node_1", seq=seq_1, uptime_ms=100 + w_idx * 200, mode="normal")
            seq_1 += 1
            send_udp_datagram(port, node_id="node_2", seq=seq_2, uptime_ms=100 + w_idx * 200, mode="normal")
            seq_2 += 1
            time.sleep(0.22)  # advance past 0.2s window boundary

        # 3. Finalize calibration via HTTP endpoint
        finalize_res = client.post("/api/hardware/calibration/finalize")
        assert finalize_res.status_code == 200
        cal_data = finalize_res.json()
        assert cal_data["state"] == "MONITORING"
        assert cal_data["eligible_windows_count"] >= 3
        assert cal_data["expected_count_per_window"] > 0.0

        # 4. Verify status endpoint reflects MONITORING and frozen baseline
        status_res = client.get("/api/hardware/status")
        assert status_res.status_code == 200
        status_data = status_res.json()
        assert status_data["state"] == "MONITORING"
        assert status_data["is_calibrated"] is True
        assert status_data["baseline_expected_count"] == cal_data["expected_count_per_window"]

        # 5. Monitoring Phase - Normal window (send ~2 packets, consistent with baseline)
        send_udp_datagram(port, node_id="node_1", seq=seq_1, uptime_ms=1000, mode="normal")
        seq_1 += 1
        time.sleep(0.22)

        # 6. Monitoring Phase - Burst window (send 20 packets rapidly, overwhelming baseline lambda ~4)
        for b in range(20):
            send_udp_datagram(port, node_id="node_1", seq=seq_1, uptime_ms=1200 + b * 2, mode="burst")
            seq_1 += 1
            time.sleep(0.001)
        time.sleep(0.25)

        # 7. Retrieve live windows via GET /api/hardware/live
        live_res = client.get("/api/hardware/live?limit=50")
        assert live_res.status_code == 200
        live_data = live_res.json()
        assert live_data["state"] == "MONITORING"
        windows = live_data["windows"]
        assert len(windows) >= 5

        # Check calibration windows have detection_status == "calibrating"
        cal_wins = [w for w in windows if w["is_calibration"]]
        assert len(cal_wins) >= 3
        for cw in cal_wins:
            assert cw["detection_status"] == "calibrating"

        # Check monitoring windows have detection_status in ("normal", "burst")
        mon_wins = [w for w in windows if not w["is_calibration"]]
        assert len(mon_wins) >= 1
        for mw in mon_wins:
            assert mw["detection_status"] in ("normal", "burst")
            assert mw["expected_baseline_count"] == cal_data["expected_count_per_window"]
            assert mw["p_value"] is not None
            assert 0.0 <= mw["p_value"] <= 1.0

        # Verify that the burst window detected a burst (detection_status == "burst", p_value < 0.01)
        burst_win = next((w for w in mon_wins if w["is_burst"] is True), None)
        assert burst_win is not None
        assert burst_win["detection_status"] == "burst"
        assert burst_win["p_value"] < 0.01
        assert burst_win["aggregate_count"] >= 10

        # 8. Cleanly stop the session via POST /api/hardware/stop
        stop_res = client.post("/api/hardware/stop")
        assert stop_res.status_code == 200
        summary = stop_res.json()
        assert summary["clean_shutdown"] is True
        assert summary["final_state"] == "STOPPED"
        assert summary["completed_windows_count"] >= 5
        assert summary["burst_detections_count"] >= 1
