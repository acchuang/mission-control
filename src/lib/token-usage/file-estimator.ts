import path from 'node:path';

const TOKEN_CHARS_DIVISOR = 4;

const CONTEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yaml', '.yml']);
const CONTEXT_BASENAMES = new Set([
  'AGENTS.md',
  'SOUL.md',
  'USER.md',
  'MEMORY.md',
  'HEARTBEAT.md',
  'LEARNING.md',
  'TOOLS.md',
  'IDENTITY.md',
]);

export function estimateTokensFromText(text: string): number {
  const size = String(text || '').length;
  if (size <= 0) return 0;
  return Math.ceil(size / TOKEN_CHARS_DIVISOR);
}

export function estimateTokensFromBytes(bytes: number): number {
  const numeric = Number(bytes);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.ceil(numeric / TOKEN_CHARS_DIVISOR);
}

export function isContextFile(filePath: string): boolean {
  const base = path.basename(filePath);
  if (CONTEXT_BASENAMES.has(base)) return true;

  const ext = path.extname(filePath).toLowerCase();
  if (CONTEXT_EXTENSIONS.has(ext)) return true;

  if (filePath.startsWith('memory/')) {
    return ext === '.md' || ext === '.json';
  }

  if (filePath.startsWith('docs/')) {
    return ext === '.md';
  }

  return false;
}

export function summarizeFolderContext(
  rows: Array<{ bytes: number; estimatedTokens: number | null }>,
): { bytes: number; estimatedTokens: number } {
  let bytes = 0;
  let estimatedTokens = 0;

  for (const row of rows) {
    bytes += Number.isFinite(row.bytes) ? row.bytes : 0;
    estimatedTokens += Number.isFinite(row.estimatedTokens ?? NaN) ? Number(row.estimatedTokens || 0) : 0;
  }

  return { bytes, estimatedTokens };
}
