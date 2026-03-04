import { execFile } from 'node:child_process';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { estimateBootstrapLoad } from './bootstrap-estimator';
import { estimateTokensFromBytes, estimateTokensFromText, isContextFile } from './file-estimator';
import { buildTokenUsageRecommendations } from './recommendations';
import {
  bucketByDayAndModel,
  coerceNumber,
  dedupeCronSessions,
  normalizeModelKey,
  parseSessionKeyMeta,
} from './session-parsers';
import type {
  ContextFileEstimate,
  ContextFilesSnapshot,
  CronJobUsage,
  SessionUsageRow,
  TokenUsageSnapshot,
} from './types';

const execFileAsync = promisify(execFile);

interface CollectOptions {
  workspaceRoot: string;
  days?: number;
}

interface CronJobRow {
  id: string;
  name?: string;
  agentId?: string;
  enabled?: boolean;
}

const IGNORED_SCAN_DIRS = new Set([
  '.git',
  '.next',
  'node_modules',
  '.worktrees',
  'worktrees',
  'dist',
  'build',
]);

async function runOpenClawJson<T>(args: string[], maxBufferMb = 8): Promise<T> {
  const { stdout } = await execFileAsync('openclaw', args, {
    timeout: 30_000,
    maxBuffer: maxBufferMb * 1024 * 1024,
  });

  return JSON.parse(stdout || '{}') as T;
}

function normalizeSessionRow(row: Record<string, unknown>): SessionUsageRow {
  return {
    key: String(row.key || row.sessionKey || row.id || 'unknown'),
    agentId: row.agentId ? String(row.agentId) : undefined,
    kind: row.kind ? String(row.kind) : undefined,
    model: row.model ? String(row.model) : undefined,
    modelProvider: row.modelProvider ? String(row.modelProvider) : undefined,
    inputTokens: coerceNumber(row.inputTokens),
    outputTokens: coerceNumber(row.outputTokens),
    totalTokens: coerceNumber(row.totalTokens),
    contextTokens: coerceNumber(row.contextTokens),
    updatedAt: coerceNumber(row.updatedAt, Date.now()),
    ageMs: coerceNumber(row.ageMs, 0),
  };
}

function buildCronUsage(
  sessions: SessionUsageRow[],
  jobs: CronJobRow[],
): CronJobUsage[] {
  const jobsById = new Map(jobs.map((job) => [job.id, job]));

  const cronRows = sessions.filter((row) => parseSessionKeyMeta(row.key).isCron);
  const deduped = dedupeCronSessions(cronRows);

  const grouped = new Map<string, SessionUsageRow[]>();
  for (const row of deduped) {
    const meta = parseSessionKeyMeta(row.key);
    if (!meta.cronJobId) continue;
    const current = grouped.get(meta.cronJobId) || [];
    current.push(row);
    grouped.set(meta.cronJobId, current);
  }

  const usage: CronJobUsage[] = [];

  grouped.forEach((rows, jobId) => {
    const job = jobsById.get(jobId);

    const modelBreakdownMap = new Map<string, { model: string; totalTokens: number; sessionCount: number }>();

    for (const row of rows) {
      const model = normalizeModelKey(row.modelProvider, row.model);
      const current = modelBreakdownMap.get(model) || { model, totalTokens: 0, sessionCount: 0 };
      current.totalTokens += row.totalTokens;
      current.sessionCount += 1;
      modelBreakdownMap.set(model, current);
    }

    usage.push({
      jobId,
      jobName: job?.name || `cron:${jobId.slice(0, 8)}`,
      agentId: job?.agentId,
      enabled: job?.enabled,
      sessionCount: rows.length,
      inputTokens: rows.reduce((sum, row) => sum + row.inputTokens, 0),
      outputTokens: rows.reduce((sum, row) => sum + row.outputTokens, 0),
      totalTokens: rows.reduce((sum, row) => sum + row.totalTokens, 0),
      lastUpdatedAt: rows.reduce((max, row) => Math.max(max, row.updatedAt), 0),
      modelBreakdown: Array.from(modelBreakdownMap.values()).sort((a, b) => b.totalTokens - a.totalTokens),
    });
  });

  // Include enabled jobs with zero sampled usage so dashboard shows missing coverage
  for (const job of jobs) {
    if (!job.id || grouped.has(job.id)) continue;
    usage.push({
      jobId: job.id,
      jobName: job.name || `cron:${job.id.slice(0, 8)}`,
      agentId: job.agentId,
      enabled: job.enabled,
      sessionCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      modelBreakdown: [],
    });
  }

  return usage.sort((a, b) => b.totalTokens - a.totalTokens || a.jobName.localeCompare(b.jobName));
}

async function statFileEstimate(fullPath: string, relPath: string): Promise<ContextFileEstimate | null> {
  try {
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) return null;

    if (!isContextFile(relPath)) return null;

    // Read only text-like files. For JSON and markdown this is fine and improves estimate quality.
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      return {
        path: relPath,
        bytes: Buffer.byteLength(content, 'utf-8'),
        estimatedTokens: estimateTokensFromText(content),
      };
    } catch {
      return {
        path: relPath,
        bytes: stat.size,
        estimatedTokens: estimateTokensFromBytes(stat.size),
      };
    }
  } catch {
    return null;
  }
}

async function scanContextFilesInDir(
  workspaceRoot: string,
  relDir: string,
  maxFiles: number,
  depth = 0,
): Promise<ContextFileEstimate[]> {
  if (depth > 4) return [];

  const fullDir = path.join(workspaceRoot, relDir);
  let entries: Dirent[];

  try {
    entries = await fs.readdir(fullDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: ContextFileEstimate[] = [];

  for (const entry of entries) {
    if (out.length >= maxFiles) break;

    if (entry.isDirectory()) {
      if (IGNORED_SCAN_DIRS.has(entry.name)) continue;
      const next = await scanContextFilesInDir(
        workspaceRoot,
        path.join(relDir, entry.name),
        maxFiles - out.length,
        depth + 1,
      );
      out.push(...next);
      continue;
    }

    if (!entry.isFile()) continue;

    const relPath = path.join(relDir, entry.name).replace(/\\/g, '/');
    const estimate = await statFileEstimate(path.join(fullDir, entry.name), relPath);
    if (estimate) out.push(estimate);
  }

  return out;
}

async function collectContextFilesSnapshot(workspaceRoot: string): Promise<ContextFilesSnapshot> {
  const rootFiles = ['AGENTS.md', 'SOUL.md', 'USER.md', 'MEMORY.md', 'HEARTBEAT.md', 'LEARNING.md', 'TOOLS.md'];

  const rootEstimates = (
    await Promise.all(
      rootFiles.map(async (file) => statFileEstimate(path.join(workspaceRoot, file), file)),
    )
  ).filter((f): f is ContextFileEstimate => Boolean(f));

  const memoryEstimates = await scanContextFilesInDir(workspaceRoot, 'memory', 400);
  const docsEstimates = await scanContextFilesInDir(workspaceRoot, 'docs', 250);

  const roots = [
    {
      path: '.',
      files: rootEstimates.length,
      bytes: rootEstimates.reduce((sum, f) => sum + f.bytes, 0),
      estimatedTokens: rootEstimates.reduce((sum, f) => sum + f.estimatedTokens, 0),
    },
    {
      path: 'memory',
      files: memoryEstimates.length,
      bytes: memoryEstimates.reduce((sum, f) => sum + f.bytes, 0),
      estimatedTokens: memoryEstimates.reduce((sum, f) => sum + f.estimatedTokens, 0),
    },
    {
      path: 'docs',
      files: docsEstimates.length,
      bytes: docsEstimates.reduce((sum, f) => sum + f.bytes, 0),
      estimatedTokens: docsEstimates.reduce((sum, f) => sum + f.estimatedTokens, 0),
    },
  ];

  const all = [...rootEstimates, ...memoryEstimates, ...docsEstimates];

  return {
    roots,
    topFiles: all.sort((a, b) => b.estimatedTokens - a.estimatedTokens).slice(0, 40),
    scannedFiles: all.length,
  };
}

export async function collectTokenUsageSnapshot(options: CollectOptions): Promise<TokenUsageSnapshot> {
  const days = options.days || 5;

  const [sessionsPayload, cronPayload, bootstrapLoad, contextFiles] = await Promise.all([
    runOpenClawJson<{ sessions?: Record<string, unknown>[] }>([
      'sessions',
      '--all-agents',
      '--active',
      String(days * 24 * 60),
      '--json',
    ]),
    runOpenClawJson<{ jobs?: CronJobRow[] }>(['cron', 'list', '--json']),
    estimateBootstrapLoad({
      workspaceRoot: options.workspaceRoot,
      includeLongTermMemory: true,
    }),
    collectContextFilesSnapshot(options.workspaceRoot),
  ]);

  const sessionsRaw = Array.isArray(sessionsPayload?.sessions) ? sessionsPayload.sessions : [];
  const sessions = sessionsRaw.map(normalizeSessionRow);

  const cronJobs = Array.isArray(cronPayload?.jobs) ? cronPayload.jobs : [];

  const cronRows = sessions.filter((row) => parseSessionKeyMeta(row.key).isCron);
  const nonCronRows = sessions.filter((row) => !parseSessionKeyMeta(row.key).isCron);
  const dedupedCronRows = dedupeCronSessions(cronRows);
  const dedupedSessions = [...nonCronRows, ...dedupedCronRows];

  const totals = {
    inputTokens: dedupedSessions.reduce((sum, row) => sum + row.inputTokens, 0),
    outputTokens: dedupedSessions.reduce((sum, row) => sum + row.outputTokens, 0),
    totalTokens: dedupedSessions.reduce((sum, row) => sum + row.totalTokens, 0),
    contextTokens: dedupedSessions.reduce((sum, row) => sum + row.contextTokens, 0),
  };

  const byKind: Record<string, number> = {};
  for (const row of dedupedSessions) {
    const kind = row.kind || 'unknown';
    byKind[kind] = (byKind[kind] || 0) + 1;
  }

  const dailyByModel = bucketByDayAndModel(dedupedSessions, days);
  const cronUsage = buildCronUsage(sessions, cronJobs);

  const recommendations = buildTokenUsageRecommendations({
    sessions: dedupedSessions,
    cronUsage,
    bootstrapLoad,
    contextFiles,
  });

  return {
    summary: {
      generatedAt: new Date().toISOString(),
      windowDays: days,
      totalSessions: sessions.length,
      dedupedSessions: dedupedSessions.length,
      totals,
      byKind,
    },
    dailyByModel,
    cronUsage,
    bootstrapLoad,
    contextFiles,
    recommendations,
    meta: {
      estimationMethod: 'Estimated tokens use chars/4 heuristic for file context; session/cron tokens come from OpenClaw telemetry.',
      notes: [
        'Cron totals are deduplicated by preferring :run: session keys when present.',
        'Daily by-model view attributes each sampled session total to the session updated day.',
      ],
    },
  };
}
