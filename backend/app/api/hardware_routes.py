"""
PoissonBurst Lab - Hardware Session REST API Endpoints.

Provides endpoints for managing physical/simulated hardware sessions:
- POST /api/hardware/start: Start UDP telemetry receiver and window processor.
- POST /api/hardware/calibration/finalize: Finalize baseline calibration period.
- GET  /api/hardware/status: Inspect real-time receiver and processor status.
- GET  /api/hardware/live: Retrieve recent completed observation windows.
- POST /api/hardware/stop: Terminate active hardware session and release resources.
"""

from __future__ import annotations

import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.hardware_schemas import (
    HardwareCalibrationFinalizeResponse,
    HardwareLiveWindowsResponse,
    HardwareStartRequest,
    HardwareStartResponse,
    HardwareStatusResponse,
    HardwareStopResponse,
)
from app.services.hardware_session_manager import (
    ConflictingOperationError,
    HardwareSessionManager,
    InsufficientCalibrationDataError,
    NoActiveSessionError,
    ReceiverStartupError,
    get_hardware_session_manager,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Hardware Session"])


@router.post(
    "/start",
    response_model=HardwareStartResponse,
    status_code=status.HTTP_200_OK,
    summary="Start Hardware Telemetry Session",
)
def start_hardware_session(
    req: HardwareStartRequest,
    manager: HardwareSessionManager = Depends(get_hardware_session_manager),
) -> HardwareStartResponse:
    """Initialize observation-window processing and bind UDP socket to start receiving telemetry."""
    try:
        return manager.start_session(req)
    except ConflictingOperationError as err:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(err),
        ) from err
    except ReceiverStartupError as err:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(err),
        ) from err
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(err),
        ) from err
    except Exception as err:
        logger.error(f"Unexpected error starting hardware session: {err}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to start hardware session: {err}",
        ) from err


@router.post(
    "/calibration/finalize",
    response_model=HardwareCalibrationFinalizeResponse,
    status_code=status.HTTP_200_OK,
    summary="Finalize Baseline Calibration",
)
def finalize_calibration(
    manager: HardwareSessionManager = Depends(get_hardware_session_manager),
) -> HardwareCalibrationFinalizeResponse:
    """Finalize baseline calibration from collected clean observation windows and transition to monitoring."""
    try:
        return manager.finalize_calibration()
    except NoActiveSessionError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(err),
        ) from err
    except ConflictingOperationError as err:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(err),
        ) from err
    except InsufficientCalibrationDataError as err:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(err),
        ) from err
    except Exception as err:
        logger.error(f"Unexpected error finalizing calibration: {err}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to finalize calibration: {err}",
        ) from err


@router.get(
    "/status",
    response_model=HardwareStatusResponse,
    status_code=status.HTTP_200_OK,
    summary="Inspect Hardware Session Status",
)
def get_hardware_status(
    manager: HardwareSessionManager = Depends(get_hardware_session_manager),
) -> HardwareStatusResponse:
    """Return real-time operational status, receiver packet counters, per-node liveness, and detector state."""
    return manager.get_status()


@router.get(
    "/live",
    response_model=HardwareLiveWindowsResponse,
    status_code=status.HTTP_200_OK,
    summary="Retrieve Live Observation Windows",
)
def get_live_windows(
    limit: int = Query(default=50, ge=1, le=500, description="Maximum number of windows to return."),
    after_window_index: Optional[int] = Query(
        default=None,
        ge=0,
        description="Filter to windows strictly after this index for incremental polling.",
    ),
    manager: HardwareSessionManager = Depends(get_hardware_session_manager),
) -> HardwareLiveWindowsResponse:
    """Retrieve recent completed observation windows and their statistical detection evaluations."""
    return manager.get_live_windows(limit=limit, after_window_index=after_window_index)


@router.post(
    "/stop",
    response_model=HardwareStopResponse,
    status_code=status.HTTP_200_OK,
    summary="Stop Hardware Telemetry Session",
)
def stop_hardware_session(
    manager: HardwareSessionManager = Depends(get_hardware_session_manager),
) -> HardwareStopResponse:
    """Cleanly terminate the active hardware session, stop socket listener, and return session summary."""
    try:
        return manager.stop_session()
    except NoActiveSessionError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(err),
        ) from err
    except Exception as err:
        logger.error(f"Unexpected error stopping hardware session: {err}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to stop hardware session: {err}",
        ) from err


@router.post(
    "/persist/retry",
    response_model=HardwareStopResponse,
    status_code=status.HTTP_200_OK,
    summary="Retry Persisting Stopped Hardware Session",
)
def retry_persist_hardware_session(
    session_id: Optional[str] = Query(default=None, description="Optional session ID to retry persisting."),
    manager: HardwareSessionManager = Depends(get_hardware_session_manager),
) -> HardwareStopResponse:
    """Retry saving a stopped hardware session whose initial persistence failed."""
    try:
        return manager.retry_persistence(session_id=session_id)
    except NoActiveSessionError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(err),
        ) from err
    except Exception as err:
        logger.error(f"Unexpected error retrying hardware session persistence: {err}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retry persistence: {err}",
        ) from err
