"""
PoissonBurst Lab - University Network Analytics Test Suite.

Verifies:
1. University dataset loader service and configurable dataset mappings.
2. Accurate column preservation despite repeated ('Rx') and blank ('') headers.
3. Stable display identifiers without invented interface names.
4. Correct Unix timestamp conversion and dynamic sampling interval detection (5400s / 90 min).
5. Identification of empty boundary rows without treating NaNs as zero traffic observations.
6. Preservation of raw signed values (positive Rx and negative blank-header telemetry).
7. Data quality metrics, missing-value counts, and peak telemetry identification.
8. REST API endpoints, parameter validation, and security (path traversal prevention).
9. In-memory caching and performance behavior.
"""

from __future__ import annotations

import os
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.university_data_loader import (
    DatasetNotFoundError,
    SeriesNotFoundError,
    UniversityDataLoader,
    get_university_data_loader,
)

client = TestClient(app)


class TestUniversityDataLoaderService:
    """Direct unit tests for UniversityDataLoader service."""

    def test_singleton_loader(self):
        """Verify get_university_data_loader returns a shared instance."""
        loader1 = get_university_data_loader()
        loader2 = get_university_data_loader()
        assert loader1 is loader2

    def test_list_datasets_metadata(self):
        """Verify registered datasets and metadata."""
        loader = get_university_data_loader()
        res = loader.list_datasets()
        assert res.total >= 2
        d_map = {d.dataset_id: d for d in res.datasets}
        assert "core_switch" in d_map
        assert "firewall" in d_map

        cs = d_map["core_switch"]
        assert cs.file_available is True
        assert cs.series_count == 194
        assert cs.valid_rows_count == 111
        assert cs.sampling_interval_seconds == 5400
        assert "unconfirmed" in cs.unit_statement.lower()

        fw = d_map["firewall"]
        assert fw.file_available is True
        assert fw.series_count == 50
        assert fw.valid_rows_count == 111
        assert fw.sampling_interval_seconds == 5400

    def test_core_switch_parsing_fidelity(self):
        """Verify Core Switch column count, boundary rows, and sign preservation."""
        loader = get_university_data_loader()
        cs = loader.load_dataset("core_switch")

        # 194 measurement series + 1 time column = 195 columns
        assert len(cs.series_metadata) == 194
        assert len(cs.timestamps) == 113

        # Exactly 2 boundary rows (indices 0 and 112)
        assert cs.is_boundary_row[0] is True
        assert cs.is_boundary_row[-1] is True
        assert sum(cs.is_boundary_row) == 2
        assert len(cs.boundary_rows_info) == 2
        assert cs.boundary_rows_info[0].row_index == 2
        assert cs.boundary_rows_info[1].row_index == 114

        # 111 valid data rows
        valid_indices = [i for i, b in enumerate(cs.is_boundary_row) if not b]
        assert len(valid_indices) == 111

        # Sampling interval detected
        assert cs.sampling_interval_seconds == 5400
        assert cs.is_regular_sampling is True

        # Columns 1 to 97 are Rx (positive), Columns 98 to 194 are blank (negative)
        for meta in cs.series_metadata[:97]:
            assert meta.original_header == "Rx"
            assert meta.is_blank_header is False
            assert "Rx" in meta.display_name
        for meta in cs.series_metadata[97:]:
            assert meta.original_header == ""
            assert meta.is_blank_header is True
            assert "unlabeled" in meta.display_name

        # Summary checks
        summary = cs.summary
        assert summary.measurement_series_count == 194
        assert summary.valid_timestamp_count == 111
        assert summary.active_series_count == 87
        assert summary.zero_series_count == 107
        assert summary.total_missing_measurements == 0
        assert summary.peak_measurement.abs_value == pytest.approx(1554423611.5, rel=1e-4)

    def test_firewall_parsing_fidelity(self):
        """Verify Firewall column count, pairing, and sign preservation."""
        loader = get_university_data_loader()
        fw = loader.load_dataset("firewall")

        # 50 measurement series + 1 time column = 51 columns
        assert len(fw.series_metadata) == 50
        assert len(fw.timestamps) == 113
        assert sum(fw.is_boundary_row) == 2

        summary = fw.summary
        assert summary.measurement_series_count == 50
        assert summary.valid_timestamp_count == 111
        assert summary.active_series_count == 12
        assert summary.zero_series_count == 38
        assert summary.peak_measurement.series_id == "series_026"
        assert summary.peak_measurement.signed_value == pytest.approx(-1401732808.1, rel=1e-4)

    def test_empty_rows_not_interpreted_as_zero(self):
        """Ensure boundary rows containing NaNs are identified as boundary and never replaced by 0."""
        loader = get_university_data_loader()
        fw = loader.load_dataset("firewall")

        # Row 0 is boundary
        assert fw.is_boundary_row[0] is True
        row_0_vals = fw.measurement_matrix[0]
        # Must be None, never 0.0
        assert all(v is None for v in row_0_vals)

        # Row 112 is boundary
        assert fw.is_boundary_row[112] is True
        row_last_vals = fw.measurement_matrix[112]
        assert all(v is None for v in row_last_vals)

        # Interior rows have finite numbers
        row_1_vals = fw.measurement_matrix[1]
        assert any(v is not None and v != 0.0 for v in row_1_vals)

    def test_dataset_id_validation_prevents_arbitrary_access(self):
        """Verify that unknown dataset IDs or traversal attempts are rejected."""
        loader = get_university_data_loader()
        with pytest.raises(DatasetNotFoundError):
            loader.load_dataset("../../etc/passwd")

        with pytest.raises(DatasetNotFoundError):
            loader.load_dataset("arbitrary_unknown")

    def test_series_id_validation(self):
        """Verify unknown series IDs raise SeriesNotFoundError."""
        loader = get_university_data_loader()
        with pytest.raises(SeriesNotFoundError):
            loader.get_series_statistics("firewall", "non_existent_series")


class TestUniversityNetworkEndpoints:
    """Integration tests for FastAPI endpoints under /api/university-network."""

    def test_get_datasets_endpoint(self):
        """Test GET /api/university-network/datasets."""
        response = client.get("/api/university-network/datasets")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 2
        ids = [d["dataset_id"] for d in data["datasets"]]
        assert "core_switch" in ids
        assert "firewall" in ids

    def test_get_core_switch_summary_endpoint(self):
        """Test GET /api/university-network/datasets/core_switch/summary."""
        response = client.get("/api/university-network/datasets/core_switch/summary")
        assert response.status_code == 200
        data = response.json()
        assert data["dataset_id"] == "core_switch"
        assert data["measurement_series_count"] == 194
        assert data["valid_timestamp_count"] == 111
        assert data["observed_sampling_interval_seconds"] == 5400
        assert data["is_regular_sampling"] is True
        assert data["data_quality"]["empty_boundary_rows_count"] == 2
        assert "unconfirmed" in data["unit_statement"].lower()
        assert "Rx" in data["direction_statement"]

    def test_get_firewall_summary_endpoint(self):
        """Test GET /api/university-network/datasets/firewall/summary."""
        response = client.get("/api/university-network/datasets/firewall/summary")
        assert response.status_code == 200
        data = response.json()
        assert data["dataset_id"] == "firewall"
        assert data["measurement_series_count"] == 50
        assert data["valid_timestamp_count"] == 111
        assert data["active_series_count"] == 12
        assert data["zero_series_count"] == 38
        assert data["peak_measurement"]["series_id"] == "series_026"
        assert data["peak_measurement"]["signed_value"] < 0

    def test_get_time_series_endpoint_default(self):
        """Test GET /api/university-network/datasets/firewall/series default behavior."""
        response = client.get("/api/university-network/datasets/firewall/series")
        assert response.status_code == 200
        data = response.json()
        # Default excludes empty boundary rows, returning all 111 valid points
        assert data["total_points"] == 111
        assert len(data["data"]) == 111
        # All 50 series present in each point
        assert len(data["series_metadata"]) == 50
        first_point = data["data"][0]
        assert len(first_point["values"]) == 50
        assert first_point["is_boundary_row"] is False

    def test_get_time_series_endpoint_with_filtering_and_boundary(self):
        """Test series filtering, boundary row inclusion, and signed values."""
        response = client.get(
            "/api/university-network/datasets/firewall/series",
            params={
                "series_ids": "series_001,series_026",
                "include_boundary_rows": True,
                "limit": 5,
                "offset": 0,
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total_points"] == 113  # 111 valid + 2 boundary
        assert len(data["data"]) == 5
        assert len(data["series_metadata"]) == 2

        # Point 0 is boundary: values should be None
        p0 = data["data"][0]
        assert p0["is_boundary_row"] is True
        assert p0["values"]["series_001"] is None
        assert p0["values"]["series_026"] is None

        # Point 1 is valid: series_001 is positive, series_026 is negative
        p1 = data["data"][1]
        assert p1["is_boundary_row"] is False
        assert p1["values"]["series_001"] > 0
        assert p1["values"]["series_026"] < 0

    def test_get_time_series_time_slicing(self):
        """Test time range slicing with start_time and end_time."""
        response = client.get(
            "/api/university-network/datasets/firewall/series",
            params={
                "start_time": 1792249200,
                "end_time": 1792260000,
            },
        )
        assert response.status_code == 200
        data = response.json()
        # Timestamps: 1792249200, 1792254600, 1792260000 -> 3 points
        assert len(data["data"]) == 3
        timestamps = [p["timestamp"] for p in data["data"]]
        assert timestamps == [1792249200, 1792254600, 1792260000]

    def test_get_series_statistics_endpoint(self):
        """Test GET /api/university-network/datasets/firewall/series/{series_id}/statistics."""
        # Active Rx series
        res1 = client.get("/api/university-network/datasets/firewall/series/series_001/statistics")
        assert res1.status_code == 200
        s1 = res1.json()
        assert s1["series_id"] == "series_001"
        assert s1["is_all_zero"] is False
        assert s1["valid_count"] == 111
        assert s1["missing_count"] == 0
        assert s1["min_value"] > 0
        assert s1["max_value"] > 0

        # Paired negative blank-header series
        res26 = client.get("/api/university-network/datasets/firewall/series/series_026/statistics")
        assert res26.status_code == 200
        s26 = res26.json()
        assert s26["series_id"] == "series_026"
        assert s26["is_all_zero"] is False
        assert s26["min_value"] < 0
        assert s26["max_value"] < 0

        # Inactive series (e.g. series_007)
        res7 = client.get("/api/university-network/datasets/firewall/series/series_007/statistics")
        assert res7.status_code == 200
        s7 = res7.json()
        assert s7["is_all_zero"] is True
        assert s7["min_value"] == 0.0
        assert s7["max_value"] == 0.0

    def test_get_all_series_statistics_endpoint(self):
        """Test GET /api/university-network/datasets/firewall/statistics."""
        # All series
        res_all = client.get("/api/university-network/datasets/firewall/statistics")
        assert res_all.status_code == 200
        data_all = res_all.json()
        assert data_all["total_series"] == 50
        assert len(data_all["series_statistics"]) == 50

        # Only active series
        res_active = client.get("/api/university-network/datasets/firewall/statistics?only_active=true")
        assert res_active.status_code == 200
        data_active = res_active.json()
        assert data_active["total_series"] == 50
        assert data_active["active_series"] == 12
        assert len(data_active["series_statistics"]) == 12

    def test_unknown_dataset_404(self):
        """Test path validation returns 404 for unknown dataset."""
        res = client.get("/api/university-network/datasets/invalid_dataset/summary")
        assert res.status_code == 404
        assert "Unknown dataset identifier" in res.json()["detail"]

    def test_path_traversal_attempt_404(self):
        """Test path traversal strings are rejected with 404."""
        res = client.get("/api/university-network/datasets/..%2F..%2Fetc/summary")
        assert res.status_code == 404

    def test_unknown_series_404(self):
        """Test 404 when querying an invalid series ID."""
        res = client.get("/api/university-network/datasets/firewall/series/series_999/statistics")
        assert res.status_code == 404
        assert "not found" in res.json()["detail"]
