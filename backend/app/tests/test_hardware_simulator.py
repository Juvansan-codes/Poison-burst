"""
PoissonBurst Lab - Unit and Integration Tests for Hardware UDP Simulator.

Validates:
1. SimulatedNodeConfig validation rules and default four-node generation.
2. Exponential inter-arrival time sampling mathematics (Poisson arrival process).
3. Independent PRNG seeds and sequence counter tracking.
4. Single-node and four-node concurrent localhost UDP transmission to real HardwareReceiver.
5. Scheduled burst transition for node_4 and burst constraint enforcement for nodes 1-3.
6. Simulator lifecycle, thread termination, and socket error resilience.
7. Exact schema compliance with Phase 1 telemetry specification and Phase 2 receiver.
"""

from __future__ import annotations

import json
import socket
import time
from typing import List
import pytest

from app.services.hardware_receiver import HardwareReceiver, TelemetryPacket
from app.services.hardware_simulator import (
    SUPPORTED_NODE_IDS,
    HardwareSimulator,
    SimulatedNode,
    SimulatedNodeConfig,
)


# =============================================================================
# 1. SimulatedNodeConfig Validation Unit Tests
# =============================================================================

class TestSimulatedNodeConfig:
    """Unit tests for SimulatedNodeConfig parameters and validation."""

    @pytest.mark.parametrize("node_id", ["node_1", "node_2", "node_3", "node_4"])
    def test_valid_node_ids(self, node_id: str):
        cfg = SimulatedNodeConfig(node_id=node_id)
        assert cfg.node_id == node_id
        assert cfg.normal_rate_hz == 5.0
        assert cfg.burst_rate_hz == 50.0
        assert cfg.is_burst_capable is False

    @pytest.mark.parametrize("invalid_id", ["node_0", "node_5", "arduino_1", "", "NODE_1"])
    def test_invalid_node_id_rejected(self, invalid_id: str):
        with pytest.raises(ValueError, match="Invalid node_id"):
            SimulatedNodeConfig(node_id=invalid_id)

    @pytest.mark.parametrize("bad_rate", [0.0, -1.0, -10.5])
    def test_non_positive_normal_rate_rejected(self, bad_rate: float):
        with pytest.raises(ValueError, match="normal_rate_hz must be strictly positive"):
            SimulatedNodeConfig(node_id="node_1", normal_rate_hz=bad_rate)

    @pytest.mark.parametrize("bad_rate", [0.0, -5.0])
    def test_non_positive_burst_rate_rejected(self, bad_rate: float):
        with pytest.raises(ValueError, match="burst_rate_hz must be strictly positive"):
            SimulatedNodeConfig(node_id="node_1", burst_rate_hz=bad_rate)

    def test_negative_burst_delay_rejected(self):
        with pytest.raises(ValueError, match="burst_start_second cannot be negative"):
            SimulatedNodeConfig(node_id="node_4", burst_start_second=-1.0)

    @pytest.mark.parametrize("bad_dur", [0.0, -2.0])
    def test_non_positive_burst_duration_rejected(self, bad_dur: float):
        with pytest.raises(ValueError, match="burst_duration_seconds must be strictly positive"):
            SimulatedNodeConfig(node_id="node_4", burst_duration_seconds=bad_dur)

    def test_default_four_node_configs_structure(self):
        configs = HardwareSimulator.create_default_four_node_configs(global_seed=42)
        assert len(configs) == 4

        node_ids = [c.node_id for c in configs]
        assert node_ids == ["node_1", "node_2", "node_3", "node_4"]

        # Nodes 1-3 must not be burst capable
        for c in configs[:3]:
            assert c.is_burst_capable is False
            assert c.burst_start_second is None
            assert c.burst_duration_seconds is None

        # Node 4 must be burst capable with scheduled times
        node_4_cfg = configs[3]
        assert node_4_cfg.is_burst_capable is True
        assert node_4_cfg.burst_start_second == 15.0
        assert node_4_cfg.burst_duration_seconds == 15.0

        # Independent random seeds
        seeds = [c.random_seed for c in configs]
        assert len(set(seeds)) == 4


# =============================================================================
# 2. Poisson Arrival Mathematical Sampling Tests
# =============================================================================

class TestPoissonArrivalSampling:
    """Validates the exponential inter-arrival formula T = -ln(U) / lambda."""

    def test_sample_exponential_interval_strictly_positive(self):
        cfg = SimulatedNodeConfig(node_id="node_1", random_seed=123)
        node = SimulatedNode(
            config=cfg,
            dest_host="127.0.0.1",
            dest_port=5005,
            stop_event=None,  # type: ignore
            global_start_monotonic=0.0,
        )
        for _ in range(100):
            interval = node.sample_exponential_interval(10.0)
            assert interval > 0.0
            assert interval >= 0.0001

    def test_sample_exponential_mean_matches_theory(self):
        """For lambda = 5.0 Hz, E[T] = 1/lambda = 0.200 seconds."""
        cfg = SimulatedNodeConfig(node_id="node_1", random_seed=9999)
        node = SimulatedNode(
            config=cfg,
            dest_host="127.0.0.1",
            dest_port=5005,
            stop_event=None,  # type: ignore
            global_start_monotonic=0.0,
        )

        n_samples = 15000
        rate = 5.0
        expected_mean = 1.0 / rate  # 0.200
        samples = [node.sample_exponential_interval(rate) for _ in range(n_samples)]
        actual_mean = sum(samples) / len(samples)

        # Within 3% of theoretical mean with N=15000
        assert abs(actual_mean - expected_mean) / expected_mean < 0.03

    def test_deterministic_seed_reproducibility(self):
        cfg1 = SimulatedNodeConfig(node_id="node_1", random_seed=4242)
        node1 = SimulatedNode(cfg1, "127.0.0.1", 5005, None, 0.0)  # type: ignore

        cfg2 = SimulatedNodeConfig(node_id="node_1", random_seed=4242)
        node2 = SimulatedNode(cfg2, "127.0.0.1", 5005, None, 0.0)  # type: ignore

        seq1 = [node1.sample_exponential_interval(10.0) for _ in range(20)]
        seq2 = [node2.sample_exponential_interval(10.0) for _ in range(20)]

        assert seq1 == seq2

    def test_distinct_seeds_produce_different_sequences(self):
        cfg1 = SimulatedNodeConfig(node_id="node_1", random_seed=111)
        node1 = SimulatedNode(cfg1, "127.0.0.1", 5005, None, 0.0)  # type: ignore

        cfg2 = SimulatedNodeConfig(node_id="node_1", random_seed=222)
        node2 = SimulatedNode(cfg2, "127.0.0.1", 5005, None, 0.0)  # type: ignore

        seq1 = [node1.sample_exponential_interval(10.0) for _ in range(20)]
        seq2 = [node2.sample_exponential_interval(10.0) for _ in range(20)]

        assert seq1 != seq2


# =============================================================================
# 3. Single-Node UDP Integration Tests with Real HardwareReceiver
# =============================================================================

class TestSingleNodeIntegration:
    """Integration test connecting a simulated node to real HardwareReceiver over UDP."""

    def test_single_node_transmission_and_reception(self):
        with HardwareReceiver(host="127.0.0.1", port=0) as receiver:
            cfg = SimulatedNodeConfig(
                node_id="node_1",
                normal_rate_hz=25.0,
                random_seed=101,
            )
            sim = HardwareSimulator(
                destination_host="127.0.0.1",
                destination_port=receiver.port,
                nodes=[cfg],
                duration_seconds=0.6,
            )

            with sim:
                time.sleep(0.65)

            # Check sender stats
            sim_status = sim.get_status()
            n1_stats = sim_status["nodes"]["node_1"]
            assert n1_stats["attempts_total"] > 5
            assert n1_stats["attempts_failed"] == 0
            assert n1_stats["current_mode"] == "normal"

            # Check receiver state
            rec_status = receiver.get_status()
            assert rec_status["valid_datagrams"] >= 5
            assert rec_status["malformed_datagrams"] == 0
            assert rec_status["observed_nodes_count"] == 1

            node_1_rec = rec_status["nodes"]["node_1"]
            assert node_1_rec["is_observed"] is True
            assert node_1_rec["valid_packets_count"] == n1_stats["attempts_total"]
            assert node_1_rec["first_seq"] == 1
            assert node_1_rec["last_seq"] == n1_stats["last_seq"]
            assert node_1_rec["last_mode"] == "normal"
            assert node_1_rec["sequence_gaps_count"] == 0


# =============================================================================
# 4. Four-Node Concurrent Multi-Node Integration Tests
# =============================================================================

class TestFourNodeConcurrentIntegration:
    """Tests all four nodes transmitting simultaneously to real HardwareReceiver."""

    def test_four_nodes_concurrent_transmission(self):
        with HardwareReceiver(host="127.0.0.1", port=0) as receiver:
            configs = [
                SimulatedNodeConfig(node_id="node_1", normal_rate_hz=15.0, random_seed=1),
                SimulatedNodeConfig(node_id="node_2", normal_rate_hz=15.0, random_seed=2),
                SimulatedNodeConfig(node_id="node_3", normal_rate_hz=15.0, random_seed=3),
                SimulatedNodeConfig(node_id="node_4", normal_rate_hz=15.0, random_seed=4),
            ]
            sim = HardwareSimulator(
                destination_host="127.0.0.1",
                destination_port=receiver.port,
                nodes=configs,
                duration_seconds=0.7,
            )

            with sim:
                time.sleep(0.75)

            sim_status = sim.get_status()
            rec_status = receiver.get_status()

            assert sim_status["total_attempts"] > 20
            assert rec_status["valid_datagrams"] > 20
            assert rec_status["malformed_datagrams"] == 0
            assert rec_status["observed_nodes_count"] == 4

            # Verify each node independently
            for nid in ["node_1", "node_2", "node_3", "node_4"]:
                s_node = sim_status["nodes"][nid]
                r_node = rec_status["nodes"][nid]

                assert r_node["is_observed"] is True
                assert r_node["valid_packets_count"] == s_node["attempts_total"]
                assert r_node["first_seq"] == 1
                assert r_node["last_seq"] == s_node["last_seq"]
                assert r_node["sequence_gaps_count"] == 0
                assert r_node["last_mode"] == "normal"


# =============================================================================
# 5. Scheduled Burst Mode Transition Tests
# =============================================================================

class TestScheduledBurstTransition:
    """Tests scheduled normal -> burst -> normal transition on node_4."""

    def test_node_4_scheduled_burst(self):
        received_modes: List[str] = []

        def packet_hook(pkt: TelemetryPacket):
            if pkt.node_id == "node_4":
                received_modes.append(pkt.mode)

        with HardwareReceiver(
            host="127.0.0.1",
            port=0,
            on_packet_received=packet_hook,
        ) as receiver:
            # 0.0s to 0.25s: normal (15 Hz)
            # 0.25s to 0.60s: burst (40 Hz)
            # 0.60s to 0.85s: normal (15 Hz)
            cfg = SimulatedNodeConfig(
                node_id="node_4",
                normal_rate_hz=15.0,
                burst_rate_hz=40.0,
                is_burst_capable=True,
                burst_start_second=0.25,
                burst_duration_seconds=0.35,
                random_seed=777,
            )
            sim = HardwareSimulator(
                destination_host="127.0.0.1",
                destination_port=receiver.port,
                nodes=[cfg],
                duration_seconds=0.85,
            )

            with sim:
                time.sleep(0.9)

            sim_status = sim.get_status()
            n4_stats = sim_status["nodes"]["node_4"]

            # Must have sent both normal and burst datagrams
            assert n4_stats["attempts_normal"] > 0
            assert n4_stats["attempts_burst"] > 0
            assert n4_stats["attempts_total"] == n4_stats["attempts_normal"] + n4_stats["attempts_burst"]

            # Receiver must have received both modes
            assert "normal" in received_modes
            assert "burst" in received_modes

    def test_nodes_1_to_3_cannot_enter_burst_mode(self):
        """Nodes 1-3 configured with burst parameters must remain in normal mode."""
        with HardwareReceiver(host="127.0.0.1", port=0) as receiver:
            cfg = SimulatedNodeConfig(
                node_id="node_2",
                normal_rate_hz=20.0,
                burst_rate_hz=50.0,
                is_burst_capable=False,  # Not permitted to burst!
                burst_start_second=0.1,
                burst_duration_seconds=0.5,
                random_seed=888,
            )
            sim = HardwareSimulator(
                destination_host="127.0.0.1",
                destination_port=receiver.port,
                nodes=[cfg],
                duration_seconds=0.5,
            )

            with sim:
                time.sleep(0.55)

            status = sim.get_status()
            n2_stats = status["nodes"]["node_2"]
            assert n2_stats["attempts_burst"] == 0
            assert n2_stats["attempts_normal"] > 0
            assert n2_stats["current_mode"] == "normal"


# =============================================================================
# 6. Lifecycle, Error Handling & Protocol Schema Tests
# =============================================================================

class TestSimulatorLifecycleAndErrors:
    """Tests double start, clean shutdown, and socket resilience."""

    def test_double_start_raises_error(self):
        sim = HardwareSimulator(destination_port=5005)
        sim.start()
        try:
            with pytest.raises(RuntimeError, match="HardwareSimulator is already running"):
                sim.start()
        finally:
            sim.stop()

    def test_clean_stop_terminates_all_threads(self):
        sim = HardwareSimulator(
            destination_port=5005,
            nodes=HardwareSimulator.create_default_four_node_configs(),
        )
        assert not sim.is_running
        sim.start()
        assert sim.is_running
        assert len(sim._threads) == 4
        assert all(t.is_alive() for t in sim._threads)

        sim.stop()
        assert not sim.is_running
        assert len(sim._threads) == 0

    def test_transmitting_to_dead_port_does_not_crash(self):
        """Sending UDP datagrams to a closed port on localhost must not crash sender."""
        cfg = SimulatedNodeConfig(node_id="node_1", normal_rate_hz=30.0)
        # Port 59999 has no listener
        sim = HardwareSimulator(
            destination_host="127.0.0.1",
            destination_port=59999,
            nodes=[cfg],
            duration_seconds=0.3,
        )

        with sim:
            time.sleep(0.35)

        status = sim.get_status()
        assert not status["is_running"]
        assert status["total_attempts"] > 0

    def test_exact_payload_schema_compliance(self):
        """Verify the exact JSON structure sent over the wire matches Phase 1."""
        raw_packets = []

        def intercept_packet(pkt: TelemetryPacket):
            raw_packets.append(pkt)

        with HardwareReceiver(
            host="127.0.0.1",
            port=0,
            on_packet_received=intercept_packet,
        ) as receiver:
            cfg = SimulatedNodeConfig(node_id="node_3", normal_rate_hz=30.0)
            sim = HardwareSimulator(
                destination_host="127.0.0.1",
                destination_port=receiver.port,
                nodes=[cfg],
                duration_seconds=0.2,
            )

            with sim:
                time.sleep(0.25)

            assert len(raw_packets) > 0
            first_pkt = raw_packets[0]
            assert first_pkt.version == 1
            assert first_pkt.node_id == "node_3"
            assert first_pkt.seq >= 1
            assert first_pkt.uptime_ms >= 0
            assert first_pkt.mode in ("normal", "burst")
