'use client';

import React from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity } from 'lucide-react';
import { HardwareWindowSchema } from '@/lib/types';
import { formatProbability } from '@/lib/utils';
import EmptyState from '@/components/ui/EmptyState';

interface HardwareLiveChartProps {
  windows: HardwareWindowSchema[];
  baselineExpectedCount?: number | null;
  alpha?: number;
  isActive: boolean;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: HardwareWindowSchema & { is_burst_point?: number } }>;
}

function CustomHardwareTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || !payload.length) return null;

  const data = payload[0].payload;
  const isBurst = data.is_burst === true;
  const isCalib = data.is_calibration;

  return (
    <div className="bg-[#141414] border border-[#292929] rounded-lg p-3 shadow-2xl text-xs space-y-2 min-w-[220px]">
      <div className="flex items-center justify-between border-b border-[#292929] pb-1.5">
        <span className="font-heading font-semibold text-[#F5F5F5]">
          Window #{data.window_index}
        </span>
        <span
          className={`font-mono text-[10px] px-1.5 py-0.5 rounded font-medium uppercase ${
            isBurst
              ? 'bg-[rgba(239,68,68,0.15)] text-[#ef4444] border border-[rgba(239,68,68,0.3)]'
              : isCalib
              ? 'bg-[rgba(255,106,0,0.12)] text-[#FF6A00] border border-[rgba(255,106,0,0.25)]'
              : 'bg-[rgba(34,197,94,0.12)] text-[#22c55e] border border-[rgba(34,197,94,0.25)]'
          }`}
        >
          {data.detection_status}
        </span>
      </div>

      <div className="space-y-1 font-mono text-[11px]">
        <div className="flex justify-between">
          <span className="text-[#737373]">Observed Count (k):</span>
          <strong className="text-[#F5F5F5]">{data.aggregate_count} pkts</strong>
        </div>

        {data.expected_baseline_count !== null && data.expected_baseline_count !== undefined && (
          <div className="flex justify-between">
            <span className="text-[#737373]">Expected Baseline (λ):</span>
            <span className="text-[#FF6A00]">{data.expected_baseline_count} pkts</span>
          </div>
        )}

        {data.p_value !== null && data.p_value !== undefined && (
          <div className="flex justify-between">
            <span className="text-[#737373]">P(X ≥ k | λ):</span>
            <span className={`font-semibold ${isBurst ? 'text-[#ef4444]' : 'text-[#A3A3A3]'}`}>
              {formatProbability(data.p_value)}
            </span>
          </div>
        )}

        <div className="flex justify-between">
          <span className="text-[#737373]">Quality:</span>
          <span className="text-[#A3A3A3] text-[10px] uppercase">{data.quality}</span>
        </div>
      </div>

      {/* Node breakdown */}
      {data.node_counts && Object.keys(data.node_counts).length > 0 && (
        <div className="pt-1.5 border-t border-[#242424]">
          <span className="text-[10px] text-[#737373] uppercase font-sans block mb-1">
            Node Arrivals:
          </span>
          <div className="grid grid-cols-2 gap-1 text-[10px] font-mono">
            {Object.entries(data.node_counts).map(([nid, count]) => (
              <span key={nid} className="text-[#A3A3A3]">
                {nid}: <strong className="text-[#F5F5F5]">{count}</strong>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function HardwareLiveChart({
  windows,
  baselineExpectedCount,
  alpha = 0.01,
  isActive,
}: HardwareLiveChartProps) {
  if (!windows || windows.length === 0) {
    return (
      <div className="rounded-lg bg-[#141414] border border-[#292929] p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-[#FF6A00]" />
            <h3 className="font-heading text-sm font-semibold text-[#F5F5F5] uppercase tracking-wider">
              Live Observation-Window Stream
            </h3>
          </div>
          <span className="text-xs text-[#737373] font-mono">
            {isActive ? 'Awaiting incoming windows...' : 'Session Inactive'}
          </span>
        </div>
        <EmptyState
          icon={Activity}
          title={isActive ? 'Collecting First Observation Window' : 'No Active Hardware Session'}
          description={
            isActive
              ? 'Receiver is active and aggregating UDP arrivals. The first completed tumbling window will appear momentarily.'
              : 'Start a hardware session and transmit UDP telemetry from physical Arduino boards or the localhost simulator.'
          }
        />
      </div>
    );
  }

  // Prepare chart dataset: attach a burst scatter point if window triggered burst
  const chartData = windows.map((w) => ({
    ...w,
    burst_marker: w.is_burst === true ? w.aggregate_count : null,
  }));

  const maxCount = Math.max(
    ...windows.map((w) => w.aggregate_count),
    baselineExpectedCount ? Math.ceil(baselineExpectedCount * 1.5) : 10
  );

  return (
    <div className="rounded-lg bg-[#141414] border border-[#292929] p-4 sm:p-5">
      {/* Chart Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-[#FF6A00]" />
            <h3 className="font-heading text-sm font-semibold text-[#F5F5F5] uppercase tracking-wider">
              Live Observation-Window Stream
            </h3>
            <span className="text-xs px-2 py-0.5 rounded bg-[#191919] border border-[#292929] text-[#A3A3A3] font-mono">
              {windows.length} Windows
            </span>
          </div>
          <p className="text-xs text-[#737373] mt-0.5">
            Plotting aggregate arrivals (k) against the calibrated Poisson baseline rate (λ).
          </p>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-[#FF6A00]" />
            <span className="text-[#A3A3A3]">Observed (k)</span>
          </div>

          {baselineExpectedCount !== null && baselineExpectedCount !== undefined && (
            <div className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 bg-[#22c55e] border-t border-dashed" />
              <span className="text-[#22c55e]">Baseline (λ = {baselineExpectedCount})</span>
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#ef4444]" />
            <span className="text-[#ef4444]">Burst (p &lt; {alpha})</span>
          </div>
        </div>
      </div>

      {/* Chart Visualization */}
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="hardwareAreaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#FF6A00" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#FF6A00" stopOpacity={0.0} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="#222222" vertical={false} />

            <XAxis
              dataKey="window_index"
              tickFormatter={(val) => `W#${val}`}
              stroke="#555555"
              fontSize={11}
              fontFamily="var(--font-jetbrains-mono)"
              tickLine={false}
              axisLine={{ stroke: '#292929' }}
            />

            <YAxis
              domain={[0, maxCount + 2]}
              stroke="#555555"
              fontSize={11}
              fontFamily="var(--font-jetbrains-mono)"
              tickLine={false}
              axisLine={{ stroke: '#292929' }}
            />

            <Tooltip content={<CustomHardwareTooltip />} />

            {/* Baseline Expected Count Line */}
            {baselineExpectedCount !== null && baselineExpectedCount !== undefined && (
              <ReferenceLine
                y={baselineExpectedCount}
                stroke="#22c55e"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                label={{
                  value: `λ = ${baselineExpectedCount}`,
                  position: 'right',
                  fill: '#22c55e',
                  fontSize: 10,
                  fontFamily: 'var(--font-jetbrains-mono)',
                }}
              />
            )}

            {/* Observed Count Area & Line */}
            <Area
              type="monotone"
              dataKey="aggregate_count"
              stroke="#FF6A00"
              strokeWidth={2}
              fill="url(#hardwareAreaGradient)"
              isAnimationActive={false}
            />

            {/* Burst Positive Red Markers */}
            <Scatter
              dataKey="burst_marker"
              fill="#ef4444"
              shape="circle"
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
