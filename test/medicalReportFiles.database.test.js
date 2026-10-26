const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID, randomBytes } = require('node:crypto');

test('medical files survive disk loss and delete across mixed table collations', {
  skip: process.env.MEDICAL_FILE_DB_TESTS !== '1',
}, async () => {
  require('dotenv').config({ quiet: true });
  const mysql = require('mysql2/promise');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const prefix = `medical_file_test_${randomBytes(6).toString('hex')}_`;
  const tables = {
    cadet_medical_results: `${prefix}results`,
    cadet_medical_result_files: `${prefix}files`,
  };
  const query = (sql, params) => connection.query(sql.replace(
    /\b(cadet_medical_result_files|cadet_medical_results)\b/g,
    (table) => tables[table],
  ), params);
  try {
    await connection.query(`CREATE TEMPORARY TABLE ${tables.cadet_medical_results} (
      id VARCHAR(36) PRIMARY KEY, cadet_id VARCHAR(36),
      appointment_date DATE, appointment_time TIME, status VARCHAR(20),
      medical_center_id VARCHAR(36), remarks TEXT, report_name VARCHAR(255),
      report_mime_type VARCHAR(100), created_at TIMESTAMP NULL, updated_at TIMESTAMP NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await connection.query(`CREATE TEMPORARY TABLE ${tables.cadet_medical_result_files} (
      id VARCHAR(255) PRIMARY KEY, medical_result_id VARCHAR(255),
      file_name VARCHAR(255), file_path VARCHAR(255), mime_type VARCHAR(100), file_data LONGBLOB,
      created_at TIMESTAMP NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`);
    const cadetId = randomUUID();
    const resultId = randomUUID();
    const otherCadetId = randomUUID();
    await query('INSERT INTO cadet_medical_results (id, cadet_id) VALUES (?, ?), (?, ?)',
      [resultId, cadetId, randomUUID(), otherCadetId]);
    const bytes = Buffer.from('medical file database regression fixture');
    const module = { exports: {} };
    const mocks = {
      '../config/database': { query },
      uuid: { v4: randomUUID },
      fs: { promises: { readFile: async () => bytes } },
      '../services/schemaCompatibilityService': {
        filterExistingColumns: async () => ({}),
        hasColumn: async (table, column) => table === 'cadet_medical_result_files' && column === 'file_data',
      },
      '../services/schemaUpgradeService': { ensureMedicalReportFilesSupport: async () => {} },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/dao/cadetMedicalResultsDao.js'), 'utf8'), {
      module, require: (name) => mocks[name],
    });
    const dao = module.exports;
    await dao.createOrUpdateMedicalResult({ cadet_id: cadetId, files: [{
      path: '/nonexistent/disk-copy.pdf', filename: 'stored.pdf',
      originalname: 'Original.pdf', mimetype: 'application/pdf',
    }] });
    const [[file]] = await query('SELECT id FROM cadet_medical_result_files WHERE medical_result_id = ?', [resultId]);
    const stored = await dao.getMedicalReportFile(cadetId, file.id, true);
    assert.deepEqual(stored.file_data, bytes);
    assert.equal(stored.file_name, 'Original.pdf');
    const reloaded = await dao.getMedicalResultByCadetId(cadetId);
    assert.equal(reloaded.files[0].file_name, 'Original.pdf');
    assert.equal(reloaded.files[0].file_path, '/uploads/stored.pdf');
    assert.equal(await dao.getMedicalReportFile(otherCadetId, file.id, true), null);
    assert.equal(await dao.deleteMedicalReportFile(otherCadetId, file.id), null);
    assert.equal((await dao.deleteMedicalReportFile(cadetId, file.id)).id, file.id);
    assert.equal(await dao.getMedicalReportFile(cadetId, file.id, true), null);
  } finally {
    // Closing the connection also drops these isolated temporary tables.
    await connection.end();
  }
});
