import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { findUnsupportedMatchesCalls } from './gha-expression-functions.mjs';
import { PURE_DESTIN_BRANCH_BASH_RE } from './pure-destin-branch.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflowsDir = path.join(root, '.github/workflows');

test('findUnsupportedMatchesCalls flags expression matches()', () => {
  const sample = `
jobs:
  release:
    if: matches(github.head_ref, '^dev_[0-9]+_[0-9]+_[0-9]+$')
    runs-on: ubuntu-latest
`;
  const hits = findUnsupportedMatchesCalls(sample);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 4);
});

test('findUnsupportedMatchesCalls ignores comment-only matches mentions', () => {
  const sample = `
    # GHA expressions have no matches(); use bash gate.
    if: needs.pure-destin-gate.outputs.release_track == 'true'
`;
  assert.deepEqual(findUnsupportedMatchesCalls(sample), []);
});

test('workflow YAML must not call unsupported matches()', () => {
  const files = fs
    .readdirSync(workflowsDir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();
  assert.ok(files.length > 0, 'expected workflow files');

  const all = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
    for (const hit of findUnsupportedMatchesCalls(source)) {
      all.push(`${file}:${hit.line}: ${hit.text}`);
    }
  }
  assert.deepEqual(all, [], `unsupported matches() in workflows:\n${all.join('\n')}`);
});

test('worker-ci pure-destin-gate bash pattern stays aligned with PURE_DESTIN_BRANCH_BASH_RE', () => {
  const source = fs.readFileSync(path.join(workflowsDir, 'worker-ci.yml'), 'utf8');
  assert.match(
    source,
    new RegExp(
      String.raw`\[\[ "\$\{BRANCH\}" =~ ${PURE_DESTIN_BRANCH_BASH_RE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \]\]`,
    ),
  );
  assert.match(source, /pure-destin-gate:/);
  assert.doesNotMatch(source, /^\s+if:.*\bmatches\s*\(/m);
});
