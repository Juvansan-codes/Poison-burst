"""
PoissonBurst Lab - Milestone 4 Persistent Experiment Storage & API Tests.

Validates experiment repository operations, API endpoints, dashboard statistics,
ground-truth preservation, pagination, CSV exports, and restart persistence.
"""

from __future__ import annotations

import os
from typing import Generator
import pytest
from fastapi.testclient import TestClient

from app.core.schemas import (
    ExperimentType,
    MeasurementType,
    SimulationRequest,
    SimulationScenario,
)
from app.main import app
from app.services.data_loader import HistoricalDataLoader
from app.services.experiment_repository import (
    ExperimentRepository,
    get_experiment_repository,
)
from app.services.traffic_simulator import run_traffic_simulation


@pytest.fixture
def temp_db(tmp_path, monkeypatch) -> Generator[str, None, None]:
    """Provide an isolated temporary SQLite database for each test."""
    db_file = str(tmp_path / "test_experiments.db")
    monkeypatch.setenv("POISSONBURST_DB_PATH", db_file)
    import app.services.experiment_repository as er
    er._default_repo = None
    yield db_file
    er._default_repo = None


@pytest.fixture
def client(temp_db) -> Generator[TestClient, None, None]:
    """TestClient configured with isolated database."""
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def sample_csv_bytes() -> bytes:
    """Generate small deterministic CSV dataset."""
    content = (
        "Flow ID,Timestamp,Total Packets,Label\n"
        "1,2026-10-23 10:00:00,10,BENIGN\n"
        "2,2026-10-23 10:00:02,15,BENIGN\n"
        "3,2026-10-23 10:00:04,12,BENIGN\n"
        "4,2026-10-23 10:00:06,14,BENIGN\n"
        "5,2026-10-23 10:00:08,120,DDoS\n"
        "6,2026-10-23 10:00:09,150,DDoS\n"
        "7,2026-10-23 10:00:11,11,BENIGN\n"
        "8,2026-10-23 10:00:13,13,BENIGN\n"
    )
    return content.encode("utf-8")


class TestExperimentRepositoryDirect:
    """Direct repository unit tests."""

    def test_save_and_retrieve_simulation(self, temp_db):
        repo = ExperimentRepository(db_path=temp_db)
        req = SimulationRequest(
            scenario=SimulationScenario.SUDDEN_BURST,
            baseline_rate_per_second=10.0,
            duration_seconds=30,
            window_seconds=2.0,
            burst_start_second=10.0,
            burst_duration_seconds=6.0,
            burst_rate_per_second=35.0,
            random_seed=42,
        )
        sim_res = run_traffic_simulation(req)
        saved_summary = repo.save_simulation_experiment(req, sim_res)

        assert saved_summary.experiment_id == sim_res.experiment_id
        assert saved_summary.experiment_type == ExperimentType.SIMULATION
        assert saved_summary.measurement_type == MeasurementType.PACKET_COUNT
        assert saved_summary.scenario == "sudden_burst"

        # Retrieve detail
        detail = repo.get_experiment(sim_res.experiment_id)
        assert detail is not None
        assert detail.experiment_id == sim_res.experiment_id
        assert len(detail.observations) == len(sim_res.observations)
        assert len(detail.detections) == len(sim_res.detections)
        assert detail.baseline_lambda == sim_res.lambda_window
        assert detail.evaluation is not None
        assert detail.evaluation.f1_score is not None

    def test_save_and_retrieve_historical(self, temp_db, sample_csv_bytes):
        repo = ExperimentRepository(db_path=temp_db)
        hist_res = HistoricalDataLoader.analyze_csv(
            content=sample_csv_bytes,
            filename="sample_ddos.csv",
            timestamp_column="Timestamp",
            label_column="Label",
            benign_label_value="BENIGN",
            window_seconds=2.0,
            alpha=0.01,
        )
        saved = repo.save_historical_experiment(
            filename="sample_ddos.csv",
            res=hist_res,
            config={"window_seconds": 2.0, "alpha": 0.01},
        )

        assert saved.experiment_type == ExperimentType.HISTORICAL
        assert saved.measurement_type == MeasurementType.FLOW_COUNT
        assert saved.dataset_name == "sample_ddos.csv"
        assert saved.ground_truth_available is True

        detail = repo.get_experiment(hist_res.experiment_id)
        assert detail is not None
        assert detail.dataset_name == "sample_ddos.csv"
        assert detail.measurement_type == MeasurementType.FLOW_COUNT

    def test_persistence_across_repository_reopen(self, temp_db):
        """Simulate backend restart by instantiating a new repository pointing to the same file."""
        repo1 = ExperimentRepository(db_path=temp_db)
        req = SimulationRequest(scenario=SimulationScenario.POISSON_NORMAL, duration_seconds=10, window_seconds=2.0)
        sim_res = run_traffic_simulation(req)
        repo1.save_simulation_experiment(req, sim_res)

        # Simulate restart
        repo2 = ExperimentRepository(db_path=temp_db)
        detail = repo2.get_experiment(sim_res.experiment_id)
        assert detail is not None
        assert detail.experiment_id == sim_res.experiment_id
        assert detail.observation_count == len(sim_res.observations)

    def test_missing_experiment_returns_none(self, temp_db):
        repo = ExperimentRepository(db_path=temp_db)
        assert repo.get_experiment("non_existent_id") is None

    def test_delete_experiment(self, temp_db):
        repo = ExperimentRepository(db_path=temp_db)
        req = SimulationRequest(scenario=SimulationScenario.POISSON_NORMAL, duration_seconds=10, window_seconds=2.0)
        sim_res = run_traffic_simulation(req)
        repo.save_simulation_experiment(req, sim_res)

        assert repo.get_experiment(sim_res.experiment_id) is not None
        assert repo.delete_experiment(sim_res.experiment_id) is True
        assert repo.get_experiment(sim_res.experiment_id) is None
        assert repo.delete_experiment(sim_res.experiment_id) is False


class TestExperimentApiEndpoints:
    """HTTP API integration tests for experiments and dashboard."""

    def test_simulation_generates_and_persists(self, client):
        payload = {
            "scenario": "sudden_burst",
            "baseline_rate_per_second": 12.0,
            "duration_seconds": 20,
            "window_seconds": 2.0,
            "burst_start_second": 6.0,
            "burst_duration_seconds": 4.0,
            "burst_rate_per_second": 36.0,
            "alpha": 0.01,
            "random_seed": 101,
        }
        res = client.post("/api/simulation/generate", json=payload)
        assert res.status_code == 200
        data = res.json()
        exp_id = data["experiment_id"]
        assert exp_id.startswith("sim-")

        # Verify experiment appears in list
        list_res = client.get("/api/experiments")
        assert list_res.status_code == 200
        items = list_res.json()["items"]
        assert any(item["experiment_id"] == exp_id for item in items)

        # Verify detail endpoint
        detail_res = client.get(f"/api/experiments/{exp_id}")
        assert detail_res.status_code == 200
        detail = detail_res.json()
        assert detail["experiment_id"] == exp_id
        assert detail["measurement_type"] == "packet_count"
        assert len(detail["observations"]) == data["total_windows"]

    def test_historical_analysis_generates_and_persists(self, client, sample_csv_bytes):
        files = {"file": ("test_traffic.csv", sample_csv_bytes, "text/csv")}
        data = {
            "timestamp_column": "Timestamp",
            "label_column": "Label",
            "benign_label_value": "BENIGN",
            "window_seconds": "2.0",
            "baseline_mode": "ratio",
            "baseline_ratio": "0.4",
            "alpha": "0.01",
        }
        res = client.post("/api/historical/analyze", files=files, data=data)
        assert res.status_code == 200
        result = res.json()
        exp_id = result["experiment_id"]
        assert exp_id.startswith("hist-")

        # Retrieve experiment detail
        detail_res = client.get(f"/api/experiments/{exp_id}")
        assert detail_res.status_code == 200
        detail = detail_res.json()
        assert detail["experiment_type"] == "historical"
        assert detail["measurement_type"] == "flow_count"
        assert detail["dataset_name"] == "test_traffic.csv"

    def test_preview_endpoint_does_not_persist_experiment(self, client, sample_csv_bytes):
        """Preview must NOT create a completed experiment."""
        files = {"file": ("preview_only.csv", sample_csv_bytes, "text/csv")}
        res = client.post("/api/historical/preview", files=files)
        assert res.status_code == 200

        # Verify database remains empty
        list_res = client.get("/api/experiments")
        assert list_res.json()["total"] == 0

    def test_failed_simulation_does_not_persist_experiment(self, client):
        """Invalid requests that fail validation must not create experiment records."""
        bad_payload = {
            "scenario": "sudden_burst",
            "baseline_rate_per_second": -5.0,  # invalid negative
            "duration_seconds": 20,
            "window_seconds": 2.0,
        }
        res = client.post("/api/simulation/generate", json=bad_payload)
        assert res.status_code in (400, 422)

        list_res = client.get("/api/experiments")
        assert list_res.json()["total"] == 0

    def test_experiment_filtering_and_pagination(self, client, sample_csv_bytes):
        # Create 2 simulations
        for seed in [1, 2]:
            client.post("/api/simulation/generate", json={
                "scenario": "poisson_normal",
                "duration_seconds": 10,
                "window_seconds": 2.0,
                "random_seed": seed,
            })

        # Create 1 historical
        files = {"file": ("history_data.csv", sample_csv_bytes, "text/csv")}
        client.post("/api/historical/analyze", files=files, data={
            "timestamp_column": "Timestamp",
            "window_seconds": "2.0",
        })

        # Total should be 3
        all_res = client.get("/api/experiments")
        assert all_res.json()["total"] == 3

        # Filter by type: simulation
        sim_res = client.get("/api/experiments?type=simulation")
        assert sim_res.json()["total"] == 2
        for item in sim_res.json()["items"]:
            assert item["experiment_type"] == "simulation"

        # Filter by type: historical
        hist_res = client.get("/api/experiments?type=historical")
        assert hist_res.json()["total"] == 1
        assert hist_res.json()["items"][0]["experiment_type"] == "historical"

        # Pagination: page_size=2
        p1 = client.get("/api/experiments?page=1&page_size=2")
        assert len(p1.json()["items"]) == 2
        p2 = client.get("/api/experiments?page=2&page_size=2")
        assert len(p2.json()["items"]) == 1

        # Search
        search_res = client.get("/api/experiments?search=history_data")
        assert search_res.json()["total"] == 1

    def test_dashboard_summary_aggregates(self, client, sample_csv_bytes):
        # Empty state
        empty_sum = client.get("/api/dashboard/summary").json()
        assert empty_sum["total_experiments"] == 0
        assert empty_sum["simulation_experiments_count"] == 0
        assert empty_sum["historical_experiments_count"] == 0
        assert empty_sum["latest_experiment"] is None
        assert empty_sum["latest_detected_count"] is None

        # Add simulation
        client.post("/api/simulation/generate", json={
            "scenario": "sudden_burst",
            "duration_seconds": 10,
            "window_seconds": 1.0,
            "burst_start_second": 2.0,
            "burst_duration_seconds": 2.0,
            "random_seed": 7,
        })

        # Add historical
        files = {"file": ("network_flows.csv", sample_csv_bytes, "text/csv")}
        client.post("/api/historical/analyze", files=files, data={
            "timestamp_column": "Timestamp",
            "window_seconds": "2.0",
        })

        summary = client.get("/api/dashboard/summary").json()
        assert summary["total_experiments"] == 2
        assert summary["simulation_experiments_count"] == 1
        assert summary["historical_experiments_count"] == 1
        assert "flow_count" in summary["available_measurement_types"]
        assert "packet_count" in summary["available_measurement_types"]
        assert summary["latest_experiment"] is not None
        assert summary["latest_detected_count"] is not None

    def test_csv_export(self, client):
        res = client.post("/api/simulation/generate", json={
            "scenario": "poisson_normal",
            "duration_seconds": 10,
            "window_seconds": 2.0,
            "random_seed": 42,
        })
        exp_id = res.json()["experiment_id"]

        export_res = client.get(f"/api/experiments/{exp_id}/export")
        assert export_res.status_code == 200
        assert "text/csv" in export_res.headers["content-type"]
        text = export_res.text
        assert "# PoissonBurst Lab Experiment Export" in text
        assert "timestamp,time_seconds,observed_count" in text
        assert exp_id in text

    def test_delete_experiment_api(self, client):
        res = client.post("/api/simulation/generate", json={
            "scenario": "poisson_normal",
            "duration_seconds": 10,
            "window_seconds": 2.0,
            "random_seed": 42,
        })
        exp_id = res.json()["experiment_id"]

        del_res = client.delete(f"/api/experiments/{exp_id}")
        assert del_res.status_code == 200
        assert del_res.json()["status"] == "deleted"

        # Second delete returns 404
        del_res2 = client.delete(f"/api/experiments/{exp_id}")
        assert del_res2.status_code == 404

    def test_missing_experiment_returns_404(self, client):
        res = client.get("/api/experiments/unknown-experiment-id")
        assert res.status_code == 404
