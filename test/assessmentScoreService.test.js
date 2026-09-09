const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getEffectiveCesScore,
  normalizeOptionalScore,
} = require('../src/services/assessmentScoreService');

test('empty optional CES Attempt 2 is normalized to null', () => {
  assert.equal(normalizeOptionalScore(''), null);
  assert.equal(normalizeOptionalScore('   '), null);
});

test('CES Attempt 1 is used when Attempt 2 is empty', () => {
  assert.equal(getEffectiveCesScore('72.5', ''), 72.5);
});

test('CES Attempt 2 replaces Attempt 1 when entered', () => {
  assert.equal(getEffectiveCesScore('72.5', '81'), 81);
});

test('a valid zero in CES Attempt 2 replaces Attempt 1', () => {
  assert.equal(getEffectiveCesScore('72.5', '0'), 0);
});
