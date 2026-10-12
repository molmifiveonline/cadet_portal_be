const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
function setup({
  disabled = false,
  onboarded = false,
  owner = 'owner',
  role = 'Followup',
  grant = false,
  version = 2,
} = {}) {
  const calls = [],
    user = { id: 'owner', role, status: 'active', email: 'owner@example.test' };
  const allocation = {
    id: 'allocation',
    cadet_id: 'cadet',
    is_active: 1,
    follow_up_user_id: owner,
    cycle_deleted_at: disabled ? '2026-10-01' : null,
    onboarding_status: onboarded ? 'Onboarded' : 'Pending',
    primary_plan_version: version,
    vessel_id: 'vessel',
    allocation_status: 'Allocated',
  };
  const plan = {
    id: 'plan',
    allocation_id: 'allocation',
    vessel_role: 'Primary',
    vessel_id: 'vessel',
    revision: version,
    requires_refresh: 0,
  };
  const c = {
    beginTransaction: async () => calls.push('begin'),
    commit: async () => calls.push('commit'),
    rollback: async () => calls.push('rollback'),
    release: () => {},
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT id,email')) return [[user]];
      if (sql.startsWith('SELECT a.*')) return [[allocation]];
      if (sql.startsWith('SELECT allocation_id')) return [[{ allocation_id: 'allocation' }]];
      if (sql.startsWith('SELECT * FROM joining_plans')) return [[plan]];
      if (sql.startsWith('SELECT id FROM users')) return [[{ id: params[0] }]];
      if (sql.startsWith('SELECT id FROM joining_email_attempts')) return [[]];
      return [{ affectedRows: 1 }];
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../src/services/joiningWorkflowService.js'), 'utf8'),
    {
      module,
      Intl,
      Date,
      require(name) {
        if (name === '../config/database') return {};
        if (name === 'uuid') return { v4: () => 'new-id' };
        if (name === './emailService')
          return {
            sendEmail: async () => {
              throw Error('No email allowed');
            },
          };
        if (name === '../dao/rolePermissionDao' || name === '../dao/activityLogDao') return {};
        if (name === './allocationRules') return require('../src/services/allocationRules');
        if (name === '../utils/emailUtils') return require('../src/utils/emailUtils');
        if (name === '../utils/dateUtils') return require('../src/utils/dateUtils');
        throw Error(name);
      },
    },
  );
  const workflow = module.exports.createJoiningWorkflow({
    database: { query: c.query, getConnection: async () => c },
    permission: async () => grant,
    log: async () => {},
  });
  return {
    workflow,
    user,
    allocation,
    calls,
    body: {
      mode: 'Phone',
      informed_by: 'owner',
      date_of_informing: '2026-01-01',
      confirmation_received: true,
      expected_revision: version,
    },
  };
}
test('assigned users can edit their cadet but cannot send or assign without the new permissions', async () => {
  const h = setup(),
    u = await h.workflow.actor(h.user),
    abilities = h.workflow.abilities(u, h.allocation);
  assert.equal(abilities.can_view, true);
  assert.equal(abilities.can_edit, true);
  assert.equal(abilities.can_follow, true);
  assert.equal(abilities.can_send, false);
  assert.equal(abilities.can_assign, false);
  assert.equal(h.workflow.abilities(u, { ...h.allocation, follow_up_user_id: 'another' }).can_edit, false);
});
for (const mode of ['Email', 'Phone', 'WhatsApp'])
  test(`${mode} contact records confirmation and the actual recorder without sending email`, async () => {
    const h = setup();
    const result = await h.workflow.record(h.user, 'plan', { ...h.body, mode });
    assert.equal(result.delivery_status, null);
    const write = h.calls.find((x) => x.sql?.includes('INSERT INTO allocation_communications'));
    assert.ok(write);
    assert.equal(write.params[4], 'owner');
    assert.equal(write.params[6], mode);
    assert.ok(h.calls.includes('commit'));
  });
for (const config of [{ disabled: true }, { onboarded: true }, { owner: 'another' }])
  test(`workflow writes reject ${JSON.stringify(config)}`, async () => {
    const h = setup(config);
    await assert.rejects(h.workflow.record(h.user, 'plan', h.body), (e) => [403, 409].includes(e.status));
    assert.equal(h.calls.filter((x) => x.sql?.startsWith('INSERT')).length, 0);
  });
test('stale contact revisions and invalid attribution are rejected before any insert', async () => {
  for (const change of [
    { expected_revision: 1 },
    { informed_by: 'another' },
    { date_of_informing: '2026-02-30' },
  ]) {
    const h = setup();
    await assert.rejects(h.workflow.record(h.user, 'plan', { ...h.body, ...change }), (e) =>
      [400, 403, 409].includes(e.status),
    );
    assert.equal(h.calls.filter((x) => x.sql?.startsWith('INSERT')).length, 0);
  }
});
test('saving requires the current per-role version before it can update a vessel', async () => {
  const h = setup();
  await assert.rejects(
    h.workflow.save(h.user, 'allocation', { vessel_role: 'Primary', expected_version: 1 }),
    (e) => e.status === 409,
  );
  assert.equal(h.calls.filter((x) => x.sql?.startsWith('UPDATE')).length, 0);
});
