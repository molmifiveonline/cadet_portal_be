const roundScore = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const normalizeDepartment = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized.includes('deck')) return 'Deck';
  if (normalized.includes('engine')) return 'Engine';
  return null;
};

const validateFormula = ({ academic_weight, components = [] }) => {
  const academicWeight = Number(academic_weight);
  if (!Number.isFinite(academicWeight) || academicWeight < 0 || academicWeight > 100) {
    throw new Error('Academic weight must be between 0 and 100');
  }
  if (!components.length) throw new Error('At least one assessment course is required');

  const seen = new Set();
  let total = academicWeight;
  components.forEach((component) => {
    const courseId = String(component.course_id || '');
    const weight = Number(component.weight);
    const maxScore = Number(component.max_score);
    if (!courseId || seen.has(courseId)) throw new Error('Formula courses must be unique');
    if (!Number.isFinite(weight) || weight <= 0 || weight > 100) {
      throw new Error('Every course weight must be greater than 0 and at most 100');
    }
    if (!Number.isFinite(maxScore) || maxScore <= 0) {
      throw new Error('Every course maximum score must be greater than 0');
    }
    seen.add(courseId);
    total += weight;
  });

  if (Math.abs(total - 100) > 0.001) throw new Error('Academic and course weights must total 100');
  return true;
};

const calculateFinalScore = (academicScore, components = []) => {
  const academic = Number(academicScore);
  if (!Number.isFinite(academic) || academic < 0 || academic > 100) return null;
  if (!components.length || components.some((component) => component.score === null || component.score === undefined || component.score === '')) {
    return null;
  }

  let result = academic * Number(components[0].academic_weight || 0) / 100;
  for (const component of components) {
    const score = Number(component.score);
    const max = Number(component.max_score_snapshot ?? component.max_score);
    const weight = Number(component.weight_snapshot ?? component.weight);
    if (!Number.isFinite(score) || !Number.isFinite(max) || !Number.isFinite(weight) || max <= 0 || score < 0 || score > max) {
      throw new Error(`Score for ${component.course_name_snapshot || 'course'} must be between 0 and ${max}`);
    }
    result += (score / max) * weight;
  }
  return roundScore(result);
};

const calculateSimpleTotal = (academicScore, components = []) => {
  const academic = Number(academicScore);
  if (!Number.isFinite(academic) || academic < 0 || academic > 100) return null;
  if (!components.length || components.some((component) => component.score === null || component.score === undefined || component.score === '')) return null;
  let total = academic;
  for (const component of components) {
    const score = Number(component.score);
    const max = Number(component.max_score_snapshot ?? component.max_score ?? 100);
    if (!Number.isFinite(score) || score < 0 || score > max) {
      throw new Error(`Score for ${component.course_name_snapshot || 'assessment type'} must be between 0 and ${max}`);
    }
    total += score;
  }
  return roundScore(total);
};

const sortAutoRank = (rows = []) => [...rows].sort((left, right) => {
  const finalDifference = Number(right.final_score) - Number(left.final_score);
  if (finalDifference) return finalDifference;
  const academicDifference = Number(right.academic_score) - Number(left.academic_score);
  if (academicDifference) return academicDifference;
  return String(left.cadet_unique_id || left.cadet_id).localeCompare(String(right.cadet_unique_id || right.cadet_id));
});

const hasAllocatedVessel = ({ primaryVesselId, primaryStatus, secondaryVesselId, secondaryStatus }) => (
  (Boolean(primaryVesselId) && primaryStatus === 'Allocated')
  || (Boolean(secondaryVesselId) && secondaryStatus === 'Allocated')
);

const createRankMovePlan = (currentRankValue, targetRankValue, totalRankedValue) => {
  const currentRank = Number(currentRankValue);
  const targetRank = Number(targetRankValue);
  const totalRanked = Number(totalRankedValue);
  if (!Number.isInteger(currentRank) || !Number.isInteger(targetRank) || !Number.isInteger(totalRanked)) throw new Error('Ranks must be whole numbers');
  if (targetRank < 1 || targetRank > totalRanked) throw new Error(`Target rank must be between 1 and ${totalRanked}`);
  if (targetRank === currentRank) throw new Error('Select a different target rank');
  return targetRank < currentRank
    ? { currentRank, targetRank, historyAction: 'MoveUp', shiftDelta: 1, rangeStart: targetRank, rangeEnd: currentRank - 1 }
    : { currentRank, targetRank, historyAction: 'MoveDown', shiftDelta: -1, rangeStart: currentRank + 1, rangeEnd: targetRank };
};

module.exports = {
  roundScore,
  normalizeDepartment,
  validateFormula,
  calculateFinalScore,
  calculateSimpleTotal,
  sortAutoRank,
  hasAllocatedVessel,
  createRankMovePlan,
};
