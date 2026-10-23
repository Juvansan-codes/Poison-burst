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
import PageHeader from '@/components/ui/PageHeader';
import MetricCard from '@/components/ui/MetricCard';
import StatusBadge from '@/components/ui/StatusBadge';
import EmptyState from '@/components/ui/EmptyState';

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
          setError('Failed to connect to the PoissonBurst backend. Please ensure the server is running on port 8000.');
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
          setError('Failed to connect to the PoissonBurst backend. Please ensure the server is running on port 8000.');
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
          timeLabel:
            obs.time_seconds !== undefined && obs.time_seconds !== null
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
    <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top Banner / Page Header */}
      <PageHeader
        title="Network Burst Detection Dashboard"
        subtitle="Live overview of persisted network traffic experiments. Inspect saved arrival time-series, Poisson burst detections, and ground-truth validation metrics."
        badge="25CS203 Micro-Project"
        actions={
          <>
            <button
              onClick={refreshDashboard}
              disabled={loading}
              className="btn-secondary"
              title="Refresh dashboard from SQLite database"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-[#FF6A00]' : 'text-[#A3A3A3]'}`} />
              <span>Refresh</span>
            </button>
            <Link href="/simulation" className="btn-primary">
              <FlaskConical className="h-3.5 w-3.5" />
              <span>New Simulation</span>
            </Link>
            <Link
              href="/historical"
              className="inline-flex items-center gap-2 rounded-md bg-[#191919] border border-[#292929] px-4 py-2 text-xs font-medium text-[#F5F5F5] hover:border-[#FF6A00]/50 hover:bg-[#202020] transition-all"
            >
              <History className="h-3.5 w-3.5 text-[#A3A3A3]" />
              <span>Analyze CSV</span>
            </Link>
          </>
        }
      />

      {/* Error Alert */}
      {error && (
        <div className="rounded-lg bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.25)] p-4 text-xs text-red-300 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-[#ef4444] shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-red-200 text-sm">Backend Connection Error</h4>
              <p className="mt-1 text-[#A3A3A3]">{error}</p>
            </div>
          </div>
          <button
            onClick={refreshDashboard}
            className="rounded px-2.5 py-1 text-xs bg-[#191919] border border-[#292929] hover:border-[#383838] text-[#F5F5F5] transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Saved Experiments"
          value={loading && !summary ? '...' : summary?.total_experiments ?? 0}
          helper="Persisted in SQLite database"
          icon={Database}
          badge="SQLite"
          badgeVariant="neutral"
        />
        <MetricCard
          label="Synthetic Simulations"
          value={loading && !summary ? '...' : summary?.simulation_experiments_count ?? 0}
          helper="Controlled packet-rate trials"
          icon={FlaskConical}
          badge="Synthetic"
          badgeVariant="accent"
        />
        <MetricCard
          label="Historical Analyses"
          value={loading && !summary ? '...' : summary?.historical_experiments_count ?? 0}
          helper="Aggregated NetFlow & CICIDS flow traces"
          icon={History}
          badge="CSV Ingestion"
          badgeVariant="neutral"
        />
        <MetricCard
          label="Bursts in Latest Run"
          value={
            loading && !summary
              ? '...'
              : summary?.latest_detected_count !== null && summary?.latest_detected_count !== undefined
              ? summary.latest_detected_count
              : '—'
          }
          helper={
            summary?.latest_experiment
              ? `Belongs to ${summary.latest_experiment.experiment_id}`
              : 'No completed run yet'
          }
          icon={Flame}
          badge={summary?.latest_experiment ? summary.latest_experiment.measurement_type : undefined}
          badgeVariant="error"
          highlight={true}
        />
      </div>

      {/* Empty State when no experiments have been saved */}
      {!loading && summary && summary.total_experiments === 0 && (
        <EmptyState
          icon={Database}
          title="No Experiments Recorded Yet"
          description="Run a synthetic traffic simulation or analyze a historical CSV dataset to generate and persist reproducible experimental results."
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/simulation" className="btn-primary">
                <FlaskConical className="h-4 w-4" />
                <span>Launch Simulation Lab</span>
              </Link>
              <Link href="/historical" className="btn-secondary">
                <History className="h-4 w-4" />
                <span>Analyze Historical CSV</span>
              </Link>
            </div>
          }
        />
      )}

      {/* Latest Experiment Spotlight */}
      {summary?.latest_experiment && (
        <div className="rounded-lg border border-[#292929] bg-[#141414] overflow-hidden">
          {/* Spotlight Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#292929] bg-[#101010] p-4 sm:p-6">
            <div className="flex items-start sm:items-center gap-3">
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-500/10 mt-1 sm:mt-0 shrink-0" />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#FF6A00]">
                    Latest Completed Experiment
                  </span>
                  <span className="font-mono text-xs text-[#A3A3A3] bg-[#191919] px-2 py-0.5 rounded border border-[#292929]">
                    {summary.latest_experiment.experiment_id}
                  </span>
                  <StatusBadge
                    label={summary.latest_experiment.experiment_type}
                    variant={summary.latest_experiment.experiment_type === 'simulation' ? 'accent' : 'neutral'}
                  />
                  <span className="font-mono text-[10px] text-[#A3A3A3] bg-[#191919] px-2 py-0.5 rounded border border-[#292929]">
                    {summary.latest_experiment.measurement_type}
                  </span>
                </div>
                <h2 className="font-heading text-lg font-semibold text-[#F5F5F5] mt-1">
                  {summary.latest_experiment.title}
                </h2>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() =>
                  handleDownloadCsv(
                    summary.latest_experiment!.experiment_id,
                    summary.latest_experiment!.title
                  )
                }
                disabled={downloadingId === summary.latest_experiment.experiment_id}
                className="btn-secondary text-xs"
                title="Download CSV of observations and detections"
              >
                <Download className="h-3.5 w-3.5 text-[#A3A3A3]" />
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
                className="btn-primary text-xs"
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
                className="btn-secondary text-xs"
              >
                <span>Inspect in History</span>
                <ArrowRight className="h-3.5 w-3.5 text-[#A3A3A3]" />
              </Link>
            </div>
          </div>

          {/* Details & Metrics Grid */}
          <div className="p-4 sm:p-6 space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
              <div className="rounded-md bg-[#101010] border border-[#292929] p-3">
                <span className="stat-label block">Baseline λ</span>
                <span className="stat-value text-lg text-[#F5F5F5] mt-1 block">
                  {summary.latest_experiment.baseline_lambda.toFixed(2)}
                </span>
                <span className="stat-helper block">expected / window</span>
              </div>

              <div className="rounded-md bg-[#101010] border border-[#292929] p-3">
                <span className="stat-label block">Window Duration</span>
                <span className="stat-value text-lg text-[#F5F5F5] mt-1 block">
                  {summary.latest_experiment.window_seconds}s
                </span>
                <span className="stat-helper block">interval width W</span>
              </div>

              <div className="rounded-md bg-[#101010] border border-[#292929] p-3">
                <span className="stat-label block">Threshold α</span>
                <span className="stat-value text-lg text-[#F5F5F5] mt-1 block">
                  {summary.latest_experiment.alpha}
                </span>
                <span className="stat-helper block">significance level</span>
              </div>

              <div className="rounded-md bg-[#101010] border border-[#292929] p-3">
                <span className="stat-label block">Windows Analyzed</span>
                <span className="stat-value text-lg text-[#F5F5F5] mt-1 block">
                  {summary.latest_experiment.observation_count}
                </span>
                <span className="stat-helper block">contiguous windows</span>
              </div>

              <div className="rounded-md bg-[#101010] border border-[#292929] p-3">
                <span className="stat-label block">Detected Bursts</span>
                <span className="stat-value text-lg text-[#ef4444] mt-1 block">
                  {summary.latest_experiment.detected_window_count}
                </span>
                <span className="stat-helper block">flagged anomalies</span>
              </div>

              <div className="rounded-md bg-[#101010] border border-[#292929] p-3">
                <span className="stat-label block">Ground Truth</span>
                <span
                  className={`text-xs font-semibold mt-1.5 block ${
                    summary.latest_experiment.ground_truth_available ? 'text-emerald-400' : 'text-[#737373]'
                  }`}
                >
                  {summary.latest_experiment.ground_truth_available ? 'Available' : 'Unlabeled'}
                </span>
                <span className="stat-helper block">
                  {summary.latest_experiment.ground_truth_available ? 'Metrics validated' : 'Nominal α only'}
                </span>
              </div>
            </div>

            {/* Evaluation Metrics (if ground truth was present) */}
            {summary.latest_experiment.evaluation && (
              <div className="rounded-md border border-[rgba(34,197,94,0.2)] bg-[rgba(34,197,94,0.04)] p-4">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
                    Validated Ground-Truth Evaluation Metrics
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
                  <div className="bg-[#101010] border border-[#292929] rounded p-2.5">
                    <span className="text-[10px] text-[#A3A3A3] uppercase block font-medium">Precision</span>
                    <span className="font-mono text-base font-bold text-[#F5F5F5] mt-0.5 block">
                      {(summary.latest_experiment.evaluation.precision * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="bg-[#101010] border border-[#292929] rounded p-2.5">
                    <span className="text-[10px] text-[#A3A3A3] uppercase block font-medium">Recall</span>
                    <span className="font-mono text-base font-bold text-[#F5F5F5] mt-0.5 block">
                      {(summary.latest_experiment.evaluation.recall * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="bg-[#101010] border border-[#292929] rounded p-2.5">
                    <span className="text-[10px] text-[#A3A3A3] uppercase block font-medium">F1-Score</span>
                    <span className="font-mono text-base font-bold text-[#F5F5F5] mt-0.5 block">
                      {summary.latest_experiment.evaluation.f1_score.toFixed(3)}
                    </span>
                  </div>
                  <div className="bg-[#101010] border border-[#292929] rounded p-2.5">
                    <span className="text-[10px] text-[#A3A3A3] uppercase block font-medium">False Positive Rate</span>
                    <span className="font-mono text-base font-bold text-[#F5F5F5] mt-0.5 block">
                      {(summary.latest_experiment.evaluation.false_positive_rate * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="bg-[#101010] border border-[#292929] rounded p-2.5 col-span-2 sm:col-span-1">
                    <span className="text-[10px] text-[#A3A3A3] uppercase block font-medium">Detection Delay</span>
                    <span className="font-mono text-base font-bold text-[#F5F5F5] mt-0.5 block">
                      {summary.latest_experiment.evaluation.detection_delay_seconds !== null &&
                      summary.latest_experiment.evaluation.detection_delay_seconds !== undefined
                        ? `${summary.latest_experiment.evaluation.detection_delay_seconds}s`
                        : '0.0s'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Run summary sentence */}
            {summary.latest_experiment.summary && (
              <div className="text-xs text-[#A3A3A3] bg-[#101010] p-3.5 rounded-md border border-[#292929]">
                <strong className="text-[#F5F5F5] font-medium">Run Summary:</strong> {summary.latest_experiment.summary}
              </div>
            )}

            {/* Detection Timeline Chart */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-[#FF6A00]" />
                  <h3 className="font-heading text-xs font-semibold uppercase tracking-wider text-[#F5F5F5]">
                    Detection Timeline (Stored Observations)
                  </h3>
                </div>
                <span className="text-xs text-[#737373] font-mono">
                  {latestDetail?.observations.length ?? 0} windows plotted
                </span>
              </div>

              {loadingDetail ? (
                <div className="h-64 flex items-center justify-center rounded-lg bg-[#101010] border border-[#292929]">
                  <RefreshCw className="h-6 w-6 animate-spin text-[#FF6A00]" />
                </div>
              ) : timelineData.length > 0 ? (
                <div className="h-64 w-full rounded-lg bg-[#101010] border border-[#292929] p-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timelineData}>
                      <defs>
                        <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#FF6A00" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#FF6A00" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#292929" />
                      <XAxis
                        dataKey="timeLabel"
                        stroke="#737373"
                        fontSize={11}
                        fontFamily="var(--font-mono)"
                        tickLine={false}
                      />
                      <YAxis
                        stroke="#737373"
                        fontSize={11}
                        fontFamily="var(--font-mono)"
                        tickLine={false}
                        domain={[0, 'auto']}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                              <div className="rounded-lg bg-[#141414] border border-[#383838] p-3 text-xs shadow-2xl">
                                <p className="font-semibold text-[#F5F5F5] font-mono">Window: {data.timeLabel}</p>
                                <p className="text-[#FF6A00] font-mono mt-1">
                                  Count: {data.count} ({latestDetail?.measurement_type})
                                </p>
                                <p className="text-[#A3A3A3] font-mono">
                                  Expected λ: {data.baseline.toFixed(2)}
                                </p>
                                <p className="text-[#A3A3A3] font-mono">
                                  P-Value: {formatProbability(data.pValue)}
                                </p>
                                {data.isBurst && (
                                  <p className="text-[#ef4444] font-semibold mt-1 flex items-center gap-1">
                                    <Flame className="h-3 w-3" /> Burst Alert Flagged
                                  </p>
                                )}
                                {data.groundTruth !== undefined && data.groundTruth !== null && (
                                  <p className="text-[#737373] text-[10px] mt-0.5">
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
                        stroke="#A3A3A3"
                        strokeDasharray="4 4"
                        label={{
                          value: `λ = ${latestDetail?.baseline_lambda.toFixed(1)}`,
                          fill: '#A3A3A3',
                          fontSize: 10,
                          position: 'insideTopLeft',
                          fontFamily: 'var(--font-mono)',
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="count"
                        stroke="#FF6A00"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#colorCount)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-40 flex items-center justify-center rounded-lg bg-[#101010] border border-[#292929] text-xs text-[#737373]">
                  Select an experiment to display its detection timeline.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recent Experiments Table */}
      {summary && summary.recent_experiments.length > 0 && (
        <div className="rounded-lg border border-[#292929] bg-[#141414] overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#292929] bg-[#101010] px-4 sm:px-6 py-4">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-[#FF6A00]" />
              <h2 className="font-heading text-sm font-semibold uppercase tracking-wider text-[#F5F5F5]">
                Recent Saved Experiments
              </h2>
            </div>
            <Link
              href="/experiments"
              className="flex items-center gap-1 text-xs font-medium text-[#FF6A00] hover:text-[#FF7A1A] transition-colors"
            >
              <span>View All Experiments</span>
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#A3A3A3]">
              <thead className="bg-[#101010] text-[11px] font-semibold uppercase tracking-wider text-[#737373] border-b border-[#292929]">
                <tr>
                  <th className="px-4 sm:px-6 py-3 font-medium">Experiment ID</th>
                  <th className="px-4 sm:px-6 py-3 font-medium">Title</th>
                  <th className="px-4 sm:px-6 py-3 font-medium">Type</th>
                  <th className="px-4 sm:px-6 py-3 font-medium">Measurement</th>
                  <th className="px-4 sm:px-6 py-3 font-medium">Baseline λ</th>
                  <th className="px-4 sm:px-6 py-3 font-medium">Windows</th>
                  <th className="px-4 sm:px-6 py-3 font-medium">Bursts</th>
                  <th className="px-4 sm:px-6 py-3 font-medium">Ground Truth</th>
                  <th className="px-4 sm:px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202020]">
                {summary.recent_experiments.map((exp) => (
                  <tr
                    key={exp.experiment_id}
                    className="hover:bg-[#191919] transition-colors"
                  >
                    <td className="px-4 sm:px-6 py-3.5 font-mono text-[#F5F5F5] font-medium">
                      {exp.experiment_id}
                    </td>
                    <td className="px-4 sm:px-6 py-3.5 text-[#F5F5F5] max-w-xs truncate" title={exp.title}>
                      {exp.title}
                    </td>
                    <td className="px-4 sm:px-6 py-3.5">
                      <StatusBadge
                        label={exp.experiment_type}
                        variant={exp.experiment_type === 'simulation' ? 'accent' : 'neutral'}
                      />
                    </td>
                    <td className="px-4 sm:px-6 py-3.5 font-mono text-[#A3A3A3]">
                      {exp.measurement_type}
                    </td>
                    <td className="px-4 sm:px-6 py-3.5 font-mono text-[#F5F5F5]">
                      {exp.baseline_lambda.toFixed(2)}
                    </td>
                    <td className="px-4 sm:px-6 py-3.5 font-mono text-[#F5F5F5]">
                      {exp.observation_count}
                    </td>
                    <td className="px-4 sm:px-6 py-3.5 font-mono text-[#ef4444] font-semibold">
                      {exp.detected_window_count}
                    </td>
                    <td className="px-4 sm:px-6 py-3.5">
                      {exp.ground_truth_available ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 text-[11px] font-mono">
                          <CheckCircle2 className="h-3 w-3" /> Labeled
                        </span>
                      ) : (
                        <span className="text-[#737373] text-[11px] font-mono">Unlabeled</span>
                      )}
                    </td>
                    <td className="px-4 sm:px-6 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleDownloadCsv(exp.experiment_id, exp.title)}
                          disabled={downloadingId === exp.experiment_id}
                          className="rounded p-1.5 text-[#A3A3A3] hover:text-[#F5F5F5] hover:bg-[#202020] transition-colors"
                          title="Download CSV"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        <Link
                          href={`/experiments?selected=${exp.experiment_id}`}
                          className="rounded p-1.5 text-[#FF6A00] hover:text-[#FF7A1A] hover:bg-[rgba(255,106,0,0.1)] transition-colors"
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
        <Link
          href="/simulation"
          className="group rounded-lg border border-[#292929] bg-[#141414] p-5 hover:border-[rgba(255,106,0,0.4)] hover:bg-[#181818] transition-all"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[rgba(255,106,0,0.1)] text-[#FF6A00] mb-3 group-hover:scale-105 transition-transform border border-[rgba(255,106,0,0.25)]">
            <FlaskConical className="h-4 w-4" />
          </div>
          <h3 className="font-heading text-sm font-semibold text-[#F5F5F5] group-hover:text-[#FF6A00] transition-colors">
            Simulation Lab
          </h3>
          <p className="text-xs text-[#737373] mt-1 leading-relaxed">
            Generate reproducible Poisson traffic, sudden bursts, rate drift, and overdispersed scenarios.
          </p>
        </Link>

        <Link
          href="/historical"
          className="group rounded-lg border border-[#292929] bg-[#141414] p-5 hover:border-[rgba(255,106,0,0.4)] hover:bg-[#181818] transition-all"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#191919] text-[#A3A3A3] mb-3 group-hover:scale-105 transition-transform border border-[#292929]">
            <History className="h-4 w-4" />
          </div>
          <h3 className="font-heading text-sm font-semibold text-[#F5F5F5] group-hover:text-[#FF6A00] transition-colors">
            Historical Replay
          </h3>
          <p className="text-xs text-[#737373] mt-1 leading-relaxed">
            Upload CSV network flows, calibrate baseline with contamination exclusion, and replay detections.
          </p>
        </Link>

        <Link
          href="/analysis"
          className="group rounded-lg border border-[#292929] bg-[#141414] p-5 hover:border-[rgba(255,106,0,0.4)] hover:bg-[#181818] transition-all"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#191919] text-[#A3A3A3] mb-3 group-hover:scale-105 transition-transform border border-[#292929]">
            <BarChart2 className="h-4 w-4" />
          </div>
          <h3 className="font-heading text-sm font-semibold text-[#F5F5F5] group-hover:text-[#FF6A00] transition-colors">
            Statistical Analysis
          </h3>
          <p className="text-xs text-[#737373] mt-1 leading-relaxed">
            Explore Poisson PMF curves, upper-tail probabilities, dispersion ratios, and inspect saved experiments.
          </p>
        </Link>

        <Link
          href="/experiments"
          className="group rounded-lg border border-[#292929] bg-[#141414] p-5 hover:border-[rgba(255,106,0,0.4)] hover:bg-[#181818] transition-all"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#191919] text-[#A3A3A3] mb-3 group-hover:scale-105 transition-transform border border-[#292929]">
            <Database className="h-4 w-4" />
          </div>
          <h3 className="font-heading text-sm font-semibold text-[#F5F5F5] group-hover:text-[#FF6A00] transition-colors">
            Experiment History
          </h3>
          <p className="text-xs text-[#737373] mt-1 leading-relaxed">
            Filter, search, compare compatible trials side-by-side, inspect observation tables, and export results.
          </p>
        </Link>
      </div>
    </div>
  );
}
