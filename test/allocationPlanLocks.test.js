const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(options = {}) {
  const calls = [], logs = [], records = [];
  let emailCalls = 0;
  const plan = { id: 'plan-1', allocation_id: 'allocation-1', revision: 1, requires_refresh: 0,
    name_as_in_indos_cert: 'Test Cadet', cadet_unique_id: 'CTV-001', department: 'Deck',
    allocation_number: 'CTV-2026', vessel_role: 'Primary', vessel_name: 'Vessel One', email_id: null, ...options.plan };
  const connection = {
    async beginTransaction() { calls.push({ action: 'begin' }); },
    async commit() { calls.push({ action: 'commit' }); },
    async rollback() { calls.push({ action: 'rollback' }); },
    release() { calls.push({ action: 'release' }); },
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT id FROM users')) return [options.inactiveAdmin ? [] : [{ id: 'admin-1' }]];
      if (sql.includes('SELECT jp.*')) return [options.missingPlan ? [] : [plan]];
      if (sql.startsWith('SELECT a.*,rl.department')) return [[{
        id: 'allocation-1', cadet_id: 'cadet-1', department: 'Deck', list_status: 'Finalized',
        vessel_id: 'vessel-1', vessel_type_id: 'type-1', allocation_status: 'Allocated',
        secondary_vessel_id: null, secondary_vessel_type_id: null, secondary_allocation_status: 'Pending',
        ...options.allocation,
      }]];
      if (sql.startsWith('SELECT status FROM onboarding')) return [options.onboarded ? [{ status: 'Onboarded' }] : []];
      if (sql.startsWith('SELECT vessel_role FROM joining_plans')) return [options.existingPlans || []];
      if (sql.startsWith('SELECT * FROM vessels')) return [['vessel-1', 'vessel-2', 'replacement'].map(id => ({
        id, name: id, department: 'Deck', status: id === options.inactiveVessel ? 'Inactive' : 'Active', vessel_type_id: 'type-1', total_seats: 10,
        ...options.vessel,
      })).filter(vessel => params[0].includes(vessel.id))];
      if (sql.startsWith('SELECT * FROM vessel_types')) return [[{ id: 'type-1', name: 'Tanker', department: 'Deck', status: 'Active' }]];
      if (sql.includes(' AS reserved')) return [[{ reserved: options.reserved || 0 }]];
      if (sql.includes('SELECT c.name_as_in_indos_cert')) return [[plan]];
      if (sql.startsWith('INSERT INTO allocation_communications')) {
        records.push({ id: params[0], planId: params[1], revision: params[2], admin: params[3], date: params[4], mode: params[5],
          confirmed: params[6], candidateRemarks: params[7], adminRemarks: params[8], deliveryStatus: params[9], messageId: params[10], failureReason: params[11] });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE joining_plans SET status=?') && options.failUpdate) throw new Error('Database write failed');
      if (sql.startsWith('UPDATE ')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/controllers/allocationController.js'), 'utf8'), {
    module, Date, process: { env: { NODE_ENV: 'test' } }, console: { error() {} },
    require(name) {
      if (name === '../config/database') return { getConnection: async () => connection };
      if (name === 'uuid') return { v4: () => 'communication-1' };
      if (name === '../services/emailService') return { sendEmail: async () => { emailCalls++; throw new Error('No email may be sent'); } };
      if (name === '../dao/activityLogDao') return { createLog: async (...args) => logs.push(args) };
      if (name === '../services/allocationRules') return require('../src/services/allocationRules');
      if (name === '../utils/dateUtils') return require('../src/utils/dateUtils');
      if (name === '../services/allocationService') return {
        httpError: (status, message) => Object.assign(new Error(message), { status }),
        parseJson: (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } },
      };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const invoke = async (handler, body = {}) => {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await module.exports[handler]({ params: { allocationId: 'allocation-1', joiningPlanId: 'plan-1' }, body,
      user: { id: 'admin-1' }, ip: '127.0.0.1' }, res);
    return res;
  };
  return { calls, logs, records, invoke, emailCalls: () => emailCalls };
}

for (const mode of ['Email', 'Phone', 'WhatsApp']) {
  test(`${mode} confirmations are recorded without sending email, including when the cadet has no email address`, async () => {
    const harness = setup();
    const res = await harness.invoke('recordCommunication', {
      mode, date_of_informing: '2026-01-01', confirmation_received: true,
      candidate_remarks: 'Confirmed arrival', admin_remarks: 'Received outside portal',
    });
    assert.equal(res.code, 201);
    assert.equal(res.body.success, true);
    assert.equal(harness.emailCalls(), 0);
    assert.deepEqual(harness.records, [{ id: 'communication-1', planId: 'plan-1', revision: 1,
      admin: 'admin-1', date: '2026-01-01', mode, confirmed: 1, candidateRemarks: 'Confirmed arrival',
      adminRemarks: 'Received outside portal', deliveryStatus: null, messageId: null, failureReason: null }]);
    assert.equal(harness.calls.find(({ sql }) => sql?.startsWith('UPDATE joining_plans SET status=?')).params[0], 'Confirmed');
    assert.equal(harness.logs[0][1], 'RECORD_CTV_COMMUNICATION');
    assert.ok(harness.calls.some(({ action }) => action === 'commit'));
    assert.ok(!harness.calls.some(({ action }) => action === 'rollback'));
  });
}

test('an explicit No confirmation stays unconfirmed for Email', async () => {
  const harness = setup();
  const res = await harness.invoke('recordCommunication', { mode: 'Email', date_of_informing: '2026-01-01', confirmation_received: '0' });
  assert.equal(res.code, 201);
  assert.equal(harness.records[0].confirmed, 0);
  assert.equal(harness.calls.find(({ sql }) => sql?.startsWith('UPDATE joining_plans SET status=?')).params[0], 'Informed');
  assert.equal(harness.emailCalls(), 0);
});

for (const [options, code] of [[{ missingPlan: true }, 404], [{ plan: { requires_refresh: 1 } }, 409], [{ inactiveAdmin: true }, 400]]) {
  test(`unavailable plan or admin rejects recording (${JSON.stringify(options)})`, async () => {
    const harness = setup(options);
    const res = await harness.invoke('recordCommunication', { mode: 'Email', date_of_informing: '2026-01-01', confirmation_received: true });
    assert.equal(res.code, code);
    assert.equal(harness.records.length, 0);
    assert.equal(harness.emailCalls(), 0);
    assert.ok(harness.calls.some(({ action }) => action === 'rollback'));
  });
}

test('a plan update failure rolls back the communication transaction', async () => {
  const harness = setup({ failUpdate: true });
  const res = await harness.invoke('recordCommunication', { mode: 'Phone', date_of_informing: '2026-01-01', confirmation_received: true });
  assert.equal(res.code, 500);
  assert.ok(harness.calls.some(({ action }) => action === 'rollback'));
  assert.ok(!harness.calls.some(({ action }) => action === 'commit'));
  assert.equal(harness.emailCalls(), 0);
});

const assignedVessels = {
  vessel_id: 'vessel-1', vessel_type_id: 'type-1', allocation_status: 'Allocated',
  secondary_vessel_id: 'vessel-2', secondary_vessel_type_id: 'type-1', secondary_allocation_status: 'Allocated',
};

for (const role of ['Primary', 'Secondary']) {
  for (const status of ['Allocated', 'Hold']) {
    for (const total_seats of [0, null, 1]) {
      test(`${role} can be ${status} with ${total_seats} recorded seats and existing assignments`, async () => {
        const harness = setup({ vessel: { total_seats }, reserved: 100 });
        const res = await harness.invoke('updateVesselAllocation', {
          ...assignedVessels,
          [role === 'Primary' ? 'allocation_status' : 'secondary_allocation_status']: status,
        });
        assert.equal(res.code, 200);
        assert.ok(harness.calls.some(({ sql }) => sql?.startsWith('UPDATE allocations')));
        assert.ok(harness.calls.some(({ action }) => action === 'commit'));
        assert.ok(!harness.calls.some(({ sql }) => sql?.includes(' AS reserved')));
      });
    }
    test(`${role} still requires an actual vessel for ${status}`, async () => {
      const harness = setup({ vessel: { total_seats: 0 } });
      const prefix = role === 'Secondary' ? 'secondary_' : '';
      const res = await harness.invoke('updateVesselAllocation', {
        ...assignedVessels, [`${prefix}vessel_id`]: null, [`${prefix}allocation_status`]: status,
      });
      assert.equal(res.code, 400);
    });
  }
}

for (const vessel_role of ['Primary', 'Secondary']) {
  for (const requires_refresh of [0, 1]) {
    for (const changedRole of ['Primary', 'Secondary']) {
      test(`${vessel_role} plan (refresh=${requires_refresh}) locks only its own assignment when changing ${changedRole}`, async () => {
        const harness = setup({ allocation: assignedVessels, existingPlans: [{ vessel_role, requires_refresh }] });
        const body = { ...assignedVessels, [changedRole === 'Primary' ? 'vessel_id' : 'secondary_vessel_id']: 'replacement' };
        const res = await harness.invoke('updateVesselAllocation', body);
        const blocked = vessel_role === changedRole;
        assert.equal(res.code, blocked ? 409 : 200);
        assert.equal(harness.calls.some(({ action }) => action === 'rollback'), blocked);
        assert.equal(harness.calls.some(({ action }) => action === 'commit'), !blocked);
        const update = harness.calls.find(({ sql }) => sql?.startsWith('UPDATE allocations'));
        if (blocked) {
          assert.match(res.body.message, new RegExp(`${vessel_role} vessel assignment cannot change`));
          assert.ok(!update);
        } else {
          assert.deepEqual(Array.from(update.params).slice(0, 6), [
            body.vessel_type_id, body.vessel_id, body.allocation_status,
            body.secondary_vessel_type_id, body.secondary_vessel_id, body.secondary_allocation_status,
          ]);
        }
      });
    }
  }
  for (const [field, value] of [['vessel_type_id', 'other-type'], ['allocation_status', 'Cancelled'], ['vessel_id', null]]) {
    test(`${vessel_role} plan also prevents changing or clearing ${field}`, async () => {
      const harness = setup({ allocation: assignedVessels, existingPlans: [{ vessel_role }] });
      const prefix = vessel_role === 'Secondary' ? 'secondary_' : '';
      const res = await harness.invoke('updateVesselAllocation', { ...assignedVessels, [`${prefix}${field}`]: value });
      assert.equal(res.code, 409);
      assert.ok(!harness.calls.some(({ sql }) => sql?.startsWith('UPDATE ')));
    });
  }
}

test('an unassigned secondary vessel can be allocated while primary has a plan', async () => {
  const harness = setup({ existingPlans: [{ vessel_role: 'Primary' }] });
  const res = await harness.invoke('updateVesselAllocation', assignedVessels);
  assert.equal(res.code, 200);
});

test('a planned vessel becoming inactive does not block changes to the other vessel', async () => {
  const harness = setup({ existingPlans: [{ vessel_role: 'Primary' }], inactiveVessel: 'vessel-1' });
  const res = await harness.invoke('updateVesselAllocation', assignedVessels);
  assert.equal(res.code, 200);
});

test('an inactive replacement vessel is still rejected', async () => {
  const harness = setup({ existingPlans: [{ vessel_role: 'Primary' }], inactiveVessel: 'vessel-2' });
  const res = await harness.invoke('updateVesselAllocation', assignedVessels);
  assert.equal(res.code, 400);
});

test('both assignments stay locked once both plans exist', async () => {
  const harness = setup({ allocation: assignedVessels, existingPlans: [{ vessel_role: 'Primary' }, { vessel_role: 'Secondary' }] });
  const res = await harness.invoke('updateVesselAllocation', { ...assignedVessels, secondary_vessel_id: 'replacement' });
  assert.equal(res.code, 409);
});

test('onboarded allocations remain locked without plans', async () => {
  const harness = setup({ onboarded: true });
  const res = await harness.invoke('updateVesselAllocation', assignedVessels);
  assert.equal(res.code, 409);
});

test('vessel assignment remains editable before any joining plan exists', async () => {
  const harness = setup();
  const res = await harness.invoke('updateVesselAllocation', { vessel_id: 'vessel-1', vessel_type_id: 'type-1', allocation_status: 'Allocated' });
  assert.equal(res.code, 200);
  assert.ok(harness.calls.some(({ sql }) => sql?.startsWith('UPDATE allocations')));
  assert.ok(harness.calls.some(({ action }) => action === 'commit'));
});
