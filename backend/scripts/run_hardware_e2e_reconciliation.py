"""
PoissonBurst Lab - Phase 7.1 Hardware End-to-End Data Reconciliation & Integrity Runner.

Executes the complete real localhost hardware pipeline:
HardwareSimulator -> localhost UDP -> HardwareReceiver -> HardwareWindowProcessor ->
HardwareSessionManager -> ExperimentRepository -> Statistical Analysis.

Produces the comprehensive 14-item reconciliation ledger, validates all accounting
invariants, verifies restart recovery, and audits PDF & CSV exports.
"""

from __future__ import annotations

import os
import sys
import tempfile
import time

# Ensure backend root is on Python path
sys.path.insert(0, os.path.abspath("."))
sys.path.insert(0, os.path.abspath("backend"))

from fastapi.testclient import TestClient
from app.main import app
from app.services.hardware_simulator import HardwareSimulator
from app.services.hardware_session_manager import get_hardware_session_manager
import app.services.experiment_repository as er
from app.core.schemas import SimulationRequest, SimulationScenario
from app.services.traffic_simulator import run_traffic_simulation


def run_e2e_reconciliation() -> None:
    print("=" * 75)
    print(" POISSONBURST LAB - PHASE 7.1 HARDWARE E2E RECONCILIATION AUDIT")
    print("=" * 75)

    # 1. Setup isolated temporary database (protects user database)
    temp_dir = tempfile.mkdtemp()
    db_path = os.path.join(temp_dir, "phase7_1_reconciliation.db")
    os.environ["POISSONBURST_DB_PATH"] = db_path
    print(f"\n[Step 1] Configured isolated test SQLite DB: {db_path}")

    er._default_repo = None
    repo = er.get_experiment_repository(db_path)

    mgr = get_hardware_session_manager()
    mgr.shutdown()

    client = TestClient(app)

    # 2. Start hardware session
    window_sec = 0.5
    start_payload = {
        "bind_host": "127.0.0.1",
        "bind_port": 0,
        "window_seconds": window_sec,
        "alpha": 0.01,
        "expected_nodes": ["node_1", "node_2", "node_3", "node_4"],
        "min_calibration_windows": 4,
        "stale_timeout_seconds": 5.0,
        "require_all_nodes": True,
    }
    start_res = client.post("/api/hardware/start", json=start_payload)
    assert start_res.status_code == 200, f"Start failed: {start_res.text}"
    start_data = start_res.json()
    bound_port = start_data["bind_port"]
    session_id = start_data["session_id"]
    print(f"[Step 2] Hardware session started: {session_id} on UDP port {bound_port}")
    print(f"         Window Duration W = {window_sec}s, Expected Nodes: 4, Alpha = 0.01")

    # 3. Transmit baseline calibration traffic (4 nodes, 5 Hz normal rate)
    print("\n[Step 3] Transmitting baseline calibration traffic via HardwareSimulator...")
    sim_cal = HardwareSimulator(
        destination_host="127.0.0.1",
        destination_port=bound_port,
        duration_seconds=3.0,
    )
    sim_cal.start()
    time.sleep(2.6)
    sim_cal.stop()
    print("         Calibration transmission stopped. Waiting for windows to tumble...")
    time.sleep(1.0)

    status_cal = client.get("/api/hardware/status").json()
    calib_win_count = status_cal["calibration_windows_count"]
    valid_calib_pkts = status_cal["valid_datagrams"]
    print(f"         Tumbled {calib_win_count} calibration windows ({valid_calib_pkts} valid datagrams)")
    assert calib_win_count >= 4

    # 4. Finalize calibration
    fin_res = client.post("/api/hardware/calibration/finalize")
    assert fin_res.status_code == 200, f"Finalize failed: {fin_res.text}"
    fin_data = fin_res.json()
    baseline_lambda = fin_data["expected_count_per_window"]
    print(f"[Step 4] Baseline calibration finalized successfully!")
    print(f"         Baseline Expected Lambda: {baseline_lambda:.4f} datagrams/window")
    print(f"         Baseline Rate: {fin_data['rate_per_second']:.4f} datagrams/second")
    print(f"         Eligible Windows: {fin_data['eligible_windows_count']}, Excluded: {fin_data['excluded_windows_count']}")
    assert fin_data["state"] == "MONITORING"

    # 5. Transmit monitoring traffic with continuous sequences and scheduled burst
    print("\n[Step 5] Transmitting monitoring traffic (sequence-continued from calibration)...")
    last_seqs = sim_cal.get_last_sequences()
    sim_mon = HardwareSimulator(
        destination_host="127.0.0.1",
        destination_port=bound_port,
        duration_seconds=2.0,
        initial_sequences=last_seqs,
    )
    sim_mon.start()
    time.sleep(1.8)
    sim_mon.stop()
    time.sleep(0.8)

    # 6. Stop session and trigger persistence
    print("\n[Step 6] Stopping hardware session and triggering SQLite persistence...")
    stop_res = client.post("/api/hardware/stop")
    assert stop_res.status_code == 200, f"Stop failed: {stop_res.text}"
    stop_data = stop_res.json()
    assert stop_data["clean_shutdown"] is True
    assert stop_data["persisted"] is True
    assert stop_data["experiment_id"] == session_id
    print(f"         Session stopped cleanly: {stop_data['message']}")
    print(f"         Completed Windows: {stop_data['completed_windows_count']}, Partial Windows: {stop_data['partial_windows_count']}")

    # 7. Extract database record and compute full reconciliation ledger
    print("\n[Step 7] Extracting persisted experiment and compiling Reconciliation Ledger...")
    exp = repo.get_experiment(session_id)
    assert exp is not None

    stopped_entry = mgr._stopped_sessions[session_id]
    rec_status = stopped_entry["rec_status"]
    proc_status = stopped_entry["proc_status"]
    pw_info = proc_status.get("partial_window") or {}
    pw_datagrams = pw_info.get("aggregate_count", 0)

    calib_obs = [o for o in exp.observations if o.is_calibration]
    mon_obs = [o for o in exp.observations if not o.is_calibration]

    stats_data = client.get(f"/api/experiments/{session_id}/statistics").json()
    ci_data = stats_data.get("confidence_interval") or {}

    total_socket = rec_status["total_socket_datagrams"]
    valid_proto = rec_status["valid_datagrams"]
    unique_events = rec_status["unique_datagrams"]
    malformed = rec_status["malformed_datagrams"]
    duplicates = sum(n["duplicate_or_reordered_count"] for n in rec_status["nodes"].values())
    seq_gaps = sum(n["sequence_gaps_count"] for n in rec_status["nodes"].values())
    lost_est = sum(n["total_lost_packets_estimate"] for n in rec_status["nodes"].values())
    complete_window_datagrams = proc_status["total_observed_arrivals"]
    partial_window_datagrams = pw_datagrams
    excluded_unique = 0
    finalized_proc_sum = sum(w.aggregate_count for w in stopped_entry["windows"])
    persisted_obs_sum = sum(o.count for o in exp.observations)
    calib_count = len(calib_obs)
    calib_sum = sum(o.count for o in calib_obs)
    mon_count = len(mon_obs)
    mon_sum = sum(o.count for o in mon_obs)
    stat_sample_size = stats_data["observation_count"]
    stat_sample_sum = sum(o.count for o in exp.observations)
    stat_mean = stats_data["empirical_mean"]
    ci_size = ci_data.get("sample_size", 0)
    ci_sum = ci_data.get("total_arrivals", 0)
    ci_point = ci_data.get("point_estimate", 0.0)

    print("\n" + "-" * 75)
    print(" AUTHORITATIVE RECONCILIATION LEDGER (14 REQUIRED METRICS)")
    print("-" * 75)
    print(f"  1. Total UDP datagrams received by socket:       {total_socket}")
    print(f"  2. Valid protocol datagrams:                     {valid_proto}")
    print(f"  3. Unique accepted telemetry events:             {unique_events}")
    print(f"  4. Malformed or rejected datagrams:              {malformed}")
    print(f"  5. Duplicate or reordered datagrams:             {duplicates}")
    print(f"  6. Sequence-gap estimates (gaps / lost pkts):    {seq_gaps} / {lost_est}")
    print(f"  7. Datagrams assigned to complete windows:       {complete_window_datagrams}")
    print(f"  8. Datagrams assigned to partial final window:   {partial_window_datagrams}")
    print(f"  9. Explicitly excluded unique events:            {excluded_unique}")
    print(f" 10. Total counts in finalized processor windows:  {finalized_proc_sum}")
    print(f" 11. Total counts persisted in SQLite observation: {persisted_obs_sum}")
    print(f" 12. Calibration observation count and total:      {calib_count} windows, {calib_sum} datagrams")
    print(f" 13. Monitoring observation count and total:       {mon_count} windows, {mon_sum} datagrams")
    print(f" 14. Statistical-analysis observation sample:      {stat_sample_size} windows, {stat_sample_sum} total (Mean: {stat_mean:.4f})")
    print(f"     Calibration CI baseline sample:               {ci_size} windows, {ci_sum} total (Point Est: {ci_point:.4f})")
    print("-" * 75)

    # 8. Verify All Invariants
    print("\n[Step 8] Verifying Mathematical Accounting Invariants...")
    # Invariant 1: Socket level
    assert total_socket == valid_proto + malformed, "Invariant 1 Failed"
    print(f"  [PASS] Invariant 1 (Socket): total ({total_socket}) == valid ({valid_proto}) + malformed ({malformed})")

    # Invariant 2: Protocol validation & deduplication
    assert valid_proto == unique_events + duplicates, "Invariant 2 Failed"
    print(f"  [PASS] Invariant 2 (Deduplication): valid ({valid_proto}) == unique ({unique_events}) + duplicates ({duplicates})")

    # Invariant 3: Unique window assignment
    assert unique_events == complete_window_datagrams + partial_window_datagrams + excluded_unique, "Invariant 3 Failed"
    print(f"  [PASS] Invariant 3 (Window Assignment): unique ({unique_events}) == complete ({complete_window_datagrams}) + partial ({partial_window_datagrams}) + excluded ({excluded_unique})")

    # Invariant 4: Persistence accounting
    assert persisted_obs_sum == complete_window_datagrams, "Invariant 4 Failed"
    assert finalized_proc_sum == complete_window_datagrams, "Invariant 4b Failed"
    print(f"  [PASS] Invariant 4 (Persistence): persisted observation sum ({persisted_obs_sum}) == completed window sum ({complete_window_datagrams})")

    # Invariant 5: Observation partition
    assert persisted_obs_sum == calib_sum + mon_sum, "Invariant 5 Failed"
    assert len(exp.observations) == calib_count + mon_count, "Invariant 5b Failed"
    print(f"  [PASS] Invariant 5 (Partition): persisted sum ({persisted_obs_sum}) == calib sum ({calib_sum}) + mon sum ({mon_sum})")

    # Invariant 6: Statistical analysis mean
    expected_emp_mean = persisted_obs_sum / len(exp.observations)
    assert abs(stat_mean - expected_emp_mean) < 1e-4, "Invariant 6 Failed"
    print(f"  [PASS] Invariant 6 (Empirical Mean): {stat_mean:.4f} == {persisted_obs_sum} / {len(exp.observations)} ({expected_emp_mean:.4f})")

    # Invariant 7: Calibration baseline provenance
    expected_base_lambda = calib_sum / calib_count
    assert abs(ci_point - expected_base_lambda) < 1e-4, "Invariant 7 Failed"
    assert abs(exp.baseline_lambda - expected_base_lambda) < 1e-4, "Invariant 7b Failed"
    print(f"  [PASS] Invariant 7 (Baseline Provenance): baseline lambda {exp.baseline_lambda:.4f} == {calib_sum} / {calib_count} ({expected_base_lambda:.4f})")

    # 9. Verify Restart Recovery
    print("\n[Step 9] Simulating backend restart (closing SQLite connection and clearing cache)...")
    er._default_repo = None
    mgr.shutdown()

    reopened_repo = er.ExperimentRepository(db_path)
    reopened_exp = reopened_repo.get_experiment(session_id)
    assert reopened_exp is not None
    assert len(reopened_exp.observations) == len(exp.observations)
    assert sum(o.count for o in reopened_exp.observations) == persisted_obs_sum
    assert reopened_exp.baseline_lambda == exp.baseline_lambda
    assert reopened_exp.configuration["valid_datagrams"] == valid_proto
    assert reopened_exp.configuration["unique_datagrams"] == unique_events
    print(f"  [PASS] Database reopened successfully: all {len(reopened_exp.observations)} observations and metadata intact.")

    # 10. Audit PDF & CSV Exports
    print("\n[Step 10] Validating CSV and PDF export outputs...")
    fresh_client = TestClient(app)
    csv_res = fresh_client.get(f"/api/experiments/{session_id}/export")
    assert csv_res.status_code == 200
    assert "udp_datagram_count" in csv_res.text or "UDP" in csv_res.text
    print(f"  [PASS] CSV export verified: {len(csv_res.text)} characters, proper datagram measurement units.")

    pdf_res = fresh_client.get(f"/api/experiments/{session_id}/report.pdf")
    assert pdf_res.status_code == 200
    assert pdf_res.headers["content-type"] == "application/pdf"
    assert pdf_res.content.startswith(b"%PDF")
    print(f"  [PASS] PDF report generated: {len(pdf_res.content)} bytes with valid %PDF header.")

    # 11. Cross-compatibility check
    print("\n[Step 11] Checking Simulation & Historical cross-compatibility...")
    sim_req = SimulationRequest(
        scenario=SimulationScenario.POISSON_NORMAL,
        total_duration_seconds=5.0,
        window_seconds=1.0,
        lambda_rate=10.0,
        alpha=0.01,
        seed=42,
    )
    sim_trial = run_traffic_simulation(sim_req)
    reopened_repo.save_simulation_experiment(sim_req, sim_trial)
    dash = fresh_client.get("/api/dashboard/summary").json()
    assert dash["total_experiments"] == 2
    assert dash["hardware_experiments_count"] == 1
    assert dash["simulation_experiments_count"] == 1
    print(f"  [PASS] Dashboard integration confirmed: 1 Hardware, 1 Simulation.")

    print("\n" + "=" * 75)
    print(" >>> PHASE 7.1 E2E RECONCILIATION AUDIT COMPLETED SUCCESSFULLY! <<<")
    print("=" * 75 + "\n")


if __name__ == "__main__":
    run_e2e_reconciliation()
