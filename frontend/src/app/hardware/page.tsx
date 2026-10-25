'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  ExternalLink,
  RefreshCw,
  X,
} from 'lucide-react';
import { api, ApiClientError } from '@/lib/api';
import {
  HardwareStartRequest,
  HardwareStatusResponse,
  HardwareStopResponse,
  HardwareWindowSchema,
} from '@/lib/types';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import HardwareSessionControls from '@/components/hardware/HardwareSessionControls';
import HardwareMetricCards from '@/components/hardware/HardwareMetricCards';
import HardwareCalibrationPanel from '@/components/hardware/HardwareCalibrationPanel';
import HardwareNodeGrid from '@/components/hardware/HardwareNodeGrid';
import HardwareLiveChart from '@/components/hardware/HardwareLiveChart';
import HardwareDetectionFeed from '@/components/hardware/HardwareDetectionFeed';
import HardwareDataQualityPanel from '@/components/hardware/HardwareDataQualityPanel';
import HardwareSimulatorGuide from '@/components/hardware/HardwareSimulatorGuide';

const POLLING_INTERVAL_MS = 1500;
const MAX_STORED_WINDOWS = 200;

export default function HardwareLabPage() {
  // Session State
  const [status, setStatus] = useState<HardwareStatusResponse | null>(null);
  const [windows, setWindows] = useState<HardwareWindowSchema[]>([]);
  const [lastSummary, setLastSummary] = useState<HardwareStopResponse | null>(null);

  // Operational State
  const [loadingAction, setLoadingAction] = useState<boolean>(false);
  const [retryingPersistence, setRetryingPersistence] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [expectedNodes, setExpectedNodes] = useState<string[]>([
    'node_1',
    'node_2',
    'node_3',
    'node_4',
  ]);

  // Polling Refs
  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isPollingRef = useRef<boolean>(false);
  const highestWindowIndexRef = useRef<number>(-1);
  const pollCycleRef = useRef<() => Promise<void>>(async () => {});

  // Stop polling helper
  const stopPolling = useCallback(() => {
    if (pollingTimerRef.current) {
      clearTimeout(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
    isPollingRef.current = false;
  }, []);

  // Fetch status and live windows
  const pollCycle = useCallback(async () => {
    if (document.hidden) {
      // Pause polling if tab is backgrounded
      if (isPollingRef.current) {
        pollingTimerRef.current = setTimeout(() => {
          pollCycleRef.current();
        }, POLLING_INTERVAL_MS * 2);
      }
      return;
    }

    try {
      // 1. Fetch current operational status
      const statusRes = await api.getHardwareStatus();
      setStatus(statusRes);
      setApiError(null);

      // 2. If active session, fetch latest completed observation windows
      if (statusRes.has_active_session) {
        // Query recent windows (using incremental polling after highest seen index)
        const afterIdx = highestWindowIndexRef.current >= 0 ? highestWindowIndexRef.current : undefined;
        const liveRes = await api.getHardwareLive(50, afterIdx);

        if (liveRes.windows && liveRes.windows.length > 0) {
          setWindows((prev) => {
            // Merge existing and new windows, avoiding duplicate window_index
            const seen = new Set(prev.map((w) => w.window_index));
            const newOnes = liveRes.windows.filter((w) => !seen.has(w.window_index));
            if (newOnes.length === 0) return prev;

            const combined = [...prev, ...newOnes];

            // Sort ascending by window_index
            combined.sort((a, b) => a.window_index - b.window_index);

            // Update highest window index tracker
            if (combined.length > 0) {
              highestWindowIndexRef.current = combined[combined.length - 1].window_index;
            }

            // Cap rolling display buffer to MAX_STORED_WINDOWS
            return combined.slice(-MAX_STORED_WINDOWS);
          });
        }
      } else {
        // No active session
        if (statusRes.state === 'STOPPED' || statusRes.state === 'IDLE') {
          stopPolling();
        }
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        setApiError(err.message);
      } else {
        setApiError('Lost connection to backend API server at 127.0.0.1:8000.');
      }
    } finally {
      if (isPollingRef.current) {
        pollingTimerRef.current = setTimeout(() => {
          pollCycleRef.current();
        }, POLLING_INTERVAL_MS);
      }
    }
  }, [stopPolling]);

  // Keep ref up to date
  useEffect(() => {
    pollCycleRef.current = pollCycle;
  }, [pollCycle]);

  // Start polling
  const startPolling = useCallback(() => {
    stopPolling();
    isPollingRef.current = true;
    pollCycle();
  }, [pollCycle, stopPolling]);

  // Initial Load: check if session is already active
  useEffect(() => {
    let isMounted = true;
    api
      .getHardwareStatus()
      .then((initialStatus) => {
        if (!isMounted) return;
        setStatus(initialStatus);

        if (initialStatus.has_active_session) {
          startPolling();
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setApiError(
          err instanceof ApiClientError
            ? err.message
            : 'Unable to connect to PoissonBurst backend on port 8000.'
        );
      });

    return () => {
      isMounted = false;
      stopPolling();
    };
  }, [startPolling, stopPolling]);

  // Handler: Start Session
  const handleStartSession = async (req: HardwareStartRequest) => {
    setLoadingAction(true);
    setApiError(null);
    setLastSummary(null);
    setWindows([]);
    highestWindowIndexRef.current = -1;

    try {
      const startRes = await api.startHardwareSession(req);
      setExpectedNodes(startRes.expected_nodes || ['node_1', 'node_2', 'node_3', 'node_4']);

      // Fetch immediate fresh status
      const freshStatus = await api.getHardwareStatus();
      setStatus(freshStatus);

      // Begin continuous background polling
      startPolling();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setApiError(err.message);
      } else {
        setApiError('Failed to start hardware session. Check socket permissions or port availability.');
      }
    } finally {
      setLoadingAction(false);
    }
  };

  // Handler: Finalize Calibration
  const handleFinalizeCalibration = async () => {
    setLoadingAction(true);
    setApiError(null);

    try {
      await api.finalizeHardwareCalibration();
      // Fetch immediate status to reflect MONITORING
      const freshStatus = await api.getHardwareStatus();
      setStatus(freshStatus);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setApiError(err.message);
      } else {
        setApiError('Failed to finalize calibration.');
      }
    } finally {
      setLoadingAction(false);
    }
  };

  // Handler: Stop Session
  const handleStopSession = async () => {
    setLoadingAction(true);
    setApiError(null);

    try {
      const summary = await api.stopHardwareSession();
      setLastSummary(summary);
      stopPolling();

      // Fetch fresh stopped status
      const stoppedStatus = await api.getHardwareStatus();
      setStatus(stoppedStatus);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setApiError(err.message);
      } else {
        setApiError('Failed to stop hardware session.');
      }
    } finally {
      setLoadingAction(false);
    }
  };

  // Handler: Retry Persistence
  const handleRetryPersistence = async () => {
    if (!lastSummary) return;
    setRetryingPersistence(true);
    setApiError(null);

    try {
      const retried = await api.retryHardwarePersistence(lastSummary.session_id);
      setLastSummary(retried);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setApiError(err.message);
      } else {
        setApiError('Failed to retry hardware experiment persistence.');
      }
    } finally {
      setRetryingPersistence(false);
    }
  };

  return (
    <div className="page-container py-6 sm:py-8 space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Hardware Lab"
        badge="Live Telemetry"
        subtitle="Real-time UDP datagram aggregation, baseline calibration, and independent Poisson traffic-burst detection."
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge
              label={
                status?.has_active_session
                  ? `Active (${status.state})`
                  : 'Session Idle'
              }
              variant={
                status?.state === 'MONITORING'
                  ? 'success'
                  : status?.state === 'CALIBRATING'
                  ? 'accent'
                  : 'neutral'
              }
            />
          </div>
        }
      />

      {/* Global API Error Alert */}
      {apiError && (
        <div className="p-4 rounded-lg bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.3)] flex items-start justify-between gap-3 text-xs text-[#ef4444]">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <strong className="block font-semibold">Backend Connection Alert</strong>
              <p className="mt-0.5 leading-relaxed">{apiError}</p>
            </div>
          </div>
          <button
            onClick={() => setApiError(null)}
            className="p-1 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Stopped Session Final Summary Modal / Banner */}
      {lastSummary && (
        <div className="p-4 sm:p-5 rounded-lg bg-[#141414] border border-[#292929] space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-[#242424]">
            <div className="flex flex-wrap items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              <h4 className="font-heading text-sm font-semibold text-[#F5F5F5]">
                Hardware Session Summary ({lastSummary.session_id.substring(0, 8)}...)
              </h4>
              {lastSummary.persisted ? (
                <StatusBadge label="Saved to SQLite" variant="success" />
              ) : (
                <StatusBadge label="Persistence Failed" variant="error" />
              )}
            </div>
            <button
              onClick={() => setLastSummary(null)}
              className="text-xs text-[#737373] hover:text-[#F5F5F5]"
            >
              Dismiss
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
            <div className="p-2.5 rounded bg-[#191919] border border-[#242424]">
              <span className="text-[10px] text-[#737373] font-sans uppercase block">Valid Datagrams</span>
              <span className="text-sm font-bold text-[#F5F5F5]">{lastSummary.total_valid_datagrams.toLocaleString()}</span>
              {(lastSummary.duplicate_datagrams ?? 0) > 0 && (
                <span className="text-[10px] text-yellow-500 font-sans block mt-0.5">
                  {lastSummary.unique_datagrams ?? 0} unique, {lastSummary.duplicate_datagrams} filtered
                </span>
              )}
            </div>

            <div className="p-2.5 rounded bg-[#191919] border border-[#242424]">
              <span className="text-[10px] text-[#737373] font-sans uppercase block">Completed Windows</span>
              <span className="text-sm font-bold text-[#F5F5F5]">{lastSummary.completed_windows_count}</span>
            </div>

            <div className="p-2.5 rounded bg-[#191919] border border-[#242424]">
              <span className="text-[10px] text-[#737373] font-sans uppercase block">Burst Detections</span>
              <span className={`text-sm font-bold ${lastSummary.burst_detections_count > 0 ? 'text-[#ef4444]' : 'text-[#F5F5F5]'}`}>
                {lastSummary.burst_detections_count}
              </span>
            </div>

            <div className="p-2.5 rounded bg-[#191919] border border-[#242424]">
              <span className="text-[10px] text-[#737373] font-sans uppercase block">Baseline (λ)</span>
              <span className="text-sm font-bold text-[#FF6A00]">
                {lastSummary.is_calibrated && lastSummary.baseline_expected_count !== null
                  ? `${lastSummary.baseline_expected_count}`
                  : 'Uncalibrated'}
              </span>
            </div>
          </div>

          {(lastSummary.duplicate_datagrams ?? 0) > 0 && (
            <div className="p-2.5 rounded bg-[rgba(234,179,8,0.08)] border border-[rgba(234,179,8,0.25)] text-xs text-yellow-500 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <strong>Data Quality Notice:</strong> {lastSummary.duplicate_datagrams} datagrams had sequence numbers &le; node high-water marks and were deduplicated. Accepted arrival counts ({lastSummary.unique_datagrams ?? 0} unique events across {lastSummary.completed_windows_count} windows) reflect accepted observations and may underrepresent total generated traffic if sequences restarted.
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-[#202020]">
            <p className="text-[11px] text-[#737373] leading-relaxed">
              <strong className="text-[#A3A3A3]">Persistence Status:</strong>{' '}
              {lastSummary.persisted ? (
                <span>
                  Successfully saved to SQLite repository as experiment{' '}
                  <code className="text-[#FF6A00] font-mono">{lastSummary.experiment_id}</code>.
                </span>
              ) : (
                <span className="text-[#ef4444]">
                  {lastSummary.persistence_error || 'Persistence failed. Session observations remain preserved in memory.'}
                </span>
              )}
            </p>

            <div className="flex items-center gap-2 shrink-0">
              {lastSummary.persisted && lastSummary.experiment_id ? (
                <>
                  <Link
                    href={`/experiments?selected=${lastSummary.experiment_id}`}
                    className="btn-secondary py-1 px-2.5 text-xs inline-flex items-center gap-1.5"
                  >
                    <Database className="h-3.5 w-3.5 text-[#FF6A00]" />
                    <span>View in History</span>
                  </Link>
                  <Link
                    href={`/analysis?experiment_id=${lastSummary.experiment_id}`}
                    className="btn-secondary py-1 px-2.5 text-xs inline-flex items-center gap-1.5"
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-[#FF6A00]" />
                    <span>Statistical Analysis</span>
                  </Link>
                </>
              ) : (
                <button
                  onClick={handleRetryPersistence}
                  disabled={retryingPersistence}
                  className="btn-secondary py-1 px-2.5 text-xs inline-flex items-center gap-1.5"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${retryingPersistence ? 'animate-spin text-[#FF6A00]' : ''}`} />
                  <span>Retry Persistence</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 1. Session Control Section */}
      <HardwareSessionControls
        status={status}
        loading={loadingAction}
        onStartSession={handleStartSession}
        onStopSession={handleStopSession}
      />

      {/* 2. Network Overview Metric Cards */}
      <HardwareMetricCards status={status} />

      {/* 3. Calibration Progress / Status Panel */}
      <HardwareCalibrationPanel
        status={status}
        loading={loadingAction}
        onFinalizeCalibration={handleFinalizeCalibration}
        minRequiredWindows={10}
      />

      {/* 4. Four-Node Monitoring Grid */}
      <HardwareNodeGrid status={status} expectedNodes={expectedNodes} />

      {/* 5. Live Visualization & Detection Feed (2-Column Desktop Grid) */}
      <div className="space-y-6">
        {/* Live Recharts Stream */}
        <HardwareLiveChart
          windows={windows}
          baselineExpectedCount={status?.baseline_expected_count}
          alpha={0.01}
          isActive={status?.has_active_session ?? false}
        />

        {/* Observation-Window Detection Feed */}
        <HardwareDetectionFeed windows={windows} alpha={0.01} />
      </div>

      {/* 6. Diagnostics & Localhost Simulator Guide (2-Column Grid) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Data Quality & Network Diagnostics Panel */}
        <HardwareDataQualityPanel status={status} />

        {/* Software Simulator Instructions */}
        <HardwareSimulatorGuide
          bindHost={status?.bind_host || '127.0.0.1'}
          bindPort={status?.bind_port || 5005}
          isActive={status?.has_active_session ?? false}
        />
      </div>
    </div>
  );
}
