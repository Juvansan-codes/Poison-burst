"""
PoissonBurst Lab - API Route Definitions.

Exposes REST endpoints for health checks, baseline estimation, Poisson upper-tail
probability burst detection, batch analysis, dispersion checking, and simulation.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, HTTPException, status

from app.core.poisson import (
    calculate_dispersion,
    calculate_poisson_pmf,
    calculate_upper_tail_probability,
    detect_burst,
    detect_burst_batch,
    estimate_baseline_rate,
)
from app.core.schemas import (
    BaselineEstimateRequest,
    BaselineEstimateResponse,
    BatchDetectionRequest,
    BatchDetectionResponse,
    DetectionRequest,
    DetectionResponse,
    DispersionRequest,
    DispersionResponse,
    DistributionPoint,
    DistributionRequest,
    DistributionResponse,
    HealthResponse,
    SimulationRequest,
    SimulationResponse,
)
from app.services.data_loader import HistoricalDataLoader
from app.services.traffic_simulator import run_traffic_simulation

router = APIRouter()


@router.get("/health", response_model=HealthResponse, tags=["Health"])
def health_check() -> HealthResponse:
    """Return backend health and operational status."""
    return HealthResponse(
        status="healthy",
        app_name="PoissonBurst Lab Backend",
        version="1.0.0",
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@router.post(
    "/poisson/estimate",
    response_model=BaselineEstimateResponse,
    tags=["Poisson Engine"],
    status_code=status.HTTP_200_OK,
)
def estimate_baseline(req: BaselineEstimateRequest) -> BaselineEstimateResponse:
    """Estimate the baseline arrival rate (lambda_hat) from normal traffic observations.

    Accepts an array of traffic counts observed in fixed-duration windows and calculates
    the sample mean count per observation window.
    """
    try:
        baseline_rate = estimate_baseline_rate(req.observations)
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(err),
        )

    w_sec = req.window_seconds or 1.0
    rate_per_sec = baseline_rate / w_sec

    unit_note = (
        f"lambda_hat = {baseline_rate:.4f} counts per {w_sec}s window. "
        f"Arrival rate = {rate_per_sec:.4f} arrivals/second."
    )

    return BaselineEstimateResponse(
        baseline_rate=round(baseline_rate, 6),
        observation_count=len(req.observations),
        window_seconds=w_sec,
        rate_per_second=round(rate_per_sec, 6),
        unit_explanation=unit_note,
    )


@router.post(
    "/poisson/detect",
    response_model=DetectionResponse,
    tags=["Poisson Engine"],
    status_code=status.HTTP_200_OK,
)
def detect_traffic_burst(req: DetectionRequest) -> DetectionResponse:
    """Perform authoritative Poisson upper-tail burst detection on a single observation.

    Evaluates:
        p = P(X >= observed_count | expected_rate)
        Flagged as burst when p < alpha.
    """
    try:
        result = detect_burst(
            observed_count=req.observed_count,
            expected_rate=req.expected_rate,
            alpha=req.alpha,
        )
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(err),
        )

    if result.is_burst:
        interp = (
            f"ALERT: Statistically unusual arrival count {result.observed_count} "
            f"(P(X >= {result.observed_count} | lambda={result.expected_rate:.2f}) = {result.p_value:.6e} < alpha={result.alpha})."
        )
    else:
        interp = (
            f"NORMAL: Arrival count {result.observed_count} within expected variation "
            f"(P(X >= {result.observed_count} | lambda={result.expected_rate:.2f}) = {result.p_value:.6f} >= alpha={result.alpha})."
        )

    return DetectionResponse(
        observed_count=result.observed_count,
        expected_rate=result.expected_rate,
        p_value=result.p_value,
        alpha=result.alpha,
        is_burst=result.is_burst,
        interpretation=interp,
    )


@router.post(
    "/poisson/detect-batch",
    response_model=BatchDetectionResponse,
    tags=["Poisson Engine"],
    status_code=status.HTTP_200_OK,
)
def detect_traffic_burst_batch(req: BatchDetectionRequest) -> BatchDetectionResponse:
    """Evaluate a sequence of traffic observations against a baseline rate.

    Applies the shared Poisson detection engine to every observation.
    """
    try:
        results = detect_burst_batch(
            observations=req.observations,
            expected_rate=req.expected_rate,
            alpha=req.alpha,
        )
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(err),
        )

    resp_results: List[DetectionResponse] = []
    burst_count = 0

    for r in results:
        if r.is_burst:
            burst_count += 1
            interp = f"Flagged burst (p={r.p_value:.6e} < alpha={r.alpha})"
        else:
            interp = f"Normal observation (p={r.p_value:.6f} >= alpha={r.alpha})"

        resp_results.append(
            DetectionResponse(
                observed_count=r.observed_count,
                expected_rate=r.expected_rate,
                p_value=r.p_value,
                alpha=r.alpha,
                is_burst=r.is_burst,
                interpretation=interp,
            )
        )

    return BatchDetectionResponse(
        results=resp_results,
        total_observations=len(resp_results),
        detected_bursts=burst_count,
        expected_rate=req.expected_rate,
        alpha=req.alpha,
    )


@router.post(
    "/poisson/dispersion",
    response_model=DispersionResponse,
    tags=["Statistical Evaluation"],
    status_code=status.HTTP_200_OK,
)
def evaluate_dispersion(req: DispersionRequest) -> DispersionResponse:
    """Evaluate the sample mean, variance, and variance-to-mean ratio (index of dispersion).

    Under a true Poisson process, E[X] = Var(X) = lambda, yielding D = 1.0.
    """
    try:
        disp = calculate_dispersion(req.observations)
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(err),
        )

    if disp.dispersion_type == "equidispersed":
        expl = (
            f"VMR = {disp.variance_to_mean_ratio:.3f} (~1.0). "
            f"Traffic counts are consistent with a homogeneous Poisson process (E[X] ~= Var(X))."
        )
    elif disp.dispersion_type == "overdispersed":
        expl = (
            f"VMR = {disp.variance_to_mean_ratio:.3f} (> 1.0). "
            f"Traffic exhibits overdispersion (clustering / burstiness). Variance exceeds the mean."
        )
    else:
        expl = (
            f"VMR = {disp.variance_to_mean_ratio:.3f} (< 1.0). "
            f"Traffic exhibits underdispersion (more uniformly spaced than Poisson arrivals)."
        )

    return DispersionResponse(
        sample_mean=disp.sample_mean,
        sample_variance=disp.sample_variance,
        variance_to_mean_ratio=disp.variance_to_mean_ratio,
        dispersion_type=disp.dispersion_type,
        sample_size=disp.sample_size,
        explanation=expl,
    )


@router.post(
    "/poisson/distribution",
    response_model=DistributionResponse,
    tags=["Statistical Evaluation"],
    status_code=status.HTTP_200_OK,
)
def get_poisson_distribution(req: DistributionRequest) -> DistributionResponse:
    """Compute Poisson probability mass function (PMF) and upper-tail curve for visualization."""
    try:
        raw_points = calculate_poisson_pmf(
            expected_rate=req.expected_rate,
            max_k=req.max_k,
        )
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(err),
        )

    points = [
        DistributionPoint(
            k=pt["k"],
            pmf=pt["pmf"],
            upper_tail=pt["upper_tail"],
        )
        for pt in raw_points
    ]

    return DistributionResponse(
        expected_rate=req.expected_rate,
        points=points,
    )


@router.post(
    "/simulation/generate",
    response_model=SimulationResponse,
    tags=["Simulation Lab"],
    status_code=status.HTTP_200_OK,
)
def generate_simulation_experiment(req: SimulationRequest) -> SimulationResponse:
    """Run a deterministic synthetic traffic simulation.

    Generates time-series observations, runs the authoritative Poisson detector,
    and evaluates metrics against known injected ground-truth bursts.
    """
    try:
        return run_traffic_simulation(req)
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(err),
        )
    except Exception as err:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Simulation failed: {str(err)}",
        )


@router.get(
    "/historical/formats",
    tags=["Historical Replay"],
    status_code=status.HTTP_200_OK,
)
def get_historical_formats() -> dict:
    """Return supported historical formats and domain guidelines."""
    return {
        "supported_formats": HistoricalDataLoader.get_supported_formats(),
        "guidelines": {
            "packet_vs_flow": "CSV files from NetFlow/CICIDS represent flow counts. PCAP files represent packet counts. They must not be interchanged.",
            "unlabeled_semantics": "Unlabeled historical records must not be assumed to be normal traffic.",
            "phase": "Phase 2 implementation in progress.",
        },
    }
