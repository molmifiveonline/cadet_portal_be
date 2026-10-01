const CHECKS = [
  'passport_verified',
  'medical_cert_verified',
  'bank_details_verified',
  'agreement_signed',
  'final_clearance',
];

const PRE_CLEARANCE_CHECKS = CHECKS.filter((key) => key !== 'final_clearance');

const parseChecklistFlag = (value, key) => {
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;
  throw new Error(`${key} must be true or false`);
};

const buildChecklistUpdate = (current, updates = {}) => {
  const next = {};
  CHECKS.forEach((key) => {
    next[key] = updates[key] === undefined
      ? parseChecklistFlag(current[key] ?? 0, key)
      : parseChecklistFlag(updates[key], key);
  });

  if (next.final_clearance && !PRE_CLEARANCE_CHECKS.every((key) => next[key] === 1)) {
    throw new Error('Complete the first four checklist items before Final Clearance');
  }

  const completedChecks = CHECKS.reduce((total, key) => total + next[key], 0);
  return {
    next,
    completedChecks,
    totalChecks: CHECKS.length,
    complete: completedChecks === CHECKS.length,
  };
};

module.exports = {
  CHECKS,
  PRE_CLEARANCE_CHECKS,
  buildChecklistUpdate,
};
