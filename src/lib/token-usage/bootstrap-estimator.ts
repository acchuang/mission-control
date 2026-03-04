import fs from 'node:fs/promises';
import path from 'node:path';

import { estimateTokensFromText } from './file-estimator';
import type { BootstrapLoadEstimate, BootstrapLoadFile } from './types';

export interface BootstrapEstimatorOptions {
  workspaceRoot: string;
  now?: Date;
  includeLongTermMemory?: boolean;
}

function datePathPart(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function resolveBootstrapRelativePaths(options: BootstrapEstimatorOptions): string[] {
  const now = options.now || new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const files = [
    'AGENTS.md',
    'SOUL.md',
    'USER.md',
    `memory/${datePathPart(now)}.md`,
    `memory/${datePathPart(yesterday)}.md`,
  ];

  if (options.includeLongTermMemory !== false) {
    files.push('MEMORY.md');
  }

  return files;
}

async function readBootstrapFile(workspaceRoot: string, relPath: string): Promise<BootstrapLoadFile> {
  const fullPath = path.join(workspaceRoot, relPath);

  try {
    const content = await fs.readFile(fullPath, 'utf-8');
    const bytes = Buffer.byteLength(content, 'utf-8');
    return {
      path: relPath,
      exists: true,
      bytes,
      estimatedTokens: estimateTokensFromText(content),
    };
  } catch {
    return {
      path: relPath,
      exists: false,
      bytes: 0,
      estimatedTokens: 0,
    };
  }
}

export async function estimateBootstrapLoad(options: BootstrapEstimatorOptions): Promise<BootstrapLoadEstimate> {
  const paths = resolveBootstrapRelativePaths(options);
  const files = await Promise.all(paths.map((relPath) => readBootstrapFile(options.workspaceRoot, relPath)));

  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);
  const totalEstimatedTokens = files.reduce((sum, f) => sum + f.estimatedTokens, 0);

  return {
    generatedAt: (options.now || new Date()).toISOString(),
    totalBytes,
    totalEstimatedTokens,
    files,
    missingFiles: files.filter((f) => !f.exists).map((f) => f.path),
  };
}
