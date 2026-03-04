'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, RefreshCw, FolderOpen, FileText, AlertTriangle, CheckCircle2 } from 'lucide-react';

type TokenUsageResponse = {
  summary: {
    generatedAt: string;
    windowDays: number;
    totalSessions: number;
    dedupedSessions: number;
    totals: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      contextTokens: number;
    };
  };
  dailyByModel: Array<{
    day: string;
    model: string;
    sessionCount: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  cronUsage: Array<{
    jobId: string;
    jobName: string;
    sessionCount: number;
    totalTokens: number;
    modelBreakdown: Array<{ model: string; totalTokens: number; sessionCount: number }>;
  }>;
  bootstrapLoad: {
    totalBytes: number;
    totalEstimatedTokens: number;
    files: Array<{ path: string; exists: boolean; bytes: number; estimatedTokens: number }>;
    missingFiles: string[];
  };
  contextFiles: {
    roots: Array<{ path: string; files: number; bytes: number; estimatedTokens: number }>;
    topFiles: Array<{ path: string; bytes: number; estimatedTokens: number }>;
    scannedFiles: number;
  };
  recommendations: Array<{
    id: string;
    severity: 'low' | 'medium' | 'high';
    category: string;
    title: string;
    details: string;
    action: string;
  }>;
  meta: {
    estimationMethod: string;
    notes: string[];
  };
  cache?: {
    hit: boolean;
    ageMs: number;
    ttlMs: number;
  };
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

type WorkspaceContextResponse = {
  currentPath: string;
  entries: WorkspaceEntry[];
  totals?: {
    entries: number;
    bytes: number;
    estimatedTokens: number;
  };
};

function formatNum(value: number) {
  return value.toLocaleString();
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function TokenUsageDashboard() {
  const [data, setData] = useState<TokenUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [contextPath, setContextPath] = useState('.');
  const [contextData, setContextData] = useState<WorkspaceContextResponse | null>(null);
  const [contextLoading, setContextLoading] = useState(false);

  const fetchTokenUsage = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const suffix = force ? '?refresh=1' : '';
      const res = await fetch(`/api/ops/token-usage${suffix}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load token usage');
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load token usage');
    } finally {
      setLoading(false);
    }
  };

  const fetchContext = async (pathValue: string) => {
    setContextLoading(true);
    try {
      const qp = pathValue && pathValue !== '.' ? `?path=${encodeURIComponent(pathValue)}` : '';
      const res = await fetch(`/api/workspace/context${qp}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load workspace context');
      setContextData(json);
    } catch {
      setContextData(null);
    } finally {
      setContextLoading(false);
    }
  };

  useEffect(() => {
    fetchTokenUsage().catch(() => undefined);
  }, []);

  useEffect(() => {
    fetchContext(contextPath).catch(() => undefined);
  }, [contextPath]);

  useEffect(() => {
    const timer = setInterval(() => {
      fetchTokenUsage().catch(() => undefined);
    }, 60_000);

    return () => clearInterval(timer);
  }, []);

  const parentPath = useMemo(() => {
    if (!contextPath || contextPath === '.' || !contextPath.includes('/')) return '.';
    const idx = contextPath.lastIndexOf('/');
    return idx <= 0 ? '.' : contextPath.slice(0, idx);
  }, [contextPath]);

  return (
    <div className="min-h-screen bg-mc-bg text-mc-text">
      <header className="border-b border-mc-border bg-mc-bg-secondary">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-mc-text-secondary hover:text-mc-text">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-2xl font-bold">Token Usage Dashboard</h1>
          </div>

          <button
            onClick={() => fetchTokenUsage(true)}
            className="px-4 py-2 rounded border border-mc-border hover:bg-mc-bg-tertiary inline-flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {loading && <div className="text-sm text-mc-text-secondary">Loading token telemetry…</div>}
        {error && <div className="text-sm text-red-300">{error}</div>}

        {data && (
          <>
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard title="Total Tokens" value={formatNum(data.summary.totals.totalTokens)} hint={`${data.summary.windowDays}-day sampled usage`} />
              <MetricCard title="Input Tokens" value={formatNum(data.summary.totals.inputTokens)} hint="prompt + context input" />
              <MetricCard title="Output Tokens" value={formatNum(data.summary.totals.outputTokens)} hint="model generation output" />
              <MetricCard title="Startup Boot Cost" value={`~${formatNum(data.bootstrapLoad.totalEstimatedTokens)}`} hint="estimated tokens loaded on session start" />
            </section>

            <section className="rounded-xl border border-mc-border bg-mc-bg-secondary p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">Daily Usage by Model (last 5 days)</h2>
                <span className="text-xs text-mc-text-secondary">{data.summary.dedupedSessions}/{data.summary.totalSessions} sessions counted (cron deduped)</span>
              </div>
              <div className="overflow-auto max-h-72">
                <table className="w-full text-sm">
                  <thead className="text-mc-text-secondary text-xs uppercase">
                    <tr>
                      <th className="text-left py-2">Day</th>
                      <th className="text-left py-2">Model</th>
                      <th className="text-right py-2">Sessions</th>
                      <th className="text-right py-2">Input</th>
                      <th className="text-right py-2">Output</th>
                      <th className="text-right py-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dailyByModel.slice(0, 80).map((row, idx) => (
                      <tr key={`${row.day}-${row.model}-${idx}`} className="border-t border-mc-border/60">
                        <td className="py-2">{row.day}</td>
                        <td className="py-2 font-mono text-xs">{row.model}</td>
                        <td className="py-2 text-right">{formatNum(row.sessionCount)}</td>
                        <td className="py-2 text-right">{formatNum(row.inputTokens)}</td>
                        <td className="py-2 text-right">{formatNum(row.outputTokens)}</td>
                        <td className="py-2 text-right font-semibold">{formatNum(row.totalTokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-xl border border-mc-border bg-mc-bg-secondary p-4">
              <h2 className="font-semibold mb-3">Cron Job Token Usage</h2>
              <div className="overflow-auto max-h-72">
                <table className="w-full text-sm">
                  <thead className="text-mc-text-secondary text-xs uppercase">
                    <tr>
                      <th className="text-left py-2">Job</th>
                      <th className="text-right py-2">Sessions</th>
                      <th className="text-right py-2">Tokens</th>
                      <th className="text-left py-2">Top Model</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cronUsage.map((row) => (
                      <tr key={row.jobId} className="border-t border-mc-border/60">
                        <td className="py-2">
                          <div className="font-medium">{row.jobName}</div>
                          <div className="font-mono text-[11px] text-mc-text-secondary">{row.jobId}</div>
                        </td>
                        <td className="py-2 text-right">{formatNum(row.sessionCount)}</td>
                        <td className="py-2 text-right font-semibold">{formatNum(row.totalTokens)}</td>
                        <td className="py-2 text-xs">
                          {row.modelBreakdown[0]
                            ? `${row.modelBreakdown[0].model} (${formatNum(row.modelBreakdown[0].totalTokens)})`
                            : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-mc-border bg-mc-bg-secondary p-4">
                <h2 className="font-semibold mb-3">Session Startup Load</h2>
                <div className="text-xs text-mc-text-secondary mb-2">
                  Estimated from required bootstrap files (AGENTS/SOUL/USER/memory today+yesterday/MEMORY).
                </div>
                <div className="space-y-2 max-h-72 overflow-auto">
                  {data.bootstrapLoad.files.map((file) => (
                    <div key={file.path} className="rounded border border-mc-border/70 bg-mc-bg/50 px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-xs break-all">{file.path}</span>
                        <span className={file.exists ? 'text-emerald-300 text-xs' : 'text-rose-300 text-xs'}>
                          {file.exists ? 'loaded' : 'missing'}
                        </span>
                      </div>
                      <div className="text-xs text-mc-text-secondary mt-1">
                        {formatBytes(file.bytes)} • ~{formatNum(file.estimatedTokens)} tokens
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-mc-border bg-mc-bg-secondary p-4">
                <h2 className="font-semibold mb-3">Optimization Audit</h2>
                <div className="space-y-3">
                  {data.recommendations.map((rec) => (
                    <div key={rec.id} className="rounded border border-mc-border/70 bg-mc-bg/60 p-3">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {rec.severity === 'high' ? (
                          <AlertTriangle className="w-4 h-4 text-rose-300" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-amber-300" />
                        )}
                        {rec.title}
                      </div>
                      <div className="text-xs text-mc-text-secondary mt-1">{rec.details}</div>
                      <div className="text-xs text-mc-accent mt-1">Action: {rec.action}</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-mc-border bg-mc-bg-secondary p-4">
              <h2 className="font-semibold mb-3">Context File Hotspots</h2>
              <div className="grid gap-2 md:grid-cols-3 mb-3">
                {data.contextFiles.roots.map((root) => (
                  <div key={root.path} className="rounded border border-mc-border/70 bg-mc-bg/50 px-3 py-2 text-sm">
                    <div className="font-medium">{root.path}</div>
                    <div className="text-xs text-mc-text-secondary">
                      {formatNum(root.files)} files • {formatBytes(root.bytes)} • ~{formatNum(root.estimatedTokens)} tokens
                    </div>
                  </div>
                ))}
              </div>

              <div className="overflow-auto max-h-60">
                <table className="w-full text-sm">
                  <thead className="text-mc-text-secondary text-xs uppercase">
                    <tr>
                      <th className="text-left py-2">Path</th>
                      <th className="text-right py-2">Size</th>
                      <th className="text-right py-2">Est Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.contextFiles.topFiles.map((row) => (
                      <tr key={row.path} className="border-t border-mc-border/60">
                        <td className="py-2 font-mono text-xs break-all">{row.path}</td>
                        <td className="py-2 text-right">{formatBytes(row.bytes)}</td>
                        <td className="py-2 text-right font-semibold">~{formatNum(row.estimatedTokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-xl border border-mc-border bg-mc-bg-secondary p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">Context Explorer</h2>
                <div className="text-xs text-mc-text-secondary">
                  Click folders to drill into context footprint
                </div>
              </div>

              <div className="flex items-center gap-2 mb-3">
                <button
                  onClick={() => setContextPath(parentPath)}
                  className="px-2 py-1 text-xs rounded border border-mc-border hover:bg-mc-bg-tertiary"
                >
                  Up
                </button>
                <div className="font-mono text-xs text-mc-text-secondary">{contextPath}</div>
              </div>

              {contextLoading && <div className="text-xs text-mc-text-secondary">Loading directory…</div>}

              {contextData && (
                <div className="space-y-2">
                  {contextData.totals && (
                    <div className="text-xs text-mc-text-secondary">
                      {formatNum(contextData.totals.entries)} entries • {formatBytes(contextData.totals.bytes)} • ~{formatNum(contextData.totals.estimatedTokens)} tokens
                    </div>
                  )}

                  <div className="rounded border border-mc-border overflow-auto max-h-96">
                    <table className="w-full text-sm">
                      <thead className="text-mc-text-secondary text-xs uppercase bg-mc-bg/60 sticky top-0">
                        <tr>
                          <th className="text-left py-2 px-2">Name</th>
                          <th className="text-right py-2 px-2">Size</th>
                          <th className="text-right py-2 px-2">Est Tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {contextData.entries.map((entry) => (
                          <tr key={entry.relativePath} className="border-t border-mc-border/60">
                            <td className="py-2 px-2">
                              {entry.type === 'dir' ? (
                                <button
                                  onClick={() => setContextPath(entry.relativePath)}
                                  className="inline-flex items-center gap-2 hover:text-mc-accent"
                                >
                                  <FolderOpen className="w-4 h-4" /> {entry.name}
                                </button>
                              ) : (
                                <span className="inline-flex items-center gap-2">
                                  <FileText className="w-4 h-4 text-mc-text-secondary" /> {entry.name}
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-2 text-right">{formatBytes(entry.size)}</td>
                            <td className="py-2 px-2 text-right">
                              {typeof entry.estimatedTokens === 'number' ? `~${formatNum(entry.estimatedTokens)}` : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>

            <section className="text-xs text-mc-text-secondary space-y-1">
              <div>{data.meta.estimationMethod}</div>
              {data.meta.notes.map((note, idx) => (
                <div key={idx}>• {note}</div>
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function MetricCard({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-mc-border bg-mc-bg-secondary p-4">
      <div className="text-sm text-mc-text-secondary">{title}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      <div className="text-xs text-mc-text-secondary mt-1">{hint}</div>
    </div>
  );
}
