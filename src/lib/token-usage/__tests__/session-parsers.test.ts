import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  bucketByDayAndModel,
  dedupeCronSessions,
  normalizeModelKey,
  parseSessionKeyMeta,
} from '../session-parsers';
import type { SessionUsageRow } from '../types';

describe('parseSessionKeyMeta', () => {
  it('parses cron run key', () => {
    const meta = parseSessionKeyMeta('agent:moneydog:cron:6fe84e8a-1234:run:abc');
    assert.equal(meta.isCron, true);
    assert.equal(meta.cronJobId, '6fe84e8a-1234');
    assert.equal(meta.cronRunId, 'abc');
  });

  it('parses parent cron key without run id', () => {
    const meta = parseSessionKeyMeta('agent:moneydog:cron:6fe84e8a-1234');
    assert.equal(meta.isCron, true);
    assert.equal(meta.cronJobId, '6fe84e8a-1234');
    assert.equal(meta.cronRunId, undefined);
  });

  it('returns non-cron for direct keys', () => {
    const meta = parseSessionKeyMeta('agent:main:discord:direct:123');
    assert.equal(meta.isCron, false);
  });
});

describe('normalizeModelKey', () => {
  it('normalizes provider/model', () => {
    assert.equal(normalizeModelKey('openai-codex', 'gpt-5.3-codex'), 'openai-codex/gpt-5.3-codex');
  });

  it('keeps pre-normalized model strings', () => {
    assert.equal(normalizeModelKey('openai-codex', 'openai-codex/gpt-5.3-codex'), 'openai-codex/gpt-5.3-codex');
  });
});

describe('dedupeCronSessions', () => {
  it('prefers :run: sessions over parent cron aggregate', () => {
    const rows: SessionUsageRow[] = [
      {
        key: 'agent:moneydog:cron:job-a',
        totalTokens: 200,
        inputTokens: 150,
        outputTokens: 50,
        contextTokens: 0,
        updatedAt: Date.now(),
      },
      {
        key: 'agent:moneydog:cron:job-a:run:r1',
        totalTokens: 120,
        inputTokens: 90,
        outputTokens: 30,
        contextTokens: 0,
        updatedAt: Date.now(),
      },
      {
        key: 'agent:moneydog:cron:job-a:run:r2',
        totalTokens: 80,
        inputTokens: 60,
        outputTokens: 20,
        contextTokens: 0,
        updatedAt: Date.now(),
      },
    ];

    const deduped = dedupeCronSessions(rows);
    assert.equal(deduped.length, 2);
    assert.ok(deduped.every((row) => row.key.includes(':run:')));
  });
});

describe('bucketByDayAndModel', () => {
  it('buckets rows for 5-day window by model and day', () => {
    const now = Date.UTC(2026, 2, 4, 12, 0, 0);
    const oneDay = 24 * 60 * 60 * 1000;

    const rows: SessionUsageRow[] = [
      {
        key: 'k1',
        modelProvider: 'openai-codex',
        model: 'gpt-5.3-codex',
        totalTokens: 100,
        inputTokens: 70,
        outputTokens: 30,
        contextTokens: 0,
        updatedAt: now,
      },
      {
        key: 'k2',
        modelProvider: 'openai-codex',
        model: 'gpt-5.3-codex',
        totalTokens: 50,
        inputTokens: 30,
        outputTokens: 20,
        contextTokens: 0,
        updatedAt: now - oneDay,
      },
      {
        key: 'k3',
        modelProvider: 'anthropic',
        model: 'claude-sonnet',
        totalTokens: 40,
        inputTokens: 20,
        outputTokens: 20,
        contextTokens: 0,
        updatedAt: now,
      },
    ];

    const buckets = bucketByDayAndModel(rows, 5, now, 'UTC');

    assert.equal(buckets.length, 3);
    assert.equal(
      buckets.find((b) => b.day === '2026-03-04' && b.model === 'openai-codex/gpt-5.3-codex')?.totalTokens,
      100,
    );
    assert.equal(
      buckets.find((b) => b.day === '2026-03-03' && b.model === 'openai-codex/gpt-5.3-codex')?.totalTokens,
      50,
    );
  });
});
