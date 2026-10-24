'use client';

import React from 'react';
import {
  Cpu,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { NodeLivenessStatus } from '@/lib/types';

interface HardwareNodeCardProps {
  nodeId: string;
  isExpected: boolean;
  liveness: NodeLivenessStatus | string;
  validPacketsCount: number;
  lastSeq: number | null;
  sequenceGapsCount: number;
  duplicatesCount: number;
  lastSeenUtc: string | null;
  isActiveSession: boolean;
}

export default function HardwareNodeCard({
  nodeId,
  isExpected,
  liveness,
  validPacketsCount,
  lastSeq,
  sequenceGapsCount,
  duplicatesCount,
  lastSeenUtc,
  isActiveSession,
}: HardwareNodeCardProps) {
  // Format last seen timestamp
  const formatTime = (isoString: string | null): string => {
    if (!isoString) return 'Never';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return isoString;
    }
  };

  const livenessStatus = (liveness || 'NEVER_OBSERVED').toUpperCase();

  const getBadgeConfig = () => {
    if (!isActiveSession) {
      return {
        label: isExpected ? 'CONFIGURED' : 'UNCONFIGURED',
        style: 'bg-[#191919] text-[#737373] border-[#292929]',
        icon: null,
      };
    }

    switch (livenessStatus) {
      case 'ACTIVE':
        return {
          label: 'ACTIVE',
          style: 'bg-[rgba(34,197,94,0.1)] text-[#22c55e] border-[rgba(34,197,94,0.3)]',
          dot: true,
        };
      case 'STALE':
        return {
          label: 'STALE',
          style: 'bg-[rgba(255,106,0,0.12)] text-[#FF6A00] border-[rgba(255,106,0,0.35)]',
          icon: Clock,
        };
      case 'NEVER_OBSERVED':
      default:
        return {
          label: 'NEVER OBSERVED',
          style: 'bg-[#191919] text-[#737373] border-[#292929]',
          icon: null,
        };
    }
  };

  const badge = getBadgeConfig();

  return (
    <div
      className={`rounded-lg bg-[#141414] border p-4 transition-all flex flex-col justify-between ${
        livenessStatus === 'ACTIVE'
          ? 'border-[rgba(34,197,94,0.25)] hover:border-[rgba(34,197,94,0.4)]'
          : livenessStatus === 'STALE'
          ? 'border-[rgba(255,106,0,0.3)] hover:border-[rgba(255,106,0,0.5)]'
          : 'border-[#292929] hover:border-[#383838]'
      }`}
    >
      {/* Node Header */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded bg-[#191919] border border-[#292929] flex items-center justify-center text-[#A3A3A3]">
              <Cpu className="h-3.5 w-3.5 text-[#FF6A00]" />
            </div>
            <div>
              <h4 className="font-mono text-sm font-bold text-[#F5F5F5]">{nodeId}</h4>
              <span className="text-[10px] text-[#737373]">
                {isExpected ? 'Expected Node' : 'Unconfigured'}
              </span>
            </div>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-medium border ${badge.style}`}
          >
            {badge.dot && (
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            )}
            {badge.icon && <badge.icon className="h-3 w-3" />}
            <span>{badge.label}</span>
          </span>
        </div>

        {/* Primary Packet Count */}
        <div className="mb-3 p-2.5 rounded bg-[#191919] border border-[#242424] flex items-baseline justify-between">
          <span className="text-[11px] text-[#737373] font-medium uppercase tracking-wider">
            Valid Datagrams
          </span>
          <span className="font-mono text-xl font-bold text-[#F5F5F5]">
            {validPacketsCount.toLocaleString()}
          </span>
        </div>

        {/* Technical Stats Grid */}
        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
          <div className="p-2 rounded bg-[#101010] border border-[#202020]">
            <span className="text-[10px] text-[#737373] block uppercase font-sans">Last Sequence</span>
            <span className="text-xs text-[#A3A3A3] font-medium">
              {lastSeq !== null ? `#${lastSeq}` : '—'}
            </span>
          </div>

          <div className="p-2 rounded bg-[#101010] border border-[#202020]">
            <span className="text-[10px] text-[#737373] block uppercase font-sans">Last Seen</span>
            <span className="text-xs text-[#A3A3A3] font-medium">
              {formatTime(lastSeenUtc)}
            </span>
          </div>

          <div className="p-2 rounded bg-[#101010] border border-[#202020]">
            <span className="text-[10px] text-[#737373] block uppercase font-sans flex items-center justify-between">
              <span>Seq Gaps</span>
            </span>
            <span className={`text-xs font-medium ${sequenceGapsCount > 0 ? 'text-[#FF6A00]' : 'text-[#A3A3A3]'}`}>
              {sequenceGapsCount}
            </span>
          </div>

          <div className="p-2 rounded bg-[#101010] border border-[#202020]">
            <span className="text-[10px] text-[#737373] block uppercase font-sans">Duplicates</span>
            <span className={`text-xs font-medium ${duplicatesCount > 0 ? 'text-[#FF6A00]' : 'text-[#A3A3A3]'}`}>
              {duplicatesCount}
            </span>
          </div>
        </div>
      </div>

      {/* Footer Diagnostic Note */}
      {isActiveSession && livenessStatus === 'STALE' && (
        <div className="mt-3 pt-2 border-t border-[#242424] flex items-center gap-1.5 text-[10px] text-[#FF6A00]">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span>Exceeded inactivity timeout. Check physical board or Wi-Fi.</span>
        </div>
      )}
      {isActiveSession && livenessStatus === 'NEVER_OBSERVED' && isExpected && (
        <div className="mt-3 pt-2 border-t border-[#242424] flex items-center gap-1.5 text-[10px] text-[#737373]">
          <Clock className="h-3 w-3 shrink-0" />
          <span>No UDP datagrams received yet from this node.</span>
        </div>
      )}
    </div>
  );
}
