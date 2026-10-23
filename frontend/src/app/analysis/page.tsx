'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  BarChart2,
  Calculator,
  Database,
  HelpCircle,
  RefreshCw,
  Sliders,
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
  ExperimentDetailResponse,
  ExperimentSummary,
} from '@/lib/types';
import { formatProbability } from '@/lib/utils';

function StatisticalAnalysisContent() {
  const searchParams = useSearchParams();
  const queryExperimentId = searchParams.get('experiment_id');

  // --- Saved Experiment Inspection State ---
  const [experimentList, setExperimentList] = useState<ExperimentSummary[]>([]);
  const [selectedExpId, setSelectedExpId] = useState<string>('');
  const [inspectedExperiment, setInspectedExperiment] = useState<ExperimentDetailResponse | null>(null);
  const [loadingExpList, setLoadingExpList] = useState<boolean>(true);
  const [loadingInspected, setLoadingInspected] = useState<boolean>(false);
  const [inspectedDispersion, setInspectedDispersion] = useState<DispersionResponse | null>(null);

  // --- Section 1: Upper-Tail Probability Calculator ---
  const [calcObserved, setCalcObserved] = useState<number>(18);
  const [calcExpected, setCalcExpected] = useState<number>(10.0);
  const [calcAlpha, setCalcAlpha] = useState<number>(0.01);
  const [calcResult, setCalcResult] = useState<DetectionResponse | null>(null);
  const [calcLoading, setCalcLoading] = useState<boolean>(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [isHypotheticalTweak, setIsHypotheticalTweak] = useState<boolean>(false);

  // --- Section 2: Distribution Explorer ---
  const [explorerLambda, setExplorerLambda] = useState<number>(10.0);
  const [distPoints, setDistPoints] = useState<DistributionPoint[]>([]);

  // --- Section 3: Baseline & Dispersion Analyzer ---
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

  // When selectedExpId changes, fetch detail & compute authoritative dispersion
  useEffect(() => {
    if (!selectedExpId) return;

    let isMounted = true;
    api
      .getExperimentDetail(selectedExpId)
      .then(async (exp) => {
        if (!isMounted) return;
        setInspectedExperiment(exp);

        // Compute empirical dispersion from actual stored observation counts
        if (exp.observations && exp.observations.length > 0) {
          const counts = exp.observations.map((o) => o.count);
          try {
            const disp = await api.evaluateDispersion({ observations: counts });
            if (isMounted) setInspectedDispersion(disp);
          } catch {
            if (isMounted) setInspectedDispersion(null);
          }
        }
      })
      .catch((err) => {
        console.error('Failed to load experiment detail:', err);
      })
      .finally(() => {
        if (isMounted) setLoadingInspected(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedExpId]);

  const handleSelectExperiment = (expId: string) => {
    setSelectedExpId(expId);
    if (!expId) {
      setInspectedExperiment(null);
      setInspectedDispersion(null);
      setLoadingInspected(false);
    } else {
      setLoadingInspected(true);
    }
  };

  // Handle Probability Calculation
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

  // Update Distribution Explorer points when explorerLambda changes
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

  // Populate interactive tools from inspected experiment
  const handleLoadIntoCalculator = () => {
    if (!inspectedExperiment) return;
    setCalcExpected(Number(inspectedExperiment.baseline_lambda.toFixed(2)));
    setCalcAlpha(inspectedExperiment.alpha);
    if (inspectedExperiment.observations.length > 0) {
      setCalcObserved(inspectedExperiment.observations[0].count);
    }
    setIsHypotheticalTweak(false);
  };

  const handleLoadIntoExplorer = () => {
    if (!inspectedExperiment) return;
    setExplorerLambda(Number(inspectedExperiment.baseline_lambda.toFixed(2)));
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Page Header */}
      <div className="border-b border-[#262a38] pb-6">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-orange-400">
          <span>Primary Page Owner: Shirley S (URK25CS1081)</span>
          <span className="text-slate-500">•</span>
          <span className="text-slate-400">Course 25CS203</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl mt-1">
          Statistical Analysis & Model Evaluation
        </h1>
        <p className="text-sm text-slate-400 mt-1 max-w-3xl">
          Direct interactive exploration of Poisson probability theory, upper-tail survival
          functions, baseline arrival rate estimation, and empirical dispersion behavior.
        </p>
      </div>

      <div className="mt-6 space-y-8">
        {/* =================================================================== */}
        {/* SAVED EXPERIMENT INSPECTION BAR (Milestone 4 Integration)           */}
        {/* =================================================================== */}
        <div className="rounded-xl border border-purple-500/30 bg-[#14161f] p-5 shadow-lg">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#262a38]">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
                <Database className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Inspect Saved Experiment Statistics
                </h2>
                <p className="text-xs text-slate-400">
                  Select any saved trial to inspect empirical mean, variance, dispersion ratio (VMR), and baseline parameters.
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

          {loadingInspected && (
            <div className="py-8 flex items-center justify-center gap-2 text-xs text-purple-400">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span>Loading saved experiment parameters...</span>
            </div>
          )}

          {inspectedExperiment && !loadingInspected && (
            <div className="mt-4 space-y-4">
              {/* Badges & Meta */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono font-bold text-purple-400 bg-purple-950/40 px-2.5 py-0.5 rounded border border-purple-500/30">
                  {inspectedExperiment.experiment_id}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
                    inspectedExperiment.experiment_type === 'simulation'
                      ? 'bg-orange-500/20 text-orange-400'
                      : 'bg-blue-500/20 text-blue-400'
                  }`}
                >
                  {inspectedExperiment.experiment_type}
                </span>
                <span className="rounded bg-[#1c1f2b] text-slate-300 font-mono text-[10px] px-2 py-0.5 border border-[#2d3244]">
                  Unit: {inspectedExperiment.measurement_type}
                </span>
                <span className="text-slate-400 text-[11px] truncate max-w-md">
                  {inspectedExperiment.title}
                </span>
              </div>

              {/* Statistical Parameters Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                  <span className="text-[10px] uppercase text-slate-400 block font-medium">Baseline λ</span>
                  <span className="text-base font-bold text-cyan-400 font-mono mt-0.5 block">
                    {inspectedExperiment.baseline_lambda.toFixed(4)}
                  </span>
                  <span className="text-[10px] text-slate-500">expected / window</span>
                </div>

                <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                  <span className="text-[10px] uppercase text-slate-400 block font-medium">Window W</span>
                  <span className="text-base font-bold text-white font-mono mt-0.5 block">
                    {inspectedExperiment.window_seconds}s
                  </span>
                  <span className="text-[10px] text-slate-500">duration</span>
                </div>

                <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                  <span className="text-[10px] uppercase text-slate-400 block font-medium">Sample Mean (X̄)</span>
                  <span className="text-base font-bold text-white font-mono mt-0.5 block">
                    {inspectedDispersion?.sample_mean !== undefined
                      ? inspectedDispersion.sample_mean.toFixed(2)
                      : '—'}
                  </span>
                  <span className="text-[10px] text-slate-500">empirical mean</span>
                </div>

                <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                  <span className="text-[10px] uppercase text-slate-400 block font-medium">Sample Var (s²)</span>
                  <span className="text-base font-bold text-white font-mono mt-0.5 block">
                    {inspectedDispersion?.sample_variance !== undefined
                      ? inspectedDispersion.sample_variance.toFixed(2)
                      : '—'}
                  </span>
                  <span className="text-[10px] text-slate-500">empirical variance</span>
                </div>

                <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                  <span className="text-[10px] uppercase text-slate-400 block font-medium">Dispersion (D)</span>
                  <span
                    className={`text-base font-bold font-mono mt-0.5 block ${
                      inspectedDispersion?.dispersion_type === 'equidispersed'
                        ? 'text-emerald-400'
                        : 'text-orange-400'
                    }`}
                  >
                    {inspectedDispersion?.variance_to_mean_ratio !== undefined
                      ? inspectedDispersion.variance_to_mean_ratio.toFixed(2)
                      : '—'}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {inspectedDispersion?.dispersion_type || 'VMR (s²/X̄)'}
                  </span>
                </div>

                <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                  <span className="text-[10px] uppercase text-slate-400 block font-medium">Detected Bursts</span>
                  <span className="text-base font-bold text-red-400 font-mono mt-0.5 block">
                    {inspectedExperiment.detected_window_count}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    of {inspectedExperiment.observation_count} windows
                  </span>
                </div>
              </div>

              {/* Evaluation Metrics if available */}
              {inspectedExperiment.evaluation && (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 p-3 text-xs">
                  <span className="font-semibold text-emerald-400 block mb-1">
                    Ground-Truth Validated Performance:
                  </span>
                  <div className="flex flex-wrap gap-4 font-mono text-slate-300">
                    <span>
                      Precision: <strong className="text-white">{(inspectedExperiment.evaluation.precision * 100).toFixed(1)}%</strong>
                    </span>
                    <span>
                      Recall: <strong className="text-white">{(inspectedExperiment.evaluation.recall * 100).toFixed(1)}%</strong>
                    </span>
                    <span>
                      F1: <strong className="text-white">{inspectedExperiment.evaluation.f1_score.toFixed(3)}</strong>
                    </span>
                    <span>
                      False Alarm Rate: <strong className="text-white">{(inspectedExperiment.evaluation.false_positive_rate * 100).toFixed(1)}%</strong>
                    </span>
                  </div>
                </div>
              )}

              {/* Quick actions to cross-pollinate calculators */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleLoadIntoCalculator}
                  className="flex items-center gap-1.5 rounded-lg bg-[#1c1f2b] border border-[#2d3244] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-[#252a3b] hover:text-white transition-colors"
                >
                  <Calculator className="h-3.5 w-3.5 text-orange-400" />
                  <span>Load λ={inspectedExperiment.baseline_lambda.toFixed(2)} into Calculator</span>
                </button>
                <button
                  type="button"
                  onClick={handleLoadIntoExplorer}
                  className="flex items-center gap-1.5 rounded-lg bg-[#1c1f2b] border border-[#2d3244] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-[#252a3b] hover:text-white transition-colors"
                >
                  <BarChart2 className="h-3.5 w-3.5 text-cyan-400" />
                  <span>Explore PMF for λ={inspectedExperiment.baseline_lambda.toFixed(2)}</span>
                </button>
              </div>
            </div>
          )}

          {!selectedExpId && (
            <p className="mt-3 text-xs text-slate-500">
              Select an experiment above or navigate from the Dashboard/History page to inspect authoritative empirical metrics.
            </p>
          )}
        </div>

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

          {/* Interactive Distinction Alert */}
          {isHypotheticalTweak && (
            <div className="mt-3 rounded border border-amber-500/30 bg-amber-950/20 p-2 text-xs text-amber-300 flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-amber-400 shrink-0" />
              <span>
                Interactive Mode: You are testing hypothetical arrival rates and counts, separate from persisted experiment records.
              </span>
            </div>
          )}

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
                  onChange={(e) => {
                    setCalcObserved(Number(e.target.value));
                    setIsHypotheticalTweak(true);
                  }}
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
                  onChange={(e) => {
                    setCalcExpected(Number(e.target.value));
                    setIsHypotheticalTweak(true);
                  }}
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
                      onClick={() => {
                        setCalcAlpha(val);
                        setIsHypotheticalTweak(true);
                      }}
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

            {/* Results Box */}
            <div className="lg:col-span-2 rounded-lg border border-[#262a38] bg-[#0c0d12] p-5">
              {calcResult ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-[#262a38]">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Detection Decision
                    </span>
                    <span
                      className={`rounded px-2.5 py-1 text-xs font-bold font-mono ${
                        calcResult.is_burst
                          ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                          : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      }`}
                    >
                      {calcResult.is_burst ? 'BURST DETECTED (ALERT)' : 'NORMAL TRAFFIC VARIATION'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded bg-[#14161f] p-3 border border-[#262a38]">
                      <span className="text-[10px] text-slate-400 uppercase font-mono">
                        Upper-Tail Probability P(X ≥ x)
                      </span>
                      <p className="mt-1 text-xl font-bold font-mono text-white">
                        {formatProbability(calcResult.p_value)}
                      </p>
                    </div>

                    <div className="rounded bg-[#14161f] p-3 border border-[#262a38]">
                      <span className="text-[10px] text-slate-400 uppercase font-mono">
                        Decision Rule Test
                      </span>
                      <p className="mt-1 text-sm font-bold font-mono text-slate-300">
                        {calcResult.p_value < calcResult.alpha ? (
                          <span className="text-red-400">P &lt; α ({calcResult.alpha})</span>
                        ) : (
                          <span className="text-emerald-400">P ≥ α ({calcResult.alpha})</span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="rounded bg-[#14161f] p-3.5 border border-[#262a38] text-xs text-slate-300 leading-relaxed font-sans">
                    <span className="font-semibold text-white block mb-1">
                      Authoritative Interpretation:
                    </span>
                    {calcResult.interpretation}
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-slate-400">
                  Enter parameters and compute to view results.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* =================================================================== */}
        {/* SECTION 2: POISSON DISTRIBUTION EXPLORER (FastAPI Connected)        */}
        {/* =================================================================== */}
        <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-[#262a38]">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                <BarChart2 className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-white">
                  Poisson PMF Curve &amp; Upper-Tail Mass
                </h2>
                <p className="text-xs text-slate-400">
                  Dynamic PMF calculated via backend: P(X = k) = (λ^k * e^-λ) / k!
                </p>
              </div>
            </div>

            <span className="rounded bg-[#1c1f2b] border border-[#262a38] px-2.5 py-1 text-[11px] font-mono text-cyan-400">
              API: /api/poisson/distribution
            </span>
          </div>

          <div className="mt-5 space-y-4">
            <div className="flex items-center justify-between text-xs">
              <label className="font-medium text-slate-300">
                Expected Rate λ: <span className="font-mono text-cyan-400 text-sm">{explorerLambda}</span>
              </label>
              <div className="flex gap-2">
                {[5, 10, 15, 25, 40].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setExplorerLambda(preset)}
                    className={`rounded px-2.5 py-1 font-mono text-xs transition-colors ${
                      explorerLambda === preset
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50'
                        : 'bg-[#1c1f2b] border border-[#262a38] text-slate-400 hover:text-white'
                    }`}
                  >
                    λ={preset}
                  </button>
                ))}
              </div>
            </div>

            <input
              type="range"
              min="1"
              max="50"
              step="1"
              value={explorerLambda}
              onChange={(e) => setExplorerLambda(Number(e.target.value))}
              className="w-full accent-cyan-500 cursor-pointer"
            />

            {/* PMF Chart */}
            <div className="h-64 rounded-lg bg-[#0c0d12] p-3 border border-[#262a38]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distPoints}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2333" />
                  <XAxis dataKey="k" stroke="#64748b" fontSize={10} />
                  <YAxis stroke="#64748b" fontSize={10} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const pt = payload[0].payload as DistributionPoint;
                        return (
                          <div className="rounded bg-[#14161f] border border-[#262a38] p-2 text-xs font-mono">
                            <p className="text-white font-bold">Count k = {pt.k}</p>
                            <p className="text-cyan-400">PMF: {(pt.pmf * 100).toFixed(3)}%</p>
                            <p className="text-orange-400">Upper Tail: {(pt.upper_tail * 100).toFixed(3)}%</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <ReferenceLine x={explorerLambda} stroke="#f97316" strokeDasharray="3 3" />
                  <Bar dataKey="pmf" fill="#06b6d4" radius={[2, 2, 0, 0]}>
                    {distPoints.map((entry) => (
                      <Cell
                        key={`cell-${entry.k}`}
                        fill={entry.k >= explorerLambda + 2 * Math.sqrt(explorerLambda) ? '#f97316' : '#06b6d4'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* =================================================================== */}
        {/* SECTION 3: BASELINE & DISPERSION ANALYZER                           */}
        {/* =================================================================== */}
        <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-[#262a38]">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-purple-500/10 text-purple-400 border border-purple-500/30">
                <Sliders className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-white">
                  Baseline Estimation &amp; Dispersion Analyzer
                </h2>
                <p className="text-xs text-slate-400">
                  Assess equidispersion: D = s² / X̄. Tests if data conforms to Poisson (D ≈ 1).
                </p>
              </div>
            </div>

            <span className="rounded bg-[#1c1f2b] border border-[#262a38] px-2.5 py-1 text-[11px] font-mono text-purple-400">
              API: /api/poisson/dispersion
            </span>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Input */}
            <div className="space-y-3">
              <label className="block text-xs font-medium text-slate-300">
                Observation Counts Sample (comma separated):
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

export default function StatisticalAnalysisPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-400">Loading Statistical Analysis...</div>}>
      <StatisticalAnalysisContent />
    </Suspense>
  );
}
