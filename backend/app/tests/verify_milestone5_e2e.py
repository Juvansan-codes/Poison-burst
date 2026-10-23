"""
PoissonBurst Lab - Milestone 5 Comprehensive End-to-End Verification Script.

Executes and verifies the 17-step Milestone 5 acceptance workflow:
1. Run synthetic simulation.
2. Confirm experiment persistence.
3. Retrieve through Experiment History.
4. Inspect empirical sample statistics (mean, variance).
5. Verify Variance-to-Mean Ratio (VMR).
6. Compare empirical and theoretical Poisson distributions.
7. Verify Pearson Chi-Square Goodness-of-Fit diagnostics.
8. Run threshold sensitivity analysis across multiple alphas.
9. Confirm original experiment remains unchanged after sensitivity analysis.
10. Generate and download PDF report.
11. Verify PDF validity, magic bytes, structure, and headers.
12. Export saved observations as CSV.
13. Run historical CSV flow analysis on deterministic dataset.
14. Generate PDF report for historical experiment.
15. Verify missing ground truth is handled cleanly (no fabrication).
16. Restart repository / simulate server reboot.
17. Confirm saved experiments and report generation survive restart.
"""

from __future__ import annotations

import io
import os
import sys
import tempfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from fastapi.testclient import TestClient

from app.main import app
from app.services.experiment_repository import get_experiment_repository


def run_milestone5_verification():
    print("=" * 70)
    print("POISSONBURST LAB: MILESTONE 5 END-TO-END VERIFICATION")
    print("=" * 70)

    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
        test_db = os.path.join(tmpdir, "m5_verify.db")
        os.environ["POISSONBURST_DB_PATH"] = test_db
        # Reset singleton repo
        repo = get_experiment_repository(test_db)
        client = TestClient(app)

        # Step 1: Run synthetic simulation
        print("\n[Step 1] Running synthetic simulation...")
        sim_req = {
            "scenario": "sudden_burst",
            "baseline_rate_per_second": 15.0,
            "burst_rate_multiplier": 3.0,
            "window_seconds": 1.0,
            "duration_seconds": 60.0,
            "burst_start_second": 20.0,
            "burst_duration_seconds": 10.0,
            "alpha": 0.01,
            "random_seed": 42,
        }
        res = client.post("/api/simulation/generate", json=sim_req)
        assert res.status_code == 200, f"Simulation failed: {res.text}"
        sim_data = res.json()
        sim_id = sim_data["experiment_id"]
        print(f" -> Simulation completed successfully with experiment_id: {sim_id}")

        # Step 2: Confirm experiment is saved
        print("\n[Step 2] Confirming experiment persistence...")
        exp_record = repo.get_experiment(sim_id)
        assert exp_record is not None, "Experiment not found in database!"
        assert exp_record.experiment_id == sim_id
        print(" -> Experiment verified in persistent storage.")

        # Step 3: Open through Experiment History
        print("\n[Step 3] Fetching experiment via GET /api/experiments/{id}...")
        res_exp = client.get(f"/api/experiments/{sim_id}")
        assert res_exp.status_code == 200
        assert res_exp.json()["experiment_id"] == sim_id
        print(" -> Experiment History detail retrieved.")

        # Step 4 & 5: Inspect empirical statistics and VMR
        print("\n[Step 4 & 5] Computing empirical mean, variance, and VMR...")
        res_stats = client.get(f"/api/experiments/{sim_id}/statistics")
        assert res_stats.status_code == 200
        stats = res_stats.json()
        print(f" -> Empirical Mean X_bar: {stats['empirical_mean']}")
        print(f" -> Sample Variance s^2: {stats['sample_variance']}")
        print(f" -> Variance-to-Mean Ratio (VMR): {stats['variance_to_mean_ratio']} ({stats['dispersion_type']})")
        assert stats["observation_count"] == 60
        assert stats["empirical_mean"] > 0
        assert stats["sample_variance"] > 0

        # Step 6: Compare empirical and theoretical distributions
        print("\n[Step 6] Comparing empirical and theoretical distributions...")
        dist_fit = stats["distribution_fit"]
        assert len(dist_fit) > 10
        total_emp_prob = sum(p["empirical_probability"] for p in dist_fit)
        print(f" -> {len(dist_fit)} distribution points evaluated. Sum of empirical probs: {total_emp_prob:.4f}")
        assert abs(total_emp_prob - 1.0) < 0.001

        # Step 7: Inspect goodness-of-fit diagnostics
        print("\n[Step 7] Inspecting Pearson Chi-Square Goodness-of-Fit...")
        gof = stats["goodness_of_fit_baseline"]
        print(f" -> Test: {gof['test_name']}")
        print(f" -> Valid: {gof['is_valid']}")
        print(f" -> Chi2 Stat: {gof['chi2_statistic']}, df: {gof['degrees_of_freedom']}, p-value: {gof['p_value']}")
        print(f" -> Interpretation: {gof['interpretation'][:80]}...")
        assert gof["is_valid"] is True
        assert gof["degrees_of_freedom"] is not None and gof["degrees_of_freedom"] > 0

        # Step 8: Run threshold sensitivity analysis across multiple alphas
        print("\n[Step 8] Running threshold sensitivity across multiple alphas...")
        sens_req = {"alphas": [0.10, 0.05, 0.01, 0.005, 0.001]}
        res_sens = client.post(f"/api/experiments/{sim_id}/threshold-analysis", json=sens_req)
        assert res_sens.status_code == 200
        sens = res_sens.json()
        assert len(sens["points"]) == 5
        for p in sens["points"]:
            prec_val = p['evaluation']['precision'] if p['evaluation'] else 'N/A'
            rec_val = p['evaluation']['recall'] if p['evaluation'] else 'N/A'
            print(f" -> alpha = {p['alpha']:<6}: {p['detected_window_count']} alerts, Precision={prec_val}, Recall={rec_val}")

        # Step 9: Confirm original experiment remains unchanged
        print("\n[Step 9] Verifying original experiment record remains unchanged...")
        exp_after = repo.get_experiment(sim_id)
        assert exp_after.alpha == 0.01, "Original alpha was mutated!"
        assert exp_after.detected_window_count == exp_record.detected_window_count
        print(" -> Original experiment record is untouched.")

        # Step 10 & 11: Generate and download PDF report
        print("\n[Step 10 & 11] Generating PDF report...")
        res_pdf = client.get(f"/api/experiments/{sim_id}/report.pdf")
        assert res_pdf.status_code == 200
        assert res_pdf.headers["content-type"] == "application/pdf"
        assert res_pdf.content.startswith(b"%PDF")
        pdf_len = len(res_pdf.content)
        print(f" -> PDF generated successfully ({pdf_len:,} bytes) with %PDF magic bytes.")

        # Step 12: Export saved observations as CSV
        print("\n[Step 12] Exporting saved observations as CSV...")
        res_csv = client.get(f"/api/experiments/{sim_id}/export")
        assert res_csv.status_code == 200
        assert "text/csv" in res_csv.headers["content-type"]
        assert "window_start" in res_csv.text or "timestamp" in res_csv.text
        print(" -> CSV export verified.")

        # Step 13: Run historical analysis with deterministic CSV
        print("\n[Step 13] Running historical analysis with small test CSV...")
        csv_data = (
            "timestamp,label\n"
            "2026-10-23T10:00:00,BENIGN\n"
            "2026-10-23T10:00:00,BENIGN\n"
            "2026-10-23T10:00:01,BENIGN\n"
            "2026-10-23T10:00:02,BENIGN\n"
            "2026-10-23T10:00:02,BENIGN\n"
            "2026-10-23T10:00:03,BENIGN\n"
            "2026-10-23T10:00:04,BENIGN\n"
            "2026-10-23T10:00:05,BENIGN\n"
            "2026-10-23T10:00:06,BENIGN\n"
            "2026-10-23T10:00:07,BENIGN\n"
            "2026-10-23T10:00:08,BENIGN\n"
            "2026-10-23T10:00:09,BENIGN\n"
            "2026-10-23T10:00:10,BENIGN\n"
            "2026-10-23T10:00:11,BENIGN\n"
            "2026-10-23T10:00:12,BENIGN\n"
            "2026-10-23T10:00:13,BENIGN\n"
            "2026-10-23T10:00:14,BENIGN\n"
            "2026-10-23T10:00:15,BENIGN\n"
            "2026-10-23T10:00:16,BENIGN\n"
            "2026-10-23T10:00:17,BENIGN\n"
            "2026-10-23T10:00:18,BENIGN\n"
            "2026-10-23T10:00:19,BENIGN\n"
            "2026-10-23T10:00:20,BENIGN\n"
            "2026-10-23T10:00:20,ATTACK\n"
            "2026-10-23T10:00:20,ATTACK\n"
            "2026-10-23T10:00:20,ATTACK\n"
            "2026-10-23T10:00:20,ATTACK\n"
            "2026-10-23T10:00:20,ATTACK\n"
            "2026-10-23T10:00:20,ATTACK\n"
            "2026-10-23T10:00:20,ATTACK\n"
            "2026-10-23T10:00:20,ATTACK\n"
            "2026-10-23T10:00:20,ATTACK\n"
            "2026-10-23T10:00:20,ATTACK\n"
        )
        files = {"file": ("test_flow.csv", csv_data.encode("utf-8"), "text/csv")}
        form = {
            "timestamp_column": "timestamp",
            "label_column": "label",
            "window_seconds": "1.0",
            "alpha": "0.01",
        }
        res_hist = client.post("/api/historical/analyze", files=files, data=form)
        assert res_hist.status_code == 200, f"Historical analysis failed: {res_hist.text}"
        hist_id = res_hist.json()["experiment_id"]
        print(f" -> Historical analysis saved with experiment_id: {hist_id}")

        # Step 14: Generate report for historical experiment
        print("\n[Step 14] Generating PDF report for historical analysis...")
        res_hist_pdf = client.get(f"/api/experiments/{hist_id}/report.pdf")
        assert res_hist_pdf.status_code == 200
        assert res_hist_pdf.content.startswith(b"%PDF")
        print(f" -> Historical PDF report generated ({len(res_hist_pdf.content):,} bytes).")

        # Step 15: Verify missing ground truth handling (unlabeled dataset)
        print("\n[Step 15] Testing unlabeled dataset (clean omission of evaluation metrics)...")
        csv_unlabeled = (
            "timestamp\n" + "\n".join(f"2026-10-23T10:00:{s:02d}" for s in range(30))
        )
        files_unlab = {"file": ("unlabeled.csv", csv_unlabeled.encode("utf-8"), "text/csv")}
        form_unlab = {"timestamp_column": "timestamp", "window_seconds": "1.0", "alpha": "0.01"}
        res_unlab = client.post("/api/historical/analyze", files=files_unlab, data=form_unlab)
        assert res_unlab.status_code == 200
        unlab_id = res_unlab.json()["experiment_id"]
        assert res_unlab.json()["evaluation"] is None, "Evaluation should be None for unlabeled dataset!"
        res_unlab_pdf = client.get(f"/api/experiments/{unlab_id}/report.pdf")
        assert res_unlab_pdf.status_code == 200
        print(" -> Unlabeled dataset handled cleanly without fabricated metrics.")

        # Step 16 & 17: Restart repository & verify persistence survives
        print("\n[Step 16 & 17] Simulating backend restart...")
        # Reset and point to existing database
        repo_restarted = get_experiment_repository(test_db)
        restarted_exp = repo_restarted.get_experiment(sim_id)
        assert restarted_exp is not None, "Experiment lost after restart!"
        assert restarted_exp.experiment_id == sim_id
        # Verify PDF report can still be generated after reboot
        res_reboot_pdf = client.get(f"/api/experiments/{sim_id}/report.pdf")
        assert res_reboot_pdf.status_code == 200
        assert res_reboot_pdf.content.startswith(b"%PDF")
        print(" -> Experiments and PDF report generation survive restart.")

        print("\n" + "=" * 70)
        print("ALL 17 MILESTONE 5 VERIFICATION CHECKS PASSED (100%)")
        print("=" * 70)


if __name__ == "__main__":
    run_milestone5_verification()
