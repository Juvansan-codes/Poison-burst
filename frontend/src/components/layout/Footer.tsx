import React from 'react';

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-[#262a38] bg-[#0c0d12] py-6 text-xs text-slate-400">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <p className="font-medium text-slate-300">
              PoissonBurst Lab — Traffic Burst Detection in Communication Networks
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Course 25CS203: Probability and Statistics for Computer Science | Karunya Institute of Technology and Sciences
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
            <span><strong>Team:</strong></span>
            <span>Juvansan H (URK25CS1018)</span>
            <span>•</span>
            <span>Abishek Joseph E (URK25CS1002)</span>
            <span>•</span>
            <span>Naveen Kumar R V (URK25CS1016)</span>
            <span>•</span>
            <span>Shirley S (URK25CS1081)</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
