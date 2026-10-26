"""
PoissonBurst Lab - University Network Analytics Schemas.

Pydantic models for University Network datasets (Core Switch and Firewall traffic exports),
including series metadata, dataset summaries, time-series measurements, and statistical summaries.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class SeriesMetadata(BaseModel):
    """Metadata describing a specific measurement series in a dataset."""
    series_id: str = Field(..., description="Stable series identifier (e.g. series_001).")
    column_index: int = Field(..., description="1-based column position in original CSV export.")
    original_header: str = Field(..., description="Exact raw header string from the CSV (e.g. 'Rx' or '').")
    display_name: str = Field(..., description="Human-readable label for UI/display purposes.")
    is_blank_header: bool = Field(..., description="True if the source header label was blank/empty.")
    channel_index: Optional[int] = Field(None, description="Inferred logical channel/interface index based on paired column layout.")
    direction_candidate: str = Field(
        ...,
        description="Hypothesized traffic direction ('inbound_candidate', 'outbound_candidate', or 'unconfirmed'). Subject to unverified unit/direction caveats."
    )


class SeriesStatistics(BaseModel):
    """Statistical summary for an individual measurement series."""
    series_id: str = Field(..., description="Stable series identifier.")
    column_index: int = Field(..., description="1-based column index in CSV.")
    original_header: str = Field(..., description="Original header label.")
    display_name: str = Field(..., description="Display label.")
    total_observations: int = Field(..., description="Total non-boundary observation windows evaluated.")
    valid_count: int = Field(..., description="Number of finite numerical values recorded.")
    missing_count: int = Field(..., description="Number of missing or NaN values in valid observation rows.")
    is_all_zero: bool = Field(..., description="True if all observed values in this series are exactly zero.")
    min_value: Optional[float] = Field(None, description="Minimum signed observed value.")
    max_value: Optional[float] = Field(None, description="Maximum signed observed value.")
    mean_value: Optional[float] = Field(None, description="Arithmetic mean of signed observed values.")
    std_dev: Optional[float] = Field(None, description="Sample standard deviation of observed values.")
    abs_peak_value: Optional[float] = Field(None, description="Peak absolute magnitude recorded.")
    peak_timestamp: Optional[int] = Field(None, description="Unix timestamp of peak measurement.")
    peak_datetime: Optional[str] = Field(None, description="ISO 8601 UTC datetime of peak measurement.")
    unit: str = Field(
        "unknown (unconfirmed telemetry metric)",
        description="Measurement unit statement. Unconfirmed by source export documentation."
    )
    direction_note: str = Field(
        "Direction mapping unconfirmed. Positive values appear under 'Rx' labels; blank headers contain negative values.",
        description="Note on directional interpretation."
    )


class BoundaryRowInfo(BaseModel):
    """Information regarding identified empty boundary rows in telemetry exports."""
    row_index: int = Field(..., description="1-based line number in source CSV.")
    timestamp: int = Field(..., description="Unix epoch timestamp of the boundary observation.")
    datetime: str = Field(..., description="ISO 8601 UTC datetime of the boundary observation.")
    reason: str = Field(..., description="Explanation for boundary classification (e.g. all measurements are NaN).")


class PeakMeasurement(BaseModel):
    """Record of the peak telemetry observation across an entire dataset."""
    signed_value: float = Field(..., description="Original signed peak measurement value.")
    abs_value: float = Field(..., description="Absolute magnitude of the peak measurement.")
    timestamp: int = Field(..., description="Unix timestamp when peak occurred.")
    datetime: str = Field(..., description="ISO 8601 UTC datetime string.")
    series_id: str = Field(..., description="Identifier of the series where peak occurred.")
    series_display_name: str = Field(..., description="Display label of the series where peak occurred.")
    column_index: int = Field(..., description="Column index of the peak series.")


class DataQualityInfo(BaseModel):
    """Data quality and parsing diagnostics for a university dataset."""
    total_csv_data_rows: int = Field(..., description="Total rows in CSV excluding header.")
    empty_boundary_rows_count: int = Field(..., description="Number of boundary rows containing exclusively non-finite/NaN data.")
    boundary_rows: List[BoundaryRowInfo] = Field(default_factory=list, description="Details of identified boundary rows.")
    valid_data_rows_count: int = Field(..., description="Number of rows with active, valid measurements.")
    duplicate_headers_count: int = Field(..., description="Number of columns with repeated headers (e.g. repeated 'Rx').")
    blank_headers_count: int = Field(..., description="Number of columns with empty/blank header strings.")
    total_cells_evaluated: int = Field(..., description="Total measurement cells across all valid data rows.")
    total_valid_measurements: int = Field(..., description="Number of finite numerical measurements.")
    total_missing_measurements: int = Field(..., description="Number of missing or NaN values within valid data rows.")
    missing_percentage: float = Field(..., description="Percentage of missing values in valid data rows.")
    notes: List[str] = Field(default_factory=list, description="Data quality caveats and parser handling notes.")


class DatasetSummaryResponse(BaseModel):
    """Comprehensive summary response for a university network dataset."""
    dataset_id: str = Field(..., description="Canonical dataset identifier (e.g. 'core_switch' or 'firewall').")
    display_name: str = Field(..., description="Human-readable title.")
    description: str = Field(..., description="Description of the network role and observation window.")
    file_source: str = Field(..., description="Relative path of the source dataset file.")
    measurement_series_count: int = Field(..., description="Total number of distinct measurement columns.")
    active_series_count: int = Field(..., description="Number of series containing non-zero traffic.")
    zero_series_count: int = Field(..., description="Number of series with zero traffic throughout observation period.")
    valid_timestamp_count: int = Field(..., description="Number of valid measurement observation timestamps.")
    first_timestamp: int = Field(..., description="First timestamp in dataset (including boundary).")
    first_datetime: str = Field(..., description="ISO 8601 UTC datetime of first observation.")
    last_timestamp: int = Field(..., description="Last timestamp in dataset (including boundary).")
    last_datetime: str = Field(..., description="ISO 8601 UTC datetime of last observation.")
    first_valid_timestamp: int = Field(..., description="First timestamp with finite measurements.")
    first_valid_datetime: str = Field(..., description="ISO 8601 UTC datetime of first valid measurement.")
    last_valid_timestamp: int = Field(..., description="Last timestamp with finite measurements.")
    last_valid_datetime: str = Field(..., description="ISO 8601 UTC datetime of last valid measurement.")
    time_span_seconds: int = Field(..., description="Duration from first to last valid timestamp in seconds.")
    time_span_human: str = Field(..., description="Human-readable duration description.")
    observed_sampling_interval_seconds: int = Field(..., description="Sampling interval detected from timestamps in seconds.")
    sampling_interval_human: str = Field(..., description="Human-readable sampling interval.")
    is_regular_sampling: bool = Field(..., description="True if all consecutive timestamps have identical spacing.")
    total_valid_measurements: int = Field(..., description="Total valid numerical values across all series.")
    total_missing_measurements: int = Field(..., description="Total missing/NaN measurements across all series.")
    peak_measurement: PeakMeasurement = Field(..., description="Highest absolute magnitude recorded across the dataset.")
    data_quality: DataQualityInfo = Field(..., description="Data quality diagnostics and parsing details.")
    unit_statement: str = Field(
        ...,
        description="Explicit declaration that physical measurement units are unconfirmed in raw telemetry."
    )
    direction_statement: str = Field(
        ...,
        description="Explicit declaration of uncertain traffic direction mapping convention."
    )


class DatasetMetadataItem(BaseModel):
    """Overview item for listing available university datasets."""
    dataset_id: str = Field(..., description="Unique dataset identifier.")
    display_name: str = Field(..., description="Display name.")
    description: str = Field(..., description="Dataset description.")
    file_available: bool = Field(..., description="True if the backing CSV file is located and readable.")
    file_path: Optional[str] = Field(None, description="Path where file was located.")
    series_count: Optional[int] = Field(None, description="Number of measurement series if loaded.")
    valid_rows_count: Optional[int] = Field(None, description="Number of valid measurement rows if loaded.")
    first_valid_datetime: Optional[str] = Field(None, description="Earliest valid measurement datetime.")
    last_valid_datetime: Optional[str] = Field(None, description="Latest valid measurement datetime.")
    sampling_interval_seconds: Optional[int] = Field(None, description="Sampling interval in seconds.")
    unit_statement: str = Field(..., description="Measurement unit caveat.")


class DatasetListResponse(BaseModel):
    """Response containing list of all registered university datasets."""
    datasets: List[DatasetMetadataItem] = Field(..., description="Available university datasets.")
    total: int = Field(..., description="Total number of registered university datasets.")
    notes: str = Field(..., description="General notes regarding university network telemetry.")


class TimeSeriesPoint(BaseModel):
    """Observation point at a single timestamp across selected measurement series."""
    timestamp: int = Field(..., description="Unix epoch timestamp.")
    datetime: str = Field(..., description="ISO 8601 UTC formatted datetime string.")
    is_boundary_row: bool = Field(False, description="True if this point is an empty boundary row.")
    values: Dict[str, Optional[float]] = Field(
        ...,
        description="Mapping of series_id to original signed float measurement (or None if missing)."
    )


class TimeSeriesResponse(BaseModel):
    """Response containing time-series telemetry observations for selected series."""
    dataset_id: str = Field(..., description="Dataset identifier.")
    display_name: str = Field(..., description="Dataset display name.")
    total_points: int = Field(..., description="Number of points returned in this response.")
    sampling_interval_seconds: int = Field(..., description="Observed sampling interval in seconds.")
    series_metadata: List[SeriesMetadata] = Field(..., description="Metadata for each series included in the data.")
    data: List[TimeSeriesPoint] = Field(..., description="Time series points in chronological order.")
    unit_statement: str = Field(..., description="Unit uncertainty statement.")
    direction_statement: str = Field(..., description="Direction uncertainty statement.")


class AllSeriesStatisticsResponse(BaseModel):
    """Response containing per-series statistical breakdown across all series in a dataset."""
    dataset_id: str = Field(..., description="Dataset identifier.")
    total_series: int = Field(..., description="Total number of series evaluated.")
    active_series: int = Field(..., description="Number of series with non-zero traffic.")
    zero_series: int = Field(..., description="Number of series with all-zero traffic.")
    series_statistics: List[SeriesStatistics] = Field(..., description="List of statistical records per series.")
    unit_statement: str = Field(..., description="Unit uncertainty statement.")
    direction_statement: str = Field(..., description="Direction uncertainty statement.")


class TrafficSpikeCandidate(BaseModel):
    """Statistical traffic-spike candidate observation identified via robust analysis."""
    dataset_id: str = Field(..., description="Dataset identifier ('core_switch' or 'firewall').")
    series_id: str = Field(..., description="Stable series identifier (e.g. series_001).")
    series_display_name: str = Field(..., description="Human-readable series label.")
    original_header: str = Field(..., description="Original header label from CSV.")
    timestamp: int = Field(..., description="Unix timestamp of observation.")
    datetime: str = Field(..., description="ISO 8601 UTC formatted datetime string.")
    signed_value: float = Field(..., description="Original signed recorded measurement.")
    abs_value: float = Field(..., description="Absolute magnitude analyzed.")
    baseline_value: float = Field(..., description="Robust median baseline of absolute magnitude.")
    deviation: float = Field(..., description="Absolute deviation from baseline (|x| - median).")
    anomaly_score: float = Field(..., description="Robust anomaly score (e.g. modified Z-score or IQR score).")
    detection_method: str = Field(..., description="Method used ('modified_z_score_mad' or 'iqr_fallback').")
    threshold_used: float = Field(..., description="Threshold applied for candidate classification.")


class SeriesBaselineInfo(BaseModel):
    """Robust baseline parameters calculated for an individual telemetry series."""
    series_id: str = Field(..., description="Series identifier.")
    display_name: str = Field(..., description="Display label.")
    median: float = Field(..., description="Sample median of valid magnitudes.")
    mad: float = Field(..., description="Median absolute deviation (MAD).")
    iqr: float = Field(..., description="Interquartile range (IQR).")
    effective_scale: float = Field(..., description="Scale factor applied (1.4826*MAD or IQR/1.349).")
    method: str = Field(..., description="'modified_z_score_mad', 'iqr_fallback', or 'insufficient_variation'.")
    observation_count: int = Field(..., description="Number of finite observation windows analyzed.")
    has_sufficient_variation: bool = Field(..., description="True if scale factor > 0.")


class UniversitySpikesResponse(BaseModel):
    """Response containing detected historical traffic-spike candidates."""
    dataset_id: str = Field(..., description="Dataset identifier.")
    display_name: str = Field(..., description="Dataset display name.")
    threshold_used: float = Field(..., description="Modified Z-score threshold applied.")
    detection_method: str = Field(..., description="Primary statistical method used (Median & MAD with IQR fallback).")
    total_candidates: int = Field(..., description="Number of candidate observations exceeding threshold.")
    affected_series_count: int = Field(..., description="Number of distinct series containing candidates.")
    total_series_analyzed: int = Field(..., description="Number of series evaluated.")
    total_observations_analyzed: int = Field(..., description="Total observation cells evaluated across series.")
    largest_candidate: Optional[TrafficSpikeCandidate] = Field(None, description="Spike candidate with highest anomaly score.")
    candidates: List[TrafficSpikeCandidate] = Field(..., description="Detected traffic-spike candidates in requested sort order.")
    unit_statement: str = Field(..., description="Unit uncertainty statement.")
    direction_statement: str = Field(..., description="Direction uncertainty statement.")
    disclaimer: str = Field(
        "Historical statistical spike candidates based on robust modified Z-scores. "
        "These represent statistical outliers, NOT confirmed security attacks or malicious network incidents.",
        description="Explicit disclaimer."
    )

