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
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';

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
    <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Page Header */}
      <PageHeader
        title="Statistical Intelligence & Model Evaluation"
        subtitle="Comprehensive empirical analysis of completed network experiments, Pearson Chi-Square goodness-of-fit testing, exact Garwood Poisson confidence intervals, and publication-ready PDF reporting."
        badge="25CS203 Micro-Project"
        actions={
          selectedExpId ? (
            <button
              onClick={handleDownloadPdfReport}
              disabled={downloadingPdf || loadingStats}
              className="btn-primary"
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
          ) : undefined
        }
      />

      {downloadError && (
        <div className="rounded-lg border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.08)] p-3 text-xs text-red-300 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-[#ef4444] shrink-0" />
          <span>{downloadError}</span>
        </div>
      )}

      {/* 1. SAVED EXPERIMENT SELECTOR & ACTION BAR */}
      <div className="rounded-lg border border-[#292929] bg-[#141414] p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#292929]">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[rgba(255,106,0,0.1)] text-[#FF6A00] border border-[rgba(255,106,0,0.25)]">
              <Database className="h-4 w-4" />
            </div>
            <div>
              <h2 className="font-heading text-sm font-semibold text-[#F5F5F5]">
                Target Experiment For Statistical Diagnosis
              </h2>
              <p className="text-xs text-[#737373]">
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
              className="rounded-md bg-[#101010] border border-[#292929] px-3 py-1.5 text-xs text-[#F5F5F5] focus:border-[#FF6A00] focus:outline-none max-w-xs font-mono"
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
                className="text-xs text-[#737373] hover:text-[#F5F5F5] transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {loadingStats && (
          <div className="py-8 flex items-center justify-center gap-2 text-xs text-[#FF6A00]">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span>Computing authoritative statistical diagnostics from persistent observations...</span>
          </div>
        )}

        {inspectedStats && !loadingStats && (
          <div className="space-y-4">
            {/* Badges & Meta */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono font-bold text-[#FF6A00] bg-[rgba(255,106,0,0.1)] px-2.5 py-0.5 rounded border border-[rgba(255,106,0,0.3)]">
                  {inspectedStats.experiment_id}
                </span>
                <StatusBadge
                  label={inspectedStats.experiment_type}
                  variant={inspectedStats.experiment_type === 'simulation' ? 'accent' : (inspectedStats.experiment_type === 'hardware' ? 'warning' : 'neutral')}
                />
                <span className="rounded bg-[#101010] text-[#A3A3A3] font-mono text-[10px] px-2 py-0.5 border border-[#292929]">
                  Unit: {inspectedStats.measurement_type}
                </span>
                <span className="text-[#A3A3A3] text-xs truncate max-w-md">
                  {inspectedStats.title}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportCsv}
                  className="btn-secondary text-xs"
                >
                  <Download className="h-3.5 w-3.5 text-[#A3A3A3]" />
                  <span>Export CSV</span>
                </button>
                <button
                  onClick={handleDownloadPdfReport}
                  disabled={downloadingPdf}
                  className="btn-primary text-xs"
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

            {/* 2. EMPIRICAL STATISTICS 6-CARD GRID */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="rounded-md bg-[#101010] border border-[#292929] p-3">
                <span className="stat-label block">Sample Size (n)</span>
                <span className="stat-value text-base text-[#F5F5F5] mt-1 block">
                  {inspectedStats.observation_count}
                </span>
                <span className="stat-helper block">W = {inspectedStats.window_seconds}s windows</span>
              </div>

              <div className="rounded-md bg-[#101010] border border-[#292929] p-3">
                <span className="stat-label block">Empirical Mean (X̄)</span>
                <span className="stat-value text-base text-[#F5F5F5] mt-1 block">
                  {inspectedStats.empirical_mean.toFixed(4)}
                </span>
                <span className="stat-helper block">sample average count</span>
              </div>

              <div className="rounded-md bg-[#101010] border border-[#292929] p-3">
                <span className="stat-label block">Sample Variance (s²)</span>
                <span className="stat-value text-base text-[#F5F5F5] mt-1 block">
                  {inspectedStats.sample_variance.toFixed(4)}
                </span>
                <span className="stat-helper block">ddof = 1 unbiased</span>
              </div>

              <div className="rounded-md bg-[#101010] border border-[#292929] p-3">
                <span className="stat-label block">Dispersion (D)</span>
                <span
                  className={`stat-value text-base mt-1 block ${
                    inspectedStats.dispersion_type === 'equidispersed'
                      ? 'text-emerald-400'
                      : inspectedStats.dispersion_type === 'overdispersed'
                      ? 'text-[#FF6A00]'
                      : 'text-[#F5F5F5]'
                  }`}
                >
                  {inspectedStats.variance_to_mean_ratio.toFixed(4)}
                </span>
                <span className="stat-helper uppercase block font-medium">
                  {inspectedStats.dispersion_type}
                </span>
              </div>

              <div className="rounded-md bg-[#101010] border border-[#292929] p-3">
                <span className="stat-label block">Calibrated Baseline λ</span>
                <span className="stat-value text-base text-emerald-400 mt-1 block">
                  {inspectedStats.baseline_lambda.toFixed(4)}
                </span>
                <span className="stat-helper block">{inspectedStats.baseline_rate_per_second.toFixed(2)}/sec</span>
              </div>

              <div className="rounded-md bg-[#101010] border border-[#292929] p-3">
                <span className="stat-label block">Burst Alerts (p&lt;α)</span>
                <span className="stat-value text-base text-[#ef4444] mt-1 block">
                  {inspectedStats.original_detected_count}
                </span>
                <span className="stat-helper block">
                  {((inspectedStats.original_detected_count / Math.max(1, inspectedStats.observation_count)) * 100).toFixed(1)}% of windows
                </span>
              </div>
            </div>

            {/* Statistical Summary Statement */}
            <div className="rounded-md bg-[#101010] border border-[#292929] p-3.5 text-xs text-[#A3A3A3]">
              <span className="font-semibold text-[#F5F5F5] block mb-0.5">Authoritative Evaluation Interpretation:</span>
              <p className="leading-relaxed">{inspectedStats.interpretation_summary}</p>
            </div>

            {/* Ground-Truth Evaluation Metrics if available */}
            {inspectedStats.evaluation && (
              <div className="rounded-md border border-[rgba(34,197,94,0.25)] bg-[rgba(34,197,94,0.05)] p-3.5 text-xs">
                <span className="font-semibold text-emerald-400 block mb-2">
                  Ground-Truth Verified Performance Metrics:
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 font-mono text-[#A3A3A3]">
                  <div>
                    <span className="text-[#737373] block text-[10px]">TP:</span>
                    <strong className="text-[#F5F5F5]">{inspectedStats.evaluation.true_positives}</strong>
                  </div>
                  <div>
                    <span className="text-[#737373] block text-[10px]">FP:</span>
                    <strong className="text-[#F5F5F5]">{inspectedStats.evaluation.false_positives}</strong>
                  </div>
                  <div>
                    <span className="text-[#737373] block text-[10px]">TN:</span>
                    <strong className="text-[#F5F5F5]">{inspectedStats.evaluation.true_negatives}</strong>
                  </div>
                  <div>
                    <span className="text-[#737373] block text-[10px]">FN:</span>
                    <strong className="text-[#F5F5F5]">{inspectedStats.evaluation.false_negatives}</strong>
                  </div>
                  <div>
                    <span className="text-[#737373] block text-[10px]">Precision:</span>
                    <strong className="text-[#F5F5F5]">{(inspectedStats.evaluation.precision * 100).toFixed(1)}%</strong>
                  </div>
                  <div>
                    <span className="text-[#737373] block text-[10px]">Recall:</span>
                    <strong className="text-[#F5F5F5]">{(inspectedStats.evaluation.recall * 100).toFixed(1)}%</strong>
                  </div>
                  <div>
                    <span className="text-[#737373] block text-[10px]">F1-Score:</span>
                    <strong className="text-[#F5F5F5]">{inspectedStats.evaluation.f1_score.toFixed(3)}</strong>
                  </div>
                  <div>
                    <span className="text-[#737373] block text-[10px]">FPR:</span>
                    <strong className="text-[#F5F5F5]">{(inspectedStats.evaluation.false_positive_rate * 100).toFixed(1)}%</strong>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {!selectedExpId && (
          <p className="text-xs text-[#737373]">
            Select an experiment above or navigate from the Dashboard/History page to inspect empirical metrics and model diagnostics.
          </p>
        )}
      </div>

      {/* 3. BASELINE CONFIDENCE INTERVAL & GOODNESS-OF-FIT CARDS */}
      {inspectedStats && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 3A: Baseline Uncertainty & Exact Confidence Interval */}
          <div className="rounded-lg border border-[#292929] bg-[#141414] p-5 space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-[#292929]">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[rgba(34,197,94,0.1)] text-emerald-400 border border-[rgba(34,197,94,0.25)]">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-heading text-sm font-semibold text-[#F5F5F5]">
                  Exact Poisson Baseline Confidence Interval
                </h3>
                <span className="text-[11px] text-[#737373]">
                  Garwood central chi-square quantile method (95% Coverage)
                </span>
              </div>
            </div>

            <div className="space-y-3">
              {inspectedStats.confidence_interval.is_valid ? (
                <>
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-[#A3A3A3]">95% Confidence Bounds for Baseline λ:</span>
                    <span className="font-mono text-base font-bold text-emerald-400">
                      [{inspectedStats.confidence_interval.lower_bound.toFixed(4)},{' '}
                      {inspectedStats.confidence_interval.upper_bound.toFixed(4)}]
                    </span>
                  </div>

                  <div className="rounded-md bg-[#101010] border border-[#292929] p-3 text-xs space-y-1.5 font-mono">
                    <div className="flex justify-between text-[#A3A3A3]">
                      <span className="text-[#737373]">Calibration Windows (n):</span>
                      <span>{inspectedStats.confidence_interval.sample_size} windows</span>
                    </div>
                    <div className="flex justify-between text-[#A3A3A3]">
                      <span className="text-[#737373]">Calibration Arrivals (T):</span>
                      <span>{inspectedStats.confidence_interval.total_arrivals}</span>
                    </div>
                    <div className="flex justify-between text-[#A3A3A3]">
                      <span className="text-[#737373]">Point Estimate (T/n):</span>
                      <span className="text-[#F5F5F5] font-bold">{inspectedStats.confidence_interval.point_estimate.toFixed(4)}</span>
                    </div>
                  </div>

                  <p className="text-xs text-[#A3A3A3] leading-relaxed">
                    {inspectedStats.confidence_interval.interpretation}
                  </p>
                </>
              ) : (
                <div className="rounded-md bg-[#101010] border border-[#f59e0b]/30 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#f59e0b]">Baseline Interval Unavailable</span>
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20">
                      Non-Stationary / Violates Model
                    </span>
                  </div>
                  <p className="text-xs text-[#A3A3A3] leading-relaxed">
                    {inspectedStats.confidence_interval.explanation || inspectedStats.confidence_interval.interpretation}
                  </p>
                </div>
              )}

              {inspectedStats.confidence_interval_empirical && inspectedStats.confidence_interval_empirical.is_valid && (
                <div className="rounded-md bg-[#101010] border border-[#292929] p-3 space-y-1.5">
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-[#737373]">Empirical Sample Mean Interval (All Windows):</span>
                    <span className="font-mono text-xs font-semibold text-[#F5F5F5]">
                      [{inspectedStats.confidence_interval_empirical.lower_bound.toFixed(4)},{' '}
                      {inspectedStats.confidence_interval_empirical.upper_bound.toFixed(4)}]
                    </span>
                  </div>
                  <p className="text-[11px] text-[#737373] leading-snug">
                    Point estimate: {inspectedStats.confidence_interval_empirical.point_estimate.toFixed(4)} ({inspectedStats.confidence_interval_empirical.sample_size} windows). Reflects overall sample arrival intensity across all traffic, not the isolated baseline.
                  </p>
                </div>
              )}

              <div className="rounded border border-[#292929] bg-[#101010] p-3 text-xs text-[#A3A3A3] flex items-start gap-2">
                <Info className="h-4 w-4 text-[#A3A3A3] shrink-0 mt-0.5" />
                <span>
                  <strong className="text-[#F5F5F5]">Parameter Uncertainty vs Anomaly Threshold:</strong> This interval measures
                  statistical uncertainty in the baseline mean λ from representative calibration data. It is mathematically distinct from the
                  upper-tail burst detection rule (p &lt; α).
                </span>
              </div>
            </div>
          </div>

          {/* 3B: Pearson Chi-Square Goodness-of-Fit Diagnostic */}
          <div className="rounded-lg border border-[#292929] bg-[#141414] p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#292929]">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[rgba(255,106,0,0.1)] text-[#FF6A00] border border-[rgba(255,106,0,0.25)]">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-heading text-sm font-semibold text-[#F5F5F5]">
                    Pearson Chi-Square Goodness-of-Fit
                  </h3>
                  <span className="text-[11px] text-[#737373]">
                    Hypothesis test for model distributional suitability
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-xs">
                <button
                  onClick={() => setDistFitParam('baseline')}
                  className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    distFitParam === 'baseline'
                      ? 'bg-[rgba(255,106,0,0.15)] text-[#FF6A00] border border-[#FF6A00]'
                      : 'bg-[#101010] border border-[#292929] text-[#737373] hover:text-[#F5F5F5]'
                  }`}
                >
                  vs Baseline λ
                </button>
                <button
                  onClick={() => setDistFitParam('sample')}
                  className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    distFitParam === 'sample'
                      ? 'bg-[rgba(255,106,0,0.15)] text-[#FF6A00] border border-[#FF6A00]'
                      : 'bg-[#101010] border border-[#292929] text-[#737373] hover:text-[#F5F5F5]'
                  }`}
                >
                  vs Sample X̄
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {gof?.is_valid ? (
                <>
                  <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                    <div className="rounded-md bg-[#101010] border border-[#292929] p-2.5">
                      <span className="text-[10px] text-[#737373] block">Statistic (χ²)</span>
                      <span className="text-base font-bold text-[#F5F5F5] mt-0.5 block">
                        {gof.chi2_statistic?.toFixed(3)}
                      </span>
                    </div>
                    <div className="rounded-md bg-[#101010] border border-[#292929] p-2.5">
                      <span className="text-[10px] text-[#737373] block">Deg. Freedom (df)</span>
                      <span className="text-base font-bold text-[#F5F5F5] mt-0.5 block">
                        {gof.degrees_of_freedom}
                      </span>
                    </div>
                    <div className="rounded-md bg-[#101010] border border-[#292929] p-2.5">
                      <span className="text-[10px] text-[#737373] block">p-value</span>
                      <span
                        className={`text-base font-bold mt-0.5 block ${
                          (gof.p_value ?? 0) < 0.05 ? 'text-[#ef4444]' : 'text-emerald-400'
                        }`}
                      >
                        {gof.p_value !== null && gof.p_value !== undefined ? formatProbability(gof.p_value) : '—'}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-md bg-[#101010] border border-[#292929] p-3 text-xs space-y-1">
                    <span className="font-semibold text-[#A3A3A3] block">
                      Null Hypothesis (H₀):
                    </span>
                    <p className="text-[#737373] font-mono text-[11px]">{gof.null_hypothesis}</p>
                    <p className="text-[#A3A3A3] font-sans leading-relaxed pt-1">{gof.interpretation}</p>
                  </div>

                  {/* Collapsible Bin Table */}
                  <div className="border border-[#292929] rounded-md overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowBinTable(!showBinTable)}
                      className="w-full flex items-center justify-between px-3 py-2 bg-[#101010] text-xs text-[#A3A3A3] hover:text-[#F5F5F5]"
                    >
                      <span>View {gof.bins_evaluated} Pooled Bins (E ≥ {gof.minimum_expected_frequency})</span>
                      {showBinTable ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                    {showBinTable && (
                      <div className="max-h-40 overflow-y-auto border-t border-[#292929] p-2 text-[11px] font-mono">
                        <table className="w-full text-left">
                          <thead className="text-[#737373] border-b border-[#292929]">
                            <tr>
                              <th className="pb-1">Bin</th>
                              <th className="pb-1">Observed (O)</th>
                              <th className="pb-1">Expected (E)</th>
                              <th className="pb-1 text-right">(O-E)²/E</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#202020] text-[#A3A3A3]">
                            {gof.bin_details.map((b, i) => (
                              <tr key={i}>
                                <td className="py-1">{b.bin_label}</td>
                                <td className="py-1 text-[#F5F5F5]">{b.observed}</td>
                                <td className="py-1">{b.expected.toFixed(2)}</td>
                                <td className="py-1 text-right text-[#FF6A00]">{b.chi2_component?.toFixed(3)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="rounded-md bg-[#101010] border border-[#292929] p-4 text-xs space-y-2">
                  <div className="flex items-center gap-2 text-[#FF6A00] font-semibold">
                    <AlertCircle className="h-4 w-4" />
                    <span>Goodness-of-Fit Test Unavailable</span>
                  </div>
                  <p className="text-[#A3A3A3] leading-relaxed">{gof?.interpretation}</p>
                  <p className="text-[11px] text-[#737373]">{gof?.explanation}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 4. EMPIRICAL VS THEORETICAL POISSON DISTRIBUTION EXPLORER */}
      {inspectedStats && (
        <div className="rounded-lg border border-[#292929] bg-[#141414] p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-[#292929]">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[rgba(255,106,0,0.1)] text-[#FF6A00] border border-[rgba(255,106,0,0.25)]">
                <BarChart2 className="h-4 w-4" />
              </div>
              <div>
                <h2 className="font-heading text-sm font-semibold text-[#F5F5F5]">
                  Empirical Traffic Distribution vs Fitted Theoretical Poisson PMF
                </h2>
                <p className="text-xs text-[#737373]">
                  Compare actual observed frequencies (bars) with theoretical Poisson probabilities (curve)
                  at λ = {inspectedStats.baseline_lambda.toFixed(4)}.
                </p>
              </div>
            </div>

            <span className="rounded bg-[#101010] border border-[#292929] px-2.5 py-1 text-[11px] font-mono text-[#FF6A00]">
              P(X = k) = (e^-λ · λ^k) / k!
            </span>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={inspectedStats.distribution_fit}
                margin={{ top: 10, right: 10, left: -15, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#292929" />
                <XAxis
                  dataKey="k"
                  stroke="#737373"
                  fontSize={11}
                  fontFamily="var(--font-mono)"
                  tickLine={false}
                  label={{ value: 'Arrival Count per Window (k)', position: 'insideBottom', offset: -4, fill: '#737373', fontSize: 11 }}
                />
                <YAxis
                  stroke="#737373"
                  fontSize={11}
                  fontFamily="var(--font-mono)"
                  tickLine={false}
                  label={{ value: 'Probability', angle: -90, position: 'insideLeft', offset: 25, fill: '#737373', fontSize: 11 }}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || !payload.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="rounded-lg border border-[#383838] bg-[#141414] p-3 text-xs shadow-2xl font-mono space-y-1">
                        <p className="text-[#F5F5F5] font-bold">Count k = {d.k}</p>
                        <p className="text-[#A3A3A3]">
                          Empirical Frequency: {(d.empirical_probability * 100).toFixed(2)}% ({d.observed_count} windows)
                        </p>
                        <p className="text-[#FF6A00]">
                          Theoretical Poisson: {(d.theoretical_probability * 100).toFixed(2)}%
                        </p>
                        <p className="text-[#A3A3A3]">
                          Upper Tail P(X ≥ {d.k}): {formatProbability(d.upper_tail_probability)}
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="empirical_probability"
                  name="Empirical Frequency"
                  fill="#A3A3A3"
                  opacity={0.4}
                  radius={[2, 2, 0, 0]}
                />
                <Line
                  type="monotone"
                  dataKey="theoretical_probability"
                  name="Theoretical Poisson PMF"
                  stroke="#FF6A00"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#FF6A00' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="flex items-center justify-between text-xs text-[#737373]">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 bg-[#A3A3A3] opacity-50 rounded-sm"></span>
                <span>Observed Traffic Sample Frequencies</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-3 bg-[#FF6A00]"></span>
                <span>Theoretical Poisson(λ = {inspectedStats.baseline_lambda.toFixed(2)}) Curve</span>
              </span>
            </div>
            <span className="text-[11px] font-mono">
              Sample: {inspectedStats.observation_count} windows
            </span>
          </div>
        </div>
      )}

      {/* 5. THRESHOLD SENSITIVITY ANALYSIS */}
      {thresholdData && (
        <div className="rounded-lg border border-[#292929] bg-[#141414] p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-[#292929]">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[rgba(255,106,0,0.1)] text-[#FF6A00] border border-[rgba(255,106,0,0.25)]">
                <Sliders className="h-4 w-4" />
              </div>
              <div>
                <h2 className="font-heading text-sm font-semibold text-[#F5F5F5]">
                  Significance Level Sensitivity Analysis
                </h2>
                <p className="text-xs text-[#737373]">
                  Recalculate detection decisions across various α thresholds without mutating the saved experiment record.
                </p>
              </div>
            </div>

            <span className="rounded bg-[#101010] border border-[#292929] px-2.5 py-1 text-[11px] font-mono text-[#A3A3A3]">
              Non-Mutating Derived Analysis
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#292929" />
                  <XAxis dataKey="alpha" stroke="#737373" fontSize={11} font-family="var(--font-mono)" tickLine={false} />
                  <YAxis stroke="#737373" fontSize={11} font-family="var(--font-mono)" tickLine={false} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="rounded-lg border border-[#383838] bg-[#141414] p-2.5 text-xs shadow-2xl font-mono space-y-1">
                          <p className="text-[#F5F5F5] font-bold">{d.alpha}</p>
                          <p className="text-[#ef4444]">Alert Windows: {d.flagged}</p>
                          {d.precision !== null && (
                            <p className="text-[#A3A3A3]">Precision: {d.precision.toFixed(1)}%</p>
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
            <div className="overflow-x-auto rounded-md border border-[#292929] bg-[#101010]">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#141414] text-[#737373] border-b border-[#292929] text-[11px] uppercase">
                  <tr>
                    <th className="px-3 py-2.5">Threshold (α)</th>
                    <th className="px-3 py-2.5">Flagged</th>
                    <th className="px-3 py-2.5">Flagged %</th>
                    <th className="px-3 py-2.5">Precision</th>
                    <th className="px-3 py-2.5">Recall</th>
                    <th className="px-3 py-2.5">F1</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#202020] text-[#A3A3A3]">
                  {thresholdData.points.map((p, i) => {
                    const isOriginal = p.alpha === thresholdData.original_alpha;
                    return (
                      <tr
                        key={i}
                        className={isOriginal ? 'bg-[rgba(255,106,0,0.08)] font-bold text-[#FF6A00]' : 'hover:bg-[#191919]'}
                      >
                        <td className="px-3 py-2">
                          α = {p.alpha} {isOriginal && '(original)'}
                        </td>
                        <td className="px-3 py-2 text-[#ef4444]">{p.detected_window_count}</td>
                        <td className="px-3 py-2 text-[#737373]">
                          {((p.detected_window_count / Math.max(1, inspectedStats?.observation_count ?? 1)) * 100).toFixed(1)}%
                        </td>
                        <td className="px-3 py-2 text-[#F5F5F5]">
                          {p.evaluation ? `${(p.evaluation.precision * 100).toFixed(1)}%` : '—'}
                        </td>
                        <td className="px-3 py-2 text-emerald-400">
                          {p.evaluation ? `${(p.evaluation.recall * 100).toFixed(1)}%` : '—'}
                        </td>
                        <td className="px-3 py-2 text-[#FF6A00]">
                          {p.evaluation ? p.evaluation.f1_score.toFixed(3) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[11px] text-[#737373] leading-relaxed">
            {thresholdData.note}
          </p>
        </div>
      )}

      {/* 6. SELECTED OBSERVATION EXPLANATION INSPECTOR */}
      {inspectedExperiment && selectedObservation && selectedDetection && (
        <div className="rounded-lg border border-[#292929] bg-[#141414] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#292929]">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[rgba(255,106,0,0.1)] text-[#FF6A00] border border-[rgba(255,106,0,0.25)]">
                <HelpCircle className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-heading text-sm font-semibold text-[#F5F5F5]">
                  Window Inspection &amp; Mathematical Decision Reasoning
                </h3>
                <span className="text-[11px] text-[#737373]">
                  Step-by-step upper-tail probability derivation for window #{selectedWindowIdx + 1}
                </span>
              </div>
            </div>

            {/* Scrubber Controls */}
            <div className="flex items-center gap-2 text-xs">
              <button
                onClick={() => setSelectedWindowIdx((idx) => Math.max(0, idx - 1))}
                disabled={selectedWindowIdx === 0}
                className="btn-secondary py-1 px-2.5 text-xs"
              >
                Previous
              </button>
              <span className="font-mono text-[#A3A3A3] text-xs">
                {selectedWindowIdx + 1} / {inspectedExperiment.observations.length}
              </span>
              <button
                onClick={() =>
                  setSelectedWindowIdx((idx) =>
                    Math.min(inspectedExperiment.observations.length - 1, idx + 1)
                  )
                }
                disabled={selectedWindowIdx === inspectedExperiment.observations.length - 1}
                className="btn-secondary py-1 px-2.5 text-xs"
              >
                Next
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="rounded-md bg-[#101010] border border-[#292929] p-3">
              <span className="stat-label block">Observed Count (x)</span>
              <span className="stat-value text-lg text-[#F5F5F5] mt-1 block">
                {selectedObservation.count}
              </span>
              <span className="stat-helper block">{inspectedExperiment.measurement_type}</span>
            </div>

            <div className="rounded-md bg-[#101010] border border-[#292929] p-3">
              <span className="stat-label block">Expected Baseline (λ)</span>
              <span className="stat-value text-lg text-emerald-400 mt-1 block">
                {inspectedExperiment.baseline_lambda.toFixed(4)}
              </span>
              <span className="stat-helper block">counts / window</span>
            </div>

            <div className="rounded-md bg-[#101010] border border-[#292929] p-3">
              <span className="stat-label block">Upper Tail P(X ≥ x)</span>
              <span
                className={`stat-value text-lg mt-1 block ${
                  selectedDetection.is_burst ? 'text-[#ef4444]' : 'text-[#F5F5F5]'
                }`}
              >
                {formatProbability(selectedDetection.p_value)}
              </span>
              <span className="stat-helper block">vs α = {selectedDetection.alpha}</span>
            </div>

            <div className="rounded-md bg-[#101010] border border-[#292929] p-3">
              <span className="stat-label block">Decision</span>
              <span
                className={`stat-value text-lg mt-1 block ${
                  selectedDetection.is_burst ? 'text-[#ef4444]' : 'text-emerald-400'
                }`}
              >
                {selectedDetection.is_burst ? 'BURST ALERT' : 'NORMAL'}
              </span>
              <span className="stat-helper block">
                {selectedDetection.is_burst ? 'p < α (Unusual burst)' : 'p ≥ α (Consistent)'}
              </span>
            </div>
          </div>

          <div className="rounded-md bg-[#101010] border border-[#292929] p-3.5 text-xs text-[#A3A3A3] font-mono space-y-1.5">
            <p>
              <strong className="text-[#F5F5F5]">Mathematical Reasoning:</strong> Under H₀: X ~ Poisson(λ = {inspectedExperiment.baseline_lambda.toFixed(4)}),
              the probability of observing {selectedObservation.count} or more arrivals in this {inspectedExperiment.window_seconds}s window is{' '}
              <span className="text-[#FF6A00] font-bold">{formatProbability(selectedDetection.p_value)}</span>.
            </p>
            <p>
              Comparison: {formatProbability(selectedDetection.p_value)}{' '}
              {selectedDetection.is_burst ? '<' : '≥'} {selectedDetection.alpha} (α) ➔{' '}
              <span className={selectedDetection.is_burst ? 'text-[#ef4444] font-bold' : 'text-emerald-400 font-bold'}>
                {selectedDetection.is_burst ? 'Flagged as unusual burst' : 'Not flagged (within expected Poisson variation)'}
              </span>.
            </p>
          </div>
        </div>
      )}

      {/* 7. INTERACTIVE HYPOTHETICAL SANDBOX (ISOLATED FROM PERSISTENCE) */}
      <div className="rounded-lg border border-[#292929] bg-[#141414] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-[#292929]">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[rgba(255,106,0,0.1)] text-[#FF6A00] border border-[rgba(255,106,0,0.25)]">
              <Calculator className="h-4 w-4" />
            </div>
            <div>
              <h2 className="font-heading text-sm font-semibold text-[#F5F5F5]">
                Interactive Hypothetical Sandbox
              </h2>
              <p className="text-xs text-[#737373]">
                Test custom theoretical arrival rates and counts in an isolated scratchpad separate from persistent records.
              </p>
            </div>
          </div>

          {inspectedExperiment && (
            <button
              type="button"
              onClick={handleLoadIntoSandbox}
              className="btn-secondary text-xs"
            >
              <span>Copy λ={inspectedExperiment.baseline_lambda.toFixed(2)} into Sandbox</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pt-2">
          {/* Left: Upper Tail Calculator */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <h3 className="font-heading text-xs font-semibold uppercase tracking-wider text-[#F5F5F5]">
                Poisson Upper-Tail Calculator
              </h3>
              <span className="font-mono text-[10px] text-emerald-400 bg-[rgba(34,197,94,0.1)] px-2 py-0.5 rounded border border-[rgba(34,197,94,0.25)]">
                /api/poisson/detect
              </span>
            </div>

            {calcError && (
              <div className="rounded border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.08)] p-2.5 text-xs text-red-300">
                {calcError}
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-[#A3A3A3] mb-1">Observed (x)</label>
                <input
                  type="number"
                  min="0"
                  value={calcObserved}
                  onChange={(e) => setCalcObserved(Number(e.target.value))}
                  className="w-full rounded bg-[#101010] border border-[#292929] px-2.5 py-1.5 text-[#F5F5F5] font-mono focus:border-[#FF6A00] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[#A3A3A3] mb-1">Expected Rate (λ)</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.5"
                  value={calcExpected}
                  onChange={(e) => setCalcExpected(Number(e.target.value))}
                  className="w-full rounded bg-[#101010] border border-[#292929] px-2.5 py-1.5 text-[#F5F5F5] font-mono focus:border-[#FF6A00] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[#A3A3A3] mb-1">Alpha (α)</label>
                <select
                  value={calcAlpha}
                  onChange={(e) => setCalcAlpha(Number(e.target.value))}
                  className="w-full rounded bg-[#101010] border border-[#292929] px-2.5 py-1.5 text-[#F5F5F5] font-mono focus:border-[#FF6A00] focus:outline-none"
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
              className="w-full btn-primary justify-center py-2 text-xs"
            >
              {calcLoading ? 'Computing...' : 'Calculate P(X ≥ x | λ)'}
            </button>

            {calcResult && (
              <div className="rounded-md bg-[#101010] border border-[#292929] p-3 text-xs font-mono space-y-1">
                <div className="flex justify-between">
                  <span className="text-[#737373]">p-value:</span>
                  <span className={calcResult.is_burst ? 'text-[#ef4444] font-bold' : 'text-emerald-400 font-bold'}>
                    {formatProbability(calcResult.p_value)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#737373]">Decision:</span>
                  <span className={calcResult.is_burst ? 'text-[#ef4444] font-bold' : 'text-emerald-400 font-bold'}>
                    {calcResult.is_burst ? 'FLAGGED (p < α)' : 'NORMAL (p ≥ α)'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Right: Custom Sequence Dispersion Sandbox */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <h3 className="font-heading text-xs font-semibold uppercase tracking-wider text-[#F5F5F5]">
                Sample Dispersion &amp; VMR Scratchpad
              </h3>
              <span className="font-mono text-[10px] text-[#A3A3A3] bg-[#101010] px-2 py-0.5 rounded border border-[#292929]">
                /api/poisson/dispersion
              </span>
            </div>

            {dispError && (
              <div className="rounded border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.08)] p-2.5 text-xs text-red-300">
                {dispError}
              </div>
            )}

            <div>
              <label className="block text-xs text-[#A3A3A3] mb-1">Comma-separated counts:</label>
              <input
                type="text"
                value={sampleInput}
                onChange={(e) => setSampleInput(e.target.value)}
                className="w-full rounded bg-[#101010] border border-[#292929] px-2.5 py-1.5 text-[#F5F5F5] font-mono text-xs focus:border-[#FF6A00] focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={handleAnalyzeDispersion}
              disabled={dispLoading}
              className="w-full btn-secondary justify-center py-2 text-xs"
            >
              {dispLoading ? 'Analyzing...' : 'Calculate Mean, Variance & VMR'}
            </button>

            {dispResult && (
              <div className="rounded-md bg-[#101010] border border-[#292929] p-3 text-xs font-mono space-y-1">
                <div className="flex justify-between">
                  <span className="text-[#737373]">Mean (X̄):</span>
                  <span className="text-[#F5F5F5]">{dispResult.sample_mean.toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#737373]">Variance (s²):</span>
                  <span className="text-[#F5F5F5]">{dispResult.sample_variance.toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#737373]">VMR (s²/X̄):</span>
                  <span className={dispResult.dispersion_type === 'equidispersed' ? 'text-emerald-400' : 'text-[#FF6A00]'}>
                    {dispResult.variance_to_mean_ratio.toFixed(4)} ({dispResult.dispersion_type})
                  </span>
                </div>
              </div>
            )}
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
        <div className="flex min-h-[60vh] items-center justify-center text-[#737373]">
          <div className="flex items-center gap-3">
            <RefreshCw className="h-5 w-5 animate-spin text-[#FF6A00]" />
            <span className="text-sm font-medium">Loading Statistical Analysis Lab...</span>
          </div>
        </div>
      }
    >
      <StatisticalAnalysisContent />
    </Suspense>
  );
}
