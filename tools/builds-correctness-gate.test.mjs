import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
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
