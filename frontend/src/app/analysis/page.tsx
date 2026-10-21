'use client';

import React, { useEffect, useState } from 'react';
import {
  Calculator,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, ApiClientError } from '@/lib/api';
import {
  DetectionResponse,
  DispersionResponse,
  DistributionPoint,
} from '@/lib/types';
import { formatProbability } from '@/lib/utils';

export default function StatisticalAnalysisPage() {
  // --- Section 1: Upper-Tail Probability Calculator ---
  const [calcObserved, setCalcObserved] = useState<number>(18);
  const [calcExpected, setCalcExpected] = useState<number>(10.0);
  const [calcAlpha, setCalcAlpha] = useState<number>(0.01);
  const [calcResult, setCalcResult] = useState<DetectionResponse | null>(null);
  const [calcLoading, setCalcLoading] = useState<boolean>(false);
  const [calcError, setCalcError] = useState<string | null>(null);

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

  // Initial load
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

  // --- Section 2: Distribution Explorer ---
  const [explorerLambda, setExplorerLambda] = useState<number>(10.0);
  const [distPoints, setDistPoints] = useState<DistributionPoint[]>([]);

  useEffect(() => {
    let isMounted = true;
    api
      .getPoissonDistribution({
        expected_rate: explorerLambda,
        max_k: Math.max(30, Math.ceil(explorerLambda * 2.5)),
      })
      .then((res) => {
        if (isMounted) setDistPoints(res.points);
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [explorerLambda]);

  // --- Section 3: Baseline & Dispersion Analyzer ---
  const [sampleInput, setSampleInput] = useState<string>('10, 12, 9, 11, 10, 14, 8, 10, 11, 9');
  const [dispResult, setDispResult] = useState<DispersionResponse | null>(null);
  const [dispLoading, setDispLoading] = useState<boolean>(false);
  const [dispError, setDispError] = useState<string | null>(null);

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

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Page Header */}
      <div className="border-b border-[#262a38] pb-6">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-orange-400">
          <span>Primary Page Owner: Shirley S (URK25CS1081)</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl mt-1">
          Statistical Analysis & Model Evaluation
        </h1>
        <p className="text-sm text-slate-400 mt-1 max-w-3xl">
          Direct interactive exploration of Poisson probability theory, upper-tail survival
          functions, baseline arrival rate estimation, and variance-to-mean dispersion behavior.
        </p>
      </div>

      <div className="mt-6 space-y-8">
        {/* =================================================================== */}
        {/* SECTION 1: UPPER-TAIL PROBABILITY CALCULATOR (FastAPI Connected)  */}
        {/* =================================================================== */}
        <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-[#262a38]">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-orange-500/10 text-orange-400 border border-orange-500/30">
                <Calculator className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-white">
                  Authoritative Poisson Upper-Tail Calculator
                </h2>
                <p className="text-xs text-slate-400">
                  Direct evaluation via backend SciPy survival function: P(X ≥ x | λ).
                </p>
              </div>
            </div>

            <span className="rounded bg-[#1c1f2b] border border-[#262a38] px-2.5 py-1 text-[11px] font-mono text-emerald-400">
              API: /api/poisson/detect
            </span>
          </div>

          {calcError && (
            <div className="mt-4 rounded border border-red-500/30 bg-red-950/20 p-3 text-xs text-red-300">
              {calcError}
            </div>
          )}

          <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Form Controls */}
            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-300">
                  Observed Arrival Count (x)
                </label>
                <input
                  type="number"
                  min="0"
                  max="1000"
                  value={calcObserved}
                  onChange={(e) => setCalcObserved(Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-[#262a38] bg-[#1c1f2b] px-3 py-2 font-mono text-sm text-white focus:border-orange-500 focus:outline-none"
                />
                <span className="text-[10px] text-slate-400">Arrivals counted in observation window</span>
              </div>

              <div>
                <label className="block font-medium text-slate-300">
                  Expected Baseline Rate (λ)
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="0.5"
                  value={calcExpected}
                  onChange={(e) => setCalcExpected(Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-[#262a38] bg-[#1c1f2b] px-3 py-2 font-mono text-sm text-white focus:border-orange-500 focus:outline-none"
                />
                <span className="text-[10px] text-slate-400">Baseline mean count (lambda_hat)</span>
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  Significance Threshold (α)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[0.05, 0.01, 0.001].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setCalcAlpha(val)}
                      className={`rounded py-1.5 font-mono text-xs font-semibold transition-colors ${
                        calcAlpha === val
                          ? 'bg-orange-500/20 border border-orange-500/60 text-orange-400'
                          : 'bg-[#1c1f2b] border border-[#262a38] text-slate-300 hover:bg-[#252a3b]'
                      }`}
                    >
                      {val}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={handleCalculateProbability}
                disabled={calcLoading}
                className="w-full flex items-center justify-center gap-2 rounded-md bg-orange-600 py-2.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-50 transition-colors"
              >
                {calcLoading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Querying Backend...
                  </>
                ) : (
                  'Compute Upper-Tail Probability'
                )}
              </button>
            </div>

            {/* Result Box */}
            <div className="lg:col-span-2 rounded-lg border border-[#262a38] bg-[#0c0d12] p-5 flex flex-col justify-between">
              {calcResult ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-[#262a38]">
                    <span className="text-xs font-medium text-slate-400">Statistical Decision:</span>
                    {calcResult.is_burst ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/20 border border-red-500/40 px-3 py-1 text-xs font-bold text-red-400">
                        <span className="h-2 w-2 rounded-full bg-red-500 animate-ping" />
                        BURST DETECTED (p &lt; α)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 px-3 py-1 text-xs font-bold text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                        NORMAL VARIATION (p ≥ α)
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded bg-[#14161f] p-3 border border-[#262a38]">
                      <span className="text-[10px] uppercase font-mono text-slate-400">
                        Computed Upper-Tail p-value
                      </span>
                      <p className="mt-1 text-xl font-bold font-mono text-orange-400">
                        {formatProbability(calcResult.p_value)}
                      </p>
                      <span className="text-[10px] text-slate-400 font-mono">
                        P(X ≥ {calcResult.observed_count} | λ = {calcResult.expected_rate})
                      </span>
                    </div>

                    <div className="rounded bg-[#14161f] p-3 border border-[#262a38]">
                      <span className="text-[10px] uppercase font-mono text-slate-400">
                        Significance Threshold (α)
                      </span>
                      <p className="mt-1 text-xl font-bold font-mono text-slate-200">
                        {calcResult.alpha}
                      </p>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {calcResult.p_value < calcResult.alpha ? 'p < α (Reject H₀)' : 'p ≥ α (Fail to reject H₀)'}
                      </span>
                    </div>
                  </div>

                  <div className="rounded bg-[#14161f] p-3 border border-[#262a38] text-xs text-slate-300">
                    <p className="font-semibold text-slate-200">Interpretation:</p>
                    <p className="mt-1 font-mono text-[11px] text-slate-400">
                      {calcResult.interpretation}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-slate-400">
                  Enter parameters and click compute.
                </div>
              )}

              {/* Mathematical Callout */}
              <div className="mt-4 pt-3 border-t border-[#262a38] text-[11px] text-slate-400 leading-relaxed">
                <strong>Why Upper-Tail P(X ≥ x)?</strong> In burst detection, we test whether the
                observed arrival count is unusually high. Calculating only the point probability
                P(X = x) would incorrectly flag high-probability normal counts if lambda is large.
                The upper tail sums all outcomes at least as extreme as x.
              </div>
            </div>
          </div>
        </div>

        {/* =================================================================== */}
        {/* SECTION 2: POISSON DISTRIBUTION EXPLORER (Visual PMF & Tail)        */}
        {/* =================================================================== */}
        <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-[#262a38]">
            <div>
              <h2 className="text-base font-semibold text-white">
                Poisson Distribution Probability Mass Function (PMF) Explorer
              </h2>
              <p className="text-xs text-slate-400">
                P(X = k) = e^(-λ) · λ^k / k!. Vary λ to observe how arrival probability shifts.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-300 font-medium">λ Parameter:</span>
              <span className="rounded bg-[#1c1f2b] border border-[#262a38] px-2.5 py-1 text-xs font-mono font-bold text-orange-400">
                {explorerLambda}
              </span>
            </div>
          </div>

          <div className="mt-4 flex flex-col md:flex-row gap-6 items-center">
            <div className="w-full md:w-1/3 space-y-3 text-xs">
              <div>
                <label className="font-medium text-slate-300">Adjust Expected Arrivals (λ):</label>
                <input
                  type="range"
                  min="1"
                  max="35"
                  step="1"
                  value={explorerLambda}
                  onChange={(e) => setExplorerLambda(Number(e.target.value))}
                  className="mt-2 w-full accent-orange-500"
                />
              </div>

              <div className="rounded border border-[#262a38] bg-[#0c0d12] p-3 space-y-1.5 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-400">Expected Value E[X]:</span>
                  <span className="text-white font-bold">{explorerLambda.toFixed(1)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Variance Var(X):</span>
                  <span className="text-white font-bold">{explorerLambda.toFixed(1)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Std Deviation σ:</span>
                  <span className="text-orange-400 font-bold">{Math.sqrt(explorerLambda).toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="w-full md:w-2/3 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distPoints} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262a38" vertical={false} />
                  <XAxis dataKey="k" stroke="#64748b" fontSize={10} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={10} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1c1f2b',
                      borderColor: '#262a38',
                      borderRadius: '6px',
                      fontSize: '11px',
                    }}
                  />
                  <ReferenceLine
                    x={calcObserved}
                    stroke="#ef4444"
                    strokeDasharray="3 3"
                    label={{
                      value: `x=${calcObserved}`,
                      fill: '#ef4444',
                      fontSize: 10,
                      position: 'top',
                    }}
                  />
                  <Bar dataKey="pmf" name="P(X = k)">
                    {distPoints.map((entry) => (
                      <Cell
                        key={`cell-${entry.k}`}
                        fill={entry.k >= calcObserved ? '#ef4444' : '#f97316'}
                        fillOpacity={entry.k >= calcObserved ? 0.9 : 0.65}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-6 text-[11px] font-mono mt-1 text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 bg-orange-500 rounded-sm" /> Normal Bulk P(X &lt; x)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 bg-red-500 rounded-sm" /> Upper Tail P(X ≥ x)
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* =================================================================== */}
        {/* SECTION 3: BASELINE ESTIMATION & DISPERSION ANALYZER                */}
        {/* =================================================================== */}
        <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-6">
          <div className="pb-4 border-b border-[#262a38]">
            <h2 className="text-base font-semibold text-white">
              Baseline Arrival-Rate & Index of Dispersion Analyzer
            </h2>
            <p className="text-xs text-slate-400">
              Evaluates the foundational Poisson property: E[X] = Var(X) = λ.
              Variance-to-Mean Ratio (VMR): D = s² / X̄.
            </p>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Input sequence */}
            <div className="space-y-3 text-xs">
              <label className="block font-medium text-slate-300">
                Input Traffic Counts (Comma or Space-Separated):
              </label>
              <textarea
                rows={4}
                value={sampleInput}
                onChange={(e) => setSampleInput(e.target.value)}
                className="w-full rounded-md border border-[#262a38] bg-[#1c1f2b] p-2.5 font-mono text-xs text-white focus:border-orange-500 focus:outline-none"
              />

              {dispError && (
                <p className="text-xs text-red-400">{dispError}</p>
              )}

              {/* Presets */}
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setSampleInput('10, 11, 9, 10, 12, 8, 10, 11, 9, 10')}
                  className="rounded bg-[#1c1f2b] border border-[#262a38] px-2 py-1 text-[10px] text-slate-300 hover:text-white hover:bg-[#262c3e]"
                >
                  Poisson Normal Sample
                </button>
                <button
                  type="button"
                  onClick={() => setSampleInput('2, 1, 3, 2, 45, 60, 2, 1, 55, 3')}
                  className="rounded bg-[#1c1f2b] border border-[#262a38] px-2 py-1 text-[10px] text-orange-400 hover:text-orange-300 hover:bg-[#262c3e]"
                >
                  Overdispersed Burst Sample
                </button>
              </div>

              <button
                type="button"
                onClick={handleAnalyzeDispersion}
                disabled={dispLoading}
                className="w-full rounded-md bg-orange-600 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-50 transition-colors"
              >
                {dispLoading ? 'Calculating...' : 'Evaluate Mean, Variance & Dispersion'}
              </button>
            </div>

            {/* Results */}
            <div className="lg:col-span-2 rounded-lg border border-[#262a38] bg-[#0c0d12] p-5">
              {dispResult ? (
                <div className="space-y-4 text-xs font-mono">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded bg-[#14161f] p-3 border border-[#262a38]">
                      <span className="text-[10px] text-slate-400">Sample Mean (X̄ / λ̂)</span>
                      <p className="mt-1 text-lg font-bold text-white">{dispResult.sample_mean}</p>
                    </div>

                    <div className="rounded bg-[#14161f] p-3 border border-[#262a38]">
                      <span className="text-[10px] text-slate-400">Sample Variance (s²)</span>
                      <p className="mt-1 text-lg font-bold text-white">{dispResult.sample_variance}</p>
                    </div>

                    <div className="rounded bg-[#14161f] p-3 border border-[#262a38]">
                      <span className="text-[10px] text-slate-400">Dispersion Ratio (D)</span>
                      <p className="mt-1 text-lg font-bold text-orange-400">
                        {dispResult.variance_to_mean_ratio}
                      </p>
                    </div>
                  </div>

                  <div className="rounded bg-[#14161f] p-3.5 border border-[#262a38]">
                    <div className="flex items-center justify-between pb-1.5 border-b border-[#262a38]">
                      <span className="text-slate-300 font-semibold">Classification:</span>
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-bold ${
                          dispResult.dispersion_type === 'equidispersed'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : dispResult.dispersion_type === 'overdispersed'
                            ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                            : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        }`}
                      >
                        {dispResult.dispersion_type.toUpperCase()}
                      </span>
                    </div>
                    <p className="mt-2 text-slate-300 font-sans text-xs leading-relaxed">
                      {dispResult.explanation}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-slate-400">
                  Click &apos;Evaluate Mean, Variance & Dispersion&apos; to view calculations.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
