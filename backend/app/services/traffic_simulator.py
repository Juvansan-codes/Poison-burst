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
from datetime import datetime, timezone
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
    """Run a deterministic traffic simulation experiment.

    Args:
        req: Simulation parameters including scenario, baseline rate, duration, burst parameters, and seed.

    Returns:
        SimulationResponse: Structured response with time series, detections, and metrics.
    """
    rng = np.random.RandomState(req.random_seed if req.random_seed is not None else 42)
    experiment_id = f"sim-{uuid.uuid4().hex[:8]}"

    total_windows = max(1, int(req.duration_seconds / req.window_seconds))
    lambda_baseline = float(req.baseline_rate)

    burst_start = req.burst_start_second or 25
    burst_duration = req.burst_duration_seconds or 10
    burst_rate = req.burst_rate if req.burst_rate is not None else (lambda_baseline * 3.0)

    observations: List[TrafficObservation] = []
    detections: List[DetectionResponse] = []
    ground_truth_labels: List[bool] = []
    detection_flags: List[bool] = []

    base_time = datetime.now(timezone.utc)

    for i in range(total_windows):
        t_sec = i * req.window_seconds
        iso_timestamp = f"T+{t_sec:.1f}s"

        is_injected_burst = False
        rate_t = lambda_baseline

        if req.scenario == SimulationScenario.POISSON_NORMAL:
            rate_t = lambda_baseline
            count = int(rng.poisson(lam=rate_t))
            is_injected_burst = False

        elif req.scenario == SimulationScenario.SUDDEN_BURST:
            if burst_start <= t_sec < (burst_start + burst_duration):
                rate_t = burst_rate
                is_injected_burst = True
            else:
                rate_t = lambda_baseline
                is_injected_burst = False
            count = int(rng.poisson(lam=rate_t))

        elif req.scenario == SimulationScenario.RATE_DRIFT:
            # Gradual upward drift across simulation
            progress = t_sec / max(1.0, float(req.duration_seconds))
            rate_t = lambda_baseline * (1.0 + 2.0 * progress)
            # Observations beyond 1.5x baseline marked as abnormal
            is_injected_burst = bool(rate_t >= (lambda_baseline * 1.5))
            count = int(rng.poisson(lam=rate_t))

        elif req.scenario == SimulationScenario.OVERDISPERSED:
            # Negative binomial / Gamma-Poisson mixture: Var(X) = mu + mu^2 / r > mu
            # Parameter r controls clustering (smaller r = higher dispersion)
            r = 3.0
            p_param = r / (r + lambda_baseline)
            count = int(rng.negative_binomial(n=r, p=p_param))
            # Burst if random event spikes significantly
            is_injected_burst = bool(count >= (lambda_baseline * 2.0))
        else:
            count = int(rng.poisson(lam=lambda_baseline))
            is_injected_burst = False

        obs = TrafficObservation(
            timestamp=iso_timestamp,
            count=max(0, count),
            source=TrafficSource.SIMULATION,
            measurement_type=MeasurementType.PACKET_COUNT,
            ground_truth=is_injected_burst,
            experiment_id=experiment_id,
            window_seconds=req.window_seconds,
        )
        observations.append(obs)
        ground_truth_labels.append(is_injected_burst)

        # Run authoritative Poisson detector against expected baseline rate
        det_result = detect_burst(
            observed_count=obs.count,
            expected_rate=lambda_baseline,
            alpha=req.alpha,
        )

        decision_text = (
            f"Statistically unusual count (p={det_result.p_value:.6f} < alpha={req.alpha}). Flagged as burst."
            if det_result.is_burst
            else f"Normal traffic arrival (p={det_result.p_value:.6f} >= alpha={req.alpha})."
        )

        det_resp = DetectionResponse(
            observed_count=det_result.observed_count,
            expected_rate=det_result.expected_rate,
            p_value=det_result.p_value,
            alpha=det_result.alpha,
            is_burst=det_result.is_burst,
            interpretation=decision_text,
        )
        detections.append(det_resp)
        detection_flags.append(det_result.is_burst)

    # Evaluate against known injected ground truth
    evaluation = evaluate_detection_performance(
        ground_truth=ground_truth_labels,
        detections=detection_flags,
        window_seconds=req.window_seconds,
    )

    detected_count = sum(1 for d in detection_flags if d)
    injected_count = sum(1 for gt in ground_truth_labels if gt)

    return SimulationResponse(
        experiment_id=experiment_id,
        scenario=req.scenario.value,
        baseline_rate=lambda_baseline,
        total_windows=total_windows,
        detected_burst_count=detected_count,
        injected_burst_count=injected_count,
        observations=observations,
        detections=detections,
        evaluation=evaluation,
    )
