"""
PoissonBurst Lab - API Integration Tests.
"""

import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


class TestHealthEndpoint:
    """Test health check endpoint."""

    def test_health_check_returns_ok(self):
        response = client.get("/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "PoissonBurst Lab" in data["app_name"]
        assert "version" in data
        assert "timestamp" in data


class TestPoissonEstimateEndpoint:
    """Test /api/poisson/estimate endpoint."""

    def test_estimate_baseline_valid(self):
        payload = {
            "observations": [10.0, 12.0, 8.0, 14.0, 6.0],
            "window_seconds": 2.0,
        }
        response = client.post("/api/poisson/estimate", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["baseline_rate"] == 10.0
        assert data["observation_count"] == 5
        assert data["window_seconds"] == 2.0
        assert data["rate_per_second"] == 5.0
        assert "lambda_hat" in data["unit_explanation"]

    def test_estimate_baseline_empty_fails(self):
        payload = {"observations": []}
        response = client.post("/api/poisson/estimate", json=payload)
        assert response.status_code == 422

    def test_estimate_baseline_negative_fails(self):
        payload = {"observations": [10.0, -5.0, 12.0]}
        response = client.post("/api/poisson/estimate", json=payload)
        assert response.status_code == 422


class TestPoissonDetectEndpoint:
    """Test /api/poisson/detect endpoint."""

    def test_detect_normal_observation(self):
        payload = {
            "observed_count": 10,
            "expected_rate": 10.0,
            "alpha": 0.01,
        }
        response = client.post("/api/poisson/detect", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["is_burst"] is False
        assert data["observed_count"] == 10
        assert data["p_value"] >= 0.01

    def test_detect_burst_observation(self):
        payload = {
            "observed_count": 30,
            "expected_rate": 10.0,
            "alpha": 0.01,
        }
        response = client.post("/api/poisson/detect", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["is_burst"] is True
        assert data["observed_count"] == 30
        assert data["p_value"] < 0.01

    def test_detect_rejects_negative_count(self):
        payload = {
            "observed_count": -5,
            "expected_rate": 10.0,
            "alpha": 0.01,
        }
        response = client.post("/api/poisson/detect", json=payload)
        assert response.status_code == 422

    def test_detect_rejects_invalid_alpha(self):
        payload = {
            "observed_count": 15,
            "expected_rate": 10.0,
            "alpha": 1.5,
        }
        response = client.post("/api/poisson/detect", json=payload)
        assert response.status_code == 422


class TestBatchDetectionEndpoint:
    """Test /api/poisson/detect-batch endpoint."""

    def test_batch_detection_success(self):
        payload = {
            "observations": [10, 12, 11, 35, 9],
            "expected_rate": 10.0,
            "alpha": 0.01,
        }
        response = client.post("/api/poisson/detect-batch", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["total_observations"] == 5
        assert data["detected_bursts"] == 1
        assert data["results"][3]["is_burst"] is True


class TestSimulationEndpoint:
    """Test /api/simulation/generate endpoint."""

    def test_simulation_reproducibility(self):
        payload = {
            "scenario": "sudden_burst",
            "baseline_rate_per_second": 10.0,
            "duration_seconds": 30,
            "window_seconds": 1.0,
            "burst_start_second": 10,
            "burst_duration_seconds": 5,
            "burst_rate_per_second": 40.0,
            "alpha": 0.01,
            "random_seed": 123,
        }
        res1 = client.post("/api/simulation/generate", json=payload)
        res2 = client.post("/api/simulation/generate", json=payload)
        assert res1.status_code == 200
        assert res2.status_code == 200

        data1 = res1.json()
        data2 = res2.json()
        # Ensure counts are identical for same seed
        counts1 = [obs["count"] for obs in data1["observations"]]
        counts2 = [obs["count"] for obs in data2["observations"]]
        assert counts1 == counts2
        assert data1["detected_burst_count"] > 0
        assert data1["lambda_window"] == 10.0
        assert data1["summary"] is not None

    def test_simulation_poisson_normal_via_api(self):
        payload = {
            "scenario": "poisson_normal",
            "baseline_rate_per_second": 15.0,
            "duration_seconds": 25,
            "window_seconds": 1.0,
            "alpha": 0.01,
            "random_seed": 42,
        }
        res = client.post("/api/simulation/generate", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["scenario"] == "poisson_normal"
        assert data["total_windows"] == 25
        assert data["injected_burst_count"] == 0
        assert all(obs["ground_truth"] is False for obs in data["observations"])

    def test_simulation_rate_drift_via_api(self):
        payload = {
            "scenario": "rate_drift",
            "baseline_rate_per_second": 8.0,
            "duration_seconds": 30,
            "window_seconds": 1.0,
            "rate_drift_end_per_second": 32.0,
            "alpha": 0.01,
            "random_seed": 7,
        }
        res = client.post("/api/simulation/generate", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["scenario"] == "rate_drift"
        assert data["model_limitation_note"] is not None
        assert data["injected_burst_count"] == 0

    def test_simulation_overdispersed_via_api(self):
        payload = {
            "scenario": "overdispersed",
            "baseline_rate_per_second": 12.0,
            "duration_seconds": 30,
            "window_seconds": 1.0,
            "dispersion_factor": 3.0,
            "alpha": 0.01,
            "random_seed": 88,
        }
        res = client.post("/api/simulation/generate", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["scenario"] == "overdispersed"
        assert data["model_limitation_note"] is not None

    def test_simulation_validation_error_returns_422(self):
        # Window size exceeds duration
        payload = {
            "scenario": "poisson_normal",
            "baseline_rate_per_second": 10.0,
            "duration_seconds": 10,
            "window_seconds": 25.0,
        }
        res = client.post("/api/simulation/generate", json=payload)
        assert res.status_code == 422
        # FastAPI returns validation errors in detail list
        detail_msgs = str(res.json()["detail"])
        assert "cannot exceed total simulation duration" in detail_msgs

    def test_simulation_burst_exceeds_duration_returns_422(self):
        payload = {
            "scenario": "sudden_burst",
            "baseline_rate_per_second": 10.0,
            "duration_seconds": 20,
            "window_seconds": 1.0,
            "burst_start_second": 15,
            "burst_duration_seconds": 10,  # 15 + 10 = 25 > 20
        }
        res = client.post("/api/simulation/generate", json=payload)
        assert res.status_code == 422
        detail_msgs = str(res.json()["detail"])
        assert "exceeds simulation duration" in detail_msgs

