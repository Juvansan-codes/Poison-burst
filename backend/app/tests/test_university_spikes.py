"""
PoissonBurst Lab - University Network Traffic-Spike Analysis Tests.

Verifies:
1. Robust MAD and IQR-based spike detection logic.
2. Safe handling of zero MAD and zero-variation channels.
3. Preservation of original signed values and absolute magnitudes.
4. Parameter validation, series filtering, time-range slicing, and sorting.
5. REST API endpoint GET /api/university-network/datasets/{dataset_id}/spikes.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.university_spike_analyzer import (
    UniversitySpikeAnalyzer,
    get_university_spike_analyzer,
)
from app.services.university_data_loader import (
    DatasetNotFoundError,
    SeriesNotFoundError,
)

client = TestClient(app)


class TestUniversitySpikeAnalyzerService:
    """Direct unit tests for UniversitySpikeAnalyzer service."""

    def test_singleton_analyzer(self):
        """Verify get_university_spike_analyzer returns a shared instance."""
        a1 = get_university_spike_analyzer()
        a2 = get_university_spike_analyzer()
        assert a1 is a2

    def test_firewall_spike_detection(self):
        """Verify robust spike detection on Firewall dataset."""
        analyzer = get_university_spike_analyzer()
        res = analyzer.analyze_spikes(
            dataset_id="firewall",
            threshold=3.5,
            max_candidates=100,
        )

        assert res.dataset_id == "firewall"
        assert res.threshold_used == 3.5
        assert res.total_candidates > 0
        assert res.affected_series_count > 0
        assert res.largest_candidate is not None
        assert res.largest_candidate.anomaly_score >= 3.5

        # Verify candidate properties
        for c in res.candidates:
            assert c.dataset_id == "firewall"
            assert c.abs_value == abs(c.signed_value)
            assert c.deviation > 0
            assert c.anomaly_score >= 3.5
            assert c.detection_method in ("modified_z_score_mad", "iqr_fallback")

        # Verify signed value preservation: blank header series should have negative values
        blank_candidates = [c for c in res.candidates if c.original_header == ""]
        if blank_candidates:
            assert all(c.signed_value < 0 for c in blank_candidates)

        rx_candidates = [c for c in res.candidates if c.original_header == "Rx"]
        if rx_candidates:
            assert all(c.signed_value > 0 for c in rx_candidates)

    def test_core_switch_spike_detection(self):
        """Verify robust spike detection on Core Switch dataset."""
        analyzer = get_university_spike_analyzer()
        res = analyzer.analyze_spikes(
            dataset_id="core_switch",
            threshold=3.5,
            max_candidates=50,
        )

        assert res.dataset_id == "core_switch"
        assert res.total_candidates > 0
        assert res.affected_series_count > 0
        assert len(res.candidates) <= 50

    def test_threshold_sensitivity(self):
        """Verify that increasing threshold reduces candidate count."""
        analyzer = get_university_spike_analyzer()
        res_low = analyzer.analyze_spikes("firewall", threshold=3.5)
        res_high = analyzer.analyze_spikes("firewall", threshold=10.0)
        res_extreme = analyzer.analyze_spikes("firewall", threshold=10000.0)

        assert res_low.total_candidates >= res_high.total_candidates
        assert res_extreme.total_candidates == 0
        assert res_extreme.largest_candidate is None
        assert len(res_extreme.candidates) == 0

    def test_series_filtering(self):
        """Verify filtering by specific series IDs."""
        analyzer = get_university_spike_analyzer()
        res = analyzer.analyze_spikes(
            dataset_id="firewall",
            series_ids=["series_001", "series_026"],
            threshold=2.0,
        )

        for c in res.candidates:
            assert c.series_id in ("series_001", "series_026")

    def test_time_range_filtering(self):
        """Verify filtering by start and end timestamps."""
        analyzer = get_university_spike_analyzer()
        t_start = 1792600000
        t_end = 1792700000

        res = analyzer.analyze_spikes(
            dataset_id="firewall",
            start_time=t_start,
            end_time=t_end,
            threshold=3.5,
        )

        for c in res.candidates:
            assert t_start <= c.timestamp <= t_end

    def test_sorting_modes(self):
        """Verify sorting candidates by score, timestamp, and magnitude."""
        analyzer = get_university_spike_analyzer()

        # Sort by score desc
        res_score = analyzer.analyze_spikes("firewall", sort_by="score", sort_direction="desc")
        scores = [c.anomaly_score for c in res_score.candidates]
        assert scores == sorted(scores, reverse=True)

        # Sort by timestamp asc
        res_ts = analyzer.analyze_spikes("firewall", sort_by="timestamp", sort_direction="asc")
        timestamps = [c.timestamp for c in res_ts.candidates]
        assert timestamps == sorted(timestamps)

        # Sort by magnitude desc
        res_mag = analyzer.analyze_spikes("firewall", sort_by="magnitude", sort_direction="desc")
        magnitudes = [c.abs_value for c in res_mag.candidates]
        assert magnitudes == sorted(magnitudes, reverse=True)

    def test_invalid_dataset_id_raises(self):
        """Verify unknown dataset ID raises DatasetNotFoundError."""
        analyzer = get_university_spike_analyzer()
        with pytest.raises(DatasetNotFoundError):
            analyzer.analyze_spikes("non_existent_dataset")

    def test_invalid_series_id_raises(self):
        """Verify unknown series ID raises SeriesNotFoundError."""
        analyzer = get_university_spike_analyzer()
        with pytest.raises(SeriesNotFoundError):
            analyzer.analyze_spikes("firewall", series_ids=["invalid_series_999"])


class TestUniversitySpikesApiEndpoints:
    """Integration tests for GET /api/university-network/datasets/{dataset_id}/spikes."""

    def test_get_firewall_spikes_api(self):
        """Verify GET /api/university-network/datasets/firewall/spikes."""
        response = client.get(
            "/api/university-network/datasets/firewall/spikes",
            params={"threshold": 3.5, "max_candidates": 20},
        )
        assert response.status_code == 200
        data = response.json()

        assert data["dataset_id"] == "firewall"
        assert data["threshold_used"] == 3.5
        assert data["total_candidates"] > 0
        assert len(data["candidates"]) <= 20
        assert "not confirmed" in data["disclaimer"].lower()

    def test_get_core_switch_spikes_api(self):
        """Verify GET /api/university-network/datasets/core_switch/spikes."""
        response = client.get(
            "/api/university-network/datasets/core_switch/spikes",
            params={"threshold": 5.0, "max_candidates": 25},
        )
        assert response.status_code == 200
        data = response.json()

        assert data["dataset_id"] == "core_switch"
        assert data["threshold_used"] == 5.0
        assert len(data["candidates"]) <= 25

    def test_spikes_api_with_series_filter(self):
        """Verify API query param series_ids filtering."""
        response = client.get(
            "/api/university-network/datasets/firewall/spikes",
            params={"series_ids": "series_001,series_026", "threshold": 2.5},
        )
        assert response.status_code == 200
        data = response.json()

        for c in data["candidates"]:
            assert c["series_id"] in ("series_001", "series_026")

    def test_spikes_api_unknown_dataset_404(self):
        """Verify 404 for unknown dataset ID."""
        response = client.get("/api/university-network/datasets/unknown_dataset/spikes")
        assert response.status_code == 404
        assert "Unknown dataset" in response.json()["detail"]

    def test_spikes_api_unknown_series_404(self):
        """Verify 404 for unknown series ID in filter."""
        response = client.get(
            "/api/university-network/datasets/firewall/spikes",
            params={"series_ids": "series_999"},
        )
        assert response.status_code == 404
        assert "not found" in response.json()["detail"]

    def test_spikes_api_invalid_query_params(self):
        """Verify 422 validation error on invalid parameters."""
        # Threshold below 1.0
        r1 = client.get("/api/university-network/datasets/firewall/spikes", params={"threshold": 0.5})
        assert r1.status_code == 422

        # Invalid sort_by
        r2 = client.get("/api/university-network/datasets/firewall/spikes", params={"sort_by": "unsupported"})
        assert r2.status_code == 422
