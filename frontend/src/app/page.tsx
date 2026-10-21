'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart2,
  CheckCircle2,
  Flame,
  FlaskConical,
  History,
  Layers,
  Play,
  Radio,
  RefreshCw,
  TrendingUp,
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
import { SimulationResponse } from '@/lib/types';
import { formatProbability } from '@/lib/utils';

export default function DashboardPage() {
  const [experimentData, setExperimentData] = useState<SimulationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRunCalibrationDemo = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.runSimulation({
        scenario: 'sudden_burst',
        baseline_rate: 14.0,
        duration_seconds: 45,
        window_seconds: 1.0,
        burst_start_second: 18,
        burst_duration_seconds: 8,
        burst_rate: 42.0,
        alpha: 0.01,
        random_seed: 42,
      });
      setExperimentData(res);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred while communicating with the backend.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setExperimentData(null);
    setError(null);
  };

  // Prepare chart data if experiment data is present
  const chartData = experimentData
    ? experimentData.observations.map((obs, idx) => {
        const det = experimentData.detections[idx];
        return {
          window: obs.timestamp,
          count: obs.count,
          baseline: experimentData.baseline_rate,
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
            <span>Primary Page Owner: Juvansan H (URK25CS1018)</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl mt-1">
            Traffic Burst Detection Dashboard
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-3xl">
            Live monitoring and experiment overview evaluating network arrival counts
            against a Poisson baseline rate using upper-tail probabilities.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {experimentData ? (
            <button
              onClick={handleReset}
              className="inline-flex items-center gap-2 rounded-md bg-[#191c26] border border-[#2d3244] px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-[#202534] transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reset Dashboard
            </button>
          ) : (
            <button
              onClick={handleRunCalibrationDemo}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-md bg-orange-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-orange-500 disabled:opacity-50 transition-colors"
            >
              {loading ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Generating from Backend...
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 fill-current" />
                  Run Calibration Simulation
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="mt-6 rounded-lg border border-red-500/40 bg-red-950/30 p-4 text-xs text-red-200">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-red-300">Backend Communication Notice</p>
              <p className="mt-1">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Metric Cards Row */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Total Observations */}
        <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Total Windows Analyzed</span>
            <Layers className="h-4 w-4 text-slate-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-white font-mono">
              {experimentData ? experimentData.total_windows : '0'}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              {experimentData ? '1.0s windows' : 'no data'}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            Unit: Packet counts per fixed time window.
          </p>
        </div>

        {/* Card 2: Detected Bursts */}
        <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Detected Bursts</span>
            <Flame className="h-4 w-4 text-orange-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-red-400 font-mono">
              {experimentData ? experimentData.detected_burst_count : '0'}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              {experimentData && experimentData.total_windows > 0
                ? `${((experimentData.detected_burst_count / experimentData.total_windows) * 100).toFixed(1)}%`
                : '0.0%'}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            Criteria: P(X ≥ x | λ) &lt; α (0.01).
          </p>
        </div>

        {/* Card 3: Estimated Baseline */}
        <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Baseline Rate (λ̂)</span>
            <TrendingUp className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-emerald-400 font-mono">
              {experimentData ? `${experimentData.baseline_rate.toFixed(1)}` : '—'}
            </span>
            <span className="text-xs text-slate-400 font-mono">arrivals / window</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            Frozen sample mean during calibration.
          </p>
        </div>

        {/* Card 4: False-Positive Rate */}
        <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">False-Positive Rate</span>
            <CheckCircle2 className="h-4 w-4 text-slate-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-white font-mono">
              {experimentData?.evaluation
                ? `${(experimentData.evaluation.false_positive_rate * 100).toFixed(1)}%`
                : 'N/A'}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              {experimentData?.evaluation ? 'vs ground truth' : 'unlabeled'}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            Calculated strictly when ground truth exists.
          </p>
        </div>
      </div>

      {/* Data Source Status Badges */}
      <div className="mt-4 rounded-lg border border-[#262a38] bg-[#14161f] p-3">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-300">Data Sources:</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 rounded bg-[#1c1f2b] border border-[#2d3244] px-2.5 py-1 text-slate-300">
              <History className="h-3.5 w-3.5 text-blue-400" />
              <span>Historical (CSV / PCAP):</span>
              <span className="text-amber-400 font-medium">Phase 2 Ingestion</span>
            </div>
            <div className="flex items-center gap-1.5 rounded bg-[#1c1f2b] border border-[#2d3244] px-2.5 py-1 text-slate-300">
              <FlaskConical className="h-3.5 w-3.5 text-orange-400" />
              <span>Simulation Engine:</span>
              <span className="text-emerald-400 font-medium">Active (Deterministic)</span>
            </div>
            <div className="flex items-center gap-1.5 rounded bg-[#1c1f2b] border border-[#2d3244] px-2.5 py-1 text-slate-300">
              <Radio className="h-3.5 w-3.5 text-slate-400" />
              <span>Arduino Hardware UDP:</span>
              <span className="text-slate-400 font-medium">Phase 3 Listener</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area: Chart & Table or Empty State */}
      {experimentData ? (
        <div className="mt-6 space-y-6">
          {/* Timeline Chart */}
          <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-[#262a38]">
              <div>
                <h2 className="text-base font-semibold text-white">
                  Traffic Arrival Timeline & Detection Events
                </h2>
                <p className="text-xs text-slate-400">
                  Observed arrivals per 1-second window. Injected bursts and statistical detections highlighted.
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs font-mono">
                <span className="flex items-center gap-1.5 text-slate-300">
                  <span className="h-2 w-2 rounded-full bg-orange-500" />
                  Count (X)
                </span>
                <span className="flex items-center gap-1.5 text-slate-300">
                  <span className="h-0.5 w-3 bg-emerald-400" />
                  Baseline λ̂ ({experimentData.baseline_rate})
                </span>
                <span className="flex items-center gap-1.5 text-slate-300">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  Burst Flag
                </span>
              </div>
            </div>

            <div className="mt-4 h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trafficGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262a38" vertical={false} />
                  <XAxis
                    dataKey="window"
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    interval={4}
                  />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1c1f2b',
                      borderColor: '#262a38',
                      borderRadius: '6px',
                      fontSize: '12px',
                    }}
                    labelStyle={{ color: '#94a3b8' }}
                  />
                  <ReferenceLine
                    y={experimentData.baseline_rate}
                    stroke="#10b981"
                    strokeDasharray="4 4"
                    label={{
                      value: `λ̂=${experimentData.baseline_rate}`,
                      fill: '#10b981',
                      fontSize: 10,
                      position: 'right',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="#f97316"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#trafficGradient)"
                    name="Arrival Count"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Recent Detection Events Table */}
          <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-5">
            <div className="pb-3 border-b border-[#262a38]">
              <h2 className="text-base font-semibold text-white">
                Recent Traffic Observations & Statistical Decisions
              </h2>
              <p className="text-xs text-slate-400">
                Authoritative evaluation from FastAPI backend using SciPy survival function P(X ≥ x | λ).
              </p>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#262a38] text-slate-400 font-mono">
                    <th className="py-2.5 px-3">Window</th>
                    <th className="py-2.5 px-3">Observed (x)</th>
                    <th className="py-2.5 px-3">Expected (λ̂)</th>
                    <th className="py-2.5 px-3">P(X ≥ x | λ)</th>
                    <th className="py-2.5 px-3">Alpha (α)</th>
                    <th className="py-2.5 px-3">Decision</th>
                    <th className="py-2.5 px-3">Ground Truth</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#262a38]/60 font-mono">
                  {experimentData.observations.slice(0, 15).map((obs, idx) => {
                    const det = experimentData.detections[idx];
                    const isBurst = det ? det.is_burst : false;
                    return (
                      <tr
                        key={idx}
                        className={`hover:bg-[#1c1f2b]/50 transition-colors ${
                          isBurst ? 'bg-red-950/15' : ''
                        }`}
                      >
                        <td className="py-2 px-3 text-slate-300">{obs.timestamp}</td>
                        <td className="py-2 px-3 font-semibold text-white">{obs.count}</td>
                        <td className="py-2 px-3 text-slate-400">
                          {experimentData.baseline_rate.toFixed(1)}
                        </td>
                        <td className="py-2 px-3 text-slate-300">
                          {det ? formatProbability(det.p_value) : '—'}
                        </td>
                        <td className="py-2 px-3 text-slate-400">
                          {det ? det.alpha : '0.01'}
                        </td>
                        <td className="py-2 px-3">
                          {isBurst ? (
                            <span className="inline-flex items-center rounded bg-red-500/20 border border-red-500/30 px-2 py-0.5 text-[11px] font-semibold text-red-400">
                              BURST ALERT
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[11px] text-emerald-400">
                              NORMAL
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          {obs.ground_truth === true ? (
                            <span className="text-orange-400">Injected Burst</span>
                          ) : obs.ground_truth === false ? (
                            <span className="text-slate-400">Normal Baseline</span>
                          ) : (
                            <span className="text-slate-500">Unlabeled</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {experimentData.observations.length > 15 && (
              <p className="mt-3 text-center text-xs text-slate-400">
                Showing first 15 of {experimentData.observations.length} observations. See Simulation Lab for full telemetry.
              </p>
            )}
          </div>
        </div>
      ) : (
        /* Polished Empty State */
        <div className="mt-8 rounded-xl border border-dashed border-[#262a38] bg-[#14161f]/60 p-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400">
            <Activity className="h-7 w-7" />
          </div>
          <h3 className="mt-4 text-base font-semibold text-white">
            No Active Traffic Telemetry Loaded
          </h3>
          <p className="mx-auto mt-2 max-w-md text-xs text-slate-400 leading-relaxed">
            The dashboard displays empirical measurements and statistical decisions.
            No fake data is generated by default. Start by running a calibration simulation
            or configuring traffic in the lab.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={handleRunCalibrationDemo}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-md bg-orange-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-orange-500 disabled:opacity-50 transition-colors"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              {loading ? 'Calling FastAPI Backend...' : 'Run Quick Calibration Simulation'}
            </button>
            <Link
              href="/simulation"
              className="inline-flex items-center gap-2 rounded-md bg-[#1c1f2b] border border-[#2d3244] px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white hover:bg-[#252a3b] transition-colors"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              Open Simulation Lab
            </Link>
          </div>
        </div>
      )}

      {/* Quick Navigation Cards */}
      <div className="mt-10">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
          Micro-Project Modules & Workspaces
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Link
            href="/historical"
            className="group rounded-lg border border-[#262a38] bg-[#14161f] p-4 hover:border-orange-500/40 transition-colors"
          >
            <div className="flex items-center justify-between text-slate-400 group-hover:text-orange-400">
              <History className="h-5 w-5 text-blue-400" />
              <ArrowRight className="h-4 w-4" />
            </div>
            <h4 className="mt-3 text-sm font-semibold text-white group-hover:text-orange-300">
              Historical Traffic Replay
            </h4>
            <p className="mt-1 text-xs text-slate-400">
              Inspect CSV flow summaries and PCAP captures. Configurable aggregation windows and event replay.
            </p>
            <p className="mt-3 text-[11px] text-slate-400">Owner: Abishek Joseph E</p>
          </Link>

          <Link
            href="/simulation"
            className="group rounded-lg border border-[#262a38] bg-[#14161f] p-4 hover:border-orange-500/40 transition-colors"
          >
            <div className="flex items-center justify-between text-slate-400 group-hover:text-orange-400">
              <FlaskConical className="h-5 w-5 text-orange-400" />
              <ArrowRight className="h-4 w-4" />
            </div>
            <h4 className="mt-3 text-sm font-semibold text-white group-hover:text-orange-300">
              Simulation Laboratory
            </h4>
            <p className="mt-1 text-xs text-slate-400">
              Generate controlled synthetic traffic, inject known bursts, and evaluate precision/recall metrics.
            </p>
            <p className="mt-3 text-[11px] text-slate-400">Owner: Naveen Kumar R V</p>
          </Link>

          <Link
            href="/analysis"
            className="group rounded-lg border border-[#262a38] bg-[#14161f] p-4 hover:border-orange-500/40 transition-colors"
          >
            <div className="flex items-center justify-between text-slate-400 group-hover:text-orange-400">
              <BarChart2 className="h-5 w-5 text-emerald-400" />
              <ArrowRight className="h-4 w-4" />
            </div>
            <h4 className="mt-3 text-sm font-semibold text-white group-hover:text-orange-300">
              Statistical Analysis & Evaluation
            </h4>
            <p className="mt-1 text-xs text-slate-400">
              Interactive Poisson calculator, PMF distribution explorer, and variance-to-mean dispersion analysis.
            </p>
            <p className="mt-3 text-[11px] text-slate-400">Owner: Shirley S</p>
          </Link>
        </div>
      </div>
    </div>
  );
}
