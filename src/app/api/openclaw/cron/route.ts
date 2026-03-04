import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function GET() {
  try {
    const { stdout } = await execFileAsync('openclaw', ['cron', 'list', '--json'], {
      timeout: 20000,
      maxBuffer: 2 * 1024 * 1024,
    });

    const parsed = JSON.parse(stdout || '{}');
    const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];

    return NextResponse.json({
      ok: true,
      jobs,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        jobs: [],
        error: error instanceof Error ? error.message : 'Failed to load cron jobs',
      },
      { status: 500 }
    );
  }
}
