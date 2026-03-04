'use client';

import { useEffect, useMemo, useState } from 'react';
import { Clock3, Cpu, ActivitySquare, PauseCircle, PlayCircle, Loader2, Trash2 } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import { formatDistanceToNow } from 'date-fns';

type SessionRow = {
  id: string;
  openclaw_session_id: string;
  status: string;
  session_type: string;
  channel?: string;
  created_at: string;
  ended_at?: string | null;
  agent_id?: string;
};

export function OfficeCanvas() {
  const { agents, tasks, events, setAgents } = useMissionControl();

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, 'pause' | 'resume' | null>>({});

  const activeTasks = tasks.filter((t) => t.status !== 'done');

  useEffect(() => {
    const loadSessions = async () => {
      try {
        const res = await fetch('/api/openclaw/sessions?status=active');
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data)) setSessions(data);
      } catch {
        // non-blocking
      }
    };

    loadSessions();
    const interval = setInterval(loadSessions, 30000);
    return () => clearInterval(interval);
  }, []);

  const agentCards = useMemo(
    () =>
      agents.map((agent) => {
        const currentTask = activeTasks.find((t) => t.assigned_agent_id === agent.id);
        const lastEvent = events.find((e) => e.agent_id === agent.id);
        const agentSessions = sessions.filter((s) => s.agent_id === agent.id && s.status === 'active');

        const statusWeight = agent.status === 'working' ? 35 : agent.status === 'standby' ? 10 : 0;
        const taskWeight = currentTask ? 35 : 0;
        const sessionWeight = Math.min(30, agentSessions.length * 15);
        const utilization = Math.min(100, statusWeight + taskWeight + sessionWeight);

        return {
          ...agent,
          currentTask,
          lastEvent,
          utilization,
          activeSessionCount: agentSessions.length,
          sessions: agentSessions,
        };
      }),
    [agents, activeTasks, events, sessions]
  );

  const setAgentStatus = async (agentId: string, status: 'standby' | 'working') => {
    const action = status === 'standby' ? 'pause' : 'resume';
    setActionLoading((prev) => ({ ...prev, [agentId]: action }));

    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });

      if (!res.ok) return;
      const updated = await res.json();
      setAgents(agents.map((a) => (a.id === agentId ? updated : a)));
    } finally {
      setActionLoading((prev) => ({ ...prev, [agentId]: null }));
    }
  };

  const killSession = async (sessionId: string) => {
    await fetch(`/api/openclaw/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => null);
    setSessions((prev) => prev.filter((s) => s.openclaw_session_id !== sessionId));
  };

  const openSessionsForAgent = (agentId: string) => {
    window.dispatchEvent(new CustomEvent('mc-open-sessions', { detail: { agentId } }));
  };

  return (
    <section className="rounded-2xl border border-mc-border bg-mc-bg-secondary/70 overflow-hidden">
      <div className="px-4 py-3 border-b border-mc-border flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-wide">Agent Operations</h3>
        <span className="text-xs text-mc-text-secondary">{agentCards.length} agents · {activeTasks.length} active tasks</span>
      </div>

      <div className="p-3 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-2.5 max-h-[360px] overflow-y-auto">
        {agentCards.map((agent) => {
          const isExpanded = expandedAgentId === agent.id;
          const action = actionLoading[agent.id];

          return (
            <div key={`card-${agent.id}`} className="rounded-lg border border-mc-border bg-mc-bg/70 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-medium truncate">{agent.name}</div>
                <span className={`text-[11px] px-1.5 py-0.5 rounded border ${agent.status === 'working' ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' : 'text-mc-text-secondary border-mc-border'}`}>
                  {agent.status}
                </span>
              </div>

              <div className="mt-2 text-[11px] text-mc-text-secondary line-clamp-1">
                {agent.currentTask ? agent.currentTask.title : 'No current task'}
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded border border-mc-border px-2 py-1 inline-flex items-center gap-1.5 text-mc-text-secondary">
                  <Clock3 className="w-3 h-3" />
                  {agent.lastEvent ? formatDistanceToNow(new Date(agent.lastEvent.created_at), { addSuffix: true }) : 'no heartbeat'}
                </div>
                <div className="rounded border border-mc-border px-2 py-1 inline-flex items-center gap-1.5 text-mc-text-secondary">
                  <Cpu className="w-3 h-3" /> {agent.utilization}%
                </div>
              </div>

              <div className="mt-2 h-1.5 rounded bg-mc-bg-tertiary overflow-hidden">
                <div className="h-full bg-mc-accent" style={{ width: `${agent.utilization}%` }} />
              </div>

              <div className="mt-2 flex items-center gap-2 text-[11px]">
                <button
                  onClick={() => setAgentStatus(agent.id, 'standby')}
                  disabled={!!action || agent.status === 'standby'}
                  className="px-2 py-1 rounded border border-mc-border bg-mc-bg-tertiary hover:bg-mc-bg inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {action === 'pause' ? <Loader2 className="w-3 h-3 animate-spin" /> : <PauseCircle className="w-3 h-3" />} Pause
                </button>
                <button
                  onClick={() => setAgentStatus(agent.id, 'working')}
                  disabled={!!action || agent.status === 'working'}
                  className="px-2 py-1 rounded border border-mc-border bg-mc-bg-tertiary hover:bg-mc-bg inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {action === 'resume' ? <Loader2 className="w-3 h-3 animate-spin" /> : <PlayCircle className="w-3 h-3" />} Resume
                </button>
                <button
                  onClick={() => setExpandedAgentId(isExpanded ? null : agent.id)}
                  className="ml-auto px-2 py-1 rounded border border-mc-border bg-mc-bg-tertiary hover:bg-mc-bg inline-flex items-center gap-1"
                >
                  <ActivitySquare className="w-3 h-3" /> inspect
                </button>
              </div>

              {isExpanded && (
                <div className="mt-2 rounded border border-mc-border bg-mc-bg/60 p-2 text-[11px] text-mc-text-secondary space-y-2">
                  <div>Active sessions: <span className="text-mc-text">{agent.activeSessionCount}</span></div>
                  <div>Assigned task: <span className="text-mc-text">{agent.currentTask ? agent.currentTask.title : 'none'}</span></div>
                  <div>Last event: <span className="text-mc-text">{agent.lastEvent ? agent.lastEvent.message : 'no events recorded'}</span></div>

                  {agent.sessions.length > 0 && (
                    <div className="space-y-1">
                      {agent.sessions.slice(0, 3).map((s) => (
                        <div key={s.openclaw_session_id} className="flex items-center justify-between rounded border border-mc-border px-2 py-1 bg-mc-bg/80">
                          <span className="truncate pr-2">{s.openclaw_session_id}</span>
                          <button
                            onClick={() => killSession(s.openclaw_session_id)}
                            className="p-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10"
                            title="Kill session"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={() => openSessionsForAgent(agent.id)}
                    className="w-full rounded border border-mc-border px-2 py-1 bg-mc-bg-tertiary hover:bg-mc-bg text-mc-text"
                  >
                    Open Sessions Tab
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
