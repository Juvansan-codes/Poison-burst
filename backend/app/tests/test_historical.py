"""
PoissonBurst Lab - Unit and Integration Tests for Historical CSV Analysis.

Validates CSV preview, time-window flow aggregation, baseline calibration
(with contamination exclusion), Poisson burst detection, ground truth mapping,
and FastAPI endpoint behaviors.
"""

import io
import pytest
from fastapi.testclient import TestClient

from app.core.schemas import MeasurementType, TrafficSource
from app.main import app
from app.services.data_loader import HistoricalDataLoader

client = TestClient(app)

# Small deterministic synthetic CSV fixture:
# 10 flows over 20 seconds.
# First 10 seconds: benign traffic (approx 1 flow every 2s).
# Second 10 seconds: sudden attack burst (multiple flows in a small window).
SAMPLE_CSV_WITH_LABELS = """timestamp,src_ip,dst_ip,protocol,label
2026-03-01 10:00:00,192.168.1.10,10.0.0.1,TCP,BENIGN
2026-03-01 10:00:02,192.168.1.11,10.0.0.1,TCP,BENIGN
2026-03-01 10:00:04,192.168.1.12,10.0.0.1,TCP,BENIGN
2026-03-01 10:00:06,192.168.1.13,10.0.0.1,TCP,BENIGN
2026-03-01 10:00:08,192.168.1.14,10.0.0.1,TCP,BENIGN
2026-03-01 10:00:11,192.168.1.50,10.0.0.1,UDP,DDoS-LOIC
2026-03-01 10:00:11,192.168.1.51,10.0.0.1,UDP,DDoS-LOIC
2026-03-01 10:00:12,192.168.1.52,10.0.0.1,UDP,DDoS-LOIC
2026-03-01 10:00:12,192.168.1.53,10.0.0.1,UDP,DDoS-LOIC
2026-03-01 10:00:12,192.168.1.54,10.0.0.1,UDP,DDoS-LOIC
2026-03-01 10:00:13,192.168.1.55,10.0.0.1,UDP,DDoS-LOIC
2026-03-01 10:00:13,192.168.1.56,10.0.0.1,UDP,DDoS-LOIC
2026-03-01 10:00:13,192.168.1.57,10.0.0.1,UDP,DDoS-LOIC
2026-03-01 10:00:14,192.168.1.58,10.0.0.1,UDP,DDoS-LOIC
2026-03-01 10:00:14,192.168.1.59,10.0.0.1,UDP,DDoS-LOIC
2026-03-01 10:00:14,192.168.1.60,10.0.0.1,UDP,DDoS-LOIC
2026-03-01 10:00:14,192.168.1.61,10.0.0.1,UDP,DDoS-LOIC
2026-03-01 10:00:18,192.168.1.15,10.0.0.1,TCP,BENIGN
"""

SAMPLE_CSV_UNLABELED = """time,source_host,target_host,bytes
2026-03-01 10:00:00,srv1,srv2,1024
2026-03-01 10:00:02,srv1,srv2,2048
2026-03-01 10:00:04,srv1,srv2,1024
2026-03-01 10:00:06,srv1,srv2,512
2026-03-01 10:00:08,srv1,srv2,1024
"""

SAMPLE_CSV_INVALID_ROWS = """timestamp,flow_id
2026-03-01 10:00:00,flow1
not-a-timestamp,flow2
2026-03-01 10:00:04,flow3
,flow4
2026-03-01 10:00:08,flow5
"""


class TestHistoricalDataLoaderPreview:
    """Test HistoricalDataLoader.preview_csv."""

    def test_preview_valid_csv(self):
        content = SAMPLE_CSV_WITH_LABELS.encode("utf-8")
        preview = HistoricalDataLoader.preview_csv(content, "test.csv")
        assert preview.file_name == "test.csv"
        assert preview.total_rows >= 12
        assert "timestamp" in preview.columns
        assert "label" in preview.columns
        assert preview.suggested_timestamp_column == "timestamp"
        assert preview.suggested_label_column == "label"
        assert "BENIGN" in preview.detected_label_values
        assert "DDoS-LOIC" in preview.detected_label_values
        assert len(preview.sample_rows) > 0

    def test_preview_rejects_empty_file(self):
        with pytest.raises(ValueError, match="empty"):
            HistoricalDataLoader.preview_csv(b"", "empty.csv")

    def test_preview_rejects_oversized_file(self):
        # 51 MB dummy
        oversized = b"a" * (51 * 1024 * 1024)
        with pytest.raises(ValueError, match="exceeds maximum allowed limit"):
            HistoricalDataLoader.preview_csv(oversized, "large.csv")


class TestHistoricalDataLoaderAnalysis:
    """Test HistoricalDataLoader.analyze_csv."""

    def test_analyze_with_labels_and_burst_detection(self):
        content = SAMPLE_CSV_WITH_LABELS.encode("utf-8")
        res = HistoricalDataLoader.analyze_csv(
            content=content,
            filename="capture.csv",
            timestamp_column="timestamp",
            label_column="label",
            benign_label_value="BENIGN",
            window_seconds=5.0,  # 5s windows
            baseline_mode="ratio",
            baseline_ratio=0.5,
            alpha=0.01,
        )

        assert res.measurement_type == MeasurementType.FLOW_COUNT
        assert res.measurement_unit_description == "Network flows per observation window"
        assert res.total_rows_processed == 18
        assert res.invalid_rows == 0
        assert res.total_windows >= 4
        assert res.lambda_window > 0.0
        assert res.baseline_rate_per_second > 0.0

        # Burst window should be flagged
        assert res.detected_burst_count > 0
        assert res.labeled_burst_count is not None and res.labeled_burst_count > 0

        # Evaluation metrics must be computed when labels exist
        assert res.evaluation is not None
        assert res.evaluation.true_positives > 0
        assert res.evaluation.precision > 0.0
        assert res.evaluation.recall > 0.0

    def test_analyze_unlabeled_dataset_omits_evaluation(self):
        content = SAMPLE_CSV_UNLABELED.encode("utf-8")
        res = HistoricalDataLoader.analyze_csv(
            content=content,
            filename="unlabeled.csv",
            timestamp_column="time",
            label_column=None,
            window_seconds=2.0,
            alpha=0.05,
        )

        assert res.measurement_type == MeasurementType.FLOW_COUNT
        assert res.total_rows_processed == 5
        # Ground truth must be None for all windows
        assert all(obs.ground_truth is None for obs in res.observations)
        assert res.labeled_burst_count is None
        # Must not fabricate evaluation metrics when ground truth is absent
        assert res.evaluation is None

    def test_analyze_discards_invalid_rows_and_reports_count(self):
        content = SAMPLE_CSV_INVALID_ROWS.encode("utf-8")
        res = HistoricalDataLoader.analyze_csv(
            content=content,
            filename="corrupt.csv",
            timestamp_column="timestamp",
            window_seconds=2.0,
        )

        # 3 valid timestamps, 2 invalid rows
        assert res.total_rows_processed == 3
        assert res.invalid_rows == 2

    def test_baseline_excludes_labeled_attack_windows(self):
        """Verify baseline calibration excludes windows containing attacks to prevent contamination."""
        content = SAMPLE_CSV_WITH_LABELS.encode("utf-8")
        res = HistoricalDataLoader.analyze_csv(
            content=content,
            filename="test.csv",
            timestamp_column="timestamp",
            label_column="label",
            benign_label_value="BENIGN",
            window_seconds=5.0,
            baseline_mode="ratio",
            baseline_ratio=1.0,  # Try to calibrate over the whole file
            alpha=0.01,
        )

        # Calibration note should mention exclusion
        assert "excluded" in res.calibration_method.lower()
        # Lambda must be estimated from benign windows only (approx 2 to 3 flows/window, NOT inflated by the 7-flow burst)
        assert res.lambda_window < 4.0

    def test_reject_missing_timestamp_column(self):
        content = SAMPLE_CSV_UNLABELED.encode("utf-8")
        with pytest.raises(ValueError, match="not found"):
            HistoricalDataLoader.analyze_csv(
                content=content,
                filename="test.csv",
                timestamp_column="non_existent_column",
            )

    def test_reject_invalid_alpha(self):
        content = SAMPLE_CSV_UNLABELED.encode("utf-8")
        with pytest.raises(ValueError, match="alpha"):
            HistoricalDataLoader.analyze_csv(
                content=content,
                filename="test.csv",
                timestamp_column="time",
                alpha=1.5,
            )


class TestHistoricalApiEndpoints:
    """Test FastAPI /api/historical endpoints."""

    def test_preview_endpoint_success(self):
        file_bytes = io.BytesIO(SAMPLE_CSV_WITH_LABELS.encode("utf-8"))
        res = client.post(
            "/api/historical/preview",
            files={"file": ("dataset.csv", file_bytes, "text/csv")},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["file_name"] == "dataset.csv"
        assert "timestamp" in data["columns"]
        assert data["suggested_timestamp_column"] == "timestamp"
        assert data["suggested_label_column"] == "label"

    def test_preview_endpoint_rejects_non_csv(self):
        file_bytes = io.BytesIO(b"dummy binary data")
        res = client.post(
            "/api/historical/preview",
            files={"file": ("capture.pcap", file_bytes, "application/octet-stream")},
        )
        assert res.status_code == 400
        assert "Only .csv files are supported" in res.json()["detail"]

    def test_analyze_endpoint_success(self):
        file_bytes = io.BytesIO(SAMPLE_CSV_WITH_LABELS.encode("utf-8"))
        payload = {
            "timestamp_column": "timestamp",
            "label_column": "label",
            "benign_label_value": "BENIGN",
            "window_seconds": "5.0",
            "baseline_mode": "ratio",
            "baseline_ratio": "0.5",
            "alpha": "0.01",
        }
        res = client.post(
            "/api/historical/analyze",
            data=payload,
            files={"file": ("traffic.csv", file_bytes, "text/csv")},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["measurement_type"] == "flow_count"
        assert data["total_rows_processed"] == 18
        assert len(data["observations"]) > 0
        assert len(data["detections"]) > 0
        assert data["detected_burst_count"] > 0
        assert data["evaluation"] is not None

    def test_formats_endpoint(self):
        res = client.get("/api/historical/formats")
        assert res.status_code == 200
        data = res.json()
        assert "supported_formats" in data
        assert any(f["format"] == "CSV_FLOW" for f in data["supported_formats"])
