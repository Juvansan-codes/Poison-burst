import React from 'react';
import { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: string | number;
  helper?: string;
  icon?: LucideIcon;
  badge?: string;
  badgeVariant?: 'accent' | 'neutral' | 'success' | 'error' | 'warning';
  highlight?: boolean;
  className?: string;
}

export default function MetricCard({
  label,
  value,
  helper,
  icon: Icon,
  badge,
  badgeVariant = 'accent',
  highlight = false,
  className = '',
}: MetricCardProps) {
  const badgeColors = {
    accent: 'bg-[rgba(255,106,0,0.1)] text-[#FF6A00] border-[rgba(255,106,0,0.25)]',
    neutral: 'bg-[#191919] text-[#A3A3A3] border-[#292929]',
    success: 'bg-[rgba(34,197,94,0.1)] text-[#22c55e] border-[rgba(34,197,94,0.25)]',
    error: 'bg-[rgba(239,68,68,0.1)] text-[#ef4444] border-[rgba(239,68,68,0.25)]',
    warning: 'bg-[rgba(255,106,0,0.12)] text-[#FF6A00] border-[rgba(255,106,0,0.4)]',
  };

  return (
    <div
      className={`rounded-lg bg-[#141414] border p-4 sm:p-5 transition-all flex flex-col justify-between ${
        highlight
          ? 'border-[rgba(255,106,0,0.35)] bg-gradient-to-b from-[#141414] to-[#171310]'
          : 'border-[#292929] hover:border-[#383838]'
      } ${className}`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[#A3A3A3]">
          {label}
        </span>
        {Icon && (
          <div className="h-7 w-7 rounded flex items-center justify-center bg-[#191919] border border-[#292929] text-[#A3A3A3]">
            <Icon className="h-3.5 w-3.5" />
          </div>
        )}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="font-mono text-2xl sm:text-3xl font-bold tracking-tight text-[#F5F5F5]">
          {value}
        </span>
        {badge && (
          <span
            className={`text-[10px] font-mono px-1.5 py-0.5 rounded border font-medium ${badgeColors[badgeVariant]}`}
          >
            {badge}
          </span>
        )}
      </div>

      {helper && (
        <p className="mt-2 text-xs text-[#737373] leading-relaxed">
          {helper}
        </p>
      )}
    </div>
  );
}
