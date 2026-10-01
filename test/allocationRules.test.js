const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateFinalScore,
  calculateAcademicAssessmentAverage,
  createDirectionalRankMovePlan,
  createRankMovePlan,
  hasAllocatedVessel,
  isDepartmentCompatible,
  normalizeDepartment,
  sortAutoRank,
  validateFormula,
} = require('../src/services/allocationRules');

test('weighted formula normalizes course scores and rounds to two decimals', () => {
  const result = calculateFinalScore(80, [
    { academic_weight: 40, score: 45, max_score_snapshot: 50, weight_snapshot: 30 },
    { academic_weight: 40, score: 25, max_score_snapshot: 50, weight_snapshot: 30 },
  ]);
  assert.equal(result, 74);
});

test('incomplete assessment returns no final score', () => {
  assert.equal(calculateFinalScore(80, [
    { academic_weight: 40, score: null, max_score_snapshot: 100, weight_snapshot: 60 },
  ]), null);
});

test('assessment scoring averages normalized assessments with academics', () => {
  assert.equal(calculateAcademicAssessmentAverage(80, [
    { score: 8, max_score_snapshot: 10 },
    { score: 6, max_score_snapshot: 10 },
  ]), 75);
});

test('100-point assessment scoring preserves the previous final score', () => {
  assert.equal(calculateAcademicAssessmentAverage(80, [
    { score: 80, max_score_snapshot: 100 },
    { score: 60, max_score_snapshot: 100 },
  ]), 75);
  assert.equal(calculateAcademicAssessmentAverage(74, [{ score: 70, max_score_snapshot: 100 }]), 72);
  assert.equal(calculateAcademicAssessmentAverage(80, [{ score: 0, max_score_snapshot: 100 }]), 40);
  assert.equal(calculateAcademicAssessmentAverage(80, [{ score: 100, max_score_snapshot: 100 }]), 90);
  assert.throws(() => calculateAcademicAssessmentAverage(80, [{ score: 100.01, max_score_snapshot: 100 }]), /between 0 and 100/);
});

test('assessment average formula stays incomplete until every entered score is present', () => {
  assert.equal(calculateAcademicAssessmentAverage(80, [
    { score: 8, max_score_snapshot: 10 },
    { score: null, max_score_snapshot: 10 },
  ]), null);
});

test('assessment average formula rejects a score above the course maximum', () => {
  assert.throws(() => calculateAcademicAssessmentAverage(80, [
    { score: 11, max_score_snapshot: 10, course_name_snapshot: 'Navigation' },
  ]), /between 0 and 10/);
});

test('out-of-range assessment score is rejected', () => {
  assert.throws(() => calculateFinalScore(80, [
    { academic_weight: 40, score: 101, max_score_snapshot: 100, weight_snapshot: 60, course_name_snapshot: 'Safety' },
  ]), /between 0 and 100/);
});

test('formula weights must total exactly 100', () => {
  assert.throws(() => validateFormula({
    academic_weight: 50,
    components: [{ course_id: 'course-1', weight: 40, max_score: 100 }],
  }), /total 100/);
});

test('automatic ranking uses final score, academic score, then candidate ID', () => {
  const sorted = sortAutoRank([
    { cadet_unique_id: 'C-003', final_score: 85, academic_score: 80 },
    { cadet_unique_id: 'C-002', final_score: 85, academic_score: 82 },
    { cadet_unique_id: 'C-001', final_score: 85, academic_score: 82 },
    { cadet_unique_id: 'C-004', final_score: 90, academic_score: 70 },
  ]);
  assert.deepEqual(sorted.map((item) => item.cadet_unique_id), ['C-004', 'C-001', 'C-002', 'C-003']);
});

test('department normalization accepts imported course labels', () => {
  assert.equal(normalizeDepartment('B.Sc Nautical - Deck'), 'Deck');
  assert.equal(normalizeDepartment('Marine Engine Cadet'), 'Engine');
  assert.equal(normalizeDepartment('General'), null);
});

test('vessel compatibility allows the exact department and Both only', () => {
  assert.equal(isDepartmentCompatible('Deck', 'Deck'), true);
  assert.equal(isDepartmentCompatible('Deck', 'Both'), true);
  assert.equal(isDepartmentCompatible('Deck', 'Engine'), false);
  assert.equal(isDepartmentCompatible('Engine', 'Engine'), true);
  assert.equal(isDepartmentCompatible('Engine', 'Both'), true);
  assert.equal(isDepartmentCompatible('Engine', 'Deck'), false);
});

test('finalization accepts Primary only, Secondary only, or both vessel allocations', () => {
  assert.equal(hasAllocatedVessel({ primaryVesselId: 'p1', primaryStatus: 'Allocated' }), true);
  assert.equal(hasAllocatedVessel({ secondaryVesselId: 's1', secondaryStatus: 'Allocated' }), true);
  assert.equal(hasAllocatedVessel({ primaryVesselId: 'p1', primaryStatus: 'Allocated', secondaryVesselId: 's1', secondaryStatus: 'Allocated' }), true);
  assert.equal(hasAllocatedVessel({ primaryVesselId: 'p1', primaryStatus: 'Pending', secondaryVesselId: 's1', secondaryStatus: 'Hold' }), false);
});

test('direct rank reorder shifts every rank between the old and new positions once', () => {
  assert.deepEqual(createRankMovePlan(1, 4, 5), {
    currentRank: 1,
    targetRank: 4,
    historyAction: 'MoveDown',
    shiftDelta: -1,
    rangeStart: 2,
    rangeEnd: 4,
  });
  assert.deepEqual(createRankMovePlan(4, 1, 5), {
    currentRank: 4,
    targetRank: 1,
    historyAction: 'MoveUp',
    shiftDelta: 1,
    rangeStart: 1,
    rangeEnd: 3,
  });
  assert.throws(() => createRankMovePlan(2, 2, 5), /different target rank/);
});

test('directional rank movement supports multi-position moves and rejects the wrong direction', () => {
  assert.deepEqual(createDirectionalRankMovePlan(9, 5, 15, 'up'), {
    currentRank: 9,
    targetRank: 5,
    historyAction: 'MoveUp',
    shiftDelta: 1,
    rangeStart: 5,
    rangeEnd: 8,
  });
  assert.deepEqual(createDirectionalRankMovePlan(5, 9, 15, 'down'), {
    currentRank: 5,
    targetRank: 9,
    historyAction: 'MoveDown',
    shiftDelta: -1,
    rangeStart: 6,
    rangeEnd: 9,
  });
  assert.throws(
    () => createDirectionalRankMovePlan(9, 5, 15, 'down'),
    /does not move the candidate down/,
  );
});
