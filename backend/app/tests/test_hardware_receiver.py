"""
PoissonBurst Lab - Unit and Integration Tests for Hardware UDP Receiver.

Validates telemetry protocol parsing, error rejection, sequence tracking,
rate calculation, and multi-node receiver lifecycle using ephemeral sockets.
"""

from __future__ import annotations

import json
import socket
import time
import pytest

from app.services.hardware_receiver import (
    ALLOW_EXTRA_FIELDS,
    MAX_PAYLOAD_BYTES,
    SUPPORTED_PROTOCOL_VERSION,
    HardwareReceiver,
    NodeTelemetryState,
    TelemetryPacket,
    ValidationError,
    validate_telemetry_payload,
)


# =============================================================================
# 1. Telemetry Protocol Validation Unit Tests
# =============================================================================

class TestProtocolValidation:
    """Tests for validate_telemetry_payload()."""

    def test_valid_node_1_message(self):
        payload = {
            "version": 1,
            "node_id": "node_1",
            "seq": 1042,
            "uptime_ms": 128450,
            "mode": "normal",
        }
        raw_bytes = json.dumps(payload).encode("utf-8")
        packet = validate_telemetry_payload(raw_bytes, ("127.0.0.1", 54321))

        assert packet.version == 1
        assert packet.node_id == "node_1"
        assert packet.seq == 1042
        assert packet.uptime_ms == 128450
        assert packet.mode == "normal"
        assert packet.source_address == ("127.0.0.1", 54321)
        assert isinstance(packet.received_time_utc, str)
        assert packet.received_time_monotonic > 0

    @pytest.mark.parametrize("node_id", ["node_1", "node_2", "node_3", "node_4"])
    def test_all_supported_nodes(self, node_id: str):
        payload = {
            "version": 1,
            "node_id": node_id,
            "seq": 1,
            "uptime_ms": 500,
            "mode": "burst" if node_id == "node_4" else "normal",
        }
        packet = validate_telemetry_payload(json.dumps(payload).encode("utf-8"))
        assert packet.node_id == node_id

    @pytest.mark.parametrize(
        "missing_field", ["version", "node_id", "seq", "uptime_ms", "mode"]
    )
    def test_missing_required_fields(self, missing_field: str):
        payload = {
            "version": 1,
            "node_id": "node_1",
            "seq": 10,
            "uptime_ms": 1000,
            "mode": "normal",
        }
        del payload[missing_field]
        raw_bytes = json.dumps(payload).encode("utf-8")

        with pytest.raises(ValidationError) as exc_info:
            validate_telemetry_payload(raw_bytes)
        assert "Missing required payload field" in str(exc_info.value)

    def test_incorrect_json_syntax(self):
        bad_json = b'{"version": 1, "node_id": "node_1", '
        with pytest.raises(ValidationError) as exc_info:
            validate_telemetry_payload(bad_json)
        assert "Malformed JSON syntax" in str(exc_info.value)

    def test_invalid_utf8(self):
        bad_utf8 = b"\xff\xfe\x00\x12\x34"
        with pytest.raises(ValidationError) as exc_info:
            validate_telemetry_payload(bad_utf8)
        assert "invalid UTF-8" in str(exc_info.value)

    def test_empty_datagram(self):
        with pytest.raises(ValidationError) as exc_info:
            validate_telemetry_payload(b"")
        assert "Empty datagram" in str(exc_info.value)

    def test_oversized_payload(self):
        oversized = (
            b'{"version":1,"node_id":"node_1","seq":1,"uptime_ms":100,"mode":"normal","pad":"'
            + (b"A" * 600)
            + b'"}'
        )
        assert len(oversized) > MAX_PAYLOAD_BYTES
        with pytest.raises(ValidationError) as exc_info:
            validate_telemetry_payload(oversized)
        assert "exceeds maximum limit" in str(exc_info.value)

    def test_unsupported_protocol_version(self):
        payload = {
            "version": 2,
            "node_id": "node_1",
            "seq": 1,
            "uptime_ms": 1000,
            "mode": "normal",
        }
        with pytest.raises(ValidationError) as exc_info:
            validate_telemetry_payload(json.dumps(payload).encode("utf-8"))
        assert "Unsupported protocol version 2" in str(exc_info.value)

    @pytest.mark.parametrize("invalid_node", ["node_5", "arduino_1", "NODE_1", "", "router"])
    def test_invalid_node_identifier(self, invalid_node: str):
        payload = {
            "version": 1,
            "node_id": invalid_node,
            "seq": 1,
            "uptime_ms": 1000,
            "mode": "normal",
        }
        with pytest.raises(ValidationError) as exc_info:
            validate_telemetry_payload(json.dumps(payload).encode("utf-8"))
        assert "node_id" in str(exc_info.value).lower()

    def test_invalid_sequence_number_types(self):
        # Negative sequence
        payload = {
            "version": 1,
            "node_id": "node_1",
            "seq": -5,
            "uptime_ms": 1000,
            "mode": "normal",
        }
        with pytest.raises(ValidationError) as exc:
            validate_telemetry_payload(json.dumps(payload).encode("utf-8"))
        assert "'seq' must be a non-negative integer" in str(exc.value)

        # String sequence
        payload["seq"] = "1042"
        with pytest.raises(ValidationError) as exc:
            validate_telemetry_payload(json.dumps(payload).encode("utf-8"))
        assert "'seq' must be an integer" in str(exc.value)

        # Float sequence
        payload["seq"] = 12.5
        with pytest.raises(ValidationError) as exc:
            validate_telemetry_payload(json.dumps(payload).encode("utf-8"))
        assert "'seq' must be an integer" in str(exc.value)

        # Boolean sequence (True is a subclass of int in Python; must be explicitly rejected)
        payload["seq"] = True
        with pytest.raises(ValidationError) as exc:
            validate_telemetry_payload(json.dumps(payload).encode("utf-8"))
        assert "'seq' must be an integer" in str(exc.value)

    def test_invalid_uptime_types(self):
        payload = {
            "version": 1,
            "node_id": "node_1",
            "seq": 1,
            "uptime_ms": -100,
            "mode": "normal",
        }
        with pytest.raises(ValidationError) as exc:
            validate_telemetry_payload(json.dumps(payload).encode("utf-8"))
        assert "'uptime_ms' must be a non-negative integer" in str(exc.value)

        # Boolean uptime
        payload["uptime_ms"] = False
        with pytest.raises(ValidationError) as exc:
            validate_telemetry_payload(json.dumps(payload).encode("utf-8"))
        assert "'uptime_ms' must be an integer" in str(exc.value)

    @pytest.mark.parametrize("invalid_mode", ["idle", "attack", "standby", "NORMAL", "BURST", ""])
    def test_invalid_mode(self, invalid_mode: str):
        payload = {
            "version": 1,
            "node_id": "node_1",
            "seq": 1,
            "uptime_ms": 1000,
            "mode": invalid_mode,
        }
        with pytest.raises(ValidationError) as exc:
            validate_telemetry_payload(json.dumps(payload).encode("utf-8"))
        assert "Invalid mode" in str(exc.value)

    def test_extra_json_fields_rejected_under_closed_schema(self):
        payload = {
            "version": 1,
            "node_id": "node_1",
            "seq": 1,
            "uptime_ms": 1000,
            "mode": "normal",
            "extra_metric": 42,
        }
        raw_bytes = json.dumps(payload).encode("utf-8")
        with pytest.raises(ValidationError) as exc_info:
            validate_telemetry_payload(raw_bytes)
        assert "Unexpected extra field" in str(exc_info.value)


# =============================================================================
# 2. Per-Node State and Sequence Tracking Tests
# =============================================================================

class TestNodeTelemetryState:
    """Unit tests for NodeTelemetryState sequence tracking and rate calculations."""

    def test_initial_state_clean(self):
        state = NodeTelemetryState(node_id="node_1")
        assert not state.is_observed
        assert state.valid_packets_count == 0
        assert state.unique_packets_count == 0
        assert state.last_seq is None
        assert state.get_observed_rate() == 0.0

    def test_first_seq_not_treated_as_loss(self):
        state = NodeTelemetryState(node_id="node_1")
        pkt = TelemetryPacket(
            version=1,
            node_id="node_1",
            seq=500,
            uptime_ms=10000,
            mode="normal",
            received_time_utc="2026-10-24T12:00:00Z",
            received_time_monotonic=100.0,
            source_address=("127.0.0.1", 5005),
        )
        state.record_packet(pkt)

        assert state.is_observed
        assert state.first_seq == 500
        assert state.last_seq == 500
        assert state.valid_packets_count == 1
        assert state.unique_packets_count == 1
        assert state.sequence_gaps_count == 0
        assert state.total_lost_packets_estimate == 0

    def test_consecutive_in_order_sequences(self):
        state = NodeTelemetryState(node_id="node_1")
        for i in range(1, 11):
            pkt = TelemetryPacket(
                version=1,
                node_id="node_1",
                seq=i,
                uptime_ms=1000 + i * 200,
                mode="normal",
                received_time_utc="2026-10-24T12:00:00Z",
                received_time_monotonic=100.0 + i * 0.2,
                source_address=("127.0.0.1", 5005),
            )
            state.record_packet(pkt)

        assert state.valid_packets_count == 10
        assert state.unique_packets_count == 10
        assert state.last_seq == 10
        assert state.sequence_gaps_count == 0
        assert state.duplicate_or_reordered_count == 0

    def test_sequence_gap_detection(self):
        state = NodeTelemetryState(node_id="node_1")
        # Packet 1
        state.record_packet(
            TelemetryPacket(
                version=1, node_id="node_1", seq=10, uptime_ms=1000,
                mode="normal", received_time_utc="T1", received_time_monotonic=10.0,
                source_address=("127.0.0.1", 5005)
            )
        )
        # Packet 2 with gap: expected 11, got 15 (gap of 3: 11, 12, 13, 14 missing)
        state.record_packet(
            TelemetryPacket(
                version=1, node_id="node_1", seq=15, uptime_ms=2000,
                mode="normal", received_time_utc="T2", received_time_monotonic=11.0,
                source_address=("127.0.0.1", 5005)
            )
        )

        assert state.sequence_gaps_count == 1
        assert state.total_lost_packets_estimate == 4  # 15 - 10 - 1 = 4
        assert state.last_seq == 15
        assert state.valid_packets_count == 2
        assert state.unique_packets_count == 2

    def test_duplicate_and_out_of_order_packets(self):
        state = NodeTelemetryState(node_id="node_1")
        # In-order seq 1, 2
        for s in [1, 2]:
            state.record_packet(
                TelemetryPacket(
                    version=1, node_id="node_1", seq=s, uptime_ms=s * 200,
                    mode="normal", received_time_utc="T", received_time_monotonic=10.0 + s,
                    source_address=("127.0.0.1", 5005)
                )
            )

        # Duplicate seq 2
        state.record_packet(
            TelemetryPacket(
                version=1, node_id="node_1", seq=2, uptime_ms=450,
                mode="normal", received_time_utc="T", received_time_monotonic=12.1,
                source_address=("127.0.0.1", 5005)
            )
        )

        # Out-of-order seq 1
        state.record_packet(
            TelemetryPacket(
                version=1, node_id="node_1", seq=1, uptime_ms=460,
                mode="normal", received_time_utc="T", received_time_monotonic=12.2,
                source_address=("127.0.0.1", 5005)
            )
        )

        # Policy assertion: duplicates count in valid_packets_count, but not unique_packets_count
        assert state.valid_packets_count == 4
        assert state.unique_packets_count == 2
        assert state.duplicate_or_reordered_count == 2
        assert state.last_seq == 2

    def test_unsigned_32bit_rollover(self):
        state = NodeTelemetryState(node_id="node_1")
        # High sequence number near 2^32 - 1
        state.record_packet(
            TelemetryPacket(
                version=1, node_id="node_1", seq=4_294_967_295, uptime_ms=1000,
                mode="normal", received_time_utc="T1", received_time_monotonic=10.0,
                source_address=("127.0.0.1", 5005)
            )
        )
        # Next packet rolls over to 0
        state.record_packet(
            TelemetryPacket(
                version=1, node_id="node_1", seq=0, uptime_ms=1200,
                mode="normal", received_time_utc="T2", received_time_monotonic=10.2,
                source_address=("127.0.0.1", 5005)
            )
        )

        assert state.last_seq == 0
        assert state.valid_packets_count == 2
        assert state.unique_packets_count == 2
        assert state.duplicate_or_reordered_count == 0


# =============================================================================
# 3. HardwareReceiver Lifecycle & Sockets Integration Tests
# =============================================================================

class TestHardwareReceiverLifecycle:
    """Integration tests running HardwareReceiver over localhost ephemeral sockets."""

    def test_receiver_start_stop_ephemeral(self):
        receiver = HardwareReceiver(host="127.0.0.1", port=0)
        assert not receiver.is_running

        receiver.start()
        try:
            assert receiver.is_running
            assert receiver.port > 0
            status = receiver.get_status()
            assert status["is_running"] is True
            assert status["bind_port"] == receiver.port
        finally:
            receiver.stop()

        assert not receiver.is_running
        assert receiver._socket is None

    def test_double_start_raises_error(self):
        receiver = HardwareReceiver(host="127.0.0.1", port=0)
        receiver.start()
        try:
            with pytest.raises(RuntimeError):
                receiver.start()
        finally:
            receiver.stop()

    def test_context_manager(self):
        with HardwareReceiver(host="127.0.0.1", port=0) as receiver:
            assert receiver.is_running
            assert receiver.port > 0
        assert not receiver.is_running

    def test_receive_valid_localhost_datagram(self):
        with HardwareReceiver(host="127.0.0.1", port=0) as receiver:
            # Send valid UDP datagram to ephemeral receiver port
            client_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            payload = {
                "version": 1,
                "node_id": "node_1",
                "seq": 101,
                "uptime_ms": 2500,
                "mode": "normal",
            }
            client_sock.sendto(json.dumps(payload).encode("utf-8"), ("127.0.0.1", receiver.port))
            client_sock.close()

            # Wait briefly for worker thread to process
            time.sleep(0.1)

            status = receiver.get_status()
            assert status["total_socket_datagrams"] == 1
            assert status["valid_datagrams"] == 1
            assert status["malformed_datagrams"] == 0
            assert status["observed_nodes_count"] == 1

            node_1 = status["nodes"]["node_1"]
            assert node_1["is_observed"] is True
            assert node_1["valid_packets_count"] == 1
            assert node_1["last_seq"] == 101
            assert node_1["last_mode"] == "normal"
            assert node_1["last_uptime_ms"] == 2500

    def test_malformed_datagram_does_not_crash_receiver(self):
        with HardwareReceiver(host="127.0.0.1", port=0) as receiver:
            client_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

            # 1. Send completely invalid bytes
            client_sock.sendto(b"GARBAGE_PAYLOAD_NOT_JSON", ("127.0.0.1", receiver.port))
            # 2. Send missing field
            client_sock.sendto(b'{"version": 1, "seq": 1}', ("127.0.0.1", receiver.port))
            # 3. Send valid datagram
            valid_payload = {
                "version": 1,
                "node_id": "node_2",
                "seq": 1,
                "uptime_ms": 100,
                "mode": "normal",
            }
            client_sock.sendto(json.dumps(valid_payload).encode("utf-8"), ("127.0.0.1", receiver.port))
            client_sock.close()

            time.sleep(0.15)

            status = receiver.get_status()
            assert status["is_running"] is True  # Listener remained alive!
            assert status["total_socket_datagrams"] == 3
            assert status["malformed_datagrams"] == 2
            assert status["valid_datagrams"] == 1
            assert status["nodes"]["node_2"]["is_observed"] is True

    def test_multiple_nodes_isolated_state(self):
        with HardwareReceiver(host="127.0.0.1", port=0) as receiver:
            client_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

            # Transmit 3 packets from node_1 and 2 packets from node_4 (burst)
            for s in [1, 2, 3]:
                pkt = {"version": 1, "node_id": "node_1", "seq": s, "uptime_ms": s * 200, "mode": "normal"}
                client_sock.sendto(json.dumps(pkt).encode("utf-8"), ("127.0.0.1", receiver.port))

            for s in [100, 101]:
                pkt = {"version": 1, "node_id": "node_4", "seq": s, "uptime_ms": s * 20, "mode": "burst"}
                client_sock.sendto(json.dumps(pkt).encode("utf-8"), ("127.0.0.1", receiver.port))

            client_sock.close()
            time.sleep(0.15)

            status = receiver.get_status()
            assert status["valid_datagrams"] == 5
            assert status["observed_nodes_count"] == 2

            n1 = status["nodes"]["node_1"]
            n4 = status["nodes"]["node_4"]
            n2 = status["nodes"]["node_2"]

            assert n1["valid_packets_count"] == 3
            assert n1["last_seq"] == 3
            assert n1["last_mode"] == "normal"

            assert n4["valid_packets_count"] == 2
            assert n4["last_seq"] == 101
            assert n4["last_mode"] == "burst"

            assert n2["is_observed"] is False
            assert n2["valid_packets_count"] == 0

    def test_on_packet_callback(self):
        received_callbacks = []

        def callback(pkt: TelemetryPacket):
            received_callbacks.append(pkt)

        with HardwareReceiver(host="127.0.0.1", port=0, on_packet_received=callback) as receiver:
            client_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            payload = {
                "version": 1,
                "node_id": "node_3",
                "seq": 42,
                "uptime_ms": 999,
                "mode": "normal",
            }
            client_sock.sendto(json.dumps(payload).encode("utf-8"), ("127.0.0.1", receiver.port))
            client_sock.close()

            time.sleep(0.1)

            assert len(received_callbacks) == 1
            assert received_callbacks[0].node_id == "node_3"
            assert received_callbacks[0].seq == 42
