const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(file, mocks) {
  const module = { exports: {} };
  const filename = path.join(__dirname, '../src', file);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, __dirname: path.dirname(filename), encodeURIComponent,
    console: { error() {} },
    require: (name) => mocks[name] || {},
  });
  return module.exports;
}

for (const scenario of ['database copy', 'disk copy', 'missing bytes', 'wrong cadet', 'unsafe path']) {
  test(`view medical file: ${scenario}`, async () => {
    const bytes = Buffer.from('medical report fixture');
    const reads = [];
    const controller = load('controllers/medicalController.js', {
      path,
      fs: { promises: { readFile: async (filename) => {
        reads.push(filename);
        if (scenario === 'missing bytes') throw Object.assign(new Error(), { code: 'ENOENT' });
        return bytes;
      } } },
      '../dao/cadetMedicalResultsDao': {
        getMedicalReportFile: async (cadetId, fileId, withData) => {
          assert.equal(cadetId, 'cadet-1');
          assert.equal(fileId, 'file-1');
          assert.equal(withData, true);
          return scenario === 'wrong cadet' ? null : {
            file_name: 'report.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            file_path: scenario === 'unsafe path' ? '/uploads/../secret' : '/uploads/report.docx',
            file_data: scenario === 'database copy' ? bytes : null,
          };
        },
      },
    });
    const res = {
      headers: {}, code: 200,
      status(code) { this.code = code; return this; },
      set(key, value) { this.headers[key] = value; return this; },
      send(data) { this.bytes = data; return this; },
      json(body) { this.body = body; return this; },
    };
    await controller.getMedicalReportFile({ params: { cadet_id: 'cadet-1', file_id: 'file-1' } }, res);
    const available = ['database copy', 'disk copy'].includes(scenario);
    assert.equal(res.code, available ? 200 : 404);
    if (available) {
      assert.equal(res.bytes, bytes);
      assert.match(res.headers['Content-Disposition'], /report.docx/);
      assert.equal(res.headers['Cache-Control'], 'private, no-store');
    } else {
      assert.equal(res.body.success, false);
      if (scenario !== 'wrong cadet') assert.match(res.body.message, /upload it again/);
    }
    assert.equal(reads.length, ['disk copy', 'missing bytes'].includes(scenario) ? 1 : 0);
  });
}

test('new uploads retain original names and binary data', async () => {
  const inserts = [];
  let prepared = false;
  const bytes = Buffer.from('persistent report fixture');
  const dao = load('dao/cadetMedicalResultsDao.js', {
    fs: { promises: { readFile: async (filename) => {
      assert.equal(filename, '/tmp/stored.docx');
      return bytes;
    } } },
    uuid: { v4: () => 'file-1' },
    '../services/schemaCompatibilityService': { filterExistingColumns: async () => ({}) },
    '../services/schemaUpgradeService': { ensureMedicalReportFilesSupport: async () => { prepared = true; } },
    '../config/database': { query: async (sql, params) => {
      if (sql.startsWith('SELECT')) return [[{ id: 'result-1' }]];
      assert.equal(prepared, true);
      assert.match(sql, /file_data/);
      inserts.push(Array.from(params));
      return [{ affectedRows: 1 }];
    } },
  });
  await dao.createOrUpdateMedicalResult({ cadet_id: 'cadet-1', files: [{
    path: '/tmp/stored.docx', filename: 'stored.docx', originalname: 'Report.docx', mimetype: 'application/msword',
  }] });
  assert.deepEqual(inserts, [['file-1', 'result-1', 'Report.docx', '/uploads/stored.docx', 'application/msword', bytes]]);
});

test('medical file schema upgrade adds binary storage once', async () => {
  const queries = [];
  let cleared = 0;
  const schema = load('services/schemaUpgradeService.js', {
    '../config/database': { query: async (sql) => {
      queries.push(sql);
      return [[]];
    } },
    './schemaCompatibilityService': { clearSchemaCache: () => { cleared += 1; } },
  });
  await Promise.all([schema.ensureMedicalReportFilesSupport(), schema.ensureMedicalReportFilesSupport()]);
  assert.equal(queries.filter((sql) => sql.startsWith('ALTER TABLE')).length, 1);
  assert.match(queries.find((sql) => sql.startsWith('ALTER TABLE')), /file_data LONGBLOB NULL/);
  assert.equal(cleared, 1);
});
