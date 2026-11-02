import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const actionYml = path.join(root, '.github/actions/npm-ci-github-packages/action.yml');

test('npm-ci-github-packages disables package-manager-cache when cache input is empty', () => {
  const source = fs.readFileSync(actionYml, 'utf8');

  assert.match(source, /^\s+cache:\s*$/m);
  assert.match(source, /default:\s*"npm"/);
  assert.match(source, /cache:\s*\$\{\{\s*inputs\.cache\s*\}\}/);
  assert.match(
    source,
    /package-manager-cache:\s*\$\{\{\s*inputs\.cache\s*==\s*''\s*&&\s*'false'\s*\|\|\s*'true'\s*\}\}/,
  );
  // composite 内不得在表达式里引用 vars（仅允许注释/description 提及）
  assert.doesNotMatch(source, /\$\{\{[^}]*vars\.GHA_RUNNER/);
});
