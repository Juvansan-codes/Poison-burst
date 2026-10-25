"""
PoissonBurst Lab - Phase 8 Automated Test Suite.
Protocol V2 and Arduino Reboot Recovery Verification.

Validates:
1. Protocol V1 backward compatibility.
2. Protocol V2 parsing, field validation, and closed schema enforcement.
3. Boot session recognition and sequence counter reset recovery on reboot.
4. Intra-boot sequence deduplication.
5. Delayed packet handling from retired boot sessions (no thrashing/resurrection).
6. Malformed message tolerance without state corruption.
7. Correct accounting invariants (total = unique + duplicate).
8. Mixed deployment (Protocol V1 + Protocol V2 concurrent nodes).
9. Window processor aggregation, calibration, and detection across reboots.
10. Session shutdown, experiment persistence, CSV export, and PDF generation.
"""

from __future__ import annotations

import json
import socket
import time
from typing import Dict, Generator, List, Tuple
import pytest
from starlette.testclient import TestClient

from app.main import app
from app.services.hardware_session_manager import get_hardware_session_manager
from app.core.hardware_schemas import HardwareStartRequest
from app.core.schemas import MeasurementType
from app.services.hardware_receiver import (
    HardwareReceiver,
    NodeTelemetryState,
    TelemetryPacket,
    ValidationError,
    validate_telemetry_payload,
)
from app.services.hardware_simulator import (
    HardwareSimulator,
    SimulatedNodeConfig,
)
from app.services.hardware_window_processor import (
    AggregatedWindow,
    DetectionStatus,
    HardwareWindowProcessor,
    HardwareWindowProcessorConfig,
    ProcessorState,
)


@pytest.fixture
def temp_db(tmp_path, monkeypatch) -> Generator[str, None, None]:
    """Isolated temporary SQLite database for each test."""
    db_file = str(tmp_path / "test_v2_reboot.db")
    monkeypatch.setenv("POISSONBURST_DB_PATH", db_file)
    import app.services.experiment_repository as er
    er._default_repo = None
    yield db_file
    er._default_repo = None


@pytest.fixture
def test_client(temp_db) -> Generator[TestClient, None, None]:
    """Clean TestClient with isolated DB and reset hardware session manager."""
    manager = get_hardware_session_manager()
    manager.shutdown()
    with TestClient(app) as client:
        yield client
    manager.shutdown()


def send_raw_udp(host: str, port: int, payload: bytes) -> None:
    """Helper to send a raw UDP datagram to the target host and port."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.sendto(payload, (host, port))
    finally:
        sock.close()


# =============================================================================
# 1. Protocol Parsing & Schema Validation Unit Tests
# =============================================================================


class TestProtocolV2ParsingAndValidation:
    """Tests for validate_telemetry_payload with Protocol V1 and V2."""

    def test_protocol_v1_backward_compatibility(self):
        """Protocol V1 packets without boot_id must remain valid and have boot_id=None."""
        raw = json.dumps({
            "version": 1,
            "node_id": "node_1",
            "seq": 42,
            "uptime_ms": 5000,
            "mode": "normal",
        }).encode("utf-8")

        pkt = validate_telemetry_payload(raw, ("127.0.0.1", 12345))
        assert pkt.version == 1
        assert pkt.node_id == "node_1"
        assert pkt.seq == 42
        assert pkt.uptime_ms == 5000
        assert pkt.mode == "normal"
        assert pkt.boot_id is None
        assert pkt.source_address == ("127.0.0.1", 12345)

    def test_protocol_v2_valid_parsing(self):
        """Protocol V2 packets with valid boot_id must parse cleanly."""
        raw = json.dumps({
            "version": 2,
            "node_id": "node_2",
            "seq": 1,
            "uptime_ms": 250,
            "mode": "normal",
            "boot_id": "a1b2c3d4",
        }).encode("utf-8")

        pkt = validate_telemetry_payload(raw, ("127.0.0.1", 54321))
        assert pkt.version == 2
        assert pkt.node_id == "node_2"
        assert pkt.seq == 1
        assert pkt.boot_id == "a1b2c3d4"

    def test_protocol_v2_missing_boot_id_rejected(self):
        """Protocol V2 without boot_id must be rejected as missing required field."""
        raw = json.dumps({
            "version": 2,
            "node_id": "node_1",
            "seq": 1,
            "uptime_ms": 100,
            "mode": "normal",
        }).encode("utf-8")

        with pytest.raises(ValidationError) as exc:
            validate_telemetry_payload(raw)
        assert "boot_id" in str(exc.value)

    def test_protocol_v2_empty_or_whitespace_boot_id_rejected(self):
        """Protocol V2 with empty string or whitespace boot_id must be rejected."""
        for bad_bid in ["", "   "]:
            raw = json.dumps({
                "version": 2,
                "node_id": "node_1",
                "seq": 1,
                "uptime_ms": 100,
                "mode": "normal",
                "boot_id": bad_bid,
            }).encode("utf-8")

            with pytest.raises(ValidationError) as exc:
                validate_telemetry_payload(raw)
            assert "boot_id" in str(exc.value)

    def test_protocol_v2_non_string_boot_id_rejected(self):
        """Protocol V2 with non-string boot_id (e.g. integer or boolean) must be rejected."""
        for bad_bid in [12345, True, False, ["list"], {"dict": 1}]:
            raw = json.dumps({
                "version": 2,
                "node_id": "node_1",
                "seq": 1,
                "uptime_ms": 100,
                "mode": "normal",
                "boot_id": bad_bid,
            }).encode("utf-8")

            with pytest.raises(ValidationError) as exc:
                validate_telemetry_payload(raw)
            assert "boot_id" in str(exc.value)

    def test_protocol_v2_oversized_boot_id_rejected(self):
        """Protocol V2 with boot_id longer than 64 characters must be rejected."""
        raw = json.dumps({
            "version": 2,
            "node_id": "node_1",
            "seq": 1,
            "uptime_ms": 100,
            "mode": "normal",
            "boot_id": "x" * 65,
        }).encode("utf-8")

        with pytest.raises(ValidationError) as exc:
            validate_telemetry_payload(raw)
        assert "boot_id" in str(exc.value)

    def test_protocol_v2_extra_field_rejected(self):
        """Protocol V2 closed schema rejects unexpected extra fields."""
        raw = json.dumps({
            "version": 2,
            "node_id": "node_1",
            "seq": 1,
            "uptime_ms": 100,
            "mode": "normal",
            "boot_id": "boot_1",
            "extra_field": "unauthorized",
        }).encode("utf-8")

        with pytest.raises(ValidationError) as exc:
            validate_telemetry_payload(raw)
        assert "Unexpected extra field" in str(exc.value)

    def test_unsupported_protocol_version_rejected(self):
        """Protocol versions other than 1 and 2 are rejected."""
        for bad_ver in [0, 3, 99, -1]:
            raw = json.dumps({
                "version": bad_ver,
                "node_id": "node_1",
                "seq": 1,
                "uptime_ms": 100,
                "mode": "normal",
            }).encode("utf-8")

            with pytest.raises(ValidationError) as exc:
                validate_telemetry_payload(raw)
            assert "Unsupported protocol version" in str(exc.value)


# =============================================================================
# 2. NodeTelemetryState Boot Tracking & Reboot Recovery Unit Tests
# =============================================================================

class TestNodeTelemetryStateRebootRecovery:
    """Tests for NodeTelemetryState sequence tracking with Protocol V2."""

    def _make_packet(self, seq: int, boot_id: str, ver: int = 2, nid: str = "node_1") -> TelemetryPacket:
        return TelemetryPacket(
            version=ver,
            node_id=nid,
            seq=seq,
            uptime_ms=100 * seq,
            mode="normal",
            received_time_utc="2026-10-25T12:00:00Z",
            received_time_monotonic=time.monotonic(),
            source_address=("127.0.0.1", 5005),
            boot_id=boot_id if ver >= 2 else None,
        )

    def test_normal_boot_session_in_order(self):
        """Packets 1..5 in active boot session are accepted in order."""
        state = NodeTelemetryState(node_id="node_1")
        for s in range(1, 6):
            state.record_packet(self._make_packet(seq=s, boot_id="boot_A"))

        assert state.active_boot_id == "boot_A"
        assert state.valid_packets_count == 5
        assert state.unique_packets_count == 5
        assert state.duplicate_or_reordered_count == 0
        assert state.boot_transitions_count == 0

    def test_intra_boot_duplicates_filtered(self):
        """Duplicate sequence within active boot session is filtered."""
        state = NodeTelemetryState(node_id="node_1")
        state.record_packet(self._make_packet(seq=1, boot_id="boot_A"))
        state.record_packet(self._make_packet(seq=2, boot_id="boot_A"))
        state.record_packet(self._make_packet(seq=2, boot_id="boot_A"))  # Duplicate!
        state.record_packet(self._make_packet(seq=3, boot_id="boot_A"))

        assert state.valid_packets_count == 4
        assert state.unique_packets_count == 3
        assert state.duplicate_or_reordered_count == 1

    def test_reboot_with_new_boot_id_resets_sequence_and_accepts_low_seq(self):
        """When node reboots with new boot_id, sequence counter reset (e.g. seq=1) is accepted!"""
        state = NodeTelemetryState(node_id="node_1")

        # Initial boot session reaches seq=10
        for s in range(1, 11):
            state.record_packet(self._make_packet(seq=s, boot_id="boot_A"))

        assert state.active_boot_id == "boot_A"
        assert state.last_seq == 10
        assert state.unique_packets_count == 10

        # NODE REBOOTS! Transmits seq=1 with boot_id="boot_B"
        reboot_pkt = self._make_packet(seq=1, boot_id="boot_B")
        state.record_packet(reboot_pkt)

        # In Protocol V1, seq=1 would be rejected because 1 <= 10.
        # In Protocol V2, new boot_id causes a clean sequence reset and accepts seq=1!
        assert state.active_boot_id == "boot_B"
        assert state.last_seq == 1
        assert state.unique_packets_count == 11
        assert state.duplicate_or_reordered_count == 0
        assert state.boot_transitions_count == 1
        assert "boot_A" in state.retired_boot_ids

        # Transition record is accurate
        transition = state.boot_transitions[0]
        assert transition["from_boot_id"] == "boot_A"
        assert transition["to_boot_id"] == "boot_B"
        assert transition["last_seq_before_reboot"] == 10
        assert transition["initial_seq_after_reboot"] == 1

        # Continue with boot_B
        state.record_packet(self._make_packet(seq=2, boot_id="boot_B"))
        assert state.unique_packets_count == 12

    def test_delayed_packet_from_retired_boot_session_rejected_without_switching(self):
        """Delayed packet from retired boot_id is filtered as duplicate and does NOT switch session."""
        state = NodeTelemetryState(node_id="node_1")

        # Session 1: boot_A (seq 1..5)
        for s in range(1, 6):
            state.record_packet(self._make_packet(seq=s, boot_id="boot_A"))

        # Reboot to boot_B (seq 1..3)
        for s in range(1, 4):
            state.record_packet(self._make_packet(seq=s, boot_id="boot_B"))

        assert state.active_boot_id == "boot_B"
        assert state.unique_packets_count == 8  # 5 + 3

        # DELAYED PACKET from boot_A arrives! (e.g. seq=6 from old Wi-Fi buffer)
        delayed_pkt = self._make_packet(seq=6, boot_id="boot_A")
        state.record_packet(delayed_pkt)

        # Verified policy:
        # 1. active_boot_id remains boot_B (no thrashing/resurrection).
        # 2. unique_packets_count remains 8.
        # 3. duplicate_or_reordered_count increments by 1.
        # 4. last_seq remains 3 (from boot_B).
        assert state.active_boot_id == "boot_B"
        assert state.unique_packets_count == 8
        assert state.duplicate_or_reordered_count == 1
        assert state.last_seq == 3

        # Next normal packet from boot_B continues seamlessly
        state.record_packet(self._make_packet(seq=4, boot_id="boot_B"))
        assert state.unique_packets_count == 9
        assert state.last_seq == 4

    def test_chain_of_reboots(self):
        """Node can reboot multiple times (boot_1 -> boot_2 -> boot_3). All previous boots retire."""
        state = NodeTelemetryState(node_id="node_1")

        # Boot 1
        state.record_packet(self._make_packet(seq=1, boot_id="boot_1"))
        state.record_packet(self._make_packet(seq=2, boot_id="boot_1"))

        # Boot 2
        state.record_packet(self._make_packet(seq=1, boot_id="boot_2"))
        state.record_packet(self._make_packet(seq=2, boot_id="boot_2"))

        # Boot 3
        state.record_packet(self._make_packet(seq=1, boot_id="boot_3"))

        assert state.active_boot_id == "boot_3"
        assert state.boot_transitions_count == 2
        assert state.retired_boot_ids == {"boot_1", "boot_2"}
        assert state.unique_packets_count == 5

        # Delayed packets from boot_1 and boot_2 are both rejected
        state.record_packet(self._make_packet(seq=10, boot_id="boot_1"))
        state.record_packet(self._make_packet(seq=10, boot_id="boot_2"))
        assert state.unique_packets_count == 5
        assert state.duplicate_or_reordered_count == 2
        assert state.active_boot_id == "boot_3"

    def test_legacy_protocol_v1_preserves_filtering(self):
        """Protocol V1 packets without boot_id continue using legacy sequence filter."""
        state = NodeTelemetryState(node_id="node_1")
        state.record_packet(self._make_packet(seq=10, boot_id="", ver=1))
        # Sequence reset without boot_id (V1)
        state.record_packet(self._make_packet(seq=1, boot_id="", ver=1))

        # Because V1 has no boot_id, seq=1 is classified as duplicate (legacy behavior)
        assert state.unique_packets_count == 1
        assert state.duplicate_or_reordered_count == 1
        assert state.active_boot_id is None


# =============================================================================
# 3. HardwareWindowProcessor Reboot Handling Unit Tests
# =============================================================================

class TestWindowProcessorRebootHandling:
    """Tests for HardwareWindowProcessor handling Protocol V2 packets and reboots."""

    def test_window_processor_accepts_post_reboot_packets(self):
        """Window processor places post-reboot packets into windows without duplicate rejection."""
        config = HardwareWindowProcessorConfig(
            window_seconds=1.0,
            expected_node_ids=["node_1"],
            min_calibration_windows=1,
            require_all_nodes=False,
        )
        proc = HardwareWindowProcessor(config=config)
        proc.start_session(mode=ProcessorState.MONITORING, start_monotonic=100.0)

        # Window 0 [100.0, 101.0): send seq 1..5 with boot_A
        for s in range(1, 6):
            pkt = TelemetryPacket(
                version=2,
                node_id="node_1",
                seq=s,
                uptime_ms=100 * s,
                mode="normal",
                received_time_utc="2026-10-25T12:00:00Z",
                received_time_monotonic=100.1 + (s * 0.1),
                source_address=("127.0.0.1", 5005),
                boot_id="boot_A",
            )
            proc.process_packet(pkt)

        # Advance to close window 0
        w0 = proc.advance_time(101.0)[0]
        assert w0.aggregate_count == 5
        assert w0.node_duplicates_count["node_1"] == 0
        assert w0.node_boot_ids["node_1"] == "boot_A"

        # Window 1 [101.0, 102.0): Node reboots! Transmits seq 1..4 with boot_B
        for s in range(1, 5):
            pkt = TelemetryPacket(
                version=2,
                node_id="node_1",
                seq=s,
                uptime_ms=100 * s,
                mode="normal",
                received_time_utc="2026-10-25T12:00:01Z",
                received_time_monotonic=101.1 + (s * 0.1),
                source_address=("127.0.0.1", 5005),
                boot_id="boot_B",
            )
            proc.process_packet(pkt)

        # Window 1 closes
        w1 = proc.advance_time(102.0)[0]
        # In Protocol V2, all 4 post-reboot packets are accepted as unique!
        assert w1.aggregate_count == 4
        assert w1.node_duplicates_count["node_1"] == 0
        assert w1.node_boot_ids["node_1"] == "boot_B"

    def test_window_processor_filters_delayed_packet_from_retired_boot(self):
        """Window processor excludes delayed packet from retired boot_id from aggregate arrival count."""
        config = HardwareWindowProcessorConfig(
            window_seconds=1.0,
            expected_node_ids=["node_1"],
            min_calibration_windows=1,
            require_all_nodes=False,
        )
        proc = HardwareWindowProcessor(config=config)
        proc.start_session(mode=ProcessorState.MONITORING, start_monotonic=100.0)

        # Send boot_A (seq 1..3)
        for s in range(1, 4):
            proc.process_packet(TelemetryPacket(
                version=2, node_id="node_1", seq=s, uptime_ms=100, mode="normal",
                received_time_utc="2026-10-25T12:00:00Z", received_time_monotonic=100.1,
                source_address=("127.0.0.1", 5005), boot_id="boot_A"
            ))

        # Reboot to boot_B (seq 1)
        proc.process_packet(TelemetryPacket(
            version=2, node_id="node_1", seq=1, uptime_ms=100, mode="normal",
            received_time_utc="2026-10-25T12:00:00Z", received_time_monotonic=100.3,
            source_address=("127.0.0.1", 5005), boot_id="boot_B"
        ))

        # Delayed packet from boot_A (seq 4)
        proc.process_packet(TelemetryPacket(
            version=2, node_id="node_1", seq=4, uptime_ms=100, mode="normal",
            received_time_utc="2026-10-25T12:00:00Z", received_time_monotonic=100.5,
            source_address=("127.0.0.1", 5005), boot_id="boot_A"
        ))

        w0 = proc.advance_time(101.0)[0]
        # Total valid sent: 3 (boot_A) + 1 (boot_B) + 1 (delayed boot_A) = 5
        # Accepted arrivals: 3 (boot_A) + 1 (boot_B) = 4
        # Duplicates / excluded: 1 (delayed boot_A)
        assert w0.aggregate_count == 4
        assert w0.node_duplicates_count["node_1"] == 1


# =============================================================================
# 4. Multi-Node Mixed Deployment (Protocol V1 + V2) Simulator Tests
# =============================================================================

class TestMixedDeploymentSimulator:
    """Tests concurrent operation of Protocol V1 and Protocol V2 nodes."""

    def test_mixed_protocol_concurrent_simulation(self):
        """Simulator runs with node_1/3 as Protocol V1 and node_2/4 as Protocol V2."""
        with HardwareReceiver(host="127.0.0.1", port=0) as receiver:
            port = receiver.port

            configs = HardwareSimulator.create_mixed_protocol_configs(
                v1_nodes=["node_1", "node_3"],
                v2_nodes=["node_2", "node_4"],
                normal_rate_hz=20.0,
                burst_rate_hz=20.0,
                global_seed=42,
            )

            with HardwareSimulator(
                destination_host="127.0.0.1",
                destination_port=port,
                nodes=configs,
                duration_seconds=0.5,
            ) as sim:
                sim.wait_until_complete(timeout=2.0)

            status = receiver.get_status()
            assert status["valid_datagrams"] > 0
            assert status["observed_nodes_count"] == 4

            # V1 nodes have boot_id None
            assert status["nodes"]["node_1"]["active_boot_id"] is None
            assert status["nodes"]["node_3"]["active_boot_id"] is None

            # V2 nodes have boot_id populated
            assert status["nodes"]["node_2"]["active_boot_id"] == "boot_node_2_1"
            assert status["nodes"]["node_4"]["active_boot_id"] == "boot_node_4_1"


# =============================================================================
# 5. End-to-End Accounting & Persistence Verification with Reboot
# =============================================================================

class TestE2ERebootAccountingAndPersistence:
    """End-to-end accounting validation including reboot recovery and export consistency."""

    def test_e2e_reboot_accounting_and_experiment_export(
        self, test_client: TestClient, temp_db: str
    ):
        """Simulate hardware session with Protocol V2 node reboot:
        - Node transmits 10 packets in boot_1.
        - Node reboots to boot_2 and transmits 10 packets starting at seq 1.
        - Node transmits 2 delayed packets from boot_1.
        - Verify all accounting invariants, session persistence, CSV, and PDF exports.
        """
        # Start hardware session
        start_res = test_client.post(
            "/api/hardware/start",
            json={
                "bind_host": "127.0.0.1",
                "bind_port": 0,
                "window_seconds": 0.5,
                "min_calibration_windows": 1,
                "expected_nodes": ["node_1"],
                "require_all_nodes": False,
            },
        )
        assert start_res.status_code == 200
        port = start_res.json()["bind_port"]
        session_id = start_res.json()["session_id"]

        # 1. Transmit 10 packets in boot_1 (Calibration)
        for s in range(1, 11):
            send_raw_udp(
                "127.0.0.1",
                port,
                json.dumps({
                    "version": 2, "node_id": "node_1", "seq": s, "uptime_ms": 100 * s,
                    "mode": "normal", "boot_id": "boot_1"
                }).encode("utf-8"),
            )
        time.sleep(0.6)  # Seal calibration window

        # Finalize calibration
        fin_res = test_client.post("/api/hardware/calibration/finalize")
        assert fin_res.status_code == 200

        # 2. Node reboots to boot_2! Transmit 10 packets in boot_2 (Monitoring)
        for s in range(1, 11):
            send_raw_udp(
                "127.0.0.1",
                port,
                json.dumps({
                    "version": 2, "node_id": "node_1", "seq": s, "uptime_ms": 100 * s,
                    "mode": "normal", "boot_id": "boot_2"
                }).encode("utf-8"),
            )

        # 3. Inject 2 delayed packets from retired boot_1 (all seq <= 10)
        send_raw_udp(
            "127.0.0.1",
            port,
            json.dumps({
                "version": 2, "node_id": "node_1", "seq": 5, "uptime_ms": 500,
                "mode": "normal", "boot_id": "boot_1"
            }).encode("utf-8"),
        )
        send_raw_udp(
            "127.0.0.1",
            port,
            json.dumps({
                "version": 2, "node_id": "node_1", "seq": 6, "uptime_ms": 600,
                "mode": "normal", "boot_id": "boot_1"
            }).encode("utf-8"),
        )

        time.sleep(0.6)  # Seal monitoring window

        # Stop session
        stop_res = test_client.post("/api/hardware/stop")
        assert stop_res.status_code == 200
        stop_data = stop_res.json()

        # Accounting verification:
        # Total sent = 10 (boot_1) + 10 (boot_2) + 2 (delayed boot_1) = 22 valid datagrams
        # Unique accepted = 10 (boot_1) + 10 (boot_2) = 20 unique datagrams
        # Duplicates/delayed filtered = 2 datagrams
        assert stop_data["total_valid_datagrams"] == 22
        assert stop_data["unique_datagrams"] == 20
        assert stop_data["duplicate_datagrams"] == 2
        # Strict accounting invariant: total == unique + duplicate
        assert stop_data["total_valid_datagrams"] == stop_data["unique_datagrams"] + stop_data["duplicate_datagrams"]

        # Check session status API
        status_res = test_client.get("/api/hardware/status")
        assert status_res.status_code == 200

        # Check experiment statistics API
        stats_res = test_client.get(f"/api/experiments/{session_id}/statistics")
        assert stats_res.status_code == 200
        stats = stats_res.json()
        assert stats["calibration_empirical_mean"] is not None
        assert stats["monitoring_empirical_mean"] is not None
        assert stats["data_quality_warning"] is not None
        assert "Sequence filtering rejected 2 of 22 valid datagrams" in stats["data_quality_warning"]

        # Check CSV export
        csv_res = test_client.get(f"/api/experiments/{session_id}/export")
        assert csv_res.status_code == 200
        assert "# All-Session Empirical Mean:" in csv_res.text
        assert "# Calibration Phase Empirical Mean:" in csv_res.text
        assert "# Monitoring Phase Empirical Mean (Accepted Arrivals):" in csv_res.text
        assert "# Data Quality Warning:" in csv_res.text

        # Check PDF report
        pdf_res = test_client.get(f"/api/experiments/{session_id}/report.pdf")
        assert pdf_res.status_code == 200
        assert pdf_res.headers["content-type"] == "application/pdf"
        assert pdf_res.content.startswith(b"%PDF")
