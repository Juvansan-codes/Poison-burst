"""
PoissonBurst Lab - Unit Tests for Statistical Evaluation Service.
"""

import pytest
from app.services.evaluation import evaluate_detection_performance


class TestEvaluationMetrics:
    """Test suite for evaluate_detection_performance."""

    def test_perfect_detection(self):
        """Test ideal scenario where detections perfectly match ground truth."""
        ground_truth = [False, False, True, True, True, False, False]
        detections = [False, False, True, True, True, False, False]

        metrics = evaluate_detection_performance(
            ground_truth=ground_truth,
            detections=detections,
            window_seconds=1.0,
        )
        assert metrics is not None
        assert metrics.true_positives == 3
        assert metrics.false_positives == 0
        assert metrics.true_negatives == 4
        assert metrics.false_negatives == 0
        assert metrics.precision == 1.0
        assert metrics.recall == 1.0
        assert metrics.f1_score == 1.0
        assert metrics.false_positive_rate == 0.0
        assert metrics.detection_delay_seconds == 0.0

    def test_detection_delay_calculation(self):
        """Test that detection delay measures time to first detected burst window."""
        # Burst injected at index 2 (time 4.0s for window_seconds=2.0)
        # First detected at index 4 (time 8.0s), delay = 2 windows * 2.0s = 4.0s
        ground_truth = [False, False, True, True, True, False]
        detections =   [False, False, False, False, True, False]

        metrics = evaluate_detection_performance(
            ground_truth=ground_truth,
            detections=detections,
            window_seconds=2.0,
        )
        assert metrics is not None
        assert metrics.true_positives == 1
        assert metrics.false_negatives == 2
        assert metrics.detection_delay_seconds == 4.0

    def test_burst_never_detected_delay_is_none(self):
        """If an injected burst is completely missed, delay should be None (unavailable)."""
        ground_truth = [False, True, True, False]
        detections =   [False, False, False, False]

        metrics = evaluate_detection_performance(
            ground_truth=ground_truth,
            detections=detections,
            window_seconds=1.0,
        )
        assert metrics is not None
        assert metrics.true_positives == 0
        assert metrics.false_negatives == 2
        assert metrics.recall == 0.0
        assert metrics.detection_delay_seconds is None

    def test_no_injected_burst_delay_is_none(self):
        """For scenarios with no injected bursts (normal traffic), delay is not applicable (None)."""
        ground_truth = [False, False, False, False]
        detections =   [False, True, False, False]

        metrics = evaluate_detection_performance(
            ground_truth=ground_truth,
            detections=detections,
            window_seconds=1.0,
        )
        assert metrics is not None
        assert metrics.true_positives == 0
        assert metrics.false_positives == 1
        assert metrics.true_negatives == 3
        assert metrics.false_negatives == 0
        assert metrics.false_positive_rate == 0.25
        assert metrics.detection_delay_seconds is None

    def test_all_negative_no_detections_zero_division_safety(self):
        """Empty positives and negatives should return 0.0 without ZeroDivisionError."""
        ground_truth = [False, False, False]
        detections =   [False, False, False]

        metrics = evaluate_detection_performance(
            ground_truth=ground_truth,
            detections=detections,
        )
        assert metrics is not None
        assert metrics.true_positives == 0
        assert metrics.precision == 0.0
        assert metrics.recall == 0.0
        assert metrics.f1_score == 0.0
        assert metrics.false_positive_rate == 0.0

    def test_empty_or_mismatched_inputs_return_none(self):
        """Invalid inputs should return None gracefully."""
        assert evaluate_detection_performance([], []) is None
        assert evaluate_detection_performance([True], [True, False]) is None
        assert evaluate_detection_performance([None, None], [False, True]) is None
