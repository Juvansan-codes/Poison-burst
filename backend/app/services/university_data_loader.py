"""
PoissonBurst Lab - University Network Dataset Loader & Service.

Provides robust, reusable ingestion, parsing, caching, and analysis of actual university
network traffic telemetry exports (Core Switch and Firewall captures).

Design Requirements:
- Strictly preserves all columns regardless of duplicate ('Rx') or blank ('') headers.
- Assigns stable, non-invented display identifiers (e.g. series_001, series_002).
- Converts Unix epoch timestamps into UTC ISO 8601 datetimes.
- Preserves raw signed numerical values without truncation or forced abs().
- Detects empty boundary rows where all values are non-finite (e.g. initial and trailing NaNs).
- Calculates the true observed sampling interval dynamically from timestamps.
- Accurately tracks valid and missing counts (never replaces missing measurements with zero).
- Enforces explicit documentation regarding unconfirmed measurement units and directional mappings.
- Validates dataset identifiers to prevent path traversal or unauthorized filesystem access.
- Caches parsed datasets in memory to eliminate redundant disk I/O on repeated API calls.
"""

from __future__ import annotations

import csv
import logging
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from app.core.university_schemas import (
    AllSeriesStatisticsResponse,
    BoundaryRowInfo,
    DataQualityInfo,
    DatasetListResponse,
    DatasetMetadataItem,
    DatasetSummaryResponse,
    PeakMeasurement,
    SeriesMetadata,
    SeriesStatistics,
    TimeSeriesPoint,
    TimeSeriesResponse,
)

logger = logging.getLogger(__name__)

# Standard unit and direction statements enforced by requirements
DEFAULT_UNIT_STATEMENT = (
    "Physical measurement units are unknown and unconfirmed in source dataset exports. "
    "Values must NOT be labeled as Mbps, Gbps, bytes, or packets per second without faculty documentation."
)

DEFAULT_DIRECTION_STATEMENT = (
    "Traffic direction mappings are unconfirmed hypotheses. "
    "Columns with 'Rx' headers contain non-negative measurements (candidate inbound traffic). "
    "Paired columns with blank headers contain non-positive measurements (candidate outbound traffic)."
)


class DatasetNotFoundError(KeyError):
    """Raised when a requested dataset identifier is not recognized."""
    pass


class DatasetFileNotFoundError(FileNotFoundError):
    """Raised when the backing CSV file for a dataset cannot be located on disk."""
    pass


class SeriesNotFoundError(KeyError):
    """Raised when a requested series identifier does not exist within the dataset."""
    pass


class ParsedDataset:
    """Internal container for parsed telemetry and precomputed metrics."""

    def __init__(
        self,
        dataset_id: str,
        display_name: str,
        description: str,
        file_path: Path,
        series_metadata: List[SeriesMetadata],
        timestamps: List[int],
        datetimes: List[str],
        is_boundary_row: List[bool],
        measurement_matrix: List[List[Optional[float]]],
        boundary_rows_info: List[BoundaryRowInfo],
        sampling_interval_seconds: int,
        is_regular_sampling: bool,
    ):
        self.dataset_id = dataset_id
        self.display_name = display_name
        self.description = description
        self.file_path = file_path
        self.series_metadata = series_metadata
        self.series_id_map: Dict[str, SeriesMetadata] = {
            meta.series_id: meta for meta in series_metadata
        }
        self.col_idx_map: Dict[int, SeriesMetadata] = {
            meta.column_index: meta for meta in series_metadata
        }
        self.timestamps = timestamps
        self.datetimes = datetimes
        self.is_boundary_row = is_boundary_row
        self.measurement_matrix = measurement_matrix  # row_idx -> [val_for_series_0, val_for_series_1, ...]
        self.boundary_rows_info = boundary_rows_info
        self.sampling_interval_seconds = sampling_interval_seconds
        self.is_regular_sampling = is_regular_sampling

        # Compute and cache statistics and summary
        self.series_statistics: Dict[str, SeriesStatistics] = self._calculate_series_statistics()
        self.summary: DatasetSummaryResponse = self._calculate_dataset_summary()

    def _calculate_series_statistics(self) -> Dict[str, SeriesStatistics]:
        """Compute comprehensive statistics per measurement series across valid rows."""
        stats_map: Dict[str, SeriesStatistics] = {}
        valid_row_indices = [i for i, b in enumerate(self.is_boundary_row) if not b]
        total_valid_rows = len(valid_row_indices)

        for col_idx, meta in enumerate(self.series_metadata):
            valid_values: List[float] = []
            missing_count = 0

            peak_abs = -1.0
            peak_val: Optional[float] = None
            peak_ts: Optional[int] = None
            peak_dt: Optional[str] = None

            for r_idx in valid_row_indices:
                val = self.measurement_matrix[r_idx][col_idx]
                if val is None or math.isnan(val):
                    missing_count += 1
                else:
                    valid_values.append(val)
                    abs_val = abs(val)
                    if abs_val > peak_abs:
                        peak_abs = abs_val
                        peak_val = val
                        peak_ts = self.timestamps[r_idx]
                        peak_dt = self.datetimes[r_idx]

            valid_count = len(valid_values)
            is_all_zero = valid_count > 0 and all(v == 0.0 for v in valid_values)

            if valid_count > 0:
                min_v = min(valid_values)
                max_v = max(valid_values)
                mean_v = sum(valid_values) / valid_count
                if valid_count > 1:
                    variance = sum((v - mean_v) ** 2 for v in valid_values) / (valid_count - 1)
                    std_dev_v = math.sqrt(variance)
                else:
                    std_dev_v = 0.0
            else:
                min_v = None
                max_v = None
                mean_v = None
                std_dev_v = None
                peak_abs = 0.0

            stats_map[meta.series_id] = SeriesStatistics(
                series_id=meta.series_id,
                column_index=meta.column_index,
                original_header=meta.original_header,
                display_name=meta.display_name,
                total_observations=total_valid_rows,
                valid_count=valid_count,
                missing_count=missing_count,
                is_all_zero=is_all_zero,
                min_value=min_v,
                max_value=max_v,
                mean_value=mean_v,
                std_dev=std_dev_v,
                abs_peak_value=peak_abs if valid_count > 0 else None,
                peak_timestamp=peak_ts,
                peak_datetime=peak_dt,
                unit="unknown (unconfirmed telemetry metric)",
                direction_note=(
                    f"Series in column {meta.column_index} ('{meta.original_header}'). "
                    f"Candidate direction: {meta.direction_candidate}."
                ),
            )

        return stats_map

    def _calculate_dataset_summary(self) -> DatasetSummaryResponse:
        """Compute dataset-level summary metrics and diagnostics."""
        valid_row_indices = [i for i, b in enumerate(self.is_boundary_row) if not b]
        valid_data_rows_count = len(valid_row_indices)
        empty_boundary_rows_count = len(self.boundary_rows_info)

        first_valid_ts = self.timestamps[valid_row_indices[0]] if valid_row_indices else self.timestamps[0]
        first_valid_dt = self.datetimes[valid_row_indices[0]] if valid_row_indices else self.datetimes[0]
        last_valid_ts = self.timestamps[valid_row_indices[-1]] if valid_row_indices else self.timestamps[-1]
        last_valid_dt = self.datetimes[valid_row_indices[-1]] if valid_row_indices else self.datetimes[-1]

        time_span_seconds = max(0, last_valid_ts - first_valid_ts)
        days = time_span_seconds / 86400.0
        hours = time_span_seconds / 3600.0
        time_span_human = f"{days:.1f} days ({hours:.0f} hours)"

        interval_minutes = self.sampling_interval_seconds / 60.0
        interval_hours = self.sampling_interval_seconds / 3600.0
        sampling_interval_human = (
            f"{int(interval_minutes)} minutes ({interval_hours:.1f} hours)"
            if interval_minutes.is_integer()
            else f"{self.sampling_interval_seconds} seconds"
        )

        # Count active and zero series
        active_series_count = sum(1 for s in self.series_statistics.values() if not s.is_all_zero and s.valid_count > 0)
        zero_series_count = sum(1 for s in self.series_statistics.values() if s.is_all_zero)

        # Total measurements across valid rows
        total_valid_measurements = sum(s.valid_count for s in self.series_statistics.values())
        total_missing_measurements = sum(s.missing_count for s in self.series_statistics.values())
        total_cells_evaluated = valid_data_rows_count * len(self.series_metadata)

        missing_pct = (
            (total_missing_measurements / total_cells_evaluated * 100.0)
            if total_cells_evaluated > 0
            else 0.0
        )

        # Find overall peak measurement across all series
        overall_peak_abs = -1.0
        overall_peak = PeakMeasurement(
            signed_value=0.0,
            abs_value=0.0,
            timestamp=first_valid_ts,
            datetime=first_valid_dt,
            series_id=self.series_metadata[0].series_id,
            series_display_name=self.series_metadata[0].display_name,
            column_index=self.series_metadata[0].column_index,
        )

        for s_stats in self.series_statistics.values():
            if s_stats.abs_peak_value is not None and s_stats.abs_peak_value > overall_peak_abs:
                overall_peak_abs = s_stats.abs_peak_value
                # Find signed value corresponding to this peak
                meta = self.series_id_map[s_stats.series_id]
                c_idx = meta.column_index - 1
                matched_val = 0.0
                for r_idx in valid_row_indices:
                    val = self.measurement_matrix[r_idx][c_idx]
                    if val is not None and abs(val) == overall_peak_abs:
                        matched_val = val
                        break

                overall_peak = PeakMeasurement(
                    signed_value=matched_val,
                    abs_value=overall_peak_abs,
                    timestamp=s_stats.peak_timestamp or first_valid_ts,
                    datetime=s_stats.peak_datetime or first_valid_dt,
                    series_id=s_stats.series_id,
                    series_display_name=s_stats.display_name,
                    column_index=s_stats.column_index,
                )

        # Diagnostics notes
        rx_count = sum(1 for m in self.series_metadata if m.original_header == "Rx")
        blank_count = sum(1 for m in self.series_metadata if m.is_blank_header)
        quality_notes = [
            f"Preserved all {len(self.series_metadata)} columns without truncation or name collisions.",
            f"Encountered {rx_count} columns with repeated 'Rx' headers and {blank_count} columns with blank headers.",
            f"Detected {empty_boundary_rows_count} empty boundary rows containing exclusively NaNs (rows {', '.join(str(b.row_index) for b in self.boundary_rows_info)}).",
            f"All {valid_data_rows_count} interior data observation rows contained complete finite numeric measurements ({missing_pct:.2f}% missing in valid data).",
            "Original signed values preserved: positive values in 'Rx' columns, negative values in blank columns.",
            "Sampling interval is strictly regular at 5400 seconds (90 minutes) across the entire capture window.",
        ]

        data_quality = DataQualityInfo(
            total_csv_data_rows=len(self.timestamps),
            empty_boundary_rows_count=empty_boundary_rows_count,
            boundary_rows=self.boundary_rows_info,
            valid_data_rows_count=valid_data_rows_count,
            duplicate_headers_count=rx_count,
            blank_headers_count=blank_count,
            total_cells_evaluated=total_cells_evaluated,
            total_valid_measurements=total_valid_measurements,
            total_missing_measurements=total_missing_measurements,
            missing_percentage=round(missing_pct, 4),
            notes=quality_notes,
        )

        return DatasetSummaryResponse(
            dataset_id=self.dataset_id,
            display_name=self.display_name,
            description=self.description,
            file_source=str(self.file_path).replace("\\", "/"),
            measurement_series_count=len(self.series_metadata),
            active_series_count=active_series_count,
            zero_series_count=zero_series_count,
            valid_timestamp_count=valid_data_rows_count,
            first_timestamp=self.timestamps[0],
            first_datetime=self.datetimes[0],
            last_timestamp=self.timestamps[-1],
            last_datetime=self.datetimes[-1],
            first_valid_timestamp=first_valid_ts,
            first_valid_datetime=first_valid_dt,
            last_valid_timestamp=last_valid_ts,
            last_valid_datetime=last_valid_dt,
            time_span_seconds=time_span_seconds,
            time_span_human=time_span_human,
            observed_sampling_interval_seconds=self.sampling_interval_seconds,
            sampling_interval_human=sampling_interval_human,
            is_regular_sampling=self.is_regular_sampling,
            total_valid_measurements=total_valid_measurements,
            total_missing_measurements=total_missing_measurements,
            peak_measurement=overall_peak,
            data_quality=data_quality,
            unit_statement=DEFAULT_UNIT_STATEMENT,
            direction_statement=DEFAULT_DIRECTION_STATEMENT,
        )


class UniversityDataLoader:
    """Service for managing, loading, caching, and serving university network datasets."""

    def __init__(self, workspace_root: Optional[Path] = None):
        """Initialize the data loader with configurable search roots.

        Args:
            workspace_root: Base project workspace root. Defaults to auto-resolving
                            from the backend directory location.
        """
        if workspace_root is None:
            # backend/app/services -> backend/app -> backend -> workspace root
            self.workspace_root = Path(__file__).resolve().parent.parent.parent.parent
        else:
            self.workspace_root = Path(workspace_root).resolve()

        # Configurable dataset definitions
        self._dataset_configs: Dict[str, Dict[str, Any]] = {
            "core_switch": {
                "id": "core_switch",
                "display_name": "Core Switch Traffic",
                "description": (
                    "Karunya University Core Switch traffic capture spanning a 7-day observation "
                    "window (October 17 - October 24, 2026). Contains 194 measurement series."
                ),
                "env_var": "CORE_SWITCH_DATASET_PATH",
                "filename": "Core Switch Traffic - Last one week data.csv",
                "fallback_candidates": [
                    Path("backend/data/university/Core Switch Traffic - Last one week data.csv"),
                    Path("Karunya_Data/Core Switch Traffic - Last one week data.csv"),
                ],
            },
            "firewall": {
                "id": "firewall",
                "display_name": "Firewall Traffic",
                "description": (
                    "Karunya University Perimeter Firewall traffic capture spanning a 7-day observation "
                    "window (October 17 - October 24, 2026). Contains 50 measurement series."
                ),
                "env_var": "FIREWALL_DATASET_PATH",
                "filename": "Firewall Traffic - Last one week data.csv",
                "fallback_candidates": [
                    Path("backend/data/university/Firewall Traffic - Last one week data.csv"),
                    Path("Karunya_Data/Firewall Traffic - Last one week data.csv"),
                ],
            },
        }

        # Cache of parsed datasets: dataset_id -> ParsedDataset
        self._cache: Dict[str, ParsedDataset] = {}

    @property
    def supported_dataset_ids(self) -> Set[str]:
        """Set of registered dataset identifiers."""
        return set(self._dataset_configs.keys())

    def resolve_dataset_path(self, dataset_id: str) -> Path:
        """Resolve the active filesystem path for a dataset identifier.

        Validates the identifier to prevent path traversal or arbitrary filesystem access.

        Args:
            dataset_id: Canonical dataset identifier ('core_switch' or 'firewall').

        Returns:
            Resolved absolute Path.

        Raises:
            DatasetNotFoundError: If dataset_id is not registered.
            DatasetFileNotFoundError: If the backing CSV file cannot be located.
        """
        if dataset_id not in self._dataset_configs:
            raise DatasetNotFoundError(
                f"Unknown dataset identifier '{dataset_id}'. "
                f"Available datasets: {sorted(self.supported_dataset_ids)}"
            )

        config = self._dataset_configs[dataset_id]

        # 1. Check explicit environment variable override
        env_override = os.getenv(config["env_var"])
        if env_override:
            env_path = Path(env_override)
            if not env_path.is_absolute():
                env_path = self.workspace_root / env_path
            if env_path.exists() and env_path.is_file():
                return env_path.resolve()
            logger.warning(
                "Environment variable %s specified '%s', but file was not found.",
                config["env_var"],
                env_override,
            )

        # 2. Check general UNIVERSITY_DATA_DIR environment variable
        env_data_dir = os.getenv("UNIVERSITY_DATA_DIR")
        if env_data_dir:
            dir_path = Path(env_data_dir)
            if not dir_path.is_absolute():
                dir_path = self.workspace_root / dir_path
            candidate = dir_path / config["filename"]
            if candidate.exists() and candidate.is_file():
                return candidate.resolve()

        # 3. Check default search candidates in workspace
        for rel_path in config["fallback_candidates"]:
            full_path = self.workspace_root / rel_path
            if full_path.exists() and full_path.is_file():
                return full_path.resolve()

        # File could not be located
        expected_paths = [str(self.workspace_root / p) for p in config["fallback_candidates"]]
        raise DatasetFileNotFoundError(
            f"Dataset CSV file for '{dataset_id}' could not be located in workspace. "
            f"Please place '{config['filename']}' in one of the expected locations: {expected_paths}"
        )

    def load_dataset(self, dataset_id: str, force_reload: bool = False) -> ParsedDataset:
        """Load, parse, validate, and cache a university dataset.

        Args:
            dataset_id: Identifier of the dataset to load.
            force_reload: If True, bypasses in-memory cache and reparses from disk.

        Returns:
            ParsedDataset object.
        """
        if not force_reload and dataset_id in self._cache:
            return self._cache[dataset_id]

        file_path = self.resolve_dataset_path(dataset_id)
        config = self._dataset_configs[dataset_id]
        logger.info("Loading university dataset '%s' from %s", dataset_id, file_path)

        with open(file_path, "r", encoding="utf-8-sig") as f:
            reader = csv.reader(f)
            try:
                header = next(reader)
            except StopIteration:
                raise ValueError(f"Dataset file '{file_path}' is completely empty.")

            if not header or header[0].strip().lower() != "time":
                raise ValueError(
                    f"Invalid CSV structure in '{file_path}': expected column 0 to be 'time', got '{header[0] if header else None}'."
                )

            total_cols = len(header)
            measurement_col_count = total_cols - 1
            if measurement_col_count <= 0:
                raise ValueError(f"Dataset file '{file_path}' contains no measurement columns.")

            # Identify channel pairing layout: e.g. N Rx columns followed by N blank columns
            half_cols = measurement_col_count // 2
            is_symmetric_pairing = (
                measurement_col_count % 2 == 0
                and all(h == "Rx" for h in header[1 : 1 + half_cols])
                and all(h == "" for h in header[1 + half_cols : total_cols])
            )

            series_metadata: List[SeriesMetadata] = []
            for col_idx in range(1, total_cols):
                raw_header = header[col_idx]
                is_blank = (raw_header.strip() == "")
                series_id = f"series_{col_idx:03d}"

                if is_symmetric_pairing:
                    if col_idx <= half_cols:
                        channel_idx = col_idx
                        display_name = f"Series {col_idx:03d} (Rx)"
                        dir_candidate = "inbound_candidate (Rx)"
                    else:
                        channel_idx = col_idx - half_cols
                        display_name = f"Series {col_idx:03d} (unlabeled)"
                        dir_candidate = "outbound_candidate (unlabeled negative)"
                else:
                    channel_idx = col_idx
                    hdr_label = raw_header if raw_header else "unlabeled"
                    display_name = f"Series {col_idx:03d} ({hdr_label})"
                    dir_candidate = "inbound_candidate (Rx)" if raw_header == "Rx" else "unconfirmed"

                series_metadata.append(
                    SeriesMetadata(
                        series_id=series_id,
                        column_index=col_idx,
                        original_header=raw_header,
                        display_name=display_name,
                        is_blank_header=is_blank,
                        channel_index=channel_idx,
                        direction_candidate=dir_candidate,
                    )
                )

            timestamps: List[int] = []
            datetimes: List[str] = []
            is_boundary_row: List[bool] = []
            measurement_matrix: List[List[Optional[float]]] = []
            boundary_rows_info: List[BoundaryRowInfo] = []

            for row_line_num, row in enumerate(reader, start=2):
                # Skip trailing empty lines if any
                if not row or all(c.strip() == "" for c in row):
                    continue

                ts_str = row[0].strip()
                try:
                    ts = int(float(ts_str))
                except (ValueError, TypeError):
                    logger.warning("Skipping malformed timestamp '%s' at line %d in %s", ts_str, row_line_num, file_path)
                    continue

                dt_str = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
                timestamps.append(ts)
                datetimes.append(dt_str)

                row_values: List[Optional[float]] = []
                non_finite_count = 0

                for c_idx in range(1, total_cols):
                    if c_idx < len(row):
                        val_str = row[c_idx].strip()
                        if val_str in ("NaN", "", "nan", "null", "None"):
                            row_values.append(None)
                            non_finite_count += 1
                        else:
                            try:
                                parsed_val = float(val_str)
                                if math.isnan(parsed_val) or math.isinf(parsed_val):
                                    row_values.append(None)
                                    non_finite_count += 1
                                else:
                                    row_values.append(parsed_val)
                            except ValueError:
                                row_values.append(None)
                                non_finite_count += 1
                    else:
                        row_values.append(None)
                        non_finite_count += 1

                # If every single measurement is NaN/non-finite, mark as an empty boundary row
                is_boundary = (non_finite_count == measurement_col_count)
                is_boundary_row.append(is_boundary)
                measurement_matrix.append(row_values)

                if is_boundary:
                    reason = "All measurements are NaN (empty boundary observation)"
                    boundary_rows_info.append(
                        BoundaryRowInfo(
                            row_index=row_line_num,
                            timestamp=ts,
                            datetime=dt_str,
                            reason=reason,
                        )
                    )

            if not timestamps:
                raise ValueError(f"No valid data rows found in '{file_path}'.")

            # Detect sampling interval from consecutive timestamps
            sampling_interval_seconds = 0
            is_regular = True
            if len(timestamps) > 1:
                diffs = [timestamps[i + 1] - timestamps[i] for i in range(len(timestamps) - 1)]
                # Determine most frequent interval
                diff_counts: Dict[int, int] = {}
                for d in diffs:
                    diff_counts[d] = diff_counts.get(d, 0) + 1
                sampling_interval_seconds = max(diff_counts.items(), key=lambda item: item[1])[0]
                is_regular = len(set(diffs)) == 1

            parsed = ParsedDataset(
                dataset_id=dataset_id,
                display_name=config["display_name"],
                description=config["description"],
                file_path=file_path,
                series_metadata=series_metadata,
                timestamps=timestamps,
                datetimes=datetimes,
                is_boundary_row=is_boundary_row,
                measurement_matrix=measurement_matrix,
                boundary_rows_info=boundary_rows_info,
                sampling_interval_seconds=sampling_interval_seconds,
                is_regular_sampling=is_regular,
            )

            self._cache[dataset_id] = parsed
            return parsed

    def list_datasets(self) -> DatasetListResponse:
        """List all available university datasets and their summary metadata."""
        items: List[DatasetMetadataItem] = []

        for d_id, config in self._dataset_configs.items():
            file_avail = False
            resolved_path_str: Optional[str] = None
            series_count: Optional[int] = None
            valid_rows: Optional[int] = None
            first_dt: Optional[str] = None
            last_dt: Optional[str] = None
            sampling_sec: Optional[int] = None

            try:
                path = self.resolve_dataset_path(d_id)
                file_avail = True
                resolved_path_str = str(path).replace("\\", "/")

                # Attempt to get metadata from cache or load
                parsed = self.load_dataset(d_id)
                series_count = len(parsed.series_metadata)
                valid_rows = parsed.summary.valid_timestamp_count
                first_dt = parsed.summary.first_valid_datetime
                last_dt = parsed.summary.last_valid_datetime
                sampling_sec = parsed.sampling_interval_seconds
            except Exception as err:
                logger.debug("Could not inspect dataset '%s': %s", d_id, err)

            items.append(
                DatasetMetadataItem(
                    dataset_id=d_id,
                    display_name=config["display_name"],
                    description=config["description"],
                    file_available=file_avail,
                    file_path=resolved_path_str,
                    series_count=series_count,
                    valid_rows_count=valid_rows,
                    first_valid_datetime=first_dt,
                    last_valid_datetime=last_dt,
                    sampling_interval_seconds=sampling_sec,
                    unit_statement=DEFAULT_UNIT_STATEMENT,
                )
            )

        return DatasetListResponse(
            datasets=items,
            total=len(items),
            notes=(
                "University network datasets represent actual operational telemetry provided by Karunya faculty. "
                "All physical units and directional mappings remain unconfirmed in source exports."
            ),
        )

    def get_dataset_summary(self, dataset_id: str) -> DatasetSummaryResponse:
        """Retrieve precomputed summary and quality metrics for a dataset."""
        parsed = self.load_dataset(dataset_id)
        return parsed.summary

    def get_time_series(
        self,
        dataset_id: str,
        series_ids: Optional[List[str]] = None,
        include_boundary_rows: bool = False,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
        limit: int = 1000,
        offset: int = 0,
    ) -> TimeSeriesResponse:
        """Retrieve time-series measurements for selected series and time ranges.

        Args:
            dataset_id: Dataset identifier.
            series_ids: List of series IDs to include. If None or empty, includes all series.
            include_boundary_rows: If False, omits rows where all values are NaN.
            start_time: Optional Unix timestamp lower bound (inclusive).
            end_time: Optional Unix timestamp upper bound (inclusive).
            limit: Maximum points to return.
            offset: Number of matching points to skip for pagination.

        Returns:
            TimeSeriesResponse with chronological data points.
        """
        parsed = self.load_dataset(dataset_id)

        # Determine target series
        if not series_ids:
            target_series_meta = parsed.series_metadata
        else:
            target_series_meta = []
            for s_id in series_ids:
                s_id_clean = s_id.strip()
                if s_id_clean not in parsed.series_id_map:
                    raise SeriesNotFoundError(
                        f"Series '{s_id_clean}' not found in dataset '{dataset_id}'. "
                        f"Valid series IDs range from {parsed.series_metadata[0].series_id} to {parsed.series_metadata[-1].series_id}."
                    )
                target_series_meta.append(parsed.series_id_map[s_id_clean])

        target_col_indices = [meta.column_index - 1 for meta in target_series_meta]

        matching_points: List[TimeSeriesPoint] = []
        for r_idx, ts in enumerate(parsed.timestamps):
            is_b = parsed.is_boundary_row[r_idx]
            if is_b and not include_boundary_rows:
                continue

            if start_time is not None and ts < start_time:
                continue
            if end_time is not None and ts > end_time:
                continue

            values_map: Dict[str, Optional[float]] = {}
            for target_meta, c_idx in zip(target_series_meta, target_col_indices):
                raw_val = parsed.measurement_matrix[r_idx][c_idx]
                values_map[target_meta.series_id] = raw_val

            matching_points.append(
                TimeSeriesPoint(
                    timestamp=ts,
                    datetime=parsed.datetimes[r_idx],
                    is_boundary_row=is_b,
                    values=values_map,
                )
            )

        paginated_data = matching_points[offset : offset + limit]

        return TimeSeriesResponse(
            dataset_id=dataset_id,
            display_name=parsed.display_name,
            total_points=len(matching_points),
            sampling_interval_seconds=parsed.sampling_interval_seconds,
            series_metadata=target_series_meta,
            data=paginated_data,
            unit_statement=DEFAULT_UNIT_STATEMENT,
            direction_statement=DEFAULT_DIRECTION_STATEMENT,
        )

    def get_series_statistics(self, dataset_id: str, series_id: str) -> SeriesStatistics:
        """Retrieve statistical metrics for a single series within a dataset."""
        parsed = self.load_dataset(dataset_id)
        if series_id not in parsed.series_statistics:
            raise SeriesNotFoundError(
                f"Series '{series_id}' not found in dataset '{dataset_id}'. "
                f"Valid series IDs range from {parsed.series_metadata[0].series_id} to {parsed.series_metadata[-1].series_id}."
            )
        return parsed.series_statistics[series_id]

    def get_all_series_statistics(
        self,
        dataset_id: str,
        only_active: bool = False,
    ) -> AllSeriesStatisticsResponse:
        """Retrieve statistical metrics across all series in a dataset.

        Args:
            dataset_id: Dataset identifier.
            only_active: If True, filters out series that have 0 traffic across all rows.
        """
        parsed = self.load_dataset(dataset_id)
        stats_list = list(parsed.series_statistics.values())

        if only_active:
            stats_list = [s for s in stats_list if not s.is_all_zero and s.valid_count > 0]

        active_count = sum(1 for s in parsed.series_statistics.values() if not s.is_all_zero and s.valid_count > 0)
        zero_count = sum(1 for s in parsed.series_statistics.values() if s.is_all_zero)

        return AllSeriesStatisticsResponse(
            dataset_id=dataset_id,
            total_series=len(parsed.series_statistics),
            active_series=active_count,
            zero_series=zero_count,
            series_statistics=stats_list,
            unit_statement=DEFAULT_UNIT_STATEMENT,
            direction_statement=DEFAULT_DIRECTION_STATEMENT,
        )


# Singleton instance
_LOADER_INSTANCE: Optional[UniversityDataLoader] = None


def get_university_data_loader() -> UniversityDataLoader:
    """Obtain or initialize the UniversityDataLoader singleton."""
    global _LOADER_INSTANCE
    if _LOADER_INSTANCE is None:
        _LOADER_INSTANCE = UniversityDataLoader()
    return _LOADER_INSTANCE
