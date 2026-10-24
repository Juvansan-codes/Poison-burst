'use client';

import React, { useState } from 'react';
import {
  Terminal,
  Copy,
  Check,
} from 'lucide-react';

interface HardwareSimulatorGuideProps {
  bindHost?: string | null;
  bindPort?: number | null;
  isActive: boolean;
}

export default function HardwareSimulatorGuide({
  bindHost = '127.0.0.1',
  bindPort = 5005,
  isActive,
}: HardwareSimulatorGuideProps) {
  const [copied, setCopied] = useState<boolean>(false);

  // If bound to 0.0.0.0, simulator must send to 127.0.0.1
  const targetHost = bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost || '127.0.0.1';
  const targetPort = bindPort || 5005;

  const simulatorCommand = `python scripts/run_hardware_simulator.py --host ${targetHost} --port ${targetPort} --duration 120 --burst-delay 30 --burst-duration 30`;

  const handleCopy = () => {
    navigator.clipboard.writeText(simulatorCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="rounded-lg bg-[#141414] border border-[#292929] p-4 sm:p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-[#242424]">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-[#FF6A00]" />
          <h3 className="font-heading text-sm font-semibold text-[#F5F5F5] uppercase tracking-wider">
            Localhost UDP Simulator Guide (No Hardware Required)
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {isActive && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Listening
            </span>
          )}
          <span className="text-[11px] font-mono text-[#A3A3A3] bg-[#191919] border border-[#292929] px-2 py-0.5 rounded">
            Target: {targetHost}:{targetPort}
          </span>
        </div>
      </div>

      <p className="text-xs text-[#A3A3A3] leading-relaxed">
        PoissonBurst Lab includes a four-node UDP simulator (HardwareSimulator) that emulates real Arduino UNO R4 WiFi boards using independent exponential inter-arrival times (T = -ln(U) / λ). Run this command in a separate terminal to exercise the full live pipeline.
      </p>

      {/* Terminal Command Box */}
      <div className="relative rounded-md bg-[#0c0c0c] border border-[#292929] p-3 text-xs font-mono">
        <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-[#1f1f1f] text-[10px] text-[#737373]">
          <span>Terminal Command (run from backend directory)</span>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-[#FF6A00] hover:text-[#FF8C33] transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-emerald-400" />
                <span className="text-emerald-400">Copied to Clipboard!</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                <span>Copy Command</span>
              </>
            )}
          </button>
        </div>

        <div className="overflow-x-auto text-[#F5F5F5] select-all py-1">
          <code>cd backend &amp;&amp; {simulatorCommand}</code>
        </div>
      </div>

      {/* Step-by-Step Instructions */}
      <div className="space-y-2 pt-1">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[#737373] block">
          Walkthrough Steps:
        </span>

        <ol className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-[#A3A3A3]">
          <li className="flex items-start gap-2 p-2 rounded bg-[#181818] border border-[#242424]">
            <span className="h-4 w-4 rounded-full bg-[#292929] text-[10px] font-mono flex items-center justify-center shrink-0 text-[#F5F5F5]">1</span>
            <span>Click <strong>Start Monitoring Session</strong> above to bind the UDP port and begin calibration.</span>
          </li>

          <li className="flex items-start gap-2 p-2 rounded bg-[#181818] border border-[#242424]">
            <span className="h-4 w-4 rounded-full bg-[#292929] text-[10px] font-mono flex items-center justify-center shrink-0 text-[#F5F5F5]">2</span>
            <span>Copy the command box above and paste it into a separate PowerShell or command prompt window.</span>
          </li>

          <li className="flex items-start gap-2 p-2 rounded bg-[#181818] border border-[#242424]">
            <span className="h-4 w-4 rounded-full bg-[#292929] text-[10px] font-mono flex items-center justify-center shrink-0 text-[#F5F5F5]">3</span>
            <span>Observe the 4 node cards transition to <strong>ACTIVE</strong> with real-time datagram counts streaming in.</span>
          </li>

          <li className="flex items-start gap-2 p-2 rounded bg-[#181818] border border-[#242424]">
            <span className="h-4 w-4 rounded-full bg-[#292929] text-[10px] font-mono flex items-center justify-center shrink-0 text-[#F5F5F5]">4</span>
            <span>Once 10 clean windows accumulate, click <strong>Finalize Baseline Calibration</strong> to freeze λ.</span>
          </li>

          <li className="flex items-start gap-2 p-2 rounded bg-[#181818] border border-[#242424]">
            <span className="h-4 w-4 rounded-full bg-[#292929] text-[10px] font-mono flex items-center justify-center shrink-0 text-[#F5F5F5]">5</span>
            <span>At T+30s, the simulator injects an intentional burst on <code>node_4</code>; watch the detector trigger red burst alerts!</span>
          </li>

          <li className="flex items-start gap-2 p-2 rounded bg-[#181818] border border-[#242424]">
            <span className="h-4 w-4 rounded-full bg-[#292929] text-[10px] font-mono flex items-center justify-center shrink-0 text-[#F5F5F5]">6</span>
            <span>When finished, click <strong>Stop Session</strong> to cleanly release the receiver socket and view the final summary.</span>
          </li>
        </ol>
      </div>
    </div>
  );
}
