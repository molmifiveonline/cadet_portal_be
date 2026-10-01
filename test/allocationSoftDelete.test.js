const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const rules = require('../src/services/allocationRules');

function load(file, mocks) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    module, Date, process: { env: {} }, console: { error() {} },
    require(name) { if (name in mocks) return mocks[name]; throw new Error(`Unexpected import ${name}`); },
  });
  return module.exports;
}

function setup(options = {}) {
  let cycle = { id: 'cycle', allocation_number: 'CTV-TEST', department: 'Deck', status: 'Active', deleted_at: options.disabled ? '2026-10-01T04:00:00Z' : null };
  let before;
  const calls = [], logs = [];
  const connection = {
    async beginTransaction() { calls.push('begin'); before = { ...cycle }; },
    async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); cycle = before || cycle; },
    release() { calls.push('release'); },
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT id,allocation_number')) return [options.missing ? [] : [{ ...cycle }]];
      if (sql.startsWith('SELECT department')) return [options.finalized ? [{ department: 'Deck' }] : []];
      if (sql.startsWith('SELECT jp.id')) return [options.hasPlan ? [{ id: 'plan' }] : []];
      if (sql.startsWith('SELECT o.id')) return [options.hasOnboarding ? [{ id: 'onboarding' }] : []];
      if (sql.startsWith('UPDATE allocation_cycles')) {
        cycle = { ...cycle, deleted_at: '2026-10-01T04:00:00Z', deleted_by: values[0], delete_reason: values[1] };
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT id FROM users')) return [[{ id: 'admin' }]];
      if (/^SELECT (a\.|rl\.\*|jp\.\*|o\.\*)/.test(sql)) return [[{ id: 'entity', rank_list_id: 'list', status: 'Draft', list_status: 'Draft', formula_snapshot: {}, cycle_deleted_at: cycle.deleted_at }]];
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const db = { getConnection: async () => connection, query: connection.query };
  const service = load('services/allocationService.js', {
    '../config/database': db, uuid: { v4: () => 'uuid' }, './allocationRules': rules,
    './allocationCycleService': { createCycle() {} },
  });
  const activity = { createLog: async (...args) => { if (options.failLog) throw new Error('audit failed'); logs.push(args); } };
  const controller = load('controllers/allocationController.js', {
    '../config/database': db, uuid: { v4: () => 'uuid' }, '../dao/activityLogDao': activity,
    '../services/allocationRules': rules, '../services/allocationService': service,
    '../utils/dateUtils': require('../src/utils/dateUtils'),
  });
  const onboarding = load('controllers/onboardingController.js', {
    '../config/database': db, '../dao/activityLogDao': activity, '../services/allocationRules': rules,
    '../services/onboardingRules': require('../src/services/onboardingRules'),
  });
  return { calls, logs, cycle: () => cycle,
    async invoke(name, body = { reason: 'Allocation entered by mistake' }) {
      const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
      await (controller[name] || onboarding[name])({ params: { id: 'cycle', allocationId: 'allocation', rankListId: 'list', joiningPlanId: 'plan' }, body, query: {}, user: { id: 'admin' }, ip: 'local' }, res);
      return res;
    },
  };
}

test('disabling updates only the parent and saves who, when and why in one transaction', async () => {
  const harness = setup();
  const result = await harness.invoke('deleteCycle');
  assert.equal(result.code, 200);
  assert.equal(harness.cycle().deleted_by, 'admin');
  assert.equal(harness.cycle().delete_reason, 'Allocation entered by mistake');
  assert.ok(harness.cycle().deleted_at);
  assert.equal(harness.cycle().status, 'Active');
  const writes = harness.calls.filter(call => call.sql && /^(UPDATE|DELETE|INSERT)/.test(call.sql));
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /^UPDATE allocation_cycles/);
  assert.equal(harness.logs[0][1], 'DISABLE_CTV_ALLOCATION');
  assert.ok(harness.calls.includes('commit'));
});

for (const [options, code] of [[{ finalized: true }, 409], [{ hasPlan: true }, 409], [{ hasOnboarding: true }, 409], [{ disabled: true }, 409], [{ missing: true }, 404]]) {
  test(`disabling is blocked for ${JSON.stringify(options)}`, async () => {
    const harness = setup(options);
    assert.equal((await harness.invoke('deleteCycle')).code, code);
    assert.equal(harness.logs.length, 0);
    assert.ok(!harness.calls.some(call => call.sql?.startsWith('UPDATE')));
  });
}

test('disabling requires a meaningful bounded reason', async () => {
  for (const reason of [undefined, '', '   ', 'x'.repeat(1001)]) {
    const harness = setup();
    assert.equal((await harness.invoke('deleteCycle', { reason })).code, 400);
    assert.equal(harness.cycle().deleted_at, null);
  }
});

test('an audit failure rolls back disabling', async () => {
  const harness = setup({ failLog: true });
  assert.equal((await harness.invoke('deleteCycle')).code, 500);
  assert.equal(harness.cycle().deleted_at, null);
  assert.ok(harness.calls.includes('rollback'));
});

for (const [name, body] of [
  ['addCandidates', { cadet_ids: ['cadet'] }], ['removeCandidate', {}], ['updateScores', { scores: [] }],
  ['updateVesselAllocation', {}], ['moveRank', { direction: 'up', remarks: 'Review' }],
  ['resetRanks', { remarks: 'Review' }], ['finalizeRankList', {}], ['unlockRankList', { remarks: 'Review' }],
  ['createJoiningPlan', {}], ['recordCommunication', { mode: 'Phone', date_of_informing: '2026-01-01' }], ['updateChecklist', {}],
]) {
  test(`disabled allocations reject ${name}, including direct API calls`, async () => {
    const harness = setup({ disabled: true });
    const result = await harness.invoke(name, body);
    assert.equal(result.code, 409, JSON.stringify(result.body));
    assert.match(result.body.message, /disabled/);
    assert.equal(harness.logs.length, 0);
    assert.ok(!harness.calls.some(call => call.sql && /^(UPDATE|DELETE|INSERT)/.test(call.sql)));
  });
}
