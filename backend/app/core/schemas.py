"""
PoissonBurst Lab - Common Traffic Data and API Schemas.

Defines Pydantic models for traffic observations, API requests, and responses,
strictly enforcing the core contracts across historical, simulation, and hardware modes.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, field_validator, model_validator


class TrafficSource(str, Enum):
    """Origin of the network traffic observations."""
    HISTORICAL = "historical"
    SIMULATION = "simulation"
    HARDWARE = "hardware"


class MeasurementType(str, Enum):
    """Physical or logical quantity being measured in each observation window.

    CRITICAL DISTINCTION:
    - PACKET_COUNT: Actual packets recorded on the wire (from PCAPs or packet captures).
    - FLOW_COUNT: Aggregated network flows recorded in NetFlow/IPFIX/CSV summaries.
    - UDP_DATAGRAM_COUNT: Application-level UDP datagrams received by the hardware listener.
    These units represent fundamentally distinct statistical processes and MUST NOT be conflated.
    """
    PACKET_COUNT = "packet_count"
    FLOW_COUNT = "flow_count"
    UDP_DATAGRAM_COUNT = "udp_datagram_count"


class TrafficObservation(BaseModel):
    """Unified schema representing a single traffic observation in a time window.

    Attributes:
        timestamp: ISO-8601 string or numeric timestamp representing the window start or end.
        count: Non-negative arrival count observed in this window.
        source: Traffic source (historical, simulation, hardware).
        measurement_type: Specific measurement unit (packet_count, flow_count, udp_datagram_count).
        ground_truth: True if known burst, False if known normal, None if unlabeled.
                      NOTE: None/unlabeled must NOT be assumed to be normal.
        experiment_id: Optional identifier grouping observations into a single trial or run.
        window_seconds: Optional duration of the window in seconds.
    """
    timestamp: str = Field(
        ...,
        description="Timestamp identifying the observation window (ISO-8601 or formatted string).",
    )
    count: int = Field(
        ...,
        ge=0,
        description="Observed traffic count in this window. Must be non-negative integer.",
    )
    source: TrafficSource = Field(
        ...,
        description="Source of this observation: historical, simulation, or hardware.",
    )
    measurement_type: MeasurementType = Field(
        ...,
        description="Measurement unit: packet_count, flow_count, or udp_datagram_count.",
    )
    ground_truth: Optional[bool] = Field(
        default=None,
        description="Known ground truth label. None means unlabeled (do NOT assume normal).",
    )
    experiment_id: Optional[str] = Field(
        default=None,
        description="Identifier of the experiment or capture session.",
    )
    window_seconds: Optional[float] = Field(
        default=1.0,
        gt=0.0,
        description="Duration of the observation window in seconds.",
    )
    time_seconds: Optional[float] = Field(
        default=None,
        ge=0.0,
        description="Elapsed simulation or start time of this window in seconds.",
    )
    expected_baseline_count: Optional[float] = Field(
        default=None,
        ge=0.0,
        description="Expected baseline arrivals in this window (lambda_window).",
    )


# =====================================================================
# API Request / Response Models
# =====================================================================

class HealthResponse(BaseModel):
    """Backend service health status response."""
    status: str = Field("healthy", description="Service health state.")
    app_name: str = Field("PoissonBurst Lab Backend", description="Application name.")
    version: str = Field("1.0.0", description="API version.")
    timestamp: str = Field(..., description="Server timestamp.")


class BaselineEstimateRequest(BaseModel):
    """Request model for estimating baseline arrival rate."""
    observations: List[float] = Field(
        ...,
        min_length=1,
        description="Sequence of representative normal traffic counts.",
    )
    window_seconds: Optional[float] = Field(
        default=1.0,
        gt=0.0,
        description="Duration of each observation window in seconds (default: 1.0s).",
    )

    @field_validator("observations")
    @classmethod
    def validate_non_negative_observations(cls, v: List[float]) -> List[float]:
        if not v:
            raise ValueError("Observations list cannot be empty.")
        for idx, item in enumerate(v):
            if item < 0.0:
                raise ValueError(f"Observation at index {idx} is negative ({item}). Counts must be non-negative.")
        return v


class BaselineEstimateResponse(BaseModel):
    """Response model for baseline arrival rate estimation."""
    baseline_rate: float = Field(
        ...,
        description="Estimated mean count per observation window (lambda_hat).",
    )
    observation_count: int = Field(
        ...,
        description="Number of observations used for estimation.",
    )
    window_seconds: float = Field(
        ...,
        description="Duration of each window in seconds.",
    )
    rate_per_second: float = Field(
        ...,
        description="Estimated arrival rate normalized to arrivals per second.",
    )
    unit_explanation: str = Field(
        ...,
        description="Clarification of window count vs rate per second.",
    )


class DetectionRequest(BaseModel):
    """Request model for evaluating a single observation for a burst."""
    observed_count: int = Field(
        ...,
        ge=0,
        description="Observed traffic arrival count in the window.",
    )
    expected_rate: float = Field(
        ...,
        ge=0.0,
        description="Baseline expected arrival count per window (lambda_hat).",
    )
    alpha: float = Field(
        default=0.01,
        gt=0.0,
        lt=1.0,
        description="Significance level alpha, strictly between 0 and 1 (default: 0.01).",
    )


class DetectionResponse(BaseModel):
    """Response model containing authoritative Poisson burst detection results."""
    observed_count: int = Field(..., description="Observed traffic count in window.")
    expected_rate: float = Field(..., description="Expected baseline rate per window (lambda_hat).")
    p_value: float = Field(..., ge=0.0, le=1.0, description="Poisson upper-tail probability P(X >= x | lambda).")
    alpha: float = Field(..., description="Configured significance threshold.")
    is_burst: bool = Field(..., description="True if p_value < alpha, indicating a statistically unusual burst.")
    interpretation: str = Field(..., description="Human-readable explanation of the statistical decision.")
    ground_truth: Optional[bool] = Field(default=None, description="Actual ground truth status if known.")
    timestamp: Optional[str] = Field(default=None, description="Window timestamp label.")
    time_seconds: Optional[float] = Field(default=None, description="Window start time in seconds.")


class BatchDetectionRequest(BaseModel):
    """Request model for evaluating a sequence of observations."""
    observations: List[int] = Field(
        ...,
        min_length=1,
        description="Sequence of observed traffic counts.",
    )
    expected_rate: float = Field(
        ...,
        ge=0.0,
        description="Baseline expected arrival count per window (lambda_hat).",
    )
    alpha: float = Field(
        default=0.01,
        gt=0.0,
        lt=1.0,
        description="Significance level alpha, strictly between 0 and 1.",
    )

    @field_validator("observations")
    @classmethod
    def validate_non_negative_counts(cls, v: List[int]) -> List[int]:
        if not v:
            raise ValueError("Observations sequence cannot be empty.")
        for idx, item in enumerate(v):
            if item < 0:
                raise ValueError(f"Observation at index {idx} is negative ({item}).")
        return v


class BatchDetectionResponse(BaseModel):
    """Response model for batch burst detection."""
    results: List[DetectionResponse] = Field(..., description="Detection result for each observation.")
    total_observations: int = Field(..., description="Total number of evaluated observations.")
    detected_bursts: int = Field(..., description="Number of observations flagged as bursts.")
    expected_rate: float = Field(..., description="Expected baseline arrival rate used.")
    alpha: float = Field(..., description="Significance level used.")


class DispersionRequest(BaseModel):
    """Request model for testing the Poisson variance-to-mean relationship."""
    observations: List[float] = Field(
        ...,
        min_length=1,
        description="Sequence of traffic counts to evaluate for Poisson dispersion.",
    )


class DispersionResponse(BaseModel):
    """Response model containing sample dispersion statistics."""
    sample_mean: float = Field(..., description="Sample mean of arrival counts.")
    sample_variance: float = Field(..., description="Sample variance of arrival counts.")
    variance_to_mean_ratio: float = Field(..., description="Index of dispersion D = sample_variance / sample_mean.")
    dispersion_type: str = Field(..., description="'equidispersed', 'overdispersed', or 'underdispersed'.")
    sample_size: int = Field(..., description="Number of observations analyzed.")
    explanation: str = Field(..., description="Educational explanation of dispersion findings.")


class DistributionRequest(BaseModel):
    """Request model for calculating Poisson PMF and upper tail curves."""
    expected_rate: float = Field(..., ge=0.0, description="Poisson parameter lambda.")
    max_k: int = Field(default=35, ge=5, le=100, description="Maximum count k for the distribution.")


class DistributionPoint(BaseModel):
    """Single point on the Poisson distribution curve."""
    k: float
    pmf: float
    upper_tail: float


class DistributionResponse(BaseModel):
    """Response model for Poisson distribution visualization data."""
    expected_rate: float
    points: List[DistributionPoint]


class SimulationScenario(str, Enum):
    """Supported synthetic traffic generation scenarios."""
    POISSON_NORMAL = "poisson_normal"
    SUDDEN_BURST = "sudden_burst"
    RATE_DRIFT = "rate_drift"
    OVERDISPERSED = "overdispersed"


class SimulationRequest(BaseModel):
    """Request parameters for synthetic traffic simulation."""
    scenario: SimulationScenario = Field(
        default=SimulationScenario.SUDDEN_BURST,
        description="Traffic scenario to generate.",
    )
    baseline_rate_per_second: Optional[float] = Field(
        default=None,
        gt=0.0,
        description="Baseline arrival rate in arrivals per second.",
    )
    baseline_rate: Optional[float] = Field(
        default=None,
        gt=0.0,
        description="Alias for baseline_rate_per_second (for backward compatibility).",
    )
    duration_seconds: int = Field(
        default=60,
        ge=5,
        le=600,
        description="Total duration of the simulation in seconds.",
    )
    window_seconds: float = Field(
        default=1.0,
        gt=0.0,
        le=60.0,
        description="Duration of each observation window in seconds.",
    )
    burst_start_second: Optional[float] = Field(
        default=None,
        ge=0.0,
        description="Second at which the injected burst begins (for sudden_burst).",
    )
    burst_duration_seconds: Optional[float] = Field(
        default=None,
        gt=0.0,
        description="Duration of the injected burst in seconds (for sudden_burst).",
    )
    burst_rate_per_second: Optional[float] = Field(
        default=None,
        gt=0.0,
        description="Elevated arrival rate during burst in arrivals per second.",
    )
    burst_rate: Optional[float] = Field(
        default=None,
        gt=0.0,
        description="Alias for burst_rate_per_second (for backward compatibility).",
    )
    rate_drift_end_per_second: Optional[float] = Field(
        default=None,
        gt=0.0,
        description="Ending arrival rate for rate_drift scenario in arrivals per second.",
    )
    dispersion_factor: Optional[float] = Field(
        default=3.0,
        gt=1.0,
        description="Variance-to-mean ratio (D = Var/Mean > 1) for overdispersed scenario.",
    )
    alpha: float = Field(
        default=0.01,
        gt=0.0,
        lt=1.0,
        description="Significance level alpha for detection.",
    )
    random_seed: Optional[int] = Field(
        default=42,
        description="Seed for deterministic, reproducible simulation.",
    )

    @model_validator(mode="after")
    def validate_simulation_parameters(self) -> "SimulationRequest":
        # Reconcile baseline rate per second
        if self.baseline_rate_per_second is None:
            if self.baseline_rate is not None:
                self.baseline_rate_per_second = float(self.baseline_rate)
            else:
                self.baseline_rate_per_second = 15.0
        self.baseline_rate = self.baseline_rate_per_second

        if self.baseline_rate_per_second <= 0.0:
            raise ValueError("Baseline arrival rate per second must be strictly positive.")

        if self.duration_seconds <= 0:
            raise ValueError("Simulation duration must be strictly positive.")

        if self.window_seconds <= 0.0:
            raise ValueError("Window size must be strictly positive.")

        if self.window_seconds > self.duration_seconds:
            raise ValueError("Observation window size cannot exceed total simulation duration.")

        # Reconcile burst parameters for sudden_burst
        if self.scenario == SimulationScenario.SUDDEN_BURST:
            if self.burst_rate_per_second is None:
                if self.burst_rate is not None:
                    self.burst_rate_per_second = float(self.burst_rate)
                else:
                    self.burst_rate_per_second = float(self.baseline_rate_per_second * 3.0)
            self.burst_rate = self.burst_rate_per_second

            if self.burst_rate_per_second <= 0.0:
                raise ValueError("Burst arrival rate per second must be strictly positive.")

            if self.burst_start_second is None:
                self.burst_start_second = float(min(25.0, self.duration_seconds * 0.4))

            if self.burst_duration_seconds is None:
                self.burst_duration_seconds = float(min(10.0, self.duration_seconds * 0.2))

            if self.burst_start_second < 0.0:
                raise ValueError("Burst start time cannot be negative.")

            if self.burst_duration_seconds <= 0.0:
                raise ValueError("Burst duration must be strictly positive.")

            if (self.burst_start_second + self.burst_duration_seconds) > self.duration_seconds:
                raise ValueError(
                    f"Injected burst interval [{self.burst_start_second}s, "
                    f"{self.burst_start_second + self.burst_duration_seconds}s] "
                    f"exceeds simulation duration ({self.duration_seconds}s)."
                )

        # Validate rate drift
        elif self.scenario == SimulationScenario.RATE_DRIFT:
            if self.rate_drift_end_per_second is None:
                self.rate_drift_end_per_second = float(self.baseline_rate_per_second * 3.0)
            if self.rate_drift_end_per_second <= 0.0:
                raise ValueError("Drift ending arrival rate must be strictly positive.")

        # Validate overdispersed
        elif self.scenario == SimulationScenario.OVERDISPERSED:
            if self.dispersion_factor is None or self.dispersion_factor <= 1.0:
                raise ValueError("Dispersion factor must be strictly greater than 1.0 for overdispersed traffic.")

        return self


class EvaluationMetrics(BaseModel):
    """Performance evaluation against ground truth."""
    true_positives: int
    false_positives: int
    true_negatives: int
    false_negatives: int
    precision: float
    recall: float
    f1_score: float
    false_positive_rate: float
    detection_delay_seconds: Optional[float] = None


class SimulationResponse(BaseModel):
    """Response containing synthetic simulation results, detections, and evaluation."""
    experiment_id: str
    scenario: str
    baseline_rate_per_second: float
    lambda_window: float
    baseline_rate: float
    window_seconds: float
    duration_seconds: int
    total_windows: int
    detected_burst_count: int
    injected_burst_count: int
    observations: List[TrafficObservation]
    detections: List[DetectionResponse]
    evaluation: Optional[EvaluationMetrics] = None
    summary: Optional[str] = None
    model_limitation_note: Optional[str] = None


class HistoricalPreviewResponse(BaseModel):
    """Response containing metadata and sample records for uploaded historical CSV."""
    file_name: str = Field(..., description="Uploaded CSV filename.")
    file_size_bytes: int = Field(..., description="File size in bytes.")
    total_rows: int = Field(..., description="Total number of data rows in CSV.")
    columns: List[str] = Field(..., description="Header column names.")
    sample_rows: List[Dict[str, Any]] = Field(..., description="Sample data records for preview.")
    suggested_timestamp_column: Optional[str] = Field(
        default=None,
        description="Suggested column name matching timestamp patterns.",
    )
    suggested_label_column: Optional[str] = Field(
        default=None,
        description="Suggested column name matching attack/class label patterns.",
    )
    detected_label_values: List[str] = Field(
        default_factory=list,
        description="Unique sample label values found in dataset (e.g. BENIGN, DDoS).",
    )
    timestamp_diagnostics: Optional[str] = Field(
        default=None,
        description="Diagnostic information regarding timestamp parsing.",
    )
    warnings: List[str] = Field(
        default_factory=list,
        description="Parsing warnings or data quality remarks.",
    )


class HistoricalAnalysisResponse(BaseModel):
    """Response containing historical flow aggregation, baseline calibration, and detections."""
    experiment_id: str = Field(..., description="Unique experiment identifier.")
    file_name: str = Field(..., description="Source CSV filename.")
    measurement_type: MeasurementType = Field(
        default=MeasurementType.FLOW_COUNT,
        description="Measurement unit: strictly flow_count for CSV flow summaries.",
    )
    measurement_unit_description: str = Field(
        default="Network flows per observation window",
        description="Clear user-facing measurement unit description.",
    )
    window_seconds: float = Field(..., description="Duration of each observation window in seconds.")
    total_rows_processed: int = Field(..., description="Number of valid flow records parsed and processed.")
    invalid_rows: int = Field(..., description="Number of discarded rows due to unparseable timestamps.")
    total_windows: int = Field(..., description="Total number of contiguous observation windows.")
    baseline_window_count: int = Field(..., description="Number of baseline calibration windows used.")
    lambda_window: float = Field(..., description="Estimated baseline mean count per window (lambda_hat).")
    baseline_rate_per_second: float = Field(..., description="Baseline flow arrival rate per second (lambda_hat / W).")
    calibration_method: str = Field(..., description="Description of the calibration period and exclusion rules.")
    detected_burst_count: int = Field(..., description="Number of windows flagged as Poisson burst alerts.")
    labeled_burst_count: Optional[int] = Field(
        default=None,
        description="Number of windows labeled as attack/burst ground truth.",
    )
    observations: List[TrafficObservation] = Field(..., description="Aggregated time-series observations.")
    detections: List[DetectionResponse] = Field(..., description="Authoritative Poisson detection outcomes.")
    evaluation: Optional[EvaluationMetrics] = Field(
        default=None,
        description="Performance evaluation against ground truth if labels were available.",
    )
    summary: str = Field(..., description="Summary of experiment and results.")
    model_limitation_note: str = Field(..., description="Scientific note on Poisson model assumptions.")


# =====================================================================
# Milestone 4: Experiment Persistence & Dashboard Schemas
# =====================================================================

class ExperimentType(str, Enum):
    """Category of traffic burst detection experiment."""
    SIMULATION = "simulation"
    HISTORICAL = "historical"


class ExperimentSummary(BaseModel):
    """Metadata summary of a saved experiment."""
    experiment_id: str
    experiment_type: ExperimentType
    created_at: str
    title: str
    scenario: Optional[str] = None
    measurement_type: MeasurementType
    window_seconds: float
    baseline_lambda: float
    baseline_rate_per_second: float
    alpha: float
    observation_count: int
    detected_window_count: int
    ground_truth_available: bool
    dataset_name: Optional[str] = None
    summary: Optional[str] = None
    evaluation: Optional[EvaluationMetrics] = None


class ExperimentDetailResponse(BaseModel):
    """Full detail of a saved experiment including observations and detections."""
    experiment_id: str
    experiment_type: ExperimentType
    created_at: str
    title: str
    scenario: Optional[str] = None
    measurement_type: MeasurementType
    window_seconds: float
    baseline_lambda: float
    baseline_rate_per_second: float
    alpha: float
    observation_count: int
    detected_window_count: int
    ground_truth_available: bool
    dataset_name: Optional[str] = None
    summary: Optional[str] = None
    model_limitation_note: Optional[str] = None
    evaluation: Optional[EvaluationMetrics] = None
    configuration: Dict[str, Any] = Field(default_factory=dict)
    observations: List[TrafficObservation]
    detections: List[DetectionResponse]


class ExperimentListResponse(BaseModel):
    """Paginated list of saved experiments."""
    items: List[ExperimentSummary]
    total: int
    page: int
    page_size: int
    total_pages: int


class DashboardSummaryResponse(BaseModel):
    """Aggregated summary of completed experiments for the unified dashboard."""
    total_experiments: int
    simulation_experiments_count: int
    historical_experiments_count: int
    available_measurement_types: List[str]
    latest_experiment: Optional[ExperimentSummary] = None
    latest_detected_count: Optional[int] = None
    recent_experiments: List[ExperimentSummary] = Field(default_factory=list)


