'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  BarChart2,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  FileText,
  Flame,
  FlaskConical,
  History,
  RefreshCw,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from 'recharts';
import { api, ApiClientError } from '@/lib/api';
import {
  DashboardSummaryResponse,
  ExperimentDetailResponse,
} from '@/lib/types';
import { formatProbability } from '@/lib/utils';

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(null);
  const [latestDetail, setLatestDetail] = useState<ExperimentDetailResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState<boolean>(false);

  const refreshDashboard = () => {
    setLoading(true);
    setError(null);

    api
      .getDashboardSummary()
      .then(async (sumData) => {
        setSummary(sumData);
        if (sumData.latest_experiment) {
          setLoadingDetail(true);
          try {
            const detail = await api.getExperimentDetail(sumData.latest_experiment.experiment_id);
            setLatestDetail(detail);
          } catch {
            setLatestDetail(null);
          } finally {
            setLoadingDetail(false);
          }
        } else {
          setLatestDetail(null);
        }
      })
      .catch((err) => {
        if (err instanceof ApiClientError) {
          setError(err.message);
        } else {
          setError('Failed to connect to the PoissonBurst backend. Please check if the server is running.');
        }
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    let isMounted = true;
    api
      .getDashboardSummary()
      .then(async (sumData) => {
        if (!isMounted) return;
        setSummary(sumData);
        if (sumData.latest_experiment) {
          try {
            const detail = await api.getExperimentDetail(sumData.latest_experiment.experiment_id);
            if (isMounted) setLatestDetail(detail);
          } catch {
            if (isMounted) setLatestDetail(null);
          }
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        if (err instanceof ApiClientError) {
          setError(err.message);
        } else {
          setError('Failed to connect to the PoissonBurst backend. Please check if the server is running.');
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleDownloadCsv = async (experimentId: string, title: string) => {
    try {
      setDownloadingId(experimentId);
      await api.downloadExperimentCsv(experimentId, `${title.replace(/\s+/g, '_')}.csv`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to download experiment CSV.');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDownloadPdf = async (experimentId: string, title?: string) => {
    try {
      setDownloadingPdf(true);
      const cleanTitle = title ? title.replace(/[^a-zA-Z0-9_-]/g, '_') : experimentId;
      await api.downloadExperimentReportPdf(experimentId, `PoissonBurst_Report_${cleanTitle}.pdf`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to download experiment PDF report.');
    } finally {
      setDownloadingPdf(false);
    }
  };

  // Timeline chart data from saved observations of the latest experiment
  const timelineData = latestDetail
    ? latestDetail.observations.map((obs, idx) => {
        const det = latestDetail.detections[idx];
        return {
          index: idx + 1,
          timeLabel: obs.time_seconds !== undefined && obs.time_seconds !== null
            ? `${obs.time_seconds.toFixed(1)}s`
            : `W${idx + 1}`,
          count: obs.count,
          baseline: latestDetail.baseline_lambda,
          isBurst: det ? det.is_burst : false,
          pValue: det ? det.p_value : 1.0,
          groundTruth: obs.ground_truth,
        };
      })
    : [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Top Banner / Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-6 border-b border-[#262a38]">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-orange-400">
            <span>Unified Platform Dashboard</span>
            <span className="text-slate-500">•</span>
            <span className="text-slate-400">Course 25CS203</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl mt-1">
            Network Burst Detection Dashboard
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-3xl">
            Live overview of persisted network traffic experiments. Inspect saved arrival time-series,
            authoritative Poisson upper-tail burst detections, and ground-truth validation metrics.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={refreshDashboard}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-[#191c26] border border-[#2d3244] px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-[#222634] hover:border-orange-500/40 transition-all disabled:opacity-50"
            title="Refresh dashboard from persistent database"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-orange-400' : 'text-slate-400'}`} />
            <span>Refresh</span>
          </button>
          <Link
            href="/simulation"
            className="flex items-center gap-2 rounded-lg bg-orange-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-orange-500 transition-colors shadow-sm"
          >
            <FlaskConical className="h-3.5 w-3.5" />
            <span>New Simulation</span>
          </Link>
          <Link
            href="/historical"
            className="flex items-center gap-2 rounded-lg bg-[#1c2234] border border-blue-500/30 px-3.5 py-2 text-xs font-medium text-blue-300 hover:bg-[#232b42] transition-colors"
          >
            <History className="h-3.5 w-3.5" />
            <span>Analyze CSV</span>
          </Link>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="mt-6 rounded-lg bg-red-950/40 border border-red-500/40 p-4 text-xs text-red-300 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="font-semibold text-red-200 text-sm">Failed to Load Dashboard Data</h4>
            <p className="mt-1">{error}</p>
          </div>
          <button
            onClick={refreshDashboard}
            className="rounded bg-red-900/60 hover:bg-red-800 px-2.5 py-1 text-xs text-white"
          >
            Retry
          </button>
        </div>
      )}

      {/* Top Summary Cards */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Total Experiments */}
        <div className="rounded-xl border border-[#262a38] bg-[#14161f] p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Total Saved Experiments
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-300">
              <Database className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-white font-mono">
              {loading && !summary ? '...' : summary?.total_experiments ?? 0}
            </span>
            <span className="text-xs text-slate-400">persisted trials</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Stored in SQLite database across restarts
          </p>
        </div>

        {/* Card 2: Saved Simulations */}
        <div className="rounded-xl border border-[#262a38] bg-[#14161f] p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Synthetic Simulations
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/10 text-orange-400 border border-orange-500/20">
              <FlaskConical className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-orange-400 font-mono">
              {loading && !summary ? '...' : summary?.simulation_experiments_count ?? 0}
            </span>
            <span className="text-xs text-slate-400">sim runs</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Controlled packet-rate simulations
          </p>
        </div>

        {/* Card 3: Saved Historical Analyses */}
        <div className="rounded-xl border border-[#262a38] bg-[#14161f] p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Historical Analyses
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <History className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-blue-400 font-mono">
              {loading && !summary ? '...' : summary?.historical_experiments_count ?? 0}
            </span>
            <span className="text-xs text-slate-400">CSV replays</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Aggregated NetFlow & CICIDS flow traces
          </p>
        </div>

        {/* Card 4: Bursts in Latest Experiment */}
        <div className="rounded-xl border border-[#262a38] bg-[#14161f] p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400" title="Detected burst windows in the single latest completed experiment">
              Bursts in Latest Run
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 text-red-400 border border-red-500/20">
              <Flame className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-red-400 font-mono">
              {loading && !summary
                ? '...'
                : summary?.latest_detected_count !== null && summary?.latest_detected_count !== undefined
                ? summary.latest_detected_count
                : '—'}
            </span>
            <span className="text-xs text-slate-400">burst windows</span>
          </div>
          <p className="mt-2 text-[11px] text-slate-500" title="Scientific attribution">
            {summary?.latest_experiment
              ? `Belongs to ${summary.latest_experiment.experiment_id} (${summary.latest_experiment.measurement_type})`
              : 'No completed experiment yet'}
          </p>
        </div>
      </div>

      {/* Empty State when no experiments have been saved */}
      {!loading && summary && summary.total_experiments === 0 && (
        <div className="mt-8 rounded-2xl border border-dashed border-[#2d3244] bg-[#10121a] p-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400">
            <Database className="h-7 w-7" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-white">No Experiments Recorded Yet</h3>
          <p className="mt-2 text-sm text-slate-400 max-w-lg mx-auto">
            Run a synthetic traffic simulation or analyze a historical CSV dataset to generate
            and persist reproducible experimental results.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href="/simulation"
              className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-xs font-medium text-white hover:bg-orange-500 transition-colors"
            >
              <FlaskConical className="h-4 w-4" />
              <span>Launch Simulation Lab</span>
            </Link>
            <Link
              href="/historical"
              className="inline-flex items-center gap-2 rounded-lg bg-[#191c26] border border-[#2d3244] px-4 py-2.5 text-xs font-medium text-slate-200 hover:bg-[#222634] transition-colors"
            >
              <History className="h-4 w-4" />
              <span>Analyze Historical CSV</span>
            </Link>
          </div>
        </div>
      )}

      {/* Latest Experiment Spotlight */}
      {summary?.latest_experiment && (
        <div className="mt-8 rounded-2xl border border-[#262a38] bg-[#14161f] overflow-hidden shadow-xl">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[#262a38] bg-[#10121a] px-6 py-4">
            <div className="flex items-center gap-3">
              <span className="flex h-3 w-3 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-orange-400">
                    Latest Completed Experiment
                  </span>
                  <span className="font-mono text-xs text-slate-400 bg-[#1c1f2b] px-2 py-0.5 rounded border border-[#2d3244]">
                    {summary.latest_experiment.experiment_id}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                      summary.latest_experiment.experiment_type === 'simulation'
                        ? 'bg-orange-500/15 text-orange-400 border border-orange-500/30'
                        : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                    }`}
                  >
                    {summary.latest_experiment.experiment_type}
                  </span>
                  <span className="rounded bg-[#191c26] text-slate-300 text-[10px] px-2 py-0.5 border border-[#2d3244] font-mono">
                    {summary.latest_experiment.measurement_type}
                  </span>
                </div>
                <h2 className="text-base font-semibold text-white mt-0.5">
                  {summary.latest_experiment.title}
                </h2>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  handleDownloadCsv(
                    summary.latest_experiment!.experiment_id,
                    summary.latest_experiment!.title
                  )
                }
                disabled={downloadingId === summary.latest_experiment.experiment_id}
                className="flex items-center gap-1.5 rounded-md bg-[#191c26] border border-[#2d3244] px-3 py-1.5 text-xs text-slate-300 hover:text-white hover:border-slate-500 transition-colors"
                title="Download CSV of observations and detections"
              >
                <Download className="h-3.5 w-3.5 text-slate-400" />
                <span>{downloadingId === summary.latest_experiment.experiment_id ? 'Exporting...' : 'Export CSV'}</span>
              </button>
              <button
                onClick={() =>
                  handleDownloadPdf(
                    summary.latest_experiment!.experiment_id,
                    summary.latest_experiment!.title
                  )
                }
                disabled={downloadingPdf}
                className="flex items-center gap-1.5 rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-500 transition-colors"
                title="Download Academic PDF Report"
              >
                {downloadingPdf ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
                <span>PDF Report</span>
              </button>
              <Link
                href={`/experiments?selected=${summary.latest_experiment.experiment_id}`}
                className="flex items-center gap-1.5 rounded-md bg-[#191c26] border border-[#2d3244] px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white transition-colors"
              >
                <span>Inspect in History</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          {/* Details Grid */}
          <div className="p-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
                  Baseline λ
                </span>
                <span className="text-lg font-bold text-white font-mono mt-1 block">
                  {summary.latest_experiment.baseline_lambda.toFixed(2)}
                </span>
                <span className="text-[10px] text-slate-500">expected / window</span>
              </div>

              <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
                  Window Duration
                </span>
                <span className="text-lg font-bold text-white font-mono mt-1 block">
                  {summary.latest_experiment.window_seconds}s
                </span>
                <span className="text-[10px] text-slate-500">observation window W</span>
              </div>

              <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
                  Threshold α
                </span>
                <span className="text-lg font-bold text-white font-mono mt-1 block">
                  {summary.latest_experiment.alpha}
                </span>
                <span className="text-[10px] text-slate-500">significance level</span>
              </div>

              <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
                  Windows Analyzed
                </span>
                <span className="text-lg font-bold text-white font-mono mt-1 block">
                  {summary.latest_experiment.observation_count}
                </span>
                <span className="text-[10px] text-slate-500">contiguous intervals</span>
              </div>

              <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
                  Detected Bursts
                </span>
                <span className="text-lg font-bold text-red-400 font-mono mt-1 block">
                  {summary.latest_experiment.detected_window_count}
                </span>
                <span className="text-[10px] text-slate-500">flagged intervals</span>
              </div>

              <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
                  Ground Truth
                </span>
                <span
                  className={`text-xs font-semibold mt-1.5 block ${
                    summary.latest_experiment.ground_truth_available
                      ? 'text-emerald-400'
                      : 'text-amber-400'
                  }`}
                >
                  {summary.latest_experiment.ground_truth_available ? 'Available' : 'Unlabeled'}
                </span>
                <span className="text-[10px] text-slate-500">
                  {summary.latest_experiment.ground_truth_available ? 'Metrics validated' : 'Nominal α only'}
                </span>
              </div>
            </div>

            {/* Evaluation Metrics (if ground truth was present) */}
            {summary.latest_experiment.evaluation && (
              <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
                    Validated Ground-Truth Evaluation Metrics
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
                  <div className="bg-[#0c0d12]/70 rounded p-2">
                    <span className="text-[10px] text-slate-400 uppercase block">Precision</span>
                    <span className="text-base font-bold text-white font-mono">
                      {(summary.latest_experiment.evaluation.precision * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="bg-[#0c0d12]/70 rounded p-2">
                    <span className="text-[10px] text-slate-400 uppercase block">Recall</span>
                    <span className="text-base font-bold text-white font-mono">
                      {(summary.latest_experiment.evaluation.recall * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="bg-[#0c0d12]/70 rounded p-2">
                    <span className="text-[10px] text-slate-400 uppercase block">F1-Score</span>
                    <span className="text-base font-bold text-white font-mono">
                      {summary.latest_experiment.evaluation.f1_score.toFixed(3)}
                    </span>
                  </div>
                  <div className="bg-[#0c0d12]/70 rounded p-2">
                    <span className="text-[10px] text-slate-400 uppercase block">False Positive Rate</span>
                    <span className="text-base font-bold text-white font-mono">
                      {(summary.latest_experiment.evaluation.false_positive_rate * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="bg-[#0c0d12]/70 rounded p-2 col-span-2 sm:col-span-1">
                    <span className="text-[10px] text-slate-400 uppercase block">Detection Delay</span>
                    <span className="text-base font-bold text-white font-mono">
                      {summary.latest_experiment.evaluation.detection_delay_seconds !== null &&
                      summary.latest_experiment.evaluation.detection_delay_seconds !== undefined
                        ? `${summary.latest_experiment.evaluation.detection_delay_seconds}s`
                        : '0.0s'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Summary sentence */}
            {summary.latest_experiment.summary && (
              <p className="mt-4 text-xs text-slate-400 bg-[#10121a] p-3 rounded border border-[#222634]">
                <strong className="text-slate-300">Run Summary:</strong> {summary.latest_experiment.summary}
              </p>
            )}

            {/* Detection Timeline Chart */}
            <div className="mt-6">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-orange-400" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                    Detection Timeline (Actual Stored Observations)
                  </h3>
                </div>
                <span className="text-xs text-slate-500 font-mono">
                  {latestDetail?.observations.length ?? 0} time windows plotted
                </span>
              </div>

              {loadingDetail ? (
                <div className="h-64 flex items-center justify-center rounded-xl bg-[#0c0d12] border border-[#222634]">
                  <RefreshCw className="h-6 w-6 animate-spin text-orange-400" />
                </div>
              ) : timelineData.length > 0 ? (
                <div className="h-64 w-full rounded-xl bg-[#0c0d12] border border-[#222634] p-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timelineData}>
                      <defs>
                        <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f97316" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#f97316" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#222634" />
                      <XAxis
                        dataKey="timeLabel"
                        stroke="#64748b"
                        fontSize={10}
                        tickLine={false}
                      />
                      <YAxis
                        stroke="#64748b"
                        fontSize={10}
                        tickLine={false}
                        domain={[0, 'auto']}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                              <div className="rounded-lg bg-[#14161f] border border-[#2d3244] p-2.5 text-xs shadow-xl">
                                <p className="font-semibold text-white">Window: {data.timeLabel}</p>
                                <p className="text-orange-400 font-mono mt-1">
                                  Count: {data.count} ({latestDetail?.measurement_type})
                                </p>
                                <p className="text-slate-400 font-mono">
                                  Expected λ: {data.baseline.toFixed(2)}
                                </p>
                                <p className="text-slate-400 font-mono">
                                  P-Value: {formatProbability(data.pValue)}
                                </p>
                                {data.isBurst && (
                                  <p className="text-red-400 font-semibold mt-1 flex items-center gap-1">
                                    <Flame className="h-3 w-3" /> Burst Alert Flagged
                                  </p>
                                )}
                                {data.groundTruth !== undefined && data.groundTruth !== null && (
                                  <p className="text-slate-500 text-[10px]">
                                    Ground Truth: {data.groundTruth ? 'Burst Injected' : 'Normal'}
                                  </p>
                                )}
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <ReferenceLine
                        y={latestDetail?.baseline_lambda}
                        stroke="#38bdf8"
                        strokeDasharray="4 4"
                        label={{
                          value: `λ = ${latestDetail?.baseline_lambda.toFixed(1)}`,
                          fill: '#38bdf8',
                          fontSize: 10,
                          position: 'insideTopLeft',
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="count"
                        stroke="#f97316"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#colorCount)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-40 flex items-center justify-center rounded-xl bg-[#0c0d12] border border-[#222634] text-xs text-slate-500">
                  Select an experiment to display its detection timeline.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recent Experiments Table */}
      {summary && summary.recent_experiments.length > 0 && (
        <div className="mt-8 rounded-2xl border border-[#262a38] bg-[#14161f] overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#262a38] bg-[#10121a] px-6 py-4">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-orange-400" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-white">
                Recent Saved Experiments
              </h2>
            </div>
            <Link
              href="/experiments"
              className="flex items-center gap-1 text-xs font-medium text-orange-400 hover:text-orange-300 transition-colors"
            >
              <span>View All Experiments</span>
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-[#0e1017] text-[11px] font-semibold uppercase tracking-wider text-slate-400 border-b border-[#222634]">
                <tr>
                  <th className="px-6 py-3">Experiment ID</th>
                  <th className="px-6 py-3">Title</th>
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3">Measurement</th>
                  <th className="px-6 py-3">Baseline λ</th>
                  <th className="px-6 py-3">Windows</th>
                  <th className="px-6 py-3">Bursts</th>
                  <th className="px-6 py-3">Ground Truth</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e2230]">
                {summary.recent_experiments.map((exp) => (
                  <tr
                    key={exp.experiment_id}
                    className="hover:bg-[#181b26] transition-colors"
                  >
                    <td className="px-6 py-3 font-mono text-slate-400">
                      {exp.experiment_id}
                    </td>
                    <td className="px-6 py-3 font-medium text-white max-w-xs truncate" title={exp.title}>
                      {exp.title}
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          exp.experiment_type === 'simulation'
                            ? 'bg-orange-500/15 text-orange-400 border border-orange-500/30'
                            : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                        }`}
                      >
                        {exp.experiment_type}
                      </span>
                    </td>
                    <td className="px-6 py-3 font-mono text-slate-400">
                      {exp.measurement_type}
                    </td>
                    <td className="px-6 py-3 font-mono text-slate-300">
                      {exp.baseline_lambda.toFixed(2)}
                    </td>
                    <td className="px-6 py-3 font-mono text-slate-300">
                      {exp.observation_count}
                    </td>
                    <td className="px-6 py-3 font-mono text-red-400 font-semibold">
                      {exp.detected_window_count}
                    </td>
                    <td className="px-6 py-3">
                      {exp.ground_truth_available ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 text-[11px]">
                          <CheckCircle2 className="h-3 w-3" /> Labeled
                        </span>
                      ) : (
                        <span className="text-slate-500 text-[11px]">Unlabeled</span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleDownloadCsv(exp.experiment_id, exp.title)}
                          disabled={downloadingId === exp.experiment_id}
                          className="rounded p-1 text-slate-400 hover:text-white hover:bg-[#252a3b] transition-colors"
                          title="Download CSV"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        <Link
                          href={`/experiments?selected=${exp.experiment_id}`}
                          className="rounded p-1 text-orange-400 hover:text-orange-300 hover:bg-orange-500/10 transition-colors"
                          title="Inspect Experiment"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cross-Page Quick Navigation Section */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-4 gap-4">
        <Link
          href="/simulation"
          className="group rounded-xl border border-[#262a38] bg-[#14161f] p-5 hover:border-orange-500/40 hover:bg-[#181b26] transition-all"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-500/10 text-orange-400 mb-3 group-hover:scale-105 transition-transform">
            <FlaskConical className="h-5 w-5" />
          </div>
          <h3 className="text-sm font-semibold text-white group-hover:text-orange-400 transition-colors">
            Simulation Lab
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Generate reproducible Poisson traffic, sudden bursts, rate drift, and overdispersed scenarios.
          </p>
        </Link>

        <Link
          href="/historical"
          className="group rounded-xl border border-[#262a38] bg-[#14161f] p-5 hover:border-blue-500/40 hover:bg-[#181b26] transition-all"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 mb-3 group-hover:scale-105 transition-transform">
            <History className="h-5 w-5" />
          </div>
          <h3 className="text-sm font-semibold text-white group-hover:text-blue-400 transition-colors">
            Historical Replay
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Upload CSV network flows, calibrate baseline with contamination exclusion, and replay detections.
          </p>
        </Link>

        <Link
          href="/analysis"
          className="group rounded-xl border border-[#262a38] bg-[#14161f] p-5 hover:border-purple-500/40 hover:bg-[#181b26] transition-all"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400 mb-3 group-hover:scale-105 transition-transform">
            <BarChart2 className="h-5 w-5" />
          </div>
          <h3 className="text-sm font-semibold text-white group-hover:text-purple-400 transition-colors">
            Statistical Analysis
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Explore Poisson PMF curves, upper-tail probabilities, dispersion ratios, and inspect saved experiments.
          </p>
        </Link>

        <Link
          href="/experiments"
          className="group rounded-xl border border-[#262a38] bg-[#14161f] p-5 hover:border-emerald-500/40 hover:bg-[#181b26] transition-all"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 mb-3 group-hover:scale-105 transition-transform">
            <Database className="h-5 w-5" />
          </div>
          <h3 className="text-sm font-semibold text-white group-hover:text-emerald-400 transition-colors">
            Experiment History
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Filter, search, compare compatible trials side-by-side, inspect observation tables, and export results.
          </p>
        </Link>
      </div>
    </div>
  );
}
