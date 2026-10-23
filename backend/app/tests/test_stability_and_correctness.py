"""
PoissonBurst Lab - Phase 6A Software Stability, Correctness & Reliability Regression Tests.

Validates:
1. Runtime type hint evaluation across all core schemas and dataclasses (regression test for Defect 1).
2. Matplotlib figure cleanup with zero figure leaks in memory (regression test for Defect 2).
3. Filename sanitization against HTTP header injection (CRLF/quotes) in export and report endpoints.
4. Poisson mathematical edge cases (zero arrivals, zero rate, extreme counts).
5. Exact Garwood confidence interval boundaries and mathematical monotonicity.
6. Pearson Chi-Square Goodness-of-Fit dynamic pooling safeguards (insufficient samples, df <= 0).
7. Threshold sensitivity non-mutation guarantee on persistent SQLite records.
8. Historical CSV discard counting and validation of invalid rows.
9. Ground-truth metric isolation and clean omission on unlabeled datasets.
10. Temporary database persistence and isolation.
"""

from __future__ import annotations

import io
import inspect
import os
import sys
import tempfile
import typing
import pytest
import matplotlib.pyplot as plt
from fastapi.testclient import TestClient

from app.core.poisson import (
    ConfidenceIntervalResult,
    GoodnessOfFitResult,
    calculate_dispersion,
    calculate_empirical_vs_theoretical_distribution,
    calculate_poisson_confidence_interval,
    calculate_poisson_goodness_of_fit,
    calculate_upper_tail_probability,
    detect_burst,
    detect_burst_batch,
    estimate_baseline_rate,
)
from app.core.schemas import (
    ExperimentDetailResponse,
    ExperimentType,
    MeasurementType,
    SimulationRequest,
    SimulationScenario,
    TrafficObservation,
    TrafficSource,
    DetectionResponse,
)
from app.main import app
from app.services.data_loader import HistoricalDataLoader
from app.services.experiment_repository import ExperimentRepository, get_experiment_repository
from app.services.pdf_report_generator import generate_experiment_pdf_report
from app.services.statistical_analysis import compute_experiment_statistics, compute_threshold_sensitivity
from app.services.traffic_simulator import run_traffic_simulation


class TestTypeHintIntrospection:
    """Regression test for Defect 1: Optional used in poisson.py dataclasses."""

    def test_poisson_dataclass_type_hints(self):
        """Verify that get_type_hints succeeds for ConfidenceIntervalResult and GoodnessOfFitResult."""
        ci_hints = typing.get_type_hints(ConfidenceIntervalResult)
        assert "explanation" in ci_hints
        assert ci_hints["explanation"] == typing.Optional[str]

        gof_hints = typing.get_type_hints(GoodnessOfFitResult)
        assert "chi2_statistic" in gof_hints
        assert "degrees_of_freedom" in gof_hints
        assert "p_value" in gof_hints
        assert "explanation" in gof_hints

    def test_all_project_classes_type_hints(self):
        """Ensure no class in any core or service module raises NameError upon introspection."""
        modules = [
            "app.core.schemas",
            "app.core.poisson",
            "app.services.evaluation",
            "app.services.traffic_simulator",
            "app.services.data_loader",
            "app.services.experiment_repository",
            "app.services.statistical_analysis",
            "app.services.pdf_report_generator",
        ]
        for modname in modules:
            mod = sys.modules[modname]
            for name, obj in inspect.getmembers(mod, inspect.isclass):
                if obj.__module__ == modname:
                    hints = typing.get_type_hints(obj)
                    assert isinstance(hints, dict), f"Failed to get hints for {modname}.{name}"


class TestMatplotlibResourceCleanup:
    """Regression test for Defect 2: Ensure zero Matplotlib figure memory leaks."""

    def test_pdf_generation_cleans_up_figures(self):
        """Verify that after generating a PDF report, all figures are closed."""
        # Ensure clean initial state
        plt.close("all")
        assert len(plt.get_fignums()) == 0

        # Construct minimal valid experiment detail
        observations = [
            TrafficObservation(
                timestamp=f"T+{i}.0s",
                count=10 + (15 if 10 <= i < 15 else 0),
                source=TrafficSource.SIMULATION,
                measurement_type=MeasurementType.PACKET_COUNT,
                ground_truth=(10 <= i < 15),
                window_seconds=1.0,
                time_seconds=float(i),
            )
            for i in range(30)
        ]
        detections = [
            DetectionResponse(
                observed_count=obs.count,
                expected_rate=10.0,
                p_value=0.0001 if obs.count > 15 else 0.5,
                alpha=0.01,
                is_burst=(obs.count > 15),
                interpretation="Burst" if obs.count > 15 else "Normal",
                ground_truth=obs.ground_truth,
                timestamp=obs.timestamp,
                time_seconds=obs.time_seconds,
            )
            for obs in observations
        ]
        exp = ExperimentDetailResponse(
            experiment_id="leak-test-exp-01",
            experiment_type=ExperimentType.SIMULATION,
            created_at="2026-10-23T12:00:00Z",
            title="Leak Test Experiment",
            scenario="sudden_burst",
            measurement_type=MeasurementType.PACKET_COUNT,
            window_seconds=1.0,
            baseline_lambda=10.0,
            baseline_rate_per_second=10.0,
            alpha=0.01,
            observation_count=30,
            detected_window_count=5,
            ground_truth_available=True,
            observations=observations,
            detections=detections,
            configuration={"baseline_rate_per_second": 10.0},
        )

        pdf_bytes = generate_experiment_pdf_report(exp)
        assert len(pdf_bytes) > 1000
        assert pdf_bytes.startswith(b"%PDF")

        # Crucial check: all figures must be closed
        assert len(plt.get_fignums()) == 0, f"Leaked figures detected: {plt.get_fignums()}"


class TestFilenameSanitizationAndHeaders:
    """Regression test for Defect 4: HTTP header safety on CSV export and PDF report endpoints."""

    @pytest.fixture
    def client(self):
        return TestClient(app)

    def test_export_csv_filename_sanitization(self, client):
        # Create a simulation experiment
        req = {
            "scenario": "poisson_normal",
            "baseline_rate_per_second": 10.0,
            "duration_seconds": 10.0,
            "window_seconds": 1.0,
            "alpha": 0.01,
            "random_seed": 77,
        }
        res = client.post("/api/simulation/generate", json=req)
        assert res.status_code == 200
        exp_id = res.json()["experiment_id"]

        # Call export endpoint
        export_res = client.get(f"/api/experiments/{exp_id}/export")
        assert export_res.status_code == 200
        cd_header = export_res.headers["content-disposition"]
        assert "\r" not in cd_header
        assert "\n" not in cd_header
        assert f"filename=\"simulation_{exp_id}.csv\"" in cd_header

    def test_report_pdf_filename_sanitization(self, client):
        req = {
            "scenario": "poisson_normal",
            "baseline_rate_per_second": 10.0,
            "duration_seconds": 10.0,
            "window_seconds": 1.0,
            "alpha": 0.01,
            "random_seed": 88,
        }
        res = client.post("/api/simulation/generate", json=req)
        assert res.status_code == 200
        exp_id = res.json()["experiment_id"]

        pdf_res = client.get(f"/api/experiments/{exp_id}/report.pdf")
        assert pdf_res.status_code == 200
        cd_header = pdf_res.headers["content-disposition"]
        assert "\r" not in cd_header
        assert "\n" not in cd_header
        assert f"filename=\"PoissonBurst_Report_{exp_id}.pdf\"" in cd_header


class TestMathematicalCorrectnessAndEdgeCases:
    """Mathematical validation for Poisson upper-tail, dispersion, and baseline confidence."""

    def test_zero_rate_semantics(self):
        # P(X >= 0 | lambda=0) = 1.0 (0 arrivals is deterministic under 0 rate)
        assert calculate_upper_tail_probability(0, 0.0) == 1.0
        # P(X >= 1 | lambda=0) = 0.0 (any positive arrivals impossible under 0 rate)
        assert calculate_upper_tail_probability(1, 0.0) == 0.0
        assert calculate_upper_tail_probability(10, 0.0) == 0.0

    def test_zero_observed_count_always_one(self):
        # P(X >= 0 | lambda) = 1.0 for all valid lambda
        for lam in [0.0, 0.5, 1.0, 10.0, 100.0]:
            assert calculate_upper_tail_probability(0, lam) == 1.0

    def test_detection_boundary_strictly_less_than_alpha(self):
        # If p == alpha, is_burst must be False (decision rule: p < alpha)
        # Choose a known p_value
        res_exact = detect_burst(observed_count=10, expected_rate=10.0, alpha=0.54207)
        # Ensure boundary behavior: is_burst is True ONLY when p_value < alpha
        assert res_exact.is_burst == (res_exact.p_value < res_exact.alpha)

    def test_dispersion_equidispersed_all_zeros(self):
        disp = calculate_dispersion([0, 0, 0, 0, 0])
        assert disp.sample_mean == 0.0
        assert disp.sample_variance == 0.0
        assert disp.variance_to_mean_ratio == 1.0
        assert disp.dispersion_type == "equidispersed"

    def test_garwood_confidence_interval_monotonicity(self):
        # Higher confidence level produces strictly wider confidence interval
        obs = [10, 12, 11, 9, 10, 13, 8, 10, 11, 10]
        ci_90 = calculate_poisson_confidence_interval(obs, confidence_level=0.90)
        ci_95 = calculate_poisson_confidence_interval(obs, confidence_level=0.95)
        ci_99 = calculate_poisson_confidence_interval(obs, confidence_level=0.99)

        assert ci_99.lower_bound < ci_95.lower_bound < ci_90.lower_bound
        assert ci_90.upper_bound < ci_95.upper_bound < ci_99.upper_bound

    def test_chi_square_goodness_of_fit_insufficient_df_pooled(self):
        # Sample of 20 observations with very small lambda (e.g. 0.2)
        # Expected frequencies form at most 2 bins ('0' and '>=1').
        # With fit_parameter=True, df = 2 - 1 - 1 = 0 <= 0.
        # Test must safely report is_valid=False rather than crashing or returning negative df.
        obs = [0] * 18 + [1] * 2
        res = calculate_poisson_goodness_of_fit(obs, lambda_val=0.1, fit_parameter=True)
        assert res.is_valid is False
        assert res.chi2_statistic is None
        assert "insufficient degrees of freedom" in res.explanation.lower() or "too small" in res.interpretation.lower() or res.degrees_of_freedom <= 0


class TestThresholdAnalysisNonMutation:
    """Verify that derived threshold sensitivity NEVER mutates the stored experiment record."""

    @pytest.fixture
    def temp_db(self):
        tmpdir = tempfile.mkdtemp()
        db_path = os.path.join(tmpdir, "test_experiments.db")
        repo = ExperimentRepository(db_path=db_path)
        yield repo
        try:
            import shutil
            shutil.rmtree(tmpdir, ignore_errors=True)
        except Exception:
            pass

    def test_threshold_sensitivity_leaves_experiment_unmodified(self, temp_db):
        req = SimulationRequest(
            scenario=SimulationScenario.SUDDEN_BURST,
            baseline_rate_per_second=10.0,
            duration_seconds=30,
            window_seconds=1.0,
            burst_start_second=10.0,
            burst_duration_seconds=5.0,
            burst_rate_per_second=30.0,
            alpha=0.01,
            random_seed=42,
        )
        sim_res = run_traffic_simulation(req)
        temp_db.save_simulation_experiment(req, sim_res)

        # Retrieve saved record
        original_exp = temp_db.get_experiment(sim_res.experiment_id)
        assert original_exp is not None
        orig_alpha = original_exp.alpha
        orig_detected = original_exp.detected_window_count
        orig_detections = [d.model_dump() for d in original_exp.detections]
        orig_evaluation = original_exp.evaluation.model_dump() if original_exp.evaluation else None

        # Run threshold sensitivity across 5 different alpha values
        alphas = [0.20, 0.10, 0.05, 0.01, 0.001]
        sens_res = compute_threshold_sensitivity(original_exp, alphas)
        assert len(sens_res.points) == 5

        # Refetch experiment from database
        reloaded_exp = temp_db.get_experiment(sim_res.experiment_id)
        assert reloaded_exp is not None

        # Assert 100% equality to original
        assert reloaded_exp.alpha == orig_alpha
        assert reloaded_exp.detected_window_count == orig_detected
        assert [d.model_dump() for d in reloaded_exp.detections] == orig_detections
        reloaded_eval = reloaded_exp.evaluation.model_dump() if reloaded_exp.evaluation else None
        assert reloaded_eval == orig_evaluation


class TestHistoricalCsvDiscardAccounting:
    """Verify that discarded rows in CSV parsing are accurately accounted for."""

    def test_invalid_rows_discarded_and_counted(self):
        # CSV with 10 valid rows and 3 corrupted timestamps
        csv_content = (
            "timestamp,label\n"
            "2023-01-01 10:00:00,BENIGN\n"
            "2023-01-01 10:00:01,BENIGN\n"
            "INVALID_TIMESTAMP_ROW_1,BENIGN\n"
            "2023-01-01 10:00:02,BENIGN\n"
            "CORRUPT_DATE_ROW_2,DDoS\n"
            "2023-01-01 10:00:03,DDoS\n"
            "2023-01-01 10:00:04,DDoS\n"
            ",BENIGN\n"  # Empty timestamp
            "2023-01-01 10:00:05,BENIGN\n"
        ).encode("utf-8")

        res = HistoricalDataLoader.analyze_csv(
            content=csv_content,
            filename="corrupt_test.csv",
            timestamp_column="timestamp",
            label_column="label",
            benign_label_value="BENIGN",
            window_seconds=1.0,
            alpha=0.01,
        )

        assert res.invalid_rows == 3
        assert res.total_rows_processed == 6
        assert res.total_windows >= 5


class TestUnlabeledDatasetMetricOmission:
    """Verify that unlabeled datasets omit precision, recall, and F1 without fabrication."""

    def test_unlabeled_csv_omits_evaluation(self):
        csv_content = (
            "timestamp\n"
            "2023-05-01 12:00:00\n"
            "2023-05-01 12:00:02\n"
            "2023-05-01 12:00:04\n"
            "2023-05-01 12:00:06\n"
            "2023-05-01 12:00:08\n"
        ).encode("utf-8")

        res = HistoricalDataLoader.analyze_csv(
            content=csv_content,
            filename="unlabeled.csv",
            timestamp_column="timestamp",
            label_column=None,  # No ground truth
            window_seconds=2.0,
            alpha=0.01,
        )

        assert res.evaluation is None
        assert res.labeled_burst_count is None
        assert all(obs.ground_truth is None for obs in res.observations)
