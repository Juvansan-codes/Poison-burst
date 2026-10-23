"""
PoissonBurst Lab - Historical Data Loading, Preview, and Analysis Service.

Authoritative historical traffic CSV ingestion, time-window aggregation,
baseline calibration with abnormal-event exclusion, and Poisson burst detection.

CRITICAL DOMAIN DISTINCTIONS:
- CSV network-flow records (NetFlow, IPFIX, CICIDS2017 flow summaries) represent FLOW counts.
- PCAP files represent raw PACKET counts (future milestone).
- Flow counts and Packet counts must NEVER be mixed or mislabeled.
- Historical attack labels mark flow connections, not individual packet windows.
- Injected/labeled bursts must be excluded during baseline calibration to avoid contamination.
"""

from __future__ import annotations

import io
import math
import uuid
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

import numpy as np
import pandas as pd

from app.core.poisson import detect_burst
from app.core.schemas import (
    DetectionResponse,
    EvaluationMetrics,
    HistoricalAnalysisResponse,
    HistoricalPreviewResponse,
    MeasurementType,
    TrafficObservation,
    TrafficSource,
)
from app.services.evaluation import evaluate_detection_performance

# 50 MB upload limit
MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024
MAX_AGGREGATED_WINDOWS = 10000

# Keyword heuristics for column auto-suggestion
TIMESTAMP_CANDIDATE_KEYWORDS = [
    "timestamp",
    "time",
    "date",
    "datetime",
    "flow_start",
    "start_time",
    "epoch",
    "ts",
]

LABEL_CANDIDATE_KEYWORDS = [
    "label",
    "attack",
    "class",
    "category",
    "flow_type",
    "classification",
]


class HistoricalDataLoader:
    """Authoritative historical traffic dataset parser, aggregator, and detection runner."""

    @staticmethod
    def get_supported_formats() -> List[Dict[str, Any]]:
        """List currently supported and planned historical formats."""
        return [
            {
                "format": "CSV_FLOW",
                "measurement_type": MeasurementType.FLOW_COUNT.value,
                "description": "Network flow summary records (e.g. CICIDS2017) aggregated into fixed-duration flow counts.",
                "status": "supported",
            },
            {
                "format": "PCAP_PACKET",
                "measurement_type": MeasurementType.PACKET_COUNT.value,
                "description": "Raw packet captures aggregated into packet-count windows (planned future milestone).",
                "status": "planned_future_milestone",
            },
        ]

    @classmethod
    def preview_csv(
        cls,
        content: bytes,
        filename: str,
        max_sample_rows: int = 10,
    ) -> HistoricalPreviewResponse:
        """Inspect an uploaded CSV file, extract metadata, sample rows, and infer column mappings.

        Args:
            content: Raw byte content of uploaded file.
            filename: Original name of the uploaded file.
            max_sample_rows: Number of preview rows to return.

        Returns:
            HistoricalPreviewResponse with columns, sample data, and diagnostics.
        """
        if len(content) > MAX_UPLOAD_SIZE_BYTES:
            raise ValueError(
                f"File size ({len(content) / (1024 * 1024):.1f} MB) exceeds maximum allowed limit of 50 MB."
            )

        if len(content) == 0:
            raise ValueError("Uploaded file is empty.")

        text = cls._decode_bytes(content)

        try:
            sample_df = pd.read_csv(io.StringIO(text), nrows=max_sample_rows)
        except Exception as e:
            raise ValueError(f"Malformed CSV file: {str(e)}")

        if sample_df.empty and len(sample_df.columns) == 0:
            raise ValueError("CSV contains no columns or data records.")

        columns = [str(c).strip() for c in sample_df.columns]

        # Fast line count estimate for total data rows
        total_rows = max(0, text.count("\n") - (1 if text.endswith("\n") else 0))

        # Infer timestamp column
        suggested_time_col, time_diag = cls._infer_timestamp_column(sample_df)

        # Infer label column & extract unique sample label values
        suggested_label_col, label_values = cls._infer_label_column(sample_df)

        # Clean sample rows dict for JSON serialization
        sample_rows_clean: List[Dict[str, Any]] = []
        for row in sample_df.to_dict(orient="records"):
            cleaned_row = {
                k: (None if pd.isna(v) else v) for k, v in row.items()
            }
            sample_rows_clean.append(cleaned_row)

        warnings: List[str] = []
        if suggested_time_col is None:
            warnings.append(
                "Could not automatically detect a timestamp column. Please select your timestamp column manually."
            )
        if suggested_label_col is None:
            warnings.append(
                "No label column detected. If this dataset does not contain ground truth, burst evaluation metrics will be omitted."
            )

        return HistoricalPreviewResponse(
            file_name=filename,
            file_size_bytes=len(content),
            total_rows=total_rows,
            columns=columns,
            sample_rows=sample_rows_clean,
            suggested_timestamp_column=suggested_time_col,
            suggested_label_column=suggested_label_col,
            detected_label_values=label_values,
            timestamp_diagnostics=time_diag,
            warnings=warnings,
        )

    @classmethod
    def analyze_csv(
        cls,
        content: bytes,
        filename: str,
        timestamp_column: str,
        label_column: Optional[str] = None,
        benign_label_value: Optional[str] = "BENIGN",
        window_seconds: float = 5.0,
        baseline_mode: str = "ratio",
        baseline_ratio: Optional[float] = 0.3,
        baseline_window_count: Optional[int] = None,
        baseline_start_timestamp: Optional[str] = None,
        baseline_end_timestamp: Optional[str] = None,
        alpha: float = 0.01,
    ) -> HistoricalAnalysisResponse:
        """Run complete historical flow aggregation, baseline calibration, and burst detection.

        Args:
            content: Raw byte content of uploaded CSV file.
            filename: Name of the uploaded file.
            timestamp_column: Name of the column containing arrival timestamps.
            label_column: Optional column containing flow labels (e.g. BENIGN, DDoS).
            benign_label_value: Value(s) representing normal traffic (default: "BENIGN").
            window_seconds: Duration of observation windows in seconds (W >= 0.1s).
            baseline_mode: Calibration mode ('ratio', 'window_count', or 'timestamp_range').
            baseline_ratio: Fraction of windows to calibrate baseline (default: 0.3).
            baseline_window_count: Explicit number of initial baseline windows.
            baseline_start_timestamp: Start timestamp for calibration window range.
            baseline_end_timestamp: End timestamp for calibration window range.
            alpha: Significance threshold for upper-tail burst detection (0 < alpha < 1).

        Returns:
            HistoricalAnalysisResponse with aggregated series, detections, and evaluation.
        """
        if len(content) > MAX_UPLOAD_SIZE_BYTES:
            raise ValueError(
                f"File size ({len(content) / (1024 * 1024):.1f} MB) exceeds maximum allowed limit of 50 MB."
            )

        if len(content) == 0:
            raise ValueError("Uploaded file is empty.")

        if window_seconds <= 0.0:
            raise ValueError("Observation window duration must be strictly positive (e.g. 1.0s, 5.0s, 10.0s).")

        if not (0.0 < alpha < 1.0):
            raise ValueError(f"Significance threshold alpha must be in (0, 1), received {alpha}.")

        text = cls._decode_bytes(content)

        try:
            df = pd.read_csv(io.StringIO(text))
        except Exception as e:
            raise ValueError(f"Failed to parse CSV: {str(e)}")

        if df.empty:
            raise ValueError("CSV contains no data records.")

        # Clean column whitespace
        df.columns = [str(c).strip() for c in df.columns]

        # Match timestamp column
        time_col = cls._find_column(df.columns, timestamp_column)
        if time_col is None:
            raise ValueError(
                f"Timestamp column '{timestamp_column}' not found. Available columns: {list(df.columns)}"
            )

        # Parse timestamps into datetime
        parsed_times = pd.to_datetime(df[time_col], errors="coerce")
        invalid_mask = parsed_times.isna()
        invalid_rows = int(invalid_mask.sum())
        valid_df = df[~invalid_mask].copy()
        valid_df["__parsed_time"] = parsed_times[~invalid_mask]

        if len(valid_df) == 0:
            raise ValueError(
                f"Could not parse any valid timestamps in column '{timestamp_column}'. Check date-time format."
            )

        # Normalize timezone if present
        if valid_df["__parsed_time"].dt.tz is not None:
            valid_df["__parsed_time"] = valid_df["__parsed_time"].dt.tz_convert("UTC").dt.tz_localize(None)

        # Sort chronologically
        valid_df = valid_df.sort_values(by="__parsed_time").reset_index(drop=True)

        t_min = valid_df["__parsed_time"].iloc[0]
        t_max = valid_df["__parsed_time"].iloc[-1]
        total_span_seconds = float((t_max - t_min).total_seconds())

        total_windows = max(1, int(total_span_seconds // window_seconds) + 1)
        if total_windows > MAX_AGGREGATED_WINDOWS:
            raise ValueError(
                f"The observation span ({total_span_seconds:.1f}s) divided by window size ({window_seconds}s) "
                f"produces {total_windows} windows, exceeding the {MAX_AGGREGATED_WINDOWS} window limit. "
                f"Please choose a larger observation window duration (e.g. 10s, 30s, or 60s)."
            )

        # Compute window index for each row
        offsets = (valid_df["__parsed_time"] - t_min).dt.total_seconds()
        valid_df["__window_idx"] = (offsets // window_seconds).astype(int).clip(0, total_windows - 1)

        # Aggregate flow counts per window
        counts_series = valid_df["__window_idx"].value_counts()
        window_counts = [int(counts_series.get(idx, 0)) for idx in range(total_windows)]

        # Process ground truth labels if column is present
        matched_label_col = cls._find_column(valid_df.columns, label_column) if label_column else None
        has_labels = matched_label_col is not None

        window_ground_truth: List[Optional[bool]]
        labeled_burst_count: Optional[int] = None

        if has_labels:
            benign_norm = [
                b.strip().lower()
                for b in (benign_label_value or "BENIGN").split(",")
                if b.strip()
            ]
            row_labels = valid_df[matched_label_col].astype(str).str.strip().str.lower()
            is_attack_row = ~row_labels.isin(benign_norm)
            attack_windows = set(valid_df[is_attack_row]["__window_idx"].unique())

            window_ground_truth = [
                (idx in attack_windows) for idx in range(total_windows)
            ]
            labeled_burst_count = len(attack_windows)
        else:
            window_ground_truth = [None] * total_windows

        # Baseline Calibration Selection
        candidate_indices: List[int] = []
        if (
            baseline_mode == "timestamp_range"
            and baseline_start_timestamp
            and baseline_end_timestamp
        ):
            try:
                b_start = pd.to_datetime(baseline_start_timestamp)
                b_end = pd.to_datetime(baseline_end_timestamp)
                if b_start.tzinfo:
                    b_start = b_start.tz_convert("UTC").tz_localize(None)
                if b_end.tzinfo:
                    b_end = b_end.tz_convert("UTC").tz_localize(None)

                for idx in range(total_windows):
                    win_start = t_min + pd.Timedelta(seconds=idx * window_seconds)
                    if b_start <= win_start <= b_end:
                        candidate_indices.append(idx)
            except Exception:
                candidate_indices = []

        if not candidate_indices:
            if baseline_mode == "window_count" and baseline_window_count and baseline_window_count > 0:
                candidate_indices = list(range(min(total_windows, baseline_window_count)))
            else:
                ratio = max(0.05, min(1.0, baseline_ratio if baseline_ratio is not None else 0.3))
                num_base = max(1, int(round(total_windows * ratio)))
                candidate_indices = list(range(num_base))

        # EXCLUDE known non-benign windows to prevent baseline contamination
        if has_labels:
            clean_baseline_indices = [
                idx for idx in candidate_indices if not window_ground_truth[idx]
            ]
            excluded_attacks = len(candidate_indices) - len(clean_baseline_indices)
            calib_method_desc = (
                f"Calibrated from {len(clean_baseline_indices)} clean baseline windows "
                f"(excluded {excluded_attacks} labeled attack windows to prevent baseline contamination)."
            )
        else:
            clean_baseline_indices = candidate_indices
            calib_method_desc = (
                f"Calibrated from initial {len(clean_baseline_indices)} observation windows "
                f"(unlabeled dataset; calibration interval assumed representative normal traffic)."
            )

        if not clean_baseline_indices:
            raise ValueError(
                "Selected calibration period contains zero benign/normal windows. "
                "Please select a calibration period representative of normal baseline traffic."
            )

        baseline_sum = sum(window_counts[idx] for idx in clean_baseline_indices)
        lambda_window = float(baseline_sum / len(clean_baseline_indices))
        baseline_rate_per_sec = float(lambda_window / window_seconds)

        # Run Authoritative Poisson Detection
        experiment_id = f"hist-{uuid.uuid4().hex[:8]}"
        observations: List[TrafficObservation] = []
        detections: List[DetectionResponse] = []
        detected_burst_count = 0

        for idx in range(total_windows):
            obs_count = window_counts[idx]
            win_start_dt = t_min + pd.Timedelta(seconds=idx * window_seconds)
            time_str = win_start_dt.isoformat()
            time_sec = float(idx * window_seconds)
            gt = window_ground_truth[idx]

            det_result = detect_burst(
                observed_count=obs_count,
                expected_rate=lambda_window,
                alpha=alpha,
            )

            if det_result.is_burst:
                detected_burst_count += 1
                interpretation = (
                    f"BURST ALERT: Statistically unusual arrival of {obs_count} flows "
                    f"(P(X >= {obs_count} | lambda={lambda_window:.2f}) = {det_result.p_value:.6e} < alpha={alpha})."
                )
            else:
                interpretation = (
                    f"NORMAL: Arrival count of {obs_count} flows within normal variance "
                    f"(P(X >= {obs_count} | lambda={lambda_window:.2f}) = {det_result.p_value:.6f} >= alpha={alpha})."
                )

            observations.append(
                TrafficObservation(
                    timestamp=time_str,
                    count=obs_count,
                    source=TrafficSource.HISTORICAL,
                    measurement_type=MeasurementType.FLOW_COUNT,
                    ground_truth=gt,
                    experiment_id=experiment_id,
                    window_seconds=window_seconds,
                    time_seconds=time_sec,
                    expected_baseline_count=round(lambda_window, 2),
                )
            )

            detections.append(
                DetectionResponse(
                    observed_count=obs_count,
                    expected_rate=round(lambda_window, 4),
                    p_value=det_result.p_value,
                    alpha=alpha,
                    is_burst=det_result.is_burst,
                    interpretation=interpretation,
                    ground_truth=gt,
                    timestamp=time_str,
                    time_seconds=time_sec,
                )
            )

        # Performance Evaluation against Ground Truth (only when valid labels exist)
        evaluation: Optional[EvaluationMetrics] = None
        if has_labels and any(gt is not None for gt in window_ground_truth):
            det_bools = [d.is_burst for d in detections]
            evaluation = evaluate_detection_performance(
                ground_truth=window_ground_truth,
                detections=det_bools,
                window_seconds=window_seconds,
            )

        summary = (
            f"Analyzed {len(valid_df)} flow records over {total_windows} contiguous windows ({window_seconds}s each). "
            f"Baseline lambda = {lambda_window:.2f} flows/window ({baseline_rate_per_sec:.2f} flows/s). "
            f"Detected {detected_burst_count} statistical burst windows at alpha = {alpha}."
        )

        model_limitation_note = (
            "Historical Flow Traffic Limitation: The Poisson model assumes independent, memoryless arrivals "
            "with equal mean and variance (Var(X) = E[X]). Aggregated network flow records frequently exhibit "
            "overdispersion (Var(X) > E[X]) and temporal auto-correlation. When traffic is bursty, the Poisson detector "
            "may flag more false alarms than nominal alpha. Furthermore, historical flow labels indicate malicious connection "
            "intent, which does not always produce high-volume traffic surges."
        )

        return HistoricalAnalysisResponse(
            experiment_id=experiment_id,
            file_name=filename,
            measurement_type=MeasurementType.FLOW_COUNT,
            measurement_unit_description="Network flows per observation window",
            window_seconds=window_seconds,
            total_rows_processed=len(valid_df),
            invalid_rows=invalid_rows,
            total_windows=total_windows,
            baseline_window_count=len(clean_baseline_indices),
            lambda_window=round(lambda_window, 4),
            baseline_rate_per_second=round(baseline_rate_per_sec, 4),
            calibration_method=calib_method_desc,
            detected_burst_count=detected_burst_count,
            labeled_burst_count=labeled_burst_count,
            observations=observations,
            detections=detections,
            evaluation=evaluation,
            summary=summary,
            model_limitation_note=model_limitation_note,
        )

    # -------------------------------------------------------------------------
    # Helper utilities
    # -------------------------------------------------------------------------

    @classmethod
    def _decode_bytes(cls, content: bytes) -> str:
        """Decode raw bytes into string, falling back to latin-1 on UTF-8 error."""
        try:
            return content.decode("utf-8")
        except UnicodeDecodeError:
            return content.decode("latin-1")

    @classmethod
    def _find_column(cls, columns: Sequence[str], target: Optional[str]) -> Optional[str]:
        """Case-insensitive column name resolver."""
        if not target:
            return None
        target_clean = target.strip().lower()
        for col in columns:
            if col.strip().lower() == target_clean:
                return col
        return None

    @classmethod
    def _infer_timestamp_column(cls, df: pd.DataFrame) -> Tuple[Optional[str], Optional[str]]:
        """Identify candidate timestamp column by keywords and test parsing."""
        candidates = []
        for col in df.columns:
            col_lower = str(col).strip().lower()
            if any(k in col_lower for k in TIMESTAMP_CANDIDATE_KEYWORDS):
                candidates.append(col)

        # If no keyword matches, test all non-numeric object/string columns
        if not candidates:
            candidates = [col for col in df.columns if df[col].dtype == object]

        for cand in candidates:
            series = df[cand].dropna()
            if len(series) == 0:
                continue
            parsed = pd.to_datetime(series.head(5), errors="coerce")
            if parsed.notna().sum() >= max(1, int(len(series.head(5)) * 0.6)):
                sample_val = str(series.iloc[0])
                diag = f"Successfully parsed sample '{sample_val}' as {parsed.dropna().iloc[0]}"
                return cand, diag

        return None, "No standard timestamp format recognized in candidate columns."

    @classmethod
    def _infer_label_column(cls, df: pd.DataFrame) -> Tuple[Optional[str], List[str]]:
        """Identify candidate label column and extract sample unique values."""
        for col in df.columns:
            col_lower = str(col).strip().lower()
            if any(k in col_lower for k in LABEL_CANDIDATE_KEYWORDS):
                unique_vals = [
                    str(v).strip()
                    for v in df[col].dropna().unique()
                    if str(v).strip()
                ]
                return col, unique_vals[:20]

        return None, []
