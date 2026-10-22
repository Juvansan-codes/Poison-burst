'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  Clock,
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
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="border-b border-[#262a38] pb-6">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-orange-400">
          <span>Primary Page Owner: Abishek Joseph E (URK25CS1002)</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Historical Traffic Replay & Analysis
            </h1>
            <p className="text-sm text-slate-400 mt-1 max-w-3xl">
              Ingest historical network traffic CSV flow summaries (e.g. CICIDS2017), calibrate an unpolluted
              Poisson baseline, and detect burst anomalies using the authoritative SciPy upper-tail engine.
            </p>
          </div>
          {analysisResult && (
            <button
              type="button"
              onClick={handleExportCSV}
              className="inline-flex items-center gap-2 rounded-md bg-orange-600 px-3.5 py-2 text-xs font-semibold text-white shadow hover:bg-orange-500 transition-colors shrink-0"
            >
              <Download className="h-4 w-4" />
              Export Aggregated CSV
            </button>
          )}
        </div>
      </div>

      {/* Critical Measurement Type Banner */}
      <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-950/20 p-4 text-xs text-amber-200">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold text-amber-300">
              Measurement Semantics: Network Flows per Observation Window (flow_count)
            </p>
            <p className="text-slate-300 leading-relaxed">
              CSV network flow summaries represent aggregated connection records, <strong>not individual raw packets</strong>.
              The Poisson detector strictly receives expected flow arrivals per window (&lambda;<sub>w</sub>).
              Ground-truth flow labels indicate attack connection intent; they do not automatically guarantee volumetric traffic surges.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* =========================================================================
            LEFT COLUMN: CSV Upload, Column Mapping, and Baseline Calibration
           ========================================================================= */}
        <div className="lg:col-span-1 space-y-6">
          {/* Card 1: Upload Section */}
          <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-5">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2 pb-3 border-b border-[#262a38]">
              <Upload className="h-4 w-4 text-orange-400" />
              1. Dataset Upload (CSV)
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
                className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
                  isDragOver
                    ? 'border-orange-500 bg-orange-500/10'
                    : 'border-[#262a38] bg-[#1c1f2b] hover:bg-[#232737]'
                }`}
              >
                <FileSpreadsheet className="h-8 w-8 text-orange-400 mb-2" />
                <span className="text-xs font-medium text-white">
                  {selectedFile ? selectedFile.name : 'Choose or drag & drop a .csv file'}
                </span>
                <span className="text-[11px] text-slate-400 mt-1">
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
                <div className="mt-3 flex items-start gap-2 rounded border border-red-500/40 bg-red-950/20 p-2 text-[11px] text-red-300">
                  <XCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
                  <span>{fileError}</span>
                </div>
              )}

              {selectedFile && !previewData && (
                <button
                  type="button"
                  onClick={handlePreview}
                  disabled={isPreviewLoading}
                  className="mt-3 w-full rounded-md bg-orange-600 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  {isPreviewLoading ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      Inspecting CSV Columns...
                    </>
                  ) : (
                    <>
                      <Eye className="h-3.5 w-3.5" />
                      Inspect & Preview CSV
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Card 2: Column Selection & Mapping */}
          {previewData && (
            <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-5 space-y-4">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2 pb-3 border-b border-[#262a38]">
                <FileText className="h-4 w-4 text-orange-400" />
                2. Column Mapping
              </h2>

              <div className="space-y-3 text-xs">
                {/* Timestamp Column */}
                <div>
                  <label className="block font-medium text-slate-300 mb-1">
                    Timestamp Column <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={timestampColumn}
                    onChange={(e) => setTimestampColumn(e.target.value)}
                    className="w-full rounded border border-[#262a38] bg-[#0c0d12] px-2.5 py-1.5 font-mono text-xs text-white"
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
                  <label className="block font-medium text-slate-300 mb-1">
                    Ground-Truth Label Column <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <select
                    value={labelColumn}
                    onChange={(e) => setLabelColumn(e.target.value)}
                    className="w-full rounded border border-[#262a38] bg-[#0c0d12] px-2.5 py-1.5 font-mono text-xs text-white"
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
                    <label className="block font-medium text-slate-300 mb-1">
                      Benign / Normal Label Value
                    </label>
                    <input
                      type="text"
                      value={benignLabelValue}
                      onChange={(e) => setBenignLabelValue(e.target.value)}
                      placeholder="e.g. BENIGN, Normal"
                      className="w-full rounded border border-[#262a38] bg-[#0c0d12] px-2.5 py-1.5 font-mono text-xs text-white"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">
                      Rows with labels other than this value will be marked as attack ground truth.
                    </p>
                  </div>
                )}

                {previewData.timestamp_diagnostics && (
                  <div className="rounded bg-[#1c1f2b] p-2 text-[10px] text-slate-300 font-mono">
                    {previewData.timestamp_diagnostics}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Card 3: Calibration & Window Settings */}
          {previewData && (
            <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-5 space-y-4">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2 pb-3 border-b border-[#262a38]">
                <Sliders className="h-4 w-4 text-orange-400" />
                3. Analysis Configuration
              </h2>

              <div className="space-y-4 text-xs">
                {/* Observation Window Duration */}
                <div>
                  <label className="block font-medium text-slate-300 mb-1">
                    Observation Window Duration ($W$)
                  </label>
                  <div className="grid grid-cols-5 gap-1.5">
                    {[1, 5, 10, 30, 60].map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        onClick={() => setWindowSeconds(sec)}
                        className={`rounded py-1.5 text-center font-mono font-semibold transition-colors ${
                          windowSeconds === sec
                            ? 'bg-orange-500 text-white'
                            : 'bg-[#1c1f2b] border border-[#262a38] text-slate-300 hover:bg-[#232737]'
                        }`}
                      >
                        {sec}s
                      </button>
                    ))}
                  </div>
                </div>

                {/* Baseline Calibration Mode */}
                <div>
                  <label className="block font-medium text-slate-300 mb-1">
                    Baseline Calibration Mode
                  </label>
                  <div className="grid grid-cols-3 gap-1.5 mb-2">
                    <button
                      type="button"
                      onClick={() => setBaselineMode('ratio')}
                      className={`rounded py-1.5 text-[11px] transition-colors ${
                        baselineMode === 'ratio'
                          ? 'bg-orange-500 text-white font-semibold'
                          : 'bg-[#1c1f2b] border border-[#262a38] text-slate-300 hover:bg-[#232737]'
                      }`}
                    >
                      First N%
                    </button>
                    <button
                      type="button"
                      onClick={() => setBaselineMode('window_count')}
                      className={`rounded py-1.5 text-[11px] transition-colors ${
                        baselineMode === 'window_count'
                          ? 'bg-orange-500 text-white font-semibold'
                          : 'bg-[#1c1f2b] border border-[#262a38] text-slate-300 hover:bg-[#232737]'
                      }`}
                    >
                      N Windows
                    </button>
                    <button
                      type="button"
                      onClick={() => setBaselineMode('timestamp_range')}
                      className={`rounded py-1.5 text-[11px] transition-colors ${
                        baselineMode === 'timestamp_range'
                          ? 'bg-orange-500 text-white font-semibold'
                          : 'bg-[#1c1f2b] border border-[#262a38] text-slate-300 hover:bg-[#232737]'
                      }`}
                    >
                      Time Range
                    </button>
                  </div>

                  {baselineMode === 'ratio' && (
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                        <span>Calibration Ratio:</span>
                        <span className="font-mono text-orange-400 font-bold">{(baselineRatio * 100).toFixed(0)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="0.5"
                        step="0.05"
                        value={baselineRatio}
                        onChange={(e) => setBaselineRatio(Number(e.target.value))}
                        className="w-full accent-orange-500"
                      />
                    </div>
                  )}

                  {baselineMode === 'window_count' && (
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Window Count:</label>
                      <input
                        type="number"
                        min="3"
                        max="500"
                        value={baselineWindowCount}
                        onChange={(e) => setBaselineWindowCount(Number(e.target.value))}
                        className="w-full rounded border border-[#262a38] bg-[#0c0d12] px-2 py-1 font-mono text-xs text-white"
                      />
                    </div>
                  )}

                  {baselineMode === 'timestamp_range' && (
                    <div className="space-y-2">
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-0.5">Start Timestamp:</label>
                        <input
                          type="text"
                          placeholder="e.g. 2026-03-01 10:00:00"
                          value={baselineStartTimestamp}
                          onChange={(e) => setBaselineStartTimestamp(e.target.value)}
                          className="w-full rounded border border-[#262a38] bg-[#0c0d12] px-2 py-1 font-mono text-xs text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-0.5">End Timestamp:</label>
                        <input
                          type="text"
                          placeholder="e.g. 2026-03-01 10:05:00"
                          value={baselineEndTimestamp}
                          onChange={(e) => setBaselineEndTimestamp(e.target.value)}
                          className="w-full rounded border border-[#262a38] bg-[#0c0d12] px-2 py-1 font-mono text-xs text-white"
                        />
                      </div>
                    </div>
                  )}

                  <p className="text-[10px] text-slate-400 mt-1">
                    Known attack windows are automatically excluded from calibration to prevent baseline contamination.
                  </p>
                </div>

                {/* Significance Level Alpha */}
                <div>
                  <label className="block font-medium text-slate-300 mb-1">
                    Significance Level (&alpha;)
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[0.05, 0.01, 0.001].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setAlpha(val)}
                        className={`rounded py-1.5 font-mono text-xs transition-colors ${
                          alpha === val
                            ? 'bg-orange-500 text-white font-semibold'
                            : 'bg-[#1c1f2b] border border-[#262a38] text-slate-300 hover:bg-[#232737]'
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
                  className="w-full rounded-md bg-orange-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-orange-600/20"
                >
                  {isAnalyzing ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Running Poisson Detection...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      Run Historical Analysis
                    </>
                  )}
                </button>

                {analysisError && (
                  <div className="rounded border border-red-500/40 bg-red-950/20 p-2.5 text-[11px] text-red-300 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
                    <span>{analysisError}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* =========================================================================
            RIGHT COLUMN: Preview Table, Timeline, Replay, Inspector & Evaluation
           ========================================================================= */}
        <div className="lg:col-span-2 space-y-6">
          {/* Pre-Analysis Dataset Preview Card (Visible after preview, before or alongside analysis) */}
          {previewData && !analysisResult && (
            <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-5">
              <h2 className="text-sm font-semibold text-white flex items-center justify-between pb-3 border-b border-[#262a38]">
                <span className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-orange-400" />
                  Dataset Preview: {previewData.file_name}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  ~{previewData.total_rows.toLocaleString()} records &bull; {previewData.columns.length} columns
                </span>
              </h2>

              <p className="text-xs text-slate-300 mt-3">
                Inspect sample records below to verify that the timestamp and label columns are mapped properly.
              </p>

              <div className="mt-4 overflow-x-auto max-h-64 border border-[#262a38] rounded">
                <table className="w-full text-left text-[11px] font-mono">
                  <thead className="sticky top-0 bg-[#1c1f2b] text-slate-400 border-b border-[#262a38]">
                    <tr>
                      {previewData.columns.slice(0, 8).map((col) => (
                        <th key={col} className="px-3 py-2 whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#262a38]/60 text-slate-300">
                    {previewData.sample_rows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-[#1c1f2b]/50">
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
                <p className="text-[10px] text-slate-400 mt-1.5">
                  Showing first 8 of {previewData.columns.length} columns.
                </p>
              )}
            </div>
          )}

          {/* Results Timeline Visualization */}
          {analysisResult && (
            <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-[#262a38]">
                <div>
                  <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-orange-400" />
                    Historical Traffic Flow Timeline ($W = {analysisResult.window_seconds}$s)
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {analysisResult.measurement_unit_description}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono">
                  <span className="flex items-center gap-1.5 text-slate-300">
                    <span className="h-2 w-2 rounded-full bg-orange-500" />
                    Observed Flows ($x$)
                  </span>
                  <span className="flex items-center gap-1.5 text-slate-300">
                    <span className="h-0.5 w-3 bg-emerald-400" />
                    Baseline &lambda;<sub>w</sub> ({analysisResult.lambda_window})
                  </span>
                  {typeof analysisResult.labeled_burst_count === 'number' && analysisResult.labeled_burst_count > 0 && (
                    <span className="flex items-center gap-1.5 text-amber-300">
                      <span className="h-2 w-2 bg-amber-500/40 border border-amber-500" />
                      Labeled Attack
                    </span>
                  )}
                  <span className="flex items-center gap-1.5 text-red-400">
                    <span className="h-2 w-2 rounded-full bg-red-500 border border-red-300" />
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
                        <stop offset="5%" stopColor="#f97316" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#f97316" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262a38" vertical={false} />
                    <XAxis
                      dataKey="displayTime"
                      stroke="#64748b"
                      fontSize={10}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis stroke="#64748b" fontSize={10} tickLine={false} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const d = payload[0].payload;
                        return (
                          <div className="rounded border border-[#262a38] bg-[#0c0d12]/95 p-2.5 font-mono text-[11px] shadow-xl">
                            <p className="text-slate-400">{d.timestamp}</p>
                            <p className="text-white font-bold mt-1">
                              Flows: <span className="text-orange-400">{d.count}</span>
                            </p>
                            <p className="text-slate-300">
                              Baseline: <span className="text-emerald-400">{d.baseline}</span>
                            </p>
                            {d.pValue !== undefined && (
                              <p className="text-slate-300">
                                Prob $P(X \ge x)$: <span className="text-amber-400">{formatProbability(d.pValue)}</span>
                              </p>
                            )}
                            <p className={d.isBurst ? 'text-red-400 font-bold mt-1' : 'text-slate-400'}>
                              {d.isBurst ? 'STATUS: STATISTICAL BURST' : 'STATUS: NORMAL'}
                            </p>
                            {d.groundTruth !== null && (
                              <p className={d.groundTruth ? 'text-amber-400 font-semibold' : 'text-slate-400'}>
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
                            stroke="#f59e0b"
                            strokeOpacity={0.3}
                            fill="#f59e0b"
                            fillOpacity={0.15}
                          />
                        );
                      }
                      return null;
                    })}

                    {/* Baseline Lambda Reference Line */}
                    <ReferenceLine
                      y={analysisResult.lambda_window}
                      stroke="#34d399"
                      strokeDasharray="4 4"
                      strokeWidth={1.5}
                    />

                    {/* Active Scrubbed Replay Reference Line */}
                    {chartData[currentIndex] && (
                      <ReferenceLine
                        x={chartData[currentIndex].displayTime}
                        stroke="#60a5fa"
                        strokeWidth={2}
                      />
                    )}

                    {/* Flow Count Area */}
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="#f97316"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#historicalFlowGradient)"
                    />

                    {/* Burst Alert Scatter Points */}
                    <Scatter dataKey="alertMarker" fill="#ef4444" stroke="#fca5a5" strokeWidth={1.5} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Replay Controls Toolbar */}
              <div className="rounded-lg border border-[#262a38] bg-[#1c1f2b] p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsPlaying(!isPlaying)}
                      className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 font-semibold text-white transition-colors ${
                        isPlaying ? 'bg-amber-600 hover:bg-amber-500' : 'bg-orange-600 hover:bg-orange-500'
                      }`}
                    >
                      {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      {isPlaying ? 'Pause Replay' : 'Play Replay'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsPlaying(false);
                        setCurrentIndex(0);
                      }}
                      className="inline-flex items-center gap-1 rounded bg-[#262a38] px-2.5 py-1.5 text-slate-300 hover:bg-[#32374a] transition-colors"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reset
                    </button>
                  </div>

                  {/* Playback Speed Controls */}
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="text-slate-400">Speed:</span>
                    {[1, 2, 5, 10].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setPlaybackSpeed(s)}
                        className={`rounded px-2 py-0.5 font-mono ${
                          playbackSpeed === s
                            ? 'bg-orange-500 text-white font-bold'
                            : 'bg-[#262a38] text-slate-400 hover:text-white'
                        }`}
                      >
                        {s}x
                      </button>
                    ))}
                  </div>

                  {/* Window Counter */}
                  <div className="font-mono text-xs text-slate-300">
                    Window <span className="text-orange-400 font-bold">{currentIndex + 1}</span> of{' '}
                    <span className="text-slate-400">{analysisResult.total_windows}</span>
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
                    className="w-full accent-orange-500 cursor-pointer"
                  />
                </div>
              </div>

              {/* Event Inspector for Current Replay Window */}
              {activeObs && activeDet && (
                <div
                  className={`rounded-lg border p-4 text-xs transition-colors ${
                    activeDet.is_burst
                      ? 'border-red-500/50 bg-red-950/20'
                      : 'border-[#262a38] bg-[#1c1f2b]'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#262a38]/60">
                    <span className="font-semibold text-white flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-orange-400" />
                      Window Inspector &bull; Time: <span className="font-mono">{activeObs.timestamp}</span>
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 font-mono font-bold text-[10px] ${
                        activeDet.is_burst
                          ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                          : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      }`}
                    >
                      {activeDet.is_burst ? 'ALERT: BURST DETECTED' : 'NORMAL VARIATION'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 font-mono">
                    <div>
                      <span className="text-[10px] text-slate-400">Observed Flows ($x$):</span>
                      <p className="text-base font-bold text-white">{activeObs.count}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400">Baseline (&lambda;<sub>w</sub>):</span>
                      <p className="text-base font-bold text-slate-300">{activeDet.expected_rate}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400">Upper-Tail $P(X \ge x)$:</span>
                      <p className="text-base font-bold text-orange-400">{formatProbability(activeDet.p_value)}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400">Ground Truth:</span>
                      <p className="text-base font-bold text-amber-400">
                        {activeObs.ground_truth === null
                          ? 'Unlabeled'
                          : activeObs.ground_truth
                          ? 'Attack Flow'
                          : 'Benign'}
                      </p>
                    </div>
                  </div>

                  <p className="mt-3 text-[11px] text-slate-300 font-sans leading-relaxed">
                    <strong>Statistical Reasoning: </strong>
                    {activeDet.interpretation}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Performance Evaluation Card */}
          {analysisResult && (
            <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-5 space-y-4">
              <h2 className="text-sm font-semibold text-white flex items-center justify-between pb-3 border-b border-[#262a38]">
                <span className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-orange-400" />
                  Performance Evaluation & Ground Truth Comparison
                </span>
                <span className="text-xs font-mono text-slate-400">
                  {analysisResult.evaluation ? 'Ground Truth Active' : 'Unlabeled Dataset'}
                </span>
              </h2>

              {analysisResult.evaluation ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded border border-[#262a38] bg-[#1c1f2b] p-3 text-center">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider">Precision</span>
                      <p className="text-lg font-bold text-white font-mono mt-0.5">
                        {(analysisResult.evaluation.precision * 100).toFixed(1)}%
                      </p>
                      <span className="text-[9px] text-slate-400">TP / (TP + FP)</span>
                    </div>
                    <div className="rounded border border-[#262a38] bg-[#1c1f2b] p-3 text-center">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider">Recall (Sensitivity)</span>
                      <p className="text-lg font-bold text-white font-mono mt-0.5">
                        {(analysisResult.evaluation.recall * 100).toFixed(1)}%
                      </p>
                      <span className="text-[9px] text-slate-400">TP / (TP + FN)</span>
                    </div>
                    <div className="rounded border border-[#262a38] bg-[#1c1f2b] p-3 text-center">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider">F1-Score</span>
                      <p className="text-lg font-bold text-orange-400 font-mono mt-0.5">
                        {(analysisResult.evaluation.f1_score * 100).toFixed(1)}%
                      </p>
                      <span className="text-[9px] text-slate-400">Harmonic Mean</span>
                    </div>
                    <div className="rounded border border-[#262a38] bg-[#1c1f2b] p-3 text-center">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider">False Positive Rate</span>
                      <p className="text-lg font-bold text-amber-400 font-mono mt-0.5">
                        {(analysisResult.evaluation.false_positive_rate * 100).toFixed(2)}%
                      </p>
                      <span className="text-[9px] text-slate-400">FP / (FP + TN)</span>
                    </div>
                  </div>

                  {/* 2x2 Confusion Matrix */}
                  <div className="rounded border border-[#262a38] bg-[#0c0d12] p-3">
                    <span className="text-[11px] font-semibold text-slate-300 block mb-2">
                      Window-Level Confusion Matrix
                    </span>
                    <div className="grid grid-cols-2 gap-2 text-center text-xs font-mono">
                      <div className="rounded bg-emerald-950/30 border border-emerald-500/30 p-2">
                        <span className="text-[10px] text-emerald-400 block">True Positives (TP)</span>
                        <span className="text-base font-bold text-white">{analysisResult.evaluation.true_positives}</span>
                      </div>
                      <div className="rounded bg-red-950/30 border border-red-500/30 p-2">
                        <span className="text-[10px] text-red-400 block">False Positives (FP)</span>
                        <span className="text-base font-bold text-white">{analysisResult.evaluation.false_positives}</span>
                      </div>
                      <div className="rounded bg-amber-950/30 border border-amber-500/30 p-2">
                        <span className="text-[10px] text-amber-400 block">False Negatives (FN)</span>
                        <span className="text-base font-bold text-white">{analysisResult.evaluation.false_negatives}</span>
                      </div>
                      <div className="rounded bg-slate-900 border border-slate-700 p-2">
                        <span className="text-[10px] text-slate-400 block">True Negatives (TN)</span>
                        <span className="text-base font-bold text-white">{analysisResult.evaluation.true_negatives}</span>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded border border-blue-500/30 bg-blue-950/20 p-3 text-xs text-blue-200">
                  <div className="flex items-start gap-2">
                    <Info className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold text-blue-300">Ground-Truth Labels Omitted</p>
                      <p className="text-slate-300 mt-1">
                        This dataset was analyzed without historical attack labels. Precision, recall, and false-positive
                        rate are omitted because calculating them against unknown traffic would be scientifically invalid.
                        Detected bursts reflect statistical deviations from the calibrated baseline.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Scientific Limitation Note */}
              <div className="rounded border border-[#262a38] bg-[#0c0d12] p-3 text-xs text-slate-300 space-y-1">
                <span className="font-semibold text-amber-400 flex items-center gap-1.5 text-[11px]">
                  <Layers className="h-3.5 w-3.5" />
                  Statistical Model Notice
                </span>
                <p className="text-[11px] leading-relaxed text-slate-400">
                  {analysisResult.model_limitation_note}
                </p>
              </div>
            </div>
          )}

          {/* Observations Table */}
          {analysisResult && (
            <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-[#262a38]">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-orange-400" />
                  Observation Windows Table
                </h2>
                <div className="flex items-center gap-1.5 text-xs">
                  <Filter className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-slate-400">Filter:</span>
                  {(['all', 'alerts_only', 'attack_only'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setTableFilter(mode)}
                      className={`rounded px-2 py-0.5 text-[11px] font-mono capitalize ${
                        tableFilter === mode
                          ? 'bg-orange-500 text-white font-bold'
                          : 'bg-[#1c1f2b] text-slate-400 hover:text-white'
                      }`}
                    >
                      {mode.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 max-h-64 overflow-y-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="sticky top-0 bg-[#14161f] border-b border-[#262a38] text-slate-400 text-[11px]">
                    <tr>
                      <th className="py-2 px-3">Window</th>
                      <th className="py-2 px-3">Time</th>
                      <th className="py-2 px-3">Flows ($x$)</th>
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
                              ? 'bg-orange-500/20 font-bold'
                              : isAlert
                              ? 'bg-red-950/20 hover:bg-red-950/30'
                              : 'hover:bg-[#1c1f2b]'
                          }`}
                        >
                          <td className="py-2 px-3 text-slate-400">#{idx + 1}</td>
                          <td className="py-2 px-3 text-slate-300">
                            {obs.timestamp.includes('T') ? obs.timestamp.split('T')[1].slice(0, 8) : obs.timestamp}
                          </td>
                          <td className="py-2 px-3 text-white font-bold">{obs.count}</td>
                          <td className="py-2 px-3 text-slate-400">{det?.expected_rate ?? analysisResult.lambda_window}</td>
                          <td className="py-2 px-3 text-orange-400 font-mono">
                            {det ? formatProbability(det.p_value) : '-'}
                          </td>
                          <td className="py-2 px-3">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                isAlert
                                  ? 'bg-red-500/20 text-red-400'
                                  : 'bg-emerald-500/20 text-emerald-400'
                              }`}
                            >
                              {isAlert ? 'BURST' : 'NORMAL'}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-slate-300">
                            {obs.ground_truth === null
                              ? '-'
                              : obs.ground_truth
                              ? 'ATTACK'
                              : 'BENIGN'}
                          </td>
                          <td className="py-2 px-3 text-right">
                            <button
                              type="button"
                              className="text-[10px] text-orange-400 hover:text-orange-300"
                            >
                              Inspect
                            </button>
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
            <div className="rounded-lg border border-dashed border-[#262a38] bg-[#14161f]/50 p-12 text-center">
              <History className="h-12 w-12 text-slate-600 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-white">No Historical Dataset Loaded</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                Upload a CSV network flow summary (such as CICIDS2017) on the left panel to inspect its columns,
                configure observation window duration, calibrate a clean baseline, and replay detections.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
