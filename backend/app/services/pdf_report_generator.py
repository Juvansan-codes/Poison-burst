"""
PoissonBurst Lab - Professional Experiment PDF Report Generator.

Generates academic-quality, publication-ready experiment reports in PDF format
using ReportLab and Matplotlib, containing actual saved observations, empirical statistics,
goodness-of-fit diagnostics, baseline confidence intervals, and visualization figures.
"""

from __future__ import annotations

import io
import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import matplotlib
# Use headless Agg backend for thread-safe server generation
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    HRFlowable,
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.core.schemas import (
    ExperimentDetailResponse,
    ExperimentStatisticsResponse,
    ThresholdAnalysisResponse,
)
from app.services.statistical_analysis import (
    compute_experiment_statistics,
    compute_threshold_sensitivity,
)


class NumberedCanvas(canvas.Canvas):
    """Two-pass canvas for dynamic 'Page X of Y' numbering and running headers/footers."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._saved_page_states: List[Dict[str, Any]] = []

    def showPage(self) -> None:
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self) -> None:
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, page_count: int) -> None:
        self.saveState()
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#64748b"))

        # Running header (on pages > 1)
        if self._pageNumber > 1:
            self.drawString(54, 750, "PoissonBurst Lab — Traffic Burst Detection & Statistical Report")
            self.setStrokeColor(colors.HexColor("#cbd5e1"))
            self.setLineWidth(0.5)
            self.line(54, 744, 558, 744)

        # Running footer (all pages)
        page_str = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(558, 36, page_str)
        self.drawString(54, 36, "Karunya Institute of Technology and Sciences • Course 25CS203: Probability & Statistics")
        self.setStrokeColor(colors.HexColor("#cbd5e1"))
        self.setLineWidth(0.5)
        self.line(54, 46, 558, 46)

        self.restoreState()


def _create_timeseries_figure(exp: ExperimentDetailResponse) -> io.BytesIO:
    """Generate Matplotlib time-series plot of observations, baseline, and detections."""
    fig, ax = plt.subplots(figsize=(7.0, 2.6), dpi=200)
    try:
        fig.patch.set_facecolor("#ffffff")
        ax.set_facecolor("#f8fafc")

        obs = exp.observations
        n = len(obs)
        x_vals = [i * exp.window_seconds for i in range(n)]
        counts = [o.count for o in obs]

        # Plot traffic count curve
        unit_label = "Packets" if exp.measurement_type.value == "packet_count" else ("Flows" if exp.measurement_type.value == "flow_count" else "Datagrams")
        ax.plot(x_vals, counts, color="#0284c7", linewidth=1.2, label=f"Observed {unit_label}/window", zorder=2)

        # Plot baseline lambda
        ax.axhline(
            y=exp.baseline_lambda,
            color="#16a34a",
            linestyle="--",
            linewidth=1.2,
            label=f"Calibrated Baseline $\\lambda$ = {exp.baseline_lambda:.2f}",
            zorder=3,
        )

        # Plot detected burst windows
        flagged_x = []
        flagged_y = []
        for i, d in enumerate(exp.detections):
            if d.is_burst:
                flagged_x.append(x_vals[i])
                flagged_y.append(counts[i])

        if flagged_x:
            ax.scatter(
                flagged_x,
                flagged_y,
                color="#ef4444",
                s=28,
                marker="^",
                edgecolors="#991b1b",
                linewidths=0.8,
                label=f"Poisson Burst Alert (p < {exp.alpha})",
                zorder=4,
            )

        # Highlight ground-truth burst intervals if available
        gt_windows = [i for i, o in enumerate(obs) if o.ground_truth is True]
        if gt_windows:
            # Group contiguous ground truth intervals
            intervals = []
            start_idx = gt_windows[0]
            prev_idx = gt_windows[0]
            for idx in gt_windows[1:]:
                if idx == prev_idx + 1:
                    prev_idx = idx
                else:
                    intervals.append((start_idx * exp.window_seconds, (prev_idx + 1) * exp.window_seconds))
                    start_idx = idx
                    prev_idx = idx
            intervals.append((start_idx * exp.window_seconds, (prev_idx + 1) * exp.window_seconds))

            for j, (t_start, t_end) in enumerate(intervals):
                ax.axvspan(
                    t_start,
                    t_end,
                    color="#f97316",
                    alpha=0.18,
                    label="Ground Truth Burst Interval" if j == 0 else "",
                    zorder=1,
                )

        ax.set_title("Traffic Arrival Timeline & Statistical Detection Outcomes", fontsize=9.5, fontweight="bold", pad=7, color="#0f172a")
        ax.set_xlabel("Elapsed Time (seconds)", fontsize=8, color="#334155")
        ax.set_ylabel(f"Arrival Count (W = {exp.window_seconds}s)", fontsize=8, color="#334155")
        ax.tick_params(axis="both", labelsize=7.5, colors="#475569")
        ax.grid(True, linestyle=":", alpha=0.6, color="#cbd5e1")
        ax.legend(loc="upper right", fontsize=6.8, framealpha=0.9, facecolor="#ffffff", edgecolor="#cbd5e1")

        plt.tight_layout()
        buf = io.BytesIO()
        plt.savefig(buf, format="png", dpi=200)
        buf.seek(0)
        return buf
    finally:
        plt.close(fig)


def _create_distribution_figure(stats: ExperimentStatisticsResponse) -> io.BytesIO:
    """Generate comparison plot of empirical counts vs theoretical Poisson PMF."""
    fig, ax = plt.subplots(figsize=(7.0, 2.5), dpi=200)
    try:
        fig.patch.set_facecolor("#ffffff")
        ax.set_facecolor("#f8fafc")

        dist = stats.distribution_fit
        if not dist:
            ax.text(0.5, 0.5, "Insufficient observations for distribution plot", ha="center", va="center")
            buf = io.BytesIO()
            plt.savefig(buf, format="png", dpi=200)
            buf.seek(0)
            return buf

        k_vals = [p.k for p in dist]
        emp_probs = [p.empirical_probability for p in dist]
        theo_probs = [p.theoretical_probability for p in dist]

        # Bar chart for empirical distribution
        ax.bar(
            k_vals,
            emp_probs,
            width=0.65,
            color="#38bdf8",
            alpha=0.65,
            edgecolor="#0284c7",
            linewidth=0.8,
            label="Empirical Frequency (Sample)",
            zorder=2,
        )

        # Line for theoretical Poisson PMF
        ax.plot(
            k_vals,
            theo_probs,
            color="#f97316",
            marker="o",
            markersize=3.5,
            linewidth=1.4,
            label=f"Theoretical Poisson($\\lambda$ = {stats.baseline_lambda:.2f})",
            zorder=3,
        )

        ax.set_title("Empirical Traffic Count Distribution vs Theoretical Poisson PMF", fontsize=9.5, fontweight="bold", pad=7, color="#0f172a")
        ax.set_xlabel("Arrival Count per Window (k)", fontsize=8, color="#334155")
        ax.set_ylabel("Probability P(X = k)", fontsize=8, color="#334155")
        ax.tick_params(axis="both", labelsize=7.5, colors="#475569")
        ax.grid(True, linestyle=":", alpha=0.6, color="#cbd5e1")
        ax.legend(loc="upper right", fontsize=7.2, framealpha=0.9, facecolor="#ffffff", edgecolor="#cbd5e1")

        plt.tight_layout()
        buf = io.BytesIO()
        plt.savefig(buf, format="png", dpi=200)
        buf.seek(0)
        return buf
    finally:
        plt.close(fig)


def _create_sensitivity_figure(sensitivity: ThresholdAnalysisResponse) -> io.BytesIO:
    """Generate threshold sensitivity curves comparing alert counts and detection metrics."""
    fig, ax1 = plt.subplots(figsize=(7.0, 2.4), dpi=200)
    try:
        fig.patch.set_facecolor("#ffffff")
        ax1.set_facecolor("#f8fafc")

        points = sensitivity.points
        alphas = [p.alpha for p in points]
        counts = [p.detected_window_count for p in points]
        alpha_labels = [f"{a}" for a in alphas]
        x_indices = list(range(len(alphas)))

        color_alerts = "#ef4444"
        ax1.plot(x_indices, counts, color=color_alerts, marker="s", markersize=4, linewidth=1.4, label="Flagged Windows")
        ax1.set_xticks(x_indices)
        ax1.set_xticklabels(alpha_labels, fontsize=7.5, color="#334155")
        ax1.set_xlabel("Significance Level Threshold ($\\alpha$)", fontsize=8, color="#334155")
        ax1.set_ylabel("Flagged Windows (Alerts)", fontsize=8, color=color_alerts)
        ax1.tick_params(axis="y", labelcolor=color_alerts, labelsize=7.5)
        ax1.grid(True, linestyle=":", alpha=0.5, color="#cbd5e1")

        has_metrics = sensitivity.ground_truth_available and any(p.evaluation is not None for p in points)
        if has_metrics:
            ax2 = ax1.twinx()
            precisions = [p.evaluation.precision if p.evaluation else 0.0 for p in points]
            recalls = [p.evaluation.recall if p.evaluation else 0.0 for p in points]
            f1_scores = [p.evaluation.f1_score if p.evaluation else 0.0 for p in points]

            ax2.plot(x_indices, precisions, color="#0284c7", marker="o", markersize=3.5, linestyle="--", linewidth=1.1, label="Precision")
            ax2.plot(x_indices, recalls, color="#16a34a", marker="^", markersize=3.5, linestyle="-.", linewidth=1.1, label="Recall")
            ax2.plot(x_indices, f1_scores, color="#8b5cf6", marker="d", markersize=3.5, linestyle=":", linewidth=1.1, label="F1-Score")

            ax2.set_ylabel("Metric Score (0.0 to 1.0)", fontsize=8, color="#334155")
            ax2.set_ylim(-0.05, 1.05)
            ax2.tick_params(axis="y", labelsize=7.5, colors="#475569")

            # Combine legends
            lines1, labels1 = ax1.get_legend_handles_labels()
            lines2, labels2 = ax2.get_legend_handles_labels()
            ax1.legend(lines1 + lines2, labels1 + labels2, loc="upper right", fontsize=6.5, framealpha=0.9, facecolor="#ffffff", edgecolor="#cbd5e1")
        else:
            ax1.legend(loc="upper right", fontsize=7.0, framealpha=0.9, facecolor="#ffffff", edgecolor="#cbd5e1")

        ax1.set_title("Detection Sensitivity & Performance Across Significance Levels ($\\alpha$)", fontsize=9.5, fontweight="bold", pad=7, color="#0f172a")

        plt.tight_layout()
        buf = io.BytesIO()
        plt.savefig(buf, format="png", dpi=200)
        buf.seek(0)
        return buf
    finally:
        plt.close(fig)


def generate_experiment_pdf_report(exp: ExperimentDetailResponse) -> bytes:
    """Build a complete, academic experiment report in PDF format."""
    stats = compute_experiment_statistics(exp)
    sensitivity = compute_threshold_sensitivity(exp, [0.10, 0.05, 0.01, 0.005, 0.001])

    pdf_buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        pdf_buffer,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54,
    )

    styles = getSampleStyleSheet()

    # Custom typography styles
    title_style = ParagraphStyle(
        "ReportTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=18,
        leading=22,
        textColor=colors.HexColor("#0f172a"),
        spaceAfter=4,
    )
    subtitle_style = ParagraphStyle(
        "ReportSubtitle",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=10.5,
        leading=14,
        textColor=colors.HexColor("#475569"),
        spaceAfter=12,
    )
    heading_style = ParagraphStyle(
        "SectionHeading",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=16,
        textColor=colors.HexColor("#1e293b"),
        spaceBefore=12,
        spaceAfter=6,
    )
    body_style = ParagraphStyle(
        "BodyDark",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=13,
        textColor=colors.HexColor("#334155"),
        spaceAfter=6,
    )
    math_style = ParagraphStyle(
        "MathFormula",
        parent=styles["Normal"],
        fontName="Courier",
        fontSize=8.5,
        leading=12,
        textColor=colors.HexColor("#0f172a"),
        backColor=colors.HexColor("#f1f5f9"),
        borderPadding=5,
        spaceAfter=6,
    )
    table_cell = ParagraphStyle(
        "TableCell",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#1e293b"),
    )
    table_header = ParagraphStyle(
        "TableHeader",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=11,
        textColor=colors.white,
    )

    story: List[Any] = []

    # =========================================================================
    # 1. HEADER & METADATA
    # =========================================================================
    story.append(Paragraph("POISSONBURST LAB", ParagraphStyle("Brand", fontName="Helvetica-Bold", fontSize=9, textColor=colors.HexColor("#f97316"), spaceAfter=2)))
    story.append(Paragraph("Traffic Burst Detection in Communication Networks", title_style))
    story.append(Paragraph("Academic Experiment Report • Course 25CS203: Probability and Statistics for Computer Science", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#f97316"), spaceAfter=10))

    # Meta table
    meta_data = [
        [
            Paragraph("<b>Experiment Title:</b>", table_cell),
            Paragraph(exp.title, table_cell),
            Paragraph("<b>Experiment ID:</b>", table_cell),
            Paragraph(f"<code>{exp.experiment_id}</code>", table_cell),
        ],
        [
            Paragraph("<b>Experiment Type:</b>", table_cell),
            Paragraph(exp.experiment_type.value.capitalize(), table_cell),
            Paragraph("<b>Created (UTC):</b>", table_cell),
            Paragraph(exp.created_at[:19].replace("T", " "), table_cell),
        ],
        [
            Paragraph("<b>Measurement Type:</b>", table_cell),
            Paragraph(exp.measurement_type.value, table_cell),
            Paragraph("<b>Window Size (W):</b>", table_cell),
            Paragraph(f"{exp.window_seconds} seconds", table_cell),
        ],
        [
            Paragraph("<b>Calibrated Baseline (λ):</b>", table_cell),
            Paragraph(f"{exp.baseline_lambda:.4f} counts/win", table_cell),
            Paragraph("<b>Arrival Rate:</b>", table_cell),
            Paragraph(f"{exp.baseline_rate_per_second:.4f} / sec", table_cell),
        ],
        [
            Paragraph("<b>Significance Level (α):</b>", table_cell),
            Paragraph(f"{exp.alpha}", table_cell),
            Paragraph("<b>Ground Truth:</b>", table_cell),
            Paragraph("Available (Labeled)" if exp.ground_truth_available else "Not Available (Unlabeled)", table_cell),
        ],
    ]
    if exp.dataset_name:
        meta_data.append([
            Paragraph("<b>Dataset Filename:</b>", table_cell),
            Paragraph(exp.dataset_name, table_cell),
            Paragraph("<b>Scenario:</b>", table_cell),
            Paragraph(exp.scenario or "Historical CSV Replay", table_cell),
        ])

    meta_table = Table(meta_data, colWidths=[120, 150, 110, 124])
    meta_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 10))

    # =========================================================================
    # 2. MATHEMATICAL METHODOLOGY
    # =========================================================================
    story.append(Paragraph("1. Mathematical Methodology & Detection Framework", heading_style))
    story.append(Paragraph(
        "Under the assumption that network arrivals follow a homogeneous Poisson process with mean intensity λ "
        "counts per observation window of duration W seconds, the probability of observing exactly k arrivals is given by:",
        body_style,
    ))
    story.append(Paragraph("P(X = k) = (exp(-λ) * λ^k) / k!    for k ∈ {0, 1, 2, ...}", math_style))
    story.append(Paragraph(
        "Burst detection evaluates the cumulative upper-tail probability—the probability under the baseline Poisson "
        "distribution of observing a count at least as large as the observed count x:",
        body_style,
    ))
    story.append(Paragraph("p = P(X ≥ x | λ) = sum_{k=x}^∞ P(X = k) = 1 - sum_{k=0}^{x-1} P(X = k)", math_style))
    story.append(Paragraph(
        "<b>Decision Rule:</b> An observation window is flagged as an unusual traffic burst if and only if "
        f"<b>p &lt; α</b> (configured threshold α = {exp.alpha}). This upper-tail test identifies statistically improbable surges "
        "relative to the calibrated baseline, without requiring arbitrary static threshold heuristics.",
        body_style,
    ))

    # =========================================================================
    # 3. EMPIRICAL STATISTICAL SUMMARY & DIAGNOSTICS
    # =========================================================================
    story.append(Paragraph("2. Empirical Sample Statistics & Mean-Variance Analysis", heading_style))

    stats_table_data = [
        [
            Paragraph("Metric", table_header),
            Paragraph("Value", table_header),
            Paragraph("Theoretical Poisson Benchmark", table_header),
            Paragraph("Scientific Interpretation", table_header),
        ],
        [
            Paragraph("Total Analyzed Windows (n)", table_cell),
            Paragraph(f"{stats.observation_count}", table_cell),
            Paragraph("—", table_cell),
            Paragraph("Total observation intervals evaluated", table_cell),
        ],
        [
            Paragraph("Empirical Mean (X̄)", table_cell),
            Paragraph(f"{stats.empirical_mean:.4f}", table_cell),
            Paragraph(f"λ = {stats.baseline_lambda:.4f}", table_cell),
            Paragraph("Sample average arrival count per window", table_cell),
        ],
        [
            Paragraph("Sample Variance (s²)", table_cell),
            Paragraph(f"{stats.sample_variance:.4f}", table_cell),
            Paragraph(f"Var(X) = λ = {stats.baseline_lambda:.4f}", table_cell),
            Paragraph("Unbiased sample variance (ddof=1)", table_cell),
        ],
        [
            Paragraph("Variance-to-Mean Ratio (D)", table_cell),
            Paragraph(f"<b>{stats.variance_to_mean_ratio:.4f}</b>", table_cell),
            Paragraph("D = 1.0000", table_cell),
            Paragraph(f"Dispersion: <b>{stats.dispersion_type.upper()}</b>", table_cell),
        ],
        [
            Paragraph("Flagged Burst Windows", table_cell),
            Paragraph(f"<b>{stats.original_detected_count}</b> / {stats.observation_count}", table_cell),
            Paragraph(f"Expected false alarms: ~{int(round(stats.observation_count * exp.alpha))}", table_cell),
            Paragraph(f"Rate: {(stats.original_detected_count / max(1, stats.observation_count)) * 100:.2f}% of windows", table_cell),
        ],
    ]
    stats_table = Table(stats_table_data, colWidths=[140, 80, 120, 164])
    stats_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e293b")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
    ]))
    story.append(stats_table)
    story.append(Spacer(1, 8))

    # Baseline Uncertainty Callout
    ci = stats.confidence_interval
    if ci.is_valid:
        ci_title = "<b>Exact 95% Poisson Baseline Confidence Interval:</b>"
        ci_content = (
            f"λ ∈ [<b>{ci.lower_bound:.4f}</b>, <b>{ci.upper_bound:.4f}</b>] "
            f"(Point Estimate: {ci.point_estimate:.4f}, Method: {ci.method})<br/>"
            f"<font size='7.5' color='#475569'>{ci.interpretation}</font>"
        )
        ci_bg = colors.HexColor("#ecfdf5")
        ci_border = colors.HexColor("#10b981")
    else:
        ci_title = "<b>Baseline Confidence Interval (UNAVAILABLE):</b>"
        ci_content = (
            f"<b>Notice:</b> Baseline parameter confidence interval cannot be justified for this experiment.<br/>"
            f"<font size='7.5' color='#475569'>{ci.explanation or ci.interpretation}</font>"
        )
        ci_bg = colors.HexColor("#fef3c7")
        ci_border = colors.HexColor("#f59e0b")

    if stats.confidence_interval_empirical and stats.confidence_interval_empirical.is_valid:
        emp_ci = stats.confidence_interval_empirical
        ci_content += (
            f"<br/><font size='7' color='#334155'><b>Empirical Sequence Interval (All Windows):</b> "
            f"[{emp_ci.lower_bound:.4f}, {emp_ci.upper_bound:.4f}] (mean = {emp_ci.point_estimate:.4f}, n = {emp_ci.sample_size}). "
            f"Caution: Reflects aggregate sample arrival rate, not the isolated baseline.</font>"
        )

    ci_box_data = [[Paragraph(ci_title, table_cell), Paragraph(ci_content, table_cell)]]
    ci_box = Table(ci_box_data, colWidths=[170, 334])
    ci_box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), ci_bg),
        ("BOX", (0, 0), (-1, -1), 1, ci_border),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(ci_box)
    story.append(Spacer(1, 8))

    # Goodness-of-Fit Diagnostic
    gof = stats.goodness_of_fit_baseline
    gof_status = "VALID" if gof.is_valid else "UNAVAILABLE"
    gof_box_data = [
        [
            Paragraph(f"<b>Goodness-of-Fit Assessment ({gof_status}):</b>", table_cell),
            Paragraph(
                (
                    f"Test: {gof.test_name}<br/>"
                    f"Statistic: χ² = {gof.chi2_statistic:.3f}, df = {gof.degrees_of_freedom}, p-value = {gof.p_value:.4e}<br/>"
                    f"{gof.interpretation}"
                )
                if gof.is_valid
                else f"Goodness-of-fit unavailable: {gof.explanation}",
                table_cell,
            ),
        ]
    ]
    gof_color = colors.HexColor("#fef3c7") if not gof.is_valid else (colors.HexColor("#ecfdf5") if (gof.p_value or 0) >= 0.05 else colors.HexColor("#fef2f2"))
    gof_border = colors.HexColor("#f59e0b") if not gof.is_valid else (colors.HexColor("#10b981") if (gof.p_value or 0) >= 0.05 else colors.HexColor("#ef4444"))
    gof_box = Table(gof_box_data, colWidths=[170, 334])
    gof_box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), gof_color),
        ("BOX", (0, 0), (-1, -1), 1, gof_border),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(gof_box)
    story.append(Spacer(1, 10))

    # =========================================================================
    # 4. EXPERIMENTAL VISUALIZATIONS
    # =========================================================================
    story.append(Paragraph("3. Empirical Traffic Visualizations & Model Fit", heading_style))

    # Time-series chart
    ts_buf = _create_timeseries_figure(exp)
    story.append(Image(ts_buf, width=504, height=187))
    story.append(Spacer(1, 8))

    # Distribution fit chart
    dist_buf = _create_distribution_figure(stats)
    story.append(Image(dist_buf, width=504, height=180))
    story.append(Spacer(1, 10))

    # Page break for structured flow
    story.append(PageBreak())

    # =========================================================================
    # 5. DETECTION PERFORMANCE & THRESHOLD SENSITIVITY
    # =========================================================================
    story.append(Paragraph("4. Detection Performance & Significance Sensitivity Analysis", heading_style))

    if exp.ground_truth_available and exp.evaluation:
        ev = exp.evaluation
        perf_data = [
            [
                Paragraph("True Positives (TP)", table_header),
                Paragraph("False Positives (FP)", table_header),
                Paragraph("True Negatives (TN)", table_header),
                Paragraph("False Negatives (FN)", table_header),
                Paragraph("Precision", table_header),
                Paragraph("Recall", table_header),
                Paragraph("F1-Score", table_header),
                Paragraph("FPR", table_header),
            ],
            [
                Paragraph(str(ev.true_positives), table_cell),
                Paragraph(str(ev.false_positives), table_cell),
                Paragraph(str(ev.true_negatives), table_cell),
                Paragraph(str(ev.false_negatives), table_cell),
                Paragraph(f"{ev.precision:.4f}", table_cell),
                Paragraph(f"{ev.recall:.4f}", table_cell),
                Paragraph(f"{ev.f1_score:.4f}", table_cell),
                Paragraph(f"{ev.false_positive_rate:.4f}", table_cell),
            ],
        ]
        perf_table = Table(perf_data, colWidths=[63, 63, 63, 63, 63, 63, 63, 63])
        perf_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(perf_table)
        story.append(Spacer(1, 6))
    else:
        story.append(Paragraph(
            "<b>Ground-Truth Performance Note:</b> Ground-truth burst labels were not available for this dataset. "
            "In accordance with rigorous statistical practice, classification metrics (Precision, Recall, F1, FPR) "
            "are not fabricated. The detector flagged " f"<b>{exp.detected_window_count}</b> unusual arrival windows "
            f"based strictly on the upper-tail criterion p &lt; {exp.alpha}.",
            body_style,
        ))
        story.append(Spacer(1, 6))

    # Sensitivity chart
    sens_buf = _create_sensitivity_figure(sensitivity)
    story.append(Image(sens_buf, width=504, height=172))
    story.append(Spacer(1, 8))

    # Sensitivity table
    sens_table_data = [
        [
            Paragraph("Significance Level (α)", table_header),
            Paragraph("Flagged Windows", table_header),
            Paragraph("Flagged %", table_header),
            Paragraph("Precision", table_header),
            Paragraph("Recall", table_header),
            Paragraph("F1-Score", table_header),
        ]
    ]
    for p in sensitivity.points:
        pct = (p.detected_window_count / max(1, stats.observation_count)) * 100
        prec_str = f"{p.evaluation.precision:.4f}" if p.evaluation else "N/A"
        rec_str = f"{p.evaluation.recall:.4f}" if p.evaluation else "N/A"
        f1_str = f"{p.evaluation.f1_score:.4f}" if p.evaluation else "N/A"
        sens_table_data.append([
            Paragraph(f"α = {p.alpha}", table_cell),
            Paragraph(str(p.detected_window_count), table_cell),
            Paragraph(f"{pct:.2f}%", table_cell),
            Paragraph(prec_str, table_cell),
            Paragraph(rec_str, table_cell),
            Paragraph(f1_str, table_cell),
        ])

    sens_table = Table(sens_table_data, colWidths=[100, 80, 80, 80, 80, 84])
    sens_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e293b")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(sens_table)
    story.append(Spacer(1, 10))

    # =========================================================================
    # 6. STATISTICAL INTERPRETATION & MODEL LIMITATIONS
    # =========================================================================
    story.append(Paragraph("5. Discussion, Model Limitations & Academic Conclusion", heading_style))
    story.append(Paragraph(
        f"<b>Observation Assessment:</b> The experiment evaluated {stats.observation_count} observation windows. "
        f"{stats.interpretation_summary}",
        body_style,
    ))
    story.append(Paragraph(
        "<b>Foundational Poisson Assumptions:</b> A stationary Poisson process assumes that arrivals occur independently "
        "and that the average rate λ remains constant over time. In real-world communication networks, packet arrivals frequently "
        "exhibit temporal correlations, packet train clustering, and self-similar burstiness across multiple timescales. "
        f"When overdispersion (D = {stats.variance_to_mean_ratio:.2f} &gt; 1) is present, the true variance exceeds the mean, causing "
        "the Poisson upper-tail probability to underestimate the occurrence of natural statistical clusters and potentially inflating false alarms.",
        body_style,
    ))
    story.append(Paragraph(
        "<b>Measurement Unit Distinction:</b> "
        f"This experiment strictly measured <b>{exp.measurement_type.value}</b>. "
        "Packet counts (PCAPs), connection flow records (NetFlow/CICIDS), and UDP datagrams represent fundamentally different "
        "arrival phenomena and must never be combined into a common rate.",
        body_style,
    ))
    story.append(Paragraph(
        "<b>Scientific Integrity:</b> Statistical anomalies flagged by this detector reflect counts that are statistically unusual "
        "under the calibrated Poisson baseline. They do not constitute deterministic proof of malicious attacks, congestion, or security breaches "
        "without domain-specific payload inspection.",
        body_style,
    ))

    # Build document with running decorations
    doc.build(story, canvasmaker=NumberedCanvas)
    pdf_bytes = pdf_buffer.getvalue()
    pdf_buffer.close()
    return pdf_bytes
