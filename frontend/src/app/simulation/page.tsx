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
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import EmptyState from '@/components/ui/EmptyState';

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
    <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Page Header */}
      <PageHeader
        title="Synthetic Traffic Simulation Lab"
        subtitle="Generate deterministic, reproducible Poisson and non-Poisson traffic time series, inject controlled arrival bursts, evaluate detector sensitivity and false alarms, and investigate model limitations."
        badge="25CS203 Micro-Project"
      />

      {/* Error Banners */}
      {validationError && (
        <div className="rounded-lg border border-[rgba(255,106,0,0.3)] bg-[rgba(255,106,0,0.08)] p-4 text-xs text-[#FF6A00] flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-[#FF6A00] mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-[#F5F5F5]">Invalid Configuration Parameter</p>
            <p className="mt-1 text-[#A3A3A3]">{validationError}</p>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-[rgba(239,68,68,0.25)] bg-[rgba(239,68,68,0.08)] p-4 text-xs text-red-300 flex items-start gap-3">
          <XCircle className="h-4 w-4 text-[#ef4444] mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-red-200">Backend API Error</p>
            <p className="mt-1 text-[#A3A3A3]">{error}</p>
          </div>
        </div>
      )}

      {/* Main Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Controls (4 cols on lg, 5 cols on xl) */}
        <div className="lg:col-span-5 xl:col-span-4 space-y-6">
          {/* Scenario Selector Card */}
          <div className="rounded-lg border border-[#292929] bg-[#141414] p-5">
            <h2 className="font-heading text-sm font-semibold text-[#F5F5F5] flex items-center gap-2 pb-3 border-b border-[#292929]">
              <FlaskConical className="h-4 w-4 text-[#FF6A00]" />
              <span>1. Select Traffic Scenario</span>
            </h2>

            <div className="mt-4 space-y-2.5 text-xs">
              <button
                type="button"
                onClick={() => setScenario('sudden_burst')}
                className={`w-full text-left rounded-md p-3.5 transition-all border ${
                  scenario === 'sudden_burst'
                    ? 'bg-[rgba(255,106,0,0.08)] border-[#FF6A00] text-[#F5F5F5]'
                    : 'bg-[#101010] border-[#292929] text-[#A3A3A3] hover:border-[#383838] hover:text-[#F5F5F5]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold flex items-center gap-2 text-sm text-[#F5F5F5]">
                    <Flame className={`h-4 w-4 ${scenario === 'sudden_burst' ? 'text-[#FF6A00]' : 'text-[#737373]'}`} />
                    Sudden Traffic Burst
                  </span>
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#191919] border border-[#292929] text-[#FF6A00]">
                    Controlled
                  </span>
                </div>
                <p className="text-xs text-[#737373] mt-1.5 leading-relaxed">
                  Injects an elevated Poisson rate during a defined window to test detector recall and detection delay.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setScenario('poisson_normal')}
                className={`w-full text-left rounded-md p-3.5 transition-all border ${
                  scenario === 'poisson_normal'
                    ? 'bg-[rgba(255,106,0,0.08)] border-[#FF6A00] text-[#F5F5F5]'
                    : 'bg-[#101010] border-[#292929] text-[#A3A3A3] hover:border-[#383838] hover:text-[#F5F5F5]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold flex items-center gap-2 text-sm text-[#F5F5F5]">
                    <CheckCircle2 className={`h-4 w-4 ${scenario === 'poisson_normal' ? 'text-emerald-400' : 'text-[#737373]'}`} />
                    Normal Poisson Traffic
                  </span>
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#191919] border border-[#292929] text-emerald-400">
                    Baseline
                  </span>
                </div>
                <p className="text-xs text-[#737373] mt-1.5 leading-relaxed">
                  Homogeneous Poisson arrivals X ~ Poisson(&lambda;). Tests empirical false alarm rate against &alpha;.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setScenario('rate_drift')}
                className={`w-full text-left rounded-md p-3.5 transition-all border ${
                  scenario === 'rate_drift'
                    ? 'bg-[rgba(255,106,0,0.08)] border-[#FF6A00] text-[#F5F5F5]'
                    : 'bg-[#101010] border-[#292929] text-[#A3A3A3] hover:border-[#383838] hover:text-[#F5F5F5]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold flex items-center gap-2 text-sm text-[#F5F5F5]">
                    <TrendingUp className={`h-4 w-4 ${scenario === 'rate_drift' ? 'text-[#FF6A00]' : 'text-[#737373]'}`} />
                    Changing Traffic Rate
                  </span>
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#191919] border border-[#292929] text-[#A3A3A3]">
                    Drift
                  </span>
                </div>
                <p className="text-xs text-[#737373] mt-1.5 leading-relaxed">
                  Non-stationary linear rate increase. Demonstrates why a static baseline fails when background trends shift.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setScenario('overdispersed')}
                className={`w-full text-left rounded-md p-3.5 transition-all border ${
                  scenario === 'overdispersed'
                    ? 'bg-[rgba(255,106,0,0.08)] border-[#FF6A00] text-[#F5F5F5]'
                    : 'bg-[#101010] border-[#292929] text-[#A3A3A3] hover:border-[#383838] hover:text-[#F5F5F5]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold flex items-center gap-2 text-sm text-[#F5F5F5]">
                    <Layers className={`h-4 w-4 ${scenario === 'overdispersed' ? 'text-[#FF6A00]' : 'text-[#737373]'}`} />
                    Overdispersed Traffic
                  </span>
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#191919] border border-[#292929] text-[#A3A3A3]">
                    NegBinomial
                  </span>
                </div>
                <p className="text-xs text-[#737373] mt-1.5 leading-relaxed">
                  Var(X) &gt; E[X]. Heavy-tailed arrivals violate the Poisson model, causing inflated false alarms.
                </p>
              </button>
            </div>
          </div>

          {/* Configuration Panel Card */}
          <div className="rounded-lg border border-[#292929] bg-[#141414] p-5">
            <h2 className="font-heading text-sm font-semibold text-[#F5F5F5] flex items-center gap-2 pb-3 border-b border-[#292929]">
              <Sliders className="h-4 w-4 text-[#FF6A00]" />
              <span>2. Parameter Configuration</span>
            </h2>

            <div className="mt-4 space-y-4 text-xs">
              {/* Baseline Rate Per Second */}
              <div>
                <div className="flex justify-between items-center">
                  <label className="font-medium text-[#F5F5F5]">
                    Baseline Rate ($r$):
                  </label>
                  <span className="font-mono text-[#FF6A00] font-semibold">
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
                  className="mt-2 w-full accent-[#FF6A00]"
                />
                <div className="flex justify-between text-[11px] text-[#737373] font-mono mt-1">
                  <span>Expected Window &lambda;<sub>w</sub>:</span>
                  <span className="text-[#F5F5F5] font-bold">{lambdaWindow} pkts</span>
                </div>
              </div>

              {/* Duration and Window Size */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[#F5F5F5] mb-1">Duration (s)</label>
                  <input
                    type="number"
                    min="10"
                    max="300"
                    value={durationSeconds}
                    onChange={(e) => setDurationSeconds(Number(e.target.value))}
                    className="w-full rounded-md border border-[#292929] bg-[#101010] px-3 py-2 font-mono text-xs text-[#F5F5F5] focus:border-[#FF6A00] focus:outline-none"
                  />
                  <span className="text-[10px] text-[#737373] mt-0.5 block">Total duration</span>
                </div>
                <div>
                  <label className="block font-medium text-[#F5F5F5] mb-1">Window $W$ (s)</label>
                  <input
                    type="number"
                    min="0.2"
                    max="10.0"
                    step="0.5"
                    value={windowSeconds}
                    onChange={(e) => setWindowSeconds(Number(e.target.value))}
                    className="w-full rounded-md border border-[#292929] bg-[#101010] px-3 py-2 font-mono text-xs text-[#F5F5F5] focus:border-[#FF6A00] focus:outline-none"
                  />
                  <span className="text-[10px] text-[#737373] mt-0.5 block">Aggregation window</span>
                </div>
              </div>

              {/* SCENARIO-SPECIFIC CONTROLS */}
              {/* A. Sudden Burst Controls */}
              {scenario === 'sudden_burst' && (
                <div className="rounded-md border border-[rgba(255,106,0,0.3)] bg-[rgba(255,106,0,0.04)] p-3.5 space-y-3">
                  <div className="flex items-center gap-1.5 text-[#FF6A00] font-semibold text-xs">
                    <Flame className="h-3.5 w-3.5" />
                    <span>Injected Burst Settings</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <span className="text-[10px] text-[#A3A3A3] block mb-1">Start (s)</span>
                      <input
                        type="number"
                        min="0"
                        max={durationSeconds - 2}
                        value={burstStart}
                        onChange={(e) => setBurstStart(Number(e.target.value))}
                        className="w-full rounded border border-[#292929] bg-[#101010] px-2 py-1.5 font-mono text-xs text-[#F5F5F5]"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-[#A3A3A3] block mb-1">Duration (s)</span>
                      <input
                        type="number"
                        min="1"
                        max={durationSeconds}
                        value={burstDuration}
                        onChange={(e) => setBurstDuration(Number(e.target.value))}
                        className="w-full rounded border border-[#292929] bg-[#101010] px-2 py-1.5 font-mono text-xs text-[#F5F5F5]"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-[#A3A3A3] block mb-1">Rate pkts/s</span>
                      <input
                        type="number"
                        min="1"
                        max="200"
                        value={burstRatePerSecond}
                        onChange={(e) => setBurstRatePerSecond(Number(e.target.value))}
                        className="w-full rounded border border-[#292929] bg-[#101010] px-2 py-1.5 font-mono text-xs text-[#F5F5F5]"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-[#A3A3A3] font-mono">
                    Burst &lambda;<sub>w</sub>: <strong className="text-[#FF6A00]">{burstLambdaWindow}</strong> pkts / {windowSeconds}s window
                  </p>
                </div>
              )}

              {/* B. Rate Drift Controls */}
              {scenario === 'rate_drift' && (
                <div className="rounded-md border border-[#292929] bg-[#101010] p-3.5 space-y-2">
                  <div className="flex items-center gap-1.5 text-[#F5F5F5] font-semibold text-xs">
                    <TrendingUp className="h-3.5 w-3.5 text-[#FF6A00]" />
                    <span>Linear Drift Target</span>
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[#A3A3A3]">End Rate at T+{durationSeconds}s:</span>
                      <span className="font-mono text-[#FF6A00] font-semibold">{rateDriftEndPerSecond} pkts/s</span>
                    </div>
                    <input
                      type="range"
                      min="5"
                      max="120"
                      step="5"
                      value={rateDriftEndPerSecond}
                      onChange={(e) => setRateDriftEndPerSecond(Number(e.target.value))}
                      className="mt-2 w-full accent-[#FF6A00]"
                    />
                  </div>
                  <p className="text-[10px] text-[#737373]">
                    Rate shifts from {baselineRatePerSecond} to {rateDriftEndPerSecond} pkts/s across trial.
                  </p>
                </div>
              )}

              {/* C. Overdispersed Controls */}
              {scenario === 'overdispersed' && (
                <div className="rounded-md border border-[#292929] bg-[#101010] p-3.5 space-y-2">
                  <div className="flex items-center gap-1.5 text-[#F5F5F5] font-semibold text-xs">
                    <Layers className="h-3.5 w-3.5 text-[#FF6A00]" />
                    <span>Dispersion Parameter</span>
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[#A3A3A3]">Variance / Mean ($D$):</span>
                      <span className="font-mono text-[#FF6A00] font-semibold">{dispersionFactor.toFixed(1)}x</span>
                    </div>
                    <input
                      type="range"
                      min="1.2"
                      max="8.0"
                      step="0.2"
                      value={dispersionFactor}
                      onChange={(e) => setDispersionFactor(Number(e.target.value))}
                      className="mt-2 w-full accent-[#FF6A00]"
                    />
                  </div>
                  <p className="text-[10px] text-[#737373]">
                    Var(X) = {dispersionFactor.toFixed(1)} &times; E[X]. Higher D inflates Poisson false alerts.
                  </p>
                </div>
              )}

              {/* Significance Threshold Alpha */}
              <div>
                <label className="block font-medium text-[#F5F5F5] mb-1.5">
                  Significance Threshold (&alpha;)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[0.05, 0.01, 0.001].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setAlpha(val)}
                      className={`rounded py-1.5 text-xs font-mono font-medium transition-all ${
                        alpha === val
                          ? 'bg-[rgba(255,106,0,0.15)] border border-[#FF6A00] text-[#FF6A00]'
                          : 'bg-[#101010] border border-[#292929] text-[#A3A3A3] hover:text-[#F5F5F5]'
                      }`}
                    >
                      {val}
                    </button>
                  ))}
                </div>
              </div>

              {/* Random Seed */}
              <div>
                <label className="block font-medium text-[#F5F5F5] mb-1.5">
                  Random Seed (Reproducibility)
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={randomSeed}
                    onChange={(e) => setRandomSeed(Number(e.target.value))}
                    className="flex-1 rounded-md border border-[#292929] bg-[#101010] px-3 py-2 font-mono text-xs text-[#F5F5F5] focus:border-[#FF6A00] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleRegenerateSeed}
                    className="rounded-md bg-[#101010] border border-[#292929] px-3 py-2 text-[#A3A3A3] hover:text-[#F5F5F5] hover:border-[#383838] transition-colors"
                    title="Generate new random seed"
                  >
                    <Shuffle className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="text-[10px] text-[#737373] mt-1">
                  Same seed and parameters reproduce identical observations.
                </p>
              </div>

              {/* Run Experiment Button */}
              <button
                type="button"
                onClick={handleRunSimulation}
                disabled={loading}
                className="w-full btn-primary justify-center py-2.5 mt-2"
              >
                {loading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Executing on FastAPI Backend...</span>
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-current" />
                    <span>Run Simulation Experiment</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Visualizations, Metrics, and Inspector (7 cols on lg, 8 cols on xl) */}
        <div className="lg:col-span-7 xl:col-span-8 space-y-6">
          {simulationResult ? (
            <>
              {/* Experiment Summary Banner */}
              <div className="rounded-lg border border-[#292929] bg-[#141414] p-5 text-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#292929]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-heading font-semibold text-[#F5F5F5] text-sm">
                      Experiment: {simulationResult.experiment_id}
                    </span>
                    <StatusBadge label={simulationResult.scenario} variant="accent" />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/experiments?selected=${simulationResult.experiment_id}`}
                      className="btn-secondary text-[11px] py-1 px-2.5"
                      title="Inspect in Experiment History"
                    >
                      <Database className="h-3 w-3 text-[#A3A3A3]" />
                      <span>Saved in History</span>
                      <ArrowRight className="h-3 w-3 text-[#737373]" />
                    </Link>
                    <Link
                      href={`/analysis?experiment_id=${simulationResult.experiment_id}`}
                      className="btn-secondary text-[11px] py-1 px-2.5"
                      title="Inspect in Statistical Analysis"
                    >
                      <span>Analyze in Stats</span>
                      <ArrowRight className="h-3 w-3 text-[#737373]" />
                    </Link>
                  </div>
                </div>

                <div className="text-[#A3A3A3] leading-relaxed text-xs space-y-2">
                  <p>{simulationResult.summary}</p>
                  {simulationResult.model_limitation_note && (
                    <div className="rounded-md bg-[#101010] border border-[#292929] p-3 text-[#A3A3A3]">
                      <span className="font-semibold text-[#FF6A00]">Statistical Context: </span>
                      {simulationResult.model_limitation_note}
                    </div>
                  )}
                </div>
              </div>

              {/* Traffic Timeline Chart */}
              <div className="rounded-lg border border-[#292929] bg-[#141414] p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-[#292929]">
                  <div>
                    <h3 className="font-heading text-sm font-semibold text-[#F5F5F5]">
                      Traffic Arrival Time Series &amp; Detection Events
                    </h3>
                    <p className="text-xs text-[#737373]">
                      Comparing observed arrival counts against Poisson baseline $\lambda_w = {simulationResult.lambda_window}$.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
                    <span className="flex items-center gap-1.5 text-[#A3A3A3]">
                      <span className="h-2 w-2 rounded-full bg-[#FF6A00]" />
                      Observed ($x$)
                    </span>
                    <span className="flex items-center gap-1.5 text-[#A3A3A3]">
                      <span className="h-0.5 w-3 bg-[#A3A3A3]" />
                      Baseline &lambda;<sub>w</sub> ({simulationResult.lambda_window})
                    </span>
                    {simulationResult.injected_burst_count > 0 && (
                      <span className="flex items-center gap-1.5 text-[#FF6A00]">
                        <span className="h-2 w-2 bg-[rgba(255,106,0,0.4)] border border-[#FF6A00]" />
                        Injected Burst
                      </span>
                    )}
                    <span className="flex items-center gap-1.5 text-[#ef4444]">
                      <span className="h-2 w-2 rounded-full bg-[#ef4444]" />
                      Alert ($p &lt; \alpha$)
                    </span>
                  </div>
                </div>

                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="simFlowGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#FF6A00" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#FF6A00" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#292929" vertical={false} />
                      <XAxis
                        dataKey="window"
                        stroke="#737373"
                        fontSize={11}
                        fontFamily="var(--font-mono)"
                        tickLine={false}
                        interval={Math.max(1, Math.floor(chartData.length / 10))}
                      />
                      <YAxis
                        stroke="#737373"
                        fontSize={11}
                        fontFamily="var(--font-mono)"
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#141414',
                          borderColor: '#383838',
                          borderRadius: '8px',
                          fontSize: '12px',
                          fontFamily: 'var(--font-mono)',
                          color: '#F5F5F5',
                        }}
                      />

                      {/* Injected Burst Interval Highlight (if scenario == sudden_burst) */}
                      {simulationResult.scenario === 'sudden_burst' && burstStart < durationSeconds && (
                        <ReferenceArea
                          x1={`T+${burstStart.toFixed(1)}s`}
                          x2={`T+${Math.min(durationSeconds, burstStart + burstDuration).toFixed(1)}s`}
                          fill="#FF6A00"
                          fillOpacity={0.12}
                          stroke="#FF6A00"
                          strokeOpacity={0.4}
                          strokeDasharray="3 3"
                        />
                      )}

                      {/* Baseline Reference Line */}
                      <ReferenceLine
                        y={simulationResult.lambda_window}
                        stroke="#A3A3A3"
                        strokeDasharray="4 4"
                        label={{
                          value: `λw=${simulationResult.lambda_window}`,
                          fill: '#A3A3A3',
                          fontSize: 10,
                          position: 'insideTopLeft',
                          fontFamily: 'var(--font-mono)',
                        }}
                      />

                      {/* Observed Counts Area */}
                      <Area
                        type="monotone"
                        dataKey="count"
                        stroke="#FF6A00"
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
                <div className="rounded-lg border border-[#292929] bg-[#141414] p-5 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-[#292929]">
                    <div>
                      <h3 className="font-heading text-sm font-semibold text-[#F5F5F5]">
                        Detection Performance Metrics
                      </h3>
                      <p className="text-xs text-[#737373]">
                        {simulationResult.injected_burst_count > 0
                          ? 'Evaluated against defined injected burst intervals.'
                          : 'Evaluated under null hypothesis / background baseline.'}
                      </p>
                    </div>
                    <span className="font-mono text-xs text-emerald-400 bg-[rgba(34,197,94,0.1)] px-2.5 py-0.5 rounded border border-[rgba(34,197,94,0.25)]">
                      Validated
                    </span>
                  </div>

                  {/* Summary Metric Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <div className="rounded-md border border-[#292929] bg-[#101010] p-3 text-center">
                      <span className="text-[10px] uppercase tracking-wider text-[#A3A3A3] font-medium">Precision</span>
                      <p className="mt-1 text-xl font-bold font-mono text-[#F5F5F5]">
                        {simulationResult.injected_burst_count > 0
                          ? `${(simulationResult.evaluation.precision * 100).toFixed(1)}%`
                          : 'N/A'}
                      </p>
                      <span className="text-[10px] text-[#737373] font-mono">
                        {simulationResult.injected_burst_count > 0 ? 'TP / (TP + FP)' : 'No Bursts'}
                      </span>
                    </div>

                    <div className="rounded-md border border-[#292929] bg-[#101010] p-3 text-center">
                      <span className="text-[10px] uppercase tracking-wider text-[#A3A3A3] font-medium">Recall</span>
                      <p className="mt-1 text-xl font-bold font-mono text-emerald-400">
                        {simulationResult.injected_burst_count > 0
                          ? `${(simulationResult.evaluation.recall * 100).toFixed(1)}%`
                          : 'N/A'}
                      </p>
                      <span className="text-[10px] text-[#737373] font-mono">
                        {simulationResult.injected_burst_count > 0 ? 'TP / (TP + FN)' : 'No Bursts'}
                      </span>
                    </div>

                    <div className="rounded-md border border-[#292929] bg-[#101010] p-3 text-center">
                      <span className="text-[10px] uppercase tracking-wider text-[#A3A3A3] font-medium">F1 Score</span>
                      <p className="mt-1 text-xl font-bold font-mono text-[#FF6A00]">
                        {simulationResult.injected_burst_count > 0
                          ? simulationResult.evaluation.f1_score.toFixed(3)
                          : 'N/A'}
                      </p>
                      <span className="text-[10px] text-[#737373] font-mono">Harmonic Mean</span>
                    </div>

                    <div className="rounded-md border border-[#292929] bg-[#101010] p-3 text-center">
                      <span className="text-[10px] uppercase tracking-wider text-[#A3A3A3] font-medium">False Alarm Rate</span>
                      <p className="mt-1 text-xl font-bold font-mono text-[#ef4444]">
                        {(simulationResult.evaluation.false_positive_rate * 100).toFixed(1)}%
                      </p>
                      <span className="text-[10px] text-[#737373] font-mono">FP / (FP + TN)</span>
                    </div>

                    <div className="rounded-md border border-[#292929] bg-[#101010] p-3 text-center col-span-2 sm:col-span-1">
                      <span className="text-[10px] uppercase tracking-wider text-[#A3A3A3] font-medium">Detection Delay</span>
                      <p className="mt-1 text-xl font-bold font-mono text-[#F5F5F5]">
                        {simulationResult.evaluation.detection_delay_seconds != null
                          ? `${simulationResult.evaluation.detection_delay_seconds.toFixed(1)}s`
                          : '0.0s'}
                      </p>
                      <span className="text-[10px] text-[#737373] font-mono">Burst to Alert</span>
                    </div>
                  </div>

                  {/* Confusion Matrix */}
                  <div className="mt-4 rounded-md border border-[#292929] bg-[#101010] p-4 space-y-2">
                    <h4 className="text-xs font-semibold text-[#A3A3A3]">
                      Confusion Matrix (Total Windows: {simulationResult.total_windows})
                    </h4>
                    <div className="grid grid-cols-2 gap-2.5 text-xs font-mono">
                      <div className="rounded bg-[#141414] p-3 border border-[rgba(34,197,94,0.25)]">
                        <span className="text-emerald-400 font-semibold">True Positives (TP):</span>
                        <span className="float-right text-[#F5F5F5] font-bold text-sm">
                          {simulationResult.evaluation.true_positives}
                        </span>
                        <p className="text-[11px] text-[#737373] mt-1">Injected burst windows correctly flagged.</p>
                      </div>
                      <div className="rounded bg-[#141414] p-3 border border-[rgba(239,68,68,0.25)]">
                        <span className="text-[#ef4444] font-semibold">False Positives (FP):</span>
                        <span className="float-right text-[#F5F5F5] font-bold text-sm">
                          {simulationResult.evaluation.false_positives}
                        </span>
                        <p className="text-[11px] text-[#737373] mt-1">Normal baseline windows falsely flagged.</p>
                      </div>
                      <div className="rounded bg-[#141414] p-3 border border-[rgba(255,106,0,0.25)]">
                        <span className="text-[#FF6A00] font-semibold">False Negatives (FN):</span>
                        <span className="float-right text-[#F5F5F5] font-bold text-sm">
                          {simulationResult.evaluation.false_negatives}
                        </span>
                        <p className="text-[11px] text-[#737373] mt-1">Injected burst windows missed by detector.</p>
                      </div>
                      <div className="rounded bg-[#141414] p-3 border border-[#292929]">
                        <span className="text-[#A3A3A3] font-semibold">True Negatives (TN):</span>
                        <span className="float-right text-[#F5F5F5] font-bold text-sm">
                          {simulationResult.evaluation.true_negatives}
                        </span>
                        <p className="text-[11px] text-[#737373] mt-1">Normal baseline windows correctly passed.</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Observation Detail Inspector */}
              <div className="rounded-lg border border-[#292929] bg-[#141414] p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-[#292929]">
                  <div>
                    <h3 className="font-heading text-sm font-semibold text-[#F5F5F5]">
                      Observation Telemetry &amp; Statistical Inspector
                    </h3>
                    <p className="text-xs text-[#737373]">
                      Click any row in the table to inspect exact mathematical probabilities.
                    </p>
                  </div>

                  {/* Filter Selector */}
                  <div className="flex items-center gap-1.5 rounded-md bg-[#101010] border border-[#292929] p-1 text-xs">
                    <Filter className="h-3.5 w-3.5 text-[#737373] ml-1" />
                    <button
                      type="button"
                      onClick={() => setTableFilter('all')}
                      className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                        tableFilter === 'all'
                          ? 'bg-[#FF6A00] text-white'
                          : 'text-[#A3A3A3] hover:text-[#F5F5F5]'
                      }`}
                    >
                      All ({simulationResult.observations.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setTableFilter('alerts_only')}
                      className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                        tableFilter === 'alerts_only'
                          ? 'bg-[#ef4444] text-white'
                          : 'text-[#A3A3A3] hover:text-[#F5F5F5]'
                      }`}
                    >
                      Alerts Only ({simulationResult.detected_burst_count})
                    </button>
                    {simulationResult.injected_burst_count > 0 && (
                      <button
                        type="button"
                        onClick={() => setTableFilter('bursts_only')}
                        className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                          tableFilter === 'bursts_only'
                            ? 'bg-[#FF6A00] text-white'
                            : 'text-[#A3A3A3] hover:text-[#F5F5F5]'
                        }`}
                      >
                        Injected ({simulationResult.injected_burst_count})
                      </button>
                    )}
                  </div>
                </div>

                {/* Selected Window Detail Callout */}
                {selectedObservation && selectedDetection && (
                  <div className="rounded-md border border-[rgba(255,106,0,0.35)] bg-[#101010] p-4 text-xs font-mono space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-[#292929]">
                      <span className="font-semibold text-[#F5F5F5]">
                        Inspected Window: {selectedObservation.timestamp}
                      </span>
                      <StatusBadge
                        label={selectedDetection.is_burst ? 'BURST ALERT' : 'NORMAL'}
                        variant={selectedDetection.is_burst ? 'error' : 'success'}
                      />
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div>
                        <span className="text-[10px] text-[#737373] block">Observed Count ($x$):</span>
                        <p className="text-base font-bold text-[#F5F5F5]">{selectedObservation.count}</p>
                      </div>
                      <div>
                        <span className="text-[10px] text-[#737373] block">Baseline (&lambda;<sub>w</sub>):</span>
                        <p className="text-base font-bold text-[#A3A3A3]">{selectedDetection.expected_rate}</p>
                      </div>
                      <div>
                        <span className="text-[10px] text-[#737373] block">Upper-Tail Prob $p$:</span>
                        <p className="text-base font-bold text-[#FF6A00]">
                          {formatProbability(selectedDetection.p_value)}
                        </p>
                      </div>
                      <div>
                        <span className="text-[10px] text-[#737373] block">Ground Truth:</span>
                        <p className="text-base font-bold text-[#F5F5F5]">
                          {selectedObservation.ground_truth ? 'Injected Burst' : 'Normal Baseline'}
                        </p>
                      </div>
                    </div>

                    <p className="text-xs text-[#A3A3A3] font-sans leading-relaxed pt-1">
                      <strong className="text-[#F5F5F5]">Reasoning: </strong>
                      {selectedDetection.interpretation}
                    </p>
                  </div>
                )}

                {/* Table */}
                <div className="max-h-64 overflow-y-auto rounded-md border border-[#292929]">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="sticky top-0 bg-[#101010] border-b border-[#292929] text-[#737373] text-[11px]">
                      <tr>
                        <th className="py-2.5 px-3">Window</th>
                        <th className="py-2.5 px-3">Count ($x$)</th>
                        <th className="py-2.5 px-3">Baseline (&lambda;<sub>w</sub>)</th>
                        <th className="py-2.5 px-3">Prob $P(X \ge x)$</th>
                        <th className="py-2.5 px-3">Decision</th>
                        <th className="py-2.5 px-3">Ground Truth</th>
                        <th className="py-2.5 px-3 text-right">Inspect</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#202020]">
                      {filteredIndices.map(({ obs, det, idx }) => {
                        const isAlert = det?.is_burst;
                        const isSelected = selectedObservationIdx === idx;
                        return (
                          <tr
                            key={idx}
                            onClick={() => setSelectedObservationIdx(idx)}
                            className={`cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-[rgba(255,106,0,0.15)]'
                                : isAlert
                                ? 'bg-[rgba(239,68,68,0.06)] hover:bg-[rgba(239,68,68,0.12)]'
                                : 'hover:bg-[#191919]'
                            }`}
                          >
                            <td className="py-2 px-3 text-[#A3A3A3]">{obs.timestamp}</td>
                            <td className="py-2 px-3 font-semibold text-[#F5F5F5]">{obs.count}</td>
                            <td className="py-2 px-3 text-[#737373]">{det?.expected_rate}</td>
                            <td className="py-2 px-3 text-[#A3A3A3]">
                              {det ? formatProbability(det.p_value) : '—'}
                            </td>
                            <td className="py-2 px-3">
                              {isAlert ? (
                                <StatusBadge label="BURST" variant="error" />
                              ) : (
                                <StatusBadge label="NORMAL" variant="success" />
                              )}
                            </td>
                            <td className="py-2 px-3">
                              {obs.ground_truth ? (
                                <span className="text-[#FF6A00] font-semibold">Injected</span>
                              ) : (
                                <span className="text-[#737373]">Normal</span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right text-[#737373]">
                              <Eye className="h-3.5 w-3.5 inline hover:text-[#F5F5F5]" />
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
            <EmptyState
              icon={FlaskConical}
              title="Simulation Laboratory Ready"
              description="Configure scenario parameters on the left and click Run Simulation Experiment. The experiment executes deterministically via FastAPI and outputs arrival plots, anomaly markers, precision/recall metrics, and inspection telemetry."
              action={
                <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-[#737373] font-mono">
                  <span className="rounded bg-[#101010] border border-[#292929] px-2.5 py-1">
                    1. Choose Scenario
                  </span>
                  <ArrowRight className="h-3 w-3 text-[#383838]" />
                  <span className="rounded bg-[#101010] border border-[#292929] px-2.5 py-1">
                    2. Set Rate &amp; Duration
                  </span>
                  <ArrowRight className="h-3 w-3 text-[#383838]" />
                  <span className="rounded bg-[#101010] border border-[#292929] px-2.5 py-1">
                    3. Analyze Telemetry
                  </span>
                </div>
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
