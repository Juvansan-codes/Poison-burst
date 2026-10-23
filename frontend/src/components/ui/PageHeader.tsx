import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  badge?: string;
  actions?: React.ReactNode;
  className?: string;
}

export default function PageHeader({
  title,
  subtitle,
  badge,
  actions,
  className = '',
}: PageHeaderProps) {
  return (
    <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#292929] ${className}`}>
      <div>
        <div className="flex items-center gap-2.5">
          <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight text-[#F5F5F5]">
            {title}
          </h1>
          {badge && (
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-[rgba(255,106,0,0.1)] text-[#FF6A00] border border-[rgba(255,106,0,0.25)] font-medium">
              {badge}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="mt-1 text-sm text-[#A3A3A3] max-w-3xl leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>

      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}
