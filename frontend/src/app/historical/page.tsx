'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Clock,
  Database,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  History,
  Info,
  Layers,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Sliders,
  TrendingUp,
  Upload,
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
  HistoricalAnalysisResponse,
  HistoricalPreviewResponse,
  TrafficObservation,
} from '@/lib/types';
import { formatProbability } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import EmptyState from '@/components/ui/EmptyState';

export default function HistoricalReplayPage() {
  // Step 1: File Selection & Preview State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);
  const [previewData, setPreviewData] = useState<HistoricalPreviewResponse | null>(null);

  // Step 2: Column Selection & Mapping State
  const [timestampColumn, setTimestampColumn] = useState<string>('');
  const [labelColumn, setLabelColumn] = useState<string>('');
  const [benignLabelValue, setBenignLabelValue] = useState<string>('BENIGN');

  // Step 3: Analysis Parameters State
  const [windowSeconds, setWindowSeconds] = useState<number>(5.0);
  const [baselineMode, setBaselineMode] = useState<'ratio' | 'window_count' | 'timestamp_range'>('ratio');
  const [baselineRatio, setBaselineRatio] = useState<number>(0.3);
  const [baselineWindowCount, setBaselineWindowCount] = useState<number>(20);
  const [baselineStartTimestamp, setBaselineStartTimestamp] = useState<string>('');
  const [baselineEndTimestamp, setBaselineEndTimestamp] = useState<string>('');
  const [alpha, setAlpha] = useState<number>(0.01);

  // Step 4: Analysis Results State
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<HistoricalAnalysisResponse | null>(null);

  // Step 5: Interactive Replay & Inspection State
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [tableFilter, setTableFilter] = useState<'all' | 'alerts_only' | 'attack_only'>('all');
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // File drag-and-drop state
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  // Handle file selection
  const handleFileSelect = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setFileError('Unsupported file type. Historical analysis strictly requires .csv flow summaries. (Raw PCAP captures are planned for a future milestone).');
      setSelectedFile(null);
      setPreviewData(null);
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      setFileError(`File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds maximum permitted limit of 50 MB.`);
      setSelectedFile(null);
      setPreviewData(null);
      return;
    }

    setFileError(null);
    setSelectedFile(file);
    setPreviewData(null);
    setAnalysisResult(null);
    setAnalysisError(null);
    setCurrentIndex(0);
    setIsPlaying(false);
  };

  // Trigger CSV Preview
  const handlePreview = async () => {
    if (!selectedFile) return;

    setIsPreviewLoading(true);
    setFileError(null);

    try {
      const preview = await api.previewHistoricalDataset(selectedFile);
      setPreviewData(preview);

      // Auto-assign column suggestions
      if (preview.suggested_timestamp_column) {
        setTimestampColumn(preview.suggested_timestamp_column);
      } else if (preview.columns.length > 0) {
        setTimestampColumn(preview.columns[0]);
      }

      if (preview.suggested_label_column) {
        setLabelColumn(preview.suggested_label_column);
      } else {
        setLabelColumn('');
      }

      // Pre-fill benign value if "BENIGN" is present in sample
      const detectedBenign = preview.detected_label_values.find(
        (v) => v.toUpperCase() === 'BENIGN' || v.toUpperCase() === 'NORMAL'
      );
      if (detectedBenign) {
        setBenignLabelValue(detectedBenign);
      }
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : (err as Error).message;
      setFileError(msg || 'Failed to inspect CSV file.');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  // Run full Historical Analysis
  const handleRunAnalysis = async () => {
    if (!selectedFile || !timestampColumn) {
      setAnalysisError('Please upload a CSV file and specify a valid timestamp column.');
      return;
    }

    setIsAnalyzing(true);
    setAnalysisError(null);
    setIsPlaying(false);

    try {
      const result = await api.analyzeHistoricalDataset({
        file: selectedFile,
        timestamp_column: timestampColumn,
        label_column: labelColumn || undefined,
        benign_label_value: benignLabelValue || 'BENIGN',
        window_seconds: windowSeconds,
        baseline_mode: baselineMode,
        baseline_ratio: baselineMode === 'ratio' ? baselineRatio : undefined,
        baseline_window_count: baselineMode === 'window_count' ? baselineWindowCount : undefined,
        baseline_start_timestamp: baselineMode === 'timestamp_range' && baselineStartTimestamp ? baselineStartTimestamp : undefined,
        baseline_end_timestamp: baselineMode === 'timestamp_range' && baselineEndTimestamp ? baselineEndTimestamp : undefined,
        alpha,
      });

      setAnalysisResult(result);
      setCurrentIndex(0);
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : (err as Error).message;
      setAnalysisError(msg || 'Historical traffic analysis failed.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Replay playback loop
  useEffect(() => {
    if (isPlaying && analysisResult && analysisResult.observations.length > 0) {
      const intervalMs = Math.max(80, Math.floor(1000 / playbackSpeed));
      timerRef.current = setInterval(() => {
        setCurrentIndex((prev) => {
          if (prev >= analysisResult.observations.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, intervalMs);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isPlaying, playbackSpeed, analysisResult]);

  // Export results to CSV
  const handleExportCSV = useCallback(() => {
    if (!analysisResult) return;

    const headers = [
      '# PoissonBurst Lab - Historical Traffic Analysis Report',
      `# Source File: ${analysisResult.file_name}`,
      `# Measurement Type: ${analysisResult.measurement_type} (${analysisResult.measurement_unit_description})`,
      `# Observation Window Duration: ${analysisResult.window_seconds}s`,
      `# Baseline Lambda: ${analysisResult.lambda_window} flows/window (${analysisResult.baseline_rate_per_second} flows/s)`,
      `# Calibration Method: ${analysisResult.calibration_method}`,
      `# Significance Threshold Alpha: ${alpha}`,
      `# Total Processed Records: ${analysisResult.total_rows_processed} (Invalid/Discarded: ${analysisResult.invalid_rows})`,
      `# Total Windows: ${analysisResult.total_windows}`,
      `# Detected Bursts: ${analysisResult.detected_burst_count}`,
      `# Labeled Attack Bursts: ${analysisResult.labeled_burst_count ?? 'Unlabeled'}`,
      'window_index,timestamp,time_seconds,observed_flow_count,expected_baseline,p_value,alpha,is_burst_alert,ground_truth',
    ];

    const rows = analysisResult.observations.map((obs, idx) => {
      const det = analysisResult.detections[idx];
      return [
        idx,
        obs.timestamp,
        obs.time_seconds ?? (idx * analysisResult.window_seconds),
        obs.count,
        det?.expected_rate ?? analysisResult.lambda_window,
        det?.p_value !== undefined ? det.p_value.toExponential(6) : '',
        alpha,
        det?.is_burst ? 'TRUE' : 'FALSE',
        obs.ground_truth === null ? 'UNLABELED' : (obs.ground_truth ? 'ATTACK' : 'BENIGN'),
      ].join(',');
    });

    const csvContent = `${headers.join('\n')}\n${rows.join('\n')}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `historical_analysis_${analysisResult.file_name.replace(/\.[^/.]+$/, '')}_w${analysisResult.window_seconds}s.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [analysisResult, alpha]);

  // Chart data formatting
  const chartData = analysisResult?.observations.map((obs, idx) => {
    const det = analysisResult.detections[idx];
    return {
      windowIndex: idx,
      timestamp: obs.timestamp,
      displayTime: obs.timestamp.includes('T')
        ? obs.timestamp.split('T')[1].slice(0, 8)
        : (obs.time_seconds !== undefined ? `${obs.time_seconds}s` : `W#${idx}`),
      count: obs.count,
      baseline: det?.expected_rate ?? analysisResult.lambda_window,
      isBurst: det?.is_burst,
      groundTruth: obs.ground_truth,
      alertMarker: det?.is_burst ? obs.count : null,
      pValue: det?.p_value,
    };
  }) || [];

  // Filter observations for inspection table
  const filteredIndices = (analysisResult?.observations || [])
    .map((obs, idx) => ({ obs, det: analysisResult?.detections[idx], idx }))
    .filter(({ obs, det }) => {
      if (tableFilter === 'alerts_only') return det?.is_burst;
      if (tableFilter === 'attack_only') return obs.ground_truth === true;
      return true;
    });

  const activeObs: TrafficObservation | null =
    analysisResult && analysisResult.observations[currentIndex]
      ? analysisResult.observations[currentIndex]
      : null;

  const activeDet: DetectionResponse | null =
    analysisResult && analysisResult.detections[currentIndex]
      ? analysisResult.detections[currentIndex]
      : null;

  return (
    <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <PageHeader
        title="Historical Traffic Replay & Analysis"
        subtitle="Ingest historical network traffic CSV flow summaries (e.g. CICIDS2017), calibrate an unpolluted Poisson baseline, and detect burst anomalies using the authoritative SciPy upper-tail engine."
        badge="25CS203 Micro-Project"
        actions={
          analysisResult ? (
            <button
              type="button"
              onClick={handleExportCSV}
              className="btn-primary"
            >
              <Download className="h-4 w-4" />
              <span>Export Aggregated CSV</span>
            </button>
          ) : undefined
        }
      />

      {/* Measurement Semantics Banner */}
      <div className="rounded-lg border border-[rgba(255,106,0,0.3)] bg-[rgba(255,106,0,0.05)] p-4 text-xs">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-[#FF6A00] mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold text-[#F5F5F5]">
              Measurement Semantics: Network Flows per Observation Window (flow_count)
            </p>
            <p className="text-[#A3A3A3] leading-relaxed">
              CSV network flow summaries represent aggregated connection records, <strong className="text-[#F5F5F5]">not individual raw packets</strong>.
              The Poisson detector strictly receives expected flow arrivals per window (&lambda;<sub>w</sub>).
              Ground-truth flow labels indicate attack connection intent; they do not automatically guarantee volumetric traffic surges.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Controls (4 cols on lg, 4 cols on xl) */}
        <div className="lg:col-span-4 space-y-6">
          {/* Card 1: Upload Section */}
          <div className="rounded-lg border border-[#292929] bg-[#141414] p-5">
            <h2 className="font-heading text-sm font-semibold text-[#F5F5F5] flex items-center gap-2 pb-3 border-b border-[#292929]">
              <Upload className="h-4 w-4 text-[#FF6A00]" />
              <span>1. Dataset Upload (CSV)</span>
            </h2>

            <div className="mt-4">
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragOver(false);
                  if (e.dataTransfer.files?.[0]) {
                    handleFileSelect(e.dataTransfer.files[0]);
                  }
                }}
                className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-all ${
                  isDragOver
                    ? 'border-[#FF6A00] bg-[rgba(255,106,0,0.08)]'
                    : 'border-[#292929] bg-[#101010] hover:border-[#383838] hover:bg-[#141414]'
                }`}
              >
                <FileSpreadsheet className="h-8 w-8 text-[#FF6A00] mb-2" />
                <span className="text-xs font-medium text-[#F5F5F5]">
                  {selectedFile ? selectedFile.name : 'Choose or drag & drop a .csv file'}
                </span>
                <span className="text-[11px] text-[#737373] mt-1 font-mono">
                  {selectedFile
                    ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB`
                    : 'Network flow summaries (up to 50 MB)'}
                </span>
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => {
                    if (e.target.files?.[0]) {
                      handleFileSelect(e.target.files[0]);
                    }
                  }}
                  className="hidden"
                />
              </label>

              {fileError && (
                <div className="mt-3 flex items-start gap-2 rounded border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.08)] p-2.5 text-[11px] text-red-300">
                  <XCircle className="h-4 w-4 shrink-0 text-[#ef4444] mt-0.5" />
                  <span>{fileError}</span>
                </div>
              )}

              {selectedFile && !previewData && (
                <button
                  type="button"
                  onClick={handlePreview}
                  disabled={isPreviewLoading}
                  className="mt-3 w-full btn-primary justify-center"
                >
                  {isPreviewLoading ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      <span>Inspecting CSV Columns...</span>
                    </>
                  ) : (
                    <>
                      <Eye className="h-3.5 w-3.5" />
                      <span>Inspect &amp; Preview CSV</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Card 2: Column Selection & Mapping */}
          {previewData && (
            <div className="rounded-lg border border-[#292929] bg-[#141414] p-5 space-y-4">
              <h2 className="font-heading text-sm font-semibold text-[#F5F5F5] flex items-center gap-2 pb-3 border-b border-[#292929]">
                <FileText className="h-4 w-4 text-[#FF6A00]" />
                <span>2. Column Mapping</span>
              </h2>

              <div className="space-y-3.5 text-xs">
                {/* Timestamp Column */}
                <div>
                  <label className="block font-medium text-[#F5F5F5] mb-1">
                    Timestamp Column <span className="text-[#FF6A00]">*</span>
                  </label>
                  <select
                    value={timestampColumn}
                    onChange={(e) => setTimestampColumn(e.target.value)}
                    className="w-full rounded border border-[#292929] bg-[#101010] px-3 py-2 font-mono text-xs text-[#F5F5F5] focus:border-[#FF6A00] focus:outline-none"
                  >
                    {previewData.columns.map((col) => (
                      <option key={col} value={col}>
                        {col} {col === previewData.suggested_timestamp_column ? '(Suggested Timestamp)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Optional Label Column */}
                <div>
                  <label className="block font-medium text-[#F5F5F5] mb-1">
                    Ground-Truth Label Column <span className="text-[#737373] font-normal">(Optional)</span>
                  </label>
                  <select
                    value={labelColumn}
                    onChange={(e) => setLabelColumn(e.target.value)}
                    className="w-full rounded border border-[#292929] bg-[#101010] px-3 py-2 font-mono text-xs text-[#F5F5F5] focus:border-[#FF6A00] focus:outline-none"
                  >
                    <option value="">None / Unlabeled Dataset</option>
                    {previewData.columns.map((col) => (
                      <option key={col} value={col}>
                        {col} {col === previewData.suggested_label_column ? '(Suggested Label)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Benign Label Value (if label column selected) */}
                {labelColumn && (
                  <div>
                    <label className="block font-medium text-[#F5F5F5] mb-1">
                      Benign / Normal Label Value
                    </label>
                    <input
                      type="text"
                      value={benignLabelValue}
                      onChange={(e) => setBenignLabelValue(e.target.value)}
                      placeholder="e.g. BENIGN, Normal"
                      className="w-full rounded border border-[#292929] bg-[#101010] px-3 py-2 font-mono text-xs text-[#F5F5F5] focus:border-[#FF6A00] focus:outline-none"
                    />
                    <p className="text-[10px] text-[#737373] mt-1">
                      Rows with labels other than this value will be marked as attack ground truth.
                    </p>
                  </div>
                )}

                {previewData.timestamp_diagnostics && (
                  <div className="rounded bg-[#101010] border border-[#292929] p-2.5 text-[11px] text-[#A3A3A3] font-mono leading-relaxed">
                    {previewData.timestamp_diagnostics}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Card 3: Calibration & Window Settings */}
          {previewData && (
            <div className="rounded-lg border border-[#292929] bg-[#141414] p-5 space-y-4">
              <h2 className="font-heading text-sm font-semibold text-[#F5F5F5] flex items-center gap-2 pb-3 border-b border-[#292929]">
                <Sliders className="h-4 w-4 text-[#FF6A00]" />
                <span>3. Analysis Configuration</span>
              </h2>

              <div className="space-y-4 text-xs">
                {/* Observation Window Duration */}
                <div>
                  <label className="block font-medium text-[#F5F5F5] mb-1.5">
                    Observation Window Duration ($W$)
                  </label>
                  <div className="grid grid-cols-5 gap-1.5">
                    {[1, 5, 10, 30, 60].map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        onClick={() => setWindowSeconds(sec)}
                        className={`rounded py-1.5 text-center font-mono font-semibold transition-all ${
                          windowSeconds === sec
                            ? 'bg-[#FF6A00] text-white'
                            : 'bg-[#101010] border border-[#292929] text-[#A3A3A3] hover:text-[#F5F5F5]'
                        }`}
                      >
                        {sec}s
                      </button>
                    ))}
                  </div>
                </div>

                {/* Baseline Calibration Mode */}
                <div>
                  <label className="block font-medium text-[#F5F5F5] mb-1.5">
                    Baseline Calibration Mode
                  </label>
                  <div className="grid grid-cols-3 gap-1.5 mb-2.5">
                    <button
                      type="button"
                      onClick={() => setBaselineMode('ratio')}
                      className={`rounded py-1.5 text-xs transition-all ${
                        baselineMode === 'ratio'
                          ? 'bg-[#FF6A00] text-white font-semibold'
                          : 'bg-[#101010] border border-[#292929] text-[#A3A3A3] hover:text-[#F5F5F5]'
                      }`}
                    >
                      First N%
                    </button>
                    <button
                      type="button"
                      onClick={() => setBaselineMode('window_count')}
                      className={`rounded py-1.5 text-xs transition-all ${
                        baselineMode === 'window_count'
                          ? 'bg-[#FF6A00] text-white font-semibold'
                          : 'bg-[#101010] border border-[#292929] text-[#A3A3A3] hover:text-[#F5F5F5]'
                      }`}
                    >
                      N Windows
                    </button>
                    <button
                      type="button"
                      onClick={() => setBaselineMode('timestamp_range')}
                      className={`rounded py-1.5 text-xs transition-all ${
                        baselineMode === 'timestamp_range'
                          ? 'bg-[#FF6A00] text-white font-semibold'
                          : 'bg-[#101010] border border-[#292929] text-[#A3A3A3] hover:text-[#F5F5F5]'
                      }`}
                    >
                      Time Range
                    </button>
                  </div>

                  {baselineMode === 'ratio' && (
                    <div>
                      <div className="flex justify-between text-[11px] text-[#A3A3A3] mb-1">
                        <span>Calibration Ratio:</span>
                        <span className="font-mono text-[#FF6A00] font-bold">{(baselineRatio * 100).toFixed(0)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="0.5"
                        step="0.05"
                        value={baselineRatio}
                        onChange={(e) => setBaselineRatio(Number(e.target.value))}
                        className="w-full accent-[#FF6A00]"
                      />
                    </div>
                  )}

                  {baselineMode === 'window_count' && (
                    <div>
                      <label className="block text-[11px] text-[#A3A3A3] mb-1">Window Count:</label>
                      <input
                        type="number"
                        min="3"
                        max="500"
                        value={baselineWindowCount}
                        onChange={(e) => setBaselineWindowCount(Number(e.target.value))}
                        className="w-full rounded border border-[#292929] bg-[#101010] px-3 py-1.5 font-mono text-xs text-[#F5F5F5]"
                      />
                    </div>
                  )}

                  {baselineMode === 'timestamp_range' && (
                    <div className="space-y-2">
                      <div>
                        <label className="block text-[11px] text-[#A3A3A3] mb-1">Start Timestamp:</label>
                        <input
                          type="text"
                          placeholder="e.g. 2026-03-01 10:00:00"
                          value={baselineStartTimestamp}
                          onChange={(e) => setBaselineStartTimestamp(e.target.value)}
                          className="w-full rounded border border-[#292929] bg-[#101010] px-3 py-1.5 font-mono text-xs text-[#F5F5F5]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-[#A3A3A3] mb-1">End Timestamp:</label>
                        <input
                          type="text"
                          placeholder="e.g. 2026-03-01 10:05:00"
                          value={baselineEndTimestamp}
                          onChange={(e) => setBaselineEndTimestamp(e.target.value)}
                          className="w-full rounded border border-[#292929] bg-[#101010] px-3 py-1.5 font-mono text-xs text-[#F5F5F5]"
                        />
                      </div>
                    </div>
                  )}

                  <p className="text-[10px] text-[#737373] mt-1.5">
                    Known attack windows are automatically excluded from calibration to prevent baseline contamination.
                  </p>
                </div>

                {/* Significance Level Alpha */}
                <div>
                  <label className="block font-medium text-[#F5F5F5] mb-1.5">
                    Significance Level (&alpha;)
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[0.05, 0.01, 0.001].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setAlpha(val)}
                        className={`rounded py-1.5 font-mono text-xs transition-all ${
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

                {/* Submit Action */}
                <button
                  type="button"
                  onClick={handleRunAnalysis}
                  disabled={isAnalyzing}
                  className="w-full btn-primary justify-center py-2.5 mt-2"
                >
                  {isAnalyzing ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>Running Poisson Detection...</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 fill-current" />
                      <span>Run Historical Analysis</span>
                    </>
                  )}
                </button>

                {analysisError && (
                  <div className="rounded border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.08)] p-2.5 text-[11px] text-red-300 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-[#ef4444] mt-0.5" />
                    <span>{analysisError}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Preview Table, Timeline, Replay, Inspector & Evaluation (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          {/* Pre-Analysis Dataset Preview Card */}
          {previewData && !analysisResult && (
            <div className="rounded-lg border border-[#292929] bg-[#141414] p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#292929]">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-[#FF6A00]" />
                  <h2 className="font-heading text-sm font-semibold text-[#F5F5F5]">
                    Dataset Preview: {previewData.file_name}
                  </h2>
                </div>
                <span className="text-xs text-[#737373] font-mono">
                  ~{previewData.total_rows.toLocaleString()} records &bull; {previewData.columns.length} columns
                </span>
              </div>

              <p className="text-xs text-[#A3A3A3]">
                Inspect sample records below to verify that the timestamp and label columns are mapped properly.
              </p>

              <div className="overflow-x-auto max-h-64 border border-[#292929] rounded-md">
                <table className="w-full text-left text-[11px] font-mono">
                  <thead className="sticky top-0 bg-[#101010] text-[#737373] border-b border-[#292929]">
                    <tr>
                      {previewData.columns.slice(0, 8).map((col) => (
                        <th key={col} className="px-3 py-2 whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#202020] text-[#A3A3A3]">
                    {previewData.sample_rows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-[#191919]">
                        {previewData.columns.slice(0, 8).map((col) => (
                          <td key={col} className="px-3 py-1.5 whitespace-nowrap">
                            {String(row[col] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {previewData.columns.length > 8 && (
                <p className="text-[10px] text-[#737373]">
                  Showing first 8 of {previewData.columns.length} columns.
                </p>
              )}
            </div>
          )}

          {/* Results Timeline Visualization */}
          {analysisResult && (
            <div className="rounded-lg border border-[#292929] bg-[#141414] p-5 space-y-4">
              {/* Persisted Experiment Status Banner */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-md bg-[#101010] border border-[#292929] p-3 text-xs">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-[#FF6A00]" />
                  <span className="text-[#A3A3A3]">Persisted Experiment:</span>
                  <span className="font-mono font-bold text-[#F5F5F5]">{analysisResult.experiment_id}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Link
                    href={`/experiments?selected=${analysisResult.experiment_id}`}
                    className="text-xs text-[#FF6A00] hover:text-[#FF7A1A] flex items-center gap-1 font-medium"
                  >
                    <span>View in History</span>
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                  <span className="text-[#383838]">|</span>
                  <Link
                    href={`/analysis?experiment_id=${analysisResult.experiment_id}`}
                    className="text-xs text-[#A3A3A3] hover:text-[#F5F5F5] flex items-center gap-1 font-medium"
                  >
                    <span>Analyze in Stats Lab</span>
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-[#292929]">
                <div>
                  <h2 className="font-heading text-sm font-semibold text-[#F5F5F5] flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-[#FF6A00]" />
                    <span>Historical Traffic Flow Timeline ($W = {analysisResult.window_seconds}$s)</span>
                  </h2>
                  <p className="text-xs text-[#737373] mt-0.5">
                    {analysisResult.measurement_unit_description}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono">
                  <span className="flex items-center gap-1.5 text-[#A3A3A3]">
                    <span className="h-2 w-2 rounded-full bg-[#FF6A00]" />
                    Observed Flows ($x$)
                  </span>
                  <span className="flex items-center gap-1.5 text-[#A3A3A3]">
                    <span className="h-0.5 w-3 bg-[#A3A3A3]" />
                    Baseline &lambda;<sub>w</sub> ({analysisResult.lambda_window})
                  </span>
                  {typeof analysisResult.labeled_burst_count === 'number' && analysisResult.labeled_burst_count > 0 && (
                    <span className="flex items-center gap-1.5 text-[#FF6A00]">
                      <span className="h-2 w-2 bg-[rgba(255,106,0,0.4)] border border-[#FF6A00]" />
                      Labeled Attack
                    </span>
                  )}
                  <span className="flex items-center gap-1.5 text-[#ef4444]">
                    <span className="h-2 w-2 rounded-full bg-[#ef4444]" />
                    Alert ($p &lt; \alpha$)
                  </span>
                </div>
              </div>

              {/* Recharts Chart */}
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="historicalFlowGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#FF6A00" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#FF6A00" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#292929" vertical={false} />
                    <XAxis
                      dataKey="displayTime"
                      stroke="#737373"
                      fontSize={10}
                      fontFamily="var(--font-mono)"
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis stroke="#737373" fontSize={10} fontFamily="var(--font-mono)" tickLine={false} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const d = payload[0].payload;
                        return (
                          <div className="rounded-lg border border-[#383838] bg-[#141414] p-3 font-mono text-xs shadow-2xl space-y-1">
                            <p className="text-[#A3A3A3]">{d.timestamp}</p>
                            <p className="text-[#F5F5F5] font-bold">
                              Flows: <span className="text-[#FF6A00]">{d.count}</span>
                            </p>
                            <p className="text-[#A3A3A3]">
                              Baseline: <span className="text-[#F5F5F5]">{d.baseline}</span>
                            </p>
                            {d.pValue !== undefined && (
                              <p className="text-[#A3A3A3]">
                                Prob $P(X \ge x)$: <span className="text-[#FF6A00]">{formatProbability(d.pValue)}</span>
                              </p>
                            )}
                            <p className={d.isBurst ? 'text-[#ef4444] font-bold' : 'text-[#737373]'}>
                              {d.isBurst ? 'STATUS: STATISTICAL BURST' : 'STATUS: NORMAL'}
                            </p>
                            {d.groundTruth !== null && (
                              <p className={d.groundTruth ? 'text-[#FF6A00] font-semibold' : 'text-[#737373]'}>
                                Ground Truth: {d.groundTruth ? 'ATTACK' : 'BENIGN'}
                              </p>
                            )}
                          </div>
                        );
                      }}
                    />

                    {/* Labeled Attack Intervals */}
                    {chartData.map((d) => {
                      if (d.groundTruth) {
                        return (
                          <ReferenceArea
                            key={`attack-${d.windowIndex}`}
                            x1={d.displayTime}
                            x2={d.displayTime}
                            stroke="#FF6A00"
                            strokeOpacity={0.3}
                            fill="#FF6A00"
                            fillOpacity={0.12}
                          />
                        );
                      }
                      return null;
                    })}

                    {/* Baseline Lambda Reference Line */}
                    <ReferenceLine
                      y={analysisResult.lambda_window}
                      stroke="#A3A3A3"
                      strokeDasharray="4 4"
                      strokeWidth={1.5}
                    />

                    {/* Active Scrubbed Replay Reference Line */}
                    {chartData[currentIndex] && (
                      <ReferenceLine
                        x={chartData[currentIndex].displayTime}
                        stroke="#FF6A00"
                        strokeWidth={2}
                      />
                    )}

                    {/* Flow Count Area */}
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="#FF6A00"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#historicalFlowGradient)"
                    />

                    {/* Burst Alert Scatter Points */}
                    <Scatter dataKey="alertMarker" fill="#ef4444" stroke="#ffffff" strokeWidth={1} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Replay Controls Toolbar */}
              <div className="rounded-md border border-[#292929] bg-[#101010] p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsPlaying(!isPlaying)}
                      className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 font-semibold text-white transition-colors ${
                        isPlaying ? 'bg-[#FF6A00] hover:bg-[#FF7A1A]' : 'bg-[#FF6A00] hover:bg-[#FF7A1A]'
                      }`}
                    >
                      {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                      <span>{isPlaying ? 'Pause Replay' : 'Play Replay'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsPlaying(false);
                        setCurrentIndex(0);
                      }}
                      className="btn-secondary py-1.5 px-2.5 text-xs"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Reset</span>
                    </button>
                  </div>

                  {/* Playback Speed Controls */}
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-[#737373]">Speed:</span>
                    {[1, 2, 5, 10].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setPlaybackSpeed(s)}
                        className={`rounded px-2 py-0.5 font-mono ${
                          playbackSpeed === s
                            ? 'bg-[rgba(255,106,0,0.15)] border border-[#FF6A00] text-[#FF6A00] font-bold'
                            : 'bg-[#191919] border border-[#292929] text-[#737373] hover:text-[#F5F5F5]'
                        }`}
                      >
                        {s}x
                      </button>
                    ))}
                  </div>

                  {/* Window Counter */}
                  <div className="font-mono text-xs text-[#A3A3A3]">
                    Window <span className="text-[#FF6A00] font-bold">{currentIndex + 1}</span> of{' '}
                    <span className="text-[#737373]">{analysisResult.total_windows}</span>
                  </div>
                </div>

                {/* Scrubber Slider */}
                <div>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, analysisResult.total_windows - 1)}
                    value={currentIndex}
                    onChange={(e) => {
                      setIsPlaying(false);
                      setCurrentIndex(Number(e.target.value));
                    }}
                    className="w-full accent-[#FF6A00] cursor-pointer"
                  />
                </div>
              </div>

              {/* Event Inspector for Current Replay Window */}
              {activeObs && activeDet && (
                <div
                  className={`rounded-md border p-4 text-xs transition-colors space-y-3 ${
                    activeDet.is_burst
                      ? 'border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.05)]'
                      : 'border-[#292929] bg-[#101010]'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#292929]">
                    <span className="font-semibold text-[#F5F5F5] flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-[#FF6A00]" />
                      <span>Window Inspector &bull; Time: </span>
                      <span className="font-mono text-[#A3A3A3]">{activeObs.timestamp}</span>
                    </span>
                    <StatusBadge
                      label={activeDet.is_burst ? 'ALERT: BURST DETECTED' : 'NORMAL VARIATION'}
                      variant={activeDet.is_burst ? 'error' : 'success'}
                    />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
                    <div>
                      <span className="text-[10px] text-[#737373] block">Observed Flows ($x$):</span>
                      <p className="text-base font-bold text-[#F5F5F5]">{activeObs.count}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#737373] block">Baseline (&lambda;<sub>w</sub>):</span>
                      <p className="text-base font-bold text-[#A3A3A3]">{activeDet.expected_rate}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#737373] block">Upper-Tail $P(X \ge x)$:</span>
                      <p className="text-base font-bold text-[#FF6A00]">{formatProbability(activeDet.p_value)}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#737373] block">Ground Truth:</span>
                      <p className="text-base font-bold text-[#F5F5F5]">
                        {activeObs.ground_truth === null
                          ? 'Unlabeled'
                          : activeObs.ground_truth
                          ? 'Attack Flow'
                          : 'Benign'}
                      </p>
                    </div>
                  </div>

                  <p className="text-xs text-[#A3A3A3] font-sans leading-relaxed pt-1">
                    <strong className="text-[#F5F5F5]">Statistical Reasoning: </strong>
                    {activeDet.interpretation}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Performance Evaluation Card */}
          {analysisResult && (
            <div className="rounded-lg border border-[#292929] bg-[#141414] p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#292929]">
                <h3 className="font-heading text-sm font-semibold text-[#F5F5F5] flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-[#FF6A00]" />
                  <span>Performance Evaluation &amp; Ground Truth Comparison</span>
                </h3>
                <span className="text-xs font-mono text-[#737373]">
                  {analysisResult.evaluation ? 'Ground Truth Available' : 'Unlabeled Dataset'}
                </span>
              </div>

              {analysisResult.evaluation ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-md border border-[#292929] bg-[#101010] p-3 text-center">
                      <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider font-medium">Precision</span>
                      <p className="text-lg font-bold text-[#F5F5F5] font-mono mt-0.5">
                        {(analysisResult.evaluation.precision * 100).toFixed(1)}%
                      </p>
                      <span className="text-[10px] text-[#737373] font-mono">TP / (TP + FP)</span>
                    </div>
                    <div className="rounded-md border border-[#292929] bg-[#101010] p-3 text-center">
                      <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider font-medium">Recall</span>
                      <p className="text-lg font-bold text-emerald-400 font-mono mt-0.5">
                        {(analysisResult.evaluation.recall * 100).toFixed(1)}%
                      </p>
                      <span className="text-[10px] text-[#737373] font-mono">TP / (TP + FN)</span>
                    </div>
                    <div className="rounded-md border border-[#292929] bg-[#101010] p-3 text-center">
                      <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider font-medium">F1-Score</span>
                      <p className="text-lg font-bold text-[#FF6A00] font-mono mt-0.5">
                        {(analysisResult.evaluation.f1_score * 100).toFixed(1)}%
                      </p>
                      <span className="text-[10px] text-[#737373] font-mono">Harmonic Mean</span>
                    </div>
                    <div className="rounded-md border border-[#292929] bg-[#101010] p-3 text-center">
                      <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider font-medium">False Positive Rate</span>
                      <p className="text-lg font-bold text-[#ef4444] font-mono mt-0.5">
                        {(analysisResult.evaluation.false_positive_rate * 100).toFixed(2)}%
                      </p>
                      <span className="text-[10px] text-[#737373] font-mono">FP / (FP + TN)</span>
                    </div>
                  </div>

                  {/* 2x2 Confusion Matrix */}
                  <div className="rounded-md border border-[#292929] bg-[#101010] p-4 space-y-2">
                    <span className="text-xs font-semibold text-[#A3A3A3] block">
                      Window-Level Confusion Matrix
                    </span>
                    <div className="grid grid-cols-2 gap-2.5 text-center text-xs font-mono">
                      <div className="rounded bg-[#141414] border border-[rgba(34,197,94,0.25)] p-2.5">
                        <span className="text-[10px] text-emerald-400 block">True Positives (TP)</span>
                        <span className="text-base font-bold text-[#F5F5F5]">{analysisResult.evaluation.true_positives}</span>
                      </div>
                      <div className="rounded bg-[#141414] border border-[rgba(239,68,68,0.25)] p-2.5">
                        <span className="text-[10px] text-[#ef4444] block">False Positives (FP)</span>
                        <span className="text-base font-bold text-[#F5F5F5]">{analysisResult.evaluation.false_positives}</span>
                      </div>
                      <div className="rounded bg-[#141414] border border-[rgba(255,106,0,0.25)] p-2.5">
                        <span className="text-[10px] text-[#FF6A00] block">False Negatives (FN)</span>
                        <span className="text-base font-bold text-[#F5F5F5]">{analysisResult.evaluation.false_negatives}</span>
                      </div>
                      <div className="rounded bg-[#141414] border border-[#292929] p-2.5">
                        <span className="text-[10px] text-[#737373] block">True Negatives (TN)</span>
                        <span className="text-base font-bold text-[#F5F5F5]">{analysisResult.evaluation.true_negatives}</span>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-md border border-[#292929] bg-[#101010] p-3 text-xs text-[#A3A3A3]">
                  <div className="flex items-start gap-2">
                    <Info className="h-4 w-4 text-[#A3A3A3] mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold text-[#F5F5F5]">Ground-Truth Labels Omitted</p>
                      <p className="text-[#737373] mt-1 leading-relaxed">
                        This dataset was analyzed without historical attack labels. Precision, recall, and false-positive
                        rate are omitted because calculating them against unknown traffic would be scientifically invalid.
                        Detected bursts reflect statistical deviations from the calibrated baseline.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Scientific Limitation Note */}
              <div className="rounded-md border border-[#292929] bg-[#101010] p-3 text-xs text-[#A3A3A3] space-y-1">
                <span className="font-semibold text-[#FF6A00] flex items-center gap-1.5 text-xs">
                  <Layers className="h-3.5 w-3.5" />
                  <span>Statistical Model Notice</span>
                </span>
                <p className="text-xs leading-relaxed text-[#737373]">
                  {analysisResult.model_limitation_note}
                </p>
              </div>
            </div>
          )}

          {/* Observations Table */}
          {analysisResult && (
            <div className="rounded-lg border border-[#292929] bg-[#141414] p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-[#292929]">
                <h2 className="font-heading text-sm font-semibold text-[#F5F5F5] flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-[#FF6A00]" />
                  <span>Observation Windows Table</span>
                </h2>
                <div className="flex items-center gap-1.5 text-xs">
                  <Filter className="h-3.5 w-3.5 text-[#737373]" />
                  <span className="text-[#737373]">Filter:</span>
                  {(['all', 'alerts_only', 'attack_only'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setTableFilter(mode)}
                      className={`rounded px-2.5 py-1 text-[11px] font-mono capitalize transition-all ${
                        tableFilter === mode
                          ? 'bg-[#FF6A00] text-white font-bold'
                          : 'bg-[#101010] border border-[#292929] text-[#737373] hover:text-[#F5F5F5]'
                      }`}
                    >
                      {mode.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="max-h-64 overflow-y-auto rounded-md border border-[#292929]">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="sticky top-0 bg-[#101010] border-b border-[#292929] text-[#737373] text-[11px]">
                    <tr>
                      <th className="py-2.5 px-3">Window</th>
                      <th className="py-2.5 px-3">Time</th>
                      <th className="py-2.5 px-3">Flows ($x$)</th>
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
                      const isSelected = currentIndex === idx;
                      return (
                        <tr
                          key={idx}
                          onClick={() => {
                            setIsPlaying(false);
                            setCurrentIndex(idx);
                          }}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-[rgba(255,106,0,0.15)] font-bold'
                              : isAlert
                              ? 'bg-[rgba(239,68,68,0.06)] hover:bg-[rgba(239,68,68,0.12)]'
                              : 'hover:bg-[#191919]'
                          }`}
                        >
                          <td className="py-2 px-3 text-[#737373]">#{idx + 1}</td>
                          <td className="py-2 px-3 text-[#A3A3A3]">
                            {obs.timestamp.includes('T') ? obs.timestamp.split('T')[1].slice(0, 8) : obs.timestamp}
                          </td>
                          <td className="py-2 px-3 text-[#F5F5F5] font-bold">{obs.count}</td>
                          <td className="py-2 px-3 text-[#737373]">{det?.expected_rate ?? analysisResult.lambda_window}</td>
                          <td className="py-2 px-3 text-[#FF6A00] font-mono">
                            {det ? formatProbability(det.p_value) : '-'}
                          </td>
                          <td className="py-2 px-3">
                            <StatusBadge
                              label={isAlert ? 'BURST' : 'NORMAL'}
                              variant={isAlert ? 'error' : 'success'}
                            />
                          </td>
                          <td className="py-2 px-3 text-[#A3A3A3]">
                            {obs.ground_truth === null
                              ? '-'
                              : obs.ground_truth
                              ? 'ATTACK'
                              : 'BENIGN'}
                          </td>
                          <td className="py-2 px-3 text-right">
                            <span className="text-[10px] text-[#FF6A00] hover:text-[#FF7A1A]">
                              Inspect
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Empty State before file upload */}
          {!previewData && !analysisResult && (
            <EmptyState
              icon={History}
              title="No Historical Dataset Loaded"
              description="Upload a CSV network flow summary (such as CICIDS2017) on the left panel to inspect its columns, configure observation window duration, calibrate a clean baseline, and replay detections."
            />
          )}
        </div>
      </div>
    </div>
  );
}
