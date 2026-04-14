import { NextRequest, NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const FALLBACK_GATEWAY_URL = 'ws://127.0.0.1:18789';

function jsonNoStore(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    },
  });
}

function resolveSessionCount(sessions: unknown): number {
  if (Array.isArray(sessions)) return sessions.length;
  if (sessions && typeof sessions === 'object' && Array.isArray((sessions as { sessions?: unknown[] }).sessions)) {
    return ((sessions as { sessions?: unknown[] }).sessions || []).length;
  }
  return 0;
}

// GET /api/openclaw/status - Check OpenClaw connection status
export async function GET(request: NextRequest) {
  const lite = request.nextUrl.searchParams.get('lite') === '1';
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || FALLBACK_GATEWAY_URL;

  try {
    const client = getOpenClawClient();

    if (!client.isConnected()) {
      try {
        await client.connect();
      } catch {
        return jsonNoStore({
          connected: false,
          error: 'Failed to connect to OpenClaw Gateway',
          gateway_url: gatewayUrl,
        });
      }
    }

    // Try to list sessions to verify connection
    try {
      const sessions = await client.listSessions();
      const sessionsCount = resolveSessionCount(sessions);

      if (lite) {
        return jsonNoStore({
          connected: true,
          sessions_count: sessionsCount,
          gateway_url: gatewayUrl,
        });
      }

      return jsonNoStore({
        connected: true,
        sessions_count: sessionsCount,
        sessions,
        gateway_url: gatewayUrl,
      });
    } catch {
      return jsonNoStore({
        connected: true,
        error: 'Connected but failed to list sessions',
        gateway_url: gatewayUrl,
      });
    }
  } catch (error) {
    console.error('OpenClaw status check failed:', error);
    return jsonNoStore(
      {
        connected: false,
        error: 'Internal server error',
      },
      500,
    );
  }
}
