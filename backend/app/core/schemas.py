"""
PoissonBurst Lab - Common Traffic Data and API Schemas.

Defines Pydantic models for traffic observations, API requests, and responses,
strictly enforcing the core contracts across historical, simulation, and hardware modes.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, field_validator


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
    baseline_rate: float = Field(
        default=15.0,
        gt=0.0,
        description="Baseline expected arrivals per window (lambda).",
    )
    duration_seconds: int = Field(
        default=60,
        ge=10,
        le=300,
        description="Total duration of the simulation in seconds.",
    )
    window_seconds: float = Field(
        default=1.0,
        gt=0.0,
        le=10.0,
        description="Duration of each observation window in seconds.",
    )
    burst_start_second: Optional[int] = Field(
        default=25,
        ge=0,
        description="Second at which the injected burst begins.",
    )
    burst_duration_seconds: Optional[int] = Field(
        default=10,
        ge=1,
        description="Duration of the injected burst in seconds.",
    )
    burst_rate: Optional[float] = Field(
        default=45.0,
        gt=0.0,
        description="Elevated arrival rate during the burst.",
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
    baseline_rate: float
    total_windows: int
    detected_burst_count: int
    injected_burst_count: int
    observations: List[TrafficObservation]
    detections: List[DetectionResponse]
    evaluation: Optional[EvaluationMetrics] = None
