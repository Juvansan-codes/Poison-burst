'use client';

import React from 'react';
import {
  ShieldAlert,
  AlertTriangle,
  Radio,
} from 'lucide-react';
import { HardwareStatusResponse } from '@/lib/types';

interface HardwareDataQualityPanelProps {
  status: HardwareStatusResponse | null;
}

export default function HardwareDataQualityPanel({ status }: HardwareDataQualityPanelProps) {
  const malformedCount = status?.malformed_datagrams ?? 0;
  const totalDatagrams = status?.total_socket_datagrams ?? 0;
  const validDatagrams = status?.valid_datagrams ?? 0;

  // Aggregate sequence gaps & duplicates across nodes
  const nodeGaps = status?.node_gaps ?? {};
  const totalGaps = Object.values(nodeGaps).reduce((sum, val) => sum + val, 0);

  const nodeDuplicates = status?.node_duplicates ?? {};
  const totalDuplicates = Object.values(nodeDuplicates).reduce((sum, val) => sum + val, 0);

  const nodeLiveness = status?.node_liveness ?? {};
  const staleNodes = Object.entries(nodeLiveness)
    .filter(([, st]) => st === 'STALE')
    .map(([nid]) => nid);
  const neverObservedNodes = Object.entries(nodeLiveness)
    .filter(([, st]) => st === 'NEVER_OBSERVED')
    .map(([nid]) => nid);

  return (
    <div className="rounded-lg bg-[#141414] border border-[#292929] p-4 sm:p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-[#242424]">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-[#FF6A00]" />
          <h3 className="font-heading text-sm font-semibold text-[#F5F5F5] uppercase tracking-wider">
            Data Quality &amp; Network Diagnostics
          </h3>
        </div>
        <span className="text-[11px] text-[#737373]">
          UDP Transport Integrity
        </span>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        {/* Malformed Datagrams */}
        <div className="p-3 rounded bg-[#191919] border border-[#242424]">
          <span className="text-[10px] text-[#737373] uppercase font-medium block">
            Malformed Packets
          </span>
          <span className={`font-mono text-base font-bold mt-1 block ${malformedCount > 0 ? 'text-[#ef4444]' : 'text-[#F5F5F5]'}`}>
            {malformedCount}
          </span>
          <p className="text-[10px] text-[#737373] mt-1">Rejected syntax / invalid UTF-8</p>
        </div>

        {/* Sequence Gaps */}
        <div className="p-3 rounded bg-[#191919] border border-[#242424]">
          <span className="text-[10px] text-[#737373] uppercase font-medium block">
            Sequence Gaps
          </span>
          <span className={`font-mono text-base font-bold mt-1 block ${totalGaps > 0 ? 'text-[#FF6A00]' : 'text-[#F5F5F5]'}`}>
            {totalGaps}
          </span>
          <p className="text-[10px] text-[#737373] mt-1">Discontinuities in sequence numbers</p>
        </div>

        {/* Duplicate / Reordered Packets */}
        <div className="p-3 rounded bg-[#191919] border border-[#242424]">
          <span className="text-[10px] text-[#737373] uppercase font-medium block">
            Duplicates / Out-of-Order
          </span>
          <span className={`font-mono text-base font-bold mt-1 block ${totalDuplicates > 0 ? 'text-[#FF6A00]' : 'text-[#F5F5F5]'}`}>
            {totalDuplicates}
          </span>
          <p className="text-[10px] text-[#737373] mt-1">Deduplicated from arrival counts</p>
        </div>

        {/* Transport Health */}
        <div className="p-3 rounded bg-[#191919] border border-[#242424]">
          <span className="text-[10px] text-[#737373] uppercase font-medium block">
            Transport Fidelity
          </span>
          <span className="font-mono text-base font-bold mt-1 block text-emerald-400">
            {totalDatagrams > 0
              ? `${((validDatagrams / totalDatagrams) * 100).toFixed(1)}%`
              : '100.0%'}
          </span>
          <p className="text-[10px] text-[#737373] mt-1">Valid vs total received datagrams</p>
        </div>
      </div>

      {/* Warnings & Active Issues */}
      {(staleNodes.length > 0 || neverObservedNodes.length > 0 || malformedCount > 0) && (
        <div className="space-y-2 pt-1">
          {staleNodes.length > 0 && (
            <div className="p-2.5 rounded bg-[rgba(255,106,0,0.08)] border border-[rgba(255,106,0,0.25)] flex items-start gap-2 text-xs text-[#FF6A00]">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <strong>Stale Node Inactivity:</strong> Nodes {staleNodes.join(', ')} have not produced datagrams within the configured timeout. Windows during this period are marked ineligible for baseline calibration.
              </div>
            </div>
          )}

          {neverObservedNodes.length > 0 && (
            <div className="p-2.5 rounded bg-[#191919] border border-[#292929] flex items-start gap-2 text-xs text-[#A3A3A3]">
              <Radio className="h-4 w-4 shrink-0 mt-0.5 text-[#737373]" />
              <div>
                <strong>Awaiting First Transmission:</strong> Expected nodes {neverObservedNodes.join(', ')} have not yet been observed. Start physical Arduinos or launch the localhost simulator.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Educational Technical Note */}
      <div className="p-3 rounded bg-[#101010] border border-[#202020] text-[11px] text-[#737373] leading-relaxed">
        <strong className="text-[#A3A3A3] block mb-0.5">Statistical &amp; Transport Note:</strong>
        UDP provides best-effort, connectionless transmission. Sequence gaps represent estimated transmission omissions and are not counted as event arrivals. Legitimate zero-arrival windows from healthy nodes remain eligible for Poisson rate calibration.
      </div>
    </div>
  );
}
