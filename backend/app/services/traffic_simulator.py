"""
PoissonBurst Lab - Deterministic Synthetic Traffic Simulator.

Generates reproducible network traffic time series under controlled experimental
scenarios, runs the authoritative Poisson detector, and computes ground-truth metrics.

Supported Scenarios:
1. POISSON_NORMAL: Homogeneous Poisson process with fixed arrival rate lambda.
2. SUDDEN_BURST: Baseline Poisson traffic interrupted by a controlled high-rate burst.
3. RATE_DRIFT: Poisson traffic with a non-stationary, linearly increasing arrival rate.
4. OVERDISPERSED: Traffic with variance substantially exceeding the mean (negative binomial / compound Poisson).
"""

from __future__ import annotations

import math
import uuid
from typing import List

import numpy as np

from app.core.poisson import detect_burst
from app.core.schemas import (
    DetectionResponse,
    MeasurementType,
    SimulationRequest,
    SimulationResponse,
    SimulationScenario,
    TrafficObservation,
    TrafficSource,
)
from app.services.evaluation import evaluate_detection_performance


def run_traffic_simulation(req: SimulationRequest) -> SimulationResponse:
    """Run a deterministic synthetic traffic simulation experiment.

    Rate Semantics:
        - req.baseline_rate_per_second: Arrival rate in arrivals per second.
        - req.window_seconds: Observation window duration W in seconds.
        - lambda_window: Baseline expected arrival count per window (lambda_hat = rate * W).
        The authoritative Poisson detector strictly evaluates counts against lambda_window.

    Args:
        req: Validated SimulationRequest parameters.

    Returns:
        SimulationResponse: Structured response with time series, detections, and evaluation metrics.
    """
    # Use modern NumPy random Generator for reproducible streams
    rng = np.random.default_rng(req.random_seed)
    experiment_id = f"sim-{uuid.uuid4().hex[:8]}"

    # Observation window timing
    window_sec = float(req.window_seconds)
    duration_sec = float(req.duration_seconds)
    total_windows = max(1, int(math.floor(duration_sec / window_sec)))

    baseline_rate_sec = float(req.baseline_rate_per_second or req.baseline_rate or 15.0)
    lambda_window = float(baseline_rate_sec * window_sec)

    burst_start = float(req.burst_start_second if req.burst_start_second is not None else min(25.0, duration_sec * 0.4))
    burst_duration = float(req.burst_duration_seconds if req.burst_duration_seconds is not None else min(10.0, duration_sec * 0.2))
    burst_rate_sec = float(req.burst_rate_per_second or req.burst_rate or (baseline_rate_sec * 3.0))
    burst_lambda_window = float(burst_rate_sec * window_sec)

    drift_end_sec = float(req.rate_drift_end_per_second if req.rate_drift_end_per_second is not None else (baseline_rate_sec * 3.0))
    dispersion_factor = float(req.dispersion_factor if req.dispersion_factor is not None else 3.0)

    observations: List[TrafficObservation] = []
    detections: List[DetectionResponse] = []
    ground_truth_labels: List[bool] = []
    detection_flags: List[bool] = []

    for i in range(total_windows):
        t_sec = round(i * window_sec, 3)
        iso_timestamp = f"T+{t_sec:.1f}s"

        is_injected_burst = False

        if req.scenario == SimulationScenario.POISSON_NORMAL:
            # Homogeneous Poisson process: X_t ~ Poisson(lambda_window)
            count = int(rng.poisson(lam=lambda_window))
            is_injected_burst = False

        elif req.scenario == SimulationScenario.SUDDEN_BURST:
            # Sudden elevated arrival rate during [burst_start, burst_start + burst_duration)
            if burst_start <= t_sec < (burst_start + burst_duration):
                count = int(rng.poisson(lam=burst_lambda_window))
                is_injected_burst = True
            else:
                count = int(rng.poisson(lam=lambda_window))
                is_injected_burst = False

        elif req.scenario == SimulationScenario.RATE_DRIFT:
            # Non-stationary background drift across duration
            max_drift_time = max(1.0, duration_sec - window_sec)
            progress = min(1.0, max(0.0, t_sec / max_drift_time))
            rate_t = baseline_rate_sec + (drift_end_sec - baseline_rate_sec) * progress
            lam_t = max(0.0, rate_t * window_sec)
            count = int(rng.poisson(lam=lam_t))
            # Ground truth is False: this is non-stationary background traffic, not an injected discrete attack
            is_injected_burst = False

        elif req.scenario == SimulationScenario.OVERDISPERSED:
            # Overdispersed traffic: Var(X) = k * E[X] with k > 1
            # Parameterized via Negative Binomial:
            # E[X] = mu = n(1 - p)/p = lambda_window
            # Var(X) = n(1 - p)/p^2 = k * mu => p = 1/k, n = mu / (k - 1)
            k = max(1.05, dispersion_factor)
            p_param = 1.0 / k
            n_param = max(0.01, lambda_window / (k - 1.0))
            count = int(rng.negative_binomial(n=n_param, p=p_param))
            # Ground truth is False: this is regular overdispersed traffic violating Poisson assumption
            is_injected_burst = False

        else:
            count = int(rng.poisson(lam=lambda_window))
            is_injected_burst = False

        obs = TrafficObservation(
            timestamp=iso_timestamp,
            time_seconds=t_sec,
            count=max(0, count),
            source=TrafficSource.SIMULATION,
            measurement_type=MeasurementType.PACKET_COUNT,
            ground_truth=is_injected_burst,
            experiment_id=experiment_id,
            window_seconds=window_sec,
            expected_baseline_count=round(lambda_window, 4),
        )
        observations.append(obs)
        ground_truth_labels.append(is_injected_burst)

        # Run authoritative Poisson detector against expected baseline count per window
        det_result = detect_burst(
            observed_count=obs.count,
            expected_rate=lambda_window,
            alpha=req.alpha,
        )

        decision_text = (
            f"Statistically unusual count {det_result.observed_count} (p={det_result.p_value:.6e} < alpha={req.alpha}). Flagged as burst."
            if det_result.is_burst
            else f"Normal traffic arrival {det_result.observed_count} (p={det_result.p_value:.6f} >= alpha={req.alpha})."
        )

        det_resp = DetectionResponse(
            observed_count=det_result.observed_count,
            expected_rate=round(det_result.expected_rate, 4),
            p_value=det_result.p_value,
            alpha=det_result.alpha,
            is_burst=det_result.is_burst,
            interpretation=decision_text,
            ground_truth=is_injected_burst,
            timestamp=iso_timestamp,
            time_seconds=t_sec,
        )
        detections.append(det_resp)
        detection_flags.append(det_result.is_burst)

    # Evaluate against known injected ground truth
    evaluation = evaluate_detection_performance(
        ground_truth=ground_truth_labels,
        detections=detection_flags,
        window_seconds=window_sec,
    )

    detected_count = sum(1 for d in detection_flags if d)
    injected_count = sum(1 for gt in ground_truth_labels if gt)

    # Model limitation notes for educational analysis
    if req.scenario == SimulationScenario.POISSON_NORMAL:
        model_note = (
            "Model assumptions are satisfied. Arrival counts follow an ideal Poisson process with "
            f"E[X] = Var(X) = {lambda_window:.2f}. Any flagged windows represent Type I errors (false alarms), "
            f"the rate of which is bounded by alpha = {req.alpha}."
        )
        summary_text = (
            f"Normal Poisson simulation completed ({total_windows} windows of {window_sec}s). "
            f"Observed {detected_count} statistical alerts at significance level alpha={req.alpha}."
        )
    elif req.scenario == SimulationScenario.SUDDEN_BURST:
        model_note = (
            f"Sudden traffic surge injected from T+{burst_start:.1f}s to T+{burst_start + burst_duration:.1f}s "
            f"at rate {burst_rate_sec:.1f} packets/s ({burst_lambda_window:.2f} per window). Evaluated against frozen "
            f"baseline lambda_window = {lambda_window:.2f} to prevent baseline contamination."
        )
        summary_text = (
            f"Sudden burst simulation: {injected_count} burst windows injected; "
            f"{detected_count} windows flagged by Poisson detector."
        )
    elif req.scenario == SimulationScenario.RATE_DRIFT:
        model_note = (
            "Traffic background arrival rate undergoes non-stationary linear drift from "
            f"{baseline_rate_sec:.1f} to {drift_end_sec:.1f} packets/s. Because the Poisson detector assumes a static "
            f"baseline (lambda_window = {lambda_window:.2f}), persistent upward drift triggers systematic alerts, "
            "demonstrating the limitation of fixed-baseline models in non-stationary networks."
        )
        summary_text = (
            f"Rate drift simulation: traffic drifted to {drift_end_sec:.1f} packets/s. "
            f"Detector generated {detected_count} alerts due to model-mismatch drift."
        )
    elif req.scenario == SimulationScenario.OVERDISPERSED:
        model_note = (
            "Traffic violates the Poisson equidispersion assumption (Var(X) = E[X]). Generated with Negative "
            f"Binomial distribution having variance-to-mean ratio D = {dispersion_factor:.2f}. Heavy tails cause "
            "frequent false alerts even under benign traffic, showing why dispersion testing (D = s^2 / X_bar) is essential."
        )
        summary_text = (
            f"Overdispersed traffic simulation (dispersion factor {dispersion_factor:.2f}): "
            f"{detected_count} alerts triggered due to heavy-tailed clustering."
        )
    else:
        model_note = "Synthetic simulation experiment."
        summary_text = f"Simulation finished with {total_windows} windows."

    return SimulationResponse(
        experiment_id=experiment_id,
        scenario=req.scenario.value,
        baseline_rate_per_second=round(baseline_rate_sec, 4),
        lambda_window=round(lambda_window, 4),
        baseline_rate=round(lambda_window, 4),  # backwards compatibility with dashboard
        window_seconds=window_sec,
        duration_seconds=int(duration_sec),
        total_windows=total_windows,
        detected_burst_count=detected_count,
        injected_burst_count=injected_count,
        observations=observations,
        detections=detections,
        evaluation=evaluation,
        summary=summary_text,
        model_limitation_note=model_note,
    )
