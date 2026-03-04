import { NextRequest, NextResponse } from 'next/server';

import { collectTokenUsageSnapshot } from '@/lib/token-usage/collector';
import type { TokenUsageSnapshot } from '@/lib/token-usage/types';

export const dynamic = 'force-dynamic';

const DEFAULT_WORKSPACE = '/home/alan/.openclaw/workspace';
const DEFAULT_TTL_MS = 45_000;

let cache: { at: number; payload: TokenUsageSnapshot } | null = null;

function getWorkspaceRoot() {
  return process.env.OPENCLAW_WORKSPACE || DEFAULT_WORKSPACE;
}

function getTtlMs() {
  const value = Number(process.env.MC_TOKEN_USAGE_TTL_MS || DEFAULT_TTL_MS);
  if (!Number.isFinite(value) || value < 5_000) return DEFAULT_TTL_MS;
  return value;
}

export async function GET(req: NextRequest) {
  const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1';
  const ttlMs = getTtlMs();
  const now = Date.now();

  if (!forceRefresh && cache && now - cache.at <= ttlMs) {
    return NextResponse.json({
      ...cache.payload,
      cache: {
        hit: true,
        ageMs: now - cache.at,
        ttlMs,
      },
    });
  }

  try {
    const payload = await collectTokenUsageSnapshot({
      workspaceRoot: getWorkspaceRoot(),
      days: 5,
    });

    cache = { at: now, payload };

    return NextResponse.json({
      ...payload,
      cache: {
        hit: false,
        ageMs: 0,
        ttlMs,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to collect token usage',
      },
      { status: 500 },
    );
  }
}
