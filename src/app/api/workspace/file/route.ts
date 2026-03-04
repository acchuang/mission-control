import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

const DEFAULT_WORKSPACE = '/home/alan/.openclaw/workspace';
const MAX_PREVIEW_CHARS = 20000;

function getWorkspaceRoot() {
  return process.env.OPENCLAW_WORKSPACE || DEFAULT_WORKSPACE;
}

function safeResolve(root: string, relPath: string) {
  const normalized = path.normalize(relPath).replace(/^\/+/, '');
  const full = path.resolve(root, normalized);
  if (!full.startsWith(path.resolve(root))) throw new Error('Invalid path');
  return full;
}

function detectLang(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.md') return 'markdown';
  if (['.ts', '.tsx', '.js', '.jsx', '.json', '.yml', '.yaml', '.sh', '.py', '.txt', '.html', '.htm', '.css'].includes(ext)) return 'text';
  return 'unknown';
}

export async function GET(req: NextRequest) {
  try {
    const root = getWorkspaceRoot();
    const relPath = req.nextUrl.searchParams.get('path');
    if (!relPath) return NextResponse.json({ error: 'path is required' }, { status: 400 });

    const filePath = safeResolve(root, relPath);
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return NextResponse.json({ error: 'Not a file' }, { status: 400 });

    const lang = detectLang(filePath);
    if (lang === 'unknown') {
      return NextResponse.json({ error: 'Preview not supported for this file type' }, { status: 415 });
    }

    const content = await fs.readFile(filePath, 'utf-8');
    return NextResponse.json({
      path: relPath,
      name: path.basename(filePath),
      lang,
      size: stat.size,
      content: content.slice(0, MAX_PREVIEW_CHARS),
      truncated: content.length > MAX_PREVIEW_CHARS,
      mtime: stat.mtime.toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to preview file' }, { status: 500 });
  }
}
