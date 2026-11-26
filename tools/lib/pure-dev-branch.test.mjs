import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPureDevBranch,
  PURE_DEV_BRANCH_BASH_RE,
  PURE_DEV_BRANCH_RE,
} from './pure-dev-branch.mjs';

test('isPureDevBranch accepts numeric dev_X_Y_Z only', () => {
  assert.equal(isPureDevBranch('dev_00_02_00'), true);
  assert.equal(isPureDevBranch('dev_0_1_2'), true);
  assert.equal(isPureDevBranch('dev_12_34_56'), true);
});

test('isPureDevBranch rejects suffix / verify / touch-id tracks', () => {
  assert.equal(isPureDevBranch('dev_00_17_00_pgreq251_verify'), false);
  assert.equal(isPureDevBranch('dev_00_02_00_touch_id'), false);
  assert.equal(isPureDevBranch('dev_00_02_00_pgreq20261025000025_verify'), false);
  assert.equal(isPureDevBranch('feature/dev_00_02_00'), false);
  assert.equal(isPureDevBranch('dev_'), false);
  assert.equal(isPureDevBranch('dev_00_02'), false);
  assert.equal(isPureDevBranch(''), false);
  assert.equal(isPureDevBranch(null), false);
});

test('PURE_DEV_BRANCH_BASH_RE matches the same names as PURE_DEV_BRANCH_RE', () => {
  const bash = new RegExp(PURE_DEV_BRANCH_BASH_RE);
  for (const name of ['dev_00_02_00', 'dev_0_1_2', 'dev_12_34_56']) {
    assert.equal(bash.test(name), PURE_DEV_BRANCH_RE.test(name));
  }
  for (const name of [
    'dev_00_17_00_pgreq251_verify',
    'dev_00_02_00_touch_id',
    'dev_00_02',
    'feature/dev_00_02_00',
  ]) {
    assert.equal(bash.test(name), false);
    assert.equal(PURE_DEV_BRANCH_RE.test(name), false);
  }
});
