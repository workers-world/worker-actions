import assert from 'node:assert/strict';
import test from 'node:test';
import { isPureDestinBranch } from './pure-destin-branch.mjs';

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
