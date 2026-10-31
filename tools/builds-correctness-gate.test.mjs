import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  adaptivePollSeconds,
  cfApiConfigured,
  classifyCfBuild,
  classifyGithubChecks,
  commitHashMatches,
  filterBuildsChecks,
  matchesContext,
  pickBuildForCommit,
  summarizeCfBuild,
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

test('adaptivePollSeconds ramps 2,5,10 then cap', () => {
  assert.equal(adaptivePollSeconds(20, 0), 2);
  assert.equal(adaptivePollSeconds(20, 1), 5);
  assert.equal(adaptivePollSeconds(20, 2), 10);
  assert.equal(adaptivePollSeconds(20, 3), 20);
  assert.equal(adaptivePollSeconds(20, 99), 20);
});

test('adaptivePollSeconds respects lower cap', () => {
  assert.equal(adaptivePollSeconds(6, 0), 2);
  assert.equal(adaptivePollSeconds(6, 1), 5);
  assert.equal(adaptivePollSeconds(6, 2), 6);
  assert.equal(adaptivePollSeconds(6, 3), 6);
});

test('cfApiConfigured requires account, worker tag, and token', () => {
  assert.equal(cfApiConfigured({}), false);
  assert.equal(
    cfApiConfigured({
      cfAccountId: 'acc',
      cfWorkerTag: 'tag',
      cfApiToken: 'tok',
    }),
    true,
  );
  assert.equal(
    cfApiConfigured({
      cfAccountId: 'acc',
      cfWorkerTag: '',
      cfApiToken: 'tok',
    }),
    false,
  );
});

test('commitHashMatches compares case-insensitive full or prefix', () => {
  assert.equal(commitHashMatches('abc123def', 'ABC123DEF456'), true);
  assert.equal(commitHashMatches('abc123def456', 'abc123'), true);
  assert.equal(commitHashMatches('abc123', 'def456'), false);
});

test('pickBuildForCommit chooses newest matching build', () => {
  const builds = [
    {
      build_uuid: 'old',
      created_on: '2026-01-01T00:00:00Z',
      build_trigger_metadata: { commit_hash: 'aaa111' },
      status: 'stopped',
      build_outcome: 'success',
    },
    {
      build_uuid: 'new',
      created_on: '2026-01-02T00:00:00Z',
      build_trigger_metadata: { commit_hash: 'bbb222' },
      status: 'running',
    },
    {
      build_uuid: 'want',
      created_on: '2026-01-03T00:00:00Z',
      build_trigger_metadata: { commit_hash: 'ccc333' },
      status: 'stopped',
      build_outcome: 'success',
    },
  ];
  const picked = pickBuildForCommit(builds, 'ccc333');
  assert.equal(picked?.build_uuid, 'want');
});

test('classifyCfBuild maps stopped outcomes', () => {
  assert.equal(classifyCfBuild(null), 'none');
  assert.equal(classifyCfBuild({ status: 'running' }), 'pending');
  assert.equal(
    classifyCfBuild({ status: 'stopped', build_outcome: 'success' }),
    'success',
  );
  assert.equal(classifyCfBuild({ status: 'stopped', build_outcome: 'fail' }), 'failure');
});

test('classifyGithubChecks mirrors check-run semantics', () => {
  assert.equal(classifyGithubChecks([]), 'none');
  assert.equal(
    classifyGithubChecks([{ status: 'completed', conclusion: 'success' }]),
    'success',
  );
  assert.equal(
    classifyGithubChecks([{ status: 'in_progress', conclusion: null }]),
    'pending',
  );
  assert.equal(
    classifyGithubChecks([{ status: 'completed', conclusion: 'failure' }]),
    'failure',
  );
});

test('summarizeCfBuild is compact', () => {
  assert.match(
    summarizeCfBuild({ build_uuid: 'u1', status: 'stopped', build_outcome: 'success' }),
    /u1:stopped\/success/,
  );
});
