import type { DailyModelUsage, ParsedSessionKeyMeta, SessionUsageRow } from './types';

const CRON_KEY_RE = /^agent:[^:]+:cron:([^:]+)(?::run:([^:]+))?/;
const MELBOURNE_TZ = 'Australia/Melbourne';

export function parseSessionKeyMeta(key: string): ParsedSessionKeyMeta {
  const input = String(key || '');
  const match = input.match(CRON_KEY_RE);
  if (!match) return { isCron: false };

  return {
    isCron: true,
    cronJobId: match[1],
    cronRunId: match[2],
  };
}

export function normalizeModelKey(modelProvider?: string, model?: string): string {
  const provider = String(modelProvider || '').trim();
  const modelName = String(model || '').trim();

  if (!provider && !modelName) return 'unknown/unknown';
  if (modelName.includes('/')) return modelName;
  if (!provider) return `unknown/${modelName || 'unknown'}`;
  return `${provider}/${modelName || 'unknown'}`;
}

export function coerceNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

export function dedupeCronSessions(rows: SessionUsageRow[]): SessionUsageRow[] {
  const byJob = new Map<string, SessionUsageRow[]>();

  for (const row of rows) {
    const meta = parseSessionKeyMeta(row.key);
    if (!meta.isCron || !meta.cronJobId) continue;
    const current = byJob.get(meta.cronJobId) || [];
    current.push(row);
    byJob.set(meta.cronJobId, current);
  }

  const deduped: SessionUsageRow[] = [];

  byJob.forEach((jobRows) => {
    const runRows = jobRows.filter((r) => Boolean(parseSessionKeyMeta(r.key).cronRunId));
    const selected = runRows.length > 0 ? runRows : jobRows;

    const seen = new Set<string>();
    for (const row of selected) {
      if (seen.has(row.key)) continue;
      seen.add(row.key);
      deduped.push(row);
    }
  });

  return deduped;
}

export function dayKeyFromTimestamp(timestampMs: number, tz = MELBOURNE_TZ): string {
  const date = new Date(timestampMs);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((p) => p.type === 'year')?.value || '1970';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  const day = parts.find((p) => p.type === 'day')?.value || '01';

  return `${year}-${month}-${day}`;
}

function buildDayWindow(days: number, nowMs: number, tz = MELBOURNE_TZ): string[] {
  const end = new Date(nowMs);
  const keys: string[] = [];

  for (let i = days - 1; i >= 0; i -= 1) {
    const dt = new Date(end);
    dt.setDate(end.getDate() - i);
    keys.push(dayKeyFromTimestamp(dt.getTime(), tz));
  }

  return keys;
}

export function bucketByDayAndModel(
  rows: SessionUsageRow[],
  days = 5,
  nowMs = Date.now(),
  tz = MELBOURNE_TZ,
): DailyModelUsage[] {
  const window = new Set(buildDayWindow(days, nowMs, tz));
  const aggregates = new Map<string, DailyModelUsage>();

  for (const row of rows) {
    const day = dayKeyFromTimestamp(row.updatedAt, tz);
    if (!window.has(day)) continue;

    const model = normalizeModelKey(row.modelProvider, row.model);
    const key = `${day}::${model}`;

    const current = aggregates.get(key) || {
      day,
      model,
      sessionCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };

    current.sessionCount += 1;
    current.inputTokens += coerceNumber(row.inputTokens);
    current.outputTokens += coerceNumber(row.outputTokens);
    current.totalTokens += coerceNumber(row.totalTokens);

    aggregates.set(key, current);
  }

  return Array.from(aggregates.values()).sort((a, b) => {
    if (a.day === b.day) return b.totalTokens - a.totalTokens;
    return b.day.localeCompare(a.day);
  });
}
