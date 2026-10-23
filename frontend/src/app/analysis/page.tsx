'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  AlertTriangle,
  BarChart2,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Database,
  Download,
  FileText,
  HelpCircle,
  Info,
  RefreshCw,
  Sliders,
} from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, ApiClientError } from '@/lib/api';
import {
  DetectionResponse,
  DispersionResponse,
  ExperimentDetailResponse,
  ExperimentStatisticsResponse,
  ExperimentSummary,
  ThresholdAnalysisResponse,
  TrafficObservation,
} from '@/lib/types';
import { formatProbability } from '@/lib/utils';

function StatisticalAnalysisContent() {
  const searchParams = useSearchParams();
  const queryExperimentId = searchParams.get('experiment_id');

  // --- Saved Experiment Inspection State ---
  const [experimentList, setExperimentList] = useState<ExperimentSummary[]>([]);
  const [selectedExpId, setSelectedExpId] = useState<string>('');
  const [inspectedExperiment, setInspectedExperiment] = useState<ExperimentDetailResponse | null>(null);
  const [inspectedStats, setInspectedStats] = useState<ExperimentStatisticsResponse | null>(null);
  const [thresholdData, setThresholdData] = useState<ThresholdAnalysisResponse | null>(null);
  const [loadingExpList, setLoadingExpList] = useState<boolean>(true);
  const [loadingStats, setLoadingStats] = useState<boolean>(false);
  const [downloadingPdf, setDownloadingPdf] = useState<boolean>(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // --- Distribution Fit Display Toggle ---
  const [distFitParam, setDistFitParam] = useState<'baseline' | 'sample'>('baseline');
  const [showBinTable, setShowBinTable] = useState<boolean>(false);

  // --- Selected Observation Inspector ---
  const [selectedWindowIdx, setSelectedWindowIdx] = useState<number>(0);

  // --- Section: Interactive Hypothetical Sandbox ---
  const [calcObserved, setCalcObserved] = useState<number>(18);
  const [calcExpected, setCalcExpected] = useState<number>(10.0);
  const [calcAlpha, setCalcAlpha] = useState<number>(0.01);
  const [calcResult, setCalcResult] = useState<DetectionResponse | null>(null);
  const [calcLoading, setCalcLoading] = useState<boolean>(false);
  const [calcError, setCalcError] = useState<string | null>(null);

  // --- Custom Dispersion Analyzer ---
  const [sampleInput, setSampleInput] = useState<string>('10, 12, 9, 11, 10, 14, 8, 10, 11, 9');
  const [dispResult, setDispResult] = useState<DispersionResponse | null>(null);
  const [dispLoading, setDispLoading] = useState<boolean>(false);
  const [dispError, setDispError] = useState<string | null>(null);

  // Load available experiments on mount
  useEffect(() => {
    let isMounted = true;
    api
      .listExperiments({ page_size: 100 })
      .then((res) => {
        if (!isMounted) return;
        setExperimentList(res.items);
        if (queryExperimentId) {
          setSelectedExpId(queryExperimentId);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (isMounted) setLoadingExpList(false);
      });

    return () => {
      isMounted = false;
    };
  }, [queryExperimentId]);

  // When selectedExpId changes, fetch full detail, statistics, and threshold analysis
  useEffect(() => {
    if (!selectedExpId) return;

    let isMounted = true;

    api
      .getExperimentDetail(selectedExpId)
      .then((exp) => {
        if (!isMounted) return;
        setInspectedExperiment(exp);
        setSelectedWindowIdx(0);
      })
      .catch((err) => {
        if (!isMounted) return;
        setInspectedExperiment(null);
        console.error('Failed to load experiment detail:', err);
      });

    api
      .getExperimentStatistics(selectedExpId)
      .then((stats) => {
        if (!isMounted) return;
        setInspectedStats(stats);
      })
      .catch((err) => {
        if (!isMounted) return;
        setInspectedStats(null);
        console.error('Failed to load experiment statistics:', err);
      })
      .finally(() => {
        if (isMounted) setLoadingStats(false);
      });

    api
      .runThresholdAnalysis(selectedExpId, [0.10, 0.05, 0.01, 0.005, 0.001])
      .then((tRes) => {
        if (!isMounted) return;
        setThresholdData(tRes);
      })
      .catch((err) => {
        if (!isMounted) return;
        setThresholdData(null);
        console.error('Failed to load threshold analysis:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedExpId]);

  const handleSelectExperiment = (expId: string) => {
    setSelectedExpId(expId);
    setInspectedExperiment(null);
    setInspectedStats(null);
    setThresholdData(null);
    setDownloadError(null);
    if (!expId) {
      setLoadingStats(false);
    } else {
      setLoadingStats(true);
    }
  };

  const handleDownloadPdfReport = async () => {
    if (!selectedExpId) return;
    try {
      setDownloadingPdf(true);
      setDownloadError(null);
      await api.downloadExperimentReportPdf(
        selectedExpId,
        `PoissonBurst_Report_${selectedExpId}.pdf`
      );
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Failed to download PDF report.');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleExportCsv = async () => {
    if (!selectedExpId) return;
    try {
      await api.downloadExperimentCsv(
        selectedExpId,
        `PoissonBurst_Observations_${selectedExpId}.csv`
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to download CSV observations.');
    }
  };

  // Handle Probability Calculation for Hypothetical Sandbox
  const handleCalculateProbability = async () => {
    try {
      setCalcLoading(true);
      setCalcError(null);
      const res = await api.detectBurst({
        observed_count: Number(calcObserved),
        expected_rate: Number(calcExpected),
        alpha: Number(calcAlpha),
      });
      setCalcResult(res);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setCalcError(err.message);
      } else {
        setCalcError('Failed to compute probability with backend.');
      }
    } finally {
      setCalcLoading(false);
    }
  };

  // Initial calculator load
  useEffect(() => {
    let isMounted = true;
    api
      .detectBurst({
        observed_count: 18,
        expected_rate: 10.0,
        alpha: 0.01,
      })
      .then((res) => {
        if (isMounted) setCalcResult(res);
      })
      .catch((err) => {
        if (isMounted) {
          setCalcError(err instanceof Error ? err.message : 'Backend connection error');
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Handle Section 3 Dispersion Analysis
  const handleAnalyzeDispersion = async () => {
    try {
      setDispLoading(true);
      setDispError(null);
      const rawNumbers = sampleInput
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map(Number);

      if (rawNumbers.some(isNaN)) {
        throw new Error('Please enter only valid comma- or space-separated numbers.');
      }
      if (rawNumbers.length === 0) {
        throw new Error('Please provide at least one observation number.');
      }

      const res = await api.evaluateDispersion({ observations: rawNumbers });
      setDispResult(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid dispersion input.';
      setDispError(msg);
    } finally {
      setDispLoading(false);
    }
  };

  // Load inspected experiment into sandbox
  const handleLoadIntoSandbox = () => {
    if (!inspectedExperiment) return;
    setCalcExpected(Number(inspectedExperiment.baseline_lambda.toFixed(4)));
    setCalcAlpha(inspectedExperiment.alpha);
    if (inspectedExperiment.observations.length > 0) {
      setCalcObserved(inspectedExperiment.observations[0].count);
    }
  };

  const selectedObservation: TrafficObservation | undefined =
    inspectedExperiment?.observations[selectedWindowIdx];
  const selectedDetection =
    inspectedExperiment?.detections[selectedWindowIdx];

  const gof =
    distFitParam === 'baseline'
      ? inspectedStats?.goodness_of_fit_baseline
      : inspectedStats?.goodness_of_fit_empirical;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Page Header */}
      <div className="border-b border-[#262a38] pb-6">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-orange-400">
          <span>Primary Page Owner: Shirley S (URK25CS1081)</span>
          <span className="text-slate-500">•</span>
          <span className="text-slate-400">Course 25CS203: Probability and Statistics</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Statistical Intelligence & Model Evaluation
            </h1>
            <p className="text-sm text-slate-400 mt-1 max-w-3xl">
              Comprehensive empirical analysis of completed network experiments, Pearson Chi-Square
              goodness-of-fit testing, exact Garwood Poisson confidence intervals, and publication-ready PDF reporting.
            </p>
          </div>

          {/* Quick PDF Action if experiment selected */}
          {selectedExpId && (
            <button
              onClick={handleDownloadPdfReport}
              disabled={downloadingPdf || loadingStats}
              className="flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-50 transition-all shadow-md self-start sm:self-auto shrink-0"
              title="Generate and download full academic experiment report in PDF"
            >
              {downloadingPdf ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Generating PDF...</span>
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4" />
                  <span>Download PDF Report</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {downloadError && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-950/20 p-3 text-xs text-red-300 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
          <span>{downloadError}</span>
        </div>
      )}

      <div className="mt-6 space-y-8">
        {/* =================================================================== */}
        {/* 1. SAVED EXPERIMENT SELECTOR & ACTION BAR                           */}
        {/* =================================================================== */}
        <div className="rounded-xl border border-purple-500/30 bg-[#14161f] p-5 shadow-lg">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#262a38]">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
                <Database className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Target Experiment For Statistical Diagnosis
                </h2>
                <p className="text-xs text-slate-400">
                  Select a completed run to inspect empirical mean, variance, dispersion ratio (VMR), confidence bounds, and goodness-of-fit.
                </p>
              </div>
            </div>

            {/* Selector Dropdown */}
            <div className="flex items-center gap-3">
              <select
                value={selectedExpId}
                onChange={(e) => handleSelectExperiment(e.target.value)}
                disabled={loadingExpList}
                className="rounded-lg bg-[#0c0d12] border border-[#2d3244] px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500 max-w-xs"
              >
                <option value="">-- Choose a Saved Experiment --</option>
                {experimentList.map((exp) => (
                  <option key={exp.experiment_id} value={exp.experiment_id}>
                    [{exp.experiment_type.toUpperCase()}] {exp.title} ({exp.experiment_id})
                  </option>
                ))}
              </select>
              {selectedExpId && (
                <button
                  onClick={() => handleSelectExperiment('')}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {loadingStats && (
            <div className="py-8 flex items-center justify-center gap-2 text-xs text-purple-400">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span>Computing authoritative statistical diagnostics from persistent observations...</span>
            </div>
          )}

          {inspectedStats && !loadingStats && (
            <div className="mt-4 space-y-4">
              {/* Badges & Meta */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono font-bold text-purple-400 bg-purple-950/40 px-2.5 py-0.5 rounded border border-purple-500/30">
                    {inspectedStats.experiment_id}
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
                      inspectedStats.experiment_type === 'simulation'
                        ? 'bg-orange-500/20 text-orange-400'
                        : 'bg-blue-500/20 text-blue-400'
                    }`}
                  >
                    {inspectedStats.experiment_type}
                  </span>
                  <span className="rounded bg-[#1c1f2b] text-slate-300 font-mono text-[10px] px-2 py-0.5 border border-[#2d3244]">
                    Unit: {inspectedStats.measurement_type}
                  </span>
                  <span className="text-slate-400 text-[11px] truncate max-w-md">
                    {inspectedStats.title}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleExportCsv}
                    className="flex items-center gap-1.5 rounded-lg bg-[#1c1f2b] border border-[#2d3244] px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-[#252a3b] transition-colors"
                  >
                    <Download className="h-3.5 w-3.5 text-orange-400" />
                    <span>Export CSV</span>
                  </button>
                  <button
                    onClick={handleDownloadPdfReport}
                    disabled={downloadingPdf}
                    className="flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-50 transition-colors"
                  >
                    {downloadingPdf ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FileText className="h-3.5 w-3.5" />
                    )}
                    <span>PDF Report</span>
                  </button>
                </div>
              </div>

              {/* ============================================================= */}
              {/* 2. EMPIRICAL STATISTICS 6-CARD GRID                           */}
              {/* ============================================================= */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                  <span className="text-[10px] uppercase text-slate-400 block font-medium">Sample Size (n)</span>
                  <span className="text-base font-bold text-white font-mono mt-0.5 block">
                    {inspectedStats.observation_count}
                  </span>
                  <span className="text-[10px] text-slate-500">W = {inspectedStats.window_seconds}s windows</span>
                </div>

                <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                  <span className="text-[10px] uppercase text-slate-400 block font-medium">Empirical Mean (X̄)</span>
                  <span className="text-base font-bold text-white font-mono mt-0.5 block">
                    {inspectedStats.empirical_mean.toFixed(4)}
                  </span>
                  <span className="text-[10px] text-slate-500">sample average count</span>
                </div>

                <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                  <span className="text-[10px] uppercase text-slate-400 block font-medium">Sample Variance (s²)</span>
                  <span className="text-base font-bold text-white font-mono mt-0.5 block">
                    {inspectedStats.sample_variance.toFixed(4)}
                  </span>
                  <span className="text-[10px] text-slate-500">ddof = 1 unbiased</span>
                </div>

                <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                  <span className="text-[10px] uppercase text-slate-400 block font-medium">Dispersion (D)</span>
                  <span
                    className={`text-base font-bold font-mono mt-0.5 block ${
                      inspectedStats.dispersion_type === 'equidispersed'
                        ? 'text-emerald-400'
                        : inspectedStats.dispersion_type === 'overdispersed'
                        ? 'text-orange-400'
                        : 'text-cyan-400'
                    }`}
                  >
                    {inspectedStats.variance_to_mean_ratio.toFixed(4)}
                  </span>
                  <span className="text-[10px] text-slate-500 uppercase font-medium">
                    {inspectedStats.dispersion_type}
                  </span>
                </div>

                <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                  <span className="text-[10px] uppercase text-slate-400 block font-medium">Calibrated Baseline λ</span>
                  <span className="text-base font-bold text-emerald-400 font-mono mt-0.5 block">
                    {inspectedStats.baseline_lambda.toFixed(4)}
                  </span>
                  <span className="text-[10px] text-slate-500">{inspectedStats.baseline_rate_per_second.toFixed(2)}/sec</span>
                </div>

                <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                  <span className="text-[10px] uppercase text-slate-400 block font-medium">Burst Alerts (p&lt;α)</span>
                  <span className="text-base font-bold text-red-400 font-mono mt-0.5 block">
                    {inspectedStats.original_detected_count}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {((inspectedStats.original_detected_count / Math.max(1, inspectedStats.observation_count)) * 100).toFixed(1)}% of windows
                  </span>
                </div>
              </div>

              {/* Statistical Summary Statement */}
              <div className="rounded-lg bg-[#0e1017] border border-[#262a38] p-3 text-xs text-slate-300">
                <span className="font-semibold text-white block mb-0.5">Authoritative Evaluation Interpretation:</span>
                <p className="text-slate-400 leading-relaxed">{inspectedStats.interpretation_summary}</p>
              </div>

              {/* Ground-Truth Evaluation Metrics if available */}
              {inspectedStats.evaluation && (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 p-3 text-xs">
                  <span className="font-semibold text-emerald-400 block mb-1">
                    Ground-Truth Verified Performance Metrics:
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 font-mono text-slate-300">
                    <div>
                      <span className="text-slate-500 block text-[10px]">TP:</span>
                      <strong className="text-white">{inspectedStats.evaluation.true_positives}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">FP:</span>
                      <strong className="text-white">{inspectedStats.evaluation.false_positives}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">TN:</span>
                      <strong className="text-white">{inspectedStats.evaluation.true_negatives}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">FN:</span>
                      <strong className="text-white">{inspectedStats.evaluation.false_negatives}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">Precision:</span>
                      <strong className="text-white">{(inspectedStats.evaluation.precision * 100).toFixed(1)}%</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">Recall:</span>
                      <strong className="text-white">{(inspectedStats.evaluation.recall * 100).toFixed(1)}%</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">F1-Score:</span>
                      <strong className="text-white">{inspectedStats.evaluation.f1_score.toFixed(3)}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">FPR:</span>
                      <strong className="text-white">{(inspectedStats.evaluation.false_positive_rate * 100).toFixed(1)}%</strong>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {!selectedExpId && (
            <p className="mt-3 text-xs text-slate-500">
              Select an experiment above or navigate from the Dashboard/History page to inspect empirical metrics and model diagnostics.
            </p>
          )}
        </div>

        {/* =================================================================== */}
        {/* 3. BASELINE CONFIDENCE INTERVAL & GOODNESS-OF-FIT CARDS             */}
        {/* =================================================================== */}
        {inspectedStats && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 3A: Baseline Uncertainty & Exact Confidence Interval */}
            <div className="rounded-xl border border-emerald-500/30 bg-[#14161f] p-5 shadow-lg">
              <div className="flex items-center gap-2 pb-3 border-b border-[#262a38]">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    Exact Poisson Baseline Confidence Interval
                  </h3>
                  <span className="text-[11px] text-slate-400">
                    Garwood central chi-square quantile method (95% Coverage)
                  </span>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-slate-400">95% Confidence Bounds for λ:</span>
                  <span className="font-mono text-base font-bold text-emerald-400">
                    [{inspectedStats.confidence_interval.lower_bound.toFixed(4)},{' '}
                    {inspectedStats.confidence_interval.upper_bound.toFixed(4)}]
                  </span>
                </div>

                <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3 text-xs space-y-1.5 font-mono">
                  <div className="flex justify-between text-slate-300">
                    <span className="text-slate-500">Sample Size (n):</span>
                    <span>{inspectedStats.confidence_interval.sample_size} windows</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span className="text-slate-500">Total Observed Arrivals (T):</span>
                    <span>{inspectedStats.confidence_interval.total_arrivals}</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span className="text-slate-500">Point Estimate (T/n):</span>
                    <span className="text-white font-bold">{inspectedStats.confidence_interval.point_estimate.toFixed(4)}</span>
                  </div>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">
                  {inspectedStats.confidence_interval.interpretation}
                </p>

                <div className="rounded border border-blue-500/20 bg-blue-950/20 p-2.5 text-[11px] text-blue-300 flex items-start gap-2">
                  <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Parameter Uncertainty vs Anomaly Threshold:</strong> This interval reflects statistical
                    uncertainty in estimating the baseline mean λ from sample data. It is mathematically distinct from the
                    upper-tail burst detection rule (p &lt; α).
                  </span>
                </div>
              </div>
            </div>

            {/* 3B: Pearson Chi-Square Goodness-of-Fit Diagnostic */}
            <div className="rounded-xl border border-amber-500/30 bg-[#14161f] p-5 shadow-lg">
              <div className="flex items-center justify-between pb-3 border-b border-[#262a38]">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Pearson Chi-Square Goodness-of-Fit
                    </h3>
                    <span className="text-[11px] text-slate-400">
                      Hypothesis test for model distributional suitability
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 text-xs">
                  <button
                    onClick={() => setDistFitParam('baseline')}
                    className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      distFitParam === 'baseline'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        : 'bg-[#1c1f2b] text-slate-400 hover:text-white'
                    }`}
                  >
                    vs Baseline λ
                  </button>
                  <button
                    onClick={() => setDistFitParam('sample')}
                    className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      distFitParam === 'sample'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        : 'bg-[#1c1f2b] text-slate-400 hover:text-white'
                    }`}
                  >
                    vs Sample X̄
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {gof?.is_valid ? (
                  <>
                    <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                      <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-2.5">
                        <span className="text-[10px] text-slate-500 block">Statistic (χ²)</span>
                        <span className="text-base font-bold text-white mt-0.5 block">
                          {gof.chi2_statistic?.toFixed(3)}
                        </span>
                      </div>
                      <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-2.5">
                        <span className="text-[10px] text-slate-500 block">Deg. Freedom (df)</span>
                        <span className="text-base font-bold text-white mt-0.5 block">
                          {gof.degrees_of_freedom}
                        </span>
                      </div>
                      <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-2.5">
                        <span className="text-[10px] text-slate-500 block">p-value</span>
                        <span
                          className={`text-base font-bold mt-0.5 block ${
                            (gof.p_value ?? 0) < 0.05 ? 'text-red-400' : 'text-emerald-400'
                          }`}
                        >
                          {gof.p_value !== null && gof.p_value !== undefined ? formatProbability(gof.p_value) : '—'}
                        </span>
                      </div>
                    </div>

                    <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3 text-xs">
                      <span className="font-semibold text-slate-300 block mb-1">
                        Null Hypothesis (H₀):
                      </span>
                      <p className="text-slate-400 font-mono text-[11px]">{gof.null_hypothesis}</p>
                      <p className="text-slate-300 mt-2 font-sans leading-relaxed">{gof.interpretation}</p>
                    </div>

                    {/* Collapsible Bin Table */}
                    <div className="border border-[#222634] rounded-lg overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setShowBinTable(!showBinTable)}
                        className="w-full flex items-center justify-between px-3 py-2 bg-[#0c0d12] text-xs text-slate-300 hover:text-white"
                      >
                        <span>View {gof.bins_evaluated} Pooled Bins (E ≥ {gof.minimum_expected_frequency})</span>
                        {showBinTable ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                      {showBinTable && (
                        <div className="max-h-40 overflow-y-auto border-t border-[#222634] p-2 text-[11px] font-mono">
                          <table className="w-full text-left">
                            <thead className="text-slate-500 border-b border-[#222634]">
                              <tr>
                                <th className="pb-1">Bin</th>
                                <th className="pb-1">Observed (O)</th>
                                <th className="pb-1">Expected (E)</th>
                                <th className="pb-1 text-right">(O-E)²/E</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#181b26] text-slate-300">
                              {gof.bin_details.map((b, i) => (
                                <tr key={i}>
                                  <td className="py-1">{b.bin_label}</td>
                                  <td className="py-1">{b.observed}</td>
                                  <td className="py-1">{b.expected.toFixed(2)}</td>
                                  <td className="py-1 text-right">{b.chi2_component?.toFixed(3)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-4 text-xs space-y-2">
                    <div className="flex items-center gap-2 text-amber-400 font-semibold">
                      <AlertCircle className="h-4 w-4" />
                      <span>Goodness-of-Fit Test Unavailable</span>
                    </div>
                    <p className="text-slate-400 leading-relaxed">{gof?.interpretation}</p>
                    <p className="text-[11px] text-slate-500">{gof?.explanation}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* 4. EMPIRICAL VS THEORETICAL POISSON DISTRIBUTION EXPLORER           */}
        {/* =================================================================== */}
        {inspectedStats && (
          <div className="rounded-xl border border-[#262a38] bg-[#14161f] p-6 shadow-lg">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-[#262a38]">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <BarChart2 className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Empirical Traffic Distribution vs Fitted Theoretical Poisson PMF
                  </h2>
                  <p className="text-xs text-slate-400">
                    Compare actual observed frequencies (bars) with theoretical Poisson probabilities (curve)
                    at λ = {inspectedStats.baseline_lambda.toFixed(4)}.
                  </p>
                </div>
              </div>

              <span className="rounded bg-[#1c1f2b] border border-[#262a38] px-2.5 py-1 text-[11px] font-mono text-cyan-400">
                P(X = k) = (e^-λ · λ^k) / k!
              </span>
            </div>

            <div className="mt-5 h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={inspectedStats.distribution_fit}
                  margin={{ top: 10, right: 10, left: -15, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2333" />
                  <XAxis
                    dataKey="k"
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    label={{ value: 'Arrival Count per Window (k)', position: 'insideBottom', offset: -4, fill: '#64748b', fontSize: 11 }}
                  />
                  <YAxis
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    label={{ value: 'Probability', angle: -90, position: 'insideLeft', offset: 25, fill: '#64748b', fontSize: 11 }}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="rounded-lg border border-[#2d3244] bg-[#0c0d12] p-3 text-xs shadow-xl font-mono space-y-1">
                          <p className="text-white font-bold">Count k = {d.k}</p>
                          <p className="text-sky-400">
                            Empirical Frequency: {(d.empirical_probability * 100).toFixed(2)}% ({d.observed_count} windows)
                          </p>
                          <p className="text-orange-400">
                            Theoretical Poisson: {(d.theoretical_probability * 100).toFixed(2)}%
                          </p>
                          <p className="text-purple-400">
                            Upper Tail P(X ≥ {d.k}): {formatProbability(d.upper_tail_probability)}
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="empirical_probability"
                    name="Empirical Frequency"
                    fill="#38bdf8"
                    opacity={0.65}
                    radius={[2, 2, 0, 0]}
                  />
                  <Line
                    type="monotone"
                    dataKey="theoretical_probability"
                    name="Theoretical Poisson PMF"
                    stroke="#f97316"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#f97316' }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 bg-[#38bdf8] opacity-70 rounded-sm"></span>
                  <span>Observed Traffic Sample Frequencies</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-0.5 w-3 bg-[#f97316]"></span>
                  <span>Theoretical Poisson(λ = {inspectedStats.baseline_lambda.toFixed(2)}) Curve</span>
                </span>
              </div>
              <span className="text-[11px] text-slate-500 font-mono">
                Sample: {inspectedStats.observation_count} windows
              </span>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* 5. THRESHOLD SENSITIVITY ANALYSIS (DERIVED, NON-MUTATING)           */}
        {/* =================================================================== */}
        {thresholdData && (
          <div className="rounded-xl border border-red-500/30 bg-[#14161f] p-6 shadow-lg">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-[#262a38]">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 text-red-400 border border-red-500/20">
                  <Sliders className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Significance Level Sensitivity Analysis
                  </h2>
                  <p className="text-xs text-slate-400">
                    Recalculate detection decisions across various α thresholds without mutating the saved experiment record.
                  </p>
                </div>
              </div>

              <span className="rounded bg-red-950/40 border border-red-500/30 px-2.5 py-1 text-[11px] font-mono text-red-300">
                Non-Mutating Derived Analysis
              </span>
            </div>

            <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Chart */}
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={thresholdData.points.map((p) => ({
                      alpha: `α=${p.alpha}`,
                      flagged: p.detected_window_count,
                      precision: p.evaluation ? p.evaluation.precision * 100 : null,
                      recall: p.evaluation ? p.evaluation.recall * 100 : null,
                    }))}
                    margin={{ top: 10, right: 10, left: -15, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2333" />
                    <XAxis dataKey="alpha" stroke="#64748b" fontSize={11} tickLine={false} />
                    <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const d = payload[0].payload;
                        return (
                          <div className="rounded-lg border border-[#2d3244] bg-[#0c0d12] p-2.5 text-xs shadow-xl font-mono space-y-1">
                            <p className="text-white font-bold">{d.alpha}</p>
                            <p className="text-red-400">Alert Windows: {d.flagged}</p>
                            {d.precision !== null && (
                              <p className="text-cyan-400">Precision: {d.precision.toFixed(1)}%</p>
                            )}
                            {d.recall !== null && (
                              <p className="text-emerald-400">Recall: {d.recall.toFixed(1)}%</p>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="flagged"
                      name="Alert Windows"
                      stroke="#ef4444"
                      strokeWidth={2}
                      dot={{ r: 4, fill: '#ef4444' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Sensitivity Table */}
              <div className="overflow-x-auto rounded-lg border border-[#222634] bg-[#0c0d12]">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-[#12141c] text-slate-400 border-b border-[#222634] text-[11px] uppercase">
                    <tr>
                      <th className="px-3 py-2.5">Threshold (α)</th>
                      <th className="px-3 py-2.5">Flagged</th>
                      <th className="px-3 py-2.5">Flagged %</th>
                      <th className="px-3 py-2.5">Precision</th>
                      <th className="px-3 py-2.5">Recall</th>
                      <th className="px-3 py-2.5">F1</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#181b26] text-slate-300">
                    {thresholdData.points.map((p, i) => {
                      const isOriginal = p.alpha === thresholdData.original_alpha;
                      return (
                        <tr
                          key={i}
                          className={isOriginal ? 'bg-orange-500/10 font-bold text-orange-300' : 'hover:bg-[#141620]'}
                        >
                          <td className="px-3 py-2">
                            α = {p.alpha} {isOriginal && '(original)'}
                          </td>
                          <td className="px-3 py-2 text-red-400">{p.detected_window_count}</td>
                          <td className="px-3 py-2 text-slate-400">
                            {((p.detected_window_count / Math.max(1, inspectedStats?.observation_count ?? 1)) * 100).toFixed(1)}%
                          </td>
                          <td className="px-3 py-2 text-cyan-300">
                            {p.evaluation ? `${(p.evaluation.precision * 100).toFixed(1)}%` : '—'}
                          </td>
                          <td className="px-3 py-2 text-emerald-300">
                            {p.evaluation ? `${(p.evaluation.recall * 100).toFixed(1)}%` : '—'}
                          </td>
                          <td className="px-3 py-2 text-purple-300">
                            {p.evaluation ? p.evaluation.f1_score.toFixed(3) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="mt-3 text-[11px] text-slate-500 leading-relaxed">
              {thresholdData.note}
            </p>
          </div>
        )}

        {/* =================================================================== */}
        {/* 6. SELECTED OBSERVATION EXPLANATION INSPECTOR                       */}
        {/* =================================================================== */}
        {inspectedExperiment && selectedObservation && selectedDetection && (
          <div className="rounded-xl border border-blue-500/30 bg-[#14161f] p-5 shadow-lg">
            <div className="flex items-center justify-between pb-3 border-b border-[#262a38]">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  <HelpCircle className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    Window Inspection & Mathematical Decision Reasoning
                  </h3>
                  <span className="text-[11px] text-slate-400">
                    Step-by-step upper-tail probability derivation for window #{selectedWindowIdx + 1}
                  </span>
                </div>
              </div>

              {/* Scrubber Controls */}
              <div className="flex items-center gap-2 text-xs">
                <button
                  onClick={() => setSelectedWindowIdx((idx) => Math.max(0, idx - 1))}
                  disabled={selectedWindowIdx === 0}
                  className="rounded px-2.5 py-1 bg-[#1c1f2b] border border-[#2d3244] text-slate-300 hover:text-white disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="font-mono text-slate-400 text-xs">
                  {selectedWindowIdx + 1} / {inspectedExperiment.observations.length}
                </span>
                <button
                  onClick={() =>
                    setSelectedWindowIdx((idx) =>
                      Math.min(inspectedExperiment.observations.length - 1, idx + 1)
                    )
                  }
                  disabled={selectedWindowIdx === inspectedExperiment.observations.length - 1}
                  className="rounded px-2.5 py-1 bg-[#1c1f2b] border border-[#2d3244] text-slate-300 hover:text-white disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
              <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                <span className="text-[10px] text-slate-500 uppercase block">Observed Count (x)</span>
                <span className="text-lg font-bold text-white font-mono mt-0.5 block">
                  {selectedObservation.count}
                </span>
                <span className="text-[10px] text-slate-500">{inspectedExperiment.measurement_type}</span>
              </div>

              <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                <span className="text-[10px] text-slate-500 uppercase block">Expected Baseline (λ)</span>
                <span className="text-lg font-bold text-emerald-400 font-mono mt-0.5 block">
                  {inspectedExperiment.baseline_lambda.toFixed(4)}
                </span>
                <span className="text-[10px] text-slate-500">counts / window</span>
              </div>

              <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                <span className="text-[10px] text-slate-500 uppercase block">Upper Tail P(X ≥ x)</span>
                <span
                  className={`text-lg font-bold font-mono mt-0.5 block ${
                    selectedDetection.is_burst ? 'text-red-400' : 'text-slate-300'
                  }`}
                >
                  {formatProbability(selectedDetection.p_value)}
                </span>
                <span className="text-[10px] text-slate-500">vs α = {selectedDetection.alpha}</span>
              </div>

              <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                <span className="text-[10px] text-slate-500 uppercase block">Decision</span>
                <span
                  className={`text-lg font-bold font-mono mt-0.5 block ${
                    selectedDetection.is_burst ? 'text-red-400' : 'text-emerald-400'
                  }`}
                >
                  {selectedDetection.is_burst ? 'BURST ALERT' : 'NORMAL'}
                </span>
                <span className="text-[10px] text-slate-500">
                  {selectedDetection.is_burst ? 'p < α (Statistically Unusual)' : 'p ≥ α (Consistent with Baseline)'}
                </span>
              </div>
            </div>

            <div className="mt-3 rounded-lg bg-[#0e1017] border border-[#222634] p-3 text-xs text-slate-300 font-mono space-y-1">
              <p className="text-slate-400">
                <strong>Mathematical Reasoning:</strong> Under H₀: X ~ Poisson(λ = {inspectedExperiment.baseline_lambda.toFixed(4)}),
                the probability of observing {selectedObservation.count} or more arrivals in this {inspectedExperiment.window_seconds}s window is{' '}
                <span className="text-white font-bold">{formatProbability(selectedDetection.p_value)}</span>.
              </p>
              <p className="text-slate-400">
                Comparison: {formatProbability(selectedDetection.p_value)}{' '}
                {selectedDetection.is_burst ? '<' : '≥'} {selectedDetection.alpha} (α) ➔{' '}
                <span className={selectedDetection.is_burst ? 'text-red-400 font-bold' : 'text-emerald-400 font-bold'}>
                  {selectedDetection.is_burst ? 'Flagged as unusual burst' : 'Not flagged (within expected Poisson variation)'}
                </span>.
              </p>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* 7. INTERACTIVE HYPOTHETICAL SANDBOX (ISOLATED FROM PERSISTENCE)     */}
        {/* =================================================================== */}
        <div className="rounded-xl border border-[#262a38] bg-[#14161f] p-6 shadow-lg">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-[#262a38]">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/10 text-orange-400 border border-orange-500/20">
                <Calculator className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-white">
                  Interactive Hypothetical Sandbox
                </h2>
                <p className="text-xs text-slate-400">
                  Test custom theoretical arrival rates and counts in an isolated scratchpad separate from persistent records.
                </p>
              </div>
            </div>

            {inspectedExperiment && (
              <button
                type="button"
                onClick={handleLoadIntoSandbox}
                className="flex items-center gap-1.5 rounded-md bg-[#1c1f2b] border border-[#2d3244] px-3 py-1.5 text-xs text-orange-300 hover:text-white"
              >
                <span>Copy λ={inspectedExperiment.baseline_lambda.toFixed(2)} into Sandbox</span>
              </button>
            )}
          </div>

          <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left: Upper Tail Calculator */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <span>Poisson Upper-Tail Calculator</span>
                <span className="font-mono text-[10px] text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/30">
                  /api/poisson/detect
                </span>
              </h3>

              {calcError && (
                <div className="rounded border border-red-500/30 bg-red-950/20 p-2.5 text-xs text-red-300">
                  {calcError}
                </div>
              )}

              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">Observed (x)</label>
                  <input
                    type="number"
                    min="0"
                    value={calcObserved}
                    onChange={(e) => setCalcObserved(Number(e.target.value))}
                    className="w-full rounded bg-[#0c0d12] border border-[#2d3244] px-2.5 py-1.5 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Expected Rate (λ)</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.5"
                    value={calcExpected}
                    onChange={(e) => setCalcExpected(Number(e.target.value))}
                    className="w-full rounded bg-[#0c0d12] border border-[#2d3244] px-2.5 py-1.5 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Alpha (α)</label>
                  <select
                    value={calcAlpha}
                    onChange={(e) => setCalcAlpha(Number(e.target.value))}
                    className="w-full rounded bg-[#0c0d12] border border-[#2d3244] px-2.5 py-1.5 text-white font-mono"
                  >
                    <option value={0.10}>0.10 (10%)</option>
                    <option value={0.05}>0.05 (5%)</option>
                    <option value={0.01}>0.01 (1%)</option>
                    <option value={0.005}>0.005 (0.5%)</option>
                    <option value={0.001}>0.001 (0.1%)</option>
                  </select>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCalculateProbability}
                disabled={calcLoading}
                className="w-full rounded bg-orange-600 hover:bg-orange-500 py-2 text-xs font-semibold text-white transition-colors"
              >
                {calcLoading ? 'Computing...' : 'Calculate P(X ≥ x | λ)'}
              </button>

              {calcResult && (
                <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3 text-xs font-mono space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-400">p-value:</span>
                    <span className={calcResult.is_burst ? 'text-red-400 font-bold' : 'text-emerald-400 font-bold'}>
                      {formatProbability(calcResult.p_value)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Decision:</span>
                    <span className={calcResult.is_burst ? 'text-red-400 font-bold' : 'text-emerald-400 font-bold'}>
                      {calcResult.is_burst ? 'FLAGGED (p < α)' : 'NORMAL (p ≥ α)'}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Right: Custom Sequence Dispersion Sandbox */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <span>Sample Dispersion & VMR Scratchpad</span>
                <span className="font-mono text-[10px] text-cyan-400 bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-500/30">
                  /api/poisson/dispersion
                </span>
              </h3>

              {dispError && (
                <div className="rounded border border-red-500/30 bg-red-950/20 p-2.5 text-xs text-red-300">
                  {dispError}
                </div>
              )}

              <div>
                <label className="block text-xs text-slate-400 mb-1">Comma-separated counts:</label>
                <input
                  type="text"
                  value={sampleInput}
                  onChange={(e) => setSampleInput(e.target.value)}
                  className="w-full rounded bg-[#0c0d12] border border-[#2d3244] px-2.5 py-1.5 text-white font-mono text-xs"
                />
              </div>

              <button
                type="button"
                onClick={handleAnalyzeDispersion}
                disabled={dispLoading}
                className="w-full rounded bg-cyan-600 hover:bg-cyan-500 py-2 text-xs font-semibold text-white transition-colors"
              >
                {dispLoading ? 'Analyzing...' : 'Calculate Mean, Variance & VMR'}
              </button>

              {dispResult && (
                <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3 text-xs font-mono space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Mean (X̄):</span>
                    <span className="text-white">{dispResult.sample_mean.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Variance (s²):</span>
                    <span className="text-white">{dispResult.sample_variance.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">VMR (s²/X̄):</span>
                    <span className={dispResult.dispersion_type === 'equidispersed' ? 'text-emerald-400' : 'text-orange-400'}>
                      {dispResult.variance_to_mean_ratio.toFixed(4)} ({dispResult.dispersion_type})
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StatisticalAnalysisPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#0a0b0e] text-slate-400">
          <div className="flex items-center gap-3">
            <RefreshCw className="h-5 w-5 animate-spin text-orange-500" />
            <span className="text-sm font-medium">Loading Statistical Analysis Lab...</span>
          </div>
        </div>
      }
    >
      <StatisticalAnalysisContent />
    </Suspense>
  );
}
