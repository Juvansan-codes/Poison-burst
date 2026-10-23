'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  BarChart3,
  Database,
  FlaskConical,
  History,
  LayoutDashboard,
} from 'lucide-react';
import { api } from '@/lib/api';

const navItems = [
  {
    name: 'Dashboard',
    href: '/',
    icon: LayoutDashboard,
    owner: 'Juvansan H',
  },
  {
    name: 'Historical Replay',
    href: '/historical',
    icon: History,
    owner: 'Abishek Joseph E',
  },
  {
    name: 'Simulation Lab',
    href: '/simulation',
    icon: FlaskConical,
    owner: 'Naveen Kumar R V',
  },
  {
    name: 'Statistical Analysis',
    href: '/analysis',
    icon: BarChart3,
    owner: 'Shirley S',
  },
  {
    name: 'Experiment History',
    href: '/experiments',
    icon: Database,
    owner: 'Unified Experiments',
  },
];

export default function Navbar() {
  const pathname = usePathname();
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);

  const checkStatus = () => {
    api
      .checkHealth()
      .then(() => setBackendOnline(true))
      .catch(() => setBackendOnline(false));
  };

  useEffect(() => {
    let isMounted = true;
    api
      .checkHealth()
      .then(() => {
        if (isMounted) setBackendOnline(true);
      })
      .catch(() => {
        if (isMounted) setBackendOnline(false);
      });

    const interval = setInterval(() => {
      api
        .checkHealth()
        .then(() => {
          if (isMounted) setBackendOnline(true);
        })
        .catch(() => {
          if (isMounted) setBackendOnline(false);
        });
    }, 30000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-[#262a38] bg-[#0c0d12]/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        {/* Branding */}
        <Link href="/" className="flex items-center gap-3 group">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10 border border-orange-500/30 text-orange-500 group-hover:bg-orange-500/20 transition-colors">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold tracking-tight text-white group-hover:text-orange-400 transition-colors">
                PoissonBurst<span className="text-orange-500">Lab</span>
              </span>
              <span className="rounded bg-[#1c1f2b] border border-[#2d3244] px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                25CS203
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">
              Poisson-Based Network Burst Detection & Statistical Lab
            </p>
          </div>
        </Link>

        {/* Navigation Links */}
        <nav className="flex items-center gap-1 sm:gap-2">
          {navItems.map((item) => {
            const isActive =
              item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-orange-500/15 border border-orange-500/40 text-orange-400 shadow-sm'
                    : 'text-slate-300 hover:bg-[#191c26] hover:text-white border border-transparent'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-orange-400' : 'text-slate-400'}`} />
                <span className="hidden md:inline">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Backend Status Indicator */}
        <div className="flex items-center gap-2">
          <button
            onClick={checkStatus}
            title={
              backendOnline === true
                ? 'Backend connected (FastAPI at 127.0.0.1:8000)'
                : backendOnline === false
                ? 'Backend offline. Click to retry connection.'
                : 'Checking backend status...'
            }
            className="flex items-center gap-2 rounded-md bg-[#14161f] border border-[#262a38] px-2.5 py-1 text-xs hover:border-[#383e52] transition-colors"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                backendOnline === true
                  ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]'
                  : backendOnline === false
                  ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'
                  : 'bg-yellow-400 animate-pulse'
              }`}
            />
            <span className="text-[11px] text-slate-300 font-mono hidden sm:inline">
              {backendOnline === true
                ? 'API 127.0.0.1:8000'
                : backendOnline === false
                ? 'API Offline'
                : 'Connecting...'}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
