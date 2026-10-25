'use client';

import React from 'react';
import { HardwareStatusResponse, NodeLivenessStatus } from '@/lib/types';
import HardwareNodeCard from './HardwareNodeCard';

interface HardwareNodeGridProps {
  status: HardwareStatusResponse | null;
  expectedNodes?: string[];
}

export default function HardwareNodeGrid({
  status,
  expectedNodes = ['node_1', 'node_2', 'node_3', 'node_4'],
}: HardwareNodeGridProps) {
  const allNodes = ['node_1', 'node_2', 'node_3', 'node_4'];
  const isActive = status?.has_active_session ?? false;

  const nodeCounts = status?.node_counts ?? {};
  const nodeLiveness = status?.node_liveness ?? {};
  const nodeLastSeen = status?.node_last_seen_utc ?? {};
  const nodeGaps = status?.node_gaps ?? {};
  const nodeDuplicates = status?.node_duplicates ?? {};
  const nodeBootIds = status?.node_boot_ids ?? {};
  const nodeBootTransitions = status?.node_boot_transitions ?? {};

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-heading text-sm font-semibold text-[#F5F5F5] uppercase tracking-wider">
          Hardware Nodes Status (4 Logical Nodes)
        </h3>
        <span className="text-xs text-[#737373]">
          Continuous time-based liveness tracking & Protocol V2 boot detection
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {allNodes.map((nodeId) => {
          const isExpected = expectedNodes.includes(nodeId);
          const liveness = (nodeLiveness[nodeId] as NodeLivenessStatus) || 'NEVER_OBSERVED';
          const validCount = nodeCounts[nodeId] ?? 0;
          const lastSeen = nodeLastSeen[nodeId] ?? null;
          const gaps = nodeGaps[nodeId] ?? 0;
          const duplicates = nodeDuplicates[nodeId] ?? 0;
          const bootId = nodeBootIds[nodeId] ?? null;
          const bootTransitions = nodeBootTransitions[nodeId] ?? 0;

          return (
            <HardwareNodeCard
              key={nodeId}
              nodeId={nodeId}
              isExpected={isExpected}
              liveness={liveness}
              validPacketsCount={validCount}
              lastSeq={null} // sequence numbers tracked at processor
              sequenceGapsCount={gaps}
              duplicatesCount={duplicates}
              lastSeenUtc={lastSeen}
              isActiveSession={isActive}
              bootId={bootId}
              bootTransitions={bootTransitions}
            />
          );
        })}
      </div>
    </div>
  );
}
