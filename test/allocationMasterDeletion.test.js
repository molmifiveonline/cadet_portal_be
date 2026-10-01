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
  ['assessment', { has_formulas: 1 }],
  ['assessment', { has_scores: 1 }],
  ['vessel', { has_allocations: 1 }],
]) {
  test(`deletion preserves ${kind} used by ${Object.keys(flags)[0]}`, async () => {
    const events = [],
      logs = [];
    const connection = {
      beginTransaction: async () => events.push('begin'),
      commit: async () => events.push('commit'),
      rollback: async () => events.push('rollback'),
      release: () => events.push('release'),
      query: async (sql) => {
        assert.ok(sql.startsWith('SELECT'), 'must not delete a linked master');
        assert.ok(sql.includes('FOR UPDATE'));
        return [
          sql.startsWith('SELECT id')
            ? [{ id: 'used', name: 'Used' }]
            : [flags],
        ];
      },
    };
    const db = { getConnection: async () => connection };
    const service = load('services/allocationMasterDeletionService.js', {
      '../config/database': db,
    });
    if (kind === 'vessel') {
      await assert.rejects(
        service.deleteUnusedVessel('used'),
        (error) => error.statusCode === 409,
      );
    } else {
      const controller = load('controllers/allocationMasterController.js', {
        '../config/database': db,
        '../services/allocationMasterDeletionService': service,
        '../dao/activityLogDao': { createLog: (...args) => logs.push(args) },
        crypto: {},
        uuid: {},
        '../services/allocationRules': {},
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
      await controller.deleteCourse(
        { params: { id: 'used' }, user: { id: 'admin' } },
        res,
      );
      assert.equal(res.code, 409);
      assert.match(res.body.message, /linked to/);
    }
    assert.deepEqual(events, ['begin', 'rollback', 'release']);
    assert.equal(logs.length, 0);
  });
}
