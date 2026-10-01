const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePassingOutYear,
  normalizeMySqlDateTime,
  normalizeCadetDatabaseValues,
} = require('../src/utils/cadetDataUtils');

test('normalizes an empty passing out year to null', () => {
  assert.deepEqual(normalizeCadetDatabaseValues({ passing_out_date: '' }), {
    passing_out_date: null,
  });
});

test('normalizes a four-digit passing out year', () => {
  assert.equal(normalizePassingOutYear('2027'), 2027);
});

test('extracts the year from a legacy date-form value', () => {
  assert.equal(normalizePassingOutYear('2027-06-01'), 2027);
});

test('rejects an invalid passing out year', () => {
  assert.throws(
    () => normalizePassingOutYear('not-a-year'),
    /Passing Out Year must be a valid four-digit year/,
  );
});

test('normalizes ISO cadet timestamps to Date objects for mysql2', () => {
  const normalized = normalizeCadetDatabaseValues({
    workflow_updated_at: '2026-09-11T07:00:34.000Z',
    shortlisted_at: '2026-06-24T06:48:24.000Z',
    selected_at: '2026-08-12T12:52:00.000Z',
  });

  assert.equal(
    normalized.workflow_updated_at.toISOString(),
    '2026-09-11T07:00:34.000Z',
  );
  assert.equal(
    normalized.shortlisted_at.toISOString(),
    '2026-06-24T06:48:24.000Z',
  );
  assert.equal(
    normalized.selected_at.toISOString(),
    '2026-08-12T12:52:00.000Z',
  );
});

test('normalizes an empty cadet timestamp to null', () => {
  assert.equal(normalizeMySqlDateTime('', 'workflow_updated_at'), null);
});

test('rejects an invalid cadet timestamp', () => {
  assert.throws(
    () => normalizeMySqlDateTime('not-a-date', 'workflow_updated_at'),
    /workflow_updated_at must be a valid date and time/,
  );
});
