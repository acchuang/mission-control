'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  ChevronRight,
  ChevronLeft,
  Zap,
  ZapOff,
  Loader2,
  Search,
  Folder,
  ShieldCheck,
  CalendarDays,
  FileText,
  Brain,
  Users,
  GripVertical,
  Clock,
  Check,
  RotateCcw,
  Eye,
  History,
  Bot,
  Trash2,
} from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import type { Agent, AgentStatus, Event as MissionEvent, OpenClawSession, Task } from '@/lib/types';
import { AgentModal } from './AgentModal';
import { DiscoverAgentsModal } from './DiscoverAgentsModal';
import { TaskModal } from './TaskModal';

type FilterTab = 'all' | 'working' | 'standby';
type MenuTab = 'tasks' | 'agents' | 'approvals' | 'calendar' | 'cron' | 'sessions' | 'history' | 'memory' | 'docs';

interface AgentsSidebarProps {
  workspaceId?: string;
  dockSide?: 'left' | 'right';
  onDockChange?: (side: 'left' | 'right') => void;
  fullWidth?: boolean;
}

interface FileEntry {
  name: string;
  relativePath: string;
  type: 'file' | 'dir';
}

interface FilePreview {
  path: string;
  name: string;
  lang: 'markdown' | 'text';
  content: string;
  truncated: boolean;
}

interface SessionRow {
  id: string;
  openclaw_session_id: string;
  status: string;
  session_type: string;
  channel?: string;
  created_at: string;
  ended_at?: string | null;
  agent_id?: string;
  source?: 'db' | 'gateway';
}

interface GatewaySession {
  key: string;
  kind?: string;
  displayName?: string;
  updatedAt?: number;
  createdAt?: number;
  status?: string;
  origin?: {
    provider?: string;
    surface?: string;
    channel?: string;
  };
}

interface CronJob {
  id: string;
  label?: string;
  name?: string;
  agentId?: string;
  enabled?: boolean;
  schedule?: string | {
    kind?: string;
    everyMs?: number;
    expr?: string;
    tz?: string;
  };
  state?: {
    lastStatus?: string;
    consecutiveErrors?: number;
    nextRunAtMs?: number;
    lastRunAtMs?: number;
  };
}

export function AgentsSidebar({ workspaceId, dockSide = 'left', onDockChange, fullWidth = false }: AgentsSidebarProps) {
  const {
    agents,
    tasks,
    selectedAgent,
    setSelectedAgent,
    agentOpenClawSessions,
    setAgentOpenClawSession,
    setTasks,
    updateTaskStatus,
  } = useMissionControl();

  const [filter, setFilter] = useState<FilterTab>('all');
  const [activeTab, setActiveTab] = useState<MenuTab>('agents');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [showDiscoverModal, setShowDiscoverModal] = useState(false);
  const [connectingAgentId, setConnectingAgentId] = useState<string | null>(null);
  const [activeSubAgents, setActiveSubAgents] = useState(0);
  const [isMinimized, setIsMinimized] = useState(false);
  const [memoryFiles, setMemoryFiles] = useState<FileEntry[]>([]);
  const [docFiles, setDocFiles] = useState<FileEntry[]>([]);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [historyEvents, setHistoryEvents] = useState<MissionEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [cronLoading, setCronLoading] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [sessionFilterAgentId, setSessionFilterAgentId] = useState<string | null>(null);

  const navSections: Array<{ section: string; items: Array<{ key: MenuTab; label: string; icon: typeof Folder }> }> = [
    {
      section: 'Overview',
      items: [
        { key: 'tasks', label: 'Tasks', icon: Folder },
        { key: 'agents', label: 'Agents', icon: Users },
        { key: 'sessions', label: 'Sessions', icon: Bot },
      ],
    },
    {
      section: 'Observe',
      items: [
        { key: 'history', label: 'Activity', icon: History },
        { key: 'memory', label: 'Memory', icon: Brain },
        { key: 'docs', label: 'Docs', icon: FileText },
      ],
    },
    {
      section: 'Automate',
      items: [
        { key: 'cron', label: 'Cron', icon: Clock },
        { key: 'approvals', label: 'Approvals', icon: ShieldCheck },
        { key: 'calendar', label: 'Calendar', icon: CalendarDays },
      ],
    },
  ];

  const refreshTasks = useCallback(async () => {
    if (!workspaceId) return;
    const res = await fetch(`/api/tasks?workspace_id=${workspaceId}`);
    if (res.ok) setTasks(await res.json());
  }, [workspaceId, setTasks]);

  const refreshFiles = useCallback(async () => {
    const [memRes, docsRes] = await Promise.all([
      fetch('/api/workspace/context?path=memory'),
      fetch('/api/workspace/context?path=docs'),
    ]);

    if (memRes.ok) {
      const data = await memRes.json();
      setMemoryFiles((data.entries || []).filter((x: FileEntry) => x.type === 'file').slice(0, 20));
    }

    if (docsRes.ok) {
      const data = await docsRes.json();
      setDocFiles((data.entries || []).filter((x: FileEntry) => x.type === 'file').slice(0, 20));
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/events?limit=100').catch(() => null);
      if (res?.ok) {
        const events = await res.json();
        setHistoryEvents(Array.isArray(events) ? events : []);
      }
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch('/api/openclaw/sessions').catch(() => null);
      if (res?.ok) {
        const data = await res.json();

        // API can return DB rows (array) OR live gateway envelope { sessions: [...] }
        if (Array.isArray(data)) {
          setSessions(data.map((row) => ({ ...row, source: 'db' as const })));
        } else {
          const live = Array.isArray(data?.sessions) ? (data.sessions as GatewaySession[]) : [];
          const normalized: SessionRow[] = live.map((s, index) => {
            const createdMs = s.createdAt ?? s.updatedAt ?? Date.now();
            return {
              id: `gateway-${s.key}-${index}`,
              openclaw_session_id: s.key,
              status: s.status || 'active',
              session_type: s.kind || 'direct',
              channel: s.origin?.provider || s.origin?.surface || s.origin?.channel,
              created_at: new Date(createdMs).toISOString(),
              ended_at: null,
              source: 'gateway',
            };
          });

          normalized.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
          setSessions(normalized);
        }
      }
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const loadOpenClawSessions = useCallback(async () => {
    for (const agent of agents) {
      const res = await fetch(`/api/agents/${agent.id}/openclaw`).catch(() => null);
      if (res?.ok) {
        const data = await res.json();
        if (data.linked && data.session) setAgentOpenClawSession(agent.id, data.session as OpenClawSession);
      }
    }
  }, [agents, setAgentOpenClawSession]);

  const refreshCron = useCallback(async () => {
    setCronLoading(true);
    try {
      const res = await fetch('/api/openclaw/cron').catch(() => null);
      if (res?.ok) {
        const data = await res.json();
        setCronJobs(Array.isArray(data?.jobs) ? data.jobs : []);
      }
    } finally {
      setCronLoading(false);
    }
  }, []);

  useEffect(() => {
    if (agents.length > 0) loadOpenClawSessions();
  }, [loadOpenClawSessions, agents.length]);

  useEffect(() => {
    refreshFiles().catch(() => undefined);
  }, [refreshFiles]);

  useEffect(() => {
    refreshHistory().catch(() => undefined);
    const interval = setInterval(() => {
      refreshHistory().catch(() => undefined);
    }, 30000);
    return () => clearInterval(interval);
  }, [refreshHistory]);

  useEffect(() => {
    refreshSessions().catch(() => undefined);
    const interval = setInterval(() => {
      refreshSessions().catch(() => undefined);
    }, 30000);
    return () => clearInterval(interval);
  }, [refreshSessions]);

  useEffect(() => {
    refreshCron().catch(() => undefined);
    const interval = setInterval(() => {
      refreshCron().catch(() => undefined);
    }, 30000);
    return () => clearInterval(interval);
  }, [refreshCron]);

  useEffect(() => {
    const loadSubAgentCount = async () => {
      const res = await fetch('/api/openclaw/sessions').catch(() => null);
      if (res?.ok) {
        const data = await res.json();

        if (Array.isArray(data)) {
          setActiveSubAgents(data.filter((s) => s.session_type === 'subagent' && s.status === 'active').length);
          return;
        }

        const live = Array.isArray(data?.sessions) ? (data.sessions as GatewaySession[]) : [];
        setActiveSubAgents(live.filter((s) => (s.kind || '').toLowerCase() === 'subagent').length);
      }
    };

    loadSubAgentCount();
    const interval = setInterval(loadSubAgentCount, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const onOpenSessions = (event: Event) => {
      const customEvent = event as unknown as CustomEvent<{ agentId?: string }>;
      setActiveTab('sessions');
      setSessionFilterAgentId(customEvent.detail?.agentId || null);
    };

    window.addEventListener('mc-open-sessions', onOpenSessions as EventListener);
    return () => window.removeEventListener('mc-open-sessions', onOpenSessions as EventListener);
  }, []);

  const handleConnectToOpenClaw = async (agent: Agent, e: React.MouseEvent) => {
    e.stopPropagation();
    setConnectingAgentId(agent.id);

    try {
      const existingSession = agentOpenClawSessions[agent.id];
      if (existingSession) {
        const res = await fetch(`/api/agents/${agent.id}/openclaw`, { method: 'DELETE' });
        if (res.ok) setAgentOpenClawSession(agent.id, null);
      } else {
        const res = await fetch(`/api/agents/${agent.id}/openclaw`, { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          setAgentOpenClawSession(agent.id, data.session as OpenClawSession);
        }
      }
    } finally {
      setConnectingAgentId(null);
    }
  };

  const updateTask = async (taskId: string, patch: Partial<Task>) => {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });

    if (res.ok) {
      const updated = await res.json();
      if (patch.status) updateTaskStatus(taskId, patch.status);
      return updated;
    }

    return null;
  };

  const approveTask = async (task: Task) => {
    await updateTask(task.id, { status: 'done' as Task['status'] });
    await refreshTasks();
  };

  const returnTask = async (task: Task) => {
    await updateTask(task.id, { status: 'in_progress' as Task['status'] });
    await refreshTasks();
  };

  const setDueDate = async (task: Task, dueDate: string) => {
    await updateTask(task.id, { due_date: dueDate } as Partial<Task>);
    await refreshTasks();
  };

  const openFilePreview = async (relativePath: string) => {
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(relativePath)}`);
      const data = await res.json();
      if (res.ok) setPreview(data);
    } finally {
      setPreviewLoading(false);
    }
  };

  const filteredAgents = agents.filter((agent) => (filter === 'all' ? true : agent.status === filter));
  const queueTasks = tasks.filter((t) => t.status !== 'done').slice(0, 20);
  const approvalTasks = tasks.filter((t) => t.status === 'review' || t.status === 'testing').slice(0, 20);
  const datedTasks = tasks
    .filter((t) => !!t.due_date)
    .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''))
    .slice(0, 20);

  const taskHistoryItems = tasks
    .flatMap((t) => {
      const items = [
        { id: `${t.id}-created`, type: 'task_created', message: `Task created: ${t.title}`, created_at: t.created_at },
      ];
      if (t.updated_at !== t.created_at) {
        items.push({ id: `${t.id}-updated`, type: 'task_status_changed', message: `Task updated (${t.status.replace('_', ' ')}): ${t.title}`, created_at: t.updated_at });
      }
      return items;
    })
    .slice(0, 100);

  const combinedHistory = [...historyEvents, ...taskHistoryItems]
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, 50);

  const getStatusBadge = (status: AgentStatus) => {
    const styles = { standby: 'status-standby', working: 'status-working', offline: 'status-offline' };
    return styles[status] || styles.standby;
  };

  const handleDockDragEnd = (e: React.DragEvent) => {
    const midpoint = window.innerWidth / 2;
    onDockChange?.(e.clientX > midpoint ? 'right' : 'left');
  };

  const renderTasksTab = () => (
    <div className="p-2 space-y-2 overflow-y-auto">
      {queueTasks.length === 0 ? (
        <div className="text-xs text-mc-text-secondary">No active tasks.</div>
      ) : (
        queueTasks.map((t) => (
          <button key={t.id} onClick={() => setEditingTask(t)} className="w-full text-left text-xs rounded border border-mc-border bg-mc-bg p-2 hover:bg-mc-bg-tertiary">
            <div className="font-medium truncate">{t.title}</div>
            <div className="text-mc-text-secondary mt-1 uppercase">{t.status.replace('_', ' ')}</div>
          </button>
        ))
      )}
    </div>
  );

  const renderAgentsTab = () => (
    <>
      <div className="px-2 pb-2 border-b border-mc-border">
        <div className="flex gap-1">
          {(['all', 'working', 'standby'] as FilterTab[]).map((tab) => (
            <button key={tab} onClick={() => setFilter(tab)} className={`px-3 py-1 text-xs rounded uppercase ${filter === tab ? 'bg-mc-accent text-mc-bg font-medium' : 'text-mc-text-secondary hover:bg-mc-bg-tertiary'}`}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredAgents.map((agent) => {
          const openclawSession = agentOpenClawSessions[agent.id];
          const isConnecting = connectingAgentId === agent.id;

          return (
            <div key={agent.id} className={`w-full rounded hover:bg-mc-bg-tertiary transition-colors ${selectedAgent?.id === agent.id ? 'bg-mc-bg-tertiary' : ''}`}>
              <button onClick={() => { setSelectedAgent(agent); setEditingAgent(agent); }} className="w-full flex items-center gap-3 p-2 text-left">
                <div className="text-2xl relative">
                  {agent.avatar_emoji}
                  {openclawSession && <span className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-mc-bg-secondary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2"><span className="font-medium text-sm truncate">{agent.name}</span>{!!agent.is_master && <span className="text-xs text-mc-accent-yellow">★</span>}</div>
                  <div className="text-xs text-mc-text-secondary truncate">{agent.role}</div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded uppercase ${getStatusBadge(agent.status)}`}>{agent.status}</span>
              </button>

              {!!agent.is_master && (
                <div className="px-2 pb-2">
                  <button onClick={(e) => handleConnectToOpenClaw(agent, e)} disabled={isConnecting} className={`w-full flex items-center justify-center gap-2 px-2 py-1 rounded text-xs transition-colors ${openclawSession ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' : 'bg-mc-bg text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-text'}`}>
                    {isConnecting ? <><Loader2 className="w-3 h-3 animate-spin" /><span>Connecting...</span></> : openclawSession ? <><Zap className="w-3 h-3" /><span>OpenClaw Connected</span></> : <><ZapOff className="w-3 h-3" /><span>Connect to OpenClaw</span></>}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );

  const renderApprovalsTab = () => (
    <div className="p-2 space-y-2 overflow-y-auto">
      {approvalTasks.length === 0 ? (
        <div className="text-xs text-mc-text-secondary">No approval items.</div>
      ) : (
        approvalTasks.map((t) => (
          <div key={t.id} className="text-xs rounded border border-mc-border bg-mc-bg p-2">
            <div className="font-medium truncate">{t.title}</div>
            <div className="text-mc-text-secondary mt-1 uppercase">{t.status.replace('_', ' ')}</div>
            <div className="mt-2 flex gap-1">
              <button onClick={() => approveTask(t)} className="px-2 py-1 rounded bg-green-500/20 text-green-300 border border-green-500/30 inline-flex items-center gap-1"><Check className="w-3 h-3" />Approve</button>
              <button onClick={() => returnTask(t)} className="px-2 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 inline-flex items-center gap-1"><RotateCcw className="w-3 h-3" />Return</button>
            </div>
          </div>
        ))
      )}
    </div>
  );

  const renderCalendarTab = () => (
    <div className="p-2 space-y-2 overflow-y-auto">
      {tasks.slice(0, 20).map((t) => (
        <div key={t.id} className="text-xs rounded border border-mc-border bg-mc-bg p-2">
          <div className="font-medium truncate">{t.title}</div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="date"
              value={(t.due_date || '').slice(0, 10)}
              onChange={(e) => setDueDate(t, e.target.value)}
              className="bg-mc-bg-tertiary border border-mc-border rounded px-2 py-1 text-xs"
            />
            {t.due_date && <span className="text-mc-text-secondary">Due set</span>}
          </div>
        </div>
      ))}
      {tasks.length === 0 && <div className="text-xs text-mc-text-secondary">No tasks yet.</div>}
      {datedTasks.length > 0 && <div className="text-[11px] text-mc-text-secondary">Dated items: {datedTasks.length}</div>}
    </div>
  );

  const handleSessionComplete = async (sessionId: string) => {
    await fetch(`/api/openclaw/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed', ended_at: new Date().toISOString() }),
    }).catch(() => null);
    refreshSessions().catch(() => undefined);
  };

  const formatMsTime = (value?: number) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString();
  };

  const cronStatusTone = (job: CronJob) => {
    const last = (job.state?.lastStatus || '').toLowerCase();
    const errors = job.state?.consecutiveErrors || 0;
    if (!job.enabled) return 'text-mc-text-secondary';
    if (errors > 0 || (last && last !== 'ok')) return 'text-red-400';
    return 'text-green-400';
  };

  const formatCronSchedule = (schedule: CronJob['schedule']) => {
    if (!schedule) return 'No schedule';
    if (typeof schedule === 'string') return schedule;

    if (schedule.kind === 'every' && schedule.everyMs) {
      const sec = Math.floor(schedule.everyMs / 1000);
      if (sec < 60) return `every ${sec}s`;
      const min = Math.floor(sec / 60);
      if (min < 60) return `every ${min}m`;
      const hr = Math.floor(min / 60);
      return `every ${hr}h`;
    }

    if (schedule.kind === 'cron' && schedule.expr) {
      return `${schedule.expr}${schedule.tz ? ` (${schedule.tz})` : ''}`;
    }

    return schedule.kind || 'custom schedule';
  };

  const resolveCronAgent = (agentId?: string) => {
    if (!agentId) return 'unassigned';
    const found = agents.find((a) => a.id === agentId || a.name.toLowerCase() === agentId.toLowerCase());
    return found ? `${found.avatar_emoji} ${found.name}` : agentId;
  };

  const renderCronTab = () => (
    <div className="p-2 space-y-2 overflow-y-auto">
      <div className="flex items-center justify-between rounded border border-mc-border bg-mc-bg p-2">
        <div className="text-xs text-mc-text-secondary">Cron jobs</div>
        <button onClick={() => refreshCron()} className="px-2 py-1 rounded bg-mc-bg-tertiary border border-mc-border text-xs">Refresh</button>
      </div>

      {cronLoading && <div className="text-xs text-mc-text-secondary">Loading cron jobs...</div>}
      {!cronLoading && cronJobs.length === 0 && <div className="text-xs text-mc-text-secondary">No cron jobs found.</div>}

      {cronJobs.map((job) => (
        <div key={job.id} className="text-xs rounded border border-mc-border bg-mc-bg p-2">
          <div className="flex items-start justify-between gap-2">
            <div className="font-medium truncate">{job.label || job.name || job.id}</div>
            <span className={cronStatusTone(job)}>{job.enabled ? 'enabled' : 'disabled'}</span>
          </div>
          <div className="text-mc-text-secondary mt-1">{formatCronSchedule(job.schedule)}</div>
          <div className="text-[11px] text-mc-text-secondary mt-1">
            dog: <span className="text-mc-text">{resolveCronAgent(job.agentId)}</span>
          </div>
          <div className="text-[11px] text-mc-text-secondary mt-1">
            last: {job.state?.lastStatus || 'n/a'} · errors: {job.state?.consecutiveErrors ?? 0}
          </div>
          <div className="text-[11px] text-mc-text-secondary mt-1">
            next: {formatMsTime(job.state?.nextRunAtMs)}
          </div>
        </div>
      ))}
    </div>
  );

  const handleSessionDelete = async (sessionId: string) => {
    await fetch(`/api/openclaw/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => null);
    refreshSessions().catch(() => undefined);
  };

  const renderSessionsTab = () => {
    const visibleSessions = sessionFilterAgentId
      ? sessions.filter((s) => s.agent_id === sessionFilterAgentId)
      : sessions;

    const filteredAgent = sessionFilterAgentId ? agents.find((a) => a.id === sessionFilterAgentId) : null;

    return (
    <div className="p-2 space-y-2 overflow-y-auto">
      <div className="flex items-center justify-between rounded border border-mc-border bg-mc-bg p-2">
        <div className="text-xs text-mc-text-secondary">Session control</div>
        <button onClick={() => refreshSessions()} className="px-2 py-1 rounded bg-mc-bg-tertiary border border-mc-border text-xs">Refresh</button>
      </div>

      {sessionFilterAgentId && (
        <div className="flex items-center justify-between rounded border border-mc-border bg-mc-bg p-2 text-xs">
          <div className="text-mc-text-secondary">
            Filter: <span className="text-mc-text">{filteredAgent ? `${filteredAgent.avatar_emoji} ${filteredAgent.name}` : sessionFilterAgentId}</span>
          </div>
          <button onClick={() => setSessionFilterAgentId(null)} className="px-2 py-1 rounded bg-mc-bg-tertiary border border-mc-border text-xs">Clear</button>
        </div>
      )}

      {sessionsLoading && <div className="text-xs text-mc-text-secondary">Loading sessions...</div>}
      {!sessionsLoading && visibleSessions.length === 0 && <div className="text-xs text-mc-text-secondary">No sessions found.</div>}

      {visibleSessions.map((s) => (
        <div key={s.id} className="text-xs rounded border border-mc-border bg-mc-bg p-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-medium truncate">{s.openclaw_session_id}</div>
              <div className="text-mc-text-secondary mt-1">{s.session_type} · {s.status}</div>
              <div className="text-[11px] text-mc-text-secondary mt-1">{formatTimestamp(s.created_at)}</div>
            </div>
            <div className="flex items-center gap-1">
              {s.source === 'db' && s.status === 'active' && (
                <button
                  onClick={() => handleSessionComplete(s.openclaw_session_id)}
                  className="p-1 rounded border border-green-500/40 text-green-400 hover:bg-green-500/10"
                  title="Mark complete"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              )}
              {s.source === 'db' && (
                <button
                  onClick={() => handleSessionDelete(s.openclaw_session_id)}
                  className="p-1 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10"
                  title="Delete session"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

  const formatTimestamp = (iso?: string) => {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString();
  };

  const formatRelativeTime = (iso?: string) => {
    if (!iso) return 'unknown';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const deltaMs = Date.now() - date.getTime();
    const deltaMin = Math.floor(deltaMs / 60000);
    if (deltaMin < 1) return 'just now';
    if (deltaMin < 60) return `${deltaMin}m ago`;
    const deltaHr = Math.floor(deltaMin / 60);
    if (deltaHr < 24) return `${deltaHr}h ago`;
    const deltaDay = Math.floor(deltaHr / 24);
    return `${deltaDay}d ago`;
  };

  const getHistoryTypeTone = (type?: string) => {
    if (!type) return 'bg-mc-bg-tertiary text-mc-text-secondary border-mc-border';
    if (type.includes('task')) return 'bg-blue-500/10 text-blue-300 border-blue-500/30';
    if (type.includes('agent')) return 'bg-violet-500/10 text-violet-300 border-violet-500/30';
    if (type.includes('system')) return 'bg-amber-500/10 text-amber-300 border-amber-500/30';
    if (type.includes('message')) return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30';
    return 'bg-mc-bg-tertiary text-mc-text-secondary border-mc-border';
  };

  const renderHistoryTab = () => (
    <div className="p-2 space-y-2 overflow-y-auto">
      <div className="rounded border border-mc-border bg-mc-bg p-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-medium text-mc-text">History</div>
            <div className="text-[11px] text-mc-text-secondary">Past tasks, cron/system runs, and relevant activity with timestamps</div>
          </div>
          <button onClick={() => refreshHistory()} className="px-2 py-1 rounded bg-mc-bg-tertiary border border-mc-border text-xs hover:bg-mc-border">Refresh</button>
        </div>
        <div className="mt-2 text-[11px] text-mc-text-secondary">Showing latest {combinedHistory.length} records</div>
      </div>

      {historyLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 rounded border border-mc-border bg-mc-bg-tertiary/40 animate-pulse" />
          ))}
        </div>
      )}

      {!historyLoading && combinedHistory.length === 0 && (
        <div className="text-xs text-mc-text-secondary rounded border border-mc-border bg-mc-bg p-3">No history yet.</div>
      )}

      {combinedHistory.map((item) => (
        <div key={item.id} className="text-xs rounded border border-mc-border bg-mc-bg p-2">
          <div className="flex items-start justify-between gap-2">
            <div className="font-medium leading-relaxed">{item.message}</div>
            <span className="shrink-0 text-[11px] text-mc-text-secondary">{formatRelativeTime(item.created_at)}</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className={`px-1.5 py-0.5 rounded border text-[10px] uppercase ${getHistoryTypeTone(item.type)}`}>
              {item.type.replace('_', ' ')}
            </span>
            <span className="text-[11px] text-mc-text-secondary">{formatTimestamp(item.created_at)}</span>
          </div>
        </div>
      ))}
    </div>
  );

  const renderFileTab = (files: FileEntry[], emptyText: string) => (
    <div className="p-2 space-y-2 overflow-y-auto">
      {files.length === 0 ? (
        <div className="text-xs text-mc-text-secondary">{emptyText}</div>
      ) : (
        files.map((f) => (
          <div key={f.relativePath} className="text-xs rounded border border-mc-border bg-mc-bg p-2">
            <div className="font-medium truncate">{f.name}</div>
            <div className="mt-2 flex gap-1">
              <button onClick={() => openFilePreview(f.relativePath)} className="px-2 py-1 rounded bg-mc-bg-tertiary border border-mc-border inline-flex items-center gap-1"><Eye className="w-3 h-3" />Preview</button>
            </div>
          </div>
        ))
      )}

      <div className="rounded border border-mc-border bg-mc-bg p-2 min-h-24">
        <div className="text-[11px] text-mc-text-secondary mb-1">Preview</div>
        {previewLoading && <div className="text-xs text-mc-text-secondary">Loading...</div>}
        {!previewLoading && preview && (
          <pre className="text-[11px] whitespace-pre-wrap break-words max-h-44 overflow-auto">{preview.content}{preview.truncated ? '\n\n...truncated' : ''}</pre>
        )}
      </div>
    </div>
  );

  return (
    <aside
      draggable
      onDragEnd={handleDockDragEnd}
      className={`bg-mc-bg-secondary/70 border-mc-border flex flex-col transition-all duration-300 ease-in-out w-full ${dockSide === 'left' ? 'md:border-r' : 'md:border-l'} ${fullWidth ? 'md:w-full' : isMinimized ? 'md:w-12' : 'md:w-64'}`}
    >
      <div className="p-3 border-b border-mc-border space-y-3">
        <div className="flex items-center justify-between">
          <button onClick={() => setIsMinimized(!isMinimized)} className="p-1 rounded hover:bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-text transition-colors" aria-label={isMinimized ? 'Expand menu' : 'Minimize menu'}>
            {isMinimized ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
          {!isMinimized && (
            <div className="flex items-center gap-2 text-xs text-mc-text-secondary">
              <GripVertical className="w-4 h-4" /> drag to dock
              <button onClick={() => onDockChange?.(dockSide === 'left' ? 'right' : 'left')} className="px-2 py-0.5 rounded border border-mc-border hover:bg-mc-bg-tertiary">{dockSide === 'left' ? 'Dock Right' : 'Dock Left'}</button>
            </div>
          )}
        </div>

        {!isMinimized && (
          <div className="rounded-lg border border-mc-border bg-mc-bg px-3 py-2">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded bg-blue-500/20 border border-blue-500/30 text-blue-300 text-[11px] font-semibold grid place-items-center">MC</div>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">Mission Control</div>
                <div className="text-[11px] text-mc-text-secondary truncate">Ops cockpit</div>
              </div>
            </div>
          </div>
        )}

        {!isMinimized && activeSubAgents > 0 && (
          <div className="px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg">
            <div className="flex items-center gap-2 text-sm"><span className="text-mc-text">Active Sub-Agents:</span><span className="font-bold text-green-400">{activeSubAgents}</span></div>
          </div>
        )}
      </div>

      {!isMinimized && (
        <div className="px-2 py-2 border-b border-mc-border space-y-3">
          {navSections.map((group) => (
            <div key={group.section} className="space-y-1">
              <div className="px-2 text-[10px] uppercase tracking-[0.14em] text-mc-text-secondary/80">{group.section}</div>
              {group.items.map((item) => (
                <button
                  key={item.key}
                  onClick={() => setActiveTab(item.key)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm transition-colors ${activeTab === item.key ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' : 'text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-text border border-transparent'}`}
                >
                  <item.icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        {activeTab === 'tasks' && renderTasksTab()}
        {activeTab === 'agents' && renderAgentsTab()}
        {activeTab === 'approvals' && renderApprovalsTab()}
        {activeTab === 'calendar' && renderCalendarTab()}
        {activeTab === 'cron' && renderCronTab()}
        {activeTab === 'sessions' && renderSessionsTab()}
        {activeTab === 'history' && renderHistoryTab()}
        {activeTab === 'memory' && renderFileTab(memoryFiles, 'No memory files found.')}
        {activeTab === 'docs' && renderFileTab(docFiles, 'No docs files found.')}
      </div>

      {!isMinimized && activeTab === 'agents' && (
        <div className="p-3 border-t border-mc-border space-y-2">
          <button onClick={() => setShowCreateModal(true)} className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-mc-bg-tertiary hover:bg-mc-border rounded text-sm text-mc-text-secondary hover:text-mc-text transition-colors">
            <Plus className="w-4 h-4" />Add Agent
          </button>
          <button onClick={() => setShowDiscoverModal(true)} className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded text-sm text-blue-400 hover:text-blue-300 transition-colors">
            <Search className="w-4 h-4" />Import from Gateway
          </button>
        </div>
      )}

      {showCreateModal && <AgentModal onClose={() => setShowCreateModal(false)} workspaceId={workspaceId} />}
      {editingAgent && <AgentModal agent={editingAgent} onClose={() => setEditingAgent(null)} workspaceId={workspaceId} />}
      {showDiscoverModal && <DiscoverAgentsModal onClose={() => setShowDiscoverModal(false)} workspaceId={workspaceId} />}
      {editingTask && <TaskModal task={editingTask} onClose={() => setEditingTask(null)} workspaceId={workspaceId} />}
    </aside>
  );
}
