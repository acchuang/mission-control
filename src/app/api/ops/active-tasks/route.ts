import { NextResponse } from 'next/server';
import { readFile, stat } from 'node:fs/promises';

export const dynamic = 'force-dynamic';

const DEFAULT_PATH = '/home/alan/.openclaw/workspace/tasks/active-tasks.json';

function resolveSourcePath() {
  return process.env.MC_ACTIVE_TASKS_PATH || DEFAULT_PATH;
}

export async function GET() {
  const sourcePath = resolveSourcePath();

  try {
    const [raw, fileStat] = await Promise.all([
      readFile(sourcePath, 'utf8'),
      stat(sourcePath),
    ]);

    const parsed = JSON.parse(raw || '{}');
    const count = Number(parsed?.count || 0);
    const updatedAt = parsed?.updatedAt || null;

    return NextResponse.json({
      ok: true,
      sourcePath,
      count,
      updatedAt,
      mtimeMs: fileStat.mtimeMs,
      ageMs: Math.max(0, Date.now() - fileStat.mtimeMs),
      producer: parsed?.producer || null,
      activeTasks: Array.isArray(parsed?.activeTasks) ? parsed.activeTasks : [],
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        sourcePath,
        count: 0,
        activeTasks: [],
        error: error instanceof Error ? error.message : 'Failed to read active tasks',
      },
      { status: 500 }
    );
  }
}
