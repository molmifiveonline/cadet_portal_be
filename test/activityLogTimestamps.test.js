const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { unixTimestampToIso } = require('../src/utils/dateUtils');

test('database epoch timestamps produce an unambiguous UTC instant', () => {
  assert.equal(unixTimestampToIso(1790752784), '2026-09-30T07:19:44.000Z');
  assert.equal(unixTimestampToIso('1790752784.123'), '2026-09-30T07:19:44.123Z');
  assert.equal(unixTimestampToIso(0), '1970-01-01T00:00:00.000Z');
  for (const value of [null, undefined, '', 'invalid']) assert.equal(unixTimestampToIso(value), null);
});

test('activity API returns the database instant while preserving search, sorting and pagination', async () => {
  const calls = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/dao/activityLogDao.js'), 'utf8'), {
    module, console,
    require(name) {
      if (name === '../config/database') return {
        query: async (sql, params) => {
          calls.push({ sql, params });
          return [[{ id: 'log-1', action: 'TEST', details: 'Updated vessel', created_at: '1790752784.000' }]];
        },
      };
      if (name === 'uuid') return { v4: () => 'log-id' };
      if (name === '../config/constants') return { ACTIVITY_LOG_RETENTION_MONTHS: 3 };
      if (name === '../utils/dateUtils') return require('../src/utils/dateUtils');
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const logs = await module.exports.getLogsLast3Months(10, 20, 'vessel', 'created_at', 'ASC');
  assert.equal(logs[0].created_at, '2026-09-30T07:19:44.000Z');
  assert.equal(logs[0].details, 'Updated vessel');
  assert.match(calls[0].sql, /UNIX_TIMESTAMP\(al.created_at\) AS created_at/);
  assert.match(calls[0].sql, /ORDER BY al.created_at ASC/);
  assert.deepEqual(Array.from(calls[0].params).slice(-2), [10, 20]);
  assert.equal(calls[0].params[0], '%vessel%');
});
