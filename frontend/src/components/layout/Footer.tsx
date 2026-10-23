import React from 'react';

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-[#292929] bg-[#090909] py-8 text-xs text-[#737373]">
      <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-heading font-semibold text-[#F5F5F5] text-sm">
                PoissonBurst <span className="text-[#FF6A00]">Lab</span>
              </span>
              <span className="text-[11px] text-[#A3A3A3] font-mono px-1.5 py-0.5 rounded bg-[#141414] border border-[#292929]">
                v1.2.0
              </span>
            </div>
            <p className="text-[12px] text-[#A3A3A3] mt-1">
              Traffic Burst Detection in Communication Networks Using Poisson Distribution
            </p>
            <p className="text-[11px] text-[#737373] mt-0.5">
              Course 25CS203: Probability and Statistics for Computer Science | Karunya Institute of Technology and Sciences
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-[11px] text-[#A3A3A3]">
            <span className="font-medium text-[#F5F5F5]">Project Team:</span>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="hover:text-[#F5F5F5] transition-colors">Juvansan H <span className="font-mono text-[#737373]">(URK25CS1018)</span></span>
              <span className="text-[#383838] hidden sm:inline">•</span>
              <span className="hover:text-[#F5F5F5] transition-colors">Abishek Joseph E <span className="font-mono text-[#737373]">(URK25CS1002)</span></span>
              <span className="text-[#383838] hidden sm:inline">•</span>
              <span className="hover:text-[#F5F5F5] transition-colors">Naveen Kumar R V <span className="font-mono text-[#737373]">(URK25CS1016)</span></span>
              <span className="text-[#383838] hidden sm:inline">•</span>
              <span className="hover:text-[#F5F5F5] transition-colors">Shirley S <span className="font-mono text-[#737373]">(URK25CS1081)</span></span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
