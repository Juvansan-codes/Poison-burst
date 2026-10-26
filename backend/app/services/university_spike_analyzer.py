"""
PoissonBurst Lab - University Network Traffic-Spike Analysis Service.

Provides robust, independent statistical anomaly scoring across historical telemetry series.
Uses median and Median Absolute Deviation (MAD) with IQR-based fallback to detect
unusual traffic spikes while preserving raw signed observations and data integrity.
"""

from __future__ import annotations

import logging
import math
from typing import Any, Dict, List, Optional, Set, Tuple

import numpy as np

from app.core.university_schemas import (
    SeriesBaselineInfo,
    TrafficSpikeCandidate,
    UniversitySpikesResponse,
)
from app.services.university_data_loader import (
    DEFAULT_DIRECTION_STATEMENT,
    DEFAULT_UNIT_STATEMENT,
    DatasetNotFoundError,
    ParsedDataset,
    SeriesNotFoundError,
    UniversityDataLoader,
    get_university_data_loader,
)

logger = logging.getLogger(__name__)

# Standard normal consistency constant for MAD: 1 / norm.ppf(0.75) ≈ 1.4826
MAD_SCALE_FACTOR = 1.4826

# Standard normal consistency constant for IQR: 1 / (2 * norm.ppf(0.75)) ≈ 1 / 1.34898 ≈ 0.7413, or IQR / 1.349
IQR_SCALE_FACTOR = 1.34898


class UniversitySpikeAnalyzer:
    """Statistical traffic-spike detection engine for university telemetry datasets."""

    def __init__(self, data_loader: Optional[UniversityDataLoader] = None):
        self.data_loader = data_loader or get_university_data_loader()

    def analyze_spikes(
        self,
        dataset_id: str,
        series_ids: Optional[List[str]] = None,
        threshold: float = 3.5,
        max_candidates: int = 100,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
        sort_by: str = "score",
        sort_direction: str = "desc",
    ) -> UniversitySpikesResponse:
        """Run robust MAD/IQR traffic-spike detection on a university dataset.

        Args:
            dataset_id: Identifier of the dataset ('core_switch' or 'firewall').
            series_ids: Optional filter to analyze only specific series.
            threshold: Minimum modified Z-score to qualify as a candidate (default: 3.5).
            max_candidates: Maximum number of candidates to return in response.
            start_time: Optional start timestamp filter (inclusive).
            end_time: Optional end timestamp filter (inclusive).
            sort_by: Attribute to sort by ('score', 'timestamp', or 'magnitude').
            sort_direction: Sort order ('asc' or 'desc').

        Returns:
            UniversitySpikesResponse containing detected candidates and analysis metadata.
        """
        parsed = self.data_loader.load_dataset(dataset_id)

        # Validate and resolve target series
        if series_ids:
            target_series_meta = []
            for s_id in series_ids:
                s_id_clean = s_id.strip()
                if s_id_clean not in parsed.series_id_map:
                    raise SeriesNotFoundError(
                        f"Series '{s_id_clean}' not found in dataset '{dataset_id}'."
                    )
                target_series_meta.append(parsed.series_id_map[s_id_clean])
        else:
            target_series_meta = parsed.series_metadata

        valid_row_indices = [i for i, b in enumerate(parsed.is_boundary_row) if not b]
        total_observations_analyzed = len(valid_row_indices) * len(target_series_meta)

        all_candidates: List[TrafficSpikeCandidate] = []
        affected_series_set: Set[str] = set()

        for meta in target_series_meta:
            col_idx = meta.column_index - 1  # 0-based column index in measurement_matrix

            # Extract finite measurements across valid non-boundary rows
            row_tuples: List[Tuple[int, int, str, float, float]] = []
            # (row_idx, timestamp, datetime, signed_val, abs_val)

            for r_idx in valid_row_indices:
                val = parsed.measurement_matrix[r_idx][col_idx]
                if val is not None and not (math.isnan(val) or math.isinf(val)):
                    ts = parsed.timestamps[r_idx]
                    dt = parsed.datetimes[r_idx]
                    row_tuples.append((r_idx, ts, dt, val, abs(val)))

            if not row_tuples:
                continue

            magnitudes = np.array([t[4] for t in row_tuples], dtype=np.float64)

            # Check if all magnitudes are exactly zero
            if np.all(magnitudes == 0.0):
                continue

            # Step 1: Calculate median baseline
            median_val = float(np.median(magnitudes))

            # Step 2: Calculate Median Absolute Deviation (MAD)
            abs_deviations = np.abs(magnitudes - median_val)
            mad_val = float(np.median(abs_deviations))

            method = "modified_z_score_mad"
            scale_val = MAD_SCALE_FACTOR * mad_val

            # Step 3: Fallback strategy if MAD is zero
            if scale_val == 0.0:
                q75, q25 = np.percentile(magnitudes, [75, 25])
                iqr_val = float(q75 - q25)
                scale_val = iqr_val / IQR_SCALE_FACTOR
                method = "iqr_fallback"

            # If scale is still zero, series has insufficient variation for outlier detection
            if scale_val == 0.0:
                continue

            # Step 4: Evaluate deviations exceeding the baseline
            for idx, (r_idx, ts, dt, signed_val, abs_val) in enumerate(row_tuples):
                # A traffic spike is an unusually elevated measurement above the series median
                dev = abs_val - median_val
                if dev <= 0.0:
                    continue

                anomaly_score = float(dev / scale_val)

                if anomaly_score >= threshold:
                    # Apply timestamp filters if provided
                    if start_time is not None and ts < start_time:
                        continue
                    if end_time is not None and ts > end_time:
                        continue

                    candidate = TrafficSpikeCandidate(
                        dataset_id=dataset_id,
                        series_id=meta.series_id,
                        series_display_name=meta.display_name,
                        original_header=meta.original_header,
                        timestamp=ts,
                        datetime=dt,
                        signed_value=signed_val,
                        abs_value=abs_val,
                        baseline_value=round(median_val, 4),
                        deviation=round(dev, 4),
                        anomaly_score=round(anomaly_score, 4),
                        detection_method=method,
                        threshold_used=threshold,
                    )
                    all_candidates.append(candidate)
                    affected_series_set.add(meta.series_id)

        # Identify overall largest candidate by anomaly score
        largest_candidate = None
        if all_candidates:
            largest_candidate = max(all_candidates, key=lambda c: c.anomaly_score)

        # Sort candidates
        reverse = (sort_direction.lower() == "desc")
        if sort_by.lower() == "timestamp":
            all_candidates.sort(key=lambda c: c.timestamp, reverse=reverse)
        elif sort_by.lower() == "magnitude":
            all_candidates.sort(key=lambda c: c.abs_value, reverse=reverse)
        else:  # default "score"
            all_candidates.sort(key=lambda c: c.anomaly_score, reverse=reverse)

        total_candidates_found = len(all_candidates)
        paginated_candidates = all_candidates[:max_candidates]

        return UniversitySpikesResponse(
            dataset_id=dataset_id,
            display_name=parsed.display_name,
            threshold_used=threshold,
            detection_method="Median & MAD (with IQR Fallback)",
            total_candidates=total_candidates_found,
            affected_series_count=len(affected_series_set),
            total_series_analyzed=len(target_series_meta),
            total_observations_analyzed=total_observations_analyzed,
            largest_candidate=largest_candidate,
            candidates=paginated_candidates,
            unit_statement=DEFAULT_UNIT_STATEMENT,
            direction_statement=DEFAULT_DIRECTION_STATEMENT,
            disclaimer=(
                "Historical statistical spike candidates based on robust modified Z-scores. "
                "These represent statistical outliers, NOT confirmed security attacks or malicious network incidents."
            ),
        )


# Singleton instance
_SPIKE_ANALYZER_INSTANCE: Optional[UniversitySpikeAnalyzer] = None


def get_university_spike_analyzer() -> UniversitySpikeAnalyzer:
    """Obtain or initialize the UniversitySpikeAnalyzer singleton."""
    global _SPIKE_ANALYZER_INSTANCE
    if _SPIKE_ANALYZER_INSTANCE is None:
        _SPIKE_ANALYZER_INSTANCE = UniversitySpikeAnalyzer()
    return _SPIKE_ANALYZER_INSTANCE
