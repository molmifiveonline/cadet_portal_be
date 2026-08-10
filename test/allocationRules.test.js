const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateFinalScore,
  calculateSimpleTotal,
  createRankMovePlan,
  hasAllocatedVessel,
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

test('simple assessment scoring adds academic and manually entered scores', () => {
  assert.equal(calculateSimpleTotal(80, [
    { score: 10, max_score_snapshot: 20 },
    { score: 15, max_score_snapshot: 25 },
  ]), 105);
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
