"""
PoissonBurst Lab - Statistical Evaluation Service.

Computes confusion matrix, precision, recall, F1-score, false-positive rate,
and detection delay when ground-truth labels are available.

IMPORTANT RULES:
- Never fabricate performance metrics if ground truth is absent.
- Ensure zero-division safety when there are no positives or negatives.
"""

from __future__ import annotations

from typing import List, Optional, Sequence
from app.core.schemas import EvaluationMetrics


def evaluate_detection_performance(
    ground_truth: Sequence[Optional[bool]],
    detections: Sequence[bool],
    window_seconds: float = 1.0,
) -> Optional[EvaluationMetrics]:
    """Calculate statistical evaluation metrics comparing detections against known ground truth.

    Args:
        ground_truth: List of bool flags indicating whether each window was actually a burst.
                      If any window is None (unlabeled), evaluation must be handled with care.
        detections: List of bool flags indicating whether the Poisson detector flagged the window.
        window_seconds: Duration of each window in seconds for detection delay calculation.

    Returns:
        Optional[EvaluationMetrics]: Calculated metrics, or None if no valid ground truth exists.
    """
    if not ground_truth or not detections or len(ground_truth) != len(detections):
        return None

    # Filter out unlabeled windows
    pairs = [
        (gt, det, idx)
        for idx, (gt, det) in enumerate(zip(ground_truth, detections))
        if gt is not None
    ]

    if not pairs:
        return None

    tp = 0
    fp = 0
    tn = 0
    fn = 0
    first_injected_idx: Optional[int] = None
    first_detected_in_burst_idx: Optional[int] = None

    for gt, det, idx in pairs:
        if gt and first_injected_idx is None:
            first_injected_idx = idx

        if gt and det:
            tp += 1
            if first_detected_in_burst_idx is None:
                first_detected_in_burst_idx = idx
        elif not gt and det:
            fp += 1
        elif not gt and not det:
            tn += 1
        elif gt and not det:
            fn += 1

    precision = float(tp / (tp + fp)) if (tp + fp) > 0 else 0.0
    recall = float(tp / (tp + fn)) if (tp + fn) > 0 else 0.0
    f1_score = (
        float(2 * (precision * recall) / (precision + recall))
        if (precision + recall) > 0
        else 0.0
    )
    fpr = float(fp / (fp + tn)) if (fp + tn) > 0 else 0.0

    detection_delay: Optional[float] = None
    if first_injected_idx is not None and first_detected_in_burst_idx is not None:
        delay_windows = max(0, first_detected_in_burst_idx - first_injected_idx)
        detection_delay = float(delay_windows * window_seconds)

    return EvaluationMetrics(
        true_positives=tp,
        false_positives=fp,
        true_negatives=tn,
        false_negatives=fn,
        precision=round(precision, 4),
        recall=round(recall, 4),
        f1_score=round(f1_score, 4),
        false_positive_rate=round(fpr, 4),
        detection_delay_seconds=detection_delay,
    )
