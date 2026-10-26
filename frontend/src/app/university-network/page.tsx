'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowUpDown,
  BarChart3,
  Calendar,
  Check,
  CheckSquare,
  Clock,
  Compass,
  Database,
  Download,
  Filter,
  Flame,
  HelpCircle,
  Info,
  Layers,
  Network,
  RefreshCw,
  Search,
  Sliders,
  Square,
  Target,
  Zap,
} from 'lucide-react';
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { api, ApiClientError } from '@/lib/api';
import {
  AllSeriesStatisticsResponse,
  DatasetSummaryResponse,
  SeriesMetadata,
  SeriesStatistics,
  TimeSeriesResponse,
  TrafficSpikeCandidate,
  UniversitySpikesResponse,
} from '@/lib/types';
import PageHeader from '@/components/ui/PageHeader';
import MetricCard from '@/components/ui/MetricCard';
import EmptyState from '@/components/ui/EmptyState';

// Distinct palette for plotted telemetry series
const SERIES_COLORS = [
  '#FF6A00', // Brand Orange
  '#06b6d4', // Cyan
  '#a855f7', // Purple
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#f43f5e', // Rose
  '#3b82f6', // Blue
  '#84cc16', // Lime
  '#e879f9', // Fuchsia
  '#14b8a6', // Teal
  '#6366f1', // Indigo
  '#ec4899', // Pink
];

// Helper: Format timestamp in Asia/Kolkata (IST, UTC+5:30)
function formatKolkataTime(timestampSec: number): string {
  try {
    const d = new Date(timestampSec * 1000);
    return (
      new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(d) + ' IST'
    );
  } catch {
    return new Date(timestampSec * 1000).toISOString().slice(5, 16);
  }
}

function formatKolkataFull(timestampSec: number): string {
  try {
    const d = new Date(timestampSec * 1000);
    return (
      new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(d) + ' IST'
    );
  } catch {
    return new Date(timestampSec * 1000).toISOString();
  }
}

// Format numbers compactly (e.g. 1.55B, 327.70M, -1.40B)
function formatMetricValue(val: number | null | undefined): string {
  if (val === null || val === undefined) return '—';
  if (val === 0) return '0.00';
  const absVal = Math.abs(val);
  if (absVal >= 1e9) {
    return `${(val / 1e9).toFixed(2)}B`;
  }
  if (absVal >= 1e6) {
    return `${(val / 1e6).toFixed(2)}M`;
  }
  if (absVal >= 1e3) {
    return `${(val / 1e3).toFixed(2)}K`;
  }
  return val.toFixed(2);
}

// Scientific notation with 3 significant digits
function formatScientific(val: number | null | undefined): string {
  if (val === null || val === undefined) return '—';
  if (val === 0) return '0.000e+00';
  return val.toExponential(3);
}

export default function UniversityNetworkPage() {
  // Active dataset selection: 'core_switch' | 'firewall'
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('firewall');

  // Loading and error states
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Data states
  const [summary, setSummary] = useState<DatasetSummaryResponse | null>(null);
  const [timeSeriesResponse, setTimeSeriesResponse] = useState<TimeSeriesResponse | null>(null);
  const [allStatsResponse, setAllStatsResponse] = useState<AllSeriesStatisticsResponse | null>(null);

  // Chart visualization controls
  const [useAbsoluteMagnitude, setUseAbsoluteMagnitude] = useState<boolean>(false);
  const [timeRangePreset, setTimeRangePreset] = useState<'all' | 'early' | 'late' | 'peak'>('all');
  const [selectedSeriesIds, setSelectedSeriesIds] = useState<string[]>(['series_001', 'series_026']);

  // Series selector filter state
  const [selectorSearch, setSelectorSearch] = useState<string>('');
  const [activeGroupFilter, setActiveGroupFilter] = useState<'all' | 'rx' | 'blank'>('all');

  // Statistics table state
  const [tableSearch, setTableSearch] = useState<string>('');
  const [tableFilterActiveOnly, setTableFilterActiveOnly] = useState<boolean>(true);
  const [tableSortColumn, setTableSortColumn] = useState<string>('abs_peak_value');
  const [tableSortDirection, setTableSortDirection] = useState<'asc' | 'desc'>('desc');
  const [tablePage, setTablePage] = useState<number>(1);
  const tablePageSize = 15;

  // ── Phase 3: Traffic-Spike Analysis State ──
  const [spikesResponse, setSpikesResponse] = useState<UniversitySpikesResponse | null>(null);
  const [isAnalyzingSpikes, setIsAnalyzingSpikes] = useState<boolean>(false);
  const [spikeThreshold, setSpikeThreshold] = useState<number>(3.5);
  const [showSpikeMarkersOnChart, setShowSpikeMarkersOnChart] = useState<boolean>(true);
  const [spikeFilterPlottedOnly, setSpikeFilterPlottedOnly] = useState<boolean>(false);
  const [spikeSortBy, setSpikeSortBy] = useState<'score' | 'timestamp' | 'magnitude'>('score');
  const [spikeSortDirection, setSpikeSortDirection] = useState<'asc' | 'desc'>('desc');
  const [spikeTableSearch, setSpikeTableSearch] = useState<string>('');
  const [spikeTablePage, setSpikeTablePage] = useState<number>(1);
  const spikeTablePageSize = 15;
  const [focusedSpikeTimestamp, setFocusedSpikeTimestamp] = useState<number | null>(null);

  // Default series mapping when switching datasets
  const getDefaultSeriesForDataset = (datasetId: string): string[] => {
    if (datasetId === 'firewall') {
      return ['series_001', 'series_026'];
    }
    return ['series_001', 'series_098'];
  };

  // Handle dataset switch
  const handleSelectDataset = (datasetId: string) => {
    if (datasetId === selectedDatasetId) return;
    setIsLoading(true);
    setSelectedDatasetId(datasetId);
    setSelectedSeriesIds(getDefaultSeriesForDataset(datasetId));
    setTablePage(1);
    setSelectorSearch('');
    setFocusedSpikeTimestamp(null);
  };

  // Handle column sorting for spike candidates
  const handleSortSpikes = (column: 'score' | 'timestamp' | 'magnitude') => {
    if (spikeSortBy === column) {
      setSpikeSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSpikeSortBy(column);
      setSpikeSortDirection('desc');
    }
    setSpikeTablePage(1);
  };

  // Primary data loader (Phase 1 & 2 baseline)
  const loadDatasetData = useCallback(
    async (datasetId: string, showRefreshSpinner = false) => {
      if (showRefreshSpinner) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setErrorMessage(null);

      try {
        const [summaryRes, timeSeriesRes, statsRes] = await Promise.all([
          api.getUniversityDatasetSummary(datasetId),
          api.getUniversityTimeSeries(datasetId, { include_boundary_rows: false }),
          api.getUniversityAllSeriesStatistics(datasetId, false),
        ]);

        setSummary(summaryRes);
        setTimeSeriesResponse(timeSeriesRes);
        setAllStatsResponse(statsRes);
      } catch (err: unknown) {
        const msg = err instanceof ApiClientError ? err.message : String(err);
        setErrorMessage(msg);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    []
  );

  // Traffic-Spike Data Loader (Phase 3)
  const loadSpikesData = useCallback(
    async (datasetId: string, thresholdVal: number) => {
      setIsAnalyzingSpikes(true);
      try {
        const res = await api.getUniversitySpikes(datasetId, {
          threshold: thresholdVal,
          max_candidates: 500,
          sort_by: spikeSortBy,
          sort_direction: spikeSortDirection,
        });
        setSpikesResponse(res);
        setSpikeTablePage(1);
      } catch (err: unknown) {
        const msg = err instanceof ApiClientError ? err.message : String(err);
        console.error('Failed to load traffic spikes:', msg);
      } finally {
        setIsAnalyzingSpikes(false);
      }
    },
    [spikeSortBy, spikeSortDirection]
  );

  // Initial mount and dataset switch
  useEffect(() => {
    let ignore = false;
    Promise.all([
      api.getUniversityDatasetSummary(selectedDatasetId),
      api.getUniversityTimeSeries(selectedDatasetId, { include_boundary_rows: false }),
      api.getUniversityAllSeriesStatistics(selectedDatasetId, false),
    ])
      .then(([summaryRes, timeSeriesRes, statsRes]) => {
        if (!ignore) {
          setSummary(summaryRes);
          setTimeSeriesResponse(timeSeriesRes);
          setAllStatsResponse(statsRes);
          setIsLoading(false);
          setIsRefreshing(false);
        }
      })
      .catch((err: unknown) => {
        if (!ignore) {
          const msg = err instanceof ApiClientError ? err.message : String(err);
          setErrorMessage(msg);
          setIsLoading(false);
          setIsRefreshing(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [selectedDatasetId]);

  // Load spike candidates whenever dataset, threshold, or sort criteria change
  useEffect(() => {
    let ignore = false;
    api
      .getUniversitySpikes(selectedDatasetId, {
        threshold: spikeThreshold,
        max_candidates: 500,
        sort_by: spikeSortBy,
        sort_direction: spikeSortDirection,
      })
      .then((res) => {
        if (!ignore) {
          setSpikesResponse(res);
          setIsAnalyzingSpikes(false);
        }
      })
      .catch((err: unknown) => {
        if (!ignore) {
          const msg = err instanceof ApiClientError ? err.message : String(err);
          console.error('Failed to load traffic spikes:', msg);
          setIsAnalyzingSpikes(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [selectedDatasetId, spikeThreshold, spikeSortBy, spikeSortDirection]);

  // Color mapping for selected series
  const seriesColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    selectedSeriesIds.forEach((id, index) => {
      map[id] = SERIES_COLORS[index % SERIES_COLORS.length];
    });
    return map;
  }, [selectedSeriesIds]);

  // Lookup map of detected spikes for fast chart marker checking: `seriesId_timestamp` -> TrafficSpikeCandidate
  const spikeLookupMap = useMemo(() => {
    const map: Record<string, TrafficSpikeCandidate> = {};
    if (spikesResponse?.candidates) {
      spikesResponse.candidates.forEach((c) => {
        map[`${c.series_id}_${c.timestamp}`] = c;
      });
    }
    return map;
  }, [spikesResponse]);

  // Set of timestamps that have spikes among currently selected series
  const activeSeriesSpikeTimestamps = useMemo(() => {
    const set = new Set<number>();
    if (spikesResponse?.candidates) {
      spikesResponse.candidates.forEach((c) => {
        if (selectedSeriesIds.includes(c.series_id)) {
          set.add(c.timestamp);
        }
      });
    }
    return set;
  }, [spikesResponse, selectedSeriesIds]);

  // Filtered and formatted time series points for Recharts
  const chartPoints = useMemo(() => {
    if (!timeSeriesResponse || !timeSeriesResponse.data) return [];

    let points = timeSeriesResponse.data;

    // Apply time-range presets
    if (timeRangePreset === 'early') {
      points = points.filter((p) => p.timestamp <= 1792508400);
    } else if (timeRangePreset === 'late') {
      points = points.filter((p) => p.timestamp >= 1792584000);
    } else if (timeRangePreset === 'peak') {
      points = points.filter((p) => p.timestamp >= 1792640000 && p.timestamp <= 1792730000);
    }

    return points.map((p) => {
      const row: Record<string, string | number | boolean | null> = {
        timestamp: p.timestamp,
        datetime: p.datetime,
        formattedTime: formatKolkataTime(p.timestamp),
        hasSpike: activeSeriesSpikeTimestamps.has(p.timestamp),
      };

      selectedSeriesIds.forEach((sId) => {
        const rawVal = p.values[sId];
        if (rawVal === null || rawVal === undefined) {
          row[sId] = null;
        } else {
          row[sId] = useAbsoluteMagnitude ? Math.abs(rawVal) : rawVal;
        }
      });

      return row;
    });
  }, [timeSeriesResponse, selectedSeriesIds, useAbsoluteMagnitude, timeRangePreset, activeSeriesSpikeTimestamps]);

  // Series metadata lookup map
  const seriesMetaMap = useMemo(() => {
    const map: Record<string, SeriesMetadata> = {};
    if (timeSeriesResponse?.series_metadata) {
      timeSeriesResponse.series_metadata.forEach((m) => {
        map[m.series_id] = m;
      });
    }
    return map;
  }, [timeSeriesResponse]);

  // Series statistics lookup map
  const seriesStatsMap = useMemo(() => {
    const map: Record<string, SeriesStatistics> = {};
    if (allStatsResponse?.series_statistics) {
      allStatsResponse.series_statistics.forEach((s) => {
        map[s.series_id] = s;
      });
    }
    return map;
  }, [allStatsResponse]);

  // Filtered series list for the Series Selector
  const selectorSeriesList = useMemo(() => {
    if (!timeSeriesResponse?.series_metadata) return [];

    let list = timeSeriesResponse.series_metadata;

    if (activeGroupFilter === 'rx') {
      list = list.filter((m) => !m.is_blank_header);
    } else if (activeGroupFilter === 'blank') {
      list = list.filter((m) => m.is_blank_header);
    }

    if (selectorSearch.trim()) {
      const q = selectorSearch.toLowerCase().trim();
      list = list.filter(
        (m) =>
          m.series_id.toLowerCase().includes(q) ||
          m.display_name.toLowerCase().includes(q) ||
          m.original_header.toLowerCase().includes(q)
      );
    }

    return list;
  }, [timeSeriesResponse, selectorSearch, activeGroupFilter]);

  // Filtered and sorted series for the Statistics Table
  const tableSeriesList = useMemo(() => {
    if (!allStatsResponse?.series_statistics) return [];

    let list = [...allStatsResponse.series_statistics];

    if (tableFilterActiveOnly) {
      list = list.filter((s) => !s.is_all_zero && s.valid_count > 0);
    }

    if (tableSearch.trim()) {
      const q = tableSearch.toLowerCase().trim();
      list = list.filter(
        (s) =>
          s.series_id.toLowerCase().includes(q) ||
          s.display_name.toLowerCase().includes(q) ||
          s.original_header.toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      let aVal = (a as unknown as Record<string, unknown>)[tableSortColumn];
      let bVal = (b as unknown as Record<string, unknown>)[tableSortColumn];

      if (aVal === null || aVal === undefined) aVal = -Infinity;
      if (bVal === null || bVal === undefined) bVal = -Infinity;

      if (typeof aVal === 'string') {
        return tableSortDirection === 'asc'
          ? aVal.localeCompare(String(bVal))
          : String(bVal).localeCompare(aVal);
      }

      return tableSortDirection === 'asc'
        ? Number(aVal) - Number(bVal)
        : Number(bVal) - Number(aVal);
    });

    return list;
  }, [
    allStatsResponse,
    tableFilterActiveOnly,
    tableSearch,
    tableSortColumn,
    tableSortDirection,
  ]);

  const paginatedTableSeries = useMemo(() => {
    const startIndex = (tablePage - 1) * tablePageSize;
    return tableSeriesList.slice(startIndex, startIndex + tablePageSize);
  }, [tableSeriesList, tablePage, tablePageSize]);

  const totalTablePages = Math.max(1, Math.ceil(tableSeriesList.length / tablePageSize));

  // ── Phase 3: Filtered Spike Candidates for Spike Table ──
  const filteredSpikeCandidates = useMemo(() => {
    if (!spikesResponse?.candidates) return [];

    let list = [...spikesResponse.candidates];

    if (spikeFilterPlottedOnly) {
      list = list.filter((c) => selectedSeriesIds.includes(c.series_id));
    }

    if (spikeTableSearch.trim()) {
      const q = spikeTableSearch.toLowerCase().trim();
      list = list.filter(
        (c) =>
          c.series_id.toLowerCase().includes(q) ||
          c.series_display_name.toLowerCase().includes(q) ||
          c.original_header.toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      let aVal = a.anomaly_score;
      let bVal = b.anomaly_score;
      if (spikeSortBy === 'timestamp') {
        aVal = a.timestamp;
        bVal = b.timestamp;
      } else if (spikeSortBy === 'magnitude') {
        aVal = a.abs_value;
        bVal = b.abs_value;
      }
      return spikeSortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return list;
  }, [spikesResponse, spikeFilterPlottedOnly, selectedSeriesIds, spikeTableSearch, spikeSortBy, spikeSortDirection]);

  const paginatedSpikeCandidates = useMemo(() => {
    const startIndex = (spikeTablePage - 1) * spikeTablePageSize;
    return filteredSpikeCandidates.slice(startIndex, startIndex + spikeTablePageSize);
  }, [filteredSpikeCandidates, spikeTablePage, spikeTablePageSize]);

  const totalSpikeTablePages = Math.max(1, Math.ceil(filteredSpikeCandidates.length / spikeTablePageSize));

  // Toggle selection of a series on the chart
  const toggleSeriesSelection = (seriesId: string) => {
    setSelectedSeriesIds((prev) => {
      if (prev.includes(seriesId)) {
        if (prev.length === 1) return prev;
        return prev.filter((id) => id !== seriesId);
      } else {
        if (prev.length >= 10) return prev;
        return [...prev, seriesId];
      }
    });
  };

  // Inspect and focus a spike on the chart
  const handleInspectSpikeOnChart = (candidate: TrafficSpikeCandidate) => {
    if (!selectedSeriesIds.includes(candidate.series_id)) {
      setSelectedSeriesIds((prev) => [...prev, candidate.series_id].slice(-10));
    }
    setShowSpikeMarkersOnChart(true);
    setFocusedSpikeTimestamp(candidate.timestamp);

    // Smooth scroll to chart container
    const chartElem = document.getElementById('historical-chart-container');
    if (chartElem) {
      chartElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // Quick selection presets
  const handleSelectTopActive = () => {
    if (!allStatsResponse?.series_statistics) return;
    const active = allStatsResponse.series_statistics
      .filter((s) => !s.is_all_zero)
      .sort((a, b) => (b.abs_peak_value || 0) - (a.abs_peak_value || 0))
      .slice(0, 4)
      .map((s) => s.series_id);
    if (active.length > 0) setSelectedSeriesIds(active);
  };

  const handleSelectInboundSample = () => {
    if (!timeSeriesResponse?.series_metadata) return;
    const rx = timeSeriesResponse.series_metadata
      .filter((m) => !m.is_blank_header)
      .filter((m) => !seriesStatsMap[m.series_id]?.is_all_zero)
      .slice(0, 2)
      .map((m) => m.series_id);
    if (rx.length > 0) setSelectedSeriesIds(rx);
  };

  const handleSelectOutboundSample = () => {
    if (!timeSeriesResponse?.series_metadata) return;
    const blank = timeSeriesResponse.series_metadata
      .filter((m) => m.is_blank_header)
      .filter((m) => !seriesStatsMap[m.series_id]?.is_all_zero)
      .slice(0, 2)
      .map((m) => m.series_id);
    if (blank.length > 0) setSelectedSeriesIds(blank);
  };

  // Sort handler for statistics table
  const handleTableSort = (colKey: string) => {
    if (tableSortColumn === colKey) {
      setTableSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setTableSortColumn(colKey);
      setTableSortDirection('desc');
    }
  };

  // ── CSV Export Functionality (Phase 3 Requirement) ──
  const handleExportSpikesCsv = () => {
    if (!filteredSpikeCandidates || filteredSpikeCandidates.length === 0) return;

    const headers = [
      'Timestamp_Unix',
      'Datetime_IST',
      'Datetime_UTC',
      'Dataset_ID',
      'Series_ID',
      'Series_Display_Name',
      'Source_Header',
      'Recorded_Signed_Value',
      'Absolute_Magnitude',
      'Robust_Baseline_Median',
      'Deviation',
      'Anomaly_Score_Modified_Z',
      'Detection_Method',
      'Threshold_Used',
    ];

    const metadataLines = [
      `# PoissonBurst Lab - Historical Traffic-Spike Candidates Export`,
      `# Dataset: ${summary?.display_name || selectedDatasetId} (${selectedDatasetId})`,
      `# Export Date UTC: ${new Date().toISOString()}`,
      `# Detection Method: Robust Median & MAD (with IQR Fallback)`,
      `# Detection Threshold: ${spikeThreshold}`,
      `# Disclaimer: Statistical outlier candidates only. NOT confirmed security attacks or validated malicious incidents.`,
      `# Physical Units: Unknown/unconfirmed in source export. Values must not be assumed as bps or pps without evidence.`,
      `#`,
    ];

    const dataLines = filteredSpikeCandidates.map((c) => {
      return [
        c.timestamp,
        `"${formatKolkataFull(c.timestamp)}"`,
        `"${c.datetime}"`,
        `"${c.dataset_id}"`,
        `"${c.series_id}"`,
        `"${c.series_display_name}"`,
        `"${c.original_header || '(blank)'}"`,
        c.signed_value,
        c.abs_value,
        c.baseline_value,
        c.deviation,
        c.anomaly_score,
        `"${c.detection_method}"`,
        c.threshold_used,
      ].join(',');
    });

    const csvContent = [...metadataLines, headers.join(','), ...dataLines].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `university_spikes_${selectedDatasetId}_thresh_${spikeThreshold}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8 pb-16">
      {/* ── Page Header ── */}
      <PageHeader
        title="University Network Analytics"
        subtitle="Historical network telemetry from the faculty-supplied university datasets (Core Switch & Firewall traffic captures)."
        badge="Phase 3: Spike Analysis"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                loadDatasetData(selectedDatasetId, true);
                loadSpikesData(selectedDatasetId, spikeThreshold);
              }}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium rounded-md bg-[#191919] border border-[#292929] hover:border-[#383838] text-[#A3A3A3] hover:text-[#F5F5F5] transition-all disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-[#FF6A00]' : ''}`} />
              {isRefreshing ? 'Refreshing...' : 'Refresh Telemetry'}
            </button>
            <div className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono rounded border border-[rgba(255,106,0,0.3)] bg-[rgba(255,106,0,0.08)] text-[#FF6A00]">
              <Database className="h-3 w-3" />
              <span>Historical Telemetry</span>
            </div>
          </div>
        }
      />

      {/* ── Dataset Selector Tabs ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-2 rounded-xl bg-[#141414] border border-[#292929]">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => handleSelectDataset('firewall')}
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-lg text-xs font-mono font-medium transition-all ${
              selectedDatasetId === 'firewall'
                ? 'bg-[rgba(255,106,0,0.12)] text-[#FF6A00] border border-[rgba(255,106,0,0.4)] shadow-sm'
                : 'text-[#A3A3A3] hover:text-[#F5F5F5] hover:bg-[#191919] border border-transparent'
            }`}
          >
            <Network className="h-4 w-4" />
            <span>Firewall Traffic</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#101010] text-[#737373] border border-[#292929]">
              50 Series
            </span>
          </button>

          <button
            onClick={() => handleSelectDataset('core_switch')}
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-lg text-xs font-mono font-medium transition-all ${
              selectedDatasetId === 'core_switch'
                ? 'bg-[rgba(255,106,0,0.12)] text-[#FF6A00] border border-[rgba(255,106,0,0.4)] shadow-sm'
                : 'text-[#A3A3A3] hover:text-[#F5F5F5] hover:bg-[#191919] border border-transparent'
            }`}
          >
            <Layers className="h-4 w-4" />
            <span>Core Switch Traffic</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#101010] text-[#737373] border border-[#292929]">
              194 Series
            </span>
          </button>
        </div>

        {/* Informative Caveat Banner */}
        <div className="flex items-center gap-2 text-xs font-mono text-[#A3A3A3] px-3 py-1.5 rounded-lg bg-[#101010] border border-[#292929] w-full sm:w-auto">
          <HelpCircle className="h-3.5 w-3.5 text-[#FF6A00] shrink-0" />
          <span className="truncate">Physical units: unconfirmed | Timezone: Asia/Kolkata (IST)</span>
        </div>
      </div>

      {/* ── Error Banner if any ── */}
      {errorMessage && (
        <div className="rounded-xl border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.08)] p-4 text-xs font-mono text-[#ef4444] flex items-start gap-3">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold mb-1">Failed to load university telemetry dataset</p>
            <p className="text-[#A3A3A3]">{errorMessage}</p>
          </div>
          <button
            onClick={() => loadDatasetData(selectedDatasetId)}
            className="px-2.5 py-1 rounded border border-[rgba(239,68,68,0.3)] hover:bg-[rgba(239,68,68,0.15)] transition-all shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Top Summary Cards ── */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="h-28 rounded-lg bg-[#141414] border border-[#292929] animate-pulse p-4 flex flex-col justify-between"
            >
              <div className="h-3 w-20 bg-[#292929] rounded" />
              <div className="h-7 w-28 bg-[#292929] rounded" />
              <div className="h-2.5 w-32 bg-[#292929] rounded" />
            </div>
          ))}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <MetricCard
            label="Valid Observations"
            value={summary.valid_timestamp_count}
            badge="Non-NaN"
            badgeVariant="success"
            helper="113 total rows in file (excludes 2 empty boundary NaN rows)"
            icon={Check}
          />

          <MetricCard
            label="Measurement Series"
            value={summary.measurement_series_count}
            badge={`${summary.data_quality.duplicate_headers_count} Rx + ${summary.data_quality.blank_headers_count} Blank`}
            badgeVariant="neutral"
            helper="All columns preserved with stable column display IDs"
            icon={Layers}
          />

          <MetricCard
            label="Active Telemetry"
            value={`${summary.active_series_count} / ${summary.measurement_series_count}`}
            badge={summary.active_series_count > 0 ? 'Non-Zero' : 'Idle'}
            badgeVariant="accent"
            helper={`${summary.zero_series_count} series remain 0.0 throughout week`}
            icon={Activity}
          />

          <MetricCard
            label="Sampling Interval"
            value="90 min"
            badge="Regular"
            badgeVariant="success"
            helper="5,400s consecutive delta (detected from timestamps)"
            icon={Clock}
          />

          <MetricCard
            label="Data Coverage"
            value="7.0 Days"
            badge="Oct 17 - 24"
            badgeVariant="neutral"
            helper="168 hours total window (165h valid measurement span)"
            icon={Calendar}
          />

          <MetricCard
            label="Peak Telemetry"
            value={formatMetricValue(summary.peak_measurement.signed_value)}
            badge={summary.peak_measurement.series_display_name}
            badgeVariant="warning"
            highlight={true}
            helper={`|x| = ${formatScientific(summary.peak_measurement.abs_value)} at ${formatKolkataTime(summary.peak_measurement.timestamp)}`}
            icon={Zap}
          />
        </div>
      ) : null}

      {/* ── Main Visualization & Series Selector Section ── */}
      <div
        id="historical-chart-container"
        className="rounded-xl bg-[#141414] border border-[#292929] p-5 sm:p-6 space-y-6"
      >
        {/* Visualization Controls Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[#292929]">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="font-heading text-lg sm:text-xl font-bold tracking-tight text-[#F5F5F5]">
                Historical Traffic Observation Chart
              </h2>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-[#191919] text-[#FF6A00] border border-[#292929]">
                {selectedSeriesIds.length} Series Plotted
              </span>
              {showSpikeMarkersOnChart && (
                <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-[rgba(239,68,68,0.15)] text-[#ef4444] border border-[rgba(239,68,68,0.3)] font-semibold flex items-center gap-1">
                  <Flame className="h-3 w-3" /> Spike Markers On
                </span>
              )}
            </div>
            <p className="text-xs text-[#737373]">
              Comparing selected telemetry channels over the 7-day observation window. Timestamps shown in Asia/Kolkata (IST).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Toggle Spike Markers on Chart */}
            <button
              onClick={() => setShowSpikeMarkersOnChart(!showSpikeMarkersOnChart)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium border transition-all ${
                showSpikeMarkersOnChart
                  ? 'bg-[rgba(239,68,68,0.15)] text-[#ef4444] border-[rgba(239,68,68,0.4)]'
                  : 'bg-[#191919] text-[#737373] border-[#292929] hover:text-[#A3A3A3]'
              }`}
              title="Show or hide detected spike candidates as markers on the chart"
            >
              <Target className="h-3.5 w-3.5" />
              <span>{showSpikeMarkersOnChart ? 'Hide Spike Markers' : 'Show Spike Markers'}</span>
            </button>

            {/* Absolute Magnitude Toggle */}
            <button
              onClick={() => setUseAbsoluteMagnitude(!useAbsoluteMagnitude)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono font-medium border transition-all ${
                useAbsoluteMagnitude
                  ? 'bg-[rgba(255,106,0,0.15)] text-[#FF6A00] border-[rgba(255,106,0,0.4)]'
                  : 'bg-[#191919] text-[#A3A3A3] border-[#292929] hover:border-[#383838]'
              }`}
              title="Toggle between raw signed numbers and absolute values (|x|)"
            >
              <Sliders className="h-3.5 w-3.5" />
              <span>{useAbsoluteMagnitude ? 'Magnitude View (|x|)' : 'Raw Signed View (±)'}</span>
            </button>

            {/* Time Range Presets */}
            <div className="inline-flex rounded-lg bg-[#101010] p-0.5 border border-[#292929] text-xs font-mono">
              <button
                onClick={() => setTimeRangePreset('all')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  timeRangePreset === 'all'
                    ? 'bg-[#292929] text-[#F5F5F5] font-semibold'
                    : 'text-[#737373] hover:text-[#A3A3A3]'
                }`}
              >
                Full Week
              </button>
              <button
                onClick={() => setTimeRangePreset('early')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  timeRangePreset === 'early'
                    ? 'bg-[#292929] text-[#F5F5F5] font-semibold'
                    : 'text-[#737373] hover:text-[#A3A3A3]'
                }`}
              >
                Oct 17-20
              </button>
              <button
                onClick={() => setTimeRangePreset('late')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  timeRangePreset === 'late'
                    ? 'bg-[#292929] text-[#F5F5F5] font-semibold'
                    : 'text-[#737373] hover:text-[#A3A3A3]'
                }`}
              >
                Oct 21-24
              </button>
              <button
                onClick={() => setTimeRangePreset('peak')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  timeRangePreset === 'peak'
                    ? 'bg-[#292929] text-[#F5F5F5] font-semibold'
                    : 'text-[#737373] hover:text-[#A3A3A3]'
                }`}
              >
                Peak Window
              </button>
            </div>
          </div>
        </div>

        {/* Absolute Magnitude Visualization Warning Pill */}
        {useAbsoluteMagnitude && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[rgba(255,106,0,0.08)] border border-[rgba(255,106,0,0.25)] text-xs font-mono text-[#FF6A00]">
            <Info className="h-4 w-4 shrink-0" />
            <span>
              Visualization transform only: Plotting absolute magnitudes (|x|). Raw dataset preserves negative values in blank-header columns.
            </span>
          </div>
        )}

        {/* ── Recharts Chart Container ── */}
        <div className="h-[360px] sm:h-[420px] w-full">
          {chartPoints.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <EmptyState
                icon={BarChart3}
                title="No Telemetry Series Selected"
                description="Select one or more measurement series from the selector below to visualize traffic observations."
                action={
                  <button
                    onClick={handleSelectTopActive}
                    className="px-3 py-1.5 rounded-md bg-[#FF6A00] text-black text-xs font-mono font-semibold"
                  >
                    Select Top Active Series
                  </button>
                }
              />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartPoints}
                margin={{ top: 10, right: 20, left: 10, bottom: 25 }}
              >
                <CartesianGrid stroke="#292929" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="formattedTime"
                  stroke="#737373"
                  tick={{ fill: '#737373', fontSize: 11, fontFamily: 'monospace' }}
                  tickLine={{ stroke: '#292929' }}
                  axisLine={{ stroke: '#292929' }}
                  interval="preserveStartEnd"
                  dy={10}
                />
                <YAxis
                  stroke="#737373"
                  tick={{ fill: '#737373', fontSize: 11, fontFamily: 'monospace' }}
                  tickLine={{ stroke: '#292929' }}
                  axisLine={{ stroke: '#292929' }}
                  tickFormatter={formatMetricValue}
                  dx={-10}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload || !payload.length) return null;
                    const pointData = payload[0]?.payload;
                    return (
                      <div className="rounded-lg bg-[#101010] border border-[#292929] shadow-xl p-3 min-w-[260px] text-xs font-mono space-y-2">
                        <div className="border-b border-[#292929] pb-1.5">
                          <p className="text-[#F5F5F5] font-bold">{label}</p>
                          <p className="text-[10px] text-[#737373]">
                            UTC: {pointData?.datetime?.slice(0, 19).replace('T', ' ')}Z
                          </p>
                        </div>
                        <div className="space-y-1.5">
                          {payload.map((item) => {
                            const sId = item.dataKey as string;
                            const meta = seriesMetaMap[sId];
                            const rawVal = pointData ? pointData[sId] : null;
                            const color = seriesColorMap[sId] || item.color;
                            const spike = spikeLookupMap[`${sId}_${pointData?.timestamp}`];

                            return (
                              <div key={sId} className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-1.5 truncate max-w-[160px]">
                                  <span
                                    className="h-2.5 w-2.5 rounded-full shrink-0"
                                    style={{ backgroundColor: color }}
                                  />
                                  <span className="text-[#A3A3A3] truncate">
                                    {meta?.display_name || sId}
                                  </span>
                                </div>
                                <div className="text-right">
                                  <span className="font-bold text-[#F5F5F5]">
                                    {rawVal !== null ? formatMetricValue(rawVal) : 'NaN'}
                                  </span>
                                  {spike && (
                                    <span className="ml-1.5 text-[9px] px-1 py-0.2 rounded bg-[rgba(239,68,68,0.2)] text-[#ef4444] border border-[rgba(239,68,68,0.3)] font-semibold">
                                      Spike (Z={spike.anomaly_score.toFixed(1)})
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="pt-1 border-t border-[#292929] text-[10px] text-[#737373]">
                          Units unconfirmed by source exports
                        </div>
                      </div>
                    );
                  }}
                />
                <Legend
                  verticalAlign="top"
                  align="right"
                  height={30}
                  wrapperStyle={{ paddingBottom: '10px', fontSize: '11px', fontFamily: 'monospace' }}
                  formatter={(value) => {
                    const meta = seriesMetaMap[value];
                    return (
                      <span className="text-[#A3A3A3] hover:text-[#F5F5F5] transition-colors">
                        {meta?.display_name || value}
                      </span>
                    );
                  }}
                />
                {selectedSeriesIds.map((sId) => (
                  <Line
                    key={sId}
                    type="monotone"
                    dataKey={sId}
                    name={sId}
                    stroke={seriesColorMap[sId] || '#FF6A00'}
                    strokeWidth={2}
                    dot={(props: unknown) => {
                      if (!showSpikeMarkersOnChart) return false;
                      const dotProps = props as { cx?: number; cy?: number; payload?: { timestamp?: number } };
                      const { cx, cy, payload } = dotProps;
                      if (!cx || !cy || !payload || !payload.timestamp) return false;
                      const spike = spikeLookupMap[`${sId}_${payload.timestamp}`];
                      if (!spike) return false;

                      const isFocused = focusedSpikeTimestamp === payload.timestamp;

                      return (
                        <svg key={`spike-dot-${sId}-${payload.timestamp}`} overflow="visible">
                          <circle
                            cx={cx}
                            cy={cy}
                            r={isFocused ? 7 : 5}
                            fill="#ef4444"
                            stroke="#ffffff"
                            strokeWidth={isFocused ? 2 : 1.5}
                          />
                          <circle
                            cx={cx}
                            cy={cy}
                            r={isFocused ? 12 : 9}
                            fill="none"
                            stroke="#ef4444"
                            strokeWidth={1.5}
                            strokeDasharray="2 2"
                            opacity={0.8}
                          />
                        </svg>
                      );
                    }}
                    activeDot={{ r: 5, strokeWidth: 0, fill: seriesColorMap[sId] || '#FF6A00' }}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* ── Compact Series Selector Sub-Panel ── */}
        <div className="rounded-lg bg-[#101010] border border-[#292929] p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-semibold text-[#F5F5F5] uppercase tracking-wider">
                Series Selection
              </span>
              <span className="text-[11px] font-mono text-[#A3A3A3]">
                ({selectedSeriesIds.length} active of {timeSeriesResponse?.series_metadata?.length || 0})
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono">
              <button
                onClick={handleSelectTopActive}
                className="px-2.5 py-1 rounded bg-[#191919] border border-[#292929] hover:border-[#383838] text-[#A3A3A3] hover:text-[#F5F5F5] transition-all"
              >
                Top Active
              </button>
              <button
                onClick={handleSelectInboundSample}
                className="px-2.5 py-1 rounded bg-[#191919] border border-[#292929] hover:border-[#383838] text-[#A3A3A3] hover:text-[#F5F5F5] transition-all"
              >
                Inbound (Rx) Sample
              </button>
              <button
                onClick={handleSelectOutboundSample}
                className="px-2.5 py-1 rounded bg-[#191919] border border-[#292929] hover:border-[#383838] text-[#A3A3A3] hover:text-[#F5F5F5] transition-all"
              >
                Outbound (Blank) Sample
              </button>
              <button
                onClick={() => setSelectedSeriesIds([selectedSeriesIds[0] || 'series_001'])}
                className="px-2 py-1 rounded text-[#737373] hover:text-[#A3A3A3] transition-all"
              >
                Reset
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[#737373]" />
              <input
                type="text"
                placeholder="Search series ID or display label..."
                value={selectorSearch}
                onChange={(e) => setSelectorSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs font-mono rounded-md bg-[#141414] border border-[#292929] focus:border-[#FF6A00] focus:outline-none text-[#F5F5F5] placeholder-[#737373]"
              />
            </div>

            <div className="inline-flex rounded-md bg-[#141414] p-0.5 border border-[#292929] text-xs font-mono shrink-0">
              <button
                onClick={() => setActiveGroupFilter('all')}
                className={`px-2.5 py-1 rounded transition-all ${
                  activeGroupFilter === 'all'
                    ? 'bg-[#292929] text-[#F5F5F5] font-semibold'
                    : 'text-[#737373] hover:text-[#A3A3A3]'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setActiveGroupFilter('rx')}
                className={`px-2.5 py-1 rounded transition-all ${
                  activeGroupFilter === 'rx'
                    ? 'bg-[#292929] text-[#F5F5F5] font-semibold'
                    : 'text-[#737373] hover:text-[#A3A3A3]'
                }`}
              >
                Rx Header Group
              </button>
              <button
                onClick={() => setActiveGroupFilter('blank')}
                className={`px-2.5 py-1 rounded transition-all ${
                  activeGroupFilter === 'blank'
                    ? 'bg-[#292929] text-[#F5F5F5] font-semibold'
                    : 'text-[#737373] hover:text-[#A3A3A3]'
                }`}
              >
                Blank Header Group
              </button>
            </div>
          </div>

          <div className="max-h-48 overflow-y-auto pr-1 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 pt-1">
            {selectorSeriesList.map((meta) => {
              const isSelected = selectedSeriesIds.includes(meta.series_id);
              const color = seriesColorMap[meta.series_id];
              const stats = seriesStatsMap[meta.series_id];
              const isZero = stats?.is_all_zero ?? false;

              return (
                <button
                  key={meta.series_id}
                  onClick={() => toggleSeriesSelection(meta.series_id)}
                  className={`flex items-center justify-between p-2 rounded text-left text-xs font-mono border transition-all ${
                    isSelected
                      ? 'border-[#FF6A00] bg-[rgba(255,106,0,0.08)] text-[#F5F5F5]'
                      : 'border-[#292929] bg-[#141414] text-[#A3A3A3] hover:border-[#383838]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <span
                      className={`h-2 w-2 rounded-full shrink-0 ${
                        isSelected ? '' : isZero ? 'bg-[#383838]' : 'bg-[#22c55e]'
                      }`}
                      style={isSelected && color ? { backgroundColor: color } : {}}
                    />
                    <div className="truncate">
                      <p className="truncate font-medium">{meta.series_id}</p>
                      <p className="text-[10px] text-[#737373] truncate">
                        {meta.is_blank_header ? 'Blank' : 'Rx'}
                      </p>
                    </div>
                  </div>

                  <span className="text-[10px] text-[#737373] shrink-0 font-mono">
                    {stats?.abs_peak_value ? formatMetricValue(stats.abs_peak_value) : '0'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Phase 3: Historical Traffic-Spike Analysis Section ── */}
      <div className="rounded-xl bg-[#141414] border border-[#292929] p-5 sm:p-6 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[#292929]">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <Flame className="h-5 w-5 text-[#FF6A00]" />
              <h2 className="font-heading text-lg sm:text-xl font-bold tracking-tight text-[#F5F5F5]">
                Historical Traffic-Spike Analysis
              </h2>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-[rgba(255,106,0,0.1)] text-[#FF6A00] border border-[rgba(255,106,0,0.25)] font-semibold">
                Robust MAD Engine
              </span>
            </div>
            <p className="text-xs text-[#737373] max-w-3xl">
              Statistical anomaly detection evaluating deviations from each channel&apos;s robust median baseline using
              Median Absolute Deviation (MAD) with IQR scale fallback.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* CSV Export Button */}
            <button
              onClick={handleExportSpikesCsv}
              disabled={!filteredSpikeCandidates.length}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium bg-[#191919] border border-[#292929] hover:border-[#383838] text-[#F5F5F5] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title="Download currently filtered spike candidates as CSV"
            >
              <Download className="h-3.5 w-3.5 text-[#FF6A00]" />
              <span>Export Candidates (CSV)</span>
            </button>
          </div>
        </div>

        {/* Statistical Candidate Disclaimer */}
        <div className="rounded-lg bg-[rgba(255,106,0,0.06)] border border-[rgba(255,106,0,0.25)] p-3.5 text-xs font-mono text-[#A3A3A3] flex items-start gap-2.5">
          <Info className="h-4 w-4 text-[#FF6A00] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-[#F5F5F5] font-semibold">
              Statistical Anomaly Candidates — Not Confirmed Security Attacks
            </p>
            <p className="text-[11px] leading-relaxed text-[#A3A3A3]">
              These results represent observations that deviate significantly from historical baselines under robust
              MAD scoring. Spikes can stem from legitimate campus activities (e.g. software updates, high-definition video
              lectures, automated backups, research data transfers) or operational anomalies.
            </p>
          </div>
        </div>

        {/* Spike Summary Metrics */}
        {spikesResponse && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard
              label="Spike Candidates"
              value={spikesResponse.total_candidates}
              badge={`Z ≥ ${spikeThreshold}`}
              badgeVariant="accent"
              helper={`Identified across ${spikesResponse.total_observations_analyzed} observation windows`}
              icon={Target}
            />

            <MetricCard
              label="Affected Series"
              value={`${spikesResponse.affected_series_count} / ${spikesResponse.total_series_analyzed}`}
              badge="Channels"
              badgeVariant="neutral"
              helper="Channels with at least one observation exceeding threshold"
              icon={Layers}
            />

            <MetricCard
              label="Peak Anomaly Score"
              value={spikesResponse.largest_candidate ? spikesResponse.largest_candidate.anomaly_score.toFixed(1) : '—'}
              badge={spikesResponse.largest_candidate?.detection_method === 'modified_z_score_mad' ? 'MAD' : 'IQR'}
              badgeVariant="warning"
              helper={`Max deviation: +${spikesResponse.largest_candidate ? formatMetricValue(spikesResponse.largest_candidate.deviation) : '—'} above baseline`}
              icon={Zap}
            />

            <MetricCard
              label="Largest Spike Event"
              value={spikesResponse.largest_candidate ? formatMetricValue(spikesResponse.largest_candidate.signed_value) : '—'}
              badge={spikesResponse.largest_candidate?.series_display_name || 'None'}
              badgeVariant="neutral"
              helper={spikesResponse.largest_candidate ? formatKolkataTime(spikesResponse.largest_candidate.timestamp) : 'No candidates'}
              icon={Clock}
            />
          </div>
        )}

        {/* Practical Analysis Controls Bar */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-3.5 rounded-lg bg-[#101010] border border-[#292929]">
          <div className="flex flex-wrap items-center gap-3">
            {/* Threshold Presets */}
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="text-[#A3A3A3] font-medium">Threshold (Z):</span>
              <div className="inline-flex rounded-md bg-[#141414] p-0.5 border border-[#292929]">
                {[2.5, 3.5, 5.0, 7.0, 10.0].map((t) => (
                  <button
                    key={t}
                    onClick={() => setSpikeThreshold(t)}
                    className={`px-2 py-0.5 rounded text-[11px] transition-all ${
                      spikeThreshold === t
                        ? 'bg-[#FF6A00] text-black font-bold'
                        : 'text-[#A3A3A3] hover:text-[#F5F5F5]'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Threshold Input */}
            <div className="flex items-center gap-1.5 text-xs font-mono">
              <span className="text-[#737373]">Custom:</span>
              <input
                type="number"
                step="0.5"
                min="1.0"
                max="50.0"
                value={spikeThreshold}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val) && val >= 1.0) setSpikeThreshold(val);
                }}
                className="w-16 px-2 py-1 rounded bg-[#141414] border border-[#292929] text-xs font-mono text-[#F5F5F5] focus:outline-none focus:border-[#FF6A00]"
              />
            </div>

            {/* Filter Plotted Only Toggle */}
            <button
              onClick={() => setSpikeFilterPlottedOnly(!spikeFilterPlottedOnly)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono border transition-all ${
                spikeFilterPlottedOnly
                  ? 'bg-[rgba(255,106,0,0.12)] text-[#FF6A00] border-[rgba(255,106,0,0.3)]'
                  : 'bg-[#141414] text-[#737373] border-[#292929] hover:text-[#A3A3A3]'
              }`}
            >
              <Filter className="h-3 w-3" />
              <span>{spikeFilterPlottedOnly ? 'Plotted Channels Only' : 'All Analyzed Channels'}</span>
            </button>
          </div>

          {/* Spike Table Search */}
          <div className="relative w-full md:w-56">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[#737373]" />
            <input
              type="text"
              placeholder="Search spike candidates..."
              value={spikeTableSearch}
              onChange={(e) => {
                setSpikeTableSearch(e.target.value);
                setSpikeTablePage(1);
              }}
              className="w-full pl-8 pr-3 py-1.5 text-xs font-mono rounded-md bg-[#141414] border border-[#292929] focus:border-[#FF6A00] focus:outline-none text-[#F5F5F5] placeholder-[#737373]"
            />
          </div>
        </div>

        {/* ── Spike Candidates Results Table ── */}
        <div className="overflow-x-auto rounded-lg border border-[#292929]">
          <table className="w-full text-left text-xs font-mono border-collapse">
            <thead className="bg-[#101010] text-[#A3A3A3] uppercase text-[10px] tracking-wider border-b border-[#292929]">
              <tr>
                <th className="py-2.5 px-3 w-14 text-center">Inspect</th>
                <th
                  onClick={() => handleSortSpikes('timestamp')}
                  className="py-2.5 px-3 cursor-pointer hover:text-[#F5F5F5] transition-colors select-none"
                  title="Sort by Timestamp"
                >
                  <div className="flex items-center gap-1">
                    <span>Timestamp (IST)</span>
                    <ArrowUpDown className={`h-3 w-3 ${spikeSortBy === 'timestamp' ? 'text-[#FF6A00]' : 'opacity-40'}`} />
                  </div>
                </th>
                <th className="py-2.5 px-3">Series ID</th>
                <th className="py-2.5 px-3">Display Name</th>
                <th className="py-2.5 px-3 text-right">Signed Telemetry</th>
                <th
                  onClick={() => handleSortSpikes('magnitude')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-[#F5F5F5] transition-colors select-none"
                  title="Sort by Magnitude"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Magnitude (|x|)</span>
                    <ArrowUpDown className={`h-3 w-3 ${spikeSortBy === 'magnitude' ? 'text-[#FF6A00]' : 'opacity-40'}`} />
                  </div>
                </th>
                <th className="py-2.5 px-3 text-right">Median Baseline</th>
                <th className="py-2.5 px-3 text-right">Deviation</th>
                <th
                  onClick={() => handleSortSpikes('score')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-[#F5F5F5] transition-colors select-none"
                  title="Sort by Anomaly Score"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Anomaly Score (Z)</span>
                    <ArrowUpDown className={`h-3 w-3 ${spikeSortBy === 'score' ? 'text-[#FF6A00]' : 'opacity-40'}`} />
                  </div>
                </th>
                <th className="py-2.5 px-3 text-center">Method</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#292929] bg-[#141414]">
              {paginatedSpikeCandidates.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-[#737373]">
                    {isAnalyzingSpikes ? (
                      <div className="flex items-center justify-center gap-2">
                        <RefreshCw className="h-4 w-4 animate-spin text-[#FF6A00]" />
                        <span>Evaluating robust statistical baseline...</span>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <p>No traffic-spike candidates exceed the threshold of {spikeThreshold}.</p>
                        <p className="text-[11px] text-[#525252]">
                          Try adjusting the threshold to 2.5 to inspect milder statistical variations.
                        </p>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                paginatedSpikeCandidates.map((c, idx) => {
                  const isPlotted = selectedSeriesIds.includes(c.series_id);
                  const color = seriesColorMap[c.series_id];
                  const isFocused = focusedSpikeTimestamp === c.timestamp;

                  return (
                    <tr
                      key={`${c.series_id}_${c.timestamp}_${idx}`}
                      className={`hover:bg-[#191919] transition-colors ${
                        isFocused ? 'bg-[rgba(239,68,68,0.08)]' : isPlotted ? 'bg-[rgba(255,106,0,0.03)]' : ''
                      }`}
                    >
                      <td className="py-2 px-3 text-center">
                        <button
                          onClick={() => handleInspectSpikeOnChart(c)}
                          className={`p-1 rounded border transition-all ${
                            isFocused
                              ? 'border-[#ef4444] text-[#ef4444] bg-[rgba(239,68,68,0.2)]'
                              : 'border-[#292929] text-[#737373] hover:text-[#FF6A00] hover:border-[#FF6A00]'
                          }`}
                          title="Plot this series and focus timestamp on chart"
                        >
                          <Target className="h-3.5 w-3.5" />
                        </button>
                      </td>

                      <td className="py-2 px-3 font-semibold text-[#F5F5F5] whitespace-nowrap">
                        {formatKolkataTime(c.timestamp)}
                      </td>

                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1.5">
                          {isPlotted && color && (
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: color }}
                            />
                          )}
                          <span className="font-semibold text-[#F5F5F5]">{c.series_id}</span>
                        </div>
                      </td>

                      <td className="py-2 px-3 text-[#A3A3A3] max-w-[140px] truncate">
                        {c.series_display_name}
                      </td>

                      <td className="py-2 px-3 text-right text-[#A3A3A3]">
                        {formatMetricValue(c.signed_value)}
                      </td>

                      <td className="py-2 px-3 text-right font-medium text-[#F5F5F5]">
                        {formatMetricValue(c.abs_value)}
                      </td>

                      <td className="py-2 px-3 text-right text-[#737373]">
                        {formatMetricValue(c.baseline_value)}
                      </td>

                      <td className="py-2 px-3 text-right text-[#A3A3A3]">
                        +{formatMetricValue(c.deviation)}
                      </td>

                      <td className="py-2 px-3 text-right font-bold text-[#FF6A00]">
                        {c.anomaly_score.toFixed(2)}
                      </td>

                      <td className="py-2 px-3 text-center">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] border ${
                            c.detection_method === 'modified_z_score_mad'
                              ? 'bg-[rgba(255,106,0,0.1)] text-[#FF6A00] border-[rgba(255,106,0,0.25)]'
                              : 'bg-[rgba(6,182,212,0.1)] text-[#06b6d4] border-[rgba(6,182,212,0.25)]'
                          }`}
                        >
                          {c.detection_method === 'modified_z_score_mad' ? 'MAD' : 'IQR'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Spike Table Pagination */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono text-[#737373] pt-1">
          <div>
            Showing {(spikeTablePage - 1) * spikeTablePageSize + 1} to{' '}
            {Math.min(spikeTablePage * spikeTablePageSize, filteredSpikeCandidates.length)} of{' '}
            {filteredSpikeCandidates.length} spike candidates
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setSpikeTablePage((p) => Math.max(1, p - 1))}
              disabled={spikeTablePage === 1}
              className="px-2.5 py-1 rounded bg-[#101010] border border-[#292929] hover:border-[#383838] text-[#A3A3A3] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="px-2">
              Page {spikeTablePage} of {totalSpikeTablePages}
            </span>
            <button
              onClick={() => setSpikeTablePage((p) => Math.min(totalSpikeTablePages, p + 1))}
              disabled={spikeTablePage === totalSpikeTablePages}
              className="px-2.5 py-1 rounded bg-[#101010] border border-[#292929] hover:border-[#383838] text-[#A3A3A3] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* ── Per-Series Statistics Table Section ── */}
      <div className="rounded-xl bg-[#141414] border border-[#292929] p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#292929]">
          <div>
            <h2 className="font-heading text-lg sm:text-xl font-bold tracking-tight text-[#F5F5F5]">
              Per-Series Telemetry Statistics Table
            </h2>
            <p className="text-xs text-[#737373]">
              Sortable mathematical metrics computed by backend across valid observation windows. Click Plot to toggle channels on chart.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => {
                setTableFilterActiveOnly(!tableFilterActiveOnly);
                setTablePage(1);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium border transition-all ${
                tableFilterActiveOnly
                  ? 'bg-[rgba(34,197,94,0.1)] text-[#22c55e] border-[rgba(34,197,94,0.3)]'
                  : 'bg-[#191919] text-[#A3A3A3] border-[#292929]'
              }`}
            >
              <Filter className="h-3.5 w-3.5" />
              <span>{tableFilterActiveOnly ? 'Active Only (Non-Zero)' : 'All Series (Inc. Zeros)'}</span>
            </button>

            <div className="relative w-48 sm:w-56">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[#737373]" />
              <input
                type="text"
                placeholder="Filter table rows..."
                value={tableSearch}
                onChange={(e) => {
                  setTableSearch(e.target.value);
                  setTablePage(1);
                }}
                className="w-full pl-8 pr-3 py-1.5 text-xs font-mono rounded-md bg-[#191919] border border-[#292929] focus:border-[#FF6A00] focus:outline-none text-[#F5F5F5] placeholder-[#737373]"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-[#292929]">
          <table className="w-full text-left text-xs font-mono border-collapse">
            <thead className="bg-[#101010] text-[#A3A3A3] uppercase text-[10px] tracking-wider border-b border-[#292929]">
              <tr>
                <th className="py-2.5 px-3 w-16 text-center">Plot</th>
                <th
                  onClick={() => handleTableSort('series_id')}
                  className="py-2.5 px-3 cursor-pointer hover:text-[#F5F5F5]"
                >
                  <div className="flex items-center gap-1">
                    <span>Series ID</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </th>
                <th className="py-2.5 px-3">Display Label</th>
                <th className="py-2.5 px-3">Source Header</th>
                <th className="py-2.5 px-3 text-right">Valid Obs</th>
                <th
                  onClick={() => handleTableSort('min_value')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-[#F5F5F5]"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Min Value</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </th>
                <th
                  onClick={() => handleTableSort('max_value')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-[#F5F5F5]"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Max Value</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </th>
                <th
                  onClick={() => handleTableSort('mean_value')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-[#F5F5F5]"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Mean</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </th>
                <th
                  onClick={() => handleTableSort('abs_peak_value')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-[#F5F5F5]"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Peak |x|</span>
                    <ArrowUpDown className="h-3 w-3 text-[#FF6A00]" />
                  </div>
                </th>
                <th className="py-2.5 px-3 text-right">Peak Time (IST)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#292929] bg-[#141414]">
              {paginatedTableSeries.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-[#737373]">
                    No series matched the filter criteria.
                  </td>
                </tr>
              ) : (
                paginatedTableSeries.map((s) => {
                  const isSelected = selectedSeriesIds.includes(s.series_id);
                  const color = seriesColorMap[s.series_id];

                  return (
                    <tr
                      key={s.series_id}
                      className={`hover:bg-[#191919] transition-colors ${
                        isSelected ? 'bg-[rgba(255,106,0,0.04)]' : ''
                      }`}
                    >
                      <td className="py-2 px-3 text-center">
                        <button
                          onClick={() => toggleSeriesSelection(s.series_id)}
                          className={`p-1 rounded border transition-all ${
                            isSelected
                              ? 'border-[#FF6A00] text-[#FF6A00] bg-[rgba(255,106,0,0.15)]'
                              : 'border-[#292929] text-[#737373] hover:text-[#F5F5F5]'
                          }`}
                          title={isSelected ? 'Remove from chart' : 'Add to chart'}
                        >
                          {isSelected ? (
                            <CheckSquare
                              className="h-3.5 w-3.5"
                              style={color ? { color } : {}}
                            />
                          ) : (
                            <Square className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </td>

                      <td className="py-2 px-3 font-semibold text-[#F5F5F5]">
                        <div className="flex items-center gap-1.5">
                          {isSelected && color && (
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: color }}
                            />
                          )}
                          <span>{s.series_id}</span>
                        </div>
                      </td>

                      <td className="py-2 px-3 text-[#A3A3A3] max-w-[140px] truncate">
                        {s.display_name}
                      </td>

                      <td className="py-2 px-3">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] border ${
                            s.original_header === 'Rx'
                              ? 'bg-[rgba(6,182,212,0.1)] text-[#06b6d4] border-[rgba(6,182,212,0.25)]'
                              : 'bg-[#191919] text-[#737373] border-[#292929]'
                          }`}
                        >
                          {s.original_header === '' ? '(blank)' : s.original_header}
                        </span>
                      </td>

                      <td className="py-2 px-3 text-right text-[#A3A3A3]">{s.valid_count}</td>

                      <td className="py-2 px-3 text-right text-[#A3A3A3]">
                        {s.min_value !== null ? formatMetricValue(s.min_value) : '—'}
                      </td>

                      <td className="py-2 px-3 text-right text-[#A3A3A3]">
                        {s.max_value !== null ? formatMetricValue(s.max_value) : '—'}
                      </td>

                      <td className="py-2 px-3 text-right text-[#A3A3A3]">
                        {s.mean_value !== null ? formatMetricValue(s.mean_value) : '—'}
                      </td>

                      <td className="py-2 px-3 text-right font-semibold text-[#F5F5F5]">
                        {s.abs_peak_value !== null ? formatMetricValue(s.abs_peak_value) : '—'}
                      </td>

                      <td className="py-2 px-3 text-right text-[11px] text-[#737373]">
                        {s.peak_timestamp ? formatKolkataTime(s.peak_timestamp) : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono text-[#737373] pt-2">
          <div>
            Showing {(tablePage - 1) * tablePageSize + 1} to{' '}
            {Math.min(tablePage * tablePageSize, tableSeriesList.length)} of{' '}
            {tableSeriesList.length} matching series
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setTablePage((p) => Math.max(1, p - 1))}
              disabled={tablePage === 1}
              className="px-2.5 py-1 rounded bg-[#101010] border border-[#292929] hover:border-[#383838] text-[#A3A3A3] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="px-2">
              Page {tablePage} of {totalTablePages}
            </span>
            <button
              onClick={() => setTablePage((p) => Math.min(totalTablePages, p + 1))}
              disabled={tablePage === totalTablePages}
              className="px-2.5 py-1 rounded bg-[#101010] border border-[#292929] hover:border-[#383838] text-[#A3A3A3] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* ── Data Quality & Interpretation Limitations Panel ── */}
      {summary && (
        <div className="rounded-xl border border-[rgba(255,106,0,0.3)] bg-[rgba(255,106,0,0.04)] p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2.5 border-b border-[rgba(255,106,0,0.2)] pb-3">
            <AlertTriangle className="h-5 w-5 text-[#FF6A00]" />
            <h3 className="font-heading text-base font-bold text-[#F5F5F5]">
              Data Quality & Source Telemetry Disclosures
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs font-mono">
            <div className="p-3.5 rounded-lg bg-[#141414] border border-[#292929] space-y-1.5">
              <span className="text-[#FF6A00] font-semibold flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" /> Empty Boundary Rows
              </span>
              <p className="text-[#A3A3A3] leading-relaxed">
                Rows 2 & 114 in source CSV contain exclusively NaN measurements and represent capture boundaries.
                These are flagged as boundary rows and excluded from traffic computations.
              </p>
            </div>

            <div className="p-3.5 rounded-lg bg-[#141414] border border-[#292929] space-y-1.5">
              <span className="text-[#FF6A00] font-semibold flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" /> Header Structure
              </span>
              <p className="text-[#A3A3A3] leading-relaxed">
                Dataset contains {summary.data_quality.duplicate_headers_count} repeated &apos;Rx&apos; column labels and{' '}
                {summary.data_quality.blank_headers_count} blank headers. Columns are preserved using stable positional
                identifiers.
              </p>
            </div>

            <div className="p-3.5 rounded-lg bg-[#141414] border border-[#292929] space-y-1.5">
              <span className="text-[#FF6A00] font-semibold flex items-center gap-1.5">
                <HelpCircle className="h-3.5 w-3.5" /> Unconfirmed Units
              </span>
              <p className="text-[#A3A3A3] leading-relaxed">
                Physical telemetry units (e.g. bps, bytes/sec, packet counters) are unconfirmed in raw export headers.
                Values are presented as recorded without speculative unit labels.
              </p>
            </div>

            <div className="p-3.5 rounded-lg bg-[#141414] border border-[#292929] space-y-1.5">
              <span className="text-[#FF6A00] font-semibold flex items-center gap-1.5">
                <Compass className="h-3.5 w-3.5" /> Directional Mapping
              </span>
              <p className="text-[#A3A3A3] leading-relaxed">
                &apos;Rx&apos; columns contain positive numbers; blank-header columns contain negative numbers. While conventional
                in MRTG/RRDtool for inbound vs outbound, this mapping remains unverified.
              </p>
            </div>

            <div className="p-3.5 rounded-lg bg-[#141414] border border-[#292929] space-y-1.5">
              <span className="text-[#FF6A00] font-semibold flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5" /> Sampling Cadence
              </span>
              <p className="text-[#A3A3A3] leading-relaxed">
                Observed interval is regular at exactly 5,400 seconds (90 minutes) per step across the entire 7-day
                observation window (October 17 - October 24, 2026).
              </p>
            </div>

            <div className="p-3.5 rounded-lg bg-[#141414] border border-[#292929] space-y-1.5">
              <span className="text-[#FF6A00] font-semibold flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5" /> Observation Integrity
              </span>
              <p className="text-[#A3A3A3] leading-relaxed">
                All 111 interior observation rows contain 100% complete finite measurements ({summary.data_quality.missing_percentage}%
                missing). No synthetic zero-fills were applied.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
