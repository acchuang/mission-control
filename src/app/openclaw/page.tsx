'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, RefreshCcw, Play, Square, RotateCw, Send, Trash2 } from 'lucide-react';

type GatewayResponse = {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
};

type OpenClawStatus = {
  connected?: boolean;
  sessions_count?: number;
  gateway_url?: string;
  error?: string;
};

type SessionInfo = {
  id: string;
  channel?: string;
};

type SessionHistoryMessage = {
  role?: string;
  content?: string;
  text?: string;
};

type CronJob = {
  id: string;
  name?: string;
  enabled?: boolean;
  schedule?: {
    kind?: string;
    everyMs?: number;
  };
  state?: {
    lastStatus?: string;
    consecutiveErrors?: number;
    nextRunAtMs?: number;
  };
};

const QUICK_PRESETS = [
  'status?',
  'summarize progress in 5 bullets',
  'stop now',
];

export default function OpenClawControlPage() {
  const [gateway, setGateway] = useState<GatewayResponse | null>(null);
  const [status, setStatus] = useState<OpenClawStatus | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [messageInput, setMessageInput] = useState('');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [sessionActionBusy, setSessionActionBusy] = useState<'send' | 'terminate' | 'history' | 'terminateAll' | 'terminateExceptSelected' | null>(null);
  const [sessionActionResult, setSessionActionResult] = useState<string>('');
  const [history, setHistory] = useState<SessionHistoryMessage[]>([]);

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) || null,
    [sessions, selectedSessionId]
  );

  const channelOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const s of sessions) {
      unique.add(s.channel || 'unknown channel');
    }
    return ['all', ...Array.from(unique).sort()];
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    if (channelFilter === 'all') return sessions;
    return sessions.filter((s) => (s.channel || 'unknown channel') === channelFilter);
  }, [sessions, channelFilter]);

  const channelStats = useMemo(() => {
    const stats = new Map<string, number>();
    for (const s of sessions) {
      const key = s.channel || 'unknown channel';
      stats.set(key, (stats.get(key) || 0) + 1);
    }
    return Array.from(stats.entries())
      .map(([channel, count]) => ({ channel, count }))
      .sort((a, b) => b.count - a.count || a.channel.localeCompare(b.channel));
  }, [sessions]);

  const formatTimestamp = (timestampMs?: number) => {
    if (!timestampMs) return '-';
    const date = new Date(timestampMs);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString();
  };

  const formatSchedule = (job: CronJob) => {
    if (!job.schedule) return '-';
    if (job.schedule.kind === 'every' && job.schedule.everyMs) {
      const minutes = Math.round(job.schedule.everyMs / 60000);
      return `every ${minutes}m`;
    }
    return job.schedule.kind || '-';
  };

  const loadAll = useCallback(async () => {
    const [gatewayRes, statusRes, modelsRes, sessionsRes, cronRes] = await Promise.all([
      fetch('/api/openclaw/gateway').then((r) => r.json()),
      fetch('/api/openclaw/status').then((r) => r.json()),
      fetch('/api/openclaw/models').then((r) => r.json()),
      fetch('/api/openclaw/sessions').then((r) => r.json()),
      fetch('/api/openclaw/cron').then((r) => r.json()),
    ]);

    setGateway(gatewayRes);
    setStatus(statusRes);
    setModels(modelsRes.availableModels || []);

    const liveSessions: SessionInfo[] = sessionsRes.sessions || [];
    setSessions(liveSessions);
    setCronJobs(cronRes.jobs || []);

    // Preserve selection if still valid; else auto-pick first
    if (liveSessions.length === 0) {
      setSelectedSessionId('');
      setHistory([]);
      return;
    }

    const stillExists = liveSessions.some((s) => s.id === selectedSessionId);
    if (!stillExists) {
      setSelectedSessionId(liveSessions[0].id);
    }
  }, [selectedSessionId]);

  useEffect(() => {
    loadAll().catch((err) => console.error('Failed to load OpenClaw control page:', err));
  }, [loadAll]);

  useEffect(() => {
    if (!selectedSessionId) return;
    const visible = filteredSessions.some((s) => s.id === selectedSessionId);
    if (!visible) {
      setSelectedSessionId('');
      setHistory([]);
    }
  }, [filteredSessions, selectedSessionId]);

  const runAction = async (action: 'start' | 'stop' | 'restart') => {
    setBusy(action);
    try {
      await fetch('/api/openclaw/gateway', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      await loadAll();
    } finally {
      setBusy(null);
    }
  };

  const loadHistory = async (sessionId: string) => {
    if (!sessionId) return;

    setSessionActionBusy('history');
    try {
      const res = await fetch(`/api/openclaw/sessions/${encodeURIComponent(sessionId)}/history`);
      const data = await res.json();
      setHistory(data.history || []);
      setSessionActionResult('History loaded.');
    } catch (err) {
      setSessionActionResult('Failed to load history.');
    } finally {
      setSessionActionBusy(null);
    }
  };

  const sendMessageToSession = async () => {
    if (!selectedSessionId || !messageInput.trim()) return;

    setSessionActionBusy('send');
    setSessionActionResult('');
    try {
      const res = await fetch(`/api/openclaw/sessions/${encodeURIComponent(selectedSessionId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: messageInput.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setSessionActionResult(data.error || 'Failed to send message.');
      } else {
        setSessionActionResult('Message sent.');
        setMessageInput('');
        await loadHistory(selectedSessionId);
      }
    } catch {
      setSessionActionResult('Failed to send message.');
    } finally {
      setSessionActionBusy(null);
    }
  };

  const terminateSession = async () => {
    if (!selectedSessionId) return;
    const confirmed = window.confirm(`Terminate session ${selectedSessionId}?`);
    if (!confirmed) return;

    setSessionActionBusy('terminate');
    setSessionActionResult('');
    try {
      const res = await fetch(`/api/openclaw/sessions/${encodeURIComponent(selectedSessionId)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        setSessionActionResult(data.error || 'Failed to terminate session.');
      } else {
        setSessionActionResult('Session terminated.');
        setHistory([]);
        await loadAll();
      }
    } catch {
      setSessionActionResult('Failed to terminate session.');
    } finally {
      setSessionActionBusy(null);
    }
  };

  const terminateAllVisibleSessions = async () => {
    if (filteredSessions.length === 0) return;

    const confirmed = window.confirm(`Terminate all visible sessions (${filteredSessions.length})?`);
    if (!confirmed) return;

    setSessionActionBusy('terminateAll');
    setSessionActionResult('');

    let okCount = 0;
    let failCount = 0;

    try {
      for (const s of filteredSessions) {
        try {
          const res = await fetch(`/api/openclaw/sessions/${encodeURIComponent(s.id)}`, {
            method: 'DELETE',
          });
          if (res.ok) okCount += 1;
          else failCount += 1;
        } catch {
          failCount += 1;
        }
      }

      setHistory([]);
      await loadAll();
      setSessionActionResult(`Bulk terminate complete: ${okCount} succeeded, ${failCount} failed.`);
    } finally {
      setSessionActionBusy(null);
    }
  };

  const terminateAllExceptSelected = async () => {
    if (!selectedSessionId) return;

    const targets = filteredSessions.filter((s) => s.id !== selectedSessionId);
    if (targets.length === 0) {
      setSessionActionResult('Nothing to terminate.');
      return;
    }

    const confirmed = window.confirm(
      `Terminate ${targets.length} session(s), keeping selected session ${selectedSessionId}?`
    );
    if (!confirmed) return;

    setSessionActionBusy('terminateExceptSelected');
    setSessionActionResult('');

    let okCount = 0;
    let failCount = 0;

    try {
      for (const s of targets) {
        try {
          const res = await fetch(`/api/openclaw/sessions/${encodeURIComponent(s.id)}`, {
            method: 'DELETE',
          });
          if (res.ok) okCount += 1;
          else failCount += 1;
        } catch {
          failCount += 1;
        }
      }

      setHistory([]);
      await loadAll();
      setSessionActionResult(`Terminate except selected complete: ${okCount} succeeded, ${failCount} failed.`);
    } finally {
      setSessionActionBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-mc-bg text-mc-text">
      <header className="border-b border-mc-border bg-mc-bg-secondary">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-mc-text-secondary hover:text-mc-text">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-2xl font-bold">OpenClaw Control Center</h1>
          </div>
          <button
            onClick={() => loadAll()}
            className="px-4 py-2 border border-mc-border rounded hover:bg-mc-bg-tertiary flex items-center gap-2"
          >
            <RefreshCcw className="w-4 h-4" /> Refresh
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 grid gap-6">
        <section className="p-6 rounded-xl border border-mc-border bg-mc-bg-secondary">
          <h2 className="text-lg font-semibold mb-4">Gateway Service Control</h2>
          <div className="flex gap-3 mb-4">
            <button disabled={busy !== null} onClick={() => runAction('start')} className="px-4 py-2 rounded bg-green-600/20 text-green-300 border border-green-500/30 flex items-center gap-2 disabled:opacity-60"><Play className="w-4 h-4" />Start</button>
            <button disabled={busy !== null} onClick={() => runAction('stop')} className="px-4 py-2 rounded bg-red-600/20 text-red-300 border border-red-500/30 flex items-center gap-2 disabled:opacity-60"><Square className="w-4 h-4" />Stop</button>
            <button disabled={busy !== null} onClick={() => runAction('restart')} className="px-4 py-2 rounded bg-yellow-600/20 text-yellow-300 border border-yellow-500/30 flex items-center gap-2 disabled:opacity-60"><RotateCw className="w-4 h-4" />Restart</button>
          </div>
          <pre className="text-xs bg-mc-bg rounded p-3 border border-mc-border whitespace-pre-wrap">{gateway?.stdout || gateway?.stderr || gateway?.error || 'No output yet'}</pre>
        </section>

        <section className="p-6 rounded-xl border border-mc-border bg-mc-bg-secondary">
          <h2 className="text-lg font-semibold mb-4">Live Connection</h2>
          <div className="grid md:grid-cols-3 gap-4 text-sm">
            <div className="p-3 rounded border border-mc-border bg-mc-bg">
              <div className="text-mc-text-secondary">Gateway URL</div>
              <div className="font-mono mt-1">{status?.gateway_url || '-'}</div>
            </div>
            <div className="p-3 rounded border border-mc-border bg-mc-bg">
              <div className="text-mc-text-secondary">Connected</div>
              <div className="font-semibold mt-1">{status?.connected ? 'Yes' : 'No'}</div>
            </div>
            <div className="p-3 rounded border border-mc-border bg-mc-bg">
              <div className="text-mc-text-secondary">Active Sessions</div>
              <div className="font-semibold mt-1">{status?.sessions_count ?? sessions.length}</div>
            </div>
          </div>
        </section>

        <section className="p-6 rounded-xl border border-mc-border bg-mc-bg-secondary">
          <h2 className="text-lg font-semibold mb-4">Cron Jobs ({cronJobs.length})</h2>
          <div className="max-h-72 overflow-auto border border-mc-border rounded bg-mc-bg">
            {cronJobs.length === 0 ? (
              <div className="p-4 text-sm text-mc-text-secondary">No cron jobs found.</div>
            ) : (
              <ul className="divide-y divide-mc-border text-sm">
                {cronJobs.map((job) => (
                  <li key={job.id} className="p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">{job.name || 'unnamed job'}</div>
                        <div className="font-mono text-xs text-mc-text-secondary">{job.id}</div>
                      </div>
                      <div className={`text-xs px-2 py-1 rounded border ${job.enabled ? 'text-green-300 border-green-500/30 bg-green-600/15' : 'text-mc-text-secondary border-mc-border'}`}>
                        {job.enabled ? 'enabled' : 'disabled'}
                      </div>
                    </div>
                    <div className="mt-2 grid md:grid-cols-3 gap-2 text-xs text-mc-text-secondary">
                      <div>Schedule: <span className="text-mc-text">{formatSchedule(job)}</span></div>
                      <div>Last status: <span className="text-mc-text">{job.state?.lastStatus || '-'}</span></div>
                      <div>Errors: <span className="text-mc-text">{job.state?.consecutiveErrors ?? 0}</span></div>
                      <div className="md:col-span-3">Next run: <span className="text-mc-text">{formatTimestamp(job.state?.nextRunAtMs)}</span></div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="p-6 rounded-xl border border-mc-border bg-mc-bg-secondary">
          <h2 className="text-lg font-semibold mb-4">Session Control</h2>

          <div className="grid gap-4 md:grid-cols-[300px_1fr]">
            <div>
              <label className="block text-sm text-mc-text-secondary mb-2">Channel filter</label>
              <select
                value={channelFilter}
                onChange={(e) => {
                  setChannelFilter(e.target.value);
                  setSessionActionResult('');
                }}
                className="w-full px-3 py-2 bg-mc-bg border border-mc-border rounded mb-3"
              >
                {channelOptions.map((ch) => (
                  <option key={ch} value={ch}>
                    {ch === 'all' ? 'All channels' : ch}
                  </option>
                ))}
              </select>

              <label className="block text-sm text-mc-text-secondary mb-2">Select session</label>
              <select
                value={selectedSessionId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedSessionId(id);
                  setHistory([]);
                  setSessionActionResult('');
                }}
                className="w-full px-3 py-2 bg-mc-bg border border-mc-border rounded"
              >
                <option value="">-- choose --</option>
                {filteredSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id} {s.channel ? `(${s.channel})` : ''}
                  </option>
                ))}
              </select>

              <div className="mt-3 flex gap-2 flex-wrap">
                <button
                  disabled={!selectedSessionId || sessionActionBusy !== null}
                  onClick={() => loadHistory(selectedSessionId)}
                  className="px-3 py-2 border border-mc-border rounded hover:bg-mc-bg-tertiary text-sm disabled:opacity-60"
                >
                  Load History
                </button>
                <button
                  disabled={!selectedSessionId || sessionActionBusy !== null}
                  onClick={terminateSession}
                  className="px-3 py-2 rounded bg-red-600/20 text-red-300 border border-red-500/30 flex items-center gap-2 text-sm disabled:opacity-60"
                >
                  <Trash2 className="w-4 h-4" /> Terminate
                </button>
                <button
                  disabled={filteredSessions.length === 0 || sessionActionBusy !== null}
                  onClick={terminateAllVisibleSessions}
                  className="px-3 py-2 rounded bg-red-700/20 text-red-200 border border-red-500/40 text-sm disabled:opacity-60"
                >
                  Terminate All ({filteredSessions.length})
                </button>
                <button
                  disabled={!selectedSessionId || filteredSessions.length <= 1 || sessionActionBusy !== null}
                  onClick={terminateAllExceptSelected}
                  className="px-3 py-2 rounded bg-red-800/20 text-red-100 border border-red-500/40 text-sm disabled:opacity-60"
                >
                  Terminate All Except Selected
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-sm text-mc-text-secondary">
                Selected: <span className="font-mono text-mc-text">{selectedSession?.id || '-'}</span>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  placeholder="Send message to selected session"
                  className="flex-1 px-3 py-2 bg-mc-bg border border-mc-border rounded"
                />
                <button
                  disabled={!selectedSessionId || !messageInput.trim() || sessionActionBusy !== null}
                  onClick={sendMessageToSession}
                  className="px-4 py-2 rounded bg-mc-accent text-mc-bg flex items-center gap-2 disabled:opacity-60"
                >
                  <Send className="w-4 h-4" /> Send
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {QUICK_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setMessageInput(preset)}
                    className="px-2.5 py-1.5 text-xs border border-mc-border rounded hover:bg-mc-bg-tertiary"
                  >
                    {preset}
                  </button>
                ))}
              </div>

              {sessionActionResult && (
                <div className="text-sm px-3 py-2 bg-mc-bg border border-mc-border rounded">
                  {sessionActionResult}
                </div>
              )}

              <div className="border border-mc-border rounded bg-mc-bg p-3 max-h-72 overflow-auto text-sm">
                {history.length === 0 ? (
                  <div className="text-mc-text-secondary">No history loaded.</div>
                ) : (
                  <ul className="space-y-2">
                    {history.map((msg, idx) => (
                      <li key={idx} className="border border-mc-border rounded p-2">
                        <div className="text-xs uppercase tracking-wide text-mc-text-secondary mb-1">
                          {msg.role || 'unknown'}
                        </div>
                        <div className="whitespace-pre-wrap">{msg.content || msg.text || '[empty]'}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="p-6 rounded-xl border border-mc-border bg-mc-bg-secondary">
          <h2 className="text-lg font-semibold mb-4">Sessions ({filteredSessions.length}{channelFilter !== 'all' ? ` / ${sessions.length}` : ''})</h2>
          <div className="max-h-64 overflow-auto border border-mc-border rounded">
            {filteredSessions.length === 0 ? (
              <div className="p-4 text-mc-text-secondary text-sm">No live sessions for current filter.</div>
            ) : (
              <ul className="divide-y divide-mc-border text-sm">
                {filteredSessions.map((s) => (
                  <li key={s.id} className="p-3">
                    <div className="font-mono">{s.id}</div>
                    <div className="text-mc-text-secondary">{s.channel || 'unknown channel'}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="p-6 rounded-xl border border-mc-border bg-mc-bg-secondary">
          <h2 className="text-lg font-semibold mb-4">Available Models ({models.length})</h2>
          <div className="max-h-56 overflow-auto text-sm font-mono border border-mc-border rounded p-3 bg-mc-bg">
            {models.length ? models.join('\n') : 'No models found'}
          </div>
        </section>
      </main>
    </div>
  );
}
