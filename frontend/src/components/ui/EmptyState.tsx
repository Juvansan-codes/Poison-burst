import React from 'react';
import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`rounded-lg bg-[#141414] border border-[#292929] p-8 sm:p-12 text-center flex flex-col items-center justify-center ${className}`}
    >
      <div className="h-12 w-12 rounded-lg bg-[#191919] border border-[#292929] flex items-center justify-center text-[#737373] mb-4">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="font-heading text-base font-semibold text-[#F5F5F5] mb-1">
        {title}
      </h3>
      <p className="text-xs text-[#737373] max-w-md mb-6 leading-relaxed">
        {description}
      </p>
      {action && <div>{action}</div>}
    </div>
  );
}
