const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const deletionService = require('../src/services/instituteDeletionService');

function load(file, mocks) {
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'),
    {
      module,
      console: { error() {} },
      require(name) {
        if (name in mocks) return mocks[name];
        throw new Error(`Unexpected import: ${name}`);
      },
    },
  );
  return module.exports;
}

for (const [table, label] of [
  ['recruitment_drives', 'recruitment drives'],
  ['cadets', 'cadets'],
  ['institute_submissions', 'uploaded submissions'],
  ['recruitment_communications', 'communication history'],
  ['notifications', 'institute notifications'],
]) {
  test(`institute linked to ${label} cannot be deleted and no data is changed`, async () => {
    const events = [];
    const connection = {
      beginTransaction: async () => events.push('begin'),
      rollback: async () => events.push('rollback'),
      commit: async () => events.push('commit'),
      release: () => events.push('release'),
      query: async (sql) => {
        assert.ok(
          sql.startsWith('SELECT'),
          'linked institute must never reach DELETE',
        );
        if (sql.startsWith('SELECT id FROM institutes'))
          return [[{ id: 'institute' }]];
        assert.ok(sql.includes('FOR UPDATE'));
        return [[{ [`has_${table}`]: 1 }]];
      },
    };
    const dao = load('dao/instituteDao.js', {
      uuid: {},
      bcryptjs: {},
      '../config/database': { getConnection: async () => connection },
      '../services/schemaCompatibilityService': {},
      '../services/instituteDeletionService': deletionService,
    });
    await assert.rejects(
      dao.deleteInstitute('institute'),
      (error) => error.status === 409 && error.message.includes(label),
    );
    assert.deepEqual(events, ['begin', 'rollback', 'release']);
  });
}

test('institute deletion conflict is returned to the client without a deletion activity log', async () => {
  const logs = [];
  const controller = load('controllers/instituteController.js', {
    '../dao/instituteDao': {
      getInstituteById: async () => ({ institute_name: 'Used Institute' }),
      deleteInstitute: async () => {
        throw Object.assign(new Error('Linked to recruitment drives'), {
          status: 409,
        });
      },
    },
    '../dao/activityLogDao': { createLog: (...args) => logs.push(args) },
    '../config/constants': {},
    '../utils/dateUtils': {},
    '../utils/validationUtils': {},
  });
  const res = {
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await controller.deleteInstitute(
    { params: { id: 'used' }, user: { id: 'admin' } },
    res,
  );
  assert.equal(res.code, 409);
  assert.equal(res.body.message, 'Linked to recruitment drives');
  assert.deepEqual(logs, []);
});
