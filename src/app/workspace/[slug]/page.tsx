'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, KanbanSquare, Users, Activity } from 'lucide-react';
import { Header } from '@/components/Header';
import { AgentsSidebar } from '@/components/AgentsSidebar';
import { MissionQueue } from '@/components/MissionQueue';
import { LiveFeed } from '@/components/LiveFeed';
import { SSEDebugPanel } from '@/components/SSEDebugPanel';
import { useMissionControl } from '@/lib/store';
import { useSSE } from '@/hooks/useSSE';
import { debug } from '@/lib/debug';
import type { Task, Workspace } from '@/lib/types';

export default function WorkspacePage() {
  const params = useParams();
  const slug = params.slug as string;
  
  const {
    setAgents,
    setTasks,
    setEvents,
    setIsOnline,
    setIsLoading,
    isLoading,
  } = useMissionControl();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [menuDockSide, setMenuDockSide] = useState<'left' | 'right'>('left');
  const [mobileTab, setMobileTab] = useState<'queue' | 'agents' | 'feed'>('queue');
  const [desktopTab, setDesktopTab] = useState<'queue' | 'agents' | 'feed'>('queue');
  const openClawFailureCount = useRef(0);

  // Connect to SSE for real-time updates
  useSSE();

  // Load workspace data
  useEffect(() => {
    async function loadWorkspace() {
      try {
        const res = await fetch(`/api/workspaces/${slug}`);
        if (res.ok) {
          const data = await res.json();
          setWorkspace(data);
        } else if (res.status === 404) {
          setNotFound(true);
          setIsLoading(false);
          return;
        }
      } catch (error) {
        console.error('Failed to load workspace:', error);
        setNotFound(true);
        setIsLoading(false);
        return;
      }
    }

    loadWorkspace();
  }, [slug, setIsLoading]);

  // Load workspace-specific data
  useEffect(() => {
    if (!workspace) return;
    
    const workspaceId = workspace.id;

    async function loadData() {
      try {
        debug.api('Loading workspace data...', { workspaceId });
        
        // Fetch workspace-scoped data
        const [agentsRes, tasksRes, eventsRes] = await Promise.all([
          fetch(`/api/agents?workspace_id=${workspaceId}`, { cache: 'no-store' }),
          fetch(`/api/tasks?workspace_id=${workspaceId}`, { cache: 'no-store' }),
          fetch('/api/events', { cache: 'no-store' }),
        ]);

        if (agentsRes.ok) setAgents(await agentsRes.json());
        if (tasksRes.ok) {
          const tasksData = await tasksRes.json();
          debug.api('Loaded tasks', { count: tasksData.length });
          setTasks(tasksData);
        }
        if (eventsRes.ok) setEvents(await eventsRes.json());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setIsLoading(false);
      }
    }

    // Check OpenClaw connection separately (non-blocking)
    async function checkOpenClaw() {
      try {
        const openclawRes = await fetch('/api/openclaw/status?lite=1', { cache: 'no-store' });

        if (!openclawRes.ok) {
          throw new Error(`OpenClaw status failed: ${openclawRes.status}`);
        }

        const status = await openclawRes.json();
        if (status?.connected) {
          openClawFailureCount.current = 0;
          setIsOnline(true);
        } else {
          openClawFailureCount.current += 1;
          if (openClawFailureCount.current >= 2) {
            setIsOnline(false);
          }
        }
      } catch {
        openClawFailureCount.current += 1;
        if (openClawFailureCount.current >= 2) {
          setIsOnline(false);
        }
      }
    }

    async function runOpenClawSync() {
      try {
        const res = await fetch('/api/openclaw/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
        });

        if (res.ok) {
          openClawFailureCount.current = 0;
          setIsOnline(true);
        }
      } catch (error) {
        console.error('OpenClaw sync failed:', error);
      }
    }

    loadData();
    checkOpenClaw();
    runOpenClawSync();

    // SSE is the primary real-time mechanism - these are fallback polls with longer intervals
    // to reduce server load while providing redundancy

    // Poll for events every 30 seconds (SSE fallback - increased from 5s)
    const eventPoll = setInterval(async () => {
      try {
        const res = await fetch('/api/events?limit=20', { cache: 'no-store' });
        if (res.ok) {
          setEvents(await res.json());
        }
      } catch (error) {
        console.error('Failed to poll events:', error);
      }
    }, 30000); // Increased from 5000 to 30000

    // Poll tasks as SSE fallback every 60 seconds (increased from 10s)
    const taskPoll = setInterval(async () => {
      try {
        const res = await fetch(`/api/tasks?workspace_id=${workspaceId}`, { cache: 'no-store' });
        if (res.ok) {
          const newTasks: Task[] = await res.json();
          const currentTasks = useMissionControl.getState().tasks;

          const hasChanges = newTasks.length !== currentTasks.length ||
            newTasks.some((t) => {
              const current = currentTasks.find(ct => ct.id === t.id);
              return !current || current.status !== t.status;
            });

          if (hasChanges) {
            debug.api('[FALLBACK] Task changes detected via polling, updating store');
            setTasks(newTasks);
          }
        }
      } catch (error) {
        console.error('Failed to poll tasks:', error);
      }
    }, 60000); // Increased from 10000 to 60000

    // Sync OpenClaw sessions/cron health into tasks/events every 30s
    const openclawSyncPoll = setInterval(async () => {
      await runOpenClawSync();
    }, 30000);

    // Check OpenClaw connection every 10 seconds for faster badge recovery
    const connectionCheck = setInterval(async () => {
      await checkOpenClaw();
    }, 10000);

    return () => {
      clearInterval(eventPoll);
      clearInterval(connectionCheck);
      clearInterval(taskPoll);
      clearInterval(openclawSyncPoll);
    };
  }, [workspace, setAgents, setTasks, setEvents, setIsOnline, setIsLoading]);

  if (notFound) {
    return (
      <div className="min-h-screen bg-mc-bg flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">🔍</div>
          <h1 className="text-2xl font-bold mb-2">Workspace Not Found</h1>
          <p className="text-mc-text-secondary mb-6">
            The workspace &ldquo;{slug}&rdquo; doesn&apos;t exist.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-mc-accent text-mc-bg rounded-lg font-medium hover:bg-mc-accent/90"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (isLoading || !workspace) {
    return (
      <div className="min-h-screen bg-mc-bg flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-pulse">🦞</div>
          <p className="text-mc-text-secondary">Loading {slug}...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-mc-bg overflow-hidden px-3 py-3 md:px-4 md:py-4 gap-3">
      <Header workspace={workspace} />

      <div className="md:hidden px-3 py-2 border-b border-mc-border bg-mc-bg-secondary">
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => setMobileTab('queue')}
            className={`inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded text-xs ${mobileTab === 'queue' ? 'bg-mc-accent text-mc-bg font-medium' : 'bg-mc-bg-tertiary text-mc-text-secondary'}`}
          >
            <KanbanSquare className="w-3.5 h-3.5" /> Queue
          </button>
          <button
            onClick={() => setMobileTab('agents')}
            className={`inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded text-xs ${mobileTab === 'agents' ? 'bg-mc-accent text-mc-bg font-medium' : 'bg-mc-bg-tertiary text-mc-text-secondary'}`}
          >
            <Users className="w-3.5 h-3.5" /> Agents
          </button>
          <button
            onClick={() => setMobileTab('feed')}
            className={`inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded text-xs ${mobileTab === 'feed' ? 'bg-mc-accent text-mc-bg font-medium' : 'bg-mc-bg-tertiary text-mc-text-secondary'}`}
          >
            <Activity className="w-3.5 h-3.5" /> Feed
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden md:hidden">
        {mobileTab === 'queue' && <MissionQueue workspaceId={workspace.id} />}
        {mobileTab === 'agents' && <AgentsSidebar workspaceId={workspace.id} dockSide="left" onDockChange={setMenuDockSide} />}
        {mobileTab === 'feed' && <LiveFeed />}
      </div>

      <div className="hidden md:flex flex-1 overflow-hidden panel-shell">
        {desktopTab === 'queue' && (
          <>
            {menuDockSide === 'left' && (
              <AgentsSidebar workspaceId={workspace.id} dockSide={menuDockSide} onDockChange={setMenuDockSide} />
            )}

            <MissionQueue workspaceId={workspace.id} />

            {menuDockSide === 'right' && (
              <AgentsSidebar workspaceId={workspace.id} dockSide={menuDockSide} onDockChange={setMenuDockSide} />
            )}

            <LiveFeed />
          </>
        )}

        {desktopTab === 'agents' && (
          <AgentsSidebar workspaceId={workspace.id} dockSide="left" onDockChange={setMenuDockSide} fullWidth />
        )}

        {desktopTab === 'feed' && <LiveFeed />}
      </div>

      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 hidden md:flex items-center gap-2 rounded-xl border border-mc-border bg-mc-bg-secondary/95 backdrop-blur-sm px-2 py-2 shadow-lg">
        <button
          onClick={() => setDesktopTab('queue')}
          className={`px-3 py-1.5 rounded-lg text-xs ${desktopTab === 'queue' ? 'bg-mc-accent text-mc-bg font-medium' : 'bg-mc-bg-tertiary hover:bg-mc-border'}`}
        >
          Queue
        </button>
        <button
          onClick={() => setDesktopTab('agents')}
          className={`px-3 py-1.5 rounded-lg text-xs ${desktopTab === 'agents' ? 'bg-mc-accent text-mc-bg font-medium' : 'bg-mc-bg-tertiary hover:bg-mc-border'}`}
        >
          Agents
        </button>
        <button
          onClick={() => setDesktopTab('feed')}
          className={`px-3 py-1.5 rounded-lg text-xs ${desktopTab === 'feed' ? 'bg-mc-accent text-mc-bg font-medium' : 'bg-mc-bg-tertiary hover:bg-mc-border'}`}
        >
          Feed
        </button>
      </div>

      <SSEDebugPanel />
    </div>
  );
}
