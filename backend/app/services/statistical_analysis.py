"""
PoissonBurst Lab - Advanced Statistical Analysis Service.

Computes comprehensive statistical summaries, goodness-of-fit diagnostics,
parameter confidence intervals, and threshold sensitivity curves
for saved experiment observations.
"""

from __future__ import annotations

import math
from typing import List, Optional, Sequence, Tuple

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
    ExperimentType,
    GoodnessOfFitSchema,
    ThresholdAnalysisResponse,
    ThresholdSensitivityPoint,
    TrafficObservation,
    TrafficSource,
)
from app.services.evaluation import evaluate_detection_performance


def extract_calibration_observations(
    exp: ExperimentDetailResponse,
) -> Tuple[Optional[List[int]], Optional[str], Optional[str]]:
    """Identify and extract the exact calibration observation counts used to establish the baseline.

    Returns:
        (calibration_counts, calibration_description, failure_explanation)
    """
    # 1. Historical Analysis
    if exp.experiment_type == ExperimentType.HISTORICAL:
        # Check if observations explicitly mark is_calibration
        calib_obs = [obs.count for obs in exp.observations if getattr(obs, "is_calibration", None) is True]
        if calib_obs:
            return (
                calib_obs,
                f"Calibrated from {len(calib_obs)} clean baseline observation windows (excluding abnormal/attack windows).",
                None,
            )

        # Check configuration for calibration_window_indices
        config = exp.configuration or {}
        indices = config.get("calibration_window_indices")
        if indices and isinstance(indices, list):
            valid_indices = [int(i) for i in indices if 0 <= int(i) < len(exp.observations)]
            if valid_indices:
                counts = [exp.observations[i].count for i in valid_indices]
                return (
                    counts,
                    f"Calibrated from {len(counts)} baseline windows recorded in experiment configuration.",
                    None,
                )

        # Backward compatibility for existing historical records without explicit flags
        total_w = len(exp.observations)
        if total_w > 0:
            b_count = config.get("baseline_window_count")
            if b_count and int(b_count) > 0:
                candidates = list(range(min(total_w, int(b_count))))
            else:
                ratio = float(config.get("baseline_ratio", 0.3))
                num_base = max(1, int(round(total_w * ratio)))
                candidates = list(range(min(total_w, num_base)))

            # Exclude known ground-truth burst windows
            clean_candidates = [
                i for i in candidates if not exp.observations[i].ground_truth
            ]
            if clean_candidates:
                reconstructed_counts = [exp.observations[i].count for i in clean_candidates]
                reconstructed_mean = sum(reconstructed_counts) / len(clean_candidates)
                if abs(reconstructed_mean - exp.baseline_lambda) < 1e-3:
                    return (
                        reconstructed_counts,
                        f"Reconstructed from {len(clean_candidates)} verified clean baseline windows.",
                        None,
                    )

        return (
            None,
            None,
            "Baseline calibration observations could not be reconstructed reliably from stored historical metadata.",
        )

    # 2. Synthetic Simulation
    if exp.experiment_type == ExperimentType.SIMULATION:
        scenario = (exp.scenario or "").lower()

        if scenario == "poisson_normal":
            # Homogeneous Poisson process: all observations are representative of baseline lambda
            counts = [obs.count for obs in exp.observations]
            if counts:
                return (
                    counts,
                    f"Homogeneous Poisson process: all {len(counts)} observation windows represent the calibration sample.",
                    None,
                )
            return None, None, "Simulation contains zero observations."

        if scenario == "sudden_burst":
            # Normal background windows exclude the injected burst interval
            normal_counts = [
                obs.count
                for obs in exp.observations
                if (getattr(obs, "is_calibration", None) is True or (getattr(obs, "is_calibration", None) is None and obs.ground_truth is False))
            ]
            if normal_counts:
                burst_count = len(exp.observations) - len(normal_counts)
                return (
                    normal_counts,
                    f"Computed exclusively from {len(normal_counts)} normal background observation windows (excluding {burst_count} injected burst windows).",
                    None,
                )
            return None, None, "No normal observation windows found outside the injected burst interval."

        if scenario == "rate_drift":
            return (
                None,
                None,
                "Baseline confidence interval is statistically unavailable for rate-drift simulations because the arrival rate changes continuously over time, violating the stationary Poisson assumption of a constant mean parameter lambda.",
            )

        if scenario == "overdispersed":
            return (
                None,
                None,
                "Baseline confidence interval is statistically unavailable for overdispersed traffic because arrivals violate the Poisson model (variance significantly exceeds the mean). Standard Poisson confidence intervals assume equidispersed arrivals and understate estimation uncertainty.",
            )

        return None, None, f"Baseline confidence interval is unavailable for simulation scenario '{scenario}'."

    # 3. Hardware Monitoring Sessions
    if exp.experiment_type == ExperimentType.HARDWARE:
        # Check observations for explicit is_calibration flag
        calib_obs = [
            obs.count
            for obs in exp.observations
            if getattr(obs, "is_calibration", None) is True
        ]
        if calib_obs:
            return (
                calib_obs,
                f"Calibrated from {len(calib_obs)} clean baseline observation windows collected during the hardware calibration period.",
                None,
            )

        # Check configuration for calibration_counts list
        config = exp.configuration or {}
        calib_counts = config.get("calibration_counts")
        if calib_counts and isinstance(calib_counts, list) and len(calib_counts) > 0:
            return (
                [int(c) for c in calib_counts],
                f"Calibrated from {len(calib_counts)} baseline observation windows recorded in session configuration.",
                None,
            )

        if not config.get("is_calibrated", False) and exp.baseline_lambda == 0.0:
            return (
                None,
                None,
                "Hardware session was stopped without finalizing baseline calibration; detector operated uncalibrated.",
            )

        return (
            None,
            None,
            "Baseline calibration observations could not be extracted from stored hardware session data.",
        )

    # 4. Other future modes
    return None, None, "Baseline calibration observations cannot be established reliably."


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

    # 2. Baseline Confidence Interval (Garwood exact method on verified calibration sample)
    calib_counts, calib_desc, calib_fail_reason = extract_calibration_observations(exp)

    if calib_counts is not None and len(calib_counts) > 0:
        ci_res = calculate_poisson_confidence_interval(
            observations=calib_counts,
            confidence_level=0.95,
        )
        if exp.experiment_type == ExperimentType.SIMULATION and (exp.scenario or "").lower() == "poisson_normal":
            interp = (
                f"With 95% confidence, the true mean arrival count per window under this homogeneous Poisson process "
                f"lies within [{ci_res.lower_bound:.4f}, {ci_res.upper_bound:.4f}] "
                f"(sample estimate: {ci_res.point_estimate:.4f}, configured parameter: {exp.baseline_lambda:.4f}, "
                f"total arrivals: {ci_res.total_arrivals} across {ci_res.sample_size} windows). {calib_desc}"
            )
        elif exp.experiment_type == ExperimentType.SIMULATION and (exp.scenario or "").lower() == "sudden_burst":
            interp = (
                f"With 95% confidence, the true baseline arrival rate parameter lies within "
                f"[{ci_res.lower_bound:.4f}, {ci_res.upper_bound:.4f}] counts/window "
                f"(point estimate: {ci_res.point_estimate:.4f}, configured baseline: {exp.baseline_lambda:.4f}). {calib_desc}"
            )
        else:
            interp = (
                f"With 95% confidence, the true baseline arrival rate parameter lambda lies within "
                f"[{ci_res.lower_bound:.4f}, {ci_res.upper_bound:.4f}] counts/window "
                f"(point estimate: {ci_res.point_estimate:.4f}, calibrated baseline: {exp.baseline_lambda:.4f}). {calib_desc}"
            )

        ci_schema = ConfidenceIntervalSchema(
            confidence_level=ci_res.confidence_level,
            sample_size=ci_res.sample_size,
            total_arrivals=ci_res.total_arrivals,
            point_estimate=ci_res.point_estimate,
            lower_bound=ci_res.lower_bound,
            upper_bound=ci_res.upper_bound,
            method="Garwood Exact Poisson (Chi-Square)",
            interpretation=interp,
            is_valid=True,
            explanation=None,
        )
    else:
        ci_schema = ConfidenceIntervalSchema(
            confidence_level=0.95,
            sample_size=0,
            total_arrivals=0,
            point_estimate=0.0,
            lower_bound=0.0,
            upper_bound=0.0,
            method="Garwood Exact Poisson (Chi-Square)",
            interpretation=f"Baseline confidence interval unavailable: {calib_fail_reason}",
            is_valid=False,
            explanation=calib_fail_reason,
        )

    # 2b. Empirical Sample Mean Interval (across all observation windows)
    if n > 0:
        emp_ci_res = calculate_poisson_confidence_interval(
            observations=obs_counts,
            confidence_level=0.95,
        )
        emp_ci_schema = ConfidenceIntervalSchema(
            confidence_level=0.95,
            sample_size=n,
            total_arrivals=emp_ci_res.total_arrivals,
            point_estimate=round(emp_mean, 6),
            lower_bound=emp_ci_res.lower_bound,
            upper_bound=emp_ci_res.upper_bound,
            method="Garwood Poisson on Empirical Sample Mean",
            interpretation=(
                f"Overall empirical sample mean across all {n} windows is {emp_mean:.4f} "
                f"({emp_ci_res.total_arrivals} total arrivals). Under a hypothetical Poisson assumption over "
                f"the complete observation sequence, the 95% interval would be [{emp_ci_res.lower_bound:.4f}, {emp_ci_res.upper_bound:.4f}]. "
                f"Caution: This reflects overall observed intensity and must not be conflated with the calibrated baseline."
            ),
            is_valid=True,
            explanation=None,
        )
    else:
        emp_ci_schema = None

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
    if exp.experiment_type == ExperimentType.HARDWARE:
        source = TrafficSource.HARDWARE
    elif exp.experiment_type == ExperimentType.SIMULATION:
        source = TrafficSource.SIMULATION
    else:
        source = TrafficSource.HISTORICAL
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
        confidence_interval_empirical=emp_ci_schema,
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
