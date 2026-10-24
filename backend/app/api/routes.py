"""
PoissonBurst Lab - API Route Definitions.

Exposes REST endpoints for health checks, baseline estimation, Poisson upper-tail
probability burst detection, batch analysis, dispersion checking, and simulation.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, Response, UploadFile, status

logger = logging.getLogger(__name__)

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
    DashboardSummaryResponse,
    DetectionRequest,
    DetectionResponse,
    DispersionRequest,
    DispersionResponse,
    DistributionPoint,
    DistributionRequest,
    DistributionResponse,
    ExperimentDetailResponse,
    ExperimentListResponse,
    ExperimentStatisticsResponse,
    ExperimentSummary,
    HealthResponse,
    HistoricalAnalysisResponse,
    HistoricalPreviewResponse,
    SimulationRequest,
    SimulationResponse,
    ThresholdAnalysisRequest,
    ThresholdAnalysisResponse,
)
from app.services.data_loader import HistoricalDataLoader
from app.services.experiment_repository import get_experiment_repository
from app.services.pdf_report_generator import generate_experiment_pdf_report
from app.services.statistical_analysis import (
    compute_experiment_statistics,
    compute_threshold_sensitivity,
)
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
    evaluates metrics against known injected ground-truth bursts, and persists
    the experiment to the SQLite storage layer.
    """
    try:
        res = run_traffic_simulation(req)
        repo = get_experiment_repository()
        repo.save_simulation_experiment(req, res)
        return res
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(err),
        )
    except Exception as err:
        logger.error(f"Simulation failed unexpectedly: {err}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Simulation execution failed due to an unexpected server error. Please verify input parameters.",
        )


@router.post(
    "/historical/preview",
    response_model=HistoricalPreviewResponse,
    tags=["Historical Replay"],
    status_code=status.HTTP_200_OK,
)
async def preview_historical_dataset(
    file: UploadFile = File(..., description="Uploaded CSV dataset file"),
) -> HistoricalPreviewResponse:
    """Preview uploaded historical network traffic CSV file.

    Extracts column headers, sample records, and infers likely timestamp
    and ground-truth label columns. Note: previews do NOT create experiment records.
    """
    filename = file.filename or "uploaded.csv"
    if not filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only .csv files are supported for historical flow analysis. Raw PCAP packet captures are scheduled for a future milestone.",
        )

    try:
        content = await file.read()
        return HistoricalDataLoader.preview_csv(content=content, filename=filename)
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(err),
        )
    except Exception as err:
        logger.error(f"CSV preview failed unexpectedly: {err}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to preview CSV due to an unexpected server error.",
        )


@router.post(
    "/historical/analyze",
    response_model=HistoricalAnalysisResponse,
    tags=["Historical Replay"],
    status_code=status.HTTP_200_OK,
)
async def analyze_historical_dataset(
    file: UploadFile = File(..., description="Uploaded historical CSV file"),
    timestamp_column: str = Form(..., description="Name of the column containing arrival timestamps"),
    label_column: Optional[str] = Form(None, description="Optional column containing flow ground truth labels"),
    benign_label_value: Optional[str] = Form("BENIGN", description="Label value(s) designating normal traffic"),
    window_seconds: float = Form(5.0, description="Duration of observation windows in seconds"),
    baseline_mode: str = Form("ratio", description="Baseline selection mode ('ratio', 'window_count', or 'timestamp_range')"),
    baseline_ratio: Optional[float] = Form(0.3, description="Fraction of windows to use for calibration"),
    baseline_window_count: Optional[int] = Form(None, description="Exact number of initial baseline windows"),
    baseline_start_timestamp: Optional[str] = Form(None, description="Start timestamp for baseline window range"),
    baseline_end_timestamp: Optional[str] = Form(None, description="End timestamp for baseline window range"),
    alpha: float = Form(0.01, description="Significance threshold for upper-tail detection"),
) -> HistoricalAnalysisResponse:
    """Run time-window aggregation, baseline calibration, Poisson burst detection, and persist the experiment."""
    filename = file.filename or "uploaded.csv"
    if not filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only .csv files are supported. PCAP packet captures are scheduled for a future milestone.",
        )

    try:
        content = await file.read()
        res = HistoricalDataLoader.analyze_csv(
            content=content,
            filename=filename,
            timestamp_column=timestamp_column,
            label_column=label_column,
            benign_label_value=benign_label_value,
            window_seconds=window_seconds,
            baseline_mode=baseline_mode,
            baseline_ratio=baseline_ratio,
            baseline_window_count=baseline_window_count,
            baseline_start_timestamp=baseline_start_timestamp,
            baseline_end_timestamp=baseline_end_timestamp,
            alpha=alpha,
        )
        repo = get_experiment_repository()
        repo.save_historical_experiment(
            filename=filename,
            res=res,
            config={
                "timestamp_column": timestamp_column,
                "label_column": label_column,
                "benign_label_value": benign_label_value,
                "window_seconds": window_seconds,
                "baseline_mode": baseline_mode,
                "baseline_ratio": baseline_ratio,
                "baseline_window_count": baseline_window_count,
                "baseline_start_timestamp": baseline_start_timestamp,
                "baseline_end_timestamp": baseline_end_timestamp,
                "alpha": alpha,
                "total_rows_processed": res.total_rows_processed,
                "invalid_rows": res.invalid_rows,
                "calibration_window_indices": res.calibration_window_indices,
            },
        )
        return res
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(err),
        )
    except Exception as err:
        logger.error(f"Historical analysis failed unexpectedly: {err}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Historical analysis failed due to an unexpected server error.",
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
            "measurement_type": "flow_count",
            "phase": "Milestone 3 Historical CSV Flow Replay Active.",
        },
    }


# =============================================================================
# Milestone 4: Persistent Experiment Management & Dashboard API
# =============================================================================

@router.get(
    "/experiments",
    response_model=ExperimentListResponse,
    tags=["Experiment History"],
    status_code=status.HTTP_200_OK,
)
def list_experiments(
    page: int = Query(1, ge=1, description="Page index (1-based)"),
    page_size: int = Query(10, ge=1, le=100, description="Items per page"),
    type: Optional[str] = Query(None, description="Filter by experiment type ('simulation' or 'historical')"),
    search: Optional[str] = Query(None, description="Search term for title or dataset name"),
) -> ExperimentListResponse:
    """Return a paginated list of stored experiment summaries."""
    repo = get_experiment_repository()
    return repo.list_experiments(
        page=page,
        page_size=page_size,
        experiment_type=type,
        search=search,
    )


@router.get(
    "/experiments/{experiment_id}",
    response_model=ExperimentDetailResponse,
    tags=["Experiment History"],
    status_code=status.HTTP_200_OK,
)
def get_experiment_details(experiment_id: str) -> ExperimentDetailResponse:
    """Return full configuration, observations, detections, and metrics for a saved experiment."""
    repo = get_experiment_repository()
    exp = repo.get_experiment(experiment_id)
    if not exp:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Experiment '{experiment_id}' was not found in persistent storage.",
        )
    return exp


@router.delete(
    "/experiments/{experiment_id}",
    tags=["Experiment History"],
    status_code=status.HTTP_200_OK,
)
def delete_experiment(experiment_id: str) -> dict:
    """Safely delete an experiment record by ID."""
    repo = get_experiment_repository()
    deleted = repo.delete_experiment(experiment_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Experiment '{experiment_id}' was not found.",
        )
    return {"status": "deleted", "experiment_id": experiment_id}


@router.get(
    "/experiments/{experiment_id}/export",
    tags=["Experiment History"],
    status_code=status.HTTP_200_OK,
)
def export_experiment_csv(experiment_id: str) -> Response:
    """Export saved experiment observations and detections as formatted CSV."""
    repo = get_experiment_repository()
    export_data = repo.export_experiment_csv(experiment_id)
    if not export_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Experiment '{experiment_id}' was not found for export.",
        )
    csv_content, filename = export_data
    safe_filename = filename.replace("\r", "").replace("\n", "").replace('"', "")
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_filename}"',
        },
    )


@router.get(
    "/dashboard/summary",
    response_model=DashboardSummaryResponse,
    tags=["Dashboard"],
    status_code=status.HTTP_200_OK,
)
def get_dashboard_summary() -> DashboardSummaryResponse:
    """Return real dashboard summary statistics calculated from persistent experiment records."""
    repo = get_experiment_repository()
    return repo.get_dashboard_summary()


# =============================================================================
# Milestone 5: Advanced Statistical Analysis & Experiment Report API
# =============================================================================

@router.get(
    "/experiments/{experiment_id}/statistics",
    response_model=ExperimentStatisticsResponse,
    tags=["Statistical Analysis"],
    status_code=status.HTTP_200_OK,
)
def get_experiment_statistics(experiment_id: str) -> ExperimentStatisticsResponse:
    """Return comprehensive empirical statistics, baseline confidence interval, and goodness-of-fit diagnostics."""
    repo = get_experiment_repository()
    exp = repo.get_experiment(experiment_id)
    if not exp:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Experiment '{experiment_id}' was not found in persistent storage.",
        )
    try:
        return compute_experiment_statistics(exp)
    except Exception as err:
        logger.error(f"Failed to compute statistics for experiment {experiment_id}: {err}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to calculate experiment statistics due to an unexpected server error.",
        )


@router.post(
    "/experiments/{experiment_id}/threshold-analysis",
    response_model=ThresholdAnalysisResponse,
    tags=["Statistical Analysis"],
    status_code=status.HTTP_200_OK,
)
def run_threshold_analysis(
    experiment_id: str,
    req: ThresholdAnalysisRequest,
) -> ThresholdAnalysisResponse:
    """Evaluate detection sensitivity across multiple alpha values without modifying the saved experiment."""
    repo = get_experiment_repository()
    exp = repo.get_experiment(experiment_id)
    if not exp:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Experiment '{experiment_id}' was not found in persistent storage.",
        )
    try:
        return compute_threshold_sensitivity(exp, req.alphas)
    except Exception as err:
        logger.error(f"Failed to compute threshold sensitivity for experiment {experiment_id}: {err}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to compute threshold sensitivity analysis due to an unexpected server error.",
        )


@router.get(
    "/experiments/{experiment_id}/report.pdf",
    tags=["Statistical Analysis"],
    status_code=status.HTTP_200_OK,
)
def download_experiment_pdf_report(experiment_id: str) -> Response:
    """Generate and download a professional, academic PDF report for the saved experiment."""
    repo = get_experiment_repository()
    exp = repo.get_experiment(experiment_id)
    if not exp:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Experiment '{experiment_id}' was not found for report generation.",
        )

    try:
        pdf_bytes = generate_experiment_pdf_report(exp)
    except Exception as err:
        logger.error(f"PDF report generation failed: {err}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate PDF experiment report due to an internal server error.",
        )

    safe_id = experiment_id.replace("\r", "").replace("\n", "").replace('"', "")
    filename = f"PoissonBurst_Report_{safe_id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Type": "application/pdf",
        },
    )


