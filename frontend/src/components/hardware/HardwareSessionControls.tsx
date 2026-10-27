'use client';

import React, { useState } from 'react';
import {
  Play,
  Square,
  Radio,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  RefreshCw,
} from 'lucide-react';
import { HardwareStartRequest, HardwareStatusResponse } from '@/lib/types';
import StatusBadge from '@/components/ui/StatusBadge';

interface HardwareSessionControlsProps {
  status: HardwareStatusResponse | null;
  loading: boolean;
  onStartSession: (req: HardwareStartRequest) => Promise<void>;
  onStopSession: () => Promise<void>;
}

export default function HardwareSessionControls({
  status,
  loading,
  onStartSession,
  onStopSession,
}: HardwareSessionControlsProps) {
  // Form State
  const [bindHost, setBindHost] = useState<string>('0.0.0.0');
  const [bindPort, setBindPort] = useState<number>(5005);
  const [useEphemeralPort, setUseEphemeralPort] = useState<boolean>(false);
  const [windowSeconds, setWindowSeconds] = useState<number>(1.0);
  const [alpha, setAlpha] = useState<number>(0.01);
  const [expectedNodes, setExpectedNodes] = useState<string[]>([
    'node_1',
    'node_2',
    'node_3',
    'node_4',
  ]);
  const [minCalibrationWindows, setMinCalibrationWindows] = useState<number>(10);
  const [staleTimeout, setStaleTimeout] = useState<number>(5.0);
  const [requireAllNodes, setRequireAllNodes] = useState<boolean>(true);

  // UI state
  const [showConfig, setShowConfig] = useState<boolean>(true);
  const [showStopModal, setShowStopModal] = useState<boolean>(false);
  const [copiedSessionId, setCopiedSessionId] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isActive = status?.has_active_session ?? false;
  const sessionState = status?.state || 'IDLE';

  const handleNodeToggle = (nodeId: string) => {
    if (isActive) return;
    setExpectedNodes((prev) => {
      if (prev.includes(nodeId)) {
        if (prev.length === 1) {
          setFormError('At least one expected node must be selected.');
          return prev;
        }
        setFormError(null);
        return prev.filter((id) => id !== nodeId);
      } else {
        setFormError(null);
        return [...prev, nodeId].sort();
      }
    });
  };

  const handleStartSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isActive) return;

    if (windowSeconds <= 0 || windowSeconds > 300) {
      setFormError('Observation window duration must be between 0.1 and 300.0 seconds.');
      return;
    }
    if (alpha <= 0 || alpha >= 1.0) {
      setFormError('Significance level alpha must be strictly between 0 and 1 (e.g. 0.01).');
      return;
    }
    if (expectedNodes.length === 0) {
      setFormError('Please select at least one expected node.');
      return;
    }
    if (minCalibrationWindows < 1) {
      setFormError('Minimum calibration windows must be at least 1.');
      return;
    }
    if (staleTimeout <= 0) {
      setFormError('Stale node timeout must be greater than 0.');
      return;
    }

    setFormError(null);

    const payload: HardwareStartRequest = {
      bind_host: bindHost.trim() || '0.0.0.0',
      bind_port: useEphemeralPort ? 0 : bindPort,
      window_seconds: windowSeconds,
      alpha: alpha,
      expected_nodes: expectedNodes,
      min_calibration_windows: minCalibrationWindows,
      stale_node_timeout_seconds: staleTimeout,
      require_all_nodes: requireAllNodes,
    };

    await onStartSession(payload);
  };

  const handleCopySessionId = () => {
    if (!status?.session_id) return;
    navigator.clipboard.writeText(status.session_id);
    setCopiedSessionId(true);
    setTimeout(() => setCopiedSessionId(false), 2000);
  };

  return (
    <div className="rounded-lg bg-[#141414] border border-[#292929] overflow-hidden">
      {/* Top Banner / Session Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 sm:p-5 border-b border-[#292929] bg-[#111111]">
        <div className="flex items-center gap-3">
          <div
            className={`h-10 w-10 rounded-lg flex items-center justify-center border ${
              isActive
                ? 'bg-[rgba(255,106,0,0.12)] border-[rgba(255,106,0,0.3)] text-[#FF6A00]'
                : 'bg-[#191919] border-[#292929] text-[#737373]'
            }`}
          >
            <Radio className={`h-5 w-5 ${isActive ? 'animate-pulse text-[#FF6A00]' : ''}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-heading text-base font-semibold text-[#F5F5F5]">
                UDP Telemetry Session
              </span>
              <StatusBadge
                label={sessionState}
                variant={
                  sessionState === 'MONITORING'
                    ? 'success'
                    : sessionState === 'CALIBRATING'
                    ? 'accent'
                    : sessionState === 'STOPPED'
                    ? 'neutral'
                    : 'neutral'
                }
              />
            </div>
            <p className="text-xs text-[#737373] mt-0.5">
              {isActive
                ? `Listening on ${status?.bind_host || '127.0.0.1'}:${status?.bind_port || 5005} (UDP)`
                : 'Configure receiver parameters and start a live telemetry session'}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
          {!isActive ? (
            <button
              onClick={handleStartSubmit}
              disabled={loading}
              className="btn-primary w-full sm:w-auto justify-center"
            >
              {loading ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Starting Receiver...</span>
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  <span>Start Monitoring Session</span>
                </>
              )}
            </button>
          ) : (
            <button
              onClick={() => setShowStopModal(true)}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-[rgba(239,68,68,0.12)] border border-[rgba(239,68,68,0.3)] text-[#ef4444] hover:bg-[rgba(239,68,68,0.2)] text-xs font-medium transition-colors cursor-pointer w-full sm:w-auto"
            >
              <Square className="h-4 w-4" />
              <span>Stop Session</span>
            </button>
          )}

          <button
            onClick={() => setShowConfig(!showConfig)}
            className="p-2 rounded-md bg-[#191919] border border-[#292929] text-[#A3A3A3] hover:text-[#F5F5F5] hover:border-[#383838] transition-colors focus:outline-none"
            title={showConfig ? 'Hide Configuration' : 'Show Configuration'}
            aria-label="Toggle configuration panel"
          >
            <Sliders className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Active Session Info Bar */}
      {isActive && status?.session_id && (
        <div className="px-4 sm:px-5 py-2.5 bg-[#0f0f0f] border-b border-[#242424] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-[#737373]">
            <span>Session ID:</span>
            <span className="font-mono text-[#A3A3A3]">
              {status.session_id.substring(0, 8)}...{status.session_id.substring(status.session_id.length - 4)}
            </span>
            <button
              onClick={handleCopySessionId}
              className="p-1 hover:text-[#FF6A00] transition-colors text-[#737373]"
              title="Copy Full Session ID"
            >
              {copiedSessionId ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>

          <div className="flex items-center gap-4 text-[#A3A3A3] font-mono text-[11px]">
            <span>
              Bound: <strong className="text-[#F5F5F5]">{status.bind_host}:{status.bind_port}</strong>
            </span>
            <span>
              Status: <strong className="text-emerald-400">Receiver Active</strong>
            </span>
            {status.is_calibrated && status.baseline_expected_count !== null && (
              <span>
                Baseline: <strong className="text-[#FF6A00]">{status.baseline_expected_count} pkts/win</strong>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Form Error Banner */}
      {formError && (
        <div className="p-3 bg-[rgba(239,68,68,0.1)] border-b border-[rgba(239,68,68,0.25)] flex items-center gap-2 text-xs text-[#ef4444]">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{formError}</span>
        </div>
      )}

      {/* Configuration Panel (Collapsible) */}
      {showConfig && (
        <form onSubmit={handleStartSubmit} className="p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-[#242424]">
            <span className="text-xs font-medium uppercase tracking-wider text-[#737373]">
              Session Parameters {isActive && <span className="text-[#FF6A00] lowercase font-normal">(locked during active session)</span>}
            </span>
            {!isActive && (
              <span className="text-[11px] text-[#737373]">
                Defaults tuned for Arduino UNO R4 WiFi &amp; UDP Simulator
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            {/* Bind Host */}
            <div>
              <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">
                Receiver Host
              </label>
              <input
                type="text"
                disabled={isActive}
                value={bindHost}
                onChange={(e) => setBindHost(e.target.value)}
                className="w-full rounded bg-[#191919] border border-[#292929] px-3 py-1.5 font-mono text-[#F5F5F5] disabled:opacity-50 focus:border-[#FF6A00] focus:outline-none"
                placeholder="127.0.0.1 or 0.0.0.0"
              />
              <p className="mt-1 text-[10px] text-[#737373]">127.0.0.1 for local, 0.0.0.0 for LAN</p>
            </div>

            {/* Bind Port */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-medium text-[#A3A3A3]">
                  Receiver UDP Port
                </label>
                {!isActive && (
                  <button
                    type="button"
                    onClick={() => setUseEphemeralPort(!useEphemeralPort)}
                    className="text-[10px] text-[#FF6A00] hover:underline cursor-pointer"
                  >
                    {useEphemeralPort ? 'Use static 5005' : 'Use OS ephemeral (0)'}
                  </button>
                )}
              </div>
              <input
                type="number"
                disabled={isActive || useEphemeralPort}
                value={useEphemeralPort ? 0 : bindPort}
                onChange={(e) => setBindPort(parseInt(e.target.value) || 5005)}
                className="w-full rounded bg-[#191919] border border-[#292929] px-3 py-1.5 font-mono text-[#F5F5F5] disabled:opacity-50 focus:border-[#FF6A00] focus:outline-none"
                min={0}
                max={65535}
              />
              <p className="mt-1 text-[10px] text-[#737373]">
                {useEphemeralPort ? 'OS will assign an unused port' : 'Default UDP listener: 5005'}
              </p>
            </div>

            {/* Window Seconds */}
            <div>
              <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">
                Window Duration (T)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.1"
                  disabled={isActive}
                  value={windowSeconds}
                  onChange={(e) => setWindowSeconds(parseFloat(e.target.value) || 1.0)}
                  className="w-full rounded bg-[#191919] border border-[#292929] px-3 py-1.5 font-mono text-[#F5F5F5] disabled:opacity-50 focus:border-[#FF6A00] focus:outline-none"
                  min={0.1}
                  max={300.0}
                />
                <span className="font-mono text-xs text-[#737373]">sec</span>
              </div>
              <p className="mt-1 text-[10px] text-[#737373]">Tumbling observation interval</p>
            </div>

            {/* Alpha Threshold */}
            <div>
              <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">
                Significance Level (α)
              </label>
              <select
                disabled={isActive}
                value={alpha}
                onChange={(e) => setAlpha(parseFloat(e.target.value))}
                className="w-full rounded bg-[#191919] border border-[#292929] px-3 py-1.5 font-mono text-[#F5F5F5] disabled:opacity-50 focus:border-[#FF6A00] focus:outline-none"
              >
                <option value={0.05}>0.05 (Standard, 5% false-alarm)</option>
                <option value={0.01}>0.01 (Recommended, 1% false-alarm)</option>
                <option value={0.005}>0.005 (Strict, 0.5%)</option>
                <option value={0.001}>0.001 (High-Confidence, 0.1%)</option>
              </select>
              <p className="mt-1 text-[10px] text-[#737373]">Burst triggered if p-value &lt; α</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs pt-2">
            {/* Min Calibration Windows */}
            <div>
              <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">
                Min Calibration Windows
              </label>
              <input
                type="number"
                disabled={isActive}
                value={minCalibrationWindows}
                onChange={(e) => setMinCalibrationWindows(parseInt(e.target.value) || 10)}
                className="w-full rounded bg-[#191919] border border-[#292929] px-3 py-1.5 font-mono text-[#F5F5F5] disabled:opacity-50 focus:border-[#FF6A00] focus:outline-none"
                min={1}
                max={100}
              />
              <p className="mt-1 text-[10px] text-[#737373]">Eligible windows needed to finalize</p>
            </div>

            {/* Stale Node Timeout */}
            <div>
              <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">
                Stale Inactivity Timeout
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.5"
                  disabled={isActive}
                  value={staleTimeout}
                  onChange={(e) => setStaleTimeout(parseFloat(e.target.value) || 5.0)}
                  className="w-full rounded bg-[#191919] border border-[#292929] px-3 py-1.5 font-mono text-[#F5F5F5] disabled:opacity-50 focus:border-[#FF6A00] focus:outline-none"
                  min={1.0}
                  max={60.0}
                />
                <span className="font-mono text-xs text-[#737373]">sec</span>
              </div>
              <p className="mt-1 text-[10px] text-[#737373]">Silence interval before marking node STALE</p>
            </div>

            {/* Require All Nodes Checkbox */}
            <div className="flex flex-col justify-center">
              <label className="flex items-center gap-2 cursor-pointer mt-1">
                <input
                  type="checkbox"
                  disabled={isActive}
                  checked={requireAllNodes}
                  onChange={(e) => setRequireAllNodes(e.target.checked)}
                  className="rounded bg-[#191919] border-[#292929] text-[#FF6A00] focus:ring-0 focus:ring-offset-0"
                />
                <span className="text-xs text-[#F5F5F5] select-none">
                  Require All Nodes Active
                </span>
              </label>
              <p className="text-[10px] text-[#737373] mt-1">
                Windows with stale/unobserved nodes will be marked ineligible for calibration
              </p>
            </div>
          </div>

          {/* Expected Nodes Selection */}
          <div className="pt-2">
            <span className="block text-[11px] font-medium text-[#A3A3A3] mb-1.5">
              Expected Logical Hardware Nodes
            </span>
            <div className="flex flex-wrap gap-2">
              {['node_1', 'node_2', 'node_3', 'node_4'].map((nodeId) => {
                const isSelected = expectedNodes.includes(nodeId);
                return (
                  <button
                    key={nodeId}
                    type="button"
                    disabled={isActive}
                    onClick={() => handleNodeToggle(nodeId)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono font-medium transition-all ${
                      isSelected
                        ? 'bg-[rgba(255,106,0,0.12)] border border-[rgba(255,106,0,0.35)] text-[#FF6A00]'
                        : 'bg-[#191919] border border-[#292929] text-[#737373] hover:text-[#A3A3A3]'
                    } ${isActive ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                  >
                    <CheckCircle2 className={`h-3.5 w-3.5 ${isSelected ? 'text-[#FF6A00]' : 'text-transparent'}`} />
                    <span>{nodeId}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </form>
      )}

      {/* Stop Session Confirmation Modal */}
      {showStopModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-[#141414] border border-[#292929] rounded-lg max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-3 text-[#ef4444]">
              <AlertTriangle className="h-6 w-6" />
              <h3 className="font-heading text-lg font-bold text-[#F5F5F5]">
                Stop Hardware Session?
              </h3>
            </div>
            <p className="text-xs text-[#A3A3A3] leading-relaxed mb-4">
              Stopping the active hardware session will terminate the background UDP socket listener and finalize the current observation window.
            </p>
            <div className="p-3 bg-[#191919] border border-[#292929] rounded text-xs text-[#737373] mb-6">
              <strong className="text-[#A3A3A3] block mb-1">In-Memory Scope Notice:</strong>
              Persistent SQLite storage is scheduled for Phase 7. Terminating this session will return the final in-memory summary, but unpersisted session telemetry is not permanently stored.
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowStopModal(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  setShowStopModal(false);
                  await onStopSession();
                }}
                className="px-4 py-2 rounded-md bg-[#ef4444] text-white text-xs font-medium hover:bg-[#dc2626] transition-colors cursor-pointer"
              >
                Confirm Stop
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
