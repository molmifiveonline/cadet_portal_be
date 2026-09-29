const test = require('node:test');
const assert = require('node:assert/strict');
const { buildChecklistUpdate } = require('../src/services/onboardingRules');

const emptyChecklist = {
  passport_verified: 0,
  medical_cert_verified: 0,
  bank_details_verified: 0,
  agreement_signed: 0,
  final_clearance: 0,
};

test('keeps unchanged checklist values and applies a boolean update', () => {
  const result = buildChecklistUpdate(emptyChecklist, { passport_verified: true });

  assert.equal(result.next.passport_verified, 1);
  assert.equal(result.next.medical_cert_verified, 0);
  assert.equal(result.completedChecks, 1);
  assert.equal(result.complete, false);
});

test('accepts explicit zero without treating it as true', () => {
  const result = buildChecklistUpdate(
    { ...emptyChecklist, passport_verified: 1 },
    { passport_verified: '0' },
  );

  assert.equal(result.next.passport_verified, 0);
});

test('blocks Final Clearance until the first four checks are complete', () => {
  assert.throws(
    () => buildChecklistUpdate(emptyChecklist, { final_clearance: true }),
    /Complete the first four checklist items/,
  );
});

test('marks onboarding complete only when all five checks are complete', () => {
  const result = buildChecklistUpdate(
    {
      passport_verified: 1,
      medical_cert_verified: 1,
      bank_details_verified: 1,
      agreement_signed: 1,
      final_clearance: 0,
    },
    { final_clearance: true },
  );

  assert.equal(result.completedChecks, 5);
  assert.equal(result.totalChecks, 5);
  assert.equal(result.complete, true);
});

test('rejects ambiguous checklist values', () => {
  assert.throws(
    () => buildChecklistUpdate(emptyChecklist, { medical_cert_verified: 'yes' }),
    /must be true or false/,
  );
});
