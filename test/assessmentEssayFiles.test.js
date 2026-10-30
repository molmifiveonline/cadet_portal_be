const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');

function load(relativePath, mocks) {
  const filename = path.join(__dirname, '../src', relativePath);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, __dirname: path.dirname(filename),
    console: { error() {} },
    require(name) {
      if (name in mocks) return mocks[name];
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return module.exports;
}

function controllerWith(dao, fileSystem = fs) {
  return load('controllers/assessmentController.js', {
    fs: fileSystem, path,
    '../dao/assessmentDao': dao,
    '../dao/activityLogDao': { createLog: async () => {} },
    '../dao/cadetDao': { getCadetById: async () => ({ name_as_in_indos_cert: 'Test cadet' }) },
    '../services/recruitmentWorkflowService': {},
    '../services/assessmentScoreService': require('../src/services/assessmentScoreService'),
  });
}

function daoWith(db) {
  return load('dao/assessmentDao.js', {
    '../config/database': db,
    uuid: { v4: () => 'assessment-1' },
    '../services/schemaCompatibilityService': {
      filterExistingColumns: async (_table, data) => Object.fromEntries(
        Object.entries(data).filter(([, value]) => value !== undefined),
      ),
    },
    '../services/assessmentScoreService': require('../src/services/assessmentScoreService'),
  });
}

test('essay lookup includes disk-backed records and omits binary contents from assessment JSON', async () => {
  for (const row of [
    { essay_name: 'stored.pdf', essay_data: null },
    { essay_name: null, essay_data: Buffer.from('legacy document') },
    { essay_name: null, essay_data: null },
  ]) {
    const dao = daoWith({ query: async (_sql, values) => {
      assert.equal(values[0], 'cadet-1');
      return [[{ ...row }]];
    } });
    const available = !!(row.essay_name || row.essay_data);
    const essay = await dao.getAssessmentEssay('cadet-1');
    assert.equal(!!essay, available);
    const assessment = await dao.getAssessmentByCadetId('cadet-1');
    assert.equal(assessment.has_essay, available);
    assert.equal('essay_data' in assessment, false);
  }
  const dao = daoWith({ query: async () => [[]] });
  assert.equal(await dao.getAssessmentEssay('missing-cadet'), null);
});

for (const scenario of ['database', 'disk', 'missing record', 'missing file', 'bad parent', 'read failure', 'unsafe name']) {
  test(`essay viewing: ${scenario}`, async () => {
    const bytes = Buffer.from('%PDF-1.4 essay fixture');
    const reads = [];
    const controller = controllerWith({ getAssessmentEssay: async cadetId => {
      assert.equal(cadetId, 'cadet-1');
      return scenario === 'missing record' ? null : {
        essay_data: scenario === 'database' ? bytes : null,
        essay_name: scenario === 'unsafe name' ? '../secret.pdf' : 'stored.pdf',
        essay_mime_type: 'application/pdf',
      };
    } }, { promises: { readFile: async filename => {
      reads.push(filename);
      assert.equal(filename, path.resolve(__dirname, '../uploads/stored.pdf'));
      if (['missing file', 'bad parent', 'read failure'].includes(scenario)) {
        throw Object.assign(new Error('fixture'), {
          code: scenario === 'missing file' ? 'ENOENT' : scenario === 'bad parent' ? 'ENOTDIR' : 'EACCES',
        });
      }
      return bytes;
    } } });
    const res = {
      code: 200,
      status(code) { this.code = code; return this; },
      json(body) { this.body = body; return this; },
      set(headers) { this.headers = headers; return this; },
      send(data) { this.data = data; return this; },
    };
    await controller.downloadEssay({ params: { cadet_id: 'cadet-1' } }, res);
    const available = ['database', 'disk'].includes(scenario);
    assert.equal(res.code, available ? 200 : scenario === 'read failure' ? 500 : 404);
    if (available) {
      assert.equal(res.data, bytes);
      assert.equal(res.headers['Content-Type'], 'application/pdf');
      assert.equal(res.headers['Content-Disposition'], 'inline; filename="stored.pdf"');
      assert.equal(res.headers['Cache-Control'], 'private, no-store');
    } else assert.equal(res.body.success, false);
    assert.equal(reads.length, ['disk', 'missing file', 'bad parent', 'read failure'].includes(scenario) ? 1 : 0);
  });
}

test('essay disk lookup rejects absolute paths, Windows paths and dot names', async () => {
  for (const name of ['/etc/passwd', '..\\secret.pdf', 'C:\\secret.pdf', '.', '..']) {
    const controller = controllerWith({ getAssessmentEssay: async () => ({ essay_name: name }) }, {
      promises: { readFile: async () => { assert.fail('Unsafe path must not be read'); } },
    });
    const res = {
      status(code) { this.code = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await controller.downloadEssay({ params: { cadet_id: 'cadet-1' } }, res);
    assert.equal(res.code, 404);
  }
});

test('a multipart essay upload can be reopened after editing assessment scores without another file', async (t) => {
  const state = { row: null };
  const dao = daoWith({ query: async (sql, values) => {
    if (sql === 'SELECT id FROM cadets WHERE id = ?') return [[{ id: values[0] }]];
    if (sql === 'SELECT id FROM assessments WHERE cadet_id = ?') return [state.row ? [{ id: state.row.id }] : []];
    if (sql.startsWith('INSERT INTO assessments')) {
      const fields = sql.match(/\(([^)]+)\)/)[1].split(', ');
      state.row = Object.fromEntries(fields.map((field, index) => [field, values[index]]));
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('UPDATE assessments SET')) {
      const fields = sql.slice('UPDATE assessments SET '.length).split(' WHERE ')[0].split(', ').map(item => item.split(' = ')[0]);
      for (const [index, field] of fields.entries()) state.row[field] = values[index];
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('FROM assessments')) return [state.row && values[0] === state.row.cadet_id ? [{ ...state.row }] : []];
    throw new Error(`Unexpected query: ${sql}`);
  } });
  const controller = controllerWith(dao);
  const router = load('routes/assessmentRoutes.js', {
    express,
    '../controllers/assessmentController': controller,
    '../middleware/authMiddleware': { authMiddleware(req, _res, next) { req.user = { id: 'admin-1' }; next(); } },
    '../middleware/permissionMiddleware': { requireSuperAdmin(_req, _res, next) { next(); } },
    '../middleware/instituteOwnershipMiddleware': { requireSuperAdminOrInstituteCadetRead: () => (_req, _res, next) => next() },
    '../middleware/uploadMiddleware': require('../src/middleware/uploadMiddleware'),
  });
  const app = express();
  app.use('/api/assessments', router);
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    if (state.row?.essay_name) {
      assert.match(state.row.essay_name, /^[a-f0-9-]+\.pdf$/);
      await fs.promises.unlink(path.join(__dirname, '../uploads', state.row.essay_name));
    }
  });
  const base = `http://127.0.0.1:${server.address().port}/api/assessments`;
  const bytes = Buffer.from('%PDF-1.4 actual uploaded essay fixture');
  const form = new FormData();
  form.append('essay', new Blob([bytes], { type: 'application/pdf' }), 'Essay.pdf');
  form.append('english_test', '10');
  let response = await fetch(`${base}/cadet-1`, { method: 'POST', body: form });
  assert.equal(response.status, 200);
  assert.equal(state.row.essay_data, null);
  const storedName = state.row.essay_name;

  for (const edit of [false, true]) {
    if (edit) {
      const update = new FormData();
      update.append('english_test', '20');
      response = await fetch(`${base}/cadet-1`, { method: 'POST', body: update });
      assert.equal(response.status, 200);
      assert.equal(state.row.essay_name, storedName);
      assert.equal(state.row.english_test, '20');
    }
    response = await fetch(`${base}/cadet-1`);
    const json = await response.json();
    assert.equal(json.data.has_essay, true);
    assert.equal('essay_data' in json.data, false);
    response = await fetch(`${base}/cadet-1/essay/download`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.match(response.headers.get('content-disposition'), /^inline;/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  }
  response = await fetch(`${base}/another-cadet/essay/download`);
  assert.equal(response.status, 404);
});
