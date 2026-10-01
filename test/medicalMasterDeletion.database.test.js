const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID, randomBytes } = require('node:crypto');

test(
  'medical master deletion preserves direct and JSON dependencies, including secondary appointments and completed results',
  { skip: process.env.MEDICAL_DELETION_DB_TESTS !== '1' },
  async () => {
    const db = require('../src/config/database');
    const connection = await db.getConnection();
    const tables = [
      'medical_centers',
      'medical_reports',
      'cadet_medical_results',
    ];
    const prefix = `medical_delete_test_${randomBytes(6).toString('hex')}_`;
    const names = Object.fromEntries(
      tables.map((table) => [table, `${prefix}${table}`]),
    );
    // Rewrite table references only, retaining JSON paths and column names.
    const query = (sql, params) =>
      connection.query(
        sql.replace(
          /\b(FROM|INTO|UPDATE|JOIN) (medical_centers|medical_reports|cadet_medical_results)\b/g,
          (_, keyword, table) => `${keyword} ${names[table]}`,
        ),
        params,
      );
    const mockDb = {
      query,
      getConnection: async () => ({
        query,
        beginTransaction: () => connection.beginTransaction(),
        commit: () => connection.commit(),
        rollback: () => connection.rollback(),
        release() {},
      }),
    };
    const load = (file, mocks) => {
      const module = { exports: {} };
      vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'),
        {
          module,
          console,
          require(name) {
            if (name in mocks) return mocks[name];
            throw new Error(`Unexpected import: ${name}`);
          },
        },
      );
      return module.exports;
    };
    try {
      for (const table of tables)
        await connection.query(
          `CREATE TEMPORARY TABLE ${names[table]} LIKE ${table}`,
        );
      const service = load('services/medicalMasterDeletionService.js', {
        '../config/database': mockDb,
      });
      const mocks = {
        '../config/database': mockDb,
        uuid: { v4: randomUUID },
        '../services/medicalMasterDeletionService': service,
      };
      const centers = load('dao/medicalCenterDao.js', mocks);
      const reports = load('dao/medicalReportDao.js', mocks);
      const primary = randomUUID(),
        secondary = randomUUID(),
        unusedCenter = randomUUID();
      const centerReport = randomUUID(),
        appointmentReport = randomUUID(),
        resultReport = randomUUID(),
        unusedReport = randomUUID();
      for (const id of [
        centerReport,
        appointmentReport,
        resultReport,
        unusedReport,
      ])
        await query(
          'INSERT INTO medical_reports (id, name, status) VALUES (?, ?, ?)',
          [id, `Report ${id}`, 'Inactive'],
        );
      for (const id of [primary, secondary, unusedCenter])
        await query(
          'INSERT INTO medical_centers (id, center_name, location, status, medical_reports) VALUES (?, ?, ?, ?, ?)',
          [
            id,
            `Center ${id}`,
            'Mumbai',
            'Inactive',
            JSON.stringify(
              id === primary ? [centerReport, `${unusedReport}-different`] : [],
            ),
          ],
        );
      const medicalId = randomUUID();
      await query(
        'INSERT INTO cadet_medical_results (id, cadet_id, medical_center_id, appointments, report_results, status) VALUES (?, ?, ?, ?, ?, ?)',
        [
          medicalId,
          randomUUID(),
          primary,
          JSON.stringify([
            { medical_center_id: primary, medical_reports: [] },
            {
              medical_center_id: secondary,
              medical_reports: [appointmentReport],
            },
          ]),
          JSON.stringify([{ report_id: resultReport, status: 'pass' }]),
          'Pass',
        ],
      );
      const [before] = await query('SELECT * FROM cadet_medical_results');
      const centerList = await centers.getAllMedicalCenters(20, 0);
      const reportList = await reports.getAllMedicalReports(20, 0);
      for (const id of [primary, secondary]) {
        assert.equal(
          centerList.data.find((row) => row.id === id).can_delete,
          false,
        );
        await assert.rejects(
          centers.deleteMedicalCenter(id),
          (error) => error.statusCode === 409,
        );
        assert.ok(await centers.getMedicalCenterById(id));
      }
      for (const [id, reason] of [
        [centerReport, 'medical centers'],
        [appointmentReport, 'cadet medical'],
        [resultReport, 'cadet medical'],
      ]) {
        const row = reportList.data.find((row) => row.id === id);
        assert.equal(row.can_delete, false);
        assert.ok(row.delete_blocked_reason.includes(reason));
        await assert.rejects(
          reports.deleteMedicalReport(id),
          (error) => error.statusCode === 409,
        );
        assert.ok(await reports.getMedicalReportById(id));
      }
      assert.deepEqual(
        (await query('SELECT * FROM cadet_medical_results'))[0],
        before,
      );
      assert.equal(
        centerList.data.find((row) => row.id === unusedCenter).can_delete,
        true,
      );
      assert.equal(
        reportList.data.find((row) => row.id === unusedReport).can_delete,
        true,
      );
      assert.equal(await centers.deleteMedicalCenter(unusedCenter), true);
      assert.equal(await reports.deleteMedicalReport(unusedReport), true);
      assert.equal(await centers.getMedicalCenterById(unusedCenter), null);
      assert.equal(await reports.getMedicalReportById(unusedReport), null);
      assert.equal(await reports.deleteMedicalReport(randomUUID()), false);
    } finally {
      await connection.rollback();
      for (const table of tables.reverse())
        await connection.query(
          `DROP TEMPORARY TABLE IF EXISTS ${names[table]}`,
        );
      connection.release();
      await db.end();
    }
  },
);
