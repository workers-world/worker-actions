import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  adaptivePollSeconds,
  filterBuildsChecks,
  matchesContext,
} from '../.github/actions/builds-correctness-gate/gate.mjs';

test('matchesContext empty accepts any name', () => {
  assert.equal(matchesContext('Cloudflare Workers and Pages: mok1', ''), true);
});

test('matchesContext filters by substring', () => {
  assert.equal(matchesContext('Cloudflare Workers and Pages: mok1', 'mok1'), true);
  assert.equal(matchesContext('Cloudflare Workers and Pages: other', 'mok1'), false);
});

test('filterBuildsChecks keeps cloudflare-workers-and-pages app only', () => {
  const runs = [
    { name: 'CI', app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success' },
    {
      name: 'Cloudflare Workers and Pages: mok1',
      app: { slug: 'cloudflare-workers-and-pages' },
      status: 'completed',
      conclusion: 'success',
    },
  ];
  const matched = filterBuildsChecks(runs, '');
  assert.equal(matched.length, 1);
  assert.match(matched[0].name, /mok1/);
});

test('adaptivePollSeconds ramps 1,2,5,10 then cap', () => {
  assert.equal(adaptivePollSeconds(20, 0), 1);
  assert.equal(adaptivePollSeconds(20, 1), 2);
  assert.equal(adaptivePollSeconds(20, 2), 5);
  assert.equal(adaptivePollSeconds(20, 3), 10);
  assert.equal(adaptivePollSeconds(20, 4), 20);
  assert.equal(adaptivePollSeconds(20, 99), 20);
});

test('adaptivePollSeconds respects lower cap', () => {
  assert.equal(adaptivePollSeconds(6, 0), 1);
  assert.equal(adaptivePollSeconds(6, 1), 2);
  assert.equal(adaptivePollSeconds(6, 2), 5);
  assert.equal(adaptivePollSeconds(6, 3), 6);
  assert.equal(adaptivePollSeconds(6, 4), 6);
});
