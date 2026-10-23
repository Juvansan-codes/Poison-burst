import React from 'react';

interface StatusBadgeProps {
  label: string;
  variant?: 'accent' | 'neutral' | 'success' | 'error' | 'warning';
  className?: string;
}

export default function StatusBadge({
  label,
  variant = 'neutral',
  className = '',
}: StatusBadgeProps) {
  const variantStyles = {
    accent: 'bg-[rgba(255,106,0,0.1)] text-[#FF6A00] border-[rgba(255,106,0,0.3)]',
    neutral: 'bg-[#191919] text-[#A3A3A3] border-[#292929]',
    success: 'bg-[rgba(34,197,94,0.1)] text-[#22c55e] border-[rgba(34,197,94,0.3)]',
    error: 'bg-[rgba(239,68,68,0.1)] text-[#ef4444] border-[rgba(239,68,68,0.3)]',
    warning: 'bg-[rgba(255,106,0,0.12)] text-[#FF6A00] border-[rgba(255,106,0,0.4)]',
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-medium border ${variantStyles[variant]} ${className}`}
    >
      {label}
    </span>
  );
}
