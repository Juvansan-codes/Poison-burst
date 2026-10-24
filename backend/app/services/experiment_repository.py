"""
PoissonBurst Lab - Persistent Experiment Storage Service.

Provides a robust, lightweight SQLite persistence layer for network traffic burst
detection experiments (both synthetic simulations and historical CSV analyses).

Preserves observation time series, statistical detection outcomes, ground truth labels,
and evaluation metrics across backend restarts and page navigations.
"""

from __future__ import annotations

import csv
import io
import json
import os
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from app.core.schemas import (
    DashboardSummaryResponse,
    DetectionResponse,
    EvaluationMetrics,
    ExperimentDetailResponse,
    ExperimentListResponse,
    ExperimentSummary,
    ExperimentType,
    MeasurementType,
    SimulationRequest,
    SimulationResponse,
    TrafficObservation,
    TrafficSource,
)


class ExperimentRepository:
    """SQLite repository for storing, retrieving, and aggregating experiment records."""

    def __init__(self, db_path: Optional[str] = None) -> None:
        if db_path:
            self.db_path = db_path
        else:
            env_path = os.getenv("POISSONBURST_DB_PATH")
            if env_path:
                self.db_path = os.path.abspath(env_path)
            else:
                base_dir = os.path.abspath(
                    os.path.join(os.path.dirname(__file__), "..", "..", "data")
                )
                self.db_path = os.path.join(base_dir, "experiments.db")

        if self.db_path != ":memory:":
            os.makedirs(os.path.dirname(self.db_path), exist_ok=True)

        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        """Create a connection with row factory and WAL mode enabled."""
        conn = sqlite3.connect(self.db_path, timeout=30.0)
        conn.row_factory = sqlite3.Row
        if self.db_path != ":memory:":
            conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        return conn

    def _init_db(self) -> None:
        """Initialize SQLite tables and indices idempotently."""
        with self._get_connection() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS experiments (
                    experiment_id TEXT PRIMARY KEY,
                    experiment_type TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    title TEXT NOT NULL,
                    scenario TEXT,
                    measurement_type TEXT NOT NULL,
                    window_seconds REAL NOT NULL,
                    baseline_lambda REAL NOT NULL,
                    baseline_rate_per_second REAL NOT NULL,
                    alpha REAL NOT NULL,
                    observation_count INTEGER NOT NULL,
                    detected_window_count INTEGER NOT NULL,
                    ground_truth_available INTEGER NOT NULL,
                    dataset_name TEXT,
                    summary TEXT,
                    model_limitation_note TEXT,
                    evaluation_metrics TEXT,
                    configuration TEXT NOT NULL,
                    observations TEXT NOT NULL,
                    detections TEXT NOT NULL
                );
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_experiments_created_at ON experiments(created_at DESC);"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_experiments_type ON experiments(experiment_type);"
            )
            conn.commit()

    def save_simulation_experiment(
        self,
        req: SimulationRequest,
        res: SimulationResponse,
    ) -> ExperimentSummary:
        """Persist a completed synthetic simulation experiment.

        Args:
            req: Validated SimulationRequest settings.
            res: SimulationResponse containing time series, detections, and metrics.

        Returns:
            ExperimentSummary representing the saved experiment.
        """
        created_at = datetime.now(timezone.utc).isoformat()
        scenario_name = req.scenario.value
        title = f"Simulation: {scenario_name.replace('_', ' ').title()}"

        has_ground_truth = res.evaluation is not None or any(
            obs.ground_truth is not None for obs in res.observations
        )

        obs_json = json.dumps([obs.model_dump() for obs in res.observations])
        det_json = json.dumps([det.model_dump() for det in res.detections])
        eval_json = res.evaluation.model_dump_json() if res.evaluation else None
        config_json = json.dumps(req.model_dump())

        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO experiments (
                    experiment_id,
                    experiment_type,
                    created_at,
                    title,
                    scenario,
                    measurement_type,
                    window_seconds,
                    baseline_lambda,
                    baseline_rate_per_second,
                    alpha,
                    observation_count,
                    detected_window_count,
                    ground_truth_available,
                    dataset_name,
                    summary,
                    model_limitation_note,
                    evaluation_metrics,
                    configuration,
                    observations,
                    detections
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    res.experiment_id,
                    ExperimentType.SIMULATION.value,
                    created_at,
                    title,
                    scenario_name,
                    MeasurementType.PACKET_COUNT.value,
                    float(res.window_seconds),
                    float(res.lambda_window),
                    float(res.baseline_rate_per_second),
                    float(req.alpha),
                    len(res.observations),
                    int(res.detected_burst_count),
                    1 if has_ground_truth else 0,
                    None,
                    res.summary,
                    res.model_limitation_note,
                    eval_json,
                    config_json,
                    obs_json,
                    det_json,
                ),
            )
            conn.commit()

        return ExperimentSummary(
            experiment_id=res.experiment_id,
            experiment_type=ExperimentType.SIMULATION,
            created_at=created_at,
            title=title,
            scenario=scenario_name,
            measurement_type=MeasurementType.PACKET_COUNT,
            window_seconds=float(res.window_seconds),
            baseline_lambda=float(res.lambda_window),
            baseline_rate_per_second=float(res.baseline_rate_per_second),
            alpha=float(req.alpha),
            observation_count=len(res.observations),
            detected_window_count=int(res.detected_burst_count),
            ground_truth_available=has_ground_truth,
            dataset_name=None,
            summary=res.summary,
            evaluation=res.evaluation,
        )

    def save_historical_experiment(
        self,
        filename: str,
        res: Any,  # HistoricalAnalysisResponse
        config: Dict[str, Any],
    ) -> ExperimentSummary:
        """Persist a completed historical CSV analysis experiment.

        Args:
            filename: Name of the uploaded CSV dataset (no raw contents stored).
            res: HistoricalAnalysisResponse containing time-window aggregation & detections.
            config: Metadata dictionary recording timestamp column, label column, etc.

        Returns:
            ExperimentSummary representing the saved experiment.
        """
        created_at = datetime.now(timezone.utc).isoformat()
        title = f"Historical: {filename}"
        has_gt = bool(
            res.evaluation is not None
            or (res.labeled_burst_count is not None and res.labeled_burst_count >= 0)
        )

        obs_json = json.dumps([obs.model_dump() for obs in res.observations])
        det_json = json.dumps([det.model_dump() for det in res.detections])
        eval_json = res.evaluation.model_dump_json() if res.evaluation else None
        config_json = json.dumps(config)

        alpha_val = float(config.get("alpha", 0.01))

        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO experiments (
                    experiment_id,
                    experiment_type,
                    created_at,
                    title,
                    scenario,
                    measurement_type,
                    window_seconds,
                    baseline_lambda,
                    baseline_rate_per_second,
                    alpha,
                    observation_count,
                    detected_window_count,
                    ground_truth_available,
                    dataset_name,
                    summary,
                    model_limitation_note,
                    evaluation_metrics,
                    configuration,
                    observations,
                    detections
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    res.experiment_id,
                    ExperimentType.HISTORICAL.value,
                    created_at,
                    title,
                    None,
                    MeasurementType.FLOW_COUNT.value,
                    float(res.window_seconds),
                    float(res.lambda_window),
                    float(res.baseline_rate_per_second),
                    alpha_val,
                    len(res.observations),
                    int(res.detected_burst_count),
                    1 if has_gt else 0,
                    filename,
                    res.summary,
                    res.model_limitation_note,
                    eval_json,
                    config_json,
                    obs_json,
                    det_json,
                ),
            )
            conn.commit()

        return ExperimentSummary(
            experiment_id=res.experiment_id,
            experiment_type=ExperimentType.HISTORICAL,
            created_at=created_at,
            title=title,
            scenario=None,
            measurement_type=MeasurementType.FLOW_COUNT,
            window_seconds=float(res.window_seconds),
            baseline_lambda=float(res.lambda_window),
            baseline_rate_per_second=float(res.baseline_rate_per_second),
            alpha=alpha_val,
            observation_count=len(res.observations),
            detected_window_count=int(res.detected_burst_count),
            ground_truth_available=has_gt,
            dataset_name=filename,
            summary=res.summary,
            evaluation=res.evaluation,
        )

    def save_hardware_experiment(
        self,
        session_id: str,
        config: Dict[str, Any],
        summary: Any,  # HardwareStopResponse
        windows: List[Any],  # List[HardwareWindow]
        rec_status: Dict[str, Any],
        proc_status: Dict[str, Any],
    ) -> ExperimentSummary:
        """Persist a completed hardware monitoring session to SQLite.

        Converts observation windows to standard TrafficObservation records,
        preserving calibration provenance, per-node counts, sequence diagnostics,
        and authoritative Poisson upper-tail burst detection outcomes.

        Args:
            session_id: Unique hardware session identifier.
            config: Session configuration parameters (host, port, window duration, alpha, nodes).
            summary: HardwareStopResponse containing final datagram and detection totals.
            windows: Sequence of completed HardwareWindow dataclasses from processor.
            rec_status: Final snapshot of receiver packet counters and node telemetry.
            proc_status: Final snapshot of processor state, calibration, and rates.

        Returns:
            ExperimentSummary representing the saved hardware experiment.
        """
        # Idempotency check: if this session is already saved, return existing summary
        existing = self.get_experiment(session_id)
        if existing:
            return ExperimentSummary(
                experiment_id=existing.experiment_id,
                experiment_type=existing.experiment_type,
                created_at=existing.created_at,
                title=existing.title,
                scenario=existing.scenario,
                measurement_type=existing.measurement_type,
                window_seconds=existing.window_seconds,
                baseline_lambda=existing.baseline_lambda,
                baseline_rate_per_second=existing.baseline_rate_per_second,
                alpha=existing.alpha,
                observation_count=existing.observation_count,
                detected_window_count=existing.detected_window_count,
                ground_truth_available=existing.ground_truth_available,
                dataset_name=existing.dataset_name,
                summary=existing.summary,
                evaluation=existing.evaluation,
            )

        created_at = datetime.now(timezone.utc).isoformat()
        port = config.get("bind_port", 5005)
        host = config.get("bind_host", "0.0.0.0")
        w_sec = float(config.get("window_seconds", 1.0))
        alpha_val = float(config.get("alpha", 0.01))
        expected_nodes = list(config.get("expected_nodes", []))
        short_id = session_id[:8]
        title = f"Hardware: {short_id} ({len(expected_nodes)} nodes)"
        scenario_desc = f"Four-Node UDP Listener ({host}:{port})"

        # Base lambda and rate from processor
        base_lambda = float(proc_status.get("baseline_expected_count") or 0.0)
        base_rate = float(proc_status.get("baseline_rate_per_second") or 0.0)

        # Convert observation windows to standard TrafficObservation records
        observations: List[TrafficObservation] = []
        detections: List[DetectionResponse] = []

        for w in windows:
            exp_count = (
                float(w.expected_baseline_count)
                if getattr(w, "expected_baseline_count", None) is not None
                else base_lambda
            )

            obs = TrafficObservation(
                timestamp=w.start_time_utc,
                time_seconds=round(w.window_index * w_sec, 3),
                count=int(w.aggregate_count),
                source=TrafficSource.HARDWARE,
                measurement_type=MeasurementType.UDP_DATAGRAM_COUNT,
                ground_truth=None,  # Real physical hardware has no synthetic ground truth
                experiment_id=session_id,
                window_seconds=w_sec,
                expected_baseline_count=exp_count,
                is_calibration=bool(w.is_calibration),
            )
            observations.append(obs)

            p_val = float(w.p_value) if getattr(w, "p_value", None) is not None else 1.0
            is_burst_flag = bool(w.is_burst) if getattr(w, "is_burst", None) is not None else False
            det_alpha = float(w.alpha) if getattr(w, "alpha", None) is not None else alpha_val

            det_status_val = getattr(w.detection_status, "value", str(getattr(w, "detection_status", "normal")))
            if is_burst_flag:
                interp = f"ALERT: Statistically unusual arrival count {w.aggregate_count} (p={p_val:.6e} < alpha={det_alpha})."
            elif getattr(w, "p_value", None) is not None:
                interp = f"NORMAL: Arrival count {w.aggregate_count} within expected variation (p={p_val:.6f} >= alpha={det_alpha})."
            else:
                interp = f"UNAVAILABLE: Detection unavailable ({det_status_val})."

            det = DetectionResponse(
                observed_count=int(w.aggregate_count),
                expected_rate=exp_count,
                p_value=p_val,
                alpha=det_alpha,
                is_burst=is_burst_flag,
                interpretation=interp,
            )
            detections.append(det)

        # Complete metadata configuration dictionary
        node_counts = getattr(summary, "node_counts", {})
        config_dict: Dict[str, Any] = {
            "session_id": session_id,
            "bind_host": host,
            "bind_port": port,
            "window_seconds": w_sec,
            "alpha": alpha_val,
            "expected_nodes": expected_nodes,
            "min_calibration_windows": int(config.get("min_calibration_windows", 10)),
            "stale_node_timeout_seconds": float(config.get("stale_node_timeout_seconds", 5.0)),
            "require_all_nodes": bool(config.get("require_all_nodes", True)),
            "node_counts": node_counts,
            "node_gaps": {nid: n.get("sequence_gaps_count", 0) for nid, n in rec_status.get("nodes", {}).items()},
            "node_duplicates": {nid: n.get("duplicate_or_reordered_count", 0) for nid, n in rec_status.get("nodes", {}).items()},
            "node_last_seen_utc": {nid: n.get("last_receipt_time_utc") for nid, n in rec_status.get("nodes", {}).items()},
            "node_liveness": proc_status.get("node_liveness", {}),
            "total_socket_datagrams": rec_status.get("total_socket_datagrams", 0),
            "valid_datagrams": rec_status.get("valid_datagrams", 0),
            "malformed_datagrams": rec_status.get("malformed_datagrams", 0),
            "unique_datagrams": rec_status.get("unique_datagrams", 0),
            "is_calibrated": bool(proc_status.get("is_calibrated", False)),
            "baseline_expected_count": proc_status.get("baseline_expected_count"),
            "baseline_rate_per_second": proc_status.get("baseline_rate_per_second"),
            "calibration_windows_count": proc_status.get("calibration_windows_count", 0),
            "calibration_counts": [w.aggregate_count for w in windows if w.is_calibration],
        }

        dataset_label = f"UDP Listener ({len(expected_nodes)} nodes)"
        burst_count = int(getattr(summary, "burst_detections_count", sum(1 for w in windows if getattr(w, "is_burst", None) is True)))

        total_valid = getattr(summary, "total_valid_datagrams", rec_status.get("valid_datagrams", len(observations)))
        summary_text = (
            f"Hardware telemetry session completed with {total_valid} "
            f"valid datagrams across {len(windows)} observation windows (W={w_sec}s). "
            f"{burst_count} Poisson bursts detected (alpha={alpha_val})."
        )
        limitation_note = (
            "Hardware observation counts represent actual accepted unique UDP datagrams received per observation window. "
            "Physical hardware telemetry does not include synthetic ground-truth labels; evaluation metrics (Precision, Recall, F1) "
            "are legitimately unavailable. Legitimate zero-count observation windows are preserved in calibration and monitoring."
        )

        obs_json = json.dumps([obs.model_dump() for obs in observations])
        det_json = json.dumps([det.model_dump() for det in detections])
        config_json = json.dumps(config_dict)

        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO experiments (
                    experiment_id,
                    experiment_type,
                    created_at,
                    title,
                    scenario,
                    measurement_type,
                    window_seconds,
                    baseline_lambda,
                    baseline_rate_per_second,
                    alpha,
                    observation_count,
                    detected_window_count,
                    ground_truth_available,
                    dataset_name,
                    summary,
                    model_limitation_note,
                    evaluation_metrics,
                    configuration,
                    observations,
                    detections
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    session_id,
                    ExperimentType.HARDWARE.value,
                    created_at,
                    title,
                    scenario_desc,
                    MeasurementType.UDP_DATAGRAM_COUNT.value,
                    w_sec,
                    base_lambda,
                    base_rate,
                    alpha_val,
                    len(observations),
                    burst_count,
                    0,  # ground_truth_available is False
                    dataset_label,
                    summary_text,
                    limitation_note,
                    None,  # evaluation_metrics
                    config_json,
                    obs_json,
                    det_json,
                ),
            )
            conn.commit()

        return ExperimentSummary(
            experiment_id=session_id,
            experiment_type=ExperimentType.HARDWARE,
            created_at=created_at,
            title=title,
            scenario=scenario_desc,
            measurement_type=MeasurementType.UDP_DATAGRAM_COUNT,
            window_seconds=w_sec,
            baseline_lambda=base_lambda,
            baseline_rate_per_second=base_rate,
            alpha=alpha_val,
            observation_count=len(observations),
            detected_window_count=burst_count,
            ground_truth_available=False,
            dataset_name=dataset_label,
            summary=summary_text,
            evaluation=None,
        )

    def get_experiment(self, experiment_id: str) -> Optional[ExperimentDetailResponse]:
        """Retrieve full details of an experiment by its unique ID."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM experiments WHERE experiment_id = ?;",
                (experiment_id,),
            )
            row = cursor.fetchone()
            if not row:
                return None

            eval_metrics = None
            if row["evaluation_metrics"]:
                try:
                    eval_metrics = EvaluationMetrics.model_validate_json(row["evaluation_metrics"])
                except Exception:
                    eval_metrics = None

            raw_obs = json.loads(row["observations"])
            observations = [TrafficObservation.model_validate(o) for o in raw_obs]

            raw_dets = json.loads(row["detections"])
            detections = [DetectionResponse.model_validate(d) for d in raw_dets]

            config = json.loads(row["configuration"]) if row["configuration"] else {}

            return ExperimentDetailResponse(
                experiment_id=row["experiment_id"],
                experiment_type=ExperimentType(row["experiment_type"]),
                created_at=row["created_at"],
                title=row["title"],
                scenario=row["scenario"],
                measurement_type=MeasurementType(row["measurement_type"]),
                window_seconds=float(row["window_seconds"]),
                baseline_lambda=float(row["baseline_lambda"]),
                baseline_rate_per_second=float(row["baseline_rate_per_second"]),
                alpha=float(row["alpha"]),
                observation_count=int(row["observation_count"]),
                detected_window_count=int(row["detected_window_count"]),
                ground_truth_available=bool(row["ground_truth_available"]),
                dataset_name=row["dataset_name"],
                summary=row["summary"],
                model_limitation_note=row["model_limitation_note"],
                evaluation=eval_metrics,
                configuration=config,
                observations=observations,
                detections=detections,
            )

    def list_experiments(
        self,
        page: int = 1,
        page_size: int = 10,
        experiment_type: Optional[str] = None,
        search: Optional[str] = None,
    ) -> ExperimentListResponse:
        """List experiments with pagination, filtering, and search."""
        page = max(1, page)
        page_size = max(1, min(100, page_size))
        offset = (page - 1) * page_size

        where_clauses: List[str] = []
        params: List[Any] = []

        if experiment_type:
            where_clauses.append("experiment_type = ?")
            params.append(experiment_type.lower())

        if search and search.strip():
            term = f"%{search.strip().lower()}%"
            where_clauses.append(
                "(LOWER(title) LIKE ? OR LOWER(IFNULL(dataset_name, '')) LIKE ? OR LOWER(IFNULL(scenario, '')) LIKE ?)"
            )
            params.extend([term, term, term])

        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(f"SELECT COUNT(*) AS total FROM experiments {where_sql};", params)
            total = cursor.fetchone()["total"]

            total_pages = max(1, (total + page_size - 1) // page_size) if total > 0 else 0

            cursor.execute(
                f"""
                SELECT
                    experiment_id,
                    experiment_type,
                    created_at,
                    title,
                    scenario,
                    measurement_type,
                    window_seconds,
                    baseline_lambda,
                    baseline_rate_per_second,
                    alpha,
                    observation_count,
                    detected_window_count,
                    ground_truth_available,
                    dataset_name,
                    summary,
                    evaluation_metrics
                FROM experiments
                {where_sql}
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?;
                """,
                (*params, page_size, offset),
            )
            rows = cursor.fetchall()

            items: List[ExperimentSummary] = []
            for r in rows:
                eval_metrics = None
                if r["evaluation_metrics"]:
                    try:
                        eval_metrics = EvaluationMetrics.model_validate_json(r["evaluation_metrics"])
                    except Exception:
                        eval_metrics = None

                items.append(
                    ExperimentSummary(
                        experiment_id=r["experiment_id"],
                        experiment_type=ExperimentType(r["experiment_type"]),
                        created_at=r["created_at"],
                        title=r["title"],
                        scenario=r["scenario"],
                        measurement_type=MeasurementType(r["measurement_type"]),
                        window_seconds=float(r["window_seconds"]),
                        baseline_lambda=float(r["baseline_lambda"]),
                        baseline_rate_per_second=float(r["baseline_rate_per_second"]),
                        alpha=float(r["alpha"]),
                        observation_count=int(r["observation_count"]),
                        detected_window_count=int(r["detected_window_count"]),
                        ground_truth_available=bool(r["ground_truth_available"]),
                        dataset_name=r["dataset_name"],
                        summary=r["summary"],
                        evaluation=eval_metrics,
                    )
                )

        return ExperimentListResponse(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages,
        )

    def get_dashboard_summary(self) -> DashboardSummaryResponse:
        """Compute authoritative summary statistics directly from persisted experiments."""
        with self._get_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("SELECT COUNT(*) AS total FROM experiments;")
            total_experiments = cursor.fetchone()["total"]

            cursor.execute(
                "SELECT COUNT(*) AS total FROM experiments WHERE experiment_type = ?;",
                (ExperimentType.SIMULATION.value,),
            )
            sim_count = cursor.fetchone()["total"]

            cursor.execute(
                "SELECT COUNT(*) AS total FROM experiments WHERE experiment_type = ?;",
                (ExperimentType.HISTORICAL.value,),
            )
            hist_count = cursor.fetchone()["total"]

            cursor.execute(
                "SELECT COUNT(*) AS total FROM experiments WHERE experiment_type = ?;",
                (ExperimentType.HARDWARE.value,),
            )
            hw_count = cursor.fetchone()["total"]

            cursor.execute("SELECT DISTINCT measurement_type FROM experiments ORDER BY measurement_type;")
            measurement_types = [row["measurement_type"] for row in cursor.fetchall()]

            cursor.execute(
                """
                SELECT
                    experiment_id,
                    experiment_type,
                    created_at,
                    title,
                    scenario,
                    measurement_type,
                    window_seconds,
                    baseline_lambda,
                    baseline_rate_per_second,
                    alpha,
                    observation_count,
                    detected_window_count,
                    ground_truth_available,
                    dataset_name,
                    summary,
                    evaluation_metrics
                FROM experiments
                ORDER BY created_at DESC
                LIMIT 5;
                """
            )
            recent_rows = cursor.fetchall()

            recent_experiments: List[ExperimentSummary] = []
            for r in recent_rows:
                eval_metrics = None
                if r["evaluation_metrics"]:
                    try:
                        eval_metrics = EvaluationMetrics.model_validate_json(r["evaluation_metrics"])
                    except Exception:
                        eval_metrics = None

                recent_experiments.append(
                    ExperimentSummary(
                        experiment_id=r["experiment_id"],
                        experiment_type=ExperimentType(r["experiment_type"]),
                        created_at=r["created_at"],
                        title=r["title"],
                        scenario=r["scenario"],
                        measurement_type=MeasurementType(r["measurement_type"]),
                        window_seconds=float(r["window_seconds"]),
                        baseline_lambda=float(r["baseline_lambda"]),
                        baseline_rate_per_second=float(r["baseline_rate_per_second"]),
                        alpha=float(r["alpha"]),
                        observation_count=int(r["observation_count"]),
                        detected_window_count=int(r["detected_window_count"]),
                        ground_truth_available=bool(r["ground_truth_available"]),
                        dataset_name=r["dataset_name"],
                        summary=r["summary"],
                        evaluation=eval_metrics,
                    )
                )

            latest_exp = recent_experiments[0] if recent_experiments else None
            latest_detected = latest_exp.detected_window_count if latest_exp else None

            return DashboardSummaryResponse(
                total_experiments=total_experiments,
                simulation_experiments_count=sim_count,
                historical_experiments_count=hist_count,
                hardware_experiments_count=hw_count,
                available_measurement_types=measurement_types,
                latest_experiment=latest_exp,
                latest_detected_count=latest_detected,
                recent_experiments=recent_experiments,
            )

    def delete_experiment(self, experiment_id: str) -> bool:
        """Safely delete an experiment by ID. Returns True if deleted, False if not found."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM experiments WHERE experiment_id = ?;", (experiment_id,))
            conn.commit()
            return cursor.rowcount > 0

    def export_experiment_csv(self, experiment_id: str) -> Optional[Tuple[str, str]]:
        """Export experiment observations and detections as formatted CSV.

        Returns:
            Tuple of (csv_content_string, suggested_filename) or None if experiment not found.
        """
        exp = self.get_experiment(experiment_id)
        if not exp:
            return None

        output = io.StringIO()
        # Scientific metadata header comments
        output.write(f"# PoissonBurst Lab Experiment Export\n")
        output.write(f"# Experiment ID: {exp.experiment_id}\n")
        output.write(f"# Type: {exp.experiment_type.value}\n")
        output.write(f"# Title: {exp.title}\n")
        output.write(f"# Created At: {exp.created_at}\n")
        output.write(f"# Measurement Type: {exp.measurement_type.value}\n")
        output.write(f"# Observation Window Duration: {exp.window_seconds}s\n")
        output.write(f"# Baseline Lambda: {exp.baseline_lambda} counts/window\n")
        output.write(f"# Baseline Rate: {exp.baseline_rate_per_second} counts/s\n")
        output.write(f"# Significance Threshold Alpha: {exp.alpha}\n")
        output.write(f"# Observation Count: {exp.observation_count}\n")
        output.write(f"# Detected Bursts: {exp.detected_window_count}\n")
        output.write(f"# Ground Truth Available: {exp.ground_truth_available}\n")
        output.write("# Note: Aggregated time windows, NOT raw packets or unaggregated flows.\n")

        writer = csv.writer(output)
        writer.writerow([
            "timestamp",
            "time_seconds",
            "observed_count",
            "expected_baseline_count",
            "p_value",
            "significance_threshold",
            "is_burst",
            "ground_truth",
            "source",
            "measurement_type",
            "experiment_id",
        ])

        # Map detections by timestamp or index for precision
        dets_by_idx = {i: d for i, d in enumerate(exp.detections)}

        for i, obs in enumerate(exp.observations):
            det = dets_by_idx.get(i)
            p_val = det.p_value if det else None
            alpha_val = det.alpha if det else exp.alpha
            is_burst_val = det.is_burst if det else None

            writer.writerow([
                obs.timestamp,
                obs.time_seconds if obs.time_seconds is not None else round(i * exp.window_seconds, 2),
                obs.count,
                obs.expected_baseline_count if obs.expected_baseline_count is not None else exp.baseline_lambda,
                f"{p_val:.8e}" if p_val is not None else "",
                alpha_val,
                is_burst_val if is_burst_val is not None else "",
                obs.ground_truth if obs.ground_truth is not None else "",
                obs.source.value if hasattr(obs.source, "value") else str(obs.source),
                obs.measurement_type.value if hasattr(obs.measurement_type, "value") else str(obs.measurement_type),
                exp.experiment_id,
            ])

        clean_id = exp.experiment_id.replace(" ", "_")
        filename = f"{exp.experiment_type.value}_{clean_id}.csv"
        return output.getvalue(), filename


# Global singleton access
_default_repo: Optional[ExperimentRepository] = None


def get_experiment_repository(db_path: Optional[str] = None) -> ExperimentRepository:
    """Obtain the experiment repository instance."""
    global _default_repo
    if db_path:
        return ExperimentRepository(db_path=db_path)
    if _default_repo is None:
        _default_repo = ExperimentRepository()
    return _default_repo
