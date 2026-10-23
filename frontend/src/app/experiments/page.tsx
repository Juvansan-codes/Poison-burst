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
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import EmptyState from '@/components/ui/EmptyState';

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
    <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <PageHeader
        title="Experiment History & Comparison"
        subtitle="Browse, inspect, compare, and export all completed simulation trials and historical CSV analyses. Results are persisted in SQLite and survive application restarts."
        badge="25CS203 Micro-Project"
        actions={
          <>
            {compareIds.length >= 2 && (
              <button
                onClick={handleOpenComparison}
                disabled={loadingComparison}
                className="btn-primary"
              >
                <Columns className="h-3.5 w-3.5" />
                <span>Compare Selected ({compareIds.length})</span>
              </button>
            )}

            <button
              onClick={() => loadExperiments(page, selectedType, searchQuery)}
              disabled={loading}
              className="btn-secondary"
              title="Refresh list"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-[#FF6A00]' : 'text-[#A3A3A3]'}`} />
              <span>Refresh</span>
            </button>
          </>
        }
      />

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-lg border border-[#292929] bg-[#141414] p-4">
        {/* Type Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <span className="text-xs text-[#737373] mr-2 flex items-center gap-1 shrink-0">
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
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all shrink-0 ${
                selectedType === tab.id
                  ? 'bg-[rgba(255,106,0,0.15)] text-[#FF6A00] border border-[#FF6A00]'
                  : 'text-[#A3A3A3] hover:text-[#F5F5F5] hover:bg-[#191919] border border-transparent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#737373]" />
            <input
              type="text"
              placeholder="Search title, scenario, dataset..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rounded-md bg-[#101010] border border-[#292929] pl-8 pr-3 py-1.5 text-xs text-[#F5F5F5] placeholder-[#737373] focus:outline-none focus:border-[#FF6A00] w-full sm:w-64"
            />
          </div>
          <button
            type="submit"
            className="btn-secondary py-1.5 px-3 text-xs"
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
              className="text-xs text-[#737373] hover:text-[#F5F5F5] transition-colors"
            >
              Clear
            </button>
          )}
        </form>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-lg bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.25)] p-4 text-xs text-red-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[#ef4444] shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => loadExperiments()}
            className="rounded bg-[#191919] border border-[#292929] px-2.5 py-1 text-xs text-[#F5F5F5]"
          >
            Retry
          </button>
        </div>
      )}

      {/* Experiment List Table */}
      <div className="rounded-lg border border-[#292929] bg-[#141414] overflow-hidden">
        {loading && experiments.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center gap-3">
            <RefreshCw className="h-6 w-6 animate-spin text-[#FF6A00]" />
            <span className="text-xs text-[#737373]">Loading experiments from database...</span>
          </div>
        ) : experiments.length === 0 ? (
          <EmptyState
            icon={Database}
            title="No Experiments Found"
            description={
              searchQuery || selectedType !== 'all'
                ? 'No experiments match your search criteria. Try resetting filters.'
                : 'No experiments have been saved yet. Run a simulation or analyze a dataset to begin.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#A3A3A3]">
              <thead className="bg-[#101010] text-[11px] font-semibold uppercase tracking-wider text-[#737373] border-b border-[#292929]">
                <tr>
                  <th className="px-4 py-3 w-10 text-center font-medium">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="px-4 py-3 font-medium">ID</th>
                  <th className="px-4 py-3 font-medium">Title / Dataset</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Measurement</th>
                  <th className="px-4 py-3 font-medium">Baseline λ</th>
                  <th className="px-4 py-3 font-medium">Window</th>
                  <th className="px-4 py-3 font-medium">Bursts</th>
                  <th className="px-4 py-3 font-medium">Ground Truth</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202020]">
                {experiments.map((exp) => {
                  const isChecked = compareIds.includes(exp.experiment_id);
                  return (
                    <tr
                      key={exp.experiment_id}
                      className={`hover:bg-[#191919] transition-colors ${
                        selectedExperiment?.experiment_id === exp.experiment_id
                          ? 'bg-[rgba(255,106,0,0.06)] border-l-2 border-[#FF6A00]'
                          : ''
                      }`}
                    >
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleCompare(exp.experiment_id)}
                          className="rounded border-[#292929] bg-[#101010] text-[#FF6A00] focus:ring-0 cursor-pointer accent-[#FF6A00]"
                          title="Select to compare"
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-[#F5F5F5] font-medium whitespace-nowrap">
                        {exp.experiment_id}
                      </td>
                      <td className="px-4 py-3 font-medium text-[#F5F5F5] max-w-xs truncate" title={exp.title}>
                        {exp.title}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusBadge
                          label={exp.experiment_type}
                          variant={exp.experiment_type === 'simulation' ? 'accent' : 'neutral'}
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-[#A3A3A3] whitespace-nowrap">
                        {exp.measurement_type}
                      </td>
                      <td className="px-4 py-3 font-mono text-[#F5F5F5]">
                        {exp.baseline_lambda.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 font-mono text-[#F5F5F5] whitespace-nowrap">
                        {exp.window_seconds}s
                      </td>
                      <td className="px-4 py-3 font-mono text-[#ef4444] font-semibold">
                        {exp.detected_window_count}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {exp.ground_truth_available ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400 text-[11px] font-mono">
                            <CheckCircle2 className="h-3 w-3" /> Labeled
                          </span>
                        ) : (
                          <span className="text-[#737373] text-[11px] font-mono">Unlabeled</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[#737373] whitespace-nowrap text-[11px] font-mono">
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
                            className="rounded px-2.5 py-1 bg-[#101010] hover:bg-[rgba(255,106,0,0.1)] text-[#FF6A00] text-xs font-medium border border-[#292929] hover:border-[#FF6A00] transition-colors"
                          >
                            Inspect
                          </button>
                          <button
                            onClick={() => handleExportCsv(exp.experiment_id, exp.title)}
                            disabled={exportingId === exp.experiment_id}
                            className="rounded p-1.5 text-[#A3A3A3] hover:text-[#F5F5F5] hover:bg-[#191919] transition-colors"
                            title="Export CSV"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDownloadPdf(exp.experiment_id, exp.title)}
                            disabled={downloadingPdfId === exp.experiment_id}
                            className="rounded p-1.5 text-[#A3A3A3] hover:text-[#FF6A00] hover:bg-[#191919] transition-colors"
                            title="Download PDF Report"
                          >
                            {downloadingPdfId === exp.experiment_id ? (
                              <RefreshCw className="h-3.5 w-3.5 animate-spin text-[#FF6A00]" />
                            ) : (
                              <FileText className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <button
                            onClick={() => setDeleteTargetId(exp.experiment_id)}
                            className="rounded p-1.5 text-[#737373] hover:text-[#ef4444] hover:bg-[rgba(239,68,68,0.1)] transition-colors"
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
          <div className="flex items-center justify-between border-t border-[#292929] bg-[#101010] px-4 sm:px-6 py-3">
            <span className="text-xs text-[#737373]">
              Showing <span className="font-medium text-[#F5F5F5]">{experiments.length}</span> of{' '}
              <span className="font-medium text-[#F5F5F5]">{total}</span> experiments (Page {page} of {totalPages})
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => loadExperiments(page - 1)}
                disabled={page <= 1 || loading}
                className="btn-secondary py-1 px-2.5 text-xs"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Previous</span>
              </button>
              <button
                onClick={() => loadExperiments(page + 1)}
                disabled={page >= totalPages || loading}
                className="btn-secondary py-1 px-2.5 text-xs"
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
        <div className="rounded-lg border border-[rgba(255,106,0,0.35)] bg-[#141414] overflow-hidden space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#292929] bg-[#101010] px-4 sm:px-6 py-4">
            <div className="flex items-start sm:items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[rgba(255,106,0,0.1)] text-[#FF6A00] border border-[rgba(255,106,0,0.25)] shrink-0">
                <Database className="h-4 w-4" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-[#FF6A00] font-bold">
                    {selectedExperiment.experiment_id}
                  </span>
                  <StatusBadge
                    label={selectedExperiment.experiment_type}
                    variant={selectedExperiment.experiment_type === 'simulation' ? 'accent' : 'neutral'}
                  />
                  <span className="rounded bg-[#191919] px-2 py-0.5 text-[10px] text-[#A3A3A3] font-mono border border-[#292929]">
                    {selectedExperiment.measurement_type}
                  </span>
                </div>
                <h3 className="font-heading text-base font-semibold text-[#F5F5F5] mt-1">
                  {selectedExperiment.title}
                </h3>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/analysis?experiment_id=${selectedExperiment.experiment_id}`}
                className="btn-secondary text-xs"
                title="Inspect in Statistical Analysis page"
              >
                <BarChart2 className="h-3.5 w-3.5 text-[#FF6A00]" />
                <span>Analyze in Stats Lab</span>
              </Link>
              <button
                onClick={() =>
                  handleExportCsv(selectedExperiment.experiment_id, selectedExperiment.title)
                }
                disabled={exportingId === selectedExperiment.experiment_id}
                className="btn-secondary text-xs"
              >
                <Download className="h-3.5 w-3.5 text-[#A3A3A3]" />
                <span>Export CSV</span>
              </button>
              <button
                onClick={() =>
                  handleDownloadPdf(selectedExperiment.experiment_id, selectedExperiment.title)
                }
                disabled={downloadingPdfId === selectedExperiment.experiment_id}
                className="btn-primary text-xs"
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
                className="rounded p-1.5 text-[#737373] hover:text-[#F5F5F5] hover:bg-[#191919] transition-colors"
                title="Close Inspector"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="p-4 sm:p-6 space-y-6">
            {/* Parameters Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="rounded-md bg-[#101010] border border-[#292929] p-3">
                <span className="stat-label block">Baseline λ</span>
                <span className="stat-value text-base text-[#F5F5F5] mt-1 block">
                  {selectedExperiment.baseline_lambda.toFixed(4)}
                </span>
                <span className="stat-helper block">counts / window</span>
              </div>

              <div className="rounded-md bg-[#101010] border border-[#292929] p-3">
                <span className="stat-label block">Arrival Rate</span>
                <span className="stat-value text-base text-[#F5F5F5] mt-1 block">
                  {selectedExperiment.baseline_rate_per_second.toFixed(2)}
                </span>
                <span className="stat-helper block">arrivals / second</span>
              </div>

              <div className="rounded-md bg-[#101010] border border-[#292929] p-3">
                <span className="stat-label block">Window W</span>
                <span className="stat-value text-base text-[#F5F5F5] mt-1 block">
                  {selectedExperiment.window_seconds}s
                </span>
                <span className="stat-helper block">duration</span>
              </div>

              <div className="rounded-md bg-[#101010] border border-[#292929] p-3">
                <span className="stat-label block">Alpha α</span>
                <span className="stat-value text-base text-[#F5F5F5] mt-1 block">
                  {selectedExperiment.alpha}
                </span>
                <span className="stat-helper block">significance</span>
              </div>

              <div className="rounded-md bg-[#101010] border border-[#292929] p-3">
                <span className="stat-label block">Observed Windows</span>
                <span className="stat-value text-base text-[#F5F5F5] mt-1 block">
                  {selectedExperiment.observation_count}
                </span>
                <span className="stat-helper block">total intervals</span>
              </div>

              <div className="rounded-md bg-[#101010] border border-[#292929] p-3">
                <span className="stat-label block">Burst Detections</span>
                <span className="stat-value text-base text-[#ef4444] mt-1 block">
                  {selectedExperiment.detected_window_count}
                </span>
                <span className="stat-helper block">flagged bursts</span>
              </div>
            </div>

            {/* Evaluation Metrics (if available) */}
            {selectedExperiment.evaluation && (
              <div className="rounded-md border border-[rgba(34,197,94,0.25)] bg-[rgba(34,197,94,0.05)] p-4">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
                    Detection Performance Evaluation (Ground-Truth Validated)
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
                  <div className="bg-[#101010] border border-[#292929] rounded p-2.5">
                    <span className="text-[10px] text-[#A3A3A3] uppercase block font-medium">Precision</span>
                    <span className="font-mono text-base font-bold text-[#F5F5F5] mt-0.5 block">
                      {(selectedExperiment.evaluation.precision * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="bg-[#101010] border border-[#292929] rounded p-2.5">
                    <span className="text-[10px] text-[#A3A3A3] uppercase block font-medium">Recall</span>
                    <span className="font-mono text-base font-bold text-emerald-400 mt-0.5 block">
                      {(selectedExperiment.evaluation.recall * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="bg-[#101010] border border-[#292929] rounded p-2.5">
                    <span className="text-[10px] text-[#A3A3A3] uppercase block font-medium">F1-Score</span>
                    <span className="font-mono text-base font-bold text-[#FF6A00] mt-0.5 block">
                      {selectedExperiment.evaluation.f1_score.toFixed(3)}
                    </span>
                  </div>
                  <div className="bg-[#101010] border border-[#292929] rounded p-2.5">
                    <span className="text-[10px] text-[#A3A3A3] uppercase block font-medium">False Positive Rate</span>
                    <span className="font-mono text-base font-bold text-[#ef4444] mt-0.5 block">
                      {(selectedExperiment.evaluation.false_positive_rate * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="bg-[#101010] border border-[#292929] rounded p-2.5 col-span-2 sm:col-span-1">
                    <span className="text-[10px] text-[#A3A3A3] uppercase block font-medium">Detection Delay</span>
                    <span className="font-mono text-base font-bold text-[#F5F5F5] mt-0.5 block">
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
              <div className="text-xs text-[#A3A3A3] bg-[#101010] border border-[#292929] p-3.5 rounded-md leading-relaxed">
                <strong className="text-[#FF6A00]">Domain Limitation Note:</strong>{' '}
                {selectedExperiment.model_limitation_note}
              </div>
            )}

            {/* Observations and Detections Table Preview */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="font-heading text-xs font-semibold uppercase tracking-wider text-[#F5F5F5]">
                  Aggregated Observation Windows ({selectedExperiment.observations.length} total)
                </h4>
                <span className="text-[11px] text-[#737373]">
                  Displaying first 15 windows (export CSV for complete dataset)
                </span>
              </div>
              <div className="max-h-60 overflow-y-auto rounded-md border border-[#292929] bg-[#101010]">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-[#141414] sticky top-0 border-b border-[#292929] text-[#737373] text-[11px]">
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
                  <tbody className="divide-y divide-[#202020] text-[#A3A3A3]">
                    {selectedExperiment.observations.slice(0, 15).map((obs, idx) => {
                      const det = selectedExperiment.detections[idx];
                      return (
                        <tr key={idx} className="hover:bg-[#191919]">
                          <td className="px-3 py-1.5 text-[#737373]">{idx + 1}</td>
                          <td className="px-3 py-1.5 text-[#A3A3A3]">
                            {obs.time_seconds !== undefined && obs.time_seconds !== null
                              ? `${obs.time_seconds.toFixed(1)}s`
                              : obs.timestamp}
                          </td>
                          <td className="px-3 py-1.5 font-semibold text-[#F5F5F5]">
                            {obs.count}
                          </td>
                          <td className="px-3 py-1.5 text-[#737373]">
                            {selectedExperiment.baseline_lambda.toFixed(2)}
                          </td>
                          <td className="px-3 py-1.5 text-[#FF6A00]">
                            {det ? formatProbability(det.p_value) : '—'}
                          </td>
                          <td className="px-3 py-1.5">
                            <StatusBadge
                              label={det?.is_burst ? 'BURST ALERT' : 'Normal'}
                              variant={det?.is_burst ? 'error' : 'success'}
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            {obs.ground_truth !== undefined && obs.ground_truth !== null ? (
                              obs.ground_truth ? (
                                <span className="text-[#FF6A00] font-semibold text-[11px]">True Burst</span>
                              ) : (
                                <span className="text-[#737373] text-[11px]">Normal</span>
                              )
                            ) : (
                              <span className="text-[#737373] text-[11px]">Unlabeled</span>
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
          <div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-lg border border-[#292929] bg-[#141414] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#292929] pb-4">
              <div>
                <h3 className="font-heading text-lg font-bold text-[#F5F5F5] flex items-center gap-2">
                  <Columns className="h-5 w-5 text-[#FF6A00]" />
                  <span>Experiment Comparison Matrix ({compareDetails.length} Trials)</span>
                </h3>
                <p className="text-xs text-[#737373] mt-0.5">
                  Side-by-side evaluation of statistical parameters, observation counts, and detection performance.
                </p>
              </div>
              <button
                onClick={() => setShowComparison(false)}
                className="rounded-md p-1.5 text-[#737373] hover:text-[#F5F5F5] hover:bg-[#191919] transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Incompatible Measurements Warning */}
            {hasIncompatibleMeasurements && (
              <div className="rounded-md border border-[rgba(255,106,0,0.3)] bg-[rgba(255,106,0,0.08)] p-4 text-xs text-[#FF6A00]">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-[#FF6A00] shrink-0 mt-0.5" />
                  <div>
                    <h5 className="font-semibold text-[#F5F5F5]">
                      Scientific Caution: Incompatible Measurement Semantics
                    </h5>
                    <p className="mt-1 text-[#A3A3A3] leading-relaxed">
                      You are comparing experiments with distinct measurement types:{' '}
                      <strong className="text-[#F5F5F5]">{distinctMeasurementTypes.join(', ')}</strong>.
                      Network flow counts (aggregated connection records) and packet counts (discrete frame arrivals)
                      represent fundamentally different physical phenomena and cannot be directly combined or equated.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Matrix Table */}
            <div className="overflow-x-auto rounded-md border border-[#292929]">
              <table className="w-full text-left text-xs text-[#A3A3A3] border-collapse font-mono">
                <thead>
                  <tr className="border-b border-[#292929]">
                    <th className="py-3 px-4 bg-[#101010] text-[#737373] font-semibold uppercase text-[11px] w-48">
                      Metric / Property
                    </th>
                    {compareDetails.map((exp) => (
                      <th
                        key={exp.experiment_id}
                        className="py-3 px-4 bg-[#141414] text-[#F5F5F5] font-semibold min-w-[200px]"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[#FF6A00]">{exp.experiment_id}</span>
                          <StatusBadge
                            label={exp.experiment_type}
                            variant={exp.experiment_type === 'simulation' ? 'accent' : 'neutral'}
                          />
                        </div>
                        <div className="text-xs text-[#A3A3A3] font-normal truncate mt-1" title={exp.title}>
                          {exp.title}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#202020]">
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-[#737373]">Measurement Type</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 font-mono font-semibold text-[#F5F5F5]">
                        {exp.measurement_type}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-[#737373]">Scenario / Dataset</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 text-[#F5F5F5]">
                        {exp.scenario || exp.dataset_name || '—'}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-[#737373]">Window Duration (W)</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 font-mono text-[#F5F5F5]">
                        {exp.window_seconds}s
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-[#737373]">Baseline λ (per window)</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 font-mono font-semibold text-emerald-400">
                        {exp.baseline_lambda.toFixed(4)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-[#737373]">Baseline Rate (per second)</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 font-mono text-[#F5F5F5]">
                        {exp.baseline_rate_per_second.toFixed(2)}/s
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-[#737373]">Significance Level (α)</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 font-mono text-[#F5F5F5]">
                        {exp.alpha}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-[#737373]">Analyzed Windows</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 font-mono text-[#F5F5F5]">
                        {exp.observation_count}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-[#737373]">Detected Bursts</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 font-mono font-bold text-[#ef4444]">
                        {exp.detected_window_count}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-[#737373]">Ground Truth Status</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4">
                        {exp.ground_truth_available ? (
                          <span className="text-emerald-400 font-semibold">Available</span>
                        ) : (
                          <span className="text-[#737373]">Unlabeled</span>
                        )}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-[#737373]">Precision</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 font-mono">
                        {exp.evaluation ? `${(exp.evaluation.precision * 100).toFixed(1)}%` : <span className="text-[#737373]">N/A</span>}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-[#737373]">Recall</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 font-mono text-emerald-400">
                        {exp.evaluation ? `${(exp.evaluation.recall * 100).toFixed(1)}%` : <span className="text-[#737373]">N/A</span>}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-[#737373]">F1-Score</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 font-mono font-semibold">
                        {exp.evaluation ? (
                          <span className="text-[#FF6A00]">{exp.evaluation.f1_score.toFixed(3)}</span>
                        ) : (
                          <span className="text-[#737373]">N/A</span>
                        )}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-[#737373]">False Positive Rate</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 font-mono text-[#ef4444]">
                        {exp.evaluation ? `${(exp.evaluation.false_positive_rate * 100).toFixed(1)}%` : <span className="text-[#737373]">N/A</span>}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-[#737373]">Detection Delay</td>
                    {compareDetails.map((exp) => (
                      <td key={exp.experiment_id} className="py-2.5 px-4 font-mono text-[#F5F5F5]">
                        {exp.evaluation?.detection_delay_seconds !== undefined && exp.evaluation?.detection_delay_seconds !== null
                          ? `${exp.evaluation.detection_delay_seconds}s`
                          : <span className="text-[#737373]">N/A</span>}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowComparison(false)}
                className="btn-secondary"
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
          <div className="w-full max-w-md rounded-lg border border-[rgba(239,68,68,0.3)] bg-[#141414] p-6 shadow-2xl space-y-3">
            <div className="flex items-center gap-3 text-[#ef4444]">
              <AlertCircle className="h-6 w-6" />
              <h3 className="font-heading text-base font-semibold text-[#F5F5F5]">Delete Experiment Record</h3>
            </div>
            <p className="text-xs text-[#A3A3A3] leading-relaxed">
              Are you sure you want to permanently delete experiment{' '}
              <strong className="text-[#F5F5F5] font-mono">{deleteTargetId}</strong>?
              This will remove all stored observations, detections, and metrics from the persistent SQLite database.
            </p>
            <div className="flex items-center justify-end gap-3 pt-3">
              <button
                onClick={() => setDeleteTargetId(null)}
                disabled={deleting}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="btn-primary bg-[#ef4444] hover:bg-[#dc2626]"
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
    <Suspense fallback={<div className="p-8 text-center text-[#737373]">Loading Experiment History...</div>}>
      <ExperimentHistoryContent />
    </Suspense>
  );
}
