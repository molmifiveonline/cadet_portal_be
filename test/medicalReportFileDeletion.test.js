const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(file, mocks) {
  const module = { exports: {} };
  const filename = path.join(__dirname, '../src', file);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    __dirname: path.dirname(filename),
    console: { error() {} },
    require(name) {
      return mocks[name] || {};
    },
  });
  return module.exports;
}

for (const found of [true, false]) {
  test(`file deletion is scoped to the cadet (${found ? 'matching' : 'missing'} file)`, async () => {
    const calls = [];
    const dao = load('dao/cadetMedicalResultsDao.js', {
      '../config/database': {
        query: async (sql, params) => {
          calls.push(sql);
          assert.deepEqual(Array.from(params), ['file-1', 'cadet-1']);
          assert.match(sql, /r\.cadet_id = \?/);
          assert.match(sql, /f\.id = \?/);
          return sql.trim().startsWith('SELECT')
            ? [found ? [{ id: 'file-1', file_path: '/uploads/report.pdf' }] : []]
            : [{ affectedRows: 1 }];
        },
      },
    });
    const result = await dao.deleteMedicalReportFile('cadet-1', 'file-1');
    assert.equal(result?.id || null, found ? 'file-1' : null);
    assert.equal(calls.length, found ? 2 : 1);
  });
}

for (const scenario of ['success', 'missing', 'database failure', 'missing disk file', 'unsafe path']) {
  test(`delete report controller: ${scenario}`, async () => {
    const removed = [];
    const logs = [];
    const controller = load('controllers/medicalController.js', {
      path,
      fs: { promises: { unlink: async (filename) => {
        removed.push(filename);
        if (scenario === 'missing disk file') throw Object.assign(new Error(), { code: 'ENOENT' });
      } } },
      '../dao/cadetMedicalResultsDao': {
        deleteMedicalReportFile: async (cadetId, fileId) => {
          assert.equal(cadetId, 'cadet-1');
          assert.equal(fileId, 'file-1');
          if (scenario === 'database failure') throw new Error('database unavailable');
          return scenario === 'missing' ? null : {
            file_name: 'report.pdf',
            file_path: scenario === 'unsafe path' ? '/uploads/../secret.pdf' : '/uploads/report.pdf',
          };
        },
      },
      '../dao/activityLogDao': { createLog: async (...args) => logs.push(args) },
    });
    const res = {
      status(code) { this.code = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await controller.deleteMedicalReportFile({
      params: { cadet_id: 'cadet-1', file_id: 'file-1' },
      user: { id: 'admin' },
      ip: '127.0.0.1',
    }, res);
    const failed = ['missing', 'database failure'].includes(scenario);
    assert.equal(res.code, scenario === 'missing' ? 404 : scenario === 'database failure' ? 500 : 200);
    assert.equal(res.body.success, !failed);
    assert.equal(logs.length, failed ? 0 : 1);
    assert.equal(removed.length, failed || scenario === 'unsafe path' ? 0 : 1);
    if (removed.length) assert.equal(removed[0], path.join(__dirname, '../uploads/report.pdf'));
  });
}

test('report deletion route authenticates and blocks institute users', () => {
  const routes = [];
  const auth = () => {};
  const { blockInstitute } = load('middleware/instituteOwnershipMiddleware.js', {
    '../config/constants': { ROLES: { INSTITUTE: 'institute' } },
  });
  const handler = () => {};
  load('routes/medicalRoutes.js', {
    express: { Router: () => ({
      delete: (...args) => routes.push(args), post() {}, get() {},
    }) },
    '../controllers/medicalController': { deleteMedicalReportFile: handler },
    '../middleware/authMiddleware': { authMiddleware: auth },
    '../middleware/instituteOwnershipMiddleware': {
      blockInstitute, requireInstituteCadetOwnership: () => () => {},
    },
    '../middleware/uploadMiddleware': { array: () => () => {} },
  });
  const [url, authenticate, authorize, remove] = routes[0];
  assert.equal(url, '/:cadet_id/files/:file_id');
  assert.equal(authenticate, auth);
  assert.equal(remove, handler);
  let continued = false;
  const res = { status(code) { this.code = code; return this; }, json() {} };
  authorize({ user: { role: 'institute' } }, res, () => { continued = true; });
  assert.equal(res.code, 403);
  assert.equal(continued, false);
  authorize({ user: { role: 'admin' } }, res, () => { continued = true; });
  assert.equal(continued, true);
});
