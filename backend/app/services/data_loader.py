"""
PoissonBurst Lab - Historical Data Loading and Aggregation Service (Preparation).

Architectural preparation for Phase 2 Historical Dataset ingestion (e.g. CICIDS2017).

CRITICAL DOMAIN DISTINCTION:
- CSV network-flow records (NetFlow, IPFIX, CICIDS2017 flow summaries) represent FLOW counts.
- PCAP files represent raw PACKET counts.
- Flow counts and Packet counts must NEVER be mixed or mislabeled.
- Historical attack labels mark flow connections, not individual packet windows.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from app.core.schemas import MeasurementType, TrafficObservation, TrafficSource


class HistoricalDataLoader:
    """Service stub for historical dataset parsing, validation, and time-window aggregation."""

    @staticmethod
    def get_supported_formats() -> List[Dict[str, Any]]:
        """List currently supported or planned historical formats."""
        return [
            {
                "format": "CSV_FLOW",
                "measurement_type": MeasurementType.FLOW_COUNT.value,
                "description": "Network flow summary records aggregated by timestamp intervals.",
                "status": "planned_phase_2",
            },
            {
                "format": "PCAP_PACKET",
                "measurement_type": MeasurementType.PACKET_COUNT.value,
                "description": "Raw packet captures aggregated into fixed-duration packet-count windows.",
                "status": "planned_phase_2",
            },
        ]

    @staticmethod
    def validate_csv_columns(columns: List[str]) -> Dict[str, Any]:
        """Validate if uploaded CSV columns contain timestamp and count/flow fields."""
        normalized = [c.strip().lower() for c in columns]
        has_time = any(k in normalized for k in ["timestamp", "time", "date", "flow_start"])
        has_count = any(k in normalized for k in ["count", "packets", "flows", "tot_fwd_pkts"])

        return {
            "is_valid": has_time and (has_count or len(columns) > 2),
            "detected_time_column": has_time,
            "detected_metric_column": has_count,
            "total_columns": len(columns),
        }
