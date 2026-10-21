"""
PoissonBurst Lab - Unit Tests for Core Poisson Mathematical Engine.
"""

import math
import pytest
from scipy.stats import poisson

from app.core.poisson import (
    calculate_dispersion,
    calculate_poisson_pmf,
    calculate_upper_tail_probability,
    detect_burst,
    detect_burst_batch,
    estimate_baseline_rate,
)


class TestBaselineEstimation:
    """Tests for estimate_baseline_rate function."""

    def test_baseline_estimation_known_values(self):
        """Test calculation of sample mean from known observations."""
        data = [10, 12, 8, 14, 6]
        result = estimate_baseline_rate(data)
        assert pytest.approx(result, 1e-6) == 10.0

    def test_baseline_estimation_single_value(self):
        """Test estimation with a single observation."""
        assert estimate_baseline_rate([42]) == 42.0

    def test_baseline_estimation_all_zeros(self):
        """Test estimation when traffic is completely silent."""
        assert estimate_baseline_rate([0, 0, 0, 0]) == 0.0

    def test_baseline_estimation_rejects_empty(self):
        """Test that empty input raises ValueError."""
        with pytest.raises(ValueError, match="Observations sequence cannot be empty"):
            estimate_baseline_rate([])

    def test_baseline_estimation_rejects_none(self):
        """Test that None input raises ValueError."""
        with pytest.raises(ValueError):
            estimate_baseline_rate(None)  # type: ignore

    def test_baseline_estimation_rejects_negative_counts(self):
        """Test that negative traffic arrival counts raise ValueError."""
        with pytest.raises(ValueError, match="is negative"):
            estimate_baseline_rate([10, 12, -1, 14])

    def test_baseline_estimation_rejects_nan(self):
        """Test that NaN values raise ValueError."""
        with pytest.raises(ValueError, match="non-finite"):
            estimate_baseline_rate([10, float("nan"), 12])

    def test_baseline_estimation_rejects_infinity(self):
        """Test that infinity raises ValueError."""
        with pytest.raises(ValueError, match="non-finite"):
            estimate_baseline_rate([10, float("inf"), 12])


class TestUpperTailProbability:
    """Tests for calculate_upper_tail_probability function."""

    def test_upper_tail_known_value(self):
        """Verify upper-tail calculation matches SciPy reference."""
        lam = 10.0
        x = 15
        expected = float(poisson.sf(x - 1, lam))
        actual = calculate_upper_tail_probability(x, lam)
        assert pytest.approx(actual, 1e-8) == expected

    def test_upper_tail_zero_observed(self):
        """For any valid Poisson distribution, P(X >= 0) is 1.0."""
        assert calculate_upper_tail_probability(0, 5.0) == 1.0
        assert calculate_upper_tail_probability(0, 0.0) == 1.0

    def test_upper_tail_zero_rate_positive_observed(self):
        """If expected rate is 0, observing > 0 arrivals has probability 0.0."""
        assert calculate_upper_tail_probability(1, 0.0) == 0.0
        assert calculate_upper_tail_probability(10, 0.0) == 0.0

    def test_upper_tail_extreme_tail(self):
        """For counts far above the mean, probability is very small but >= 0.0."""
        p = calculate_upper_tail_probability(50, 5.0)
        assert 0.0 <= p < 1e-15

    def test_upper_tail_rejects_negative_observed(self):
        """Negative observed counts are invalid."""
        with pytest.raises(ValueError, match="cannot be negative"):
            calculate_upper_tail_probability(-1, 10.0)

    def test_upper_tail_rejects_negative_rate(self):
        """Negative expected rates are invalid."""
        with pytest.raises(ValueError, match="cannot be negative"):
            calculate_upper_tail_probability(5, -2.0)

    def test_upper_tail_rejects_non_finite_rate(self):
        """Non-finite expected rates must be rejected."""
        with pytest.raises(ValueError, match="must be finite"):
            calculate_upper_tail_probability(5, float("nan"))
        with pytest.raises(ValueError, match="must be finite"):
            calculate_upper_tail_probability(5, float("inf"))


class TestBurstDetection:
    """Tests for detect_burst and detect_burst_batch functions."""

    def test_detect_unusually_high_observation(self):
        """Observation far above baseline must be flagged as a burst."""
        # Mean 10, observing 25 is statistically extreme
        res = detect_burst(observed_count=25, expected_rate=10.0, alpha=0.01)
        assert res.is_burst is True
        assert res.p_value < 0.01
        assert res.observed_count == 25
        assert res.expected_rate == 10.0
        assert res.alpha == 0.01

    def test_non_flagged_normal_observation(self):
        """Observation close to baseline must NOT be flagged as a burst."""
        res = detect_burst(observed_count=10, expected_rate=10.0, alpha=0.01)
        assert res.is_burst is False
        assert res.p_value >= 0.01

    def test_burst_detection_boundary_with_alpha(self):
        """Different alpha thresholds affect detection stringency."""
        # For lambda=10, x=17:
        # P(X >= 17) is ~0.027
        # At alpha=0.05, p < 0.05 -> burst is True
        # At alpha=0.01, p > 0.01 -> burst is False
        res_05 = detect_burst(observed_count=17, expected_rate=10.0, alpha=0.05)
        res_01 = detect_burst(observed_count=17, expected_rate=10.0, alpha=0.01)
        assert res_05.is_burst is True
        assert res_01.is_burst is False

    def test_invalid_alpha_values(self):
        """Alpha must lie strictly between 0 and 1."""
        with pytest.raises(ValueError, match="strictly between 0 and 1"):
            detect_burst(observed_count=10, expected_rate=5.0, alpha=0.0)

        with pytest.raises(ValueError, match="strictly between 0 and 1"):
            detect_burst(observed_count=10, expected_rate=5.0, alpha=1.0)

        with pytest.raises(ValueError, match="strictly between 0 and 1"):
            detect_burst(observed_count=10, expected_rate=5.0, alpha=-0.05)

        with pytest.raises(ValueError, match="strictly between 0 and 1"):
            detect_burst(observed_count=10, expected_rate=5.0, alpha=1.5)

    def test_batch_detection(self):
        """Test batch evaluation of multiple observations."""
        counts = [10, 11, 9, 25, 12, 30]
        results = detect_burst_batch(observations=counts, expected_rate=10.0, alpha=0.01)
        assert len(results) == 6
        assert not results[0].is_burst
        assert not results[1].is_burst
        assert not results[2].is_burst
        assert results[3].is_burst  # 25 is a burst
        assert not results[4].is_burst
        assert results[5].is_burst  # 30 is a burst

    def test_deterministic_consistency(self):
        """Ensure identical inputs always return identical results."""
        res1 = detect_burst(observed_count=20, expected_rate=10.0, alpha=0.01)
        res2 = detect_burst(observed_count=20, expected_rate=10.0, alpha=0.01)
        assert res1 == res2


class TestDispersionAndDistribution:
    """Tests for variance-to-mean ratio and PMF calculations."""

    def test_dispersion_equidispersed(self):
        """Test Poisson sample dispersion calculation."""
        # Observations with variance roughly equal to mean
        data = [10, 11, 9, 10, 12, 8, 10]
        res = calculate_dispersion(data)
        assert res.sample_mean > 0
        assert res.variance_to_mean_ratio > 0

    def test_dispersion_overdispersed(self):
        """Test sample with extreme variance yields overdispersion."""
        data = [2, 1, 2, 80, 95]
        res = calculate_dispersion(data)
        assert res.dispersion_type == "overdispersed"
        assert res.variance_to_mean_ratio > 1.0

    def test_pmf_generation(self):
        """Test Poisson PMF generator returns proper probabilities."""
        pmf_points = calculate_poisson_pmf(expected_rate=5.0, max_k=20)
        assert len(pmf_points) == 21
        # Sum of PMF for 0..20 with lambda=5 should be close to 1.0
        total_p = sum(pt["pmf"] for pt in pmf_points)
        assert pytest.approx(total_p, 1e-4) == 1.0
        assert pmf_points[0]["upper_tail"] == 1.0
