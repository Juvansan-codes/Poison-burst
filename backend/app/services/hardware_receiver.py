"""
PoissonBurst Lab - Hardware UDP Receiver Service.

Listens for UDP datagrams transmitted by Arduino UNO R4 WiFi nodes, validates
telemetry payloads, tracks per-node sequence numbers and arrival rates, and maintains
thread-safe operational status.

Target Protocol Schema (JSON):
{
  "version": 1,
  "node_id": "node_1",
  "seq": 1042,
  "uptime_ms": 128450,
  "mode": "normal"
}
"""

from __future__ import annotations

import collections
import json
import logging
import socket
import threading
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)

# Protocol & Validation Invariants
SUPPORTED_PROTOCOL_VERSIONS: Set[int] = {1, 2}
SUPPORTED_PROTOCOL_VERSION: int = 1  # Backward compatibility alias
VALID_NODE_IDS: Set[str] = {"node_1", "node_2", "node_3", "node_4"}
VALID_MODES: Set[str] = {"normal", "burst"}
MAX_PAYLOAD_BYTES: int = 512
ALLOW_EXTRA_FIELDS: bool = False  # Closed schema validation policy


class ValidationError(Exception):
    """Raised when an incoming UDP datagram violates the protocol specification."""
    pass


@dataclass(frozen=True)
class TelemetryPacket:
    """Validated telemetry observation emitted by an Arduino traffic node."""
    version: int
    node_id: str
    seq: int
    uptime_ms: int
    mode: str
    received_time_utc: str
    received_time_monotonic: float
    source_address: Tuple[str, int]
    boot_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def validate_telemetry_payload(
    raw_data: bytes,
    source_address: Tuple[str, int] = ("0.0.0.0", 0),
) -> TelemetryPacket:
    """Validate and decode a raw UDP datagram into a TelemetryPacket.

    Validation Rules:
    1. Payload must not be empty.
    2. Payload must not exceed MAX_PAYLOAD_BYTES (512 bytes).
    3. Payload must be valid UTF-8.
    4. Payload must parse into a JSON object (dict).
    5. 'version' must be an integer in SUPPORTED_PROTOCOL_VERSIONS (1 or 2).
    6. For version 1, required fields are: version, node_id, seq, uptime_ms, mode.
    7. For version 2, required fields are: version, node_id, seq, uptime_ms, mode, boot_id.
    8. 'boot_id' (V2 only) must be a non-empty string with length <= 64.
    9. 'node_id' must be one of the known identities: node_1, node_2, node_3, node_4.
    10. 'seq' must be a non-negative integer. (Booleans explicitly rejected).
    11. 'uptime_ms' must be a non-negative integer. (Booleans explicitly rejected).
    12. 'mode' must be strictly 'normal' or 'burst'.
    13. Extra unexpected JSON keys are rejected if ALLOW_EXTRA_FIELDS is False.

    Args:
        raw_data: Raw byte payload from socket.recvfrom().
        source_address: (ip, port) tuple of the sending socket.

    Returns:
        TelemetryPacket: Structured, immutable observation record.

    Raises:
        ValidationError: If any protocol requirement is violated.
    """
    if raw_data is None or len(raw_data) == 0:
        raise ValidationError("Empty datagram received.")

    if len(raw_data) > MAX_PAYLOAD_BYTES:
        raise ValidationError(
            f"Payload size ({len(raw_data)} bytes) exceeds maximum limit of {MAX_PAYLOAD_BYTES} bytes."
        )

    try:
        text = raw_data.decode("utf-8")
    except UnicodeDecodeError as err:
        raise ValidationError(f"Payload contains invalid UTF-8: {err}") from err

    try:
        data = json.loads(text)
    except json.JSONDecodeError as err:
        raise ValidationError(f"Malformed JSON syntax: {err}") from err

    if not isinstance(data, dict):
        raise ValidationError(f"Payload root must be a JSON object, got {type(data).__name__}.")

    # 1. Version validation
    ver = data.get("version")
    if ver is None:
        raise ValidationError("Missing required payload field(s): ['version'].")
    if isinstance(ver, bool) or not isinstance(ver, int):
        raise ValidationError(f"'version' must be an integer, got {type(ver).__name__}.")
    if ver not in SUPPORTED_PROTOCOL_VERSIONS:
        raise ValidationError(
            f"Unsupported protocol version {ver}. Expected version in {sorted(list(SUPPORTED_PROTOCOL_VERSIONS))}."
        )

    # 2. Schema field requirements based on version
    if ver == 1:
        required_keys = {"version", "node_id", "seq", "uptime_ms", "mode"}
    else:  # ver == 2
        required_keys = {"version", "node_id", "seq", "uptime_ms", "mode", "boot_id"}

    present_keys = set(data.keys())
    missing_keys = required_keys - present_keys
    if missing_keys:
        raise ValidationError(f"Missing required payload field(s): {sorted(list(missing_keys))}.")

    if not ALLOW_EXTRA_FIELDS:
        extra_keys = present_keys - required_keys
        if extra_keys:
            raise ValidationError(f"Unexpected extra field(s) in payload: {sorted(list(extra_keys))}.")

    # 3. Node ID validation
    node = data["node_id"]
    if not isinstance(node, str) or not node:
        raise ValidationError(f"'node_id' must be a non-empty string, got {type(node).__name__}.")
    if node not in VALID_NODE_IDS:
        raise ValidationError(
            f"Invalid node_id '{node}'. Must be one of: {sorted(list(VALID_NODE_IDS))}."
        )

    # 4. Sequence number validation (Note: in Python isinstance(True, int) is True, so explicitly check bool)
    seq = data["seq"]
    if isinstance(seq, bool) or not isinstance(seq, int):
        raise ValidationError(f"'seq' must be an integer, got {type(seq).__name__}.")
    if seq < 0:
        raise ValidationError(f"'seq' must be a non-negative integer, got {seq}.")

    # 5. Uptime validation
    uptime = data["uptime_ms"]
    if isinstance(uptime, bool) or not isinstance(uptime, int):
        raise ValidationError(f"'uptime_ms' must be an integer, got {type(uptime).__name__}.")
    if uptime < 0:
        raise ValidationError(f"'uptime_ms' must be a non-negative integer, got {uptime}.")

    # 6. Mode validation
    mode = data["mode"]
    if not isinstance(mode, str):
        raise ValidationError(f"'mode' must be a string, got {type(mode).__name__}.")
    if mode not in VALID_MODES:
        raise ValidationError(
            f"Invalid mode '{mode}'. Must be one of: {sorted(list(VALID_MODES))}."
        )

    # 7. Boot ID validation (Protocol V2)
    boot_id: Optional[str] = None
    if ver == 2:
        bid = data["boot_id"]
        if isinstance(bid, bool) or not isinstance(bid, str):
            raise ValidationError(f"'boot_id' must be a string, got {type(bid).__name__}.")
        bid_clean = bid.strip()
        if not bid_clean or len(bid_clean) > 64:
            raise ValidationError(
                f"'boot_id' must be a non-empty string with length <= 64, got length {len(bid)}."
            )
        boot_id = bid_clean

    now_utc = datetime.now(timezone.utc).isoformat()
    now_mono = time.monotonic()

    return TelemetryPacket(
        version=ver,
        node_id=node,
        seq=seq,
        uptime_ms=uptime,
        mode=mode,
        received_time_utc=now_utc,
        received_time_monotonic=now_mono,
        source_address=source_address,
        boot_id=boot_id,
    )


@dataclass
class NodeTelemetryState:
    """Maintains sequence history, statistics, and health for a single logical node."""
    node_id: str
    is_observed: bool = False
    valid_packets_count: int = 0
    unique_packets_count: int = 0
    last_seq: Optional[int] = None
    first_seq: Optional[int] = None
    last_receipt_time_utc: Optional[str] = None
    last_receipt_time_monotonic: Optional[float] = None
    first_receipt_time_monotonic: Optional[float] = None
    last_uptime_ms: Optional[int] = None
    last_mode: Optional[str] = None
    last_source_addr: Optional[Tuple[str, int]] = None
    malformed_packets_count: int = 0
    sequence_gaps_count: int = 0
    total_lost_packets_estimate: int = 0
    duplicate_or_reordered_count: int = 0

    # Protocol V2 Boot Session & Reboot Tracking
    active_boot_id: Optional[str] = None
    retired_boot_ids: Set[str] = field(default_factory=set)
    boot_transitions_count: int = 0
    boot_transitions: List[Dict[str, Any]] = field(default_factory=list)

    # Rolling window of recent arrival timestamps for responsive rate calculation (last 5 seconds)
    _recent_arrival_timestamps: collections.deque = field(
        default_factory=lambda: collections.deque(maxlen=500),
        repr=False,
    )

    def record_packet(self, packet: TelemetryPacket) -> None:
        """Update node state with an accepted, validated telemetry packet."""
        mono = packet.received_time_monotonic
        is_v2 = (packet.version >= 2 and packet.boot_id is not None)

        if not is_v2:
            # Protocol V1: Strict monotonic sequence tracking (no reboot detection)
            if self.first_seq is None:
                self.first_seq = packet.seq
                self.first_receipt_time_monotonic = mono
                self.last_seq = packet.seq
                self.unique_packets_count = 1
            else:
                prev_seq = self.last_seq if self.last_seq is not None else 0
                expected_seq = (prev_seq + 1) & 0xFFFFFFFF

                if packet.seq == expected_seq:
                    # Normal in-order sequence
                    self.last_seq = packet.seq
                    self.unique_packets_count += 1
                elif packet.seq > prev_seq:
                    # Sequence gap detected (packet loss or transmission failure)
                    gap = packet.seq - prev_seq - 1
                    self.sequence_gaps_count += 1
                    self.total_lost_packets_estimate += gap
                    self.last_seq = packet.seq
                    self.unique_packets_count += 1
                else:
                    # packet.seq <= prev_seq
                    # Check for 32-bit unsigned integer rollover (~4.29 billion)
                    if prev_seq > 4_000_000_000 and packet.seq < 1_000_000:
                        rollover_gap = (packet.seq - prev_seq) & 0xFFFFFFFF
                        if rollover_gap > 1:
                            self.sequence_gaps_count += 1
                            self.total_lost_packets_estimate += (rollover_gap - 1)
                        self.last_seq = packet.seq
                        self.unique_packets_count += 1
                    else:
                        # Duplicate packet or out-of-order delivery
                        self.duplicate_or_reordered_count += 1
        else:
            # Protocol V2: Boot-aware sequence tracking and reboot recovery
            if self.active_boot_id is None:
                # First observation of this node under Protocol V2
                self.active_boot_id = packet.boot_id
                if self.first_seq is None:
                    self.first_seq = packet.seq
                    self.first_receipt_time_monotonic = mono
                self.last_seq = packet.seq
                self.unique_packets_count = 1
            elif packet.boot_id == self.active_boot_id:
                # Normal packet in active boot session
                prev_seq = self.last_seq if self.last_seq is not None else 0
                expected_seq = (prev_seq + 1) & 0xFFFFFFFF

                if packet.seq == expected_seq:
                    self.last_seq = packet.seq
                    self.unique_packets_count += 1
                elif packet.seq > prev_seq:
                    gap = packet.seq - prev_seq - 1
                    self.sequence_gaps_count += 1
                    self.total_lost_packets_estimate += gap
                    self.last_seq = packet.seq
                    self.unique_packets_count += 1
                else:
                    if prev_seq > 4_000_000_000 and packet.seq < 1_000_000:
                        rollover_gap = (packet.seq - prev_seq) & 0xFFFFFFFF
                        if rollover_gap > 1:
                            self.sequence_gaps_count += 1
                            self.total_lost_packets_estimate += (rollover_gap - 1)
                        self.last_seq = packet.seq
                        self.unique_packets_count += 1
                    else:
                        # Duplicate within active boot session
                        self.duplicate_or_reordered_count += 1
            elif packet.boot_id in self.retired_boot_ids:
                # Delayed packet from a previously retired boot session
                # Policy: Do NOT switch session back. Count as duplicate/reordered.
                self.duplicate_or_reordered_count += 1
            else:
                # New, previously unseen boot_id -> REBOOT DETECTED!
                old_boot = self.active_boot_id
                self.retired_boot_ids.add(old_boot)
                transition_record = {
                    "transition_time_utc": packet.received_time_utc,
                    "transition_time_monotonic": mono,
                    "from_boot_id": old_boot,
                    "to_boot_id": packet.boot_id,
                    "last_seq_before_reboot": self.last_seq,
                    "initial_seq_after_reboot": packet.seq,
                }
                self.boot_transitions.append(transition_record)
                self.boot_transitions_count += 1
                self.active_boot_id = packet.boot_id
                self.last_seq = packet.seq
                self.unique_packets_count += 1

        self.valid_packets_count += 1
        self.is_observed = True
        self.last_receipt_time_utc = packet.received_time_utc
        self.last_receipt_time_monotonic = mono
        self.last_uptime_ms = packet.uptime_ms
        self.last_mode = packet.mode
        self.last_source_addr = packet.source_address

        self._recent_arrival_timestamps.append(mono)

    def record_malformed(self) -> None:
        """Increment malformed packet counter attributed to this node."""
        self.malformed_packets_count += 1

    def get_observed_rate(self, current_mono: Optional[float] = None) -> float:
        """Compute the current observed arrival rate in events/second.

        Uses a rolling 5.0-second window if available, falling back to lifetime
        elapsed time. Returns 0.0 if insufficient observations exist.
        """
        now = current_mono if current_mono is not None else time.monotonic()

        # Clean old timestamps older than 5.0s
        cutoff = now - 5.0
        while self._recent_arrival_timestamps and self._recent_arrival_timestamps[0] < cutoff:
            self._recent_arrival_timestamps.popleft()

        window_count = len(self._recent_arrival_timestamps)
        if window_count >= 2:
            span = self._recent_arrival_timestamps[-1] - self._recent_arrival_timestamps[0]
            if span > 0.05:
                return round((window_count - 1) / span, 2)

        # Fallback to lifetime rate
        if self.first_receipt_time_monotonic and self.valid_packets_count >= 2:
            lifetime_span = now - self.first_receipt_time_monotonic
            if lifetime_span > 0.1:
                return round(self.valid_packets_count / lifetime_span, 2)

        return 0.0

    def to_dict(self) -> Dict[str, Any]:
        """Produce JSON-serializable status dictionary for this node."""
        return {
            "node_id": self.node_id,
            "is_observed": self.is_observed,
            "valid_packets_count": self.valid_packets_count,
            "unique_packets_count": self.unique_packets_count,
            "last_seq": self.last_seq,
            "first_seq": self.first_seq,
            "last_receipt_time_utc": self.last_receipt_time_utc,
            "last_uptime_ms": self.last_uptime_ms,
            "last_mode": self.last_mode,
            "last_source_addr": (
                f"{self.last_source_addr[0]}:{self.last_source_addr[1]}"
                if self.last_source_addr else None
            ),
            "malformed_packets_count": self.malformed_packets_count,
            "sequence_gaps_count": self.sequence_gaps_count,
            "total_lost_packets_estimate": self.total_lost_packets_estimate,
            "duplicate_or_reordered_count": self.duplicate_or_reordered_count,
            "active_boot_id": self.active_boot_id,
            "retired_boot_ids": sorted(list(self.retired_boot_ids)),
            "boot_transitions_count": self.boot_transitions_count,
            "boot_transitions": self.boot_transitions,
            "observed_rate_hz": self.get_observed_rate(),
        }


class HardwareReceiver:
    """Thread-safe, non-blocking UDP receiver for Arduino UNO R4 WiFi traffic nodes.

    Attributes:
        host: Local IPv4 interface to bind (default: '0.0.0.0').
        port: UDP port to listen on (default: 5005). Set to 0 for ephemeral port.
        socket_timeout: Socket timeout in seconds for clean shutdown polling.
    """

    def __init__(
        self,
        host: str = "0.0.0.0",
        port: int = 5005,
        socket_timeout: float = 0.5,
        on_packet_received: Optional[Callable[[TelemetryPacket], None]] = None,
    ) -> None:
        self.host = host
        self.port = port
        self.socket_timeout = socket_timeout
        self.on_packet_received = on_packet_received

        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._worker_thread: Optional[threading.Thread] = None
        self._socket: Optional[socket.socket] = None

        self._is_running = False
        self._started_at_utc: Optional[str] = None
        self._started_at_monotonic: Optional[float] = None
        self._last_receipt_utc: Optional[str] = None

        # Global Counters
        self.total_socket_datagrams: int = 0
        self.valid_datagrams: int = 0
        self.malformed_datagrams: int = 0

        # Isolated Per-Node State
        self._nodes: Dict[str, NodeTelemetryState] = {
            nid: NodeTelemetryState(node_id=nid) for nid in sorted(list(VALID_NODE_IDS))
        }

    @property
    def is_running(self) -> bool:
        """Return True if receiver background listener thread is active."""
        return self._is_running

    def start(self) -> None:
        """Bind UDP socket and launch background receiver worker thread.

        Raises:
            RuntimeError: If receiver is already running.
            OSError: If socket binding fails.
        """
        with self._lock:
            if self._is_running:
                raise RuntimeError("HardwareReceiver is already running.")

            self._stop_event.clear()

            # Create and configure IPv4 UDP socket
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            try:
                # Allow port reuse if safe
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.settimeout(self.socket_timeout)
                sock.bind((self.host, self.port))

                # Update bound port in case port 0 (ephemeral) was requested
                actual_addr = sock.getsockname()
                self.port = actual_addr[1]

                self._socket = sock
                self._is_running = True
                self._started_at_utc = datetime.now(timezone.utc).isoformat()
                self._started_at_monotonic = time.monotonic()
            except Exception:
                sock.close()
                raise

            self._worker_thread = threading.Thread(
                target=self._listener_loop,
                name="HardwareReceiverListener",
                daemon=True,
            )
            self._worker_thread.start()
            logger.info(f"HardwareReceiver started on {self.host}:{self.port}")

    def stop(self, timeout: float = 2.0) -> None:
        """Signal listener thread to terminate, close socket, and wait for thread exit."""
        with self._lock:
            if not self._is_running:
                return
            self._is_running = False
            self._stop_event.set()

        # Join outside lock to avoid deadlocks
        if self._worker_thread and self._worker_thread.is_alive():
            self._worker_thread.join(timeout=timeout)
            self._worker_thread = None

        with self._lock:
            if self._socket:
                try:
                    self._socket.close()
                except Exception as err:
                    logger.debug(f"Error closing socket: {err}")
                finally:
                    self._socket = None

            logger.info("HardwareReceiver stopped cleanly.")

    def _listener_loop(self) -> None:
        """Internal daemon loop consuming incoming datagrams."""
        sock = self._socket
        if not sock:
            return

        while not self._stop_event.is_set():
            try:
                raw_data, source_addr = sock.recvfrom(2048)
            except socket.timeout:
                continue
            except OSError:
                # Socket was closed or encountered an OS error
                break

            with self._lock:
                self.total_socket_datagrams += 1

                try:
                    packet = validate_telemetry_payload(raw_data, source_addr)
                except ValidationError as err:
                    self.malformed_datagrams += 1
                    # Attempt partial decode to attribute malformed count to specific node if possible
                    try:
                        partial_obj = json.loads(raw_data.decode("utf-8", errors="ignore"))
                        if isinstance(partial_obj, dict) and partial_obj.get("node_id") in self._nodes:
                            self._nodes[partial_obj["node_id"]].record_malformed()
                    except Exception:
                        pass
                    logger.debug(f"Rejected invalid datagram from {source_addr}: {err}")
                    continue

                # Process accepted valid packet
                node_state = self._nodes[packet.node_id]
                node_state.record_packet(packet)

                self.valid_datagrams += 1
                self._last_receipt_utc = packet.received_time_utc

            # Trigger optional callback outside lock
            if self.on_packet_received:
                try:
                    self.on_packet_received(packet)
                except Exception as cb_err:
                    logger.error(f"Error in on_packet_received callback: {cb_err}", exc_info=True)

    def get_status(self) -> Dict[str, Any]:
        """Return a complete, thread-safe status snapshot of the receiver and all nodes."""
        with self._lock:
            now_mono = time.monotonic()
            elapsed_sec = (
                round(now_mono - self._started_at_monotonic, 2)
                if self._started_at_monotonic else 0.0
            )

            # Overall observed rate across all nodes
            overall_rate = 0.0
            if elapsed_sec > 0.1 and self.valid_datagrams > 0:
                overall_rate = round(self.valid_datagrams / elapsed_sec, 2)

            observed_nodes = sum(1 for n in self._nodes.values() if n.is_observed)
            unique_datagrams = sum(n.unique_packets_count for n in self._nodes.values())

            nodes_snapshot = {
                nid: n.to_dict() for nid, n in self._nodes.items()
            }

            return {
                "is_running": self._is_running,
                "bind_host": self.host,
                "bind_port": self.port,
                "started_at_utc": self._started_at_utc,
                "uptime_seconds": elapsed_sec,
                "total_socket_datagrams": self.total_socket_datagrams,
                "valid_datagrams": self.valid_datagrams,
                "unique_datagrams": unique_datagrams,
                "malformed_datagrams": self.malformed_datagrams,
                "observed_nodes_count": observed_nodes,
                "overall_observed_rate_hz": overall_rate,
                "last_receipt_timestamp_utc": self._last_receipt_utc,
                "nodes": nodes_snapshot,
            }

    def reset_statistics(self) -> None:
        """Reset counters and node history while preserving running state and socket."""
        with self._lock:
            self.total_socket_datagrams = 0
            self.valid_datagrams = 0
            self.malformed_datagrams = 0
            self._started_at_monotonic = time.monotonic()
            self._started_at_utc = datetime.now(timezone.utc).isoformat()
            self._last_receipt_utc = None
            self._nodes = {
                nid: NodeTelemetryState(node_id=nid) for nid in sorted(list(VALID_NODE_IDS))
            }

    def __enter__(self) -> "HardwareReceiver":
        self.start()
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.stop()
