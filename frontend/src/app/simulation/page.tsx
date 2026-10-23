'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  Eye,
  Filter,
  Flame,
  FlaskConical,
  Layers,
  Play,
  RefreshCw,
  Shuffle,
  Sliders,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, ApiClientError } from '@/lib/api';
import {
  DetectionResponse,
  SimulationRequest,
  SimulationResponse,
  SimulationScenario,
  TrafficObservation,
} from '@/lib/types';
import { formatProbability } from '@/lib/utils';

export default function SimulationLabPage() {
  // Scenario Selection State
  const [scenario, setScenario] = useState<SimulationScenario>('sudden_burst');

  // Common Configuration State
  const [baselineRatePerSecond, setBaselineRatePerSecond] = useState<number>(15.0);
  const [durationSeconds, setDurationSeconds] = useState<number>(60);
  const [windowSeconds, setWindowSeconds] = useState<number>(1.0);
  const [alpha, setAlpha] = useState<number>(0.01);
  const [randomSeed, setRandomSeed] = useState<number>(42);

  // Scenario-Specific State
  // 1. Sudden Burst
  const [burstStart, setBurstStart] = useState<number>(25);
  const [burstDuration, setBurstDuration] = useState<number>(10);
  const [burstRatePerSecond, setBurstRatePerSecond] = useState<number>(45.0);

  // 2. Rate Drift
  const [rateDriftEndPerSecond, setRateDriftEndPerSecond] = useState<number>(45.0);

  // 3. Overdispersed Traffic
  const [dispersionFactor, setDispersionFactor] = useState<number>(3.0);

  // Execution & Results State
  const [simulationResult, setSimulationResult] = useState<SimulationResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Table Filter & Inspection State
  const [tableFilter, setTableFilter] = useState<'all' | 'alerts_only' | 'bursts_only'>('all');
  const [selectedObservationIdx, setSelectedObservationIdx] = useState<number | null>(null);

  // Computed Expected Baseline per Window
  const lambdaWindow = Number((baselineRatePerSecond * windowSeconds).toFixed(3));
  const burstLambdaWindow = Number((burstRatePerSecond * windowSeconds).toFixed(3));

  const validateInputs = (): string | null => {
    if (baselineRatePerSecond <= 0) return 'Baseline arrival rate per second must be greater than 0.';
    if (durationSeconds <= 0) return 'Duration must be greater than 0.';
    if (windowSeconds <= 0) return 'Window size must be greater than 0.';
    if (windowSeconds > durationSeconds) return 'Observation window size cannot exceed total simulation duration.';

    if (scenario === 'sudden_burst') {
      if (burstStart < 0) return 'Burst start time cannot be negative.';
      if (burstDuration <= 0) return 'Burst duration must be greater than 0.';
      if (burstStart + burstDuration > durationSeconds) {
        return `Burst interval [${burstStart}s, ${burstStart + burstDuration}s] exceeds simulation duration (${durationSeconds}s).`;
      }
      if (burstRatePerSecond <= 0) return 'Burst arrival rate must be greater than 0.';
    }

    if (scenario === 'rate_drift') {
      if (rateDriftEndPerSecond <= 0) return 'Ending drift rate must be greater than 0.';
    }

    if (scenario === 'overdispersed') {
      if (dispersionFactor <= 1.0) return 'Dispersion factor must be strictly greater than 1.0 for overdispersed traffic.';
    }

    if (alpha <= 0 || alpha >= 1.0) return 'Significance level alpha must lie strictly between 0 and 1.';

    return null;
  };

  const handleRunSimulation = async () => {
    const valErr = validateInputs();
    if (valErr) {
      setValidationError(valErr);
      return;
    }
    setValidationError(null);

    try {
      setLoading(true);
      setError(null);

      const payload: SimulationRequest = {
        scenario,
        baseline_rate_per_second: Number(baselineRatePerSecond),
        baseline_rate: Number(baselineRatePerSecond),
        duration_seconds: Number(durationSeconds),
        window_seconds: Number(windowSeconds),
        alpha: Number(alpha),
        random_seed: Number(randomSeed),
      };

      if (scenario === 'sudden_burst') {
        payload.burst_start_second = Number(burstStart);
        payload.burst_duration_seconds = Number(burstDuration);
        payload.burst_rate_per_second = Number(burstRatePerSecond);
        payload.burst_rate = Number(burstRatePerSecond);
      } else if (scenario === 'rate_drift') {
        payload.rate_drift_end_per_second = Number(rateDriftEndPerSecond);
      } else if (scenario === 'overdispersed') {
        payload.dispersion_factor = Number(dispersionFactor);
      }

      const result = await api.runSimulation(payload);
      setSimulationResult(result);
      setSelectedObservationIdx(null);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Simulation request failed due to an unexpected client error.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerateSeed = () => {
    setRandomSeed(Math.floor(Math.random() * 100000));
  };

  // Prepare chart data with distinct points for observed counts, baseline, and detected alerts
  const chartData = simulationResult
    ? simulationResult.observations.map((obs, idx) => {
        const det = simulationResult.detections[idx];
        const isAlert = det ? det.is_burst : false;
        return {
          window: obs.timestamp,
          timeSec: obs.time_seconds !== undefined ? obs.time_seconds : idx * simulationResult.window_seconds,
          count: obs.count,
          baseline: simulationResult.lambda_window,
          isInjected: obs.ground_truth,
          isAlert,
          alertCount: isAlert ? obs.count : null,
          pValue: det ? det.p_value : 1.0,
        };
      })
    : [];

  // Filtered observations for the inspector table
  const filteredIndices = simulationResult
    ? simulationResult.observations
        .map((obs, idx) => ({ obs, det: simulationResult.detections[idx], idx }))
        .filter(({ obs, det }) => {
          if (tableFilter === 'alerts_only') return det?.is_burst;
          if (tableFilter === 'bursts_only') return obs.ground_truth;
          return true;
        })
    : [];

  const selectedObservation: TrafficObservation | null =
    simulationResult && selectedObservationIdx !== null
      ? simulationResult.observations[selectedObservationIdx]
      : null;

  const selectedDetection: DetectionResponse | null =
    simulationResult && selectedObservationIdx !== null
      ? simulationResult.detections[selectedObservationIdx]
      : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Page Header */}
      <div className="border-b border-[#262a38] pb-6">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-orange-400">
          <span>Primary Page Owner: Naveen Kumar R V (URK25CS1016)</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl mt-1">
          Synthetic Simulation Laboratory
        </h1>
        <p className="text-sm text-slate-400 mt-1 max-w-3xl">
          Generate deterministic, reproducible Poisson and non-Poisson traffic time series,
          inject controlled arrival bursts, evaluate detector sensitivity and false alarms, and investigate model limitations.
        </p>
      </div>

      {/* Error Banners */}
      {validationError && (
        <div className="mt-6 rounded-lg border border-amber-500/40 bg-amber-950/30 p-4 text-xs text-amber-200">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-amber-300">Invalid Configuration Parameter</p>
              <p className="mt-1">{validationError}</p>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-lg border border-red-500/40 bg-red-950/30 p-4 text-xs text-red-200">
          <div className="flex items-start gap-3">
            <XCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-red-300">Backend API Error</p>
              <p className="mt-1">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Main Layout Grid */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Controls (4 cols) */}
        <div className="lg:col-span-4 space-y-5">
          {/* Scenario Selector Card */}
          <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-5">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2 pb-3 border-b border-[#262a38]">
              <FlaskConical className="h-4 w-4 text-orange-400" />
              1. Select Traffic Scenario
            </h2>

            <div className="mt-4 space-y-2 text-xs">
              <button
                type="button"
                onClick={() => setScenario('sudden_burst')}
                className={`w-full text-left rounded-md p-3 transition-colors border ${
                  scenario === 'sudden_burst'
                    ? 'bg-orange-500/15 border-orange-500/50 text-white'
                    : 'bg-[#1c1f2b] border-[#262a38] text-slate-300 hover:bg-[#232737]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold flex items-center gap-1.5">
                    <Flame className="h-3.5 w-3.5 text-orange-400" />
                    Sudden Traffic Burst
                  </span>
                  <span className="rounded bg-[#0c0d12] px-1.5 py-0.5 text-[10px] text-orange-400 font-mono">
                    Controlled
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Injects an elevated Poisson rate during a defined window to test detector recall and detection delay.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setScenario('poisson_normal')}
                className={`w-full text-left rounded-md p-3 transition-colors border ${
                  scenario === 'poisson_normal'
                    ? 'bg-orange-500/15 border-orange-500/50 text-white'
                    : 'bg-[#1c1f2b] border-[#262a38] text-slate-300 hover:bg-[#232737]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    Normal Poisson Traffic
                  </span>
                  <span className="rounded bg-[#0c0d12] px-1.5 py-0.5 text-[10px] text-emerald-400 font-mono">
                    Baseline
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Homogeneous Poisson arrivals X ~ Poisson(&lambda;). Tests empirical false alarm rate against &alpha;.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setScenario('rate_drift')}
                className={`w-full text-left rounded-md p-3 transition-colors border ${
                  scenario === 'rate_drift'
                    ? 'bg-orange-500/15 border-orange-500/50 text-white'
                    : 'bg-[#1c1f2b] border-[#262a38] text-slate-300 hover:bg-[#232737]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold flex items-center gap-1.5">
                    <TrendingUp className="h-3.5 w-3.5 text-blue-400" />
                    Changing Traffic Rate
                  </span>
                  <span className="rounded bg-[#0c0d12] px-1.5 py-0.5 text-[10px] text-blue-400 font-mono">
                    Drift
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Non-stationary linear rate increase. Demonstrates why a static baseline fails when background trends shift.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setScenario('overdispersed')}
                className={`w-full text-left rounded-md p-3 transition-colors border ${
                  scenario === 'overdispersed'
                    ? 'bg-orange-500/15 border-orange-500/50 text-white'
                    : 'bg-[#1c1f2b] border-[#262a38] text-slate-300 hover:bg-[#232737]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-purple-400" />
                    Overdispersed Traffic
                  </span>
                  <span className="rounded bg-[#0c0d12] px-1.5 py-0.5 text-[10px] text-purple-400 font-mono">
                    Negative Binomial
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Var(X) &gt; E[X]. Heavy-tailed arrivals violate the Poisson model, causing inflated false alarms.
                </p>
              </button>
            </div>
          </div>

          {/* Configuration Panel Card */}
          <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-5">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2 pb-3 border-b border-[#262a38]">
              <Sliders className="h-4 w-4 text-orange-400" />
              2. Parameter Configuration
            </h2>

            <div className="mt-4 space-y-4 text-xs">
              {/* Baseline Rate Per Second */}
              <div>
                <div className="flex justify-between items-center">
                  <label className="font-medium text-slate-300">
                    Baseline Rate ($r$):
                  </label>
                  <span className="font-mono text-orange-400 font-semibold">
                    {baselineRatePerSecond} pkts/s
                  </span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="60"
                  step="1"
                  value={baselineRatePerSecond}
                  onChange={(e) => setBaselineRatePerSecond(Number(e.target.value))}
                  className="mt-1 w-full accent-orange-500"
                />
                <div className="flex justify-between text-[11px] text-slate-400 font-mono mt-0.5">
                  <span>Window Expected &lambda;<sub>w</sub>:</span>
                  <span className="text-emerald-400 font-bold">{lambdaWindow}</span>
                </div>
              </div>

              {/* Duration and Window Size */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-300">Duration (s)</label>
                  <input
                    type="number"
                    min="10"
                    max="300"
                    value={durationSeconds}
                    onChange={(e) => setDurationSeconds(Number(e.target.value))}
                    className="mt-1 w-full rounded-md border border-[#262a38] bg-[#1c1f2b] px-3 py-1.5 font-mono text-xs text-white focus:border-orange-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-400">Total duration</span>
                </div>
                <div>
                  <label className="block font-medium text-slate-300">Window $W$ (s)</label>
                  <input
                    type="number"
                    min="0.2"
                    max="10.0"
                    step="0.5"
                    value={windowSeconds}
                    onChange={(e) => setWindowSeconds(Number(e.target.value))}
                    className="mt-1 w-full rounded-md border border-[#262a38] bg-[#1c1f2b] px-3 py-1.5 font-mono text-xs text-white focus:border-orange-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-400">Aggregation window</span>
                </div>
              </div>

              {/* SCENARIO-SPECIFIC CONTROLS */}
              {/* A. Sudden Burst Controls */}
              {scenario === 'sudden_burst' && (
                <div className="rounded border border-orange-500/30 bg-[#1c1f2b] p-3 space-y-3">
                  <div className="flex items-center gap-1.5 text-orange-400 font-semibold text-[11px]">
                    <Flame className="h-3.5 w-3.5" />
                    Injected Burst Settings
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <span className="text-[10px] text-slate-400">Start (s)</span>
                      <input
                        type="number"
                        min="0"
                        max={durationSeconds - 2}
                        value={burstStart}
                        onChange={(e) => setBurstStart(Number(e.target.value))}
                        className="mt-0.5 w-full rounded border border-[#262a38] bg-[#0c0d12] px-2 py-1 font-mono text-xs text-white"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400">Duration (s)</span>
                      <input
                        type="number"
                        min="1"
                        max={durationSeconds}
                        value={burstDuration}
                        onChange={(e) => setBurstDuration(Number(e.target.value))}
                        className="mt-0.5 w-full rounded border border-[#262a38] bg-[#0c0d12] px-2 py-1 font-mono text-xs text-white"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400">Burst pkts/s</span>
                      <input
                        type="number"
                        min="1"
                        max="200"
                        value={burstRatePerSecond}
                        onChange={(e) => setBurstRatePerSecond(Number(e.target.value))}
                        className="mt-0.5 w-full rounded border border-[#262a38] bg-[#0c0d12] px-2 py-1 font-mono text-xs text-white"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 font-mono">
                    Burst &lambda;<sub>w</sub>: <strong className="text-orange-400">{burstLambdaWindow}</strong> pkts / {windowSeconds}s window.
                  </p>
                </div>
              )}

              {/* B. Rate Drift Controls */}
              {scenario === 'rate_drift' && (
                <div className="rounded border border-blue-500/30 bg-[#1c1f2b] p-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-blue-400 font-semibold text-[11px]">
                    <TrendingUp className="h-3.5 w-3.5" />
                    Linear Drift Target
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-300">End Rate at T+{durationSeconds}s:</span>
                      <span className="font-mono text-blue-400 font-semibold">{rateDriftEndPerSecond} pkts/s</span>
                    </div>
                    <input
                      type="range"
                      min="5"
                      max="120"
                      step="5"
                      value={rateDriftEndPerSecond}
                      onChange={(e) => setRateDriftEndPerSecond(Number(e.target.value))}
                      className="mt-1 w-full accent-blue-500"
                    />
                  </div>
                  <p className="text-[10px] text-slate-400">
                    Traffic rate shifts from {baselineRatePerSecond} to {rateDriftEndPerSecond} pkts/s.
                  </p>
                </div>
              )}

              {/* C. Overdispersed Controls */}
              {scenario === 'overdispersed' && (
                <div className="rounded border border-purple-500/30 bg-[#1c1f2b] p-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-purple-400 font-semibold text-[11px]">
                    <Layers className="h-3.5 w-3.5" />
                    Dispersion Parameter
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-300">Variance / Mean ($D$):</span>
                      <span className="font-mono text-purple-400 font-semibold">{dispersionFactor.toFixed(1)}x</span>
                    </div>
                    <input
                      type="range"
                      min="1.2"
                      max="8.0"
                      step="0.2"
                      value={dispersionFactor}
                      onChange={(e) => setDispersionFactor(Number(e.target.value))}
                      className="mt-1 w-full accent-purple-500"
                    />
                  </div>
                  <p className="text-[10px] text-slate-400">
                    Var(X) = {dispersionFactor.toFixed(1)} &times; E[X]. Higher D increases burstiness and false alerts.
                  </p>
                </div>
              )}

              {/* Significance Threshold Alpha */}
              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  Significance Threshold ($\alpha$)
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {[0.05, 0.01, 0.001].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setAlpha(val)}
                      className={`rounded py-1.5 text-xs font-mono font-medium transition-colors ${
                        alpha === val
                          ? 'bg-orange-500/20 border border-orange-500/50 text-orange-400'
                          : 'bg-[#1c1f2b] border border-[#262a38] text-slate-300 hover:bg-[#252a3b]'
                      }`}
                    >
                      {val}
                    </button>
                  ))}
                </div>
              </div>

              {/* Random Seed */}
              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  Random Seed (Reproducibility)
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={randomSeed}
                    onChange={(e) => setRandomSeed(Number(e.target.value))}
                    className="flex-1 rounded-md border border-[#262a38] bg-[#1c1f2b] px-3 py-1.5 font-mono text-xs text-white focus:border-orange-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleRegenerateSeed}
                    className="rounded-md bg-[#1c1f2b] border border-[#262a38] px-2.5 py-1.5 text-slate-300 hover:text-white hover:bg-[#252a3b]"
                    title="Generate new random seed"
                  >
                    <Shuffle className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  Same seed and parameters reproduce identical observations.
                </p>
              </div>

              {/* Run Experiment Button */}
              <button
                type="button"
                onClick={handleRunSimulation}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 rounded-md bg-orange-600 py-2.5 text-xs font-semibold text-white shadow hover:bg-orange-500 disabled:opacity-50 transition-colors mt-2"
              >
                {loading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Running Simulation on FastAPI Backend...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-current" />
                    Run Simulation Experiment
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Visualizations, Metrics, and Inspector (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          {simulationResult ? (
            <>
              {/* Experiment Summary Banner */}
              <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-4 text-xs">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 pb-3 border-b border-[#262a38]">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white text-sm">
                      Experiment: {simulationResult.experiment_id}
                    </span>
                    <span className="rounded bg-orange-500/10 border border-orange-500/30 px-2 py-0.5 text-[11px] font-mono text-orange-400">
                      {simulationResult.scenario}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Link
                      href={`/experiments?selected=${simulationResult.experiment_id}`}
                      className="text-[11px] text-orange-400 hover:text-orange-300 flex items-center gap-1 font-medium bg-[#1c1f2b] px-2 py-0.5 rounded border border-[#2d3244]"
                      title="Inspect in Experiment History"
                    >
                      <Database className="h-3 w-3" />
                      <span>Saved in History</span>
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                    <Link
                      href={`/analysis?experiment_id=${simulationResult.experiment_id}`}
                      className="text-[11px] text-purple-400 hover:text-purple-300 flex items-center gap-1 font-medium bg-[#1c1f2b] px-2 py-0.5 rounded border border-[#2d3244]"
                      title="Inspect in Statistical Analysis"
                    >
                      <span>Analyze in Stats</span>
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                    <span className="text-slate-400 font-mono text-[11px]">
                      Seed: {randomSeed} | Windows: {simulationResult.total_windows} x {simulationResult.window_seconds}s
                    </span>
                  </div>
                </div>

                <div className="mt-3 text-slate-300 leading-relaxed text-[11px]">
                  <p>{simulationResult.summary}</p>
                  {simulationResult.model_limitation_note && (
                    <div className="mt-2 rounded bg-[#0c0d12] border border-[#262a38] p-2.5 text-slate-300">
                      <span className="font-semibold text-orange-400">Statistical Context & Model Limitations: </span>
                      {simulationResult.model_limitation_note}
                    </div>
                  )}
                </div>
              </div>

              {/* Traffic Timeline Chart */}
              <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-[#262a38]">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Traffic Arrival Time Series & Detection Events
                    </h3>
                    <p className="text-xs text-slate-400">
                      Comparing observed arrival counts against Poisson baseline $\lambda_w = {simulationResult.lambda_window}$.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <span className="h-2 w-2 rounded-full bg-orange-500" />
                      Observed ($x$)
                    </span>
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <span className="h-0.5 w-3 bg-emerald-400" />
                      Baseline &lambda;<sub>w</sub> ({simulationResult.lambda_window})
                    </span>
                    {simulationResult.injected_burst_count > 0 && (
                      <span className="flex items-center gap-1.5 text-amber-300">
                        <span className="h-2 w-2 bg-amber-500/40 border border-amber-500" />
                        Injected Burst (Ground Truth)
                      </span>
                    )}
                    <span className="flex items-center gap-1.5 text-red-400">
                      <span className="h-2 w-2 rounded-full bg-red-500 border border-red-300" />
                      Alert ($p &lt; \alpha$)
                    </span>
                  </div>
                </div>

                <div className="mt-4 h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="simFlowGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f97316" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#f97316" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#262a38" vertical={false} />
                      <XAxis dataKey="window" stroke="#64748b" fontSize={11} tickLine={false} interval={Math.max(1, Math.floor(chartData.length / 10))} />
                      <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1c1f2b',
                          borderColor: '#262a38',
                          borderRadius: '6px',
                          fontSize: '12px',
                        }}
                      />

                      {/* Injected Burst Interval Highlight (if scenario == sudden_burst) */}
                      {simulationResult.scenario === 'sudden_burst' && burstStart < durationSeconds && (
                        <ReferenceArea
                          x1={`T+${burstStart.toFixed(1)}s`}
                          x2={`T+${Math.min(durationSeconds, burstStart + burstDuration).toFixed(1)}s`}
                          fill="#f59e0b"
                          fillOpacity={0.15}
                          stroke="#f59e0b"
                          strokeOpacity={0.5}
                          strokeDasharray="3 3"
                        />
                      )}

                      {/* Baseline Reference Line */}
                      <ReferenceLine
                        y={simulationResult.lambda_window}
                        stroke="#10b981"
                        strokeDasharray="4 4"
                        label={{
                          value: `λw=${simulationResult.lambda_window}`,
                          fill: '#10b981',
                          fontSize: 10,
                          position: 'insideTopLeft',
                        }}
                      />

                      {/* Observed Counts Area */}
                      <Area
                        type="monotone"
                        dataKey="count"
                        stroke="#f97316"
                        strokeWidth={2}
                        fill="url(#simFlowGradient)"
                        name="Observed Count"
                      />

                      {/* Red Dots for Detected Burst Alerts */}
                      <Scatter
                        dataKey="alertCount"
                        fill="#ef4444"
                        stroke="#ffffff"
                        strokeWidth={1}
                        name="Burst Alert"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Performance Metrics & Confusion Matrix */}
              {simulationResult.evaluation && (
                <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-5">
                  <div className="flex items-center justify-between pb-3 border-b border-[#262a38]">
                    <div>
                      <h3 className="text-sm font-semibold text-white">
                        Detection Performance Metrics
                      </h3>
                      <p className="text-xs text-slate-400">
                        {simulationResult.injected_burst_count > 0
                          ? 'Evaluated against strictly defined injected burst intervals.'
                          : 'Evaluated under null hypothesis / mismatched traffic (all windows benign background).'}
                      </p>
                    </div>
                    <span className="rounded bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 text-xs text-emerald-400 font-mono">
                      Mathematical Verification
                    </span>
                  </div>

                  {/* Summary Metric Cards */}
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <div className="rounded border border-[#262a38] bg-[#1c1f2b] p-3 text-center">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400">Precision</span>
                      <p className="mt-1 text-xl font-bold font-mono text-white">
                        {simulationResult.injected_burst_count > 0
                          ? `${(simulationResult.evaluation.precision * 100).toFixed(1)}%`
                          : 'N/A'}
                      </p>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {simulationResult.injected_burst_count > 0 ? 'TP / (TP + FP)' : 'No Bursts'}
                      </span>
                    </div>

                    <div className="rounded border border-[#262a38] bg-[#1c1f2b] p-3 text-center">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400">Recall</span>
                      <p className="mt-1 text-xl font-bold font-mono text-emerald-400">
                        {simulationResult.injected_burst_count > 0
                          ? `${(simulationResult.evaluation.recall * 100).toFixed(1)}%`
                          : 'N/A'}
                      </p>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {simulationResult.injected_burst_count > 0 ? 'TP / (TP + FN)' : 'No Bursts'}
                      </span>
                    </div>

                    <div className="rounded border border-[#262a38] bg-[#1c1f2b] p-3 text-center">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400">F1 Score</span>
                      <p className="mt-1 text-xl font-bold font-mono text-orange-400">
                        {simulationResult.injected_burst_count > 0
                          ? simulationResult.evaluation.f1_score.toFixed(3)
                          : 'N/A'}
                      </p>
                      <span className="text-[10px] text-slate-400 font-mono">Harmonic Mean</span>
                    </div>

                    <div className="rounded border border-[#262a38] bg-[#1c1f2b] p-3 text-center">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400">False Alarm Rate</span>
                      <p className="mt-1 text-xl font-bold font-mono text-red-400">
                        {(simulationResult.evaluation.false_positive_rate * 100).toFixed(1)}%
                      </p>
                      <span className="text-[10px] text-slate-400 font-mono">FP / (FP + TN)</span>
                    </div>

                    <div className="rounded border border-[#262a38] bg-[#1c1f2b] p-3 text-center">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400">Detection Delay</span>
                      <p className="mt-1 text-xl font-bold font-mono text-blue-400">
                        {simulationResult.evaluation.detection_delay_seconds != null
                          ? `${simulationResult.evaluation.detection_delay_seconds.toFixed(1)}s`
                          : 'N/A'}
                      </p>
                      <span className="text-[10px] text-slate-400 font-mono">Burst to Alert</span>
                    </div>
                  </div>

                  {/* Confusion Matrix */}
                  <div className="mt-5 rounded border border-[#262a38] bg-[#0c0d12] p-4">
                    <h4 className="text-xs font-semibold text-slate-300 mb-2">
                      Confusion Matrix (Total Windows: {simulationResult.total_windows})
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      <div className="rounded bg-[#1c1f2b] p-2.5 border border-emerald-500/20">
                        <span className="text-emerald-400 font-semibold">True Positives (TP):</span>
                        <span className="float-right text-white font-bold">
                          {simulationResult.evaluation.true_positives}
                        </span>
                        <p className="text-[10px] text-slate-400 mt-1">Injected burst windows correctly flagged ($p &lt; \alpha$).</p>
                      </div>
                      <div className="rounded bg-[#1c1f2b] p-2.5 border border-red-500/20">
                        <span className="text-red-400 font-semibold">False Positives (FP):</span>
                        <span className="float-right text-white font-bold">
                          {simulationResult.evaluation.false_positives}
                        </span>
                        <p className="text-[10px] text-slate-400 mt-1">Normal baseline windows falsely flagged as bursts.</p>
                      </div>
                      <div className="rounded bg-[#1c1f2b] p-2.5 border border-amber-500/20">
                        <span className="text-amber-400 font-semibold">False Negatives (FN):</span>
                        <span className="float-right text-white font-bold">
                          {simulationResult.evaluation.false_negatives}
                        </span>
                        <p className="text-[10px] text-slate-400 mt-1">Injected burst windows missed by the detector.</p>
                      </div>
                      <div className="rounded bg-[#1c1f2b] p-2.5 border border-slate-700">
                        <span className="text-slate-300 font-semibold">True Negatives (TN):</span>
                        <span className="float-right text-white font-bold">
                          {simulationResult.evaluation.true_negatives}
                        </span>
                        <p className="text-[10px] text-slate-400 mt-1">Normal baseline windows correctly passed.</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Observation Detail Inspector */}
              <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-[#262a38]">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Observation Telemetry & Statistical Inspector
                    </h3>
                    <p className="text-xs text-slate-400">
                      Click any observation row to view the detailed mathematical explanation.
                    </p>
                  </div>

                  {/* Filter Selector */}
                  <div className="flex items-center gap-1.5 rounded-md bg-[#1c1f2b] border border-[#262a38] p-1 text-xs">
                    <Filter className="h-3.5 w-3.5 text-slate-400 ml-1" />
                    <button
                      type="button"
                      onClick={() => setTableFilter('all')}
                      className={`px-2 py-0.5 rounded text-[11px] ${
                        tableFilter === 'all'
                          ? 'bg-orange-500 text-white font-semibold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      All ({simulationResult.observations.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setTableFilter('alerts_only')}
                      className={`px-2 py-0.5 rounded text-[11px] ${
                        tableFilter === 'alerts_only'
                          ? 'bg-red-500 text-white font-semibold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Alerts Only ({simulationResult.detected_burst_count})
                    </button>
                    {simulationResult.injected_burst_count > 0 && (
                      <button
                        type="button"
                        onClick={() => setTableFilter('bursts_only')}
                        className={`px-2 py-0.5 rounded text-[11px] ${
                          tableFilter === 'bursts_only'
                            ? 'bg-amber-500 text-white font-semibold'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Injected Bursts ({simulationResult.injected_burst_count})
                      </button>
                    )}
                  </div>
                </div>

                {/* Selected Window Detail Callout */}
                {selectedObservation && selectedDetection && (
                  <div className="mt-4 rounded-lg border border-orange-500/40 bg-[#0c0d12] p-4 text-xs font-mono">
                    <div className="flex items-center justify-between pb-2 border-b border-[#262a38]">
                      <span className="font-semibold text-white">
                        Inspected Window: {selectedObservation.timestamp}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                          selectedDetection.is_burst
                            ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                            : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        }`}
                      >
                        {selectedDetection.is_burst ? 'BURST ALERT' : 'NORMAL'}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div>
                        <span className="text-[10px] text-slate-400">Observed Count ($x$):</span>
                        <p className="text-base font-bold text-white">{selectedObservation.count}</p>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400">Baseline (&lambda;<sub>w</sub>):</span>
                        <p className="text-base font-bold text-slate-300">{selectedDetection.expected_rate}</p>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400">Upper-Tail Prob $p$:</span>
                        <p className="text-base font-bold text-orange-400">
                          {formatProbability(selectedDetection.p_value)}
                        </p>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400">Ground Truth:</span>
                        <p className="text-base font-bold text-amber-400">
                          {selectedObservation.ground_truth ? 'Injected Burst' : 'Normal Baseline'}
                        </p>
                      </div>
                    </div>

                    <p className="mt-3 text-[11px] text-slate-300 font-sans leading-relaxed">
                      <strong>Mathematical Reasoning: </strong>
                      {selectedDetection.interpretation}
                    </p>
                  </div>
                )}

                {/* Table */}
                <div className="mt-4 max-h-64 overflow-y-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="sticky top-0 bg-[#14161f] border-b border-[#262a38] text-slate-400 text-[11px]">
                      <tr>
                        <th className="py-2 px-3">Window</th>
                        <th className="py-2 px-3">Count ($x$)</th>
                        <th className="py-2 px-3">Baseline (&lambda;<sub>w</sub>)</th>
                        <th className="py-2 px-3">Prob $P(X \ge x)$</th>
                        <th className="py-2 px-3">Decision</th>
                        <th className="py-2 px-3">Ground Truth</th>
                        <th className="py-2 px-3 text-right">Inspect</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#262a38]/60">
                      {filteredIndices.map(({ obs, det, idx }) => {
                        const isAlert = det?.is_burst;
                        const isSelected = selectedObservationIdx === idx;
                        return (
                          <tr
                            key={idx}
                            onClick={() => setSelectedObservationIdx(idx)}
                            className={`cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-orange-500/20'
                                : isAlert
                                ? 'bg-red-950/20 hover:bg-red-950/30'
                                : 'hover:bg-[#1c1f2b]/60'
                            }`}
                          >
                            <td className="py-2 px-3 text-slate-300">{obs.timestamp}</td>
                            <td className="py-2 px-3 font-semibold text-white">{obs.count}</td>
                            <td className="py-2 px-3 text-slate-400">{det?.expected_rate}</td>
                            <td className="py-2 px-3 text-slate-300">
                              {det ? formatProbability(det.p_value) : '—'}
                            </td>
                            <td className="py-2 px-3">
                              {isAlert ? (
                                <span className="inline-flex items-center rounded bg-red-500/20 border border-red-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-red-400">
                                  BURST
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-400">
                                  NORMAL
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3">
                              {obs.ground_truth ? (
                                <span className="text-amber-400 font-semibold">Injected Burst</span>
                              ) : (
                                <span className="text-slate-400">Normal</span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right text-slate-400">
                              <Eye className="h-3.5 w-3.5 inline text-slate-400 hover:text-white" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            /* Simulation Empty State */
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#262a38] bg-[#14161f]/60 p-16 text-center">
              <FlaskConical className="h-12 w-12 text-slate-600 mb-3" />
              <h3 className="text-base font-semibold text-white">
                Simulation Laboratory Ready
              </h3>
              <p className="max-w-md text-xs text-slate-400 mt-2 leading-relaxed">
                Configure your scenario parameters on the left and click <strong>Run Simulation Experiment</strong>.
                The experiment will execute deterministically via the FastAPI backend and display
                arrival time-series plots, alert markers, precision/recall metrics, and inspection telemetry.
              </p>
              <div className="mt-6 flex items-center gap-2 text-xs text-slate-400 font-mono">
                <span className="rounded bg-[#1c1f2b] border border-[#262a38] px-2.5 py-1">
                  1. Choose Scenario
                </span>
                <ArrowRight className="h-3 w-3" />
                <span className="rounded bg-[#1c1f2b] border border-[#262a38] px-2.5 py-1">
                  2. Set Rate & Duration
                </span>
                <ArrowRight className="h-3 w-3" />
                <span className="rounded bg-[#1c1f2b] border border-[#262a38] px-2.5 py-1">
                  3. Analyze Telemetry
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
