import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

import { estimateTokensFromBytes, isContextFile } from '@/lib/token-usage/file-estimator';

export const dynamic = 'force-dynamic';

const DEFAULT_WORKSPACE = '/home/alan/.openclaw/workspace';
const MAX_ENTRIES = 60;

function getWorkspaceRoot() {
  const configured = process.env.OPENCLAW_WORKSPACE;
  if (configured) return configured;
  return DEFAULT_WORKSPACE;
}

function safeJoin(root: string, relPath: string) {
  const normalized = path.normalize(relPath).replace(/^\/+/, '');
  const full = path.resolve(root, normalized);
  if (!full.startsWith(path.resolve(root))) {
    throw new Error('Invalid path');
  }
  return full;
}

async function estimateDirectoryTokenHint(dirPath: string, root: string): Promise<number> {
  try {
    const children = await fs.readdir(dirPath, { withFileTypes: true });
    let total = 0;

    for (const child of children.slice(0, 100)) {
      if (!child.isFile()) continue;
      const fullPath = path.join(dirPath, child.name);
      const relPath = path.relative(root, fullPath).replace(/\\/g, '/');
      if (!isContextFile(relPath)) continue;
      const stat = await fs.stat(fullPath);
      total += estimateTokensFromBytes(stat.size);
    }

    return total;
  } catch {
    return 0;
  }
}

async function listDir(targetPath: string, root: string) {
  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const mapped = await Promise.all(
    entries.slice(0, MAX_ENTRIES).map(async (entry) => {
      const fullPath = path.join(targetPath, entry.name);
      const stat = await fs.stat(fullPath);
      const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');
      const isDir = entry.isDirectory();
      const contextEligible = isDir ? false : isContextFile(relativePath);
      const estimatedTokens = isDir
        ? await estimateDirectoryTokenHint(fullPath, root)
        : contextEligible
          ? estimateTokensFromBytes(stat.size)
          : null;

      return {
        name: entry.name,
        type: isDir ? 'dir' : 'file',
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        relativePath,
        contextEligible,
        estimatedTokens,
      };
    }),
  );

  return mapped.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function GET(req: NextRequest) {
  try {
    const root = getWorkspaceRoot();
    const { searchParams } = new URL(req.url);
    const relPath = searchParams.get('path') || '';

    const targetPath = safeJoin(root, relPath);
    const targetStat = await fs.stat(targetPath);

    if (!targetStat.isDirectory()) {
      return NextResponse.json({ error: 'Path is not a directory' }, { status: 400 });
    }

    const [topLevelEntries, projectsEntries, memoryEntries] = await Promise.all([
      listDir(targetPath, root),
      listDir(path.join(root, 'projects'), root).catch(() => []),
      listDir(path.join(root, 'memory'), root).catch(() => []),
    ]);

    const folders = topLevelEntries.filter((e) => e.type === 'dir').slice(0, 20);
    const files = topLevelEntries.filter((e) => e.type === 'file').slice(0, 20);
    const projects = projectsEntries.filter((e) => e.type === 'dir').slice(0, 20);
    const memory = memoryEntries.filter((e) => e.name.endsWith('.md') || e.name.endsWith('.json')).slice(0, 20);

    const totalBytes = topLevelEntries.reduce((sum, entry) => sum + entry.size, 0);
    const totalEstimatedTokens = topLevelEntries.reduce(
      (sum, entry) => sum + (typeof entry.estimatedTokens === 'number' ? entry.estimatedTokens : 0),
      0,
    );

    return NextResponse.json({
      root,
      currentPath: relPath || '.',
      sections: {
        projects,
        folders,
        files,
        memory,
      },
      totals: {
        entries: topLevelEntries.length,
        bytes: totalBytes,
        estimatedTokens: totalEstimatedTokens,
      },
      entries: topLevelEntries,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load workspace context' },
      { status: 500 },
    );
  }
}
