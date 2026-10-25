"""
PoissonBurst Lab - Phase 7.1 Hardware E2E Data Reconciliation & Persistence Integrity Tests.

Verifies:
1. Complete 14-item reconciliation ledger across socket, receiver, processor, and database.
2. Explicit accounting invariants:
   - Socket: total_socket == valid + malformed
   - Validation & Deduplication: valid == unique + duplicates
   - Window Assignment: unique == completed_window_arrivals + partial_window_arrivals + excluded
   - Persistence: sum(obs.count) == completed_window_arrivals
   - Partition: observations == calibration_obs + monitoring_obs
   - Per-node: window.aggregate_count == sum(window.node_counts.values())
   - Calibration baseline: baseline_lambda == sum(eligible_calib) / len(eligible_calib)
   - Statistics: empirical_mean == sum(obs.count) / len(obs)
   - CI provenance: point_estimate == baseline_lambda on eligible calibration sample
3. Exact reproduction and mathematical explanation of the Phase 7 discrepancy (88 vs 55).
4. Partial-window isolation and non-contamination of completed observation series.
5. Ineligible calibration window exclusion from baseline and CI inference.
6. Database restart survival and report integrity (PDF/CSV datagram units).
"""

from __future__ import annotations

import json
import socket
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Generator, List, Optional

import pytest
from fastapi.testclient import TestClient

from app.core.hardware_schemas import HardwareStartRequest, HardwareStopResponse
from app.core.schemas import ExperimentType, MeasurementType, TrafficSource
from app.main import app
from app.services.experiment_repository import (
    ExperimentRepository,
    get_experiment_repository,
)
from app.services.hardware_receiver import HardwareReceiver, TelemetryPacket
from app.services.hardware_session_manager import (
    HardwareSessionManager,
    get_hardware_session_manager,
)
from app.services.hardware_simulator import (
    HardwareSimulator,
    SimulatedNodeConfig,
)
from app.services.hardware_window_processor import (
    AggregatedWindow,
    DetectionStatus,
    HardwareWindowProcessor,
    HardwareWindowProcessorConfig,
    ProcessorState,
    WindowQuality,
)
from app.services.statistical_analysis import compute_experiment_statistics


@dataclass
class ReconciliationLedger:
    """14-item authoritative reconciliation ledger required by Section 3."""
    total_socket_datagrams: int = 0
    valid_protocol_datagrams: int = 0
    unique_accepted_telemetry_events: int = 0
    malformed_rejected_datagrams: int = 0
    duplicate_or_reordered_datagrams: int = 0
    sequence_gaps_count: int = 0
    total_lost_packets_estimate: int = 0
    complete_observation_window_datagrams: int = 0
    partial_final_window_datagrams: int = 0
    explicitly_excluded_unique_events: int = 0
    total_finalized_processor_window_counts: int = 0
    persisted_observation_count_sum: int = 0
    calibration_observation_count: int = 0
    calibration_observation_sum: int = 0
    monitoring_observation_count: int = 0
    monitoring_observation_sum: int = 0
    statistical_analysis_sample_size: int = 0
    statistical_analysis_sample_sum: int = 0
    statistical_analysis_empirical_mean: float = 0.0
    calibration_ci_sample_size: int = 0
    calibration_ci_sample_sum: int = 0
    calibration_ci_point_estimate: float = 0.0

    def verify_invariants(self, allow_partial: bool = True) -> None:
        """Assert the mathematical accounting invariants required by Section 4."""
        # Invariant 1: Socket Level
        assert self.total_socket_datagrams == (
            self.valid_protocol_datagrams + self.malformed_rejected_datagrams
        ), "Invariant 1 Failed: total_socket != valid + malformed"

        # Invariant 2: Validation & Deduplication
        assert self.valid_protocol_datagrams == (
            self.unique_accepted_telemetry_events + self.duplicate_or_reordered_datagrams
        ), "Invariant 2 Failed: valid != unique + duplicates"

        # Invariant 3: Unique Datagram Window Assignment
        expected_unique = (
            self.complete_observation_window_datagrams
            + self.partial_final_window_datagrams
            + self.explicitly_excluded_unique_events
        )
        assert self.unique_accepted_telemetry_events == expected_unique, (
            f"Invariant 3 Failed: unique ({self.unique_accepted_telemetry_events}) != "
            f"complete ({self.complete_observation_window_datagrams}) + "
            f"partial ({self.partial_final_window_datagrams}) + "
            f"excluded ({self.explicitly_excluded_unique_events})"
        )

        # Invariant 4: Persistence Accounting
        assert self.total_finalized_processor_window_counts == self.complete_observation_window_datagrams
        assert self.persisted_observation_count_sum == self.complete_observation_window_datagrams, (
            f"Invariant 4 Failed: persisted sum ({self.persisted_observation_count_sum}) != "
            f"complete window sum ({self.complete_observation_window_datagrams})"
        )

        # Invariant 5: Observation Partition
        assert self.persisted_observation_count_sum == (
            self.calibration_observation_sum + self.monitoring_observation_sum
        ), "Invariant 5 Failed: persisted sum != calibration sum + monitoring sum"

        # Invariant 6: Statistical Analysis Sample
        assert self.statistical_analysis_sample_size == (
            self.calibration_observation_count + self.monitoring_observation_count
        )
        assert self.statistical_analysis_sample_sum == self.persisted_observation_count_sum

        if self.statistical_analysis_sample_size > 0:
            expected_mean = self.statistical_analysis_sample_sum / self.statistical_analysis_sample_size
            assert abs(self.statistical_analysis_empirical_mean - expected_mean) < 1e-4

        # Invariant 7: Calibration Baseline Provenance
        if self.calibration_ci_sample_size > 0:
            expected_base = self.calibration_ci_sample_sum / self.calibration_ci_sample_size
            assert abs(self.calibration_ci_point_estimate - expected_base) < 1e-4


@pytest.fixture
def temp_db(tmp_path, monkeypatch) -> Generator[str, None, None]:
    """Isolated temporary SQLite database for each test."""
    db_file = str(tmp_path / "test_reconciliation.db")
    monkeypatch.setenv("POISSONBURST_DB_PATH", db_file)
    import app.services.experiment_repository as er
    er._default_repo = None
    yield db_file
    er._default_repo = None


@pytest.fixture
def test_client(temp_db) -> Generator[TestClient, None, None]:
    """Clean TestClient with isolated DB and reset hardware session manager."""
    manager = get_hardware_session_manager()
    manager.shutdown()
    with TestClient(app) as client:
        yield client
    manager.shutdown()


def send_raw_udp(host: str, port: int, data: bytes) -> None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.sendto(data, (host, port))
    finally:
        sock.close()


class TestHardwareAccountingInvariants:
    """Rigorous audit of the hardware data pipeline accounting invariants."""

    def test_clean_pipeline_full_reconciliation(self, test_client: TestClient, temp_db: str) -> None:
        """Case A: Clean end-to-end pipeline with advancing sequence numbers.
        Proves that without duplicates, total_valid == unique == complete + partial.
        """
        # 1. Start hardware session
        start_res = test_client.post(
            "/api/hardware/start",
            json={
                "bind_host": "127.0.0.1",
                "bind_port": 0,
                "window_seconds": 0.5,
                "alpha": 0.01,
                "expected_nodes": ["node_1", "node_2", "node_3", "node_4"],
                "min_calibration_windows": 3,
                "stale_timeout_seconds": 5.0,
                "require_all_nodes": True,
            },
        )
        assert start_res.status_code == 200
        start_data = start_res.json()
        port = start_data["bind_port"]
        session_id = start_data["session_id"]

        # 2. Transmit calibration traffic (4 nodes, 5 Hz each, duration 2.0s)
        sim_cal = HardwareSimulator(
            destination_host="127.0.0.1",
            destination_port=port,
            duration_seconds=2.0,
        )
        sim_cal.start()
        time.sleep(1.8)
        sim_cal.stop()
        time.sleep(0.6)  # allow window to tumble

        # Finalize calibration
        fin_res = test_client.post("/api/hardware/calibration/finalize")
        assert fin_res.status_code == 200
        fin_data = fin_res.json()
        assert fin_data["state"] == "MONITORING"
        baseline_lambda = fin_data["expected_count_per_window"]
        eligible_calib_windows = fin_data["eligible_windows_count"]

        # 3. Transmit monitoring traffic continuing sequence numbers
        sim_mon = HardwareSimulator(
            destination_host="127.0.0.1",
            destination_port=port,
            duration_seconds=1.5,
            initial_sequences=sim_cal.get_last_sequences(),
        )
        sim_mon.start()
        time.sleep(1.2)
        sim_mon.stop()
        time.sleep(0.6)

        # 4. Stop session
        stop_res = test_client.post("/api/hardware/stop")
        assert stop_res.status_code == 200
        stop_data = stop_res.json()
        assert stop_data["clean_shutdown"] is True
        assert stop_data["persisted"] is True

        # 5. Extract database record and compute ledger
        repo = get_experiment_repository(temp_db)
        exp = repo.get_experiment(session_id)
        assert exp is not None

        mgr = get_hardware_session_manager()
        stopped_data = mgr._stopped_sessions[session_id]
        rec_status = stopped_data["rec_status"]
        proc_status = stopped_data["proc_status"]
        pw_info = proc_status.get("partial_window") or {}
        pw_datagrams = pw_info.get("aggregate_count", 0)

        calib_obs = [o for o in exp.observations if o.is_calibration]
        mon_obs = [o for o in exp.observations if not o.is_calibration]

        stats_res = test_client.get(f"/api/experiments/{session_id}/statistics")
        assert stats_res.status_code == 200
        stats_data = stats_res.json()

        ci_data = stats_data["confidence_interval"]

        ledger = ReconciliationLedger(
            total_socket_datagrams=rec_status["total_socket_datagrams"],
            valid_protocol_datagrams=rec_status["valid_datagrams"],
            unique_accepted_telemetry_events=rec_status["unique_datagrams"],
            malformed_rejected_datagrams=rec_status["malformed_datagrams"],
            duplicate_or_reordered_datagrams=sum(
                n["duplicate_or_reordered_count"] for n in rec_status["nodes"].values()
            ),
            sequence_gaps_count=sum(n["sequence_gaps_count"] for n in rec_status["nodes"].values()),
            total_lost_packets_estimate=sum(
                n["total_lost_packets_estimate"] for n in rec_status["nodes"].values()
            ),
            complete_observation_window_datagrams=proc_status["total_observed_arrivals"],
            partial_final_window_datagrams=pw_datagrams,
            explicitly_excluded_unique_events=0,
            total_finalized_processor_window_counts=sum(w.aggregate_count for w in stopped_data["windows"]),
            persisted_observation_count_sum=sum(o.count for o in exp.observations),
            calibration_observation_count=len(calib_obs),
            calibration_observation_sum=sum(o.count for o in calib_obs),
            monitoring_observation_count=len(mon_obs),
            monitoring_observation_sum=sum(o.count for o in mon_obs),
            statistical_analysis_sample_size=stats_data["observation_count"],
            statistical_analysis_sample_sum=sum(o.count for o in exp.observations),
            statistical_analysis_empirical_mean=stats_data["empirical_mean"],
            calibration_ci_sample_size=ci_data["sample_size"],
            calibration_ci_sample_sum=ci_data["total_arrivals"],
            calibration_ci_point_estimate=ci_data["point_estimate"],
        )

        # Verify all accounting invariants
        ledger.verify_invariants()
        assert ledger.duplicate_or_reordered_datagrams == 0
        assert ledger.valid_protocol_datagrams == ledger.unique_accepted_telemetry_events
        assert ledger.calibration_ci_point_estimate == pytest.approx(baseline_lambda, abs=1e-4)

    def test_deterministic_reproduction_88_52_36_33_55(
        self, test_client: TestClient, temp_db: str
    ) -> None:
        """Case B1: Deterministic reproduction of the original Phase 7 sequence-reset scenario.

        Exact target metrics:
        - 52 calibration datagrams (all unique, across 7 windows => baseline lambda = 7.4286)
        - 36 monitoring datagrams (all 4 nodes restart sequence from 1)
        - Exactly 33 monitoring datagrams classified as duplicates (seq <= prev_seq)
        - Exactly 3 monitoring datagrams advance accepted unique sequence
        - Total valid = 52 + 36 = 88
        - Total duplicates = 33
        - Total unique = 88 - 33 = 55
        - Persisted observations across 12 windows = 55
        - Empirical mean = 55 / 12 = 4.5833
        """
        start_res = test_client.post(
            "/api/hardware/start",
            json={
                "bind_host": "127.0.0.1",
                "bind_port": 0,
                "window_seconds": 0.5,
                "min_calibration_windows": 4,
                "expected_nodes": ["node_1", "node_2", "node_3", "node_4"],
                "require_all_nodes": False,
            },
        )
        port = start_res.json()["bind_port"]
        session_id = start_res.json()["session_id"]

        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        t0 = time.monotonic()
        uptime = 100

        # Calibration: 52 datagrams across 7 windows
        # node_1: 10 pkts (seq 1..10), node_2: 10 pkts (seq 1..10)
        # node_3: 16 pkts (seq 1..16), node_4: 16 pkts (seq 1..16)
        calib_groups = [
            # Win 0: 8 pkts
            [("node_1", 1), ("node_2", 1), ("node_3", 1), ("node_4", 1),
             ("node_1", 2), ("node_2", 2), ("node_3", 2), ("node_4", 2)],
            # Win 1: 8 pkts
            [("node_1", 3), ("node_2", 3), ("node_3", 3), ("node_4", 3),
             ("node_1", 4), ("node_2", 4), ("node_3", 4), ("node_4", 4)],
            # Win 2: 8 pkts
            [("node_1", 5), ("node_2", 5), ("node_3", 5), ("node_4", 5),
             ("node_1", 6), ("node_2", 6), ("node_3", 6), ("node_4", 6)],
            # Win 3: 8 pkts
            [("node_1", 7), ("node_2", 7), ("node_3", 7), ("node_4", 7),
             ("node_1", 8), ("node_2", 8), ("node_3", 8), ("node_4", 8)],
            # Win 4: 8 pkts
            [("node_1", 9), ("node_2", 9), ("node_3", 9), ("node_4", 9),
             ("node_1", 10), ("node_2", 10), ("node_3", 10), ("node_4", 10)],
            # Win 5: 6 pkts
            [("node_3", 11), ("node_4", 11), ("node_3", 12), ("node_4", 12),
             ("node_3", 13), ("node_4", 13)],
            # Win 6: 6 pkts
            [("node_3", 14), ("node_4", 14), ("node_3", 15), ("node_4", 15),
             ("node_3", 16), ("node_4", 16)],
        ]

        total_cal_sent = 0
        for idx, g in enumerate(calib_groups):
            for nid, seq in g:
                send_raw_udp(
                    "127.0.0.1", port,
                    json.dumps({"version": 1, "node_id": nid, "seq": seq, "uptime_ms": uptime, "mode": "normal"}).encode("utf-8")
                )
                uptime += 10
                total_cal_sent += 1
            target_t = t0 + (idx + 1) * 0.5
            sleep_dur = target_t - time.monotonic()
            if sleep_dur > 0:
                time.sleep(sleep_dur)

        # Seal exactly 7 windows (T=3.55s, between 3.5s and 4.0s)
        cal_target = t0 + 3.55
        sleep_cal = cal_target - time.monotonic()
        if sleep_cal > 0:
            time.sleep(sleep_cal)

        cal_res = test_client.post("/api/hardware/calibration/finalize").json()
        assert cal_res["eligible_windows_count"] == 7
        assert abs(cal_res["expected_count_per_window"] - 52 / 7) < 1e-4

        # Monitoring: 36 datagrams across 5 windows (Windows 7..11)
        # Sequence reset to 1 on all nodes:
        # node_1 (prev=10): seq 1..11 (10 dup, 1 unique)
        # node_2 (prev=10): seq 1..11 (10 dup, 1 unique)
        # node_3 (prev=16): seq 1..7 (7 dup, 0 unique)
        # node_4 (prev=16): seq 1..6, 17 (6 dup, 1 unique)
        # Totals: 10 + 10 + 7 + 6 = 33 duplicates; 1 + 1 + 0 + 1 = 3 unique.
        mon_groups = [
            # Win 7: 8 pkts (all duplicates)
            [("node_1", 1), ("node_2", 1), ("node_3", 1), ("node_4", 1),
             ("node_1", 2), ("node_2", 2), ("node_3", 2), ("node_4", 2)],
            # Win 8: 8 pkts (all duplicates)
            [("node_1", 3), ("node_2", 3), ("node_3", 3), ("node_4", 3),
             ("node_1", 4), ("node_2", 4), ("node_3", 4), ("node_4", 4)],
            # Win 9: 8 pkts (all duplicates)
            [("node_1", 5), ("node_2", 5), ("node_3", 5), ("node_4", 5),
             ("node_1", 6), ("node_2", 6), ("node_3", 6), ("node_4", 6)],
            # Win 10: 8 pkts (5 duplicates, 3 UNIQUE!)
            [("node_1", 7), ("node_2", 7), ("node_3", 7),
             ("node_1", 8), ("node_2", 8),
             ("node_1", 11), ("node_2", 11), ("node_4", 17)],
            # Win 11: 4 pkts (remaining duplicates)
            [("node_1", 9), ("node_2", 9), ("node_1", 10), ("node_2", 10)],
        ]

        total_mon_sent = 0
        for idx, g in enumerate(mon_groups):
            for nid, seq in g:
                send_raw_udp(
                    "127.0.0.1", port,
                    json.dumps({"version": 1, "node_id": nid, "seq": seq, "uptime_ms": uptime, "mode": "normal"}).encode("utf-8")
                )
                uptime += 10
                total_mon_sent += 1
            target_t = t0 + (7 + idx) * 0.5 + 0.35
            sleep_dur = target_t - time.monotonic()
            if sleep_dur > 0:
                time.sleep(sleep_dur)

        # Seal exactly 12 windows (T=6.10s, strictly between 6.0s and 6.5s)
        stop_target = t0 + 6.10
        sleep_stop = stop_target - time.monotonic()
        if sleep_stop > 0:
            time.sleep(sleep_stop)

        sock.close()

        # Stop session
        stop_data = test_client.post("/api/hardware/stop").json()
        assert stop_data["clean_shutdown"] is True
        assert stop_data["persisted"] is True

        repo = get_experiment_repository(temp_db)
        exp = repo.get_experiment(session_id)
        assert exp is not None

        stats_data = test_client.get(f"/api/experiments/{session_id}/statistics").json()

        # EXACT METRIC ASSERTIONS REQUIRED BY SECTION 2:
        # Fixture validation per-node sent counts:
        cal_counts = {}
        for g in calib_groups:
            for nid, _ in g:
                cal_counts[nid] = cal_counts.get(nid, 0) + 1
        assert cal_counts == {"node_1": 10, "node_2": 10, "node_3": 16, "node_4": 16}

        mon_counts = {}
        for g in mon_groups:
            for nid, _ in g:
                mon_counts[nid] = mon_counts.get(nid, 0) + 1
        assert mon_counts == {"node_1": 11, "node_2": 11, "node_3": 7, "node_4": 7}

        assert total_cal_sent == 52, f"Expected 52 calibration pkts, got {total_cal_sent}"
        assert total_mon_sent == 36, f"Expected 36 monitoring pkts, got {total_mon_sent}"
        assert stop_data["total_valid_datagrams"] == 88, f"Expected 88 valid, got {stop_data['total_valid_datagrams']}"
        assert stop_data["duplicate_datagrams"] == 33, f"Expected 33 duplicates, got {stop_data['duplicate_datagrams']}"
        assert stop_data["unique_datagrams"] == 55, f"Expected 55 unique, got {stop_data['unique_datagrams']}"
        assert stop_data["completed_windows_count"] == 12, f"Expected 12 completed windows, got {stop_data['completed_windows_count']}"
        assert stop_data["node_counts"] == {
            "node_1": 21,
            "node_2": 21,
            "node_3": 23,
            "node_4": 23,
        }
        assert len(exp.observations) == 12
        assert sum(o.count for o in exp.observations) == 55
        # All-session mean: sum of all 12 windows (calibration + monitoring) / 12
        assert abs(stats_data["empirical_mean"] - 55 / 12) < 1e-4
        assert abs(stats_data["confidence_interval"]["point_estimate"] - 52 / 7) < 1e-4
        # Phase-specific means (Phase 7.3):
        # Calibration mean: 52 arrivals across 7 calibration windows = 7.4286
        assert abs(stats_data["calibration_empirical_mean"] - 52 / 7) < 1e-4
        # Monitoring mean: 3 unique arrivals across 5 monitoring windows = 0.6000
        assert abs(stats_data["monitoring_empirical_mean"] - 3 / 5) < 1e-4
        assert stats_data["monitoring_window_count"] == 5
        # Data quality warning because 33 datagrams were deduplicated
        assert stats_data["data_quality_warning"] is not None
        assert "Sequence filtering rejected 33 of 88 valid datagrams" in stats_data["data_quality_warning"]

        # Phase 7.4: Check CSV export and PDF export consistency
        csv_res = test_client.get(f"/api/experiments/{session_id}/export")
        assert csv_res.status_code == 200
        assert "# All-Session Empirical Mean: 4.5833" in csv_res.text
        assert "# Calibration Phase Empirical Mean: 7.4286" in csv_res.text
        assert "# Monitoring Phase Empirical Mean (Accepted Arrivals): 0.6000" in csv_res.text
        assert "# Data Quality Warning: Sequence filtering rejected 33 of 88 valid datagrams." in csv_res.text

        pdf_res = test_client.get(f"/api/experiments/{session_id}/report.pdf")
        assert pdf_res.status_code == 200
        assert pdf_res.content.startswith(b"%PDF")


    def test_reconcile_98_43_investigation_scenario(
        self, test_client: TestClient, temp_db: str
    ) -> None:
        """Case B2: Reconciles the 98 valid / 43 duplicates entry from the investigation run.

        Proves that:
        - Exactly 52 calibration packets established the baseline (52 unique) across 7 windows.
        - Exactly 46 monitoring packets were sent (10 more than the 36-packet scenario) across 5 windows.
        - Because all 10 additional packets had sequence numbers <= prev_seq, exactly 10
          more packets were classified as duplicates (33 + 10 = 43 duplicates).
        - Unique accepted arrivals remained strictly at 55 (52 + 3 = 55).
        - Total valid = 52 + 46 = 98 (88 + 10 = 98).
        - Accounting invariant strictly holds: 98 == 55 + 43.
        - Calibration empirical mean = 52 / 7 = 7.4286.
        - Monitoring empirical mean = 3 / 5 = 0.6000.
        - All-session empirical mean = 55 / 12 = 4.5833.
        """
        start_res = test_client.post(
            "/api/hardware/start",
            json={
                "bind_host": "127.0.0.1",
                "bind_port": 0,
                "window_seconds": 0.5,
                "min_calibration_windows": 4,
                "expected_nodes": ["node_1", "node_2", "node_3", "node_4"],
                "require_all_nodes": False,
            },
        )
        port = start_res.json()["bind_port"]
        session_id = start_res.json()["session_id"]

        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        t0 = time.monotonic()
        uptime = 100

        # Calibration: 52 datagrams across 7 windows
        calib_groups = [
            [("node_1", 1), ("node_2", 1), ("node_3", 1), ("node_4", 1),
             ("node_1", 2), ("node_2", 2), ("node_3", 2), ("node_4", 2)],
            [("node_1", 3), ("node_2", 3), ("node_3", 3), ("node_4", 3),
             ("node_1", 4), ("node_2", 4), ("node_3", 4), ("node_4", 4)],
            [("node_1", 5), ("node_2", 5), ("node_3", 5), ("node_4", 5),
             ("node_1", 6), ("node_2", 6), ("node_3", 6), ("node_4", 6)],
            [("node_1", 7), ("node_2", 7), ("node_3", 7), ("node_4", 7),
             ("node_1", 8), ("node_2", 8), ("node_3", 8), ("node_4", 8)],
            [("node_1", 9), ("node_2", 9), ("node_3", 9), ("node_4", 9),
             ("node_1", 10), ("node_2", 10), ("node_3", 10), ("node_4", 10)],
            [("node_3", 11), ("node_4", 11), ("node_3", 12), ("node_4", 12),
             ("node_3", 13), ("node_4", 13)],
            [("node_3", 14), ("node_4", 14), ("node_3", 15), ("node_4", 15),
             ("node_3", 16), ("node_4", 16)],
        ]

        total_cal_sent = 0
        for idx, g in enumerate(calib_groups):
            for nid, seq in g:
                send_raw_udp(
                    "127.0.0.1", port,
                    json.dumps({"version": 1, "node_id": nid, "seq": seq, "uptime_ms": uptime, "mode": "normal"}).encode("utf-8")
                )
                uptime += 10
                total_cal_sent += 1
            target_t = t0 + (idx + 1) * 0.5
            sleep_dur = target_t - time.monotonic()
            if sleep_dur > 0:
                time.sleep(sleep_dur)

        # Seal 7 calibration windows
        cal_target = t0 + 3.55
        sleep_cal = cal_target - time.monotonic()
        if sleep_cal > 0:
            time.sleep(sleep_cal)

        test_client.post("/api/hardware/calibration/finalize")

        # Monitoring: exactly 46 packets (36 original + 10 additional duplicates)
        # Original 36 pkts:
        # node_1: seq 1..11 (10 dup, 1 unique)
        # node_2: seq 1..11 (10 dup, 1 unique)
        # node_3: seq 1..7 (7 dup, 0 unique)
        # node_4: seq 1..6, 17 (6 dup, 1 unique)
        # Additional 10 duplicate pkts (all seq <= prev_seq):
        # node_3: seq 8..12 (5 additional duplicates, 8..12 <= 16)
        # node_4: seq 7..11 (5 additional duplicates, 7..11 <= 16)
        mon_groups = [
            # Win 7: 8 pkts (all duplicates)
            [("node_1", 1), ("node_2", 1), ("node_3", 1), ("node_4", 1),
             ("node_1", 2), ("node_2", 2), ("node_3", 2), ("node_4", 2)],
            # Win 8: 8 pkts (all duplicates)
            [("node_1", 3), ("node_2", 3), ("node_3", 3), ("node_4", 3),
             ("node_1", 4), ("node_2", 4), ("node_3", 4), ("node_4", 4)],
            # Win 9: 8 pkts (all duplicates)
            [("node_1", 5), ("node_2", 5), ("node_3", 5), ("node_4", 5),
             ("node_1", 6), ("node_2", 6), ("node_3", 6), ("node_4", 6)],
            # Win 10: 8 pkts (5 duplicates, 3 UNIQUE!)
            [("node_1", 7), ("node_2", 7), ("node_3", 7),
             ("node_1", 8), ("node_2", 8),
             ("node_1", 11), ("node_2", 11), ("node_4", 17)],
            # Win 11: 14 pkts (4 original duplicates + 10 extra duplicates)
            [("node_1", 9), ("node_2", 9), ("node_1", 10), ("node_2", 10),
             ("node_3", 8), ("node_3", 9), ("node_3", 10), ("node_3", 11), ("node_3", 12),
             ("node_4", 7), ("node_4", 8), ("node_4", 9), ("node_4", 10), ("node_4", 11)],
        ]

        total_mon_sent = 0
        for idx, g in enumerate(mon_groups):
            for nid, seq in g:
                send_raw_udp(
                    "127.0.0.1", port,
                    json.dumps({"version": 1, "node_id": nid, "seq": seq, "uptime_ms": uptime, "mode": "normal"}).encode("utf-8")
                )
                uptime += 10
                total_mon_sent += 1
            target_t = t0 + (7 + idx) * 0.5 + 0.35
            sleep_dur = target_t - time.monotonic()
            if sleep_dur > 0:
                time.sleep(sleep_dur)

        # Seal 12 windows
        stop_target = t0 + 6.10
        sleep_stop = stop_target - time.monotonic()
        if sleep_stop > 0:
            time.sleep(sleep_stop)

        sock.close()
        stop_data = test_client.post("/api/hardware/stop").json()

        # RECONCILIATION PROOF FOR 98/43 ENTRY:
        assert total_cal_sent == 52
        assert total_mon_sent == 46
        assert stop_data["total_valid_datagrams"] == 98, f"Expected 98 valid, got {stop_data['total_valid_datagrams']}"
        assert stop_data["duplicate_datagrams"] == 43, f"Expected 43 duplicates, got {stop_data['duplicate_datagrams']}"
        assert stop_data["unique_datagrams"] == 55, f"Expected 55 unique, got {stop_data['unique_datagrams']}"
        assert stop_data["total_valid_datagrams"] == stop_data["unique_datagrams"] + stop_data["duplicate_datagrams"]
        assert stop_data["completed_windows_count"] == 12
        assert stop_data["node_counts"] == {
            "node_1": 21,
            "node_2": 21,
            "node_3": 28,
            "node_4": 28,
        }

        stats_data = test_client.get(f"/api/experiments/{session_id}/statistics").json()
        assert abs(stats_data["empirical_mean"] - 55 / 12) < 1e-4
        assert abs(stats_data["calibration_empirical_mean"] - 52 / 7) < 1e-4
        assert abs(stats_data["monitoring_empirical_mean"] - 3 / 5) < 1e-4
        assert stats_data["monitoring_window_count"] == 5
        # Data quality warning because 43 datagrams were deduplicated
        assert stats_data["data_quality_warning"] is not None
        assert "Sequence filtering rejected 43 of 98 valid datagrams" in stats_data["data_quality_warning"]

    def test_deterministic_sequence_continuation_88_0_88_mean_7_2(
        self, test_client: TestClient, temp_db: str
    ) -> None:
        """Case B4: Deterministic sequence continuation scenario (88 valid, 0 duplicates, 88 unique).

        Proves that:
        - Exactly 52 calibration packets established the baseline (52 unique) across 7 windows (mean = 52/7 = 7.4286).
        - Exactly 36 monitoring packets with monotonically continuing sequence numbers are sent across 5 windows.
        - Because all 36 sequence numbers exceed previous high-water marks (10, 10, 16, 16),
          exactly 0 duplicates are produced and all 36 are accepted as unique arrivals.
        - Monitoring empirical mean = 36 / 5 = 7.2000 arrivals/window.
        - All-session empirical mean = (52 + 36) / 12 = 88 / 12 = 7.3333 arrivals/window.
        - Total valid = 88, unique = 88, duplicates = 0.
        """
        start_res = test_client.post(
            "/api/hardware/start",
            json={
                "bind_host": "127.0.0.1",
                "bind_port": 0,
                "window_seconds": 0.5,
                "min_calibration_windows": 4,
                "expected_nodes": ["node_1", "node_2", "node_3", "node_4"],
                "require_all_nodes": False,
            },
        )
        port = start_res.json()["bind_port"]
        session_id = start_res.json()["session_id"]

        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        t0 = time.monotonic()
        uptime = 100

        # Calibration: 52 datagrams across 7 windows (high water marks: node_1=10, node_2=10, node_3=16, node_4=16)
        calib_groups = [
            [("node_1", 1), ("node_2", 1), ("node_3", 1), ("node_4", 1),
             ("node_1", 2), ("node_2", 2), ("node_3", 2), ("node_4", 2)],
            [("node_1", 3), ("node_2", 3), ("node_3", 3), ("node_4", 3),
             ("node_1", 4), ("node_2", 4), ("node_3", 4), ("node_4", 4)],
            [("node_1", 5), ("node_2", 5), ("node_3", 5), ("node_4", 5),
             ("node_1", 6), ("node_2", 6), ("node_3", 6), ("node_4", 6)],
            [("node_1", 7), ("node_2", 7), ("node_3", 7), ("node_4", 7),
             ("node_1", 8), ("node_2", 8), ("node_3", 8), ("node_4", 8)],
            [("node_1", 9), ("node_2", 9), ("node_3", 9), ("node_4", 9),
             ("node_1", 10), ("node_2", 10), ("node_3", 10), ("node_4", 10)],
            [("node_3", 11), ("node_4", 11), ("node_3", 12), ("node_4", 12),
             ("node_3", 13), ("node_4", 13)],
            [("node_3", 14), ("node_4", 14), ("node_3", 15), ("node_4", 15),
             ("node_3", 16), ("node_4", 16)],
        ]

        total_cal_sent = 0
        for idx, g in enumerate(calib_groups):
            for nid, seq in g:
                send_raw_udp(
                    "127.0.0.1", port,
                    json.dumps({"version": 1, "node_id": nid, "seq": seq, "uptime_ms": uptime, "mode": "normal"}).encode("utf-8")
                )
                uptime += 10
                total_cal_sent += 1
            target_t = t0 + (idx + 1) * 0.5
            sleep_dur = target_t - time.monotonic()
            if sleep_dur > 0:
                time.sleep(sleep_dur)

        # Seal 7 calibration windows
        cal_target = t0 + 3.55
        sleep_cal = cal_target - time.monotonic()
        if sleep_cal > 0:
            time.sleep(sleep_cal)

        test_client.post("/api/hardware/calibration/finalize")

        # Monitoring: 36 datagrams with sequence continuation (no duplicates)
        # node_1: seq 11..21 (11 pkts)
        # node_2: seq 11..21 (11 pkts)
        # node_3: seq 17..23 (7 pkts)
        # node_4: seq 17..23 (7 pkts)
        # Total = 11 + 11 + 7 + 7 = 36 packets, 0 duplicates, 36 unique.
        mon_groups = [
            # Win 7: 8 pkts
            [("node_1", 11), ("node_2", 11), ("node_3", 17), ("node_4", 17),
             ("node_1", 12), ("node_2", 12), ("node_3", 18), ("node_4", 18)],
            # Win 8: 8 pkts
            [("node_1", 13), ("node_2", 13), ("node_3", 19), ("node_4", 19),
             ("node_1", 14), ("node_2", 14), ("node_3", 20), ("node_4", 20)],
            # Win 9: 8 pkts
            [("node_1", 15), ("node_2", 15), ("node_3", 21), ("node_4", 21),
             ("node_1", 16), ("node_2", 16), ("node_3", 22), ("node_4", 22)],
            # Win 10: 8 pkts
            [("node_1", 17), ("node_2", 17), ("node_3", 23), ("node_4", 23),
             ("node_1", 18), ("node_2", 18), ("node_1", 19), ("node_2", 19)],
            # Win 11: 4 pkts
            [("node_1", 20), ("node_2", 20), ("node_1", 21), ("node_2", 21)],
        ]

        total_mon_sent = 0
        for idx, g in enumerate(mon_groups):
            for nid, seq in g:
                send_raw_udp(
                    "127.0.0.1", port,
                    json.dumps({"version": 1, "node_id": nid, "seq": seq, "uptime_ms": uptime, "mode": "normal"}).encode("utf-8")
                )
                uptime += 10
                total_mon_sent += 1
            target_t = t0 + (7 + idx) * 0.5 + 0.35
            sleep_dur = target_t - time.monotonic()
            if sleep_dur > 0:
                time.sleep(sleep_dur)

        # Seal 12 windows
        stop_target = t0 + 6.10
        sleep_stop = stop_target - time.monotonic()
        if sleep_stop > 0:
            time.sleep(sleep_stop)

        sock.close()
        stop_data = test_client.post("/api/hardware/stop").json()

        # RECONCILIATION PROOF FOR SEQUENCE CONTINUATION (88 / 0 / 88):
        assert total_cal_sent == 52
        assert total_mon_sent == 36
        assert stop_data["total_valid_datagrams"] == 88, f"Expected 88 valid, got {stop_data['total_valid_datagrams']}"
        assert stop_data["duplicate_datagrams"] == 0, f"Expected 0 duplicates, got {stop_data['duplicate_datagrams']}"
        assert stop_data["unique_datagrams"] == 88, f"Expected 88 unique, got {stop_data['unique_datagrams']}"
        assert stop_data["total_valid_datagrams"] == stop_data["unique_datagrams"] + stop_data["duplicate_datagrams"]
        assert stop_data["completed_windows_count"] == 12
        assert stop_data["node_counts"] == {
            "node_1": 21,
            "node_2": 21,
            "node_3": 23,
            "node_4": 23,
        }

        stats_data = test_client.get(f"/api/experiments/{session_id}/statistics").json()
        # All-session mean: 88 arrivals across 12 windows = 7.3333
        assert abs(stats_data["empirical_mean"] - 88 / 12) < 1e-4
        # Calibration mean: 52 arrivals across 7 windows = 7.4286
        assert abs(stats_data["calibration_empirical_mean"] - 52 / 7) < 1e-4
        # Monitoring mean: 36 unique arrivals across 5 windows = 7.2000
        assert abs(stats_data["monitoring_empirical_mean"] - 36 / 5) < 1e-4
        assert stats_data["monitoring_window_count"] == 5
        # Clean sequence continuation has 0 duplicates -> no warning
        assert stats_data["data_quality_warning"] is None

    def test_sequence_continuation_prevents_false_duplicates(
        self, test_client: TestClient, temp_db: str
    ) -> None:
        """Case B3: Verifies that initial_sequences support prevents false duplicate classifications.

        Confirms that:
        - Calibration establishes independent per-node sequence state.
        - A second simulator continuing with initial_sequences produces 0 duplicates.
        - All monitoring datagrams are accepted as unique arrivals.
        - Per-node state remains strictly independent.
        """
        start_res = test_client.post(
            "/api/hardware/start",
            json={
                "bind_host": "127.0.0.1",
                "bind_port": 0,
                "window_seconds": 0.5,
                "min_calibration_windows": 2,
                "expected_nodes": ["node_1", "node_2", "node_3", "node_4"],
                "require_all_nodes": True,
            },
        )
        port = start_res.json()["bind_port"]
        session_id = start_res.json()["session_id"]

        # Run calibration simulator
        sim_cal = HardwareSimulator(
            destination_host="127.0.0.1",
            destination_port=port,
            duration_seconds=1.5,
        )
        sim_cal.start()
        time.sleep(1.2)
        sim_cal.stop()
        time.sleep(0.6)

        test_client.post("/api/hardware/calibration/finalize")

        last_seqs = sim_cal.get_last_sequences()
        assert len(last_seqs) == 4
        assert all(seq > 0 for seq in last_seqs.values())

        # Start second simulator with initial_sequences continuation
        sim_mon = HardwareSimulator(
            destination_host="127.0.0.1",
            destination_port=port,
            duration_seconds=1.5,
            initial_sequences=last_seqs,
        )
        sim_mon.start()
        time.sleep(1.2)
        sim_mon.stop()
        time.sleep(0.6)

        stop_data = test_client.post("/api/hardware/stop").json()
        assert stop_data["clean_shutdown"] is True
        assert stop_data["persisted"] is True

        # VERIFY ZERO FALSE DUPLICATES:
        assert stop_data["duplicate_datagrams"] == 0, f"Expected 0 duplicates with continuation, got {stop_data['duplicate_datagrams']}"
        assert stop_data["total_valid_datagrams"] == stop_data["unique_datagrams"]

    def test_partial_window_isolation_and_accounting(
        self, test_client: TestClient, temp_db: str
    ) -> None:
        """Case C: Partial trailing window isolation.
        
        Verifies that:
        1. Datagrams arriving in the trailing partial window at session stop are isolated into _partial_window.
        2. Partial window is marked is_partial=True, is_complete=False.
        3. Partial window is EXCLUDED from persisted observation series (preserving uniform window_seconds).
        4. Partial window count is recorded in session summary and experiment configuration metadata.
        5. Accounting invariant holds: unique == complete_sum + partial_sum.
        """
        start_res = test_client.post(
            "/api/hardware/start",
            json={
                "bind_host": "127.0.0.1",
                "bind_port": 0,
                "window_seconds": 2.0,  # Long 2.0s window
                "min_calibration_windows": 1,
            },
        )
        port = start_res.json()["bind_port"]
        session_id = start_res.json()["session_id"]

        # Send packets during window 0 (elapsed < 1.0s)
        for i in range(1, 6):
            send_raw_udp(
                "127.0.0.1",
                port,
                json.dumps({
                    "version": 1,
                    "node_id": "node_1",
                    "seq": i,
                    "uptime_ms": 100 * i,
                    "mode": "normal",
                }).encode("utf-8"),
            )
            time.sleep(0.05)

        # Stop immediately at T ≈ 0.3s (well before window_seconds=2.0s completes)
        stop_data = test_client.post("/api/hardware/stop").json()
        assert stop_data["clean_shutdown"] is True
        assert stop_data["partial_windows_count"] == 1
        assert stop_data["completed_windows_count"] == 0

        # Database record has 0 completed observations, but metadata documents partial datagrams
        repo = get_experiment_repository(temp_db)
        exp = repo.get_experiment(session_id)
        assert exp is not None
        assert len(exp.observations) == 0
        assert exp.configuration["partial_window_datagrams"] == 5
        assert exp.configuration["partial_windows_count"] == 1
        assert exp.configuration["unique_datagrams"] == 5
        assert exp.configuration["valid_datagrams"] == 5

    def test_ineligible_calibration_window_exclusion(
        self, test_client: TestClient, temp_db: str
    ) -> None:
        """Case D: Calibration purity.
        
        Verifies that if a window during calibration contains burst-mode telemetry (mode='burst'),
        it is marked is_calibration_eligible=False, excluded from baseline estimation,
        and NOT tagged is_calibration=True in the persisted observations.
        """
        start_res = test_client.post(
            "/api/hardware/start",
            json={
                "bind_host": "127.0.0.1",
                "bind_port": 0,
                "window_seconds": 0.4,
                "min_calibration_windows": 2,
                "expected_nodes": ["node_1"],
                "require_all_nodes": True,
            },
        )
        port = start_res.json()["bind_port"]
        session_id = start_res.json()["session_id"]

        # Window 0: Clean normal packets
        for i in range(1, 5):
            send_raw_udp(
                "127.0.0.1",
                port,
                json.dumps({
                    "version": 1, "node_id": "node_1", "seq": i, "uptime_ms": 100 * i, "mode": "normal"
                }).encode("utf-8"),
            )
        time.sleep(0.5)

        # Window 1: Burst contaminated packet
        send_raw_udp(
            "127.0.0.1",
            port,
            json.dumps({
                "version": 1, "node_id": "node_1", "seq": 5, "uptime_ms": 600, "mode": "burst"
            }).encode("utf-8"),
        )
        time.sleep(0.5)

        # Window 2: Clean normal packets
        for i in range(6, 10):
            send_raw_udp(
                "127.0.0.1",
                port,
                json.dumps({
                    "version": 1, "node_id": "node_1", "seq": i, "uptime_ms": 700 + 100 * i, "mode": "normal"
                }).encode("utf-8"),
            )
        time.sleep(0.5)

        # Finalize calibration: 2 eligible (windows 0 and 2), 1 excluded (window 1)
        fin_data = test_client.post("/api/hardware/calibration/finalize").json()
        assert fin_data["eligible_windows_count"] == 2
        assert fin_data["excluded_windows_count"] == 1

        # Stop session
        stop_data = test_client.post("/api/hardware/stop").json()
        assert stop_data["persisted"] is True

        repo = get_experiment_repository(temp_db)
        exp = repo.get_experiment(session_id)
        assert exp is not None

        # Verify that ONLY the 2 clean windows carry is_calibration=True
        calib_obs = [o for o in exp.observations if o.is_calibration is True]
        assert len(calib_obs) == 2
        assert sum(o.count for o in calib_obs) == (4 + 4)  # 4 from Win 0, 4 from Win 2

        # Contaminated window exists in time series (index 1) but is NOT flagged as calibration
        assert exp.observations[1].count == 1
        assert exp.observations[1].is_calibration is False

        # Statistical analysis CI extracts ONLY the 2 clean windows
        stats_data = test_client.get(f"/api/experiments/{session_id}/statistics").json()
        assert stats_data["confidence_interval"]["sample_size"] == 2
        assert stats_data["confidence_interval"]["total_arrivals"] == 8
        assert stats_data["confidence_interval"]["point_estimate"] == 4.0

    def test_database_restart_survival_and_reporting(
        self, test_client: TestClient, temp_db: str
    ) -> None:
        """Case E: Database restart survival and CSV/PDF export integrity."""
        start_res = test_client.post(
            "/api/hardware/start",
            json={
                "bind_host": "127.0.0.1",
                "bind_port": 0,
                "window_seconds": 0.5,
                "min_calibration_windows": 1,
                "expected_nodes": ["node_1"],
                "require_all_nodes": False,
            },
        )
        port = start_res.json()["bind_port"]
        session_id = start_res.json()["session_id"]

        for i in range(1, 7):
            send_raw_udp(
                "127.0.0.1",
                port,
                json.dumps({
                    "version": 1, "node_id": "node_1", "seq": i, "uptime_ms": 100 * i, "mode": "normal"
                }).encode("utf-8"),
            )
        time.sleep(0.6)

        test_client.post("/api/hardware/calibration/finalize")
        test_client.post("/api/hardware/stop")

        # Simulate backend restart: destroy repository instance and recreate
        import app.services.experiment_repository as er
        er._default_repo = None
        restarted_repo = er.ExperimentRepository(temp_db)

        # Retrieve experiment
        exp = restarted_repo.get_experiment(session_id)
        assert exp is not None
        assert exp.measurement_type == MeasurementType.UDP_DATAGRAM_COUNT
        assert len(exp.observations) > 0
        assert exp.configuration["valid_datagrams"] == 6
        assert exp.configuration["unique_datagrams"] == 6

        # Test CSV export
        csv_res = test_client.get(f"/api/experiments/{session_id}/export")
        assert csv_res.status_code == 200
        assert "text/csv" in csv_res.headers["content-type"]
        assert "udp_datagram_count" in csv_res.text or "UDP" in csv_res.text
        assert "# All-Session Empirical Mean:" in csv_res.text
        assert "# Calibration Phase Empirical Mean:" in csv_res.text

        # Test PDF export
        pdf_res = test_client.get(f"/api/experiments/{session_id}/report.pdf")
        assert pdf_res.status_code == 200
        assert pdf_res.headers["content-type"] == "application/pdf"
        assert pdf_res.content.startswith(b"%PDF")
        assert len(pdf_res.content) > 1000
