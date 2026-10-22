"""
PoissonBurst Lab - Unit and Integration Tests for Synthetic Traffic Simulator.
"""

import pytest
from app.core.schemas import (
    SimulationRequest,
    SimulationScenario,
)
from app.services.traffic_simulator import run_traffic_simulation


class TestSimulationGenerator:
    """Comprehensive tests for synthetic traffic simulation generator."""

    def test_poisson_normal_scenario(self):
        """Test homogeneous Poisson simulation."""
        req = SimulationRequest(
            scenario=SimulationScenario.POISSON_NORMAL,
            baseline_rate_per_second=20.0,
            duration_seconds=30,
            window_seconds=1.0,
            alpha=0.01,
            random_seed=42,
        )
        res = run_traffic_simulation(req)
        assert res.total_windows == 30
        assert res.lambda_window == 20.0
        assert res.baseline_rate_per_second == 20.0
        assert res.injected_burst_count == 0
        # For normal traffic, ground_truth must be False for all windows
        assert all(obs.ground_truth is False for obs in res.observations)
        assert all(det.expected_rate == 20.0 for det in res.detections)
        # Evaluation should have 0 true positives and 0 false negatives
        if res.evaluation:
            assert res.evaluation.true_positives == 0
            assert res.evaluation.false_negatives == 0

    def test_sudden_burst_scenario_ground_truth_and_return_to_baseline(self):
        """Test burst injection interval and verified return to baseline."""
        req = SimulationRequest(
            scenario=SimulationScenario.SUDDEN_BURST,
            baseline_rate_per_second=10.0,
            duration_seconds=50,
            window_seconds=1.0,
            burst_start_second=20,
            burst_duration_seconds=10,
            burst_rate_per_second=60.0,
            alpha=0.01,
            random_seed=99,
        )
        res = run_traffic_simulation(req)
        assert res.total_windows == 50
        assert res.lambda_window == 10.0
        assert res.injected_burst_count == 10

        # Verify ground truth intervals: True for 20 <= t < 30, False outside
        for obs in res.observations:
            t = obs.time_seconds
            if 20.0 <= t < 30.0:
                assert obs.ground_truth is True
            else:
                assert obs.ground_truth is False

        # Verify counts return to baseline after burst
        post_burst_counts = [
            obs.count for obs in res.observations if obs.time_seconds >= 30.0
        ]
        post_burst_mean = sum(post_burst_counts) / len(post_burst_counts)
        # Post burst mean should be close to baseline 10.0, far below burst 60.0
        assert 6.0 <= post_burst_mean <= 14.0

        # Evaluation metrics should reflect burst detection
        assert res.evaluation is not None
        assert res.evaluation.true_positives > 0
        assert res.evaluation.recall > 0.7
        assert res.evaluation.detection_delay_seconds is not None

    def test_rate_drift_scenario(self):
        """Test linear rate drift across simulation duration."""
        req = SimulationRequest(
            scenario=SimulationScenario.RATE_DRIFT,
            baseline_rate_per_second=10.0,
            duration_seconds=40,
            window_seconds=1.0,
            rate_drift_end_per_second=40.0,
            alpha=0.01,
            random_seed=7,
        )
        res = run_traffic_simulation(req)
        assert res.total_windows == 40
        assert res.lambda_window == 10.0
        # In drift scenario, ground_truth is False (no discrete attack injected)
        assert res.injected_burst_count == 0
        assert all(obs.ground_truth is False for obs in res.observations)

        # Average counts in the first quarter vs last quarter should show clear upward trend
        first_quarter = [obs.count for obs in res.observations[:10]]
        last_quarter = [obs.count for obs in res.observations[-10:]]
        assert sum(last_quarter) > sum(first_quarter)

    def test_overdispersed_traffic_scenario(self):
        """Test negative binomial overdispersed traffic with high variance."""
        req = SimulationRequest(
            scenario=SimulationScenario.OVERDISPERSED,
            baseline_rate_per_second=15.0,
            duration_seconds=50,
            window_seconds=1.0,
            dispersion_factor=4.0,
            alpha=0.01,
            random_seed=1234,
        )
        res = run_traffic_simulation(req)
        assert res.total_windows == 50
        assert res.lambda_window == 15.0
        assert res.injected_burst_count == 0
        assert all(obs.ground_truth is False for obs in res.observations)

    def test_reproducibility_with_seed(self):
        """Verify that identical requests with identical seeds produce identical observations."""
        req1 = SimulationRequest(
            scenario=SimulationScenario.SUDDEN_BURST,
            baseline_rate_per_second=12.0,
            duration_seconds=30,
            window_seconds=1.0,
            burst_start_second=10,
            burst_duration_seconds=5,
            burst_rate_per_second=50.0,
            alpha=0.01,
            random_seed=555,
        )
        req2 = SimulationRequest(
            scenario=SimulationScenario.SUDDEN_BURST,
            baseline_rate_per_second=12.0,
            duration_seconds=30,
            window_seconds=1.0,
            burst_start_second=10,
            burst_duration_seconds=5,
            burst_rate_per_second=50.0,
            alpha=0.01,
            random_seed=555,
        )
        res1 = run_traffic_simulation(req1)
        res2 = run_traffic_simulation(req2)

        counts1 = [obs.count for obs in res1.observations]
        counts2 = [obs.count for obs in res2.observations]
        assert counts1 == counts2

    def test_different_seeds_produce_different_sequences(self):
        """Verify that different seeds produce different realizations."""
        req1 = SimulationRequest(
            scenario=SimulationScenario.POISSON_NORMAL,
            baseline_rate_per_second=15.0,
            duration_seconds=30,
            random_seed=1,
        )
        req2 = SimulationRequest(
            scenario=SimulationScenario.POISSON_NORMAL,
            baseline_rate_per_second=15.0,
            duration_seconds=30,
            random_seed=2,
        )
        res1 = run_traffic_simulation(req1)
        res2 = run_traffic_simulation(req2)

        counts1 = [obs.count for obs in res1.observations]
        counts2 = [obs.count for obs in res2.observations]
        assert counts1 != counts2

    def test_expected_counts_scale_with_window_size(self):
        """Verify that lambda_window = baseline_rate * window_seconds."""
        req = SimulationRequest(
            scenario=SimulationScenario.POISSON_NORMAL,
            baseline_rate_per_second=10.0,
            duration_seconds=20,
            window_seconds=2.5,
            alpha=0.01,
            random_seed=10,
        )
        res = run_traffic_simulation(req)
        assert res.lambda_window == 25.0  # 10 * 2.5
        assert res.total_windows == 8     # 20 / 2.5
        assert all(det.expected_rate == 25.0 for det in res.detections)


class TestSimulationValidation:
    """Tests for parameter validation in SimulationRequest."""

    def test_reject_window_greater_than_duration(self):
        with pytest.raises(ValueError, match="cannot exceed total simulation duration"):
            SimulationRequest(
                duration_seconds=10,
                window_seconds=20.0,
            )

    def test_reject_burst_exceeding_duration(self):
        with pytest.raises(ValueError, match="exceeds simulation duration"):
            SimulationRequest(
                scenario=SimulationScenario.SUDDEN_BURST,
                duration_seconds=30,
                burst_start_second=25,
                burst_duration_seconds=10,
            )

    def test_reject_negative_burst_start(self):
        with pytest.raises(ValueError):
            SimulationRequest(
                scenario=SimulationScenario.SUDDEN_BURST,
                burst_start_second=-5,
            )

    def test_reject_invalid_dispersion_factor(self):
        with pytest.raises(ValueError):
            SimulationRequest(
                scenario=SimulationScenario.OVERDISPERSED,
                dispersion_factor=0.8,
            )

    def test_backward_compatibility_with_baseline_rate(self):
        req = SimulationRequest(
            baseline_rate=22.0,
            window_seconds=1.0,
        )
        assert req.baseline_rate_per_second == 22.0
        assert req.baseline_rate == 22.0
