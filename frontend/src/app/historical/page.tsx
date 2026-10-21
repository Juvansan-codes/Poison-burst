'use client';

import React, { useState } from 'react';
import {
  AlertCircle,
  FileSpreadsheet,
  History,
  Info,
  Pause,
  Play,
  RotateCcw,
  Sliders,
  Upload,
} from 'lucide-react';
import { MeasurementType } from '@/lib/types';

export default function HistoricalReplayPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [csvColumns, setCsvColumns] = useState<string[]>([]);
  const [measurementType, setMeasurementType] = useState<MeasurementType>('flow_count');
  const [windowDuration, setWindowDuration] = useState<number>(5);
  const [alpha, setAlpha] = useState<number>(0.01);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [fileError, setFileError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.csv') && !file.name.endsWith('.pcap')) {
      setFileError('Supported files are .csv (flow summaries) and .pcap (packet captures).');
      setSelectedFile(null);
      setCsvColumns([]);
      return;
    }

    setFileError(null);
    setSelectedFile(file);

    // If CSV, read the first line to extract headers
    if (file.name.endsWith('.csv')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        if (text) {
          const firstLine = text.split('\n')[0];
          const cols = firstLine.split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''));
          setCsvColumns(cols.slice(0, 10)); // preview up to 10 columns
        }
      };
      reader.readAsText(file.slice(0, 4096));
    } else {
      setCsvColumns(['timestamp', 'packet_length', 'src_ip', 'dst_ip', 'protocol']);
      setMeasurementType('packet_count');
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Page Header */}
      <div className="border-b border-[#262a38] pb-6">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-orange-400">
          <span>Primary Page Owner: Abishek Joseph E (URK25CS1002)</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl mt-1">
          Historical Traffic Replay & Analysis
        </h1>
        <p className="text-sm text-slate-400 mt-1 max-w-3xl">
          Ingest recorded network traffic datasets (e.g. CICIDS2017), configure time-window
          aggregation, and replay chronological arrivals to evaluate Poisson burst sensitivity.
        </p>
      </div>

      {/* Phase 2 Architecture Notice */}
      <div className="mt-6 rounded-lg border border-blue-500/30 bg-blue-950/20 p-4 text-xs text-blue-200">
        <div className="flex items-start gap-3">
          <Info className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold text-blue-300">
              Phase 2 Implementation Stage: Backend Ingestion Service in Progress
            </p>
            <p className="text-slate-300 leading-relaxed">
              This interface is fully scaffolded for CSV schema inspection and replay parameter
              configuration. Historical file parsing and time-window aggregation will be attached to
              the backend historical service in the next milestone. No artificial metrics are
              displayed.
            </p>
          </div>
        </div>
      </div>

      {/* Critical Measurement Type Distinction Callout */}
      <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-950/20 p-4 text-xs text-amber-200">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-amber-300">
              Important Statistical Distinction: Packet Counts vs Flow Counts
            </p>
            <p className="text-slate-300 mt-1 leading-relaxed">
              CSV network-flow records (such as NetFlow or CICIDS2017 flow summaries) represent
              <strong> flow-level connection counts</strong>, whereas PCAP captures represent
              <strong> raw packet counts</strong>. These are fundamentally different statistical
              processes. Historical attack labels on flow connections do not automatically provide
              valid ground-truth labels for every aggregated packet window.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column: Dataset Upload & Configuration */}
        <div className="lg:col-span-1 space-y-6">
          {/* File Upload Box */}
          <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-5">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Upload className="h-4 w-4 text-orange-400" />
              Dataset Source
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Select a CSV flow dataset or PCAP capture file.
            </p>

            <div className="mt-4">
              <label
                htmlFor="file-upload"
                className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#262a38] bg-[#1c1f2b]/50 p-6 text-center cursor-pointer hover:border-orange-500/50 hover:bg-[#1c1f2b] transition-colors"
              >
                <FileSpreadsheet className="h-8 w-8 text-slate-400" />
                <span className="mt-2 text-xs font-semibold text-slate-200">
                  {selectedFile ? selectedFile.name : 'Choose CSV or PCAP dataset'}
                </span>
                <span className="text-[11px] text-slate-400 mt-1">
                  {selectedFile
                    ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB`
                    : 'Click to browse local files'}
                </span>
                <input
                  id="file-upload"
                  type="file"
                  accept=".csv,.pcap,.pcapng"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>

              {fileError && (
                <p className="mt-2 text-xs text-red-400 font-medium">{fileError}</p>
              )}

              {csvColumns.length > 0 && (
                <div className="mt-3 rounded bg-[#0c0d12] border border-[#262a38] p-3 text-[11px]">
                  <p className="font-medium text-slate-300">Detected Schema Headers:</p>
                  <div className="mt-1 flex flex-wrap gap-1 font-mono text-[10px] text-orange-400">
                    {csvColumns.map((col, idx) => (
                      <span
                        key={idx}
                        className="rounded bg-[#1c1f2b] border border-[#262a38] px-1.5 py-0.5 text-slate-300"
                      >
                        {col}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Aggregation Settings */}
          <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-5">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Sliders className="h-4 w-4 text-orange-400" />
              Replay Parameters
            </h2>

            <div className="mt-4 space-y-4 text-xs">
              {/* Measurement Type Selector */}
              <div>
                <label className="block font-medium text-slate-300">Measurement Type</label>
                <select
                  value={measurementType}
                  onChange={(e) => setMeasurementType(e.target.value as MeasurementType)}
                  className="mt-1 block w-full rounded-md border border-[#262a38] bg-[#1c1f2b] px-3 py-2 text-xs text-white focus:border-orange-500 focus:outline-none"
                >
                  <option value="flow_count">Flow Count (CSV summaries)</option>
                  <option value="packet_count">Packet Count (PCAP captures)</option>
                </select>
              </div>

              {/* Window Duration */}
              <div>
                <label className="block font-medium text-slate-300">
                  Observation Window (W): <span className="text-orange-400 font-mono">{windowDuration}s</span>
                </label>
                <div className="mt-2 grid grid-cols-4 gap-1.5">
                  {[1, 5, 10, 60].map((dur) => (
                    <button
                      key={dur}
                      type="button"
                      onClick={() => setWindowDuration(dur)}
                      className={`rounded py-1.5 text-xs font-mono font-medium transition-colors ${
                        windowDuration === dur
                          ? 'bg-orange-500/20 border border-orange-500/50 text-orange-400'
                          : 'bg-[#1c1f2b] border border-[#262a38] text-slate-300 hover:bg-[#252a3b]'
                      }`}
                    >
                      {dur}s
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Counts will be binned into {windowDuration}-second intervals.
                </p>
              </div>

              {/* Alpha Level */}
              <div>
                <label className="block font-medium text-slate-300">
                  Significance Threshold (α): <span className="text-orange-400 font-mono">{alpha}</span>
                </label>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
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
            </div>
          </div>
        </div>

        {/* Right Column: Replay Controls & Timeline Preview */}
        <div className="lg:col-span-2 space-y-6">
          {/* Replay Controls Card */}
          <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-[#262a38]">
              <div>
                <h2 className="text-sm font-semibold text-white">Replay Controller</h2>
                <p className="text-xs text-slate-400">
                  Chronological stepping through aggregated time windows.
                </p>
              </div>

              {/* Playback Buttons */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsPlaying(!isPlaying)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white transition-colors ${
                    isPlaying
                      ? 'bg-amber-600 hover:bg-amber-500'
                      : 'bg-orange-600 hover:bg-orange-500'
                  }`}
                >
                  {isPlaying ? (
                    <>
                      <Pause className="h-3.5 w-3.5 fill-current" />
                      Pause Replay
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5 fill-current" />
                      Start Replay
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setIsPlaying(false)}
                  className="rounded-md bg-[#1c1f2b] border border-[#262a38] p-1.5 text-slate-300 hover:text-white hover:bg-[#252a3b] transition-colors"
                  title="Reset Replay"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>

                {/* Speed Selectors */}
                <div className="flex items-center rounded-md bg-[#1c1f2b] border border-[#262a38] p-0.5 text-xs font-mono">
                  {[1, 2, 5, 10].map((spd) => (
                    <button
                      key={spd}
                      type="button"
                      onClick={() => setPlaybackSpeed(spd)}
                      className={`px-2 py-0.5 rounded text-[11px] ${
                        playbackSpeed === spd
                          ? 'bg-orange-500 text-white font-bold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {spd}x
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Replay State Placeholder */}
            <div className="mt-6 flex flex-col items-center justify-center rounded-lg border border-dashed border-[#262a38] bg-[#0c0d12]/60 p-12 text-center">
              <History className="h-10 w-10 text-slate-600 mb-3" />
              <h3 className="text-sm font-semibold text-slate-300">
                {selectedFile
                  ? `Dataset Ready: ${selectedFile.name}`
                  : 'Awaiting Dataset Ingestion'}
              </h3>
              <p className="max-w-md text-xs text-slate-400 mt-1 leading-relaxed">
                {selectedFile
                  ? `File parsed with ${csvColumns.length} columns. Replay streaming will connect to the backend CSV aggregator in Phase 2.`
                  : 'Upload a historical network capture above to preview time-window aggregation and stream chronological observations.'}
              </p>
            </div>
          </div>

          {/* Historical Data Requirements Card */}
          <div className="rounded-lg border border-[#262a38] bg-[#14161f] p-5 text-xs">
            <h3 className="text-sm font-semibold text-white mb-2">
              CICIDS2017 & Benchmark Data Guidelines
            </h3>
            <ul className="space-y-2 text-slate-300 leading-relaxed list-disc list-inside">
              <li>
                <strong>Baseline Calibration Period:</strong> The baseline arrival rate λ̂ must be
                estimated solely from verified benign/normal intervals, not across the entire dataset.
              </li>
              <li>
                <strong>Window Boundary Convention:</strong> Timestamps will be aligned to fixed window
                boundaries (e.g. [t, t + W)).
              </li>
              <li>
                <strong>Unlabeled Semantics:</strong> Intervals without explicit ground-truth labels
                must remain marked as unlabeled rather than assuming they represent normal traffic.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
