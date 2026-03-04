import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { estimateBootstrapLoad, resolveBootstrapRelativePaths } from '../bootstrap-estimator';

describe('resolveBootstrapRelativePaths', () => {
  it('includes required startup files and date memories', () => {
    const files = resolveBootstrapRelativePaths({
      workspaceRoot: '/tmp/workspace',
      now: new Date('2026-03-04T10:00:00.000Z'),
      includeLongTermMemory: true,
    });

    assert.deepEqual(files, [
      'AGENTS.md',
      'SOUL.md',
      'USER.md',
      'memory/2026-03-04.md',
      'memory/2026-03-03.md',
      'MEMORY.md',
    ]);
  });
});

describe('estimateBootstrapLoad', () => {
  it('estimates existing files and marks missing ones', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-bootstrap-'));
    await fs.mkdir(path.join(tmp, 'memory'), { recursive: true });

    await fs.writeFile(path.join(tmp, 'AGENTS.md'), 'hello agents');
    await fs.writeFile(path.join(tmp, 'SOUL.md'), 'soul');
    await fs.writeFile(path.join(tmp, 'USER.md'), 'user');
    await fs.writeFile(path.join(tmp, 'memory', '2026-03-04.md'), 'today memory');
    await fs.writeFile(path.join(tmp, 'memory', '2026-03-03.md'), 'yesterday memory');

    const result = await estimateBootstrapLoad({
      workspaceRoot: tmp,
      now: new Date('2026-03-04T10:00:00.000Z'),
      includeLongTermMemory: true,
    });

    assert.equal(result.files.length, 6);
    assert.ok(result.totalEstimatedTokens > 0);
    assert.deepEqual(result.missingFiles, ['MEMORY.md']);
  });
});
