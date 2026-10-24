'use client';

import React, { useState } from 'react';
import {
  Flame,
  CheckCircle2,
  Clock,
  HelpCircle,
} from 'lucide-react';
import { HardwareWindowSchema } from '@/lib/types';
import { formatProbability } from '@/lib/utils';

interface HardwareDetectionFeedProps {
  windows: HardwareWindowSchema[];
  alpha?: number;
}

export default function HardwareDetectionFeed({
  windows,
  alpha = 0.01,
}: HardwareDetectionFeedProps) {
  const [filter, setFilter] = useState<'all' | 'bursts_only' | 'calibration_only'>('all');

  // Filter windows
  const filteredWindows = windows.filter((w) => {
    if (filter === 'bursts_only') return w.is_burst === true;
    if (filter === 'calibration_only') return w.is_calibration === true;
    return true;
  });

  // Sort descending by window_index (newest first)
  const sortedWindows = [...filteredWindows].reverse();

  const getStatusBadge = (w: HardwareWindowSchema) => {
    const status = (w.detection_status || '').toLowerCase();
    if (w.is_burst === true || status === 'burst') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-[rgba(239,68,68,0.12)] text-[#ef4444] border border-[rgba(239,68,68,0.3)]">
          <Flame className="h-3 w-3" />
          <span>BURST</span>
        </span>
      );
    }
    if (status === 'normal') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-[rgba(34,197,94,0.1)] text-[#22c55e] border border-[rgba(34,197,94,0.25)]">
          <CheckCircle2 className="h-3 w-3" />
          <span>NORMAL</span>
        </span>
      );
    }
    if (status === 'calibrating' || w.is_calibration) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-[rgba(255,106,0,0.1)] text-[#FF6A00] border border-[rgba(255,106,0,0.25)]">
          <Clock className="h-3 w-3" />
          <span>CALIBRATING</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-[#191919] text-[#737373] border border-[#292929]">
        <HelpCircle className="h-3 w-3" />
        <span>UNAVAILABLE</span>
      </span>
    );
  };

  const getQualityBadge = (quality: string) => {
    const q = (quality || '').toLowerCase();
    if (q === 'complete_clean') {
      return <span className="text-[10px] font-mono text-emerald-400">CLEAN</span>;
    }
    if (q === 'complete_with_gaps') {
      return <span className="text-[10px] font-mono text-[#FF6A00]">GAPS</span>;
    }
    if (q === 'burst_contaminated') {
      return <span className="text-[10px] font-mono text-[#ef4444]">BURST_CONTAM</span>;
    }
    if (q === 'missing_nodes') {
      return <span className="text-[10px] font-mono text-amber-400">STALE_NODES</span>;
    }
    return <span className="text-[10px] font-mono text-[#737373]">{quality}</span>;
  };

  return (
    <div className="rounded-lg bg-[#141414] border border-[#292929] overflow-hidden">
      {/* Header & Filter Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 sm:p-5 border-b border-[#292929] bg-[#111111]">
        <div>
          <h3 className="font-heading text-sm font-semibold text-[#F5F5F5] uppercase tracking-wider">
            Observation-Window Detection Feed
          </h3>
          <p className="text-xs text-[#737373] mt-0.5">
            Chronological log of completed observation windows and authoritative Poisson detector decisions.
          </p>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1 p-0.5 rounded-md bg-[#191919] border border-[#292929] text-xs">
          <button
            onClick={() => setFilter('all')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              filter === 'all'
                ? 'bg-[#292929] text-[#F5F5F5]'
                : 'text-[#737373] hover:text-[#A3A3A3]'
            }`}
          >
            All ({windows.length})
          </button>
          <button
            onClick={() => setFilter('bursts_only')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              filter === 'bursts_only'
                ? 'bg-[rgba(239,68,68,0.2)] text-[#ef4444]'
                : 'text-[#737373] hover:text-[#A3A3A3]'
            }`}
          >
            Bursts ({windows.filter((w) => w.is_burst === true).length})
          </button>
          <button
            onClick={() => setFilter('calibration_only')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              filter === 'calibration_only'
                ? 'bg-[rgba(255,106,0,0.15)] text-[#FF6A00]'
                : 'text-[#737373] hover:text-[#A3A3A3]'
            }`}
          >
            Calibration ({windows.filter((w) => w.is_calibration).length})
          </button>
        </div>
      </div>

      {/* Feed Table */}
      {sortedWindows.length === 0 ? (
        <div className="p-8 text-center text-xs text-[#737373]">
          No observation windows matching filter &ldquo;{filter}&rdquo;.
        </div>
      ) : (
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-[#161616] text-[#737373] border-b border-[#292929] text-[10px] uppercase tracking-wider font-mono">
              <tr>
                <th className="py-2.5 px-4 font-medium">Window</th>
                <th className="py-2.5 px-4 font-medium">Arrivals (k)</th>
                <th className="py-2.5 px-4 font-medium">Baseline (λ)</th>
                <th className="py-2.5 px-4 font-medium">P-Value (α={alpha})</th>
                <th className="py-2.5 px-4 font-medium">Detector Decision</th>
                <th className="py-2.5 px-4 font-medium">Quality</th>
                <th className="py-2.5 px-4 font-medium">Node Breakdown</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#202020] font-mono text-[11px]">
              {sortedWindows.map((w) => {
                const isBurst = w.is_burst === true;
                return (
                  <tr
                    key={w.window_index}
                    className={`hover:bg-[#181818] transition-colors ${
                      isBurst ? 'bg-[rgba(239,68,68,0.04)]' : ''
                    }`}
                  >
                    {/* Window Index */}
                    <td className="py-2.5 px-4 text-[#F5F5F5] font-semibold">
                      #{w.window_index}
                    </td>

                    {/* Aggregate Count */}
                    <td className="py-2.5 px-4 font-bold text-[#F5F5F5]">
                      <span className={isBurst ? 'text-[#ef4444]' : 'text-[#F5F5F5]'}>
                        {w.aggregate_count}
                      </span>
                    </td>

                    {/* Baseline */}
                    <td className="py-2.5 px-4 text-[#A3A3A3]">
                      {w.expected_baseline_count !== null && w.expected_baseline_count !== undefined
                        ? w.expected_baseline_count
                        : '—'}
                    </td>

                    {/* P-Value */}
                    <td className="py-2.5 px-4">
                      {w.p_value !== null && w.p_value !== undefined ? (
                        <span
                          className={`font-semibold ${
                            isBurst ? 'text-[#ef4444]' : 'text-[#A3A3A3]'
                          }`}
                        >
                          {formatProbability(w.p_value)}
                        </span>
                      ) : (
                        <span className="text-[#555555]">N/A</span>
                      )}
                    </td>

                    {/* Detector Decision */}
                    <td className="py-2.5 px-4">
                      {getStatusBadge(w)}
                    </td>

                    {/* Quality */}
                    <td className="py-2.5 px-4">
                      {getQualityBadge(w.quality)}
                    </td>

                    {/* Node Breakdown */}
                    <td className="py-2.5 px-4 text-[10px] text-[#737373]">
                      {w.node_counts && (
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(w.node_counts).map(([nid, count]) => (
                            <span key={nid} className="bg-[#191919] px-1.5 py-0.5 rounded border border-[#242424] text-[#A3A3A3]">
                              {nid}: <strong className="text-[#F5F5F5]">{count}</strong>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
