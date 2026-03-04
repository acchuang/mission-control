'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, ChevronLeft, Clock, FolderTree, Activity, Search, Eye, FolderOpen, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import type { Event } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';

type FeedFilter = 'all' | 'tasks' | 'agents';
type SideTab = 'feed' | 'workspace' | 'ops';

type ActiveTask = {
  id: string;
  type: string;
  status: string;
  severity?: 'low' | 'medium' | 'high' | 'info';
  title: string;
  owner?: string;
  source?: string;
  detail?: string;
  url?: string;
};

type ActiveTaskPayload = {
  ok: boolean;
  count: number;
  updatedAt?: string | null;
  ageMs?: number;
  error?: string;
  producer?: {
    name?: string;
    version?: number;
    generatedAt?: string;
    sources?: Record<string, boolean>;
    repos?: string[];
  } | null;
  activeTasks: ActiveTask[];
};

type WorkspaceEntry = {
  name: string;
  type: 'dir' | 'file';
  size: number;
  mtime: string;
  relativePath: string;
  contextEligible?: boolean;
  estimatedTokens?: number | null;
};

type WorkspaceContext = {
  root: string;
  currentPath: string;
  sections: {
    projects: WorkspaceEntry[];
    folders: WorkspaceEntry[];
    files: WorkspaceEntry[];
    memory: WorkspaceEntry[];
  };
  entries: WorkspaceEntry[];
};

type FilePreview = {
  path: string;
  name: string;
  lang: 'markdown' | 'text';
  content: string;
  truncated: boolean;
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function LiveFeed() {
  const { events } = useMissionControl();
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [isMinimized, setIsMinimized] = useState(false);
  const [tab, setTab] = useState<SideTab>('feed');

  const [root, setRoot] = useState('/');
  const [tree, setTree] = useState<Record<string, WorkspaceEntry[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ '.': true });
  const [loadingPath, setLoadingPath] = useState<string | null>(null);

  const [selected, setSelected] = useState<WorkspaceEntry | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [memoryQuery, setMemoryQuery] = useState('');
  const [memoryResults, setMemoryResults] = useState<Array<{ file: string; line: number; snippet: string }>>([]);

  const [activeTaskPayload, setActiveTaskPayload] = useState<ActiveTaskPayload | null>(null);
  const [opsLoading, setOpsLoading] = useState(false);

  const toggleMinimize = () => setIsMinimized(!isMinimized);

  const loadDir = async (path = '.') => {
    try {
      setLoadingPath(path);
      const qp = path === '.' ? '' : `?path=${encodeURIComponent(path)}`;
      const res = await fetch(`/api/workspace/context${qp}`);
      const data: WorkspaceContext = await res.json();
      if (!res.ok) throw new Error((data as unknown as { error?: string }).error || 'Failed to load directory');
      setRoot(data.root);
      setTree((prev) => ({ ...prev, [path]: data.entries }));
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingPath(null);
    }
  };

  const loadPreview = async (entry: WorkspaceEntry) => {
    if (entry.type !== 'file') return;
    setSelected(entry);
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(entry.relativePath)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preview failed');
      setPreview(data);
    } catch (e) {
      setPreview(null);
      setPreviewError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setPreviewLoading(false);
    }
  };

  const revealPath = async (entry: WorkspaceEntry) => {
    await fetch('/api/workspace/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: entry.relativePath }),
    });
  };

  const searchMemory = async () => {
    if (!memoryQuery.trim()) return setMemoryResults([]);
    const res = await fetch(`/api/workspace/memory-search?q=${encodeURIComponent(memoryQuery.trim())}`);
    const data = await res.json();
    setMemoryResults(data.results || []);
  };

  const loadActiveTasks = async () => {
    setOpsLoading(true);
    try {
      const res = await fetch('/api/ops/active-tasks');
      const data: ActiveTaskPayload = await res.json();
      setActiveTaskPayload(data);
    } catch {
      setActiveTaskPayload({ ok: false, count: 0, error: 'Failed to load active task feed', activeTasks: [] });
    } finally {
      setOpsLoading(false);
    }
  };

  const hasRootTree = !!tree['.'];

  useEffect(() => {
    if (tab === 'workspace' && !hasRootTree) loadDir('.');
  }, [tab, hasRootTree]);

  useEffect(() => {
    if (tab !== 'ops') return;

    loadActiveTasks();
    const timer = setInterval(loadActiveTasks, 10000);
    return () => clearInterval(timer);
  }, [tab]);

  const filteredEvents = useMemo(() => events.filter((event) => {
    if (filter === 'all') return true;
    if (filter === 'tasks') return ['task_created', 'task_assigned', 'task_status_changed', 'task_completed'].includes(event.type);
    if (filter === 'agents') return ['agent_joined', 'agent_status_changed', 'message_sent'].includes(event.type);
    return true;
  }), [events, filter]);

  const toggleExpand = async (entry: WorkspaceEntry) => {
    if (entry.type !== 'dir') return;
    const next = !expanded[entry.relativePath];
    setExpanded((prev) => ({ ...prev, [entry.relativePath]: next }));
    if (next && !tree[entry.relativePath]) await loadDir(entry.relativePath);
  };

  const renderTree = (path = '.', depth = 0) => {
    const entries = tree[path] || [];
    return entries.slice(0, 80).map((entry) => {
      const isDir = entry.type === 'dir';
      const isOpen = !!expanded[entry.relativePath];
      return (
        <div key={entry.relativePath}>
          <div className="flex items-center gap-1">
            <button
              onClick={() => isDir ? toggleExpand(entry) : loadPreview(entry)}
              className={`flex-1 text-left text-xs px-2 py-1 rounded hover:bg-mc-bg-tertiary ${selected?.relativePath === entry.relativePath ? 'bg-mc-bg-tertiary' : ''}`}
              style={{ paddingLeft: `${8 + depth * 12}px` }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{isDir ? (isOpen ? '📂' : '📁') : '📄'} {entry.name}</span>
                <span className="text-[10px] text-mc-text-secondary whitespace-nowrap">
                  {formatBytes(entry.size)}
                  {typeof entry.estimatedTokens === 'number' ? ` • ~${entry.estimatedTokens.toLocaleString()} tok` : ''}
                </span>
              </div>
            </button>
            <button className="p-1 hover:bg-mc-bg-tertiary rounded" onClick={() => revealPath(entry)} title="Reveal in file manager">
              <FolderOpen className="w-3 h-3 text-mc-text-secondary" />
            </button>
            {!isDir && (
              <button className="p-1 hover:bg-mc-bg-tertiary rounded" onClick={() => loadPreview(entry)} title="Open preview">
                <Eye className="w-3 h-3 text-mc-text-secondary" />
              </button>
            )}
          </div>
          {isDir && isOpen && renderTree(entry.relativePath, depth + 1)}
        </div>
      );
    });
  };

  return (
    <aside className={`bg-mc-bg-secondary/80 border-mc-border md:border-l flex flex-col transition-all duration-300 w-full backdrop-blur-sm ${isMinimized ? 'md:w-12' : 'md:w-[22rem]'}`}>
      <div className="p-3 border-b border-mc-border">
        <div className="flex items-center">
          <button onClick={toggleMinimize} className="p-1 rounded hover:bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-text">
            {isMinimized ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          {!isMinimized && <span className="text-sm font-medium uppercase tracking-wider">Mission Sidebar</span>}
        </div>
        {!isMinimized && (
          <div className="flex gap-1 mt-3">
            <button onClick={() => setTab('feed')} className={`px-3 py-1 text-xs rounded uppercase inline-flex items-center gap-1 ${tab === 'feed' ? 'bg-mc-accent text-mc-bg font-medium' : 'text-mc-text-secondary hover:bg-mc-bg-tertiary'}`}><Activity className="w-3 h-3" />Feed</button>
            <button onClick={() => setTab('workspace')} className={`px-3 py-1 text-xs rounded uppercase inline-flex items-center gap-1 ${tab === 'workspace' ? 'bg-mc-accent text-mc-bg font-medium' : 'text-mc-text-secondary hover:bg-mc-bg-tertiary'}`}><FolderTree className="w-3 h-3" />Workspace</button>
            <button onClick={() => setTab('ops')} className={`px-3 py-1 text-xs rounded uppercase inline-flex items-center gap-1 ${tab === 'ops' ? 'bg-mc-accent text-mc-bg font-medium' : 'text-mc-text-secondary hover:bg-mc-bg-tertiary'}`}><RefreshCw className="w-3 h-3" />Ops</button>
          </div>
        )}
        {!isMinimized && tab === 'feed' && (
          <div className="flex gap-1 mt-3">
            {(['all', 'tasks', 'agents'] as FeedFilter[]).map((t) => (
              <button key={t} onClick={() => setFilter(t)} className={`px-3 py-1 text-xs rounded uppercase ${filter === t ? 'bg-mc-bg-tertiary text-mc-text font-medium' : 'text-mc-text-secondary hover:bg-mc-bg-tertiary'}`}>{t}</button>
            ))}
          </div>
        )}
      </div>

      {!isMinimized && tab === 'feed' && (
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredEvents.length === 0 ? <div className="text-center py-8 text-mc-text-secondary text-sm">No events yet</div> : filteredEvents.map((event) => <EventItem key={event.id} event={event} />)}
        </div>
      )}

      {!isMinimized && tab === 'workspace' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="text-xs text-mc-text-secondary truncate">{root}</div>
          <div className="rounded-lg border border-mc-border p-2 max-h-64 overflow-auto">
            <div className="text-xs uppercase tracking-wider text-mc-text-secondary mb-2">File Tree {loadingPath ? `(loading ${loadingPath})` : ''}</div>
            {tree['.'] ? renderTree('.') : <div className="text-xs text-mc-text-secondary">Loading...</div>}
          </div>

          <div className="rounded-lg border border-mc-border p-2">
            <div className="text-xs uppercase tracking-wider text-mc-text-secondary mb-2">Memory Search</div>
            <div className="flex gap-1">
              <input value={memoryQuery} onChange={(e) => setMemoryQuery(e.target.value)} className="flex-1 bg-mc-bg border border-mc-border rounded px-2 py-1 text-xs" placeholder="Search memory/*.md" />
              <button onClick={searchMemory} className="px-2 py-1 rounded bg-mc-bg-tertiary hover:bg-mc-bg text-xs"><Search className="w-3 h-3" /></button>
            </div>
            {memoryResults.length > 0 && (
              <ul className="mt-2 space-y-1 max-h-32 overflow-auto">
                {memoryResults.map((r, i) => (
                  <li key={`${r.file}-${r.line}-${i}`} className="text-xs px-2 py-1 rounded hover:bg-mc-bg-tertiary cursor-pointer" onClick={() => loadPreview({ name: r.file.split('/').pop() || r.file, type: 'file', size: 0, mtime: '', relativePath: r.file })}>
                    <span className="text-mc-accent">{r.file}:{r.line}</span> {r.snippet}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-mc-border p-2 min-h-40">
            <div className="text-xs uppercase tracking-wider text-mc-text-secondary mb-2">File Preview {selected ? `— ${selected.relativePath}` : ''}</div>
            {previewLoading && <div className="text-xs text-mc-text-secondary">Loading preview...</div>}
            {previewError && <div className="text-xs text-mc-accent-red">{previewError}</div>}
            {preview && (
              <pre className="text-xs whitespace-pre-wrap break-words max-h-64 overflow-auto bg-mc-bg p-2 rounded border border-mc-border">{preview.content}{preview.truncated ? '\n\n...truncated' : ''}</pre>
            )}
            {!preview && !previewLoading && !previewError && <div className="text-xs text-mc-text-secondary">Select a text/markdown file to preview.</div>}
          </div>
        </div>
      )}

      {!isMinimized && tab === 'ops' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="rounded-lg border border-mc-border p-2 bg-mc-bg/40">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-wider text-mc-text-secondary">Active Task Producer</div>
              <button
                onClick={loadActiveTasks}
                className="px-2 py-1 rounded bg-mc-bg-tertiary hover:bg-mc-bg text-xs inline-flex items-center gap-1"
                disabled={opsLoading}
              >
                <RefreshCw className={`w-3 h-3 ${opsLoading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>

            <div className="mt-2 text-sm font-medium">
              {activeTaskPayload?.ok ? (
                <span className="inline-flex items-center gap-1 text-emerald-300"><CheckCircle2 className="w-4 h-4" /> {activeTaskPayload.count} active task{activeTaskPayload.count === 1 ? '' : 's'}</span>
              ) : (
                <span className="inline-flex items-center gap-1 text-red-300"><AlertTriangle className="w-4 h-4" /> feed unavailable</span>
              )}
            </div>
            {activeTaskPayload?.updatedAt && (
              <div className="text-xs text-mc-text-secondary mt-1">
                Updated {formatDistanceToNow(new Date(activeTaskPayload.updatedAt), { addSuffix: true })}
              </div>
            )}
            {activeTaskPayload?.producer?.sources && (
              <div className="text-xs text-mc-text-secondary mt-1">
                Sources: {Object.entries(activeTaskPayload.producer.sources).filter(([, enabled]) => enabled).map(([k]) => k).join(', ')}
              </div>
            )}
            {activeTaskPayload?.error && <div className="text-xs text-red-300 mt-1">{activeTaskPayload.error}</div>}
          </div>

          <div className="space-y-2">
            {(activeTaskPayload?.activeTasks || []).length === 0 ? (
              <div className="rounded-lg border border-mc-border p-3 text-xs text-mc-text-secondary">No active items from cron/tmux/github/ci.</div>
            ) : (
              (activeTaskPayload?.activeTasks || []).map((task) => (
                <div key={task.id} className="rounded-lg border border-mc-border p-2 bg-mc-bg/40">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-medium text-mc-text">{task.title}</div>
                    <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${task.severity === 'high' ? 'border-red-400/40 text-red-300' : task.severity === 'medium' ? 'border-amber-400/40 text-amber-300' : 'border-mc-border text-mc-text-secondary'}`}>{task.severity || 'info'}</span>
                  </div>
                  <div className="text-[11px] text-mc-text-secondary mt-1">{task.type} · {task.source || 'unknown'} · {task.owner || 'unassigned'}</div>
                  {task.detail && <div className="text-[11px] text-mc-text-secondary mt-1">{task.detail}</div>}
                  {task.url && (
                    <a href={task.url} target="_blank" rel="noreferrer" className="text-[11px] text-mc-accent mt-1 inline-block hover:underline">
                      Open link
                    </a>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

function EventItem({ event }: { event: Event }) {
  const getEventIcon = (type: string) => {
    switch (type) {
      case 'task_created': return '📋';
      case 'task_assigned': return '👤';
      case 'task_status_changed': return '🔄';
      case 'task_completed': return '✅';
      case 'message_sent': return '💬';
      case 'agent_joined': return '🎉';
      case 'agent_status_changed': return '🔔';
      case 'system': return '⚙️';
      default: return '📌';
    }
  };

  const isTaskEvent = ['task_created', 'task_assigned', 'task_completed'].includes(event.type);
  const isHighlight = event.type === 'task_created' || event.type === 'task_completed';

  return (
    <div className={`p-2 rounded border-l-2 animate-slide-in ${isHighlight ? 'bg-mc-bg-tertiary border-mc-accent-pink' : 'bg-transparent border-transparent hover:bg-mc-bg-tertiary'}`}>
      <div className="flex items-start gap-2">
        <span className="text-sm">{getEventIcon(event.type)}</span>
        <div className="flex-1 min-w-0">
          <p className={`text-sm ${isTaskEvent ? 'text-mc-accent-pink' : 'text-mc-text'}`}>{event.message}</p>
          <div className="flex items-center gap-1 mt-1 text-xs text-mc-text-secondary"><Clock className="w-3 h-3" />{formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}</div>
        </div>
      </div>
    </div>
  );
}
