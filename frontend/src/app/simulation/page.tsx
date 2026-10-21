'use client';

import React, { useState } from 'react';
import {
  AlertTriangle,
  Cpu,
  Flame,
  FlaskConical,
  Play,
  RefreshCw,
  Shuffle,
  Sliders,
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
import { SimulationRequest, SimulationResponse, SimulationScenario } from '@/lib/types';

export default function SimulationLabPage() {
  // Simulation Form State
  const [scenario, setScenario] = useState<SimulationScenario>('sudden_burst');
  const [baselineRate, setBaselineRate] = useState<number>(15.0);
  const [durationSeconds, setDurationSeconds] = useState<number>(60);
  const [windowSeconds, setWindowSeconds] = useState<number>(1.0);
  const [burstStart, setBurstStart] = useState<number>(25);
  const [burstDuration, setBurstDuration] = useState<number>(10);
  const [burstRate, setBurstRate] = useState<number>(45.0);
  const [alpha, setAlpha] = useState<number>(0.01);
  const [randomSeed, setRandomSeed] = useState<number>(42);

  // Results State
  const [simulationResult, setSimulationResult] = useState<SimulationResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleRunSimulation = async () => {
    try {
      setLoading(true);
      setError(null);

      const payload: SimulationRequest = {
        scenario,
        baseline_rate: Number(baselineRate),
        duration_seconds: Number(durationSeconds),
        window_seconds: Number(windowSeconds),
        burst_start_second: Number(burstStart),
        burst_duration_seconds: Number(burstDuration),
        burst_rate: Number(burstRate),
        alpha: Number(alpha),
        random_seed: Number(randomSeed),
      };

      const result = await api.runSimulation(payload);
      setSimulationResult(result);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Simulation failed due to an unexpected client error.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerateSeed = () => {
    setRandomSeed(Math.floor(Math.random() * 100000));
  };

  // Prepare chart data
  const chartData = simulationResult
    ? simulationResult.observations.map((obs, idx) => {
        const det = simulationResult.detections[idx];
        return {
          window: obs.timestamp,
          count: obs.count,
          baseline: simulationResult.baseline_rate,
          isBurst: det ? det.is_burst : false,
          isInjected: obs.ground_truth,
          pValue: det ? det.p_value : 1.0,
        };
      })
    : [];

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
          inject controlled arrival bursts, and evaluate mathematical detection performance.
        </p>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mt-6 rounded-lg border border-red-500/40 bg-red-950/30 p-4 text-xs text-red-200">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-red-300">Simulation Error</p>
              <p className="mt-1">{error}</p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column: Parameter Configuration */}
        <div className="lg:col-span-1 space-y-5">
          <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-5">
            <div className="flex items-center justify-between pb-3 border-b border-[#262a38]">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Sliders className="h-4 w-4 text-orange-400" />
                Scenario & Generator Controls
              </h2>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              {/* Scenario Selection */}
              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  Traffic Process Scenario
                </label>
                <select
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value as SimulationScenario)}
                  className="w-full rounded-md border border-[#262a38] bg-[#1c1f2b] px-3 py-2 text-xs text-white focus:border-orange-500 focus:outline-none"
                >
                  <option value="sudden_burst">Sudden Elevated Burst (Controlled)</option>
                  <option value="poisson_normal">Normal Poisson Traffic (Homogeneous)</option>
                  <option value="rate_drift">Rate Drift (Non-Stationary Background)</option>
                  <option value="overdispersed">Overdispersed Traffic (Negative Binomial)</option>
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  {scenario === 'sudden_burst' && 'Baseline Poisson traffic with a high-rate spike.'}
                  {scenario === 'poisson_normal' && 'Pure homogeneous Poisson process X ~ Poisson(λ).'}
                  {scenario === 'rate_drift' && 'Gradual linear escalation in background arrival rate.'}
                  {scenario === 'overdispersed' && 'Variance exceeds mean (Var(X) > E[X]). Tests assumption breakdown.'}
                </p>
              </div>

              {/* Baseline Rate lambda */}
              <div>
                <div className="flex justify-between">
                  <label className="font-medium text-slate-300">Baseline Rate (λ):</label>
                  <span className="font-mono text-orange-400 font-semibold">{baselineRate}</span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="60"
                  step="1"
                  value={baselineRate}
                  onChange={(e) => setBaselineRate(Number(e.target.value))}
                  className="mt-1 w-full accent-orange-500"
                />
                <span className="text-[10px] text-slate-400">Expected arrivals per window</span>
              </div>

              {/* Duration and Window */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-300">Duration (s)</label>
                  <input
                    type="number"
                    min="15"
                    max="180"
                    value={durationSeconds}
                    onChange={(e) => setDurationSeconds(Number(e.target.value))}
                    className="mt-1 w-full rounded-md border border-[#262a38] bg-[#1c1f2b] px-3 py-1.5 font-mono text-xs text-white focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-300">Window Size (s)</label>
                  <input
                    type="number"
                    min="0.5"
                    max="5.0"
                    step="0.5"
                    value={windowSeconds}
                    onChange={(e) => setWindowSeconds(Number(e.target.value))}
                    className="mt-1 w-full rounded-md border border-[#262a38] bg-[#1c1f2b] px-3 py-1.5 font-mono text-xs text-white focus:border-orange-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Burst Controls (if applicable) */}
              {scenario === 'sudden_burst' && (
                <div className="rounded border border-[#262a38] bg-[#1c1f2b] p-3 space-y-3">
                  <div className="flex items-center gap-1.5 text-orange-400 font-semibold text-[11px]">
                    <Flame className="h-3.5 w-3.5" />
                    Injected Burst Parameters
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <span className="text-[10px] text-slate-400">Start (s)</span>
                      <input
                        type="number"
                        min="5"
                        max={durationSeconds - 5}
                        value={burstStart}
                        onChange={(e) => setBurstStart(Number(e.target.value))}
                        className="mt-0.5 w-full rounded border border-[#262a38] bg-[#0c0d12] px-2 py-1 font-mono text-xs text-white"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400">Duration</span>
                      <input
                        type="number"
                        min="2"
                        max="30"
                        value={burstDuration}
                        onChange={(e) => setBurstDuration(Number(e.target.value))}
                        className="mt-0.5 w-full rounded border border-[#262a38] bg-[#0c0d12] px-2 py-1 font-mono text-xs text-white"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400">Burst λ</span>
                      <input
                        type="number"
                        min={baselineRate}
                        max="200"
                        value={burstRate}
                        onChange={(e) => setBurstRate(Number(e.target.value))}
                        className="mt-0.5 w-full rounded border border-[#262a38] bg-[#0c0d12] px-2 py-1 font-mono text-xs text-white"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Alpha Level */}
              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  Significance Threshold (α)
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
                  Identical parameters + seed produce bit-identical time series.
                </p>
              </div>

              {/* Run Button */}
              <button
                type="button"
                onClick={handleRunSimulation}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 rounded-md bg-orange-600 py-2.5 text-xs font-semibold text-white shadow hover:bg-orange-500 disabled:opacity-50 transition-colors mt-2"
              >
                {loading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Generating via FastAPI Backend...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-current" />
                    Generate & Run Poisson Detector
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Hardware Preparation Note */}
          <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-4 text-xs">
            <div className="flex items-center gap-2 text-slate-300 font-semibold mb-1">
              <Cpu className="h-4 w-4 text-orange-400" />
              Arduino Hardware Mode Ready
            </div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              This simulation engine shares identical data schemas with the planned 4-Arduino
              laptop UDP receiver. Physical hardware runs will stream real datagram counts through
              the same Poisson detector.
            </p>
          </div>
        </div>

        {/* Right Column: Visualization & Evaluation Metrics */}
        <div className="lg:col-span-2 space-y-6">
          {simulationResult ? (
            <>
              {/* Traffic Timeline Chart */}
              <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-[#262a38]">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Synthesized Time Series & Detection Events
                    </h3>
                    <p className="text-xs text-slate-400">
                      Experiment ID: <span className="font-mono text-orange-400">{simulationResult.experiment_id}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-mono">
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <span className="h-2 w-2 rounded-full bg-orange-500" />
                      Observed
                    </span>
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <span className="h-0.5 w-3 bg-emerald-400" />
                      Baseline λ̂ ({simulationResult.baseline_rate})
                    </span>
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <span className="h-2 w-2 rounded-full bg-red-500" />
                      Flagged Burst
                    </span>
                  </div>
                </div>

                <div className="mt-4 h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="simGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f97316" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#f97316" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#262a38" vertical={false} />
                      <XAxis dataKey="window" stroke="#64748b" fontSize={11} tickLine={false} interval={4} />
                      <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1c1f2b',
                          borderColor: '#262a38',
                          borderRadius: '6px',
                          fontSize: '12px',
                        }}
                      />
                      <ReferenceLine
                        y={simulationResult.baseline_rate}
                        stroke="#10b981"
                        strokeDasharray="4 4"
                      />
                      <Area
                        type="monotone"
                        dataKey="count"
                        stroke="#f97316"
                        strokeWidth={2}
                        fill="url(#simGradient)"
                        name="Arrival Count"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Evaluation Metrics & Confusion Matrix */}
              {simulationResult.evaluation && (
                <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-5">
                  <div className="flex items-center justify-between pb-3 border-b border-[#262a38]">
                    <div>
                      <h3 className="text-sm font-semibold text-white">
                        Statistical Performance Evaluation
                      </h3>
                      <p className="text-xs text-slate-400">
                        Computed against strictly controlled injected burst ground truth.
                      </p>
                    </div>
                    <span className="rounded bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 text-xs text-emerald-400 font-mono">
                      Ground Truth Validated
                    </span>
                  </div>

                  {/* Summary Metric Badges */}
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded border border-[#262a38] bg-[#1c1f2b] p-3 text-center">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400">Precision</span>
                      <p className="mt-1 text-xl font-bold font-mono text-white">
                        {(simulationResult.evaluation.precision * 100).toFixed(1)}%
                      </p>
                      <span className="text-[10px] text-slate-400 font-mono">TP / (TP + FP)</span>
                    </div>

                    <div className="rounded border border-[#262a38] bg-[#1c1f2b] p-3 text-center">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400">Recall</span>
                      <p className="mt-1 text-xl font-bold font-mono text-emerald-400">
                        {(simulationResult.evaluation.recall * 100).toFixed(1)}%
                      </p>
                      <span className="text-[10px] text-slate-400 font-mono">TP / (TP + FN)</span>
                    </div>

                    <div className="rounded border border-[#262a38] bg-[#1c1f2b] p-3 text-center">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400">F1 Score</span>
                      <p className="mt-1 text-xl font-bold font-mono text-orange-400">
                        {simulationResult.evaluation.f1_score.toFixed(3)}
                      </p>
                      <span className="text-[10px] text-slate-400 font-mono">Harmonic Mean</span>
                    </div>

                    <div className="rounded border border-[#262a38] bg-[#1c1f2b] p-3 text-center">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400">False Positive Rate</span>
                      <p className="mt-1 text-xl font-bold font-mono text-red-400">
                        {(simulationResult.evaluation.false_positive_rate * 100).toFixed(1)}%
                      </p>
                      <span className="text-[10px] text-slate-400 font-mono">FP / (FP + TN)</span>
                    </div>
                  </div>

                  {/* Confusion Matrix Table */}
                  <div className="mt-5 rounded border border-[#262a38] bg-[#0c0d12] p-4">
                    <h4 className="text-xs font-semibold text-slate-300 mb-2">
                      Confusion Matrix (Windows: {simulationResult.total_windows})
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      <div className="rounded bg-[#1c1f2b] p-2.5 border border-emerald-500/20">
                        <span className="text-emerald-400 font-semibold">True Positives (TP):</span>
                        <span className="float-right text-white font-bold">
                          {simulationResult.evaluation.true_positives}
                        </span>
                        <p className="text-[10px] text-slate-400 mt-1">Injected burst correctly flagged.</p>
                      </div>
                      <div className="rounded bg-[#1c1f2b] p-2.5 border border-red-500/20">
                        <span className="text-red-400 font-semibold">False Positives (FP):</span>
                        <span className="float-right text-white font-bold">
                          {simulationResult.evaluation.false_positives}
                        </span>
                        <p className="text-[10px] text-slate-400 mt-1">Normal arrival falsely flagged.</p>
                      </div>
                      <div className="rounded bg-[#1c1f2b] p-2.5 border border-red-500/20">
                        <span className="text-amber-400 font-semibold">False Negatives (FN):</span>
                        <span className="float-right text-white font-bold">
                          {simulationResult.evaluation.false_negatives}
                        </span>
                        <p className="text-[10px] text-slate-400 mt-1">Injected burst missed by detector.</p>
                      </div>
                      <div className="rounded bg-[#1c1f2b] p-2.5 border border-slate-700">
                        <span className="text-slate-300 font-semibold">True Negatives (TN):</span>
                        <span className="float-right text-white font-bold">
                          {simulationResult.evaluation.true_negatives}
                        </span>
                        <p className="text-[10px] text-slate-400 mt-1">Normal arrival correctly passed.</p>
                      </div>
                    </div>
                    {simulationResult.evaluation.detection_delay_seconds != null && (
                      <p className="mt-3 text-[11px] text-slate-400">
                        Detection Delay: <strong>{simulationResult.evaluation.detection_delay_seconds.toFixed(1)}s</strong> from burst onset to first alert.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Simulation Empty State */
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#262a38] bg-[#14161f]/60 p-16 text-center">
              <FlaskConical className="h-12 w-12 text-slate-600 mb-3" />
              <h3 className="text-base font-semibold text-white">
                Simulation Laboratory Ready
              </h3>
              <p className="max-w-md text-xs text-slate-400 mt-1 leading-relaxed">
                Configure your scenario parameters on the left and click <strong>Generate & Run Poisson Detector</strong>.
                The experiment will execute deterministically via the FastAPI backend and display
                arrival plots, alert markers, and precision/recall evaluation.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
