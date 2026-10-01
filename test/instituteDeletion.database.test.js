const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomBytes, randomUUID } = require('node:crypto');

test(
  'institute deletion preserves every dependency and permits only unused institutes',
  { skip: process.env.INSTITUTE_DELETION_DB_TESTS !== '1' },
  async () => {
    const db = require('../src/config/database');
    const connection = await db.getConnection();
    const tables = [
      'institutes',
      'recruitment_drives',
      'cadets',
      'institute_submissions',
      'recruitment_communications',
      'notifications',
    ];
    const prefix = `institute_test_${randomBytes(6).toString('hex')}_`;
    const names = Object.fromEntries(
      tables.map((table) => [table, `${prefix}${table}`]),
    );
    const pattern =
      /\b(institutes|recruitment_drives|cadets|institute_submissions|recruitment_communications|notifications)\b/g;
    const query = (sql, params) =>
      connection.query(
        sql.replace(pattern, (table) => names[table]),
        params,
      );
    try {
      for (const table of tables)
        await connection.query(
          `CREATE TEMPORARY TABLE ${names[table]} LIKE ${table}`,
        );
      const module = { exports: {} };
      vm.runInNewContext(
        fs.readFileSync(
          path.join(__dirname, '../src/dao/instituteDao.js'),
          'utf8',
        ),
        {
          module,
          require(name) {
            if (name === 'uuid') return { v4: randomUUID };
            if (
              name === 'bcryptjs' ||
              name === '../services/schemaCompatibilityService'
            )
              return {};
            if (name === '../services/instituteDeletionService')
              return require('../src/services/instituteDeletionService');
            if (name === '../config/database')
              return {
                query,
                getConnection: async () => ({
                  query,
                  beginTransaction: () => connection.beginTransaction(),
                  commit: () => connection.commit(),
                  rollback: () => connection.rollback(),
                  release() {},
                }),
              };
            throw new Error(`Unexpected import: ${name}`);
          },
        },
      );
      const dao = module.exports;
      const addInstitute = async (name) => {
        const id = randomUUID();
        await query(
          'INSERT INTO institutes (id, institute_name, address, location) VALUES (?, ?, ?, ?)',
          [id, name, 'Test', 'Mumbai'],
        );
        return id;
      };
      const unused = await addInstitute('Unused Institute');
      const other = await addInstitute('Other Institute');
      const fixtures = [
        [
          'recruitment_drives',
          'recruitment drives',
          'INSERT INTO recruitment_drives (id, institute_id, drive_name, course_type, status) VALUES (?, ?, ?, ?, ?)',
          (id) => [randomUUID(), id, 'Closed Drive', 'Deck', 'Closed'],
        ],
        [
          'cadets',
          'cadets',
          'INSERT INTO cadets (id, institute_id) VALUES (?, ?)',
          (id) => [randomUUID(), id],
        ],
        [
          'institute_submissions',
          'uploaded submissions',
          'INSERT INTO institute_submissions (id, institute_id, file_name, original_name, status) VALUES (?, ?, ?, ?, ?)',
          (id) => [randomUUID(), id, 'test.xlsx', 'test.xlsx', 'rejected'],
        ],
        [
          'recruitment_communications',
          'communication history',
          'INSERT INTO recruitment_communications (id, institute_id, communication_type, recipient_email, subject) VALUES (?, ?, ?, ?, ?)',
          (id) => [
            randomUUID(),
            id,
            'institute_request',
            'test@example.test',
            'Test',
          ],
        ],
        [
          'notifications',
          'institute notifications',
          'INSERT INTO notifications (recipient_type, recipient_id, title, message) VALUES (?, ?, ?, ?)',
          (id) => ['Institute', id, 'Test', 'Test'],
        ],
      ];
      for (const [table, label, sql, params] of fixtures) {
        const id = await addInstitute(`Used by ${table}`);
        await query(sql, params(id));
        const { data } = await dao.getAllInstitutes(
          100,
          0,
          'institute_name',
          'ASC',
          '',
        );
        const used = data.find((row) => row.id === id);
        assert.equal(used.can_delete, false);
        assert.ok(used.delete_blocked_reason.includes(label));
        assert.equal(data.find((row) => row.id === unused).can_delete, true);
        await assert.rejects(
          dao.deleteInstitute(id),
          (error) => error.status === 409 && error.message.includes(label),
        );
        assert.ok(await dao.getInstituteById(id));
        const [[{ total }]] = await query(
          `SELECT COUNT(*) AS total FROM ${table}`,
        );
        assert.equal(Number(total), 1, 'dependent record must be retained');
      }
      // A broadcast notification does not belong to a specific institute.
      await query(
        'INSERT INTO notifications (recipient_type, recipient_id, title, message) VALUES (?, NULL, ?, ?)',
        ['Institute', 'Broadcast', 'Test'],
      );
      assert.equal(await dao.deleteInstitute(unused), true);
      assert.equal(await dao.getInstituteById(unused), undefined);
      assert.ok(await dao.getInstituteById(other));
      assert.equal(await dao.deleteInstitute(randomUUID()), false);
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
