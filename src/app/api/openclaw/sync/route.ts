import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { queryOne, run } from '@/lib/db';
import { broadcast } from '@/lib/events';
import type { Task, TaskStatus } from '@/lib/types';

const execFileAsync = promisify(execFile);

function shortHash(input: string) {
  return createHash('sha1').update(input).digest('hex').slice(0, 16);
}

function nowIso() {
  return new Date().toISOString();
}

function upsertTask(params: {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}) {
  const existing = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [params.id]);
  const now = nowIso();

  if (!existing) {
    run(
      `INSERT INTO tasks (id, title, description, status, priority, assigned_agent_id, created_by_agent_id, workspace_id, business_id, due_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, 'default', 'default', NULL, ?, ?)`,
      [params.id, params.title, params.description, params.status, params.priority || 'normal', now, now]
    );

    const created = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [params.id]);
    if (created) {
      broadcast({ type: 'task_created', payload: created });
    }

    run(
      `INSERT INTO events (id, type, task_id, message, created_at)
       VALUES (?, 'task_created', ?, ?, ?)`,
      [`evt_${shortHash(`create:${params.id}:${now}`)}`, params.id, `OpenClaw sync created: ${params.title}`, now]
    );

    return { created: 1, updated: 0 };
  }

  if (
    existing.title === params.title &&
    (existing.description || '') === (params.description || '') &&
    existing.status === params.status
  ) {
    return { created: 0, updated: 0 };
  }

  run(
    `UPDATE tasks SET title = ?, description = ?, status = ?, updated_at = ? WHERE id = ?`,
    [params.title, params.description, params.status, now, params.id]
  );

  const updated = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [params.id]);
  if (updated) {
    broadcast({ type: 'task_updated', payload: updated });
  }

  run(
    `INSERT INTO events (id, type, task_id, message, created_at)
     VALUES (?, 'task_status_changed', ?, ?, ?)`,
    [`evt_${shortHash(`update:${params.id}:${now}`)}`, params.id, `OpenClaw sync updated: ${params.title} → ${params.status}`, now]
  );

  return { created: 0, updated: 1 };
}

export async function POST() {
  try {
    const [{ stdout: sessionsStdout }, { stdout: cronStdout }] = await Promise.all([
      execFileAsync('openclaw', ['sessions', '--all-agents', '--active', '240', '--json'], {
        timeout: 20000,
        maxBuffer: 3 * 1024 * 1024,
      }),
      execFileAsync('openclaw', ['cron', 'list', '--json'], {
        timeout: 20000,
        maxBuffer: 3 * 1024 * 1024,
      }),
    ]);

    const sessionsParsed = JSON.parse(sessionsStdout || '{}');
    const sessions = Array.isArray(sessionsParsed.sessions) ? sessionsParsed.sessions : [];

    const cronParsed = JSON.parse(cronStdout || '{}');
    const jobs = Array.isArray(cronParsed.jobs) ? cronParsed.jobs : [];

    let created = 0;
    let updated = 0;

    for (const s of sessions) {
      const key = String(s.key || s.sessionKey || s.id || 'session');
      const displayName = String(s.displayName || key);
      const kind = String(s.kind || 'unknown');
      const model = String(s.model || s.modelProvider || 'unknown');
      const chat = String(s.chatType || 'unknown');
      const tokens = s.totalTokens ? `tokens=${s.totalTokens}` : 'tokens=unknown';

      const id = `ocs_${shortHash(key)}`;
      const status: TaskStatus = kind === 'direct' ? 'in_progress' : 'assigned';
      const info = upsertTask({
        id,
        title: `OpenClaw Session: ${displayName}`,
        description: `kind=${kind} | chat=${chat} | model=${model} | ${tokens}`,
        status,
        priority: 'normal',
      });
      created += info.created;
      updated += info.updated;
    }

    for (const job of jobs) {
      const jobId = String(job.id || job.name || Math.random());
      const name = String(job.name || jobId);
      const enabled = Boolean(job.enabled);
      const state = job.state || {};
      const lastStatus = String(state.lastStatus || 'unknown');
      const consecutiveErrors = Number(state.consecutiveErrors || 0);
      const nextRunAtMs = Number(state.nextRunAtMs || 0);

      if (!enabled) continue;

      const unhealthy = consecutiveErrors > 0 || lastStatus !== 'ok' || !nextRunAtMs;
      const id = `ocj_${shortHash(jobId)}`;

      const info = upsertTask({
        id,
        title: `Cron Health: ${name}`,
        description: `lastStatus=${lastStatus} | consecutiveErrors=${consecutiveErrors} | nextRunAtMs=${nextRunAtMs || 'missing'}`,
        status: unhealthy ? 'review' : 'done',
        priority: unhealthy ? 'high' : 'low',
      });

      created += info.created;
      updated += info.updated;
    }

    return NextResponse.json({
      ok: true,
      ingested: {
        sessions: sessions.length,
        cronJobs: jobs.length,
      },
      changed: { created, updated },
      timestamp: nowIso(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'sync failed',
      },
      { status: 500 }
    );
  }
}
