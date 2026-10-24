"""
PoissonBurst Lab - Statistical Regression Tests.

Comprehensive deterministic tests covering:
1. Chi-Square Goodness-of-Fit Tail Bin Accounting (no double-counting, exact sums).
2. Category pooling invariants:
   - sum(bin["observed"]) == len(observations)
   - abs(sum(bin["expected"]) - len(observations)) < 1e-3
   - Every observation belongs to exactly one category.
3. Independent validation of Pearson Chi-Square against a manual reference calculation.
4. Baseline Confidence Interval isolation:
   - Homogeneous normal Poisson (parameter vs sample estimate).
   - Sudden-burst (excluding injected burst windows).
   - Rate-drift & Overdispersed (statistically unavailable with meaningful explanation).
   - Historical dataset with clean baseline calibration windows.
   - Backward compatibility for older saved experiments without explicit flags.
5. PDF report generation when baseline CI is unavailable.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from typing import Generator
import numpy as np
import pytest
from scipy import stats as scipy_stats

from app.core.poisson import (
    calculate_poisson_confidence_interval,
    calculate_poisson_goodness_of_fit,
)
from app.core.schemas import (
    ExperimentDetailResponse,
    ExperimentType,
    MeasurementType,
    SimulationRequest,
    SimulationScenario,
    TrafficObservation,
    TrafficSource,
)
from app.services.data_loader import HistoricalDataLoader
from app.services.experiment_repository import ExperimentRepository
from app.services.pdf_report_generator import generate_experiment_pdf_report
from app.services.statistical_analysis import (
    compute_experiment_statistics,
    compute_threshold_sensitivity,
    extract_calibration_observations,
)
from app.services.traffic_simulator import run_traffic_simulation


@pytest.fixture
def temp_repo() -> Generator[ExperimentRepository, None, None]:
    """Create a temporary isolated SQLite database for testing."""
    tmpdir = tempfile.mkdtemp()
    db_path = os.path.join(tmpdir, "test_experiments.db")
    repo = ExperimentRepository(db_path=db_path)
    yield repo
    try:
        shutil.rmtree(tmpdir, ignore_errors=True)
    except Exception:
        pass


class TestGoodnessOfFitTailAccounting:
    """Verify Chi-Square Goodness-of-Fit final tail accounting and category pooling."""

    def test_gof_exact_user_audit_regression_case(self):
        """Exact user audit regression case:

        observations = [0] * 10 + [1] * 19 + [30]
        lambda_val = 1.0, fit_parameter = False, min_expected_frequency = 5.0
        Categories:
          [0]:   observed=10, expected≈11.036383
          [1]:   observed=19, expected≈11.036383
          [>=2]: observed=1,  expected≈7.927234
        Invariants:
          sum(observed) == 30
          sum(expected) ≈ 30
        Reference statistics:
          chi-square ≈ 11.897078, df = 2, p-value ≈ 0.00260965
        """
        obs = [0] * 10 + [1] * 19 + [30]
        res = calculate_poisson_goodness_of_fit(
            observations=obs,
            lambda_val=1.0,
            fit_parameter=False,
            min_expected_frequency=5.0,
        )

        assert res.is_valid is True
        assert len(res.bin_details) == 3

        # Invariant checks
        total_observed = sum(b["observed"] for b in res.bin_details)
        total_expected = sum(b["expected"] for b in res.bin_details)
        assert total_observed == 30
        assert abs(total_expected - 30.0) < 1e-3

        # Category checks
        b0, b1, b2 = res.bin_details
        assert b0["bin_label"] == "0"
        assert b0["observed"] == 10
        assert abs(b0["expected"] - 11.0364) < 1e-3

        assert b1["bin_label"] == "1"
        assert b1["observed"] == 19
        assert abs(b1["expected"] - 11.0364) < 1e-3

        assert b2["bin_label"] == ">=2"
        assert b2["observed"] == 1
        assert abs(b2["expected"] - 7.9272) < 1e-3

        # Reference statistics checks
        assert abs(res.chi2_statistic - 11.8971) < 1e-3
        assert res.degrees_of_freedom == 2
        assert abs(res.p_value - 0.00261) < 1e-4

    def test_exact_observed_and_expected_invariants_across_lambdas(self):
        """Invariant: sum(observed) == n and sum(expected) == n for every valid test."""
        rng = np.random.default_rng(seed=42)

        test_cases = [
            (3.0, 100),
            (5.5, 150),
            (10.0, 200),
            (18.0, 300),
            (30.0, 250),
        ]

        for lam, n_samples in test_cases:
            obs = rng.poisson(lam, size=n_samples).tolist()
            res = calculate_poisson_goodness_of_fit(
                observations=obs,
                lambda_val=lam,
                fit_parameter=False,
                min_expected_frequency=5.0,
            )

            assert res.is_valid is True, f"Failed for lambda={lam}: {res.explanation}"
            assert res.bin_details is not None
            assert len(res.bin_details) >= 2

            # 1. Total observed sum must exactly equal n
            total_observed = sum(b["observed"] for b in res.bin_details)
            assert total_observed == len(obs), (
                f"Observed sum {total_observed} != {len(obs)} for lambda={lam}"
            )

            # 2. Total expected sum must equal n within numerical tolerance
            total_expected = sum(b["expected"] for b in res.bin_details)
            assert abs(total_expected - len(obs)) < 1e-3, (
                f"Expected sum {total_expected} != {len(obs)} for lambda={lam}"
            )

            # 3. Every observation belongs to exactly one category
            for x in obs:
                matching_bins = 0
                for b in res.bin_details:
                    k_min = b["k_min"]
                    k_max = b["k_max"]
                    if k_max is None:
                        if x >= k_min:
                            matching_bins += 1
                    else:
                        if k_min <= x <= k_max:
                            matching_bins += 1
                assert matching_bins == 1, (
                    f"Observation {x} matched {matching_bins} bins for lambda={lam}"
                )

    def test_gof_observations_in_final_tail_category(self):
        """Tail observations (extreme counts) must be placed in the final open-ended category without double-counting."""
        np.random.seed(99)
        base = np.random.poisson(4.0, size=97).tolist()
        extreme_tail = [15, 18, 22]
        obs = base + extreme_tail

        res = calculate_poisson_goodness_of_fit(
            observations=obs,
            lambda_val=4.0,
            fit_parameter=False,
            min_expected_frequency=5.0,
        )

        assert res.is_valid is True
        last_bin = res.bin_details[-1]
        assert last_bin["k_max"] is None
        assert last_bin["bin_label"].startswith(">=")

        # The extreme tail values must be included in the last bin
        tail_k_min = last_bin["k_min"]
        assert all(t >= tail_k_min for t in extreme_tail)
        assert last_bin["observed"] >= 3

        # Exact total sum invariant
        assert sum(b["observed"] for b in res.bin_details) == len(obs)
        assert abs(sum(b["expected"] for b in res.bin_details) - len(obs)) < 1e-3

    def test_gof_tail_appended_or_merged_correctly(self):
        """Test both when the tail has sufficient expected frequency to form a bin and when it is merged."""
        rng = np.random.default_rng(seed=123)
        obs_large = rng.poisson(8.0, size=500).tolist()
        res_large = calculate_poisson_goodness_of_fit(obs_large, 8.0, min_expected_frequency=5.0)

        assert res_large.is_valid is True
        assert sum(b["observed"] for b in res_large.bin_details) == 500
        assert abs(sum(b["expected"] for b in res_large.bin_details) - 500) < 1e-3

        obs_small = rng.poisson(3.0, size=30).tolist()
        res_small = calculate_poisson_goodness_of_fit(obs_small, 3.0, min_expected_frequency=5.0)

        if res_small.is_valid:
            assert sum(b["observed"] for b in res_small.bin_details) == 30
            assert abs(sum(b["expected"] for b in res_small.bin_details) - 30) < 1e-3
            assert res_small.bin_details[-1]["k_max"] is None

    def test_gof_independent_chi2_reference_calculation(self):
        """Compare goodness-of-fit chi2 statistic directly to an independent reference implementation."""
        obs = [2, 3, 4, 3, 5, 2, 4, 3, 6, 4, 3, 5, 2, 3, 4, 5, 4, 3, 2, 4, 5, 3, 4, 3, 6]  # n=25
        lam = 3.6

        res = calculate_poisson_goodness_of_fit(
            observations=obs,
            lambda_val=lam,
            fit_parameter=False,
            min_expected_frequency=5.0,
        )

        assert res.is_valid is True

        manual_chi2 = 0.0
        for b in res.bin_details:
            obs_count = b["observed"]
            exp_freq = b["expected"]
            manual_chi2 += ((obs_count - exp_freq) ** 2) / exp_freq

        assert abs(res.chi2_statistic - manual_chi2) < 1e-3
        expected_p = float(scipy_stats.chi2.sf(manual_chi2, res.degrees_of_freedom))
        assert abs(res.p_value - expected_p) < 1e-4


class TestBaselineConfidenceIntervalIsolation:
    """Verify baseline confidence interval isolation and parameter distinction."""

    def test_homogeneous_poisson_simulation_ci(self, temp_repo):
        """poisson_normal: sample estimate vs configured parameter distinction."""
        req = SimulationRequest(
            scenario=SimulationScenario.POISSON_NORMAL,
            baseline_rate_per_second=2.4,
            duration_seconds=300,
            window_seconds=5.0,
            alpha=0.01,
            random_seed=42,
        )
        sim_res = run_traffic_simulation(req)
        temp_repo.save_simulation_experiment(req, sim_res)
        exp = temp_repo.get_experiment(sim_res.experiment_id)
        assert exp is not None

        stats = compute_experiment_statistics(exp)
        ci = stats.confidence_interval

        assert ci.is_valid is True
        assert ci.sample_size == sim_res.total_windows
        assert ci.lower_bound <= exp.baseline_lambda <= ci.upper_bound
        assert "sample estimate" in ci.interpretation
        assert "configured parameter" in ci.interpretation

        assert stats.confidence_interval_empirical is not None
        assert stats.confidence_interval_empirical.is_valid is True

    def test_sudden_burst_simulation_calibration_isolation(self, temp_repo):
        """sudden_burst: baseline CI must be computed ONLY from normal windows, excluding bursts."""
        req = SimulationRequest(
            scenario=SimulationScenario.SUDDEN_BURST,
            baseline_rate_per_second=2.0,
            burst_rate_per_second=12.0,
            burst_start_second=100.0,
            burst_duration_seconds=50.0,
            duration_seconds=300,
            window_seconds=5.0,
            alpha=0.01,
            random_seed=101,
        )
        sim_res = run_traffic_simulation(req)
        temp_repo.save_simulation_experiment(req, sim_res)
        exp = temp_repo.get_experiment(sim_res.experiment_id)
        assert exp is not None

        stats = compute_experiment_statistics(exp)
        ci = stats.confidence_interval

        assert ci.is_valid is True
        # Burst window count is 10 windows (50s / 5s)
        # Normal windows = 60 - 10 = 50 windows
        assert ci.sample_size < sim_res.total_windows
        assert ci.sample_size == 50
        # Baseline point estimate must be near 10.0 (normal rate = 2.0 * 5.0 = 10.0), NOT inflated by bursts!
        assert 8.5 <= ci.point_estimate <= 11.5
        assert "excluding 10 injected burst windows" in ci.interpretation

        # Meanwhile, empirical mean sequence interval includes bursts, so its point estimate is higher
        emp_ci = stats.confidence_interval_empirical
        assert emp_ci is not None
        assert emp_ci.sample_size == 60
        assert emp_ci.point_estimate > ci.point_estimate + 4.0

    def test_rate_drift_and_overdispersed_return_unavailable_ci(self, temp_repo):
        """rate_drift and overdispersed scenarios must return is_valid=False with explanatory message."""
        # 1. Rate drift
        req_drift = SimulationRequest(
            scenario=SimulationScenario.RATE_DRIFT,
            baseline_rate_per_second=2.0,
            drift_rate_per_second=6.0,
            duration_seconds=300,
            window_seconds=5.0,
            random_seed=42,
        )
        sim_drift = run_traffic_simulation(req_drift)
        temp_repo.save_simulation_experiment(req_drift, sim_drift)
        exp_drift = temp_repo.get_experiment(sim_drift.experiment_id)
        assert exp_drift is not None

        stats_drift = compute_experiment_statistics(exp_drift)
        assert stats_drift.confidence_interval.is_valid is False
        assert "violating the stationary Poisson assumption" in (stats_drift.confidence_interval.explanation or "")

        # 2. Overdispersed
        req_over = SimulationRequest(
            scenario=SimulationScenario.OVERDISPERSED,
            baseline_rate_per_second=2.0,
            dispersion_factor=3.0,
            duration_seconds=300,
            window_seconds=5.0,
            random_seed=42,
        )
        sim_over = run_traffic_simulation(req_over)
        temp_repo.save_simulation_experiment(req_over, sim_over)
        exp_over = temp_repo.get_experiment(sim_over.experiment_id)
        assert exp_over is not None

        stats_over = compute_experiment_statistics(exp_over)
        assert stats_over.confidence_interval.is_valid is False
        assert "overdispersed traffic because arrivals violate the Poisson model" in (stats_over.confidence_interval.explanation or "")

    def test_historical_clean_baseline_calibration(self, temp_repo):
        """Historical analysis must compute baseline CI strictly from clean calibration windows."""
        lines = ["timestamp,label"]
        for s in range(20):
            lines.append(f"2023-01-01 00:00:{s:02d},BENIGN")
        for s in range(20, 60):
            lines.append(f"2023-01-01 00:00:{s:02d},DDoS")

        csv_content = "\n".join(lines).encode("utf-8")

        res = HistoricalDataLoader.analyze_csv(
            content=csv_content,
            filename="historical_calib_test.csv",
            timestamp_column="timestamp",
            label_column="label",
            benign_label_value="BENIGN",
            window_seconds=5.0,
            baseline_mode="ratio",
            baseline_ratio=0.33,
            alpha=0.01,
        )

        assert res.calibration_window_indices is not None
        assert len(res.calibration_window_indices) > 0

        temp_repo.save_historical_experiment(
            filename="historical_calib_test.csv",
            res=res,
            config={
                "timestamp_column": "timestamp",
                "label_column": "label",
                "calibration_window_indices": res.calibration_window_indices,
            },
        )
        exp = temp_repo.get_experiment(res.experiment_id)
        assert exp is not None

        stats = compute_experiment_statistics(exp)
        ci = stats.confidence_interval

        assert ci.is_valid is True
        assert ci.sample_size == len(res.calibration_window_indices)
        assert abs(ci.point_estimate - res.lambda_window) < 1e-4

    def test_backward_compatibility_reconstruct_or_graceful_unavailable(self, temp_repo):
        """Older saved experiments without is_calibration should reconstruct cleanly or fail gracefully."""
        observations = [
            TrafficObservation(
                timestamp=f"2023-01-01T00:00:{i*5:02d}Z",
                count=10,
                source=TrafficSource.HISTORICAL,
                measurement_type=MeasurementType.FLOW_COUNT,
                window_seconds=5.0,
                time_seconds=i * 5.0,
                ground_truth=False,
            )
            for i in range(20)
        ]

        exp = ExperimentDetailResponse(
            experiment_id="legacy-exp-001",
            experiment_type=ExperimentType.HISTORICAL,
            title="Legacy Historical Experiment",
            created_at="2023-01-01T00:00:00Z",
            measurement_type=MeasurementType.FLOW_COUNT,
            window_seconds=5.0,
            baseline_lambda=10.0,
            baseline_rate_per_second=2.0,
            alpha=0.01,
            observation_count=20,
            detected_window_count=0,
            ground_truth_available=False,
            dataset_name="legacy.csv",
            observations=observations,
            detections=[],
            configuration={"baseline_ratio": 0.3},
        )

        stats = compute_experiment_statistics(exp)
        ci = stats.confidence_interval

        assert ci.is_valid is True
        assert ci.sample_size == 6
        assert ci.point_estimate == 10.0


class TestPdfReportInterpretationWhenCiUnavailable:
    """Verify that PDF generation renders safely when baseline CI is unavailable."""

    def test_pdf_renders_with_unavailable_ci(self, temp_repo):
        """Generate PDF for rate_drift experiment where CI is unavailable."""
        req = SimulationRequest(
            scenario=SimulationScenario.RATE_DRIFT,
            baseline_rate_per_second=2.0,
            drift_rate_per_second=6.0,
            duration_seconds=120,
            window_seconds=5.0,
            random_seed=42,
        )
        sim_res = run_traffic_simulation(req)
        temp_repo.save_simulation_experiment(req, sim_res)
        exp = temp_repo.get_experiment(sim_res.experiment_id)
        assert exp is not None

        pdf_bytes = generate_experiment_pdf_report(exp)
        assert len(pdf_bytes) > 1000
        assert pdf_bytes.startswith(b"%PDF")
