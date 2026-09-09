const test = require('node:test');
const assert = require('node:assert/strict');
const {
  haveAllMedicalReportsPassed,
} = require('../src/services/medicalReportStatusService');

test('confirmation allows report results only when every report passes', () => {
  assert.equal(
    haveAllMedicalReportsPassed([
      { report_id: 'one', status: 'pass' },
      { report_id: 'two', status: 'Pass' },
    ]),
    true,
  );
});

test('confirmation rejects pending, failed, empty, and invalid report results', () => {
  assert.equal(
    haveAllMedicalReportsPassed([{ report_id: 'one', status: 'pending' }]),
    false,
  );
  assert.equal(
    haveAllMedicalReportsPassed([{ report_id: 'one', status: 'fail' }]),
    false,
  );
  assert.equal(haveAllMedicalReportsPassed([]), false);
  assert.equal(haveAllMedicalReportsPassed('invalid json'), false);
});

test('confirmation supports report results returned as database JSON text', () => {
  assert.equal(
    haveAllMedicalReportsPassed(
      JSON.stringify([{ report_id: 'one', status: 'pass' }]),
    ),
    true,
  );
});
