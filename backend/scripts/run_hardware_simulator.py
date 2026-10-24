#!/usr/bin/env python3
"""
PoissonBurst Lab - Standalone Console UDP Traffic Simulator Runner.

Generates realistic Poisson arrival telemetry across one to four simulated Arduino
nodes over UDP to test the HardwareReceiver service without requiring physical hardware.

Usage:
    cd backend
    python scripts/run_hardware_simulator.py --host 127.0.0.1 --port 5005 --duration 60
    python scripts/run_hardware_simulator.py --nodes node_4 --burst-delay 5 --burst-duration 10
"""

from __future__ import annotations

import argparse
import signal
import sys
import time
from pathlib import Path

# Ensure 'backend' directory is in sys.path so 'app' imports resolve
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.services.hardware_simulator import (
    SUPPORTED_NODE_IDS,
    HardwareSimulator,
    SimulatedNodeConfig,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="PoissonBurst Lab - Four-Node UDP Traffic Simulator (Phase 3)"
    )
    parser.add_argument(
        "--host",
        type=str,
        default="127.0.0.1",
        help="Target receiver IPv4 host (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=5005,
        help="Target UDP port (default: 5005)",
    )
    parser.add_argument(
        "--duration",
        type=float,
        default=60.0,
        help="Total simulation duration in seconds (default: 60.0, set 0 or negative for indefinite)",
    )
    parser.add_argument(
        "--nodes",
        nargs="+",
        default=["node_1", "node_2", "node_3", "node_4"],
        help="Selected node IDs to simulate (default: node_1 node_2 node_3 node_4)",
    )
    parser.add_argument(
        "--normal-rate",
        type=float,
        default=5.0,
        help="Baseline arrival rate in events/sec (default: 5.0)",
    )
    parser.add_argument(
        "--burst-rate",
        type=float,
        default=50.0,
        help="Burst arrival rate in events/sec for burst-capable nodes (default: 50.0)",
    )
    parser.add_argument(
        "--burst-delay",
        type=float,
        default=15.0,
        help="Delay in seconds before burst begins on burst-capable nodes (default: 15.0)",
    )
    parser.add_argument(
        "--burst-duration",
        type=float,
        default=15.0,
        help="Duration in seconds of burst mode on burst-capable nodes (default: 15.0)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Base random seed for reproducible exponential arrival streams (default: None)",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=1.0,
        help="Console status update interval in seconds (default: 1.0)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable detailed diagnostic logging",
    )
    args = parser.parse_args()

    # Validate selected nodes
    for nid in args.nodes:
        if nid not in SUPPORTED_NODE_IDS:
            print(f"[!] Invalid node ID '{nid}'. Supported: {sorted(list(SUPPORTED_NODE_IDS))}")
            sys.exit(1)

    # Build node configurations
    node_configs = []
    for idx, nid in enumerate(args.nodes):
        node_seed = (args.seed + idx * 1000) if args.seed is not None else None
        # Default experiment: only node_4 is burst-capable
        is_node_4 = (nid == "node_4")
        node_configs.append(
            SimulatedNodeConfig(
                node_id=nid,
                normal_rate_hz=args.normal_rate,
                burst_rate_hz=args.burst_rate,
                is_burst_capable=is_node_4,
                burst_start_second=args.burst_delay if is_node_4 else None,
                burst_duration_seconds=args.burst_duration if is_node_4 else None,
                random_seed=node_seed,
            )
        )

    sim_duration = args.duration if args.duration > 0 else None

    print()
    print("=" * 72)
    print(" PoissonBurst Lab — Four-Node UDP Traffic Simulator (Phase 3)")
    print(" Course: 25CS203 Probability and Statistics for Computer Science")
    print("=" * 72)
    print(f" Target Receiver: {args.host}:{args.port} (UDP)")
    print(f" Active Nodes   : {', '.join(args.nodes)}")
    print(f" Normal Rate    : {args.normal_rate} events/sec (all nodes)")
    print(f" Burst Policy   : node_4 only -> {args.burst_rate} events/sec [T+{args.burst_delay}s to T+{args.burst_delay + args.burst_duration}s]")
    print(f" Duration Limit : {args.duration if sim_duration else 'Indefinite (until Ctrl+C)'} seconds")
    print(f" Random Seed    : {args.seed if args.seed is not None else 'Non-deterministic (OS entropy)'}")
    print("-" * 72)
    print(" [NOTE] Traffic generated via independent exponential inter-arrival times:")
    print("        T = -ln(U) / lambda. Sending real UDP datagrams to localhost.")
    print("        UDP is connectionless: sender attempts != guaranteed receiver deliveries.")
    print(" Press Ctrl+C at any time to stop the simulation cleanly.")
    print("=" * 72)
    print()

    simulator = HardwareSimulator(
        destination_host=args.host,
        destination_port=args.port,
        nodes=node_configs,
        duration_seconds=sim_duration,
        global_seed=args.seed,
    )

    try:
        simulator.start()
        print(f"[*] Traffic simulator active. Transmitting Poisson telemetry to {args.host}:{args.port}...\n")
    except Exception as err:
        print(f"\n[!] Failed to start simulator: {err}")
        sys.exit(1)

    shutdown_flag = False

    def handle_sigint(signum, frame):
        nonlocal shutdown_flag
        shutdown_flag = True

    signal.signal(signal.SIGINT, handle_sigint)

    last_print = 0.0

    try:
        while not shutdown_flag and simulator.is_running:
            time.sleep(0.1)
            now = time.time()
            if now - last_print >= args.interval:
                last_print = now
                status = simulator.get_status()
                elapsed = status["elapsed_seconds"]
                total = status["total_attempts"]
                rate = status["overall_send_rate_hz"]
                normal_att = status["total_normal_attempts"]
                burst_att = status["total_burst_attempts"]

                # Per-node summary tokens
                tokens = []
                for nid, nstats in status["nodes"].items():
                    mode_flag = "B" if nstats["current_mode"] == "burst" else "N"
                    tokens.append(f"{nid}[{mode_flag}]:{nstats['attempts_total']}")

                node_summary = " ".join(tokens)
                print(
                    f"\r[T+{elapsed:5.1f}s] Sent: {total:<5} (Norm: {normal_att:<4} Burst: {burst_att:<4}) | "
                    f"Rate: {rate:5.1f} Hz | Nodes: {node_summary}",
                    end="",
                    flush=True,
                )
    except KeyboardInterrupt:
        pass
    finally:
        print("\n\n[*] Stopping traffic simulator...")
        simulator.stop()
        final_status = simulator.get_status()

        print()
        print("=" * 72)
        print(" FINAL TRAFFIC SIMULATION SUMMARY (SENDER ATTEMPTS)")
        print("=" * 72)
        print(f" Target Receiver      : {final_status['destination_host']}:{final_status['destination_port']}")
        print(f" Simulation Duration  : {final_status['elapsed_seconds']:.2f} seconds")
        print(f" Total Send Attempts  : {final_status['total_attempts']}")
        print(f"   • Normal Mode      : {final_status['total_normal_attempts']}")
        print(f"   • Burst Mode       : {final_status['total_burst_attempts']}")
        print(f"   • Failed Sockets   : {final_status['total_failed_attempts']}")
        print(f" Overall Sender Rate  : {final_status['overall_send_rate_hz']:.2f} datagrams/sec")
        print("-" * 72)
        print(" PER-NODE SENDER BREAKDOWN:")
        for nid, n in final_status["nodes"].items():
            print(f"  • {nid}:")
            print(f"      Total Attempts   : {n['attempts_total']}")
            print(f"      Normal Mode      : {n['attempts_normal']}")
            print(f"      Burst Mode       : {n['attempts_burst']}")
            print(f"      Last Sequence #  : {n['last_seq']}")
            print(f"      Final Mode       : {n['current_mode']}")
            print(f"      Observed Tx Rate : {n['observed_send_rate_hz']:.2f} events/sec")
        print("=" * 72)
        print(" [IMPORTANT] Sender transmission attempts do NOT guarantee delivery.")
        print("             Inspect HardwareReceiver logs/stats for actual received counts.")
        print("=" * 72)
        print()


if __name__ == "__main__":
    main()
