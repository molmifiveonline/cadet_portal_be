const normalizeOptionalScore = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return value;
};

const getEffectiveCesScore = (attempt1, attempt2) => {
  const normalizedAttempt2 = normalizeOptionalScore(attempt2);
  const selectedAttempt = normalizedAttempt2 === null ? attempt1 : normalizedAttempt2;
  const score = Number.parseFloat(selectedAttempt);
  return Number.isFinite(score) ? score : 0;
};

module.exports = {
  getEffectiveCesScore,
  normalizeOptionalScore,
};
