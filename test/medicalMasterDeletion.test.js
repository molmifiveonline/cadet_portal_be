const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(file, mocks) {
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'),
    {
      module,
      console: { error() {} },
      process: { env: {} },
      require(name) {
        if (name in mocks) return mocks[name];
        throw new Error(`Unexpected import: ${name}`);
      },
    },
  );
  return module.exports;
}

for (const [kind, flags] of [
  ['center', { has_cadet_medicals: 1 }],
  ['report', { has_centers: 1 }],
  ['report', { has_cadet_medicals: 1 }],
]) {
  test(`linked ${kind} is preserved for ${Object.keys(flags)[0]}`, async () => {
    const events = [];
    const connection = {
      beginTransaction: async () => events.push('begin'),
      commit: async () => events.push('commit'),
      rollback: async () => events.push('rollback'),
      release: () => events.push('release'),
      query: async (sql) => {
        assert.ok(sql.startsWith('SELECT'), 'must not delete linked records');
        assert.ok(sql.includes('FOR UPDATE'));
        return [sql.startsWith('SELECT id ') ? [{ id: 'used' }] : [flags]];
      },
    };
    const service = load('services/medicalMasterDeletionService.js', {
      '../config/database': { getConnection: async () => connection },
    });
    await assert.rejects(
      service.deleteUnusedMedicalMaster(kind, 'used'),
      (error) =>
        error.statusCode === 409 && error.message.includes('linked to'),
    );
    assert.deepEqual(events, ['begin', 'rollback', 'release']);
  });
}

for (const kind of ['Center', 'Report']) {
  test(`medical ${kind.toLowerCase()} deletion conflict reaches HTTP 409 without logging a deletion`, async () => {
    const logs = [];
    const error = Object.assign(
      new Error('Cannot delete because linked records exist.'),
      { statusCode: 409 },
    );
    const controller = load(`controllers/medical${kind}Controller.js`, {
      [`../dao/medical${kind}Dao`]: {
        [`getMedical${kind}ById`]: async () => ({ id: 'used' }),
        [`deleteMedical${kind}`]: async () => {
          throw error;
        },
      },
      '../dao/activityLogDao': { createLog: (...args) => logs.push(args) },
      '../config/constants': {},
      '../utils/validationUtils': {},
    });
    const errorHandler = load('middleware/errorHandler.js', {});
    const request = { params: { id: 'used' }, user: { id: 'admin' } };
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
    await controller[`deleteMedical${kind}`](request, res, (error) =>
      errorHandler(error, request, res, () => {}),
    );
    assert.equal(res.code, 409);
    assert.equal(res.body.message, error.message);
    assert.equal(logs.length, 0);
  });
}
