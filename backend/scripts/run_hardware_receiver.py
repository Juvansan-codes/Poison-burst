#!/usr/bin/env python3
"""
PoissonBurst Lab - Standalone Console UDP Receiver Runner.

Launches the HardwareReceiver service from the command line, monitors incoming
datagrams from Arduino UNO R4 WiFi nodes, and displays real-time statistics without
requiring FastAPI or Next.js to be running.

Usage:
    cd backend
    python scripts/run_hardware_receiver.py [--host 0.0.0.0] [--port 5005] [--verbose]
"""

from __future__ import annotations

import argparse
import os
import signal
import sys
import time
from pathlib import Path

# Ensure 'backend' directory is in sys.path so 'app' imports resolve
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.services.hardware_receiver import HardwareReceiver, TelemetryPacket


def main() -> None:
    parser = argparse.ArgumentParser(
        description="PoissonBurst Lab - Standalone Arduino Hardware UDP Receiver"
    )
    parser.add_argument(
        "--host",
        type=str,
        default="0.0.0.0",
        help="Local IPv4 interface to bind (default: 0.0.0.0 for all interfaces)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=5005,
        help="UDP destination port to listen on (default: 5005)",
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
        help="Print every individual valid packet received",
    )
    args = parser.parse_args()

    print()
    print("=" * 70)
    print(" PoissonBurst Lab — Hardware UDP Receiver (Phase 2 Standalone Runner)")
    print(" Course: 25CS203 Probability and Statistics for Computer Science")
    print("=" * 70)
    print(f" Bind Address   : {args.host}:{args.port} (UDP)")
    print(" Supported Nodes: node_1, node_2, node_3, node_4")
    print(" Target Rates   : Normal = ~5.0 Hz | Burst = ~50.0 Hz")
    print("-" * 70)
    print(" [FIREWALL NOTE] On Windows, ensure Windows Firewall permits UDP traffic")
    print(f" on port {args.port} for Python on your private network (hotspot).")
    print(" Press Ctrl+C at any time to halt and print the final summary report.")
    print("=" * 70)
    print()

    def on_packet(pkt: TelemetryPacket) -> None:
        if args.verbose:
            print(
                f"[{pkt.received_time_utc[11:19]}] RECV {pkt.node_id} | "
                f"Seq={pkt.seq:<6} | Mode={pkt.mode:<6} | Uptime={pkt.uptime_ms}ms"
            )

    receiver = HardwareReceiver(
        host=args.host,
        port=args.port,
        on_packet_received=on_packet if args.verbose else None,
    )

    try:
        receiver.start()
        print(f"[*] UDP listener active on {args.host}:{receiver.port}. Waiting for Arduino datagrams...\n")
    except Exception as err:
        print(f"\n[!] Failed to start receiver on {args.host}:{args.port}: {err}")
        print("    If another process is using port 5005, terminate it or specify --port <PORT>.")
        sys.exit(1)

    # Clean shutdown signal handler
    shutdown_flag = False

    def handle_sigint(signum, frame):
        nonlocal shutdown_flag
        shutdown_flag = True

    signal.signal(signal.SIGINT, handle_sigint)

    try:
        start_time = time.time()
        last_print = 0.0

        while not shutdown_flag:
            time.sleep(0.1)
            now = time.time()
            if now - last_print >= args.interval:
                last_print = now
                status = receiver.get_status()

                uptime = status["uptime_seconds"]
                total = status["total_socket_datagrams"]
                valid = status["valid_datagrams"]
                rate = status["overall_observed_rate_hz"]
                malformed = status["malformed_datagrams"]
                observed_nodes = status["observed_nodes_count"]

                print(
                    f"\r[T+{uptime:5.1f}s] Total: {total:<5} | Valid: {valid:<5} | "
                    f"Rate: {rate:5.2f} Hz | Errors: {malformed:<3} | Active Nodes: {observed_nodes}/4",
                    end="",
                    flush=True,
                )

                # If nodes are active, print per-node lines on interval
                if observed_nodes > 0 and not args.verbose:
                    active_strs = []
                    for nid, nstate in status["nodes"].items():
                        if nstate["is_observed"]:
                            active_strs.append(
                                f"{nid}: Seq={nstate['last_seq']} ({nstate['last_mode']}) {nstate['observed_rate_hz']}Hz"
                            )
                    if active_strs:
                        print(f"  [{', '.join(active_strs)}]", end="", flush=True)

    except KeyboardInterrupt:
        pass
    finally:
        print("\n\n[*] Stopping UDP listener...")
        receiver.stop()
        final_status = receiver.get_status()

        print()
        print("=" * 70)
        print(" FINAL HARDWARE SESSION SUMMARY")
        print("=" * 70)
        print(f" Total Session Duration : {final_status['uptime_seconds']:.2f} seconds")
        print(f" Total Socket Datagrams : {final_status['total_socket_datagrams']}")
        print(f" Valid Telemetry Packets: {final_status['valid_datagrams']}")
        print(f" Unique Packets         : {final_status['unique_datagrams']}")
        print(f" Malformed / Rejected   : {final_status['malformed_datagrams']}")
        print(f" Overall Observed Rate  : {final_status['overall_observed_rate_hz']:.2f} events/sec")
        print("-" * 70)
        print(" PER-NODE BREAKDOWN:")
        for nid, n in final_status["nodes"].items():
            if n["is_observed"]:
                print(f"  • Node '{nid}':")
                print(f"      Packets Received : {n['valid_packets_count']} (Unique: {n['unique_packets_count']})")
                print(f"      Sequence Range   : {n['first_seq']} -> {n['last_seq']}")
                print(f"      Sequence Gaps    : {n['sequence_gaps_count']} (Est. Lost: {n['total_lost_packets_estimate']})")
                print(f"      Duplicates/Order : {n['duplicate_or_reordered_count']}")
                print(f"      Observed Rate    : {n['observed_rate_hz']:.2f} Hz")
                print(f"      Last Mode        : {n['last_mode']}")
                print(f"      Last Source Addr : {n['last_source_addr']}")
            else:
                print(f"  • Node '{nid}': (Not observed during this session)")
        print("=" * 70)
        print()


if __name__ == "__main__":
    main()
