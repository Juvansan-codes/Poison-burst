"""
PoissonBurst Lab - University Network Analytics API Routes.

Exposes REST endpoints for:
1. Listing available university network datasets and their metadata.
2. Retrieving comprehensive dataset summaries (sampling intervals, data quality, peak metrics).
3. Retrieving multi-series time-series telemetry observations.
4. Retrieving statistics for individual measurement series and entire datasets.
"""

from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, status

from app.core.university_schemas import (
    AllSeriesStatisticsResponse,
    DatasetListResponse,
    DatasetSummaryResponse,
    SeriesStatistics,
    TimeSeriesResponse,
    UniversitySpikesResponse,
)
from app.services.university_data_loader import (
    DatasetFileNotFoundError,
    DatasetNotFoundError,
    SeriesNotFoundError,
    get_university_data_loader,
)
from app.services.university_spike_analyzer import (
    get_university_spike_analyzer,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["University Network Analytics"])


@router.get(
    "/datasets",
    response_model=DatasetListResponse,
    status_code=status.HTTP_200_OK,
    summary="List available university network datasets",
)
def list_university_datasets() -> DatasetListResponse:
    """Retrieve metadata for all registered university network telemetry datasets.

    Lists Core Switch and Firewall datasets, including availability, time range,
    and unconfirmed unit documentation.
    """
    loader = get_university_data_loader()
    return loader.list_datasets()


@router.get(
    "/datasets/{dataset_id}/summary",
    response_model=DatasetSummaryResponse,
    status_code=status.HTTP_200_OK,
    summary="Retrieve dataset summary and data quality metrics",
)
def get_dataset_summary(dataset_id: str) -> DatasetSummaryResponse:
    """Retrieve dataset summary metrics, sampling intervals, and data quality diagnostics.

    - Validates dataset identifier to prevent arbitrary filesystem access.
    - Caches parsed data in memory to eliminate repeated disk reads.
    - Returns boundary row details, peak telemetry values, and sampling frequency.
    """
    loader = get_university_data_loader()
    try:
        return loader.get_dataset_summary(dataset_id)
    except DatasetNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(err),
        )
    except DatasetFileNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(err),
        )
    except Exception as err:
        logger.exception("Failed to retrieve summary for dataset '%s': %s", dataset_id, err)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error generating summary for dataset '{dataset_id}': {str(err)}",
        )


@router.get(
    "/datasets/{dataset_id}/series",
    response_model=TimeSeriesResponse,
    status_code=status.HTTP_200_OK,
    summary="Retrieve time-series measurements",
)
def get_dataset_time_series(
    dataset_id: str,
    series_ids: Optional[str] = Query(
        None,
        description="Comma-separated list of series IDs to filter (e.g. 'series_001,series_026'). If omitted, all series are returned.",
    ),
    include_boundary_rows: bool = Query(
        False,
        description="Whether to include empty boundary rows (where all measurements are NaN). Defaults to False.",
    ),
    start_time: Optional[int] = Query(
        None,
        description="Unix timestamp lower bound (inclusive).",
    ),
    end_time: Optional[int] = Query(
        None,
        description="Unix timestamp upper bound (inclusive).",
    ),
    limit: int = Query(
        1000,
        ge=1,
        le=10000,
        description="Maximum number of points to return.",
    ),
    offset: int = Query(
        0,
        ge=0,
        description="Number of points to skip for pagination.",
    ),
) -> TimeSeriesResponse:
    """Retrieve time-series telemetry observations.

    - Preserves original signed values without forced abs().
    - Converts timestamps to ISO 8601 UTC datetimes.
    - Preserves missing/null values without substituting zero.
    - Supports series filtering, time-range slicing, and pagination.
    """
    loader = get_university_data_loader()
    series_id_list = [s.strip() for s in series_ids.split(",") if s.strip()] if series_ids else None

    try:
        return loader.get_time_series(
            dataset_id=dataset_id,
            series_ids=series_id_list,
            include_boundary_rows=include_boundary_rows,
            start_time=start_time,
            end_time=end_time,
            limit=limit,
            offset=offset,
        )
    except DatasetNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(err),
        )
    except DatasetFileNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(err),
        )
    except SeriesNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(err),
        )
    except Exception as err:
        logger.exception("Failed to retrieve time series for dataset '%s': %s", dataset_id, err)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error retrieving time series for dataset '{dataset_id}': {str(err)}",
        )


@router.get(
    "/datasets/{dataset_id}/series/{series_id}/statistics",
    response_model=SeriesStatistics,
    status_code=status.HTTP_200_OK,
    summary="Retrieve statistics for a specific measurement series",
)
def get_series_statistics(
    dataset_id: str,
    series_id: str,
) -> SeriesStatistics:
    """Retrieve statistical summary for an individual measurement series.

    Returns valid counts, missing counts, min, max, mean, standard deviation,
    peak absolute value, and peak timestamp.
    """
    loader = get_university_data_loader()
    try:
        return loader.get_series_statistics(dataset_id=dataset_id, series_id=series_id)
    except DatasetNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(err),
        )
    except DatasetFileNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(err),
        )
    except SeriesNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(err),
        )
    except Exception as err:
        logger.exception("Failed to retrieve series statistics: %s", err)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error retrieving statistics: {str(err)}",
        )


@router.get(
    "/datasets/{dataset_id}/statistics",
    response_model=AllSeriesStatisticsResponse,
    status_code=status.HTTP_200_OK,
    summary="Retrieve statistics across all series in a dataset",
)
def get_all_series_statistics(
    dataset_id: str,
    only_active: bool = Query(
        False,
        description="If True, only returns series that have recorded non-zero traffic.",
    ),
) -> AllSeriesStatisticsResponse:
    """Retrieve statistics across all series in the dataset.

    Optionally filters out inactive (all-zero) telemetry channels.
    """
    loader = get_university_data_loader()
    try:
        return loader.get_all_series_statistics(dataset_id=dataset_id, only_active=only_active)
    except DatasetNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(err),
        )
    except DatasetFileNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(err),
        )
    except Exception as err:
        logger.exception("Failed to retrieve all series statistics: %s", err)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error retrieving series statistics: {str(err)}",
        )


@router.get(
    "/datasets/{dataset_id}/spikes",
    response_model=UniversitySpikesResponse,
    status_code=status.HTTP_200_OK,
    summary="Detect robust historical traffic-spike candidates",
)
def get_dataset_spikes(
    dataset_id: str,
    series_ids: Optional[str] = Query(
        None,
        description="Comma-separated series IDs to analyze. If omitted, all series are evaluated.",
    ),
    threshold: float = Query(
        3.5,
        ge=1.0,
        le=100.0,
        description="Modified Z-score threshold for candidate classification (default: 3.5).",
    ),
    max_candidates: int = Query(
        100,
        ge=1,
        le=5000,
        description="Maximum number of candidates to return.",
    ),
    start_time: Optional[int] = Query(
        None,
        description="Optional Unix timestamp lower bound (inclusive).",
    ),
    end_time: Optional[int] = Query(
        None,
        description="Optional Unix timestamp upper bound (inclusive).",
    ),
    sort_by: str = Query(
        "score",
        pattern="^(score|timestamp|magnitude)$",
        description="Sort attribute ('score', 'timestamp', or 'magnitude').",
    ),
    sort_direction: str = Query(
        "desc",
        pattern="^(asc|desc)$",
        description="Sort direction ('asc' or 'desc').",
    ),
) -> UniversitySpikesResponse:
    """Analyze historical university network telemetry for traffic-spike candidates.

    - Uses robust median and MAD baseline with IQR fallback strategy.
    - Evaluates each measurement series independently to avoid cross-channel distortion.
    - Operates on absolute magnitudes while preserving original signed values.
    - Identifies statistical outliers; explicitly disclaims malicious/attack labels.
    """
    analyzer = get_university_spike_analyzer()
    series_id_list = [s.strip() for s in series_ids.split(",") if s.strip()] if series_ids else None

    try:
        return analyzer.analyze_spikes(
            dataset_id=dataset_id,
            series_ids=series_id_list,
            threshold=threshold,
            max_candidates=max_candidates,
            start_time=start_time,
            end_time=end_time,
            sort_by=sort_by,
            sort_direction=sort_direction,
        )
    except DatasetNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(err),
        )
    except DatasetFileNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(err),
        )
    except SeriesNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(err),
        )
    except Exception as err:
        logger.exception("Failed to analyze traffic spikes for dataset '%s': %s", dataset_id, err)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error analyzing traffic spikes: {str(err)}",
        )

