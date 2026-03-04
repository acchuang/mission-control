import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const DEFAULT_WORKSPACE = '/home/alan/.openclaw/workspace';

function getWorkspaceRoot() {
  return process.env.OPENCLAW_WORKSPACE || DEFAULT_WORKSPACE;
}

function safeResolve(root: string, relPath: string) {
  const normalized = path.normalize(relPath).replace(/^\/+/, '');
  const full = path.resolve(root, normalized);
  if (!full.startsWith(path.resolve(root))) throw new Error('Invalid path');
  return full;
}

export async function POST(req: NextRequest) {
  try {
    const { path: relPath } = await req.json();
    if (!relPath) return NextResponse.json({ error: 'path is required' }, { status: 400 });

    const fullPath = safeResolve(getWorkspaceRoot(), relPath);
    if (!fs.existsSync(fullPath)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (process.platform === 'darwin') {
      await execAsync(`open -R "${fullPath}"`);
    } else if (process.platform === 'win32') {
      await execAsync(`explorer /select,"${fullPath}"`);
    } else {
      await execAsync(`xdg-open "${path.dirname(fullPath)}"`);
    }

    return NextResponse.json({ success: true, path: relPath });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Reveal failed' }, { status: 500 });
  }
}
