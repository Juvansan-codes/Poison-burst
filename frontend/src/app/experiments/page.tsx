'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  AlertTriangle,
  BarChart2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Columns,
  Database,
  Download,
  FileText,
  Filter,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { api, ApiClientError } from '@/lib/api';
import {
  ExperimentDetailResponse,
  ExperimentSummary,
} from '@/lib/types';
import { formatProbability } from '@/lib/utils';

function ExperimentHistoryContent() {
  const searchParams = useSearchParams();
  const initialSelectedId = searchParams.get('selected');

  // State
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const pageSize = 10;
  const [totalPages, setTotalPages] = useState<number>(1);
  const [selectedType, setSelectedType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Inspector Modal / Drawer
  const [selectedExperiment, setSelectedExperiment] = useState<ExperimentDetailResponse | null>(null);

  // Comparison State
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareDetails, setCompareDetails] = useState<ExperimentDetailResponse[]>([]);
  const [showComparison, setShowComparison] = useState<boolean>(false);
  const [loadingComparison, setLoadingComparison] = useState<boolean>(false);

  // Deletion state
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null);

  // Inspect detail handler
  const handleInspect = async (experimentId: string) => {
    try {
      const detail = await api.getExperimentDetail(experimentId);
      setSelectedExperiment(detail);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to fetch experiment details.');
    }
  };

  // Load experiments list
  const loadExperiments = (
    targetPage: number = page,
    typeFilter: string = selectedType,
    search: string = searchQuery,
    showSpinner: boolean = true
  ) => {
    if (showSpinner) setLoading(true);
    setError(null);
    return api
      .listExperiments({
        page: targetPage,
        page_size: pageSize,
        type: typeFilter === 'all' ? undefined : typeFilter,
        search: search,
      })
      .then((res) => {
        setExperiments(res.items);
        setTotal(res.total);
        setPage(res.page);
        setTotalPages(res.total_pages);
      })
      .catch((err) => {
        if (err instanceof ApiClientError) {
          setError(err.message);
        } else {
          setError('Failed to fetch experiments from backend.');
        }
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    let isMounted = true;
    api
      .listExperiments({
        page: 1,
        page_size: pageSize,
        type: selectedType === 'all' ? undefined : selectedType,
      })
      .then((res) => {
        if (!isMounted) return;
        setExperiments(res.items);
        setTotal(res.total);
        setPage(res.page);
        setTotalPages(res.total_pages);
      })
      .catch((err) => {
        if (!isMounted) return;
        if (err instanceof ApiClientError) {
          setError(err.message);
        } else {
          setError('Failed to fetch experiments from backend.');
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedType]);

  // Open initial experiment if query parameter exists
  useEffect(() => {
    if (!initialSelectedId) return;
    let isMounted = true;
    api
      .getExperimentDetail(initialSelectedId)
      .then((detail) => {
        if (!isMounted) return;
        setSelectedExperiment(detail);
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [initialSelectedId]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadExperiments(1, selectedType, searchQuery);
  };

  const handleExportCsv = async (experimentId: string, title: string) => {
    try {
      setExportingId(experimentId);
      await api.downloadExperimentCsv(experimentId, `${title.replace(/\s+/g, '_')}.csv`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to download experiment CSV.');
    } finally {
      setExportingId(null);
    }
  };

  const handleDownloadPdf = async (experimentId: string, title?: string) => {
    try {
      setDownloadingPdfId(experimentId);
      const cleanTitle = title ? title.replace(/[^a-zA-Z0-9_-]/g, '_') : experimentId;
      await api.downloadExperimentReportPdf(
        experimentId,
        `PoissonBurst_Report_${cleanTitle}.pdf`
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to download PDF report.');
    } finally {
      setDownloadingPdfId(null);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTargetId) return;
    try {
      setDeleting(true);
      await api.deleteExperiment(deleteTargetId);
      setDeleteTargetId(null);
      if (selectedExperiment?.experiment_id === deleteTargetId) {
        setSelectedExperiment(null);
      }
      setCompareIds((prev) => prev.filter((id) => id !== deleteTargetId));
      await loadExperiments();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete experiment.');
    } finally {
      setDeleting(false);
    }
  };

  // Compare checkbox handler
  const handleToggleCompare = (id: string) => {
    setCompareIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleOpenComparison = async () => {
    if (compareIds.length < 2) return;
    try {
      setLoadingComparison(true);
      const details = await Promise.all(
        compareIds.map((id) => api.getExperimentDetail(id))
      );
      setCompareDetails(details);
      setShowComparison(true);
    } catch {
      alert('Failed to load experiments for comparison.');
    } finally {
      setLoadingComparison(false);
    }
  };

  // Check if comparison has mixed measurement types
  const distinctMeasurementTypes = Array.from(
    new Set(compareDetails.map((c) => c.measurement_type))
  );
  const hasIncompatibleMeasurements = distinctMeasurementTypes.length > 1;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-6 border-b border-[#262a38]">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-orange-400">
            <span>Persistent Storage</span>
            <span className="text-slate-500">•</span>
            <span className="text-slate-400">Cross-Page Experiment Repository</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl mt-1">
            Experiment History & Comparison
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-3xl">
            Browse, inspect, compare, and export all completed simulation trials and historical CSV analyses.
            Results are persisted in SQLite and survive application restarts.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {compareIds.length >= 2 && (
            <button
              onClick={handleOpenComparison}
              disabled={loadingComparison}
              className="flex items-center gap-2 rounded-lg bg-orange-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-orange-500 transition-colors shadow-sm animate-pulse"
            >
              <Columns className="h-3.5 w-3.5" />
              <span>Compare Selected ({compareIds.length})</span>
            </button>
          )}

          <button
            onClick={() => loadExperiments(page, selectedType, searchQuery)}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-[#191c26] border border-[#2d3244] px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-[#222634] transition-colors"
            title="Refresh list"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-orange-400' : 'text-slate-400'}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="mt-6 flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-xl border border-[#262a38] bg-[#14161f] p-4">
        {/* Type Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <span className="text-xs text-slate-400 mr-2 flex items-center gap-1">
            <Filter className="h-3.5 w-3.5" /> Filter:
          </span>
          {[
            { id: 'all', label: 'All Experiments' },
            { id: 'simulation', label: 'Simulations' },
            { id: 'historical', label: 'Historical' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedType(tab.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                selectedType === tab.id
                  ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
                  : 'text-slate-400 hover:text-white hover:bg-[#1f2333] border border-transparent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search title, scenario, dataset..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rounded-lg bg-[#0c0d12] border border-[#262a38] pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-orange-500/50 w-64"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-[#191c26] border border-[#2d3244] px-3 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-[#252a3b] transition-colors"
          >
            Search
          </button>
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                loadExperiments(1, selectedType, '');
              }}
              className="text-xs text-slate-400 hover:text-slate-200"
            >
              Clear
            </button>
          )}
        </form>
      </div>

      {/* Error state */}
      {error && (
        <div className="mt-4 rounded-lg bg-red-950/40 border border-red-500/40 p-4 text-xs text-red-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => loadExperiments()}
            className="rounded bg-red-900/60 px-2.5 py-1 text-xs text-white"
          >
            Retry
          </button>
        </div>
      )}

      {/* Experiment List Table */}
      <div className="mt-6 rounded-2xl border border-[#262a38] bg-[#14161f] overflow-hidden shadow-lg">
        {loading && experiments.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center gap-3">
            <RefreshCw className="h-6 w-6 animate-spin text-orange-400" />
            <span className="text-xs text-slate-400">Loading experiments from database...</span>
          </div>
        ) : experiments.length === 0 ? (
          <div className="py-16 text-center">
            <Database className="mx-auto h-10 w-10 text-slate-600 mb-3" />
            <h3 className="text-sm font-semibold text-white">No Experiments Found</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              {searchQuery || selectedType !== 'all'
                ? 'No experiments match your search criteria. Try resetting filters.'
                : 'No experiments have been saved yet. Run a simulation or analyze a dataset to begin.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-[#0e1017] text-[11px] font-semibold uppercase tracking-wider text-slate-400 border-b border-[#222634]">
                <tr>
                  <th className="px-4 py-3 w-10 text-center">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Title / Dataset</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Measurement</th>
                  <th className="px-4 py-3">Baseline λ</th>
                  <th className="px-4 py-3">Window</th>
                  <th className="px-4 py-3">Bursts</th>
                  <th className="px-4 py-3">Ground Truth</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e2230]">
                {experiments.map((exp) => {
                  const isChecked = compareIds.includes(exp.experiment_id);
                  return (
                    <tr
                      key={exp.experiment_id}
                      className={`hover:bg-[#181b26] transition-colors ${
                        selectedExperiment?.experiment_id === exp.experiment_id
                          ? 'bg-[#1b1f2e] border-l-2 border-orange-500'
                          : ''
                      }`}
                    >
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleCompare(exp.experiment_id)}
                          className="rounded border-[#383e52] bg-[#0c0d12] text-orange-600 focus:ring-0 cursor-pointer"
                          title="Select to compare"
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-400 whitespace-nowrap">
                        {exp.experiment_id}
                      </td>
                      <td className="px-4 py-3 font-medium text-white max-w-xs truncate" title={exp.title}>
                        {exp.title}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
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
                      <td className="px-4 py-3 font-mono text-slate-400 whitespace-nowrap">
                        {exp.measurement_type}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-300">
                        {exp.baseline_lambda.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-300 whitespace-nowrap">
                        {exp.window_seconds}s
                      </td>
                      <td className="px-4 py-3 font-mono text-red-400 font-semibold">
                        {exp.detected_window_count}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {exp.ground_truth_available ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400 text-[11px]">
                            <CheckCircle2 className="h-3 w-3" /> Labeled
                          </span>
                        ) : (
                          <span className="text-slate-500 text-[11px]">Unlabeled</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-400 whitespace-nowrap text-[11px]">
                        {new Date(exp.created_at).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleInspect(exp.experiment_id)}
                            className="rounded px-2 py-1 bg-[#1c1f2c] hover:bg-orange-500/20 text-orange-400 text-[11px] font-medium border border-[#2d3244] hover:border-orange-500/30 transition-colors"
                          >
                            Inspect
                          </button>
                          <button
                            onClick={() => handleExportCsv(exp.experiment_id, exp.title)}
                            disabled={exportingId === exp.experiment_id}
                            className="rounded p-1 text-slate-400 hover:text-white hover:bg-[#252a3b] transition-colors"
                            title="Export CSV"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDownloadPdf(exp.experiment_id, exp.title)}
                            disabled={downloadingPdfId === exp.experiment_id}
                            className="rounded p-1 text-slate-400 hover:text-orange-400 hover:bg-[#252a3b] transition-colors"
                            title="Download PDF Report"
                          >
                            {downloadingPdfId === exp.experiment_id ? (
                              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <FileText className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <button
                            onClick={() => setDeleteTargetId(exp.experiment_id)}
                            className="rounded p-1 text-slate-500 hover:text-red-400 hover:bg-red-950/30 transition-colors"
                            title="Delete experiment"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-[#222634] bg-[#0e1017] px-6 py-3">
            <span className="text-xs text-slate-400">
              Showing <span className="font-medium text-white">{experiments.length}</span> of{' '}
              <span className="font-medium text-white">{total}</span> experiments (Page {page} of {totalPages})
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => loadExperiments(page - 1)}
                disabled={page <= 1 || loading}
                className="flex items-center gap-1 rounded-md bg-[#191c26] border border-[#2d3244] px-2.5 py-1 text-xs text-slate-300 hover:bg-[#222634] disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Previous</span>
              </button>
              <button
                onClick={() => loadExperiments(page + 1)}
                disabled={page >= totalPages || loading}
                className="flex items-center gap-1 rounded-md bg-[#191c26] border border-[#2d3244] px-2.5 py-1 text-xs text-slate-300 hover:bg-[#222634] disabled:opacity-40"
              >
                <span>Next</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Experiment Detail Inspection Drawer / Section */}
      {selectedExperiment && (
        <div className="mt-8 rounded-2xl border border-orange-500/30 bg-[#14161f] overflow-hidden shadow-2xl">
          <div className="flex items-center justify-between border-b border-[#262a38] bg-[#10121a] px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/10 text-orange-400 border border-orange-500/20">
                <Database className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-orange-400 font-bold">
                    {selectedExperiment.experiment_id}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.2 text-[10px] font-semibold uppercase ${
                      selectedExperiment.experiment_type === 'simulation'
                        ? 'bg-orange-500/20 text-orange-400'
                        : 'bg-blue-500/20 text-blue-400'
                    }`}
                  >
                    {selectedExperiment.experiment_type}
                  </span>
                  <span className="rounded bg-[#191c26] px-1.5 py-0.2 text-[10px] text-slate-400 font-mono">
                    {selectedExperiment.measurement_type}
                  </span>
                </div>
                <h3 className="text-base font-semibold text-white mt-0.5">
                  {selectedExperiment.title}
                </h3>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Link
                href={`/analysis?experiment_id=${selectedExperiment.experiment_id}`}
                className="flex items-center gap-1.5 rounded-md bg-[#191c26] border border-[#2d3244] px-3 py-1.5 text-xs text-purple-300 hover:bg-[#222634] transition-colors"
                title="Inspect in Statistical Analysis page"
              >
                <BarChart2 className="h-3.5 w-3.5 text-purple-400" />
                <span>Analyze in Stats Lab</span>
              </Link>
              <button
                onClick={() =>
                  handleExportCsv(selectedExperiment.experiment_id, selectedExperiment.title)
                }
                disabled={exportingId === selectedExperiment.experiment_id}
                className="flex items-center gap-1.5 rounded-md bg-[#191c26] border border-[#2d3244] px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-[#222634] transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Export CSV</span>
              </button>
              <button
                onClick={() =>
                  handleDownloadPdf(selectedExperiment.experiment_id, selectedExperiment.title)
                }
                disabled={downloadingPdfId === selectedExperiment.experiment_id}
                className="flex items-center gap-1.5 rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-500 transition-colors"
              >
                {downloadingPdfId === selectedExperiment.experiment_id ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
                <span>PDF Report</span>
              </button>
              <button
                onClick={() => setSelectedExperiment(null)}
                className="rounded p-1.5 text-slate-400 hover:text-white hover:bg-[#252a3b] transition-colors"
                title="Close Inspector"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="p-6">
            {/* Parameters Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                <span className="text-[10px] uppercase text-slate-400 block font-medium">Baseline λ</span>
                <span className="text-base font-bold text-white font-mono mt-0.5 block">
                  {selectedExperiment.baseline_lambda.toFixed(4)}
                </span>
                <span className="text-[10px] text-slate-500">counts / window</span>
              </div>

              <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                <span className="text-[10px] uppercase text-slate-400 block font-medium">Arrival Rate</span>
                <span className="text-base font-bold text-white font-mono mt-0.5 block">
                  {selectedExperiment.baseline_rate_per_second.toFixed(2)}
                </span>
                <span className="text-[10px] text-slate-500">arrivals / second</span>
              </div>

              <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                <span className="text-[10px] uppercase text-slate-400 block font-medium">Window W</span>
                <span className="text-base font-bold text-white font-mono mt-0.5 block">
                  {selectedExperiment.window_seconds}s
                </span>
                <span className="text-[10px] text-slate-500">duration</span>
              </div>

              <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                <span className="text-[10px] uppercase text-slate-400 block font-medium">Alpha α</span>
                <span className="text-base font-bold text-white font-mono mt-0.5 block">
                  {selectedExperiment.alpha}
                </span>
                <span className="text-[10px] text-slate-500">significance</span>
              </div>

              <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                <span className="text-[10px] uppercase text-slate-400 block font-medium">Observed Windows</span>
                <span className="text-base font-bold text-white font-mono mt-0.5 block">
                  {selectedExperiment.observation_count}
                </span>
                <span className="text-[10px] text-slate-500">total intervals</span>
              </div>

              <div className="rounded-lg bg-[#0c0d12] border border-[#222634] p-3">
                <span className="text-[10px] uppercase text-slate-400 block font-medium">Burst Detections</span>
                <span className="text-base font-bold text-red-400 font-mono mt-0.5 block">
                  {selectedExperiment.detected_window_count}
                </span>
                <span className="text-[10px] text-slate-500">flagged bursts</span>
              </div>
            </div>

            {/* Evaluation Metrics (if available) */}
            {selectedExperiment.evaluation && (
              <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
                    Detection Performance Evaluation (Ground-Truth Validated)
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
                  <div className="bg-[#0c0d12]/70 rounded p-2">
                    <span className="text-[10px] text-slate-400 uppercase block">Precision</span>
                    <span className="text-base font-bold text-white font-mono">
                      {(selectedExperiment.evaluation.precision * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="bg-[#0c0d12]/70 rounded p-2">
                    <span className="text-[10px] text-slate-400 uppercase block">Recall</span>
                    <span className="text-base font-bold text-white font-mono">
                      {(selectedExperiment.evaluation.recall * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="bg-[#0c0d12]/70 rounded p-2">
                    <span className="text-[10px] text-slate-400 uppercase block">F1-Score</span>
                    <span className="text-base font-bold text-white font-mono">
                      {selectedExperiment.evaluation.f1_score.toFixed(3)}
                    </span>
                  </div>
                  <div className="bg-[#0c0d12]/70 rounded p-2">
                    <span className="text-[10px] text-slate-400 uppercase block">False Positive Rate</span>
                    <span className="text-base font-bold text-white font-mono">
                      {(selectedExperiment.evaluation.false_positive_rate * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="bg-[#0c0d12]/70 rounded p-2 col-span-2 sm:col-span-1">
                    <span className="text-[10px] text-slate-400 uppercase block">Detection Delay</span>
                    <span className="text-base font-bold text-white font-mono">
                      {selectedExperiment.evaluation.detection_delay_seconds !== null &&
                      selectedExperiment.evaluation.detection_delay_seconds !== undefined
                        ? `${selectedExperiment.evaluation.detection_delay_seconds}s`
                        : '0.0s'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Model limitation note */}
            {selectedExperiment.model_limitation_note && (
              <p className="mt-4 text-xs text-amber-300 bg-amber-950/20 border border-amber-500/20 p-3 rounded-lg">
                <strong className="text-amber-200">Domain Limitation Note:</strong>{' '}
                {selectedExperiment.model_limitation_note}
              </p>
            )}

            {/* Observations and Detections Table Preview */}
            <div className="mt-6">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Aggregated Observation Windows ({selectedExperiment.observations.length} total)
                </h4>
                <span className="text-[11px] text-slate-500">
                  Displaying first 15 windows (export CSV for complete dataset)
                </span>
              </div>
              <div className="max-h-60 overflow-y-auto rounded-lg border border-[#222634] bg-[#0c0d12]">
                <table className="w-full text-left text-[11px] text-slate-300">
                  <thead className="bg-[#12141c] sticky top-0 border-b border-[#222634] text-slate-400">
                    <tr>
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Timestamp / Time</th>
                      <th className="px-3 py-2">Observed Count</th>
                      <th className="px-3 py-2">Expected λ</th>
                      <th className="px-3 py-2">P-Value</th>
                      <th className="px-3 py-2">Detector Decision</th>
                      <th className="px-3 py-2">Ground Truth</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1c1f2b]">
                    {selectedExperiment.observations.slice(0, 15).map((obs, idx) => {
                      const det = selectedExperiment.detections[idx];
                      return (
                        <tr key={idx} className="hover:bg-[#161822]">
                          <td className="px-3 py-1.5 font-mono text-slate-500">{idx + 1}</td>
                          <td className="px-3 py-1.5 font-mono text-slate-400">
                            {obs.time_seconds !== undefined && obs.time_seconds !== null
                              ? `${obs.time_seconds.toFixed(1)}s`
                              : obs.timestamp}
                          </td>
                          <td className="px-3 py-1.5 font-mono font-semibold text-white">
                            {obs.count}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-slate-400">
                            {selectedExperiment.baseline_lambda.toFixed(2)}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-slate-300">
                            {det ? formatProbability(det.p_value) : '—'}
                          </td>
                          <td className="px-3 py-1.5">
                            {det?.is_burst ? (
                              <span className="rounded bg-red-500/20 text-red-400 px-1.5 py-0.5 text-[10px] font-semibold">
                                BURST ALERT
                              </span>
                            ) : (
                              <span className="rounded bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 text-[10px]">
                                Normal
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-1.5">
                            {obs.ground_truth !== undefined && obs.ground_truth !== null ? (
                              obs.ground_truth ? (
                                <span className="text-red-400 font-semibold text-[10px]">True Burst</span>
                              ) : (
                                <span className="text-slate-500 text-[10px]">Normal</span>
                              )
                            ) : (
                              <span className="text-slate-600 text-[10px]">Unlabeled</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Comparison Modal */}
      {showComparison && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-[#2d3244] bg-[#14161f] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#262a38] pb-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Columns className="h-5 w-5 text-orange-400" />
                  <span>Experiment Comparison Matrix ({compareDetails.length} Trials)</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Side-by-side evaluation of statistical parameters, observation counts, and detection performance.
                </p>
              </div>
              <button
                onClick={() => setShowComparison(false)}
                className="rounded-lg p-2 text-slate-400 hover:text-white hover:bg-[#222634] transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Incompatible Measurements Warning */}
            {hasIncompatibleMeasurements && (
              <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-950/30 p-4 text-xs text-amber-200">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <h5 className="font-semibold text-amber-300">
                      Scientific Caution: Incompatible Measurement Semantics
                    </h5>
                    <p className="mt-1 text-slate-300">
                      You are comparing experiments with distinct measurement types:{' '}
                      <strong className="text-white">{distinctMeasurementTypes.join(', ')}</strong>.
                      Network flow counts (aggregated connection records) and packet counts (discrete frame arrivals)
                      represent fundamentally different physical phenomena and cannot be directly combined or equated.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Matrix Table */}
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300 border-collapse">
                <thead>
                  <tr className="border-b border-[#262a38]">
                    <th className="py-3 px-4 bg-[#0e1017] text-slate-400 font-semibold uppercase text-[11px] w-48">
                      Metric / Property
                    </th>
                    {compareDetails.map((exp) => (
                      <th
                        key={exp.experiment_id}
                        className="py-3 px-4 bg-[#10121a] text-white font-semibold min-w-[200px]"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-orange-400">{exp.experiment_id}</span>
                          <span
                            className={`rounded px-1.5 py-0.2 text-[9px] uppercase font-bold ${
                              exp.experiment_type === 'simulation'
                                ? 'bg-orange-500/20 text-orange-400'
                                : 'bg-blue-500/20 text-blue-400'
                            }`}
                          >
                            {exp.experiment_type}
                          </span>
                        </div>
                        <div className="text-xs text-slate-300 font-normal truncate mt-0.5" title={exp.title}>
                          {exp.title}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#222634]">
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-400">Measurement Type</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 font-mono font-semibold text-white">
                        {exp.measurement_type}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-400">Scenario / Dataset</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 text-slate-200">
                        {exp.scenario || exp.dataset_name || '—'}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-400">Window Duration (W)</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 font-mono text-slate-200">
                        {exp.window_seconds}s
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-400">Baseline λ (per window)</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 font-mono font-semibold text-cyan-400">
                        {exp.baseline_lambda.toFixed(4)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-400">Baseline Rate (per second)</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 font-mono text-slate-200">
                        {exp.baseline_rate_per_second.toFixed(2)}/s
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-400">Significance Level (α)</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 font-mono text-slate-200">
                        {exp.alpha}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-400">Analyzed Windows</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 font-mono text-slate-200">
                        {exp.observation_count}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-400">Detected Bursts</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 font-mono font-bold text-red-400">
                        {exp.detected_window_count}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-400">Ground Truth Status</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4">
                        {exp.ground_truth_available ? (
                          <span className="text-emerald-400 font-semibold">Available</span>
                        ) : (
                          <span className="text-slate-500">Unlabeled</span>
                        )}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-400">Precision</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 font-mono">
                        {exp.evaluation ? `${(exp.evaluation.precision * 100).toFixed(1)}%` : <span className="text-slate-600">N/A</span>}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-400">Recall</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 font-mono">
                        {exp.evaluation ? `${(exp.evaluation.recall * 100).toFixed(1)}%` : <span className="text-slate-600">N/A</span>}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-400">F1-Score</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 font-mono font-semibold">
                        {exp.evaluation ? (
                          <span className="text-emerald-400">{exp.evaluation.f1_score.toFixed(3)}</span>
                        ) : (
                          <span className="text-slate-600">N/A</span>
                        )}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-400">False Positive Rate</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 font-mono">
                        {exp.evaluation ? `${(exp.evaluation.false_positive_rate * 100).toFixed(1)}%` : <span className="text-slate-600">N/A</span>}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-400">Detection Delay</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 font-mono">
                        {exp.evaluation?.detection_delay_seconds !== undefined && exp.evaluation?.detection_delay_seconds !== null
                          ? `${exp.evaluation.detection_delay_seconds}s`
                          : <span className="text-slate-600">N/A</span>}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowComparison(false)}
                className="rounded-lg bg-[#191c26] border border-[#2d3244] px-4 py-2 text-xs font-medium text-slate-200 hover:bg-[#222634] transition-colors"
              >
                Close Comparison
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTargetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-red-500/30 bg-[#14161f] p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-red-400 mb-3">
              <AlertCircle className="h-6 w-6" />
              <h3 className="text-base font-semibold text-white">Delete Experiment Record</h3>
            </div>
            <p className="text-xs text-slate-300">
              Are you sure you want to permanently delete experiment{' '}
              <strong className="text-white font-mono">{deleteTargetId}</strong>?
              This will remove all stored observations, detections, and metrics from the persistent SQLite database.
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setDeleteTargetId(null)}
                disabled={deleting}
                className="rounded-lg bg-[#191c26] border border-[#2d3244] px-3.5 py-2 text-xs text-slate-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 transition-colors disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ExperimentHistoryPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-400">Loading Experiment History...</div>}>
      <ExperimentHistoryContent />
    </Suspense>
  );
}
