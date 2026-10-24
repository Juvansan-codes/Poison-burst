'use client';

import React from 'react';
import {
  Activity,
  Layers,
  Flame,
  Gauge,
  Cpu,
  BarChart2,
} from 'lucide-react';
import { HardwareStatusResponse } from '@/lib/types';
import MetricCard from '@/components/ui/MetricCard';

interface HardwareMetricCardsProps {
  status: HardwareStatusResponse | null;
}

export default function HardwareMetricCards({ status }: HardwareMetricCardsProps) {
  const isActive = status?.has_active_session ?? false;

  const validDatagrams = status?.valid_datagrams ?? 0;
  const completedWindows = status?.completed_windows_count ?? 0;
  const burstCount = status?.burst_windows_count ?? 0;

  // Active nodes count
  const nodeLiveness = status?.node_liveness ?? {};
  const activeNodesCount = Object.values(nodeLiveness).filter((st) => st === 'ACTIVE').length;
  const totalNodesCount = Object.keys(nodeLiveness).length || 4;

  // Baseline string
  let baselineDisplay = '—';
  let baselineBadge: 'neutral' | 'accent' | 'success' = 'neutral';
  if (status?.is_calibrated && status.baseline_expected_count !== null) {
    baselineDisplay = `${status.baseline_expected_count}`;
    baselineBadge = 'success';
  } else if (status?.state === 'CALIBRATING') {
    baselineDisplay = 'Calibrating...';
    baselineBadge = 'accent';
  }

  // Estimated arrival rate
  const rateDisplay =
    status?.baseline_rate_per_second !== null && status?.baseline_rate_per_second !== undefined
      ? `${status.baseline_rate_per_second.toFixed(1)}/s`
      : isActive
      ? `${(validDatagrams / Math.max(1, completedWindows * 1.0)).toFixed(1)}/win`
      : '—';

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
      {/* 1. Valid Datagrams */}
      <MetricCard
        label="Valid Datagrams"
        value={isActive ? validDatagrams.toLocaleString() : '—'}
        helper="Accepted UDP telemetry"
        icon={Activity}
        badge={isActive ? 'Streaming' : undefined}
        badgeVariant="accent"
      />

      {/* 2. Observed Rate */}
      <MetricCard
        label="Mean Arrival Rate"
        value={rateDisplay}
        helper={status?.is_calibrated ? 'Frozen baseline rate' : 'Mean events per window'}
        icon={Gauge}
      />

      {/* 3. Completed Windows */}
      <MetricCard
        label="Tumbled Windows"
        value={isActive ? completedWindows.toLocaleString() : '—'}
        helper="Completed intervals"
        icon={Layers}
      />

      {/* 4. Burst Detections */}
      <MetricCard
        label="Burst Detections"
        value={isActive ? burstCount.toLocaleString() : '—'}
        helper="Windows with p < alpha"
        icon={Flame}
        highlight={burstCount > 0}
        badge={burstCount > 0 ? `${burstCount} ALERTS` : undefined}
        badgeVariant={burstCount > 0 ? 'error' : 'neutral'}
      />

      {/* 5. Baseline Expected */}
      <MetricCard
        label="Poisson Baseline (λ)"
        value={baselineDisplay}
        helper={status?.is_calibrated ? 'Locked for monitoring' : 'Calibrating clean traffic'}
        icon={BarChart2}
        badge={status?.is_calibrated ? 'CALIBRATED' : undefined}
        badgeVariant={baselineBadge}
      />

      {/* 6. Active Nodes */}
      <MetricCard
        label="Active Nodes"
        value={isActive ? `${activeNodesCount} / ${totalNodesCount}` : '—'}
        helper="Health: node_1 .. node_4"
        icon={Cpu}
        badge={isActive && activeNodesCount === totalNodesCount ? 'All Healthy' : undefined}
        badgeVariant={activeNodesCount === totalNodesCount ? 'success' : 'accent'}
      />
    </div>
  );
}
