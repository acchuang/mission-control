import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

const DEFAULT_WORKSPACE = '/home/alan/.openclaw/workspace';
const MAX_RESULTS = 25;

function getWorkspaceRoot() {
  return process.env.OPENCLAW_WORKSPACE || DEFAULT_WORKSPACE;
}

export async function GET(req: NextRequest) {
  try {
    const q = (req.nextUrl.searchParams.get('q') || '').trim().toLowerCase();
    if (!q) return NextResponse.json({ results: [] });

    const memoryDir = path.join(getWorkspaceRoot(), 'memory');
    const files = (await fs.readdir(memoryDir)).filter((f) => f.endsWith('.md')).slice(0, 200);

    const results: Array<{ file: string; line: number; snippet: string }> = [];

    for (const file of files) {
      const full = path.join(memoryDir, file);
      const content = await fs.readFile(full, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (line.toLowerCase().includes(q) && results.length < MAX_RESULTS) {
          results.push({ file: `memory/${file}`, line: idx + 1, snippet: line.trim().slice(0, 180) });
        }
      });
      if (results.length >= MAX_RESULTS) break;
    }

    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Search failed' }, { status: 500 });
  }
}
