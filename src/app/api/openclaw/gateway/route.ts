import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

type GatewayAction = 'start' | 'stop' | 'restart';

async function runOpenClaw(args: string[]) {
  const { stdout, stderr } = await execFileAsync('openclaw', args, {
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });

  return {
    stdout: stdout?.trim() || '',
    stderr: stderr?.trim() || '',
  };
}

export async function GET() {
  try {
    const result = await runOpenClaw(['gateway', 'status']);

    return NextResponse.json({
      ok: true,
      command: 'openclaw gateway status',
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to get gateway status',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = body?.action as GatewayAction;

    if (!['start', 'stop', 'restart'].includes(action)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid action. Allowed: start, stop, restart' },
        { status: 400 }
      );
    }

    const result = await runOpenClaw(['gateway', action]);

    return NextResponse.json({
      ok: true,
      action,
      command: `openclaw gateway ${action}`,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to run gateway action',
      },
      { status: 500 }
    );
  }
}
