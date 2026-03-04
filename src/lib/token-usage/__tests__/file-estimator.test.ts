import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  estimateTokensFromBytes,
  estimateTokensFromText,
  isContextFile,
  summarizeFolderContext,
} from '../file-estimator';

describe('estimateTokensFromText', () => {
  it('estimates by chars/4', () => {
    assert.equal(estimateTokensFromText('abcd'), 1);
    assert.equal(estimateTokensFromText('abcdefgh'), 2);
  });
});

describe('estimateTokensFromBytes', () => {
  it('estimates bytes similarly', () => {
    assert.equal(estimateTokensFromBytes(4), 1);
    assert.equal(estimateTokensFromBytes(9), 3);
  });
});

describe('isContextFile', () => {
  it('accepts md and memory/docs context files', () => {
    assert.equal(isContextFile('AGENTS.md'), true);
    assert.equal(isContextFile('memory/2026-03-04.md'), true);
    assert.equal(isContextFile('docs/guide.md'), true);
    assert.equal(isContextFile('images/logo.png'), false);
  });
});

describe('summarizeFolderContext', () => {
  it('sums bytes and estimated tokens', () => {
    const result = summarizeFolderContext([
      { bytes: 100, estimatedTokens: 25 },
      { bytes: 20, estimatedTokens: null },
      { bytes: 80, estimatedTokens: 20 },
    ]);

    assert.deepEqual(result, { bytes: 200, estimatedTokens: 45 });
  });
});
