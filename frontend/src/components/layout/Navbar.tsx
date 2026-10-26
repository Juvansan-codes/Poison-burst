'use client';

import React, { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  BarChart3,
  Cpu,
  Database,
  FlaskConical,
  History,
  LayoutDashboard,
  Menu,
  Network,
  X,
  RefreshCw,
} from 'lucide-react';
import { api } from '@/lib/api';

const navItems = [
  {
    name: 'Dashboard',
    href: '/',
    icon: LayoutDashboard,
  },
  {
    name: 'University Network',
    href: '/university-network',
    icon: Network,
  },
  {
    name: 'Hardware Lab',
    href: '/hardware',
    icon: Cpu,
  },
  {
    name: 'Historical Replay',
    href: '/historical',
    icon: History,
  },
  {
    name: 'Simulation Lab',
    href: '/simulation',
    icon: FlaskConical,
  },
  {
    name: 'Statistical Analysis',
    href: '/analysis',
    icon: BarChart3,
  },
  {
    name: 'Experiment History',
    href: '/experiments',
    icon: Database,
  },
];

export default function Navbar() {
  const pathname = usePathname();
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const checkStatus = async () => {
    setIsChecking(true);
    try {
      await api.checkHealth();
      setBackendOnline(true);
    } catch {
      setBackendOnline(false);
    } finally {
      setIsChecking(false);
    }
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

  // Handle escape key to close menu
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileMenuOpen) {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen]);

  return (
    <header className="sticky top-0 z-50 border-b border-[#292929] bg-[#090909]/95 backdrop-blur-md">
      <div className="w-full max-w-[1600px] mx-auto flex items-center justify-between px-4 sm:px-6 lg:px-8 h-16">
        {/* Branding */}
        <Link href="/" className="flex items-center gap-3 group focus:outline-none">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[rgba(255,106,0,0.1)] border border-[rgba(255,106,0,0.3)] text-[#FF6A00] transition-colors group-hover:bg-[rgba(255,106,0,0.18)]">
            <Activity className="h-5 w-5" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-heading text-base font-semibold tracking-tight text-[#F5F5F5] group-hover:text-[#FF6A00] transition-colors">
                PoissonBurst <span className="text-[#FF6A00]">Lab</span>
              </span>
              <span className="rounded bg-[#191919] border border-[#292929] px-1.5 py-0.2 text-[10px] font-mono text-[#A3A3A3]">
                25CS203
              </span>
            </div>
            <p className="text-[11px] text-[#737373] hidden lg:block tracking-normal">
              Network Burst Detection &amp; Statistical Platform
            </p>
          </div>
        </Link>

        {/* Desktop Navigation Links */}
        <nav className="hidden lg:flex items-center gap-1">
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
                    ? 'bg-[rgba(255,106,0,0.1)] border border-[rgba(255,106,0,0.3)] text-[#FF6A00]'
                    : 'text-[#A3A3A3] hover:text-[#F5F5F5] hover:bg-[#141414] border border-transparent'
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${isActive ? 'text-[#FF6A00]' : 'text-[#737373]'}`} />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Right Section: Status Indicator & Mobile Hamburger */}
        <div className="flex items-center gap-3">
          {/* Backend Status Indicator */}
          <button
            onClick={checkStatus}
            disabled={isChecking}
            title={
              backendOnline === true
                ? 'Backend connected (FastAPI at 127.0.0.1:8000). Click to re-check.'
                : backendOnline === false
                ? 'Backend offline. Click to retry connection.'
                : 'Checking backend status...'
            }
            className="flex items-center gap-2 rounded-md bg-[#141414] border border-[#292929] px-2.5 py-1.5 text-xs hover:border-[#383838] transition-colors focus:outline-none"
            aria-label="Check backend API connection status"
          >
            <span
              className={`h-2 w-2 rounded-full transition-all ${
                backendOnline === true
                  ? 'bg-emerald-500 ring-2 ring-emerald-500/20'
                  : backendOnline === false
                  ? 'bg-red-500 ring-2 ring-red-500/20'
                  : 'bg-[#FF6A00] animate-pulse'
              }`}
            />
            <span className="text-[11px] text-[#A3A3A3] font-mono hidden sm:inline">
              {isChecking
                ? 'Checking...'
                : backendOnline === true
                ? 'API Online'
                : backendOnline === false
                ? 'API Offline'
                : 'Connecting...'}
            </span>
            <RefreshCw className={`h-3 w-3 text-[#737373] ${isChecking ? 'animate-spin text-[#FF6A00]' : ''}`} />
          </button>

          {/* Mobile Hamburger Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden flex items-center justify-center p-2 rounded-md bg-[#141414] border border-[#292929] text-[#A3A3A3] hover:text-[#F5F5F5] hover:border-[#383838] transition-colors focus:outline-none"
            aria-expanded={mobileMenuOpen}
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Navigation */}
      {mobileMenuOpen && (
        <div
          ref={menuRef}
          className="lg:hidden border-t border-[#292929] bg-[#101010] px-4 py-4 space-y-1 shadow-2xl transition-all"
        >
          <div className="pb-2 mb-2 border-b border-[#292929] flex items-center justify-between text-xs text-[#737373]">
            <span>Navigation Menu</span>
            <span className="font-mono text-[10px]">25CS203 Micro-Project</span>
          </div>
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
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[rgba(255,106,0,0.12)] border border-[rgba(255,106,0,0.3)] text-[#FF6A00]'
                    : 'text-[#A3A3A3] hover:text-[#F5F5F5] hover:bg-[#141414] border border-transparent'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-[#FF6A00]' : 'text-[#737373]'}`} />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </div>
      )}
    </header>
  );
}
