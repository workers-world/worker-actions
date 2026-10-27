import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPureDestinBranch,
  PURE_DESTIN_BRANCH_BASH_RE,
  PURE_DESTIN_BRANCH_RE,
} from './pure-destin-branch.mjs';

test('isPureDestinBranch accepts numeric dev_X_Y_Z only', () => {
  assert.equal(isPureDestinBranch('dev_00_02_00'), true);
  assert.equal(isPureDestinBranch('dev_0_1_2'), true);
  assert.equal(isPureDestinBranch('dev_12_34_56'), true);
});

test('isPureDestinBranch rejects suffix / verify / touch-id tracks', () => {
  assert.equal(isPureDestinBranch('dev_00_17_00_pgreq251_verify'), false);
  assert.equal(isPureDestinBranch('dev_00_02_00_touch_id'), false);
  assert.equal(isPureDestinBranch('dev_00_02_00_pgreq20261025000025_verify'), false);
  assert.equal(isPureDestinBranch('feature/dev_00_02_00'), false);
  assert.equal(isPureDestinBranch('dev_'), false);
  assert.equal(isPureDestinBranch('dev_00_02'), false);
  assert.equal(isPureDestinBranch(''), false);
  assert.equal(isPureDestinBranch(null), false);
});

test('PURE_DESTIN_BRANCH_BASH_RE matches the same names as PURE_DESTIN_BRANCH_RE', () => {
  const bash = new RegExp(PURE_DESTIN_BRANCH_BASH_RE);
  for (const name of ['dev_00_02_00', 'dev_0_1_2', 'dev_12_34_56']) {
    assert.equal(bash.test(name), PURE_DESTIN_BRANCH_RE.test(name));
  }
  for (const name of [
    'dev_00_17_00_pgreq251_verify',
    'dev_00_02_00_touch_id',
    'dev_00_02',
    'feature/dev_00_02_00',
  ]) {
    assert.equal(bash.test(name), false);
    assert.equal(PURE_DESTIN_BRANCH_RE.test(name), false);
  }
});
