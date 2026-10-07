import test from 'node:test';
import assert from 'node:assert/strict';
import { percentile, summarize, durationSeconds } from './stats.mjs';

test('durationSeconds', () => {
  assert.equal(durationSeconds('2026-01-01T00:00:00Z', '2026-01-01T00:00:10Z'), 10);
  assert.equal(durationSeconds(null, 'x'), null);
});

test('percentile and summarize', () => {
  const s = summarize([1, 2, 3, 4, 100]);
  assert.equal(s.n, 5);
  assert.equal(s.p50, 3);
  assert.ok(s.p95 > 50);
});
