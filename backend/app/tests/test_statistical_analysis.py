"""
PoissonBurst Lab - Milestone 5 Statistical Analysis & PDF Report Tests.

Tests for:
- Exact Garwood Poisson confidence intervals
- Pearson Chi-Square Goodness-of-Fit test with dynamic category pooling
- Empirical vs Theoretical distribution computation
- Threshold sensitivity analysis across multiple alpha levels
- PDF report generation and headers
- Error handling and edge cases
"""

from __future__ import annotations

import io
import os
import tempfile
import pytest
from fastapi.testclient import TestClient

from app.core.poisson import (
    calculate_empirical_vs_theoretical_distribution,
    calculate_poisson_confidence_interval,
    calculate_poisson_goodness_of_fit,
)
from app.core.schemas import (
    MeasurementType,
    SimulationRequest,
    SimulationScenario,
    ThresholdAnalysisRequest,
)
from app.main import app
from app.services.experiment_repository import get_experiment_repository
from app.services.traffic_simulator import run_traffic_simulation


class TestConfidenceIntervalCalculations:
    """Tests for calculate_poisson_confidence_interval."""

    def test_known_confidence_interval(self):
        # Sample of 100 observations with mean 10.0 (total = 1000)
        obs = [10] * 100
        res = calculate_poisson_confidence_interval(obs, confidence_level=0.95)

        assert res.is_valid is True
        assert res.sample_size == 100
        assert res.total_arrivals == 1000
        assert res.point_estimate == 10.0
        # For n=100, T=1000, 95% CI should be approximately [9.39, 10.64]
        assert 9.0 < res.lower_bound < 10.0
        assert 10.0 < res.upper_bound < 11.0
        assert res.lower_bound < res.point_estimate < res.upper_bound

    def test_zero_arrivals_confidence_interval(self):
        # 10 windows with 0 arrivals
        obs = [0] * 10
        res = calculate_poisson_confidence_interval(obs, confidence_level=0.95)

        assert res.is_valid is True
        assert res.sample_size == 10
        assert res.total_arrivals == 0
        assert res.lower_bound == 0.0
        # Upper bound: 0.5 * chi2.ppf(0.975, 2) / 10 = -ln(0.025) / 10 ~= 3.6888 / 10 = 0.3689
        assert 0.3 < res.upper_bound < 0.45

    def test_empty_observations(self):
        res = calculate_poisson_confidence_interval([], confidence_level=0.95)
        assert res.is_valid is False
        assert res.sample_size == 0
        assert "No baseline observations" in res.interpretation

    def test_invalid_confidence_level(self):
        with pytest.raises(ValueError):
            calculate_poisson_confidence_interval([5, 5], confidence_level=1.5)
        with pytest.raises(ValueError):
            calculate_poisson_confidence_interval([5, 5], confidence_level=0.0)


class TestGoodnessOfFitCalculations:
    """Tests for calculate_poisson_goodness_of_fit."""

    def test_insufficient_sample_size(self):
        obs = [5] * 10
        res = calculate_poisson_goodness_of_fit(obs, lambda_val=5.0)
        assert res.is_valid is False
        assert "insufficient" in res.interpretation.lower()
        assert res.chi2_statistic is None

    def test_zero_or_negative_lambda(self):
        obs = [0] * 30
        res = calculate_poisson_goodness_of_fit(obs, lambda_val=0.0)
        assert res.is_valid is False
        assert "positive" in res.interpretation.lower()

    def test_poisson_distributed_sample_fails_to_reject_null(self):
        # Generate 200 counts from a Poisson(12.0)
        import numpy as np
        rng = np.random.default_rng(42)
        poisson_data = rng.poisson(lam=12.0, size=200).tolist()

        res = calculate_poisson_goodness_of_fit(poisson_data, lambda_val=12.0, fit_parameter=False)
        assert res.is_valid is True
        assert res.chi2_statistic is not None
        assert res.degrees_of_freedom is not None and res.degrees_of_freedom > 0
        assert res.p_value is not None
        # Should fail to reject H0 (p >= 0.05) for a true Poisson sample
        assert res.p_value > 0.05
        assert "Fail to reject H0" in res.interpretation

    def test_overdispersed_sample_rejects_null(self):
        # Generate heavily overdispersed data (mix of small counts and massive bursts)
        obs = [2] * 80 + [45] * 30 + [80] * 20
        res = calculate_poisson_goodness_of_fit(obs, lambda_val=5.0, fit_parameter=False)
        assert res.is_valid is True
        assert res.p_value is not None
        # Severe overdispersion should reject H0 (p < 0.01)
        assert res.p_value < 0.01
        assert "Reject H0" in res.interpretation


class TestDistributionComparison:
    """Tests for calculate_empirical_vs_theoretical_distribution."""

    def test_distribution_points(self):
        obs = [5, 5, 6, 6, 4, 5, 7, 5, 6, 5]
        points = calculate_empirical_vs_theoretical_distribution(obs, lambda_val=5.4)

        assert len(points) > 5
        emp_sum = sum(p["empirical_probability"] for p in points)
        assert abs(emp_sum - 1.0) < 1e-4
        theo_sum = sum(p["theoretical_probability"] for p in points)
        assert 0.95 <= theo_sum <= 1.01


class TestStatisticalAnalysisApiEndpoints:
    """Integration tests for Milestone 5 REST endpoints."""

    @pytest.fixture
    def client(self):
        return TestClient(app)

    @pytest.fixture
    def saved_experiment_id(self, client):
        req = {
            "scenario": "sudden_burst",
            "baseline_rate_per_second": 12.0,
            "burst_rate_multiplier": 3.0,
            "window_seconds": 1.0,
            "duration_seconds": 60.0,
            "burst_start_second": 20.0,
            "burst_duration_seconds": 10.0,
            "alpha": 0.01,
            "random_seed": 123,
        }
        res = client.post("/api/simulation/generate", json=req)
        assert res.status_code == 200
        return res.json()["experiment_id"]

    def test_get_experiment_statistics(self, client, saved_experiment_id):
        res = client.get(f"/api/experiments/{saved_experiment_id}/statistics")
        assert res.status_code == 200
        data = res.json()

        assert data["experiment_id"] == saved_experiment_id
        assert data["observation_count"] == 60
        assert data["window_seconds"] == 1.0
        assert "empirical_mean" in data
        assert "sample_variance" in data
        assert "variance_to_mean_ratio" in data
        assert "confidence_interval" in data
        assert data["confidence_interval"]["is_valid"] is True
        assert data["confidence_interval"]["lower_bound"] < data["confidence_interval"]["upper_bound"]
        assert "goodness_of_fit_baseline" in data
        assert len(data["distribution_fit"]) > 10

    def test_run_threshold_analysis(self, client, saved_experiment_id):
        req = {"alphas": [0.10, 0.05, 0.01, 0.001]}
        res = client.post(f"/api/experiments/{saved_experiment_id}/threshold-analysis", json=req)
        assert res.status_code == 200
        data = res.json()

        assert data["experiment_id"] == saved_experiment_id
        assert len(data["points"]) == 4
        # Flagged count should be monotonically non-increasing as alpha becomes more stringent
        flagged_counts = [p["detected_window_count"] for p in data["points"]]
        assert flagged_counts[0] >= flagged_counts[1] >= flagged_counts[2] >= flagged_counts[3]

        # Verify ground truth metrics exist for simulation
        assert data["ground_truth_available"] is True
        for p in data["points"]:
            assert p["evaluation"] is not None
            assert 0.0 <= p["evaluation"]["precision"] <= 1.0
            assert 0.0 <= p["evaluation"]["recall"] <= 1.0

    def test_download_experiment_pdf_report(self, client, saved_experiment_id):
        res = client.get(f"/api/experiments/{saved_experiment_id}/report.pdf")
        assert res.status_code == 200
        assert res.headers["content-type"] == "application/pdf"
        assert f"PoissonBurst_Report_{saved_experiment_id}.pdf" in res.headers["content-disposition"]
        # PDF magic bytes
        assert res.content.startswith(b"%PDF")
        assert len(res.content) > 50000  # Report contains multiple pages and embedded charts

    def test_missing_experiment_404_statistics(self, client):
        res = client.get("/api/experiments/nonexistent-exp-999/statistics")
        assert res.status_code == 404

    def test_missing_experiment_404_threshold(self, client):
        res = client.post(
            "/api/experiments/nonexistent-exp-999/threshold-analysis",
            json={"alphas": [0.05, 0.01]},
        )
        assert res.status_code == 404

    def test_missing_experiment_404_report(self, client):
        res = client.get("/api/experiments/nonexistent-exp-999/report.pdf")
        assert res.status_code == 404
