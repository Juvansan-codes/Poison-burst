"""
PoissonBurst Lab - Hardware-Free Multi-Node UDP Traffic Simulator.

Simulates up to four independent Arduino UNO R4 WiFi nodes transmitting
synthetic Poisson arrival telemetry over UDP to the HardwareReceiver service.

Key Features:
- Models Poisson arrivals using exponentially distributed inter-arrival times:
    T = -ln(U) / lambda
- Independent pseudorandom number generators and sequence counters per node.
- Supports scheduled burst activation for node_4 (normal -> burst -> normal).
- Fully non-blocking, multi-threaded architecture with clean shutdown on stop().
- Standard local destination: 127.0.0.1:5005 (configurable for ephemeral test ports).
"""

from __future__ import annotations

import json
import logging
import math
import random
import socket
import threading
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

logger = logging.getLogger(__name__)

SUPPORTED_NODE_IDS: Set[str] = {"node_1", "node_2", "node_3", "node_4"}


@dataclass
class SimulatedNodeConfig:
    """Configuration for an individual simulated Arduino node."""
    node_id: str
    normal_rate_hz: float = 5.0
    burst_rate_hz: float = 50.0
    is_burst_capable: bool = False
    burst_start_second: Optional[float] = None
    burst_duration_seconds: Optional[float] = None
    initial_mode: str = "normal"
    random_seed: Optional[int] = None

    def __post_init__(self) -> None:
        if self.node_id not in SUPPORTED_NODE_IDS:
            raise ValueError(
                f"Invalid node_id '{self.node_id}'. Must be one of: {sorted(list(SUPPORTED_NODE_IDS))}."
            )
        if self.normal_rate_hz <= 0.0:
            raise ValueError(f"normal_rate_hz must be strictly positive, got {self.normal_rate_hz}.")
        if self.burst_rate_hz <= 0.0:
            raise ValueError(f"burst_rate_hz must be strictly positive, got {self.burst_rate_hz}.")
        if self.burst_start_second is not None and self.burst_start_second < 0.0:
            raise ValueError("burst_start_second cannot be negative.")
        if self.burst_duration_seconds is not None and self.burst_duration_seconds <= 0.0:
            raise ValueError("burst_duration_seconds must be strictly positive.")


@dataclass
class NodeSenderStats:
    """Real-time transmission statistics for a single simulated node."""
    node_id: str
    attempts_total: int = 0
    attempts_normal: int = 0
    attempts_burst: int = 0
    attempts_failed: int = 0
    last_seq: int = 0
    current_mode: str = "normal"
    elapsed_seconds: float = 0.0
    observed_send_rate_hz: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class SimulatedNode:
    """Simulates a single physical Arduino UNO R4 WiFi traffic node in software.

    Runs an independent worker thread, drawing inter-arrival intervals from an
    exponential distribution with parameter lambda and transmitting compact JSON
    telemetry datagrams over UDP.
    """

    def __init__(
        self,
        config: SimulatedNodeConfig,
        dest_host: str,
        dest_port: int,
        stop_event: threading.Event,
        global_start_monotonic: float,
    ) -> None:
        self.config = config
        self.dest_host = dest_host
        self.dest_port = dest_port
        self.stop_event = stop_event
        self.global_start_monotonic = global_start_monotonic

        # Initialize independent pseudorandom generator
        self.rng = random.Random(config.random_seed)

        self._lock = threading.Lock()
        self.current_mode = config.initial_mode
        self.seq = 0
        self.attempts_total = 0
        self.attempts_normal = 0
        self.attempts_burst = 0
        self.attempts_failed = 0
        self.start_monotonic = 0.0

    def sample_exponential_interval(self, rate_hz: float) -> float:
        """Sample inter-arrival duration T = -ln(U) / lambda seconds."""
        if rate_hz <= 0.0:
            rate_hz = 1.0
        # Sample U strictly in (0, 1)
        u = self.rng.uniform(1e-7, 1.0 - 1e-7)
        t = -math.log(u) / rate_hz
        # Minimum physical floor (100 microseconds)
        return max(0.0001, t)

    def _determine_mode(self, elapsed_sec: float) -> str:
        """Evaluate scheduled burst activation for this node."""
        if not self.config.is_burst_capable:
            return "normal"

        if (
            self.config.burst_start_second is not None
            and self.config.burst_duration_seconds is not None
        ):
            b_start = self.config.burst_start_second
            b_end = b_start + self.config.burst_duration_seconds
            if b_start <= elapsed_sec < b_end:
                return "burst"
            return "normal"

        return self.current_mode

    def run(self) -> None:
        """Worker loop executed in a dedicated sender thread."""
        self.start_monotonic = time.monotonic()
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

        # Drift-free scheduler reference
        next_target_time = self.start_monotonic

        try:
            while not self.stop_event.is_set():
                now_mono = time.monotonic()
                elapsed_since_global = now_mono - self.global_start_monotonic

                # 1. Evaluate mode based on schedule
                active_mode = self._determine_mode(elapsed_since_global)
                with self._lock:
                    self.current_mode = active_mode

                rate = (
                    self.config.burst_rate_hz
                    if active_mode == "burst"
                    else self.config.normal_rate_hz
                )

                # 2. Transmit one UDP telemetry packet
                self.seq += 1
                uptime_ms = max(0, int((now_mono - self.start_monotonic) * 1000))

                payload = {
                    "version": 1,
                    "node_id": self.config.node_id,
                    "seq": self.seq,
                    "uptime_ms": uptime_ms,
                    "mode": active_mode,
                }

                raw_bytes = json.dumps(payload).encode("utf-8")
                try:
                    sock.sendto(raw_bytes, (self.dest_host, self.dest_port))
                    with self._lock:
                        self.attempts_total += 1
                        if active_mode == "burst":
                            self.attempts_burst += 1
                        else:
                            self.attempts_normal += 1
                except OSError as err:
                    with self._lock:
                        self.attempts_total += 1
                        self.attempts_failed += 1
                    logger.debug(f"[{self.config.node_id}] UDP sendto failed: {err}")

                # 3. Sample exponential inter-arrival interval for next event
                interval = self.sample_exponential_interval(rate)
                next_target_time += interval

                # 4. Non-busy wait with drift compensation
                sleep_duration = next_target_time - time.monotonic()

                # If behind schedule by more than 0.5s, reset target reference to avoid infinite catch-up bursts
                if sleep_duration < -0.5:
                    next_target_time = time.monotonic()
                    sleep_duration = interval

                if sleep_duration > 0.0:
                    if self.stop_event.wait(timeout=sleep_duration):
                        break
        finally:
            sock.close()

    def get_stats(self) -> NodeSenderStats:
        """Return snapshot of node transmission statistics."""
        with self._lock:
            now_mono = time.monotonic()
            elapsed = max(0.0, now_mono - self.start_monotonic) if self.start_monotonic else 0.0
            send_rate = round(self.attempts_total / elapsed, 2) if elapsed > 0.1 else 0.0

            return NodeSenderStats(
                node_id=self.config.node_id,
                attempts_total=self.attempts_total,
                attempts_normal=self.attempts_normal,
                attempts_burst=self.attempts_burst,
                attempts_failed=self.attempts_failed,
                last_seq=self.seq,
                current_mode=self.current_mode,
                elapsed_seconds=round(elapsed, 2),
                observed_send_rate_hz=send_rate,
            )


class HardwareSimulator:
    """Manages multi-node concurrent simulated UDP traffic transmission.

    Attributes:
        destination_host: Target host IP (default: '127.0.0.1').
        destination_port: Target UDP port (default: 5005).
        nodes: List of SimulatedNodeConfig specifications.
        duration_seconds: Optional overall runtime limit. None = runs until stop() called.
        global_seed: Base random seed for reproducible multi-node streams.
    """

    def __init__(
        self,
        destination_host: str = "127.0.0.1",
        destination_port: int = 5005,
        nodes: Optional[Sequence[SimulatedNodeConfig]] = None,
        duration_seconds: Optional[float] = None,
        global_seed: Optional[int] = None,
    ) -> None:
        self.destination_host = destination_host
        self.destination_port = destination_port
        self.duration_seconds = duration_seconds
        self.global_seed = global_seed

        if nodes is None:
            nodes = self.create_default_four_node_configs(global_seed=global_seed)

        self.node_configs = list(nodes)
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._is_running = False
        self._start_monotonic: Optional[float] = None
        self._simulated_nodes: Dict[str, SimulatedNode] = {}
        self._threads: List[threading.Thread] = []
        self._duration_timer_thread: Optional[threading.Thread] = None

    @staticmethod
    def create_default_four_node_configs(
        normal_rate_hz: float = 5.0,
        burst_rate_hz: float = 50.0,
        burst_start_second: Optional[float] = 15.0,
        burst_duration_seconds: Optional[float] = 15.0,
        global_seed: Optional[int] = None,
    ) -> List[SimulatedNodeConfig]:
        """Create the standard Phase 3 four-node experiment configuration:
        - node_1: 5.0 Hz normal (not burst capable)
        - node_2: 5.0 Hz normal (not burst capable)
        - node_3: 5.0 Hz normal (not burst capable)
        - node_4: 5.0 Hz normal, with scheduled 50.0 Hz burst (burst capable)
        """
        configs = []
        for idx, nid in enumerate(["node_1", "node_2", "node_3", "node_4"]):
            seed = (global_seed + idx * 1000) if global_seed is not None else None
            is_node_4 = (nid == "node_4")

            configs.append(
                SimulatedNodeConfig(
                    node_id=nid,
                    normal_rate_hz=normal_rate_hz,
                    burst_rate_hz=burst_rate_hz,
                    is_burst_capable=is_node_4,
                    burst_start_second=burst_start_second if is_node_4 else None,
                    burst_duration_seconds=burst_duration_seconds if is_node_4 else None,
                    random_seed=seed,
                )
            )
        return configs

    @property
    def is_running(self) -> bool:
        return self._is_running

    def start(self) -> None:
        """Start all configured node sender threads concurrently."""
        with self._lock:
            if self._is_running:
                raise RuntimeError("HardwareSimulator is already running.")

            self._stop_event.clear()
            self._start_monotonic = time.monotonic()
            self._is_running = True
            self._simulated_nodes.clear()
            self._threads.clear()

            # Instantiate simulated nodes
            for config in self.node_configs:
                node = SimulatedNode(
                    config=config,
                    dest_host=self.destination_host,
                    dest_port=self.destination_port,
                    stop_event=self._stop_event,
                    global_start_monotonic=self._start_monotonic,
                )
                self._simulated_nodes[config.node_id] = node

                th = threading.Thread(
                    target=node.run,
                    name=f"SimNode-{config.node_id}",
                    daemon=True,
                )
                self._threads.append(th)
                th.start()

            # If duration limit is specified, launch automatic shutdown timer thread
            if self.duration_seconds is not None and self.duration_seconds > 0:
                self._duration_timer_thread = threading.Thread(
                    target=self._duration_watcher,
                    name="SimulatorDurationWatcher",
                    daemon=True,
                )
                self._duration_timer_thread.start()

            logger.info(
                f"HardwareSimulator started {len(self.node_configs)} nodes -> "
                f"{self.destination_host}:{self.destination_port}"
            )

    def _duration_watcher(self) -> None:
        """Timer thread stopping the simulation after configured duration."""
        if self.duration_seconds is None:
            return
        if not self._stop_event.wait(timeout=self.duration_seconds):
            logger.info(f"Simulation duration of {self.duration_seconds}s reached. Stopping simulator...")
            self.stop()

    def stop(self, timeout: float = 2.0) -> None:
        """Signal all sender threads to terminate and join them cleanly."""
        with self._lock:
            if not self._is_running:
                return
            self._is_running = False
            self._stop_event.set()

        # Join sender threads outside lock
        for th in self._threads:
            if th.is_alive():
                th.join(timeout=timeout)

        self._threads.clear()
        logger.info("HardwareSimulator stopped cleanly.")

    def wait_until_complete(self, timeout: Optional[float] = None) -> bool:
        """Wait until simulation finishes (if duration_seconds configured) or timeout expires.

        Returns:
            bool: True if stopped, False if still running when timeout expired.
        """
        for th in self._threads:
            th.join(timeout=timeout)
        return not self.is_running

    def get_status(self) -> Dict[str, Any]:
        """Return snapshot of simulator progress and per-node transmission stats."""
        with self._lock:
            now_mono = time.monotonic()
            elapsed = (
                round(now_mono - self._start_monotonic, 2)
                if self._start_monotonic else 0.0
            )

            node_stats = {
                nid: node.get_stats().to_dict()
                for nid, node in self._simulated_nodes.items()
            }

            total_attempts = sum(s["attempts_total"] for s in node_stats.values())
            total_normal = sum(s["attempts_normal"] for s in node_stats.values())
            total_burst = sum(s["attempts_burst"] for s in node_stats.values())
            total_failed = sum(s["attempts_failed"] for s in node_stats.values())

            overall_rate = round(total_attempts / elapsed, 2) if elapsed > 0.1 else 0.0

            return {
                "is_running": self._is_running,
                "destination_host": self.destination_host,
                "destination_port": self.destination_port,
                "duration_seconds": self.duration_seconds,
                "elapsed_seconds": elapsed,
                "total_attempts": total_attempts,
                "total_normal_attempts": total_normal,
                "total_burst_attempts": total_burst,
                "total_failed_attempts": total_failed,
                "overall_send_rate_hz": overall_rate,
                "nodes": node_stats,
            }

    def __enter__(self) -> "HardwareSimulator":
        self.start()
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.stop()
