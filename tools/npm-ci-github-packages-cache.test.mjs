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
  // composite 内不得在表达式里引用 vars（仅允许注释/description 提及）
  assert.doesNotMatch(source, /\$\{\{[^}]*vars\.GHA_RUNNER/);
});

test('npm-ci-github-packages auto-disables Actions npm cache on self-hosted runners', () => {
  const source = fs.readFileSync(actionYml, 'utf8');

  // #299：不依赖 caller 传 cache:""；用 RUNNER_ENVIRONMENT（非 vars）检测自托管
  assert.match(source, /RUNNER_ENVIRONMENT/);
  assert.match(source, /self-hosted/);
  assert.match(source, /id:\s*cache_cfg/);
  assert.match(source, /cache:\s*\$\{\{\s*steps\.cache_cfg\.outputs\.cache\s*\}\}/);
  assert.match(
    source,
    /package-manager-cache:\s*\$\{\{\s*steps\.cache_cfg\.outputs\.package_manager_cache\s*\}\}/,
  );
  // 关闭分支须同时写空 cache + package_manager_cache=false（覆盖 setup-node@v7 #280）
  assert.match(source, /package_manager_cache=false/);
  assert.match(source, /CACHE_INPUT/);
});
