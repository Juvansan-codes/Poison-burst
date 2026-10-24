'use client';

import React from 'react';
import {
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { HardwareStatusResponse } from '@/lib/types';

interface HardwareCalibrationPanelProps {
  status: HardwareStatusResponse | null;
  loading: boolean;
  onFinalizeCalibration: () => Promise<void>;
  minRequiredWindows?: number;
}

export default function HardwareCalibrationPanel({
  status,
  loading,
  onFinalizeCalibration,
  minRequiredWindows = 10,
}: HardwareCalibrationPanelProps) {
  const isCalibrating = status?.state === 'CALIBRATING';
  const isMonitoring = status?.state === 'MONITORING';

  if (!status?.has_active_session && status?.state !== 'CALIBRATING' && status?.state !== 'MONITORING') {
    return null;
  }

  const eligibleCount = status?.calibration_windows_count ?? 0;
  const progressRatio = Math.min(1.0, eligibleCount / (minRequiredWindows || 1));
  const progressPercent = Math.round(progressRatio * 100);
  const isReadyToFinalize = eligibleCount >= minRequiredWindows;

  return (
    <div
      className={`rounded-lg border p-4 sm:p-5 transition-all ${
        isCalibrating
          ? 'bg-gradient-to-r from-[#171310] via-[#141414] to-[#141414] border-[rgba(255,106,0,0.3)]'
          : 'bg-[#141414] border-[#292929]'
      }`}
    >
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#FF6A00] animate-pulse" />
            <h3 className="font-heading text-base font-bold text-[#F5F5F5]">
              {isCalibrating ? 'Baseline Calibration Phase' : 'Baseline Calibration Frozen'}
            </h3>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-[rgba(255,106,0,0.12)] text-[#FF6A00] border border-[rgba(255,106,0,0.25)]">
              {isCalibrating ? 'In Progress' : 'Calibrated'}
            </span>
          </div>
          <p className="text-xs text-[#737373] mt-1 max-w-2xl leading-relaxed">
            {isCalibrating
              ? 'Collecting clean observation windows without burst traffic to establish the normal Poisson expected arrival rate (lambda).'
              : `Baseline arrival rate established and locked at lambda = ${status?.baseline_expected_count ?? '—'} arrivals/window for Poisson burst detection.`}
          </p>
        </div>

        {isCalibrating && (
          <div className="flex items-center gap-3 w-full md:w-auto justify-end">
            <button
              onClick={onFinalizeCalibration}
              disabled={loading || !isReadyToFinalize}
              className={`btn-primary w-full md:w-auto justify-center ${
                !isReadyToFinalize ? 'opacity-50 cursor-not-allowed bg-[#292929] text-[#737373] hover:bg-[#292929]' : ''
              }`}
              title={
                !isReadyToFinalize
                  ? `Need at least ${minRequiredWindows} eligible windows to finalize calibration.`
                  : 'Click to freeze baseline rate and transition to real-time burst monitoring.'
              }
            >
              <Sparkles className="h-4 w-4" />
              <span>Finalize Baseline Calibration</span>
            </button>
          </div>
        )}
      </div>

      {/* Progress Bar & Details */}
      {isCalibrating && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#A3A3A3] font-medium flex items-center gap-1.5">
              <span>Eligible Calibration Windows:</span>
              <strong className="font-mono text-[#F5F5F5]">{eligibleCount}</strong>
              <span className="text-[#737373]">/ {minRequiredWindows} required</span>
            </span>
            <span className="font-mono text-[#FF6A00] font-semibold">
              {progressPercent}%
            </span>
          </div>

          {/* Track */}
          <div className="h-2 w-full rounded-full bg-[#1e1e1e] border border-[#292929] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#FF6A00] to-[#FF8C33] transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Statistical Helper Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div className="p-2.5 rounded bg-[#191919] border border-[#242424] text-xs">
              <span className="text-[10px] text-[#737373] uppercase font-medium block">Eligibility Rule</span>
              <p className="text-[#A3A3A3] text-[11px] mt-0.5">
                Windows must be complete and free of mode=burst telemetry or sequence gaps. Zero arrivals from healthy nodes are valid.
              </p>
            </div>

            <div className="p-2.5 rounded bg-[#191919] border border-[#242424] text-xs">
              <span className="text-[10px] text-[#737373] uppercase font-medium block">Preliminary Lambda</span>
              <p className="font-mono text-xs text-[#F5F5F5] mt-0.5">
                {status?.baseline_expected_count !== null && status?.baseline_expected_count !== undefined
                  ? `${status.baseline_expected_count} pkts/win`
                  : 'Computing from windows...'}
              </p>
            </div>

            <div className="p-2.5 rounded bg-[#191919] border border-[#242424] text-xs">
              <span className="text-[10px] text-[#737373] uppercase font-medium block">Transition Trigger</span>
              <p className="text-[11px] text-[#A3A3A3] mt-0.5">
                {isReadyToFinalize
                  ? 'Target reached. You may now finalize calibration.'
                  : `Waiting for ${Math.max(0, minRequiredWindows - eligibleCount)} more clean windows.`}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Monitoring State Summary */}
      {isMonitoring && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
          <div className="p-2.5 rounded bg-[#191919] border border-[#242424]">
            <span className="text-[10px] text-[#737373] uppercase font-medium block">Frozen Baseline (λ)</span>
            <span className="font-mono text-sm font-bold text-[#FF6A00]">
              {status?.baseline_expected_count ?? '—'} <span className="text-[10px] text-[#737373] font-normal">pkts/win</span>
            </span>
          </div>

          <div className="p-2.5 rounded bg-[#191919] border border-[#242424]">
            <span className="text-[10px] text-[#737373] uppercase font-medium block">Equivalent Rate</span>
            <span className="font-mono text-sm font-bold text-[#F5F5F5]">
              {status?.baseline_rate_per_second !== null && status?.baseline_rate_per_second !== undefined
                ? `${status.baseline_rate_per_second.toFixed(2)}`
                : '—'}{' '}
              <span className="text-[10px] text-[#737373] font-normal">pkts/sec</span>
            </span>
          </div>

          <div className="p-2.5 rounded bg-[#191919] border border-[#242424]">
            <span className="text-[10px] text-[#737373] uppercase font-medium block">Calibration Windows</span>
            <span className="font-mono text-sm font-bold text-[#F5F5F5]">
              {status?.calibration_windows_count ?? 0}
            </span>
          </div>

          <div className="p-2.5 rounded bg-[#191919] border border-[#242424]">
            <span className="text-[10px] text-[#737373] uppercase font-medium block">Detector State</span>
            <span className="font-mono text-sm font-bold text-emerald-400 flex items-center gap-1.5 mt-0.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Monitoring Active</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
