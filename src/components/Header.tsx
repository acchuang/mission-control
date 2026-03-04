'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Zap, Settings, ChevronLeft, LayoutGrid, SlidersHorizontal, Search, Pause, BellRing, ShieldCheck, ShieldAlert, ShieldX, BarChart3 } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import { format } from 'date-fns';
import type { Workspace } from '@/lib/types';

interface HeaderProps {
  workspace?: Workspace;
}

export function Header({ workspace }: HeaderProps) {
  const router = useRouter();
  const { agents, tasks, isOnline } = useMissionControl();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [activeSubAgents, setActiveSubAgents] = useState(0);
  const [opsCount, setOpsCount] = useState(0);
  const [opsOk, setOpsOk] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Load active sub-agent count
  useEffect(() => {
    const loadSubAgentCount = async () => {
      try {
        const res = await fetch('/api/openclaw/sessions');
        if (res.ok) {
          const data = await res.json();

          if (Array.isArray(data)) {
            setActiveSubAgents(data.filter((s) => s.session_type === 'subagent' && s.status === 'active').length);
            return;
          }

          const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
          setActiveSubAgents(sessions.filter((s: { kind?: string }) => (s.kind || '').toLowerCase() === 'subagent').length);
        }
      } catch (error) {
        console.error('Failed to load sub-agent count:', error);
      }
    };

    loadSubAgentCount();

    // Poll every 30 seconds (reduced from 10s to reduce load)
    const interval = setInterval(loadSubAgentCount, 30000);
    return () => clearInterval(interval);
  }, []);

  // Load ops active-task health badge
  useEffect(() => {
    const loadOpsHealth = async () => {
      try {
        const res = await fetch('/api/ops/active-tasks');
        const data = await res.json();
        setOpsOk(Boolean(data?.ok));
        setOpsCount(Number(data?.count || 0));
      } catch {
        setOpsOk(false);
      }
    };

    loadOpsHealth();
    const interval = setInterval(loadOpsHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  const workingAgents = agents.filter((a) => a.status === 'working').length;
  const activeAgents = workingAgents + activeSubAgents;
  const tasksInQueue = tasks.filter((t) => t.status !== 'done' && t.status !== 'review').length;
  const approvals = tasks.filter((t) => t.status === 'review' || t.status === 'testing').length;

  return (
    <header className="h-14 panel-shell flex items-center justify-between px-3 md:px-4">
      {/* Left: Logo & Title */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-mc-accent" />
          <span className="font-semibold text-mc-text tracking-tight text-base">
            Mission Control
          </span>
        </div>

        {/* Workspace indicator or back to dashboard */}
        {workspace ? (
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="flex items-center gap-1 text-mc-text-secondary hover:text-mc-accent transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              <LayoutGrid className="w-4 h-4" />
            </Link>
            <span className="text-mc-text-secondary">/</span>
            <div className="flex items-center gap-2 px-3 py-1 bg-mc-bg-tertiary rounded">
              <span className="text-lg">{workspace.icon}</span>
              <span className="font-medium">{workspace.name}</span>
            </div>
          </div>
        ) : (
          <Link
            href="/"
            className="flex items-center gap-2 px-3 py-1 bg-mc-bg-tertiary rounded hover:bg-mc-bg transition-colors"
          >
            <LayoutGrid className="w-4 h-4" />
            <span className="text-sm">All Workspaces</span>
          </Link>
        )}
      </div>

      {/* Center: Stats - only show in workspace view */}
      {workspace && (
        <div className="hidden lg:flex items-center gap-2">
          <div className="px-3 py-1 rounded-md border border-mc-border bg-mc-bg-secondary text-xs">
            <span className="text-mc-text-secondary">Sessions</span>{' '}
            <span className="font-semibold text-blue-300">{activeAgents}</span>
          </div>
          <div className="px-3 py-1 rounded-md border border-mc-border bg-mc-bg-secondary text-xs">
            <span className="text-mc-text-secondary">Queue</span>{' '}
            <span className="font-semibold text-violet-300">{tasksInQueue}</span>
          </div>
          <div className="px-3 py-1 rounded-md border border-mc-border bg-mc-bg-secondary text-xs">
            <span className="text-mc-text-secondary">Review</span>{' '}
            <span className="font-semibold text-amber-300">{approvals}</span>
          </div>
        </div>
      )}

      {/* Right: Command Bar */}
      <div className="flex items-center gap-2">
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-mc-border bg-[#0a0f1a] min-w-[220px]">
          <Search className="w-4 h-4 text-mc-text-secondary" />
          <input className="bg-transparent outline-none text-sm w-full" placeholder="Search" />
        </div>

        <button className="px-3 py-1.5 rounded-lg border border-mc-border bg-[#0a0f1a] text-xs inline-flex items-center gap-1 text-mc-text-secondary hover:text-mc-text hover:border-blue-500/40">
          <Pause className="w-3 h-3" /> Pause
        </button>

        <button className="px-3 py-1.5 rounded-lg border border-mc-border bg-[#0a0f1a] text-xs inline-flex items-center gap-1 text-mc-text-secondary hover:text-mc-text hover:border-blue-500/40">
          <BellRing className="w-3 h-3" /> Ping
        </button>

        <span className="text-mc-text-secondary text-xs font-mono hidden lg:inline">{format(currentTime, 'HH:mm:ss')}</span>

        <div
          className={`flex items-center gap-2 px-3 py-1 rounded border text-xs font-medium ${
            isOnline
              ? 'bg-mc-accent-green/20 border-mc-accent-green text-mc-accent-green'
              : 'bg-mc-accent-red/20 border-mc-accent-red text-mc-accent-red'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-mc-accent-green animate-pulse' : 'bg-mc-accent-red'}`} />
          {isOnline ? 'ONLINE' : 'OFFLINE'}
        </div>

        <button
          onClick={() => router.push('/workspace/default')}
          className={`hidden lg:inline-flex items-center gap-1 px-2.5 py-1 rounded border text-xs font-medium ${
            !opsOk
              ? 'bg-red-500/20 border-red-400/40 text-red-300'
              : opsCount > 0
                ? 'bg-amber-500/20 border-amber-400/40 text-amber-300'
                : 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300'
          }`}
          title="Ops active task health"
        >
          {!opsOk ? <ShieldX className="w-3.5 h-3.5" /> : opsCount > 0 ? <ShieldAlert className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
          OPS {opsCount}
        </button>

        <button onClick={() => router.push('/token-usage')} className="p-2 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary" title="Token Usage Dashboard">
          <BarChart3 className="w-5 h-5" />
        </button>
        <button onClick={() => router.push('/openclaw')} className="p-2 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary" title="OpenClaw Control">
          <SlidersHorizontal className="w-5 h-5" />
        </button>
        <button onClick={() => router.push('/settings')} className="p-2 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary" title="Settings">
          <Settings className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}
