"""
PoissonBurst Lab - Hardware Session Request and Response Schemas.

Defines Pydantic models for hardware session configuration, calibration finalization,
real-time status snapshots, live window polling, and termination summaries.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, field_validator


class HardwareStartRequest(BaseModel):
    """Configuration payload to initialize and start a new hardware session."""
    bind_host: str = Field(
        default="127.0.0.1",
        description="Local IPv4 interface to bind (e.g. 127.0.0.1 for local, 0.0.0.0 for all interfaces).",
    )
    bind_port: int = Field(
        default=5005,
        ge=0,
        le=65535,
        description="UDP port to listen on. Port 0 allocates an ephemeral port from the OS.",
    )
    window_seconds: float = Field(
        default=1.0,
        gt=0.0,
        le=300.0,
        description="Tumbling observation window duration in seconds.",
    )
    alpha: float = Field(
        default=0.01,
        gt=0.0,
        lt=1.0,
        description="Poisson significance threshold level alpha.",
    )
    expected_nodes: List[str] = Field(
        default_factory=lambda: ["node_1", "node_2", "node_3", "node_4"],
        description="List of expected logical Arduino node identifiers.",
    )
    min_calibration_windows: int = Field(
        default=10,
        ge=1,
        description="Minimum number of eligible windows required to finalize calibration.",
    )
    stale_node_timeout_seconds: float = Field(
        default=5.0,
        gt=0.0,
        description="Inactivity timeout after which a silent node is classified as stale.",
    )
    require_all_nodes: bool = Field(
        default=True,
        description="Whether all expected nodes must be active for a window to be eligible.",
    )

    @field_validator("expected_nodes")
    @classmethod
    def validate_expected_nodes(cls, v: List[str]) -> List[str]:
        if not v:
            raise ValueError("expected_nodes cannot be empty.")
        supported = {"node_1", "node_2", "node_3", "node_4"}
        for nid in v:
            if nid not in supported:
                raise ValueError(
                    f"Invalid node_id '{nid}'. Supported node IDs: {sorted(list(supported))}."
                )
        return v


class HardwareStartResponse(BaseModel):
    """Response returned upon successful hardware session startup."""
    session_id: str
    state: str
    bind_host: str
    bind_port: int
    window_seconds: float
    alpha: float
    expected_nodes: List[str]
    min_calibration_windows: int
    stale_node_timeout_seconds: float
    require_all_nodes: bool
    started_at_utc: str
    message: str


class HardwareCalibrationFinalizeResponse(BaseModel):
    """Response returned upon explicit baseline calibration finalization."""
    session_id: str
    state: str
    eligible_windows_count: int
    excluded_windows_count: int
    exclusion_reasons: Dict[str, int]
    expected_count_per_window: float
    rate_per_second: float
    window_seconds: float
    alpha: float
    calibrated_at_utc: str


class HardwareStatusResponse(BaseModel):
    """Comprehensive real-time status snapshot of the hardware receiver and processor."""
    has_active_session: bool
    session_id: Optional[str] = None
    state: str = "IDLE"
    receiver_running: bool = False
    bind_host: Optional[str] = None
    bind_port: Optional[int] = None
    total_socket_datagrams: int = 0
    valid_datagrams: int = 0
    malformed_datagrams: int = 0
    unique_datagrams: int = 0
    node_liveness: Dict[str, str] = Field(default_factory=dict)
    node_last_seen_utc: Dict[str, Optional[str]] = Field(default_factory=dict)
    node_counts: Dict[str, int] = Field(default_factory=dict)
    node_gaps: Dict[str, int] = Field(default_factory=dict)
    node_duplicates: Dict[str, int] = Field(default_factory=dict)
    calibration_windows_count: int = 0
    completed_windows_count: int = 0
    burst_windows_count: int = 0
    is_calibrated: bool = False
    baseline_expected_count: Optional[float] = None
    baseline_rate_per_second: Optional[float] = None
    last_error: Optional[str] = None


class HardwareWindowSchema(BaseModel):
    """Schema representing an individual aggregated observation window."""
    window_index: int
    start_time_monotonic: float
    end_time_monotonic: float
    start_time_utc: str
    end_time_utc: str
    duration_seconds: float
    aggregate_count: int
    node_counts: Dict[str, int]
    node_modes: Dict[str, str]
    node_liveness: Dict[str, str]
    is_complete: bool
    is_partial: bool
    quality: str
    is_calibration: bool
    is_calibration_eligible: bool
    ineligibility_reason: Optional[str] = None
    expected_baseline_count: Optional[float] = None
    p_value: Optional[float] = None
    is_burst: Optional[bool] = None
    alpha: Optional[float] = None
    detection_status: str
    detection_unavailable_reason: Optional[str] = None


class HardwareLiveWindowsResponse(BaseModel):
    """Paginated or bounded list of recent observation windows."""
    session_id: Optional[str]
    state: str
    total_windows: int
    returned_windows_count: int
    windows: List[HardwareWindowSchema]


class HardwareStopResponse(BaseModel):
    """Final summary returned upon session termination."""
    session_id: str
    final_state: str = "STOPPED"
    total_valid_datagrams: int
    node_counts: Dict[str, int]
    completed_windows_count: int
    partial_windows_count: int
    burst_detections_count: int
    unavailable_detections_count: int
    is_calibrated: bool
    baseline_expected_count: Optional[float] = None
    clean_shutdown: bool = True
    message: str
    experiment_id: Optional[str] = Field(
        default=None,
        description="Persistent experiment identifier saved in SQLite.",
    )
    persisted: bool = Field(
        default=False,
        description="True if completed session observations were successfully saved to SQLite.",
    )
    persistence_error: Optional[str] = Field(
        default=None,
        description="Error details if saving to SQLite failed.",
    )
