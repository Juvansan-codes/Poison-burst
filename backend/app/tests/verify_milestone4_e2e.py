"""
PoissonBurst Lab - Milestone 4 End-to-End Workflow Verification Script.

Executes the complete sequence required by Milestone 4:
1. Fresh database initialization
2. Simulation generation & persistence
3. Dashboard summary calculation
4. Experiment detail inspection
5. Historical CSV analysis & independent persistence
6. Distinguishable measurement semantics
7. CSV result export
8. Repository reopen persistence across restarts
"""

import io
import os
import tempfile
from fastapi.testclient import TestClient

# Set isolated test database
temp_dir = tempfile.TemporaryDirectory()
test_db_path = os.path.join(temp_dir.name, "e2e_verify.db")
os.environ["POISSONBURST_DB_PATH"] = test_db_path

from app.main import app
from app.services.experiment_repository import ExperimentRepository

client = TestClient(app)

def verify():
    print("=" * 60)
    print("STARTING MILESTONE 4 END-TO-END VERIFICATION")
    print("=" * 60)

    # 1. Fresh database verification
    repo = ExperimentRepository(db_path=test_db_path)
    initial_summary = repo.get_dashboard_summary()
    assert initial_summary.total_experiments == 0, "Database should start empty"
    print("1. [PASS] Fresh database initialized cleanly.")

    # 2. Run simulation through API
    sim_payload = {
        "scenario": "sudden_burst",
        "baseline_rate_per_second": 15.0,
        "duration_seconds": 30,
        "window_seconds": 1.0,
        "burst_start_second": 10.0,
        "burst_duration_seconds": 5.0,
        "burst_rate_per_second": 45.0,
        "alpha": 0.01,
        "random_seed": 42,
    }
    sim_res = client.post("/api/simulation/generate", json=sim_payload)
    assert sim_res.status_code == 200, f"Simulation failed: {sim_res.text}"
    sim_data = sim_res.json()
    sim_id = sim_data["experiment_id"]
    assert sim_id.startswith("sim-"), f"Unexpected simulation ID: {sim_id}"
    print(f"2. [PASS] Simulation executed and returned experiment ID: {sim_id}")

    # 3. Check dashboard summary reflects simulation
    dash_res = client.get("/api/dashboard/summary")
    assert dash_res.status_code == 200
    dash_data = dash_res.json()
    assert dash_data["total_experiments"] == 1
    assert dash_data["simulation_experiments_count"] == 1
    assert dash_data["historical_experiments_count"] == 0
    assert dash_data["latest_experiment"]["experiment_id"] == sim_id
    assert dash_data["latest_detected_count"] == sim_data["detected_burst_count"]
    print("3. [PASS] Dashboard reflects persisted simulation run.")

    # 4. Inspect experiment detail from History API
    detail_res = client.get(f"/api/experiments/{sim_id}")
    assert detail_res.status_code == 200
    detail_data = detail_res.json()
    assert detail_data["experiment_id"] == sim_id
    assert detail_data["measurement_type"] == "packet_count"
    assert len(detail_data["observations"]) == 30
    assert detail_data["evaluation"] is not None
    assert detail_data["evaluation"]["f1_score"] > 0.8
    print("4. [PASS] Experiment details and evaluation metrics verified.")

    # 5. Run historical CSV analysis
    csv_text = (
        "Flow ID,Timestamp,Total Packets,Label\n"
        "1,2026-10-23 12:00:00,10,BENIGN\n"
        "2,2026-10-23 12:00:02,12,BENIGN\n"
        "3,2026-10-23 12:00:04,11,BENIGN\n"
        "4,2026-10-23 12:00:06,14,BENIGN\n"
        "5,2026-10-23 12:00:08,125,DDoS\n"
        "6,2026-10-23 12:00:09,140,DDoS\n"
        "7,2026-10-23 12:00:11,10,BENIGN\n"
        "8,2026-10-23 12:00:13,13,BENIGN\n"
    )
    files = {"file": ("deterministic_eval.csv", csv_text.encode("utf-8"), "text/csv")}
    form_data = {
        "timestamp_column": "Timestamp",
        "label_column": "Label",
        "benign_label_value": "BENIGN",
        "window_seconds": "2.0",
        "baseline_mode": "ratio",
        "baseline_ratio": "0.5",
        "alpha": "0.01",
    }
    hist_res = client.post("/api/historical/analyze", files=files, data=form_data)
    assert hist_res.status_code == 200, f"Historical failed: {hist_res.text}"
    hist_data = hist_res.json()
    hist_id = hist_data["experiment_id"]
    assert hist_id.startswith("hist-"), f"Unexpected historical ID: {hist_id}"
    print(f"5. [PASS] Historical CSV analyzed and returned experiment ID: {hist_id}")

    # 6. Verify dashboard summary distinguishes both experiments
    dash_res2 = client.get("/api/dashboard/summary")
    dash_data2 = dash_res2.json()
    assert dash_data2["total_experiments"] == 2
    assert dash_data2["simulation_experiments_count"] == 1
    assert dash_data2["historical_experiments_count"] == 1
    assert "packet_count" in dash_data2["available_measurement_types"]
    assert "flow_count" in dash_data2["available_measurement_types"]
    print("6. [PASS] Distinct measurement types and counts preserved on dashboard.")

    # 7. Test CSV export for both experiments
    sim_export = client.get(f"/api/experiments/{sim_id}/export")
    assert sim_export.status_code == 200
    assert "packet_count" in sim_export.text
    assert "# PoissonBurst Lab Experiment Export" in sim_export.text

    hist_export = client.get(f"/api/experiments/{hist_id}/export")
    assert hist_export.status_code == 200
    assert "flow_count" in hist_export.text
    print("7. [PASS] CSV exports generated with correct metadata and observations.")

    # 8. Test persistence across server/repository reopen
    repo_reopen = ExperimentRepository(db_path=test_db_path)
    sim_persisted = repo_reopen.get_experiment(sim_id)
    hist_persisted = repo_reopen.get_experiment(hist_id)
    assert sim_persisted is not None
    assert hist_persisted is not None
    assert sim_persisted.experiment_id == sim_id
    assert hist_persisted.experiment_id == hist_id
    print("8. [PASS] Persistence across repository restart confirmed.")

    # 9. Test safe deletion
    del_res = client.delete(f"/api/experiments/{sim_id}")
    assert del_res.status_code == 200
    assert del_res.json()["status"] == "deleted"
    assert repo_reopen.get_experiment(sim_id) is None
    dash_after_del = repo_reopen.get_dashboard_summary()
    assert dash_after_del.total_experiments == 1
    print("9. [PASS] Safe deletion verified.")

    print("=" * 60)
    print("ALL MILESTONE 4 VERIFICATION STEPS PASSED SUCCESSFULLY!")
    print("=" * 60)

    try:
        temp_dir.cleanup()
    except Exception:
        pass

if __name__ == "__main__":
    verify()
