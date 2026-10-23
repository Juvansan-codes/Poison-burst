"""
PoissonBurst Lab - Advanced Statistical Analysis Service.

Computes comprehensive statistical summaries, goodness-of-fit diagnostics,
parameter confidence intervals, and threshold sensitivity curves
for saved experiment observations.
"""

from __future__ import annotations

import math
from typing import List, Optional, Sequence

from app.core.poisson import (
    calculate_dispersion,
    calculate_empirical_vs_theoretical_distribution,
    calculate_poisson_confidence_interval,
    calculate_poisson_goodness_of_fit,
    calculate_upper_tail_probability,
)
from app.core.schemas import (
    ConfidenceIntervalSchema,
    DistributionFitPointSchema,
    EvaluationMetrics,
    ExperimentDetailResponse,
    ExperimentStatisticsResponse,
    GoodnessOfFitSchema,
    ThresholdAnalysisResponse,
    ThresholdSensitivityPoint,
    TrafficObservation,
    TrafficSource,
)
from app.services.evaluation import evaluate_detection_performance


def compute_experiment_statistics(exp: ExperimentDetailResponse) -> ExperimentStatisticsResponse:
    """Compute complete statistical diagnostics and model fit metrics for a saved experiment."""
    observations = exp.observations
    obs_counts = [obs.count for obs in observations]
    n = len(obs_counts)

    # 1. Dispersion & Empirical Mean/Variance
    if n > 0:
        disp = calculate_dispersion(obs_counts)
        emp_mean = disp.sample_mean
        sample_var = disp.sample_variance
        vmr = disp.variance_to_mean_ratio
        disp_type = disp.dispersion_type
    else:
        emp_mean = 0.0
        sample_var = 0.0
        vmr = 0.0
        disp_type = "insufficient_data"

    # 2. Baseline Confidence Interval (Garwood exact method)
    ci_res = calculate_poisson_confidence_interval(
        observations=obs_counts if n > 0 else [],
        confidence_level=0.95,
    )
    ci_schema = ConfidenceIntervalSchema(
        confidence_level=ci_res.confidence_level,
        sample_size=ci_res.sample_size,
        total_arrivals=ci_res.total_arrivals,
        point_estimate=ci_res.point_estimate,
        lower_bound=ci_res.lower_bound,
        upper_bound=ci_res.upper_bound,
        method=ci_res.method,
        interpretation=ci_res.interpretation,
        is_valid=ci_res.is_valid,
        explanation=ci_res.explanation,
    )

    # 3. Goodness of Fit Diagnostics
    # Test 1: Against the frozen/calibrated baseline lambda (df = k_bins - 1)
    gof_baseline = calculate_poisson_goodness_of_fit(
        observations=obs_counts,
        lambda_val=exp.baseline_lambda,
        fit_parameter=False,
    )
    gof_b_schema = GoodnessOfFitSchema(
        test_name="Pearson Chi-Square vs Calibrated Baseline",
        is_valid=gof_baseline.is_valid,
        chi2_statistic=gof_baseline.chi2_statistic,
        degrees_of_freedom=gof_baseline.degrees_of_freedom,
        p_value=gof_baseline.p_value,
        null_hypothesis=gof_baseline.null_hypothesis,
        interpretation=gof_baseline.interpretation,
        bins_evaluated=gof_baseline.bins_evaluated,
        minimum_expected_frequency=gof_baseline.minimum_expected_frequency,
        bin_details=gof_baseline.bin_details,
        explanation=gof_baseline.explanation,
    )

    # Test 2: Against the empirical sample mean (df = k_bins - 2 because lambda was fitted)
    gof_emp = calculate_poisson_goodness_of_fit(
        observations=obs_counts,
        lambda_val=emp_mean,
        fit_parameter=True,
    )
    gof_e_schema = GoodnessOfFitSchema(
        test_name="Pearson Chi-Square vs Sample Mean",
        is_valid=gof_emp.is_valid,
        chi2_statistic=gof_emp.chi2_statistic,
        degrees_of_freedom=gof_emp.degrees_of_freedom,
        p_value=gof_emp.p_value,
        null_hypothesis=gof_emp.null_hypothesis,
        interpretation=gof_emp.interpretation,
        bins_evaluated=gof_emp.bins_evaluated,
        minimum_expected_frequency=gof_emp.minimum_expected_frequency,
        bin_details=gof_emp.bin_details,
        explanation=gof_emp.explanation,
    )

    # 4. Empirical vs Theoretical Distribution Points
    dist_points_raw = calculate_empirical_vs_theoretical_distribution(
        observations=obs_counts,
        lambda_val=exp.baseline_lambda,
    )
    dist_fit = [
        DistributionFitPointSchema(
            k=p["k"],
            observed_count=p["observed_count"],
            empirical_probability=p["empirical_probability"],
            theoretical_probability=p["theoretical_probability"],
            upper_tail_probability=p["upper_tail_probability"],
        )
        for p in dist_points_raw
    ]

    # 5. Interpretation Summary
    calibration_windows = (
        exp.configuration.get("baseline_window_count")
        or exp.configuration.get("calibration_windows")
    )

    summary_parts = [
        f"Analyzed {n} windows of duration W={exp.window_seconds}s ({exp.measurement_type.value}).",
        f"Calibrated baseline lambda = {exp.baseline_lambda:.4f} counts/window ({exp.baseline_rate_per_second:.4f} arrivals/sec).",
        f"Empirical mean = {emp_mean:.4f}, sample variance = {sample_var:.4f}, Variance-to-Mean Ratio (VMR) = {vmr:.4f} ({disp_type}).",
    ]
    if vmr > 1.15:
        summary_parts.append(
            "Significant overdispersion detected (VMR > 1.15), indicating arrival clustering, bursts, or non-constant intensity."
        )
    elif vmr < 0.85:
        summary_parts.append(
            "Underdispersion detected (VMR < 0.85), indicating more regular arrivals than a standard Poisson process."
        )
    else:
        summary_parts.append(
            "Variance-to-mean ratio is close to 1.0, consistent with the Poisson equidispersion property E[X] = Var(X)."
        )

    # Determine source
    source = TrafficSource.SIMULATION if exp.experiment_type.value == "simulation" else TrafficSource.HISTORICAL
    if exp.observations and hasattr(exp.observations[0], "source"):
        source = exp.observations[0].source

    return ExperimentStatisticsResponse(
        experiment_id=exp.experiment_id,
        title=exp.title,
        experiment_type=exp.experiment_type,
        measurement_type=exp.measurement_type,
        source=source,
        observation_count=n,
        window_seconds=exp.window_seconds,
        ground_truth_available=exp.ground_truth_available,
        empirical_mean=round(emp_mean, 6),
        sample_variance=round(sample_var, 6),
        variance_to_mean_ratio=round(vmr, 6),
        dispersion_type=disp_type,
        baseline_lambda=exp.baseline_lambda,
        baseline_rate_per_second=exp.baseline_rate_per_second,
        calibration_window_count=calibration_windows,
        original_alpha=exp.alpha,
        original_detected_count=exp.detected_window_count,
        confidence_interval=ci_schema,
        goodness_of_fit_baseline=gof_b_schema,
        goodness_of_fit_empirical=gof_e_schema,
        distribution_fit=dist_fit,
        evaluation=exp.evaluation,
        interpretation_summary=" ".join(summary_parts),
    )


def compute_threshold_sensitivity(
    exp: ExperimentDetailResponse,
    alphas: Sequence[float],
) -> ThresholdAnalysisResponse:
    """Evaluate detection outcomes across multiple alpha thresholds without altering the saved experiment."""
    observations = exp.observations
    baseline_lambda = exp.baseline_lambda
    w_sec = exp.window_seconds
    ground_truth = [obs.ground_truth for obs in observations]
    has_ground_truth = any(gt is not None for gt in ground_truth)

    points: List[ThresholdSensitivityPoint] = []

    for alpha in alphas:
        alpha_val = float(alpha)
        detections = []
        for obs in observations:
            p_val = calculate_upper_tail_probability(obs.count, baseline_lambda)
            detections.append(bool(p_val < alpha_val))

        flagged_count = sum(detections)

        eval_metrics = None
        if has_ground_truth:
            eval_metrics = evaluate_detection_performance(
                ground_truth=ground_truth,
                detections=detections,
                window_seconds=w_sec,
            )

        points.append(
            ThresholdSensitivityPoint(
                alpha=alpha_val,
                detected_window_count=flagged_count,
                evaluation=eval_metrics,
            )
        )

    note = (
        f"Derived sensitivity analysis evaluated across {len(alphas)} significance levels. "
        f"Original experiment '{exp.experiment_id}' used alpha = {exp.alpha} ({exp.detected_window_count} alerts). "
        f"Ground-truth metrics {'calculated from verified labels' if has_ground_truth else 'omitted because ground truth is unavailable'}."
    )

    return ThresholdAnalysisResponse(
        experiment_id=exp.experiment_id,
        baseline_lambda=baseline_lambda,
        window_seconds=w_sec,
        ground_truth_available=has_ground_truth,
        points=points,
        original_alpha=exp.alpha,
        original_detected_count=exp.detected_window_count,
        note=note,
    )
