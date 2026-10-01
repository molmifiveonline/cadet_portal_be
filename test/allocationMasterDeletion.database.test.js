const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID, randomBytes } = require('node:crypto');

test(
  'assessment and vessel masters keep formula, score, primary and secondary links, including allocation history',
  { skip: process.env.MASTER_DELETION_DB_TESTS !== '1' },
  async () => {
    const db = require('../src/config/database');
    const connection = await db.getConnection();
    const tables = [
      'vessels',
      'allocations',
      'allocation_cycles',
      'allocation_rank_lists',
      'assessment_courses',
      'score_formula_components',
      'allocation_score_entries',
    ];
    const prefix = `master_delete_test_${randomBytes(6).toString('hex')}_`;
    const names = Object.fromEntries(
      tables.map((table) => [table, prefix + table]),
    );
    const pattern = new RegExp(
      `\\b(FROM|INTO|UPDATE|JOIN) (${tables.join('|')})\\b`,
      'g',
    );
    const query = (sql, params) =>
      connection.query(
        sql.replace(
          pattern,
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
          process: { env: { NODE_ENV: 'development' } },
          require(name) {
            if (name in mocks) return mocks[name];
            throw new Error(`Unexpected import: ${name}`);
          },
        },
      );
      return module.exports;
    };
    const response = () => ({
      code: 200,
      status(code) {
        this.code = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    });
    try {
      for (const table of tables)
        await connection.query(
          `CREATE TEMPORARY TABLE ${names[table]} LIKE ${table}`,
        );
      const service = load('services/allocationMasterDeletionService.js', {
        '../config/database': mockDb,
      });
      const logs = [];
      const mocks = {
        '../config/database': mockDb,
        '../services/allocationMasterDeletionService': service,
        uuid: { v4: randomUUID },
      };
      const vessels = load('dao/vesselDao.js', mocks);
      const assessments = load('controllers/allocationMasterController.js', {
        ...mocks,
        crypto: {},
        '../services/allocationRules': {},
        '../dao/activityLogDao': {
          createLog: async (...args) => logs.push(args),
        },
      });
      const primary = randomUUID(),
        secondary = randomUUID(),
        unusedVessel = randomUUID();
      for (const id of [primary, secondary, unusedVessel])
        await query(
          'INSERT INTO vessels (id, name, imo_number) VALUES (?, ?, ?)',
          [id, `Vessel ${id}`, id],
        );
      const cycleId = randomUUID(),
        rankListId = randomUUID(),
        allocationId = randomUUID();
      await query(
        "INSERT INTO allocation_cycles (id, allocation_number, allocation_year, department, deleted_at, delete_reason) VALUES (?, ?, 2026, 'Deck', NOW(), 'Test history')",
        [cycleId, 'CTV-TEST-HISTORY'],
      );
      await query("INSERT INTO allocation_rank_lists (id, cycle_id, department, formula_snapshot) VALUES (?, ?, 'Deck', '{}')", [rankListId, cycleId]);
      await query(
        'INSERT INTO allocations (id, cadet_id, rank_list_id, vessel_id, secondary_vessel_id) VALUES (?, ?, ?, ?, ?)',
        [allocationId, randomUUID(), rankListId, primary, secondary],
      );
      const formulaAssessment = randomUUID(),
        scoredAssessment = randomUUID(),
        unusedAssessment = randomUUID();
      for (const id of [formulaAssessment, scoredAssessment, unusedAssessment])
        await query(
          "INSERT INTO assessment_courses (id, code, name, status) VALUES (?, ?, ?, 'Inactive')",
          [id, id, `Assessment ${id}`],
        );
      await query(
        'INSERT INTO score_formula_components (id, template_id, course_id, weight, max_score) VALUES (?, ?, ?, 100, 100)',
        [randomUUID(), randomUUID(), formulaAssessment],
      );
      await query(
        'INSERT INTO allocation_score_entries (id, allocation_id, course_id, course_name_snapshot, weight_snapshot, max_score_snapshot) VALUES (?, ?, ?, ?, 100, 100)',
        [randomUUID(), allocationId, scoredAssessment, 'Scored Assessment'],
      );
      const before = (await query('SELECT * FROM allocations'))[0];
      const vesselList = await vessels.getAllVessels(20, 0);
      for (const id of [primary, secondary]) {
        assert.equal(
          vesselList.data.find((row) => row.id === id).can_delete,
          false,
        );
        await assert.rejects(
          vessels.deleteVessel(id),
          (error) => error.statusCode === 409,
        );
        assert.ok(await vessels.getVesselById(id));
      }
      const listing = response();
      await assessments.listCourses({ query: { status: 'Inactive' } }, listing);
      assert.equal(listing.code, 200, JSON.stringify(listing.body));
      for (const [id, reason] of [
        [formulaAssessment, 'score formulas'],
        [scoredAssessment, 'cadet scores'],
      ]) {
        const row = listing.body.data.find((row) => row.id === id);
        assert.equal(row.can_delete, false);
        assert.ok(row.delete_blocked_reason.includes(reason));
        const res = response();
        await assessments.deleteCourse(
          { params: { id }, user: { id: 'admin' } },
          res,
        );
        assert.equal(res.code, 409);
      }
      assert.equal(logs.length, 0);
      assert.deepEqual((await query('SELECT * FROM allocations'))[0], before);
      assert.equal(
        vesselList.data.find((row) => row.id === unusedVessel).can_delete,
        true,
      );
      assert.equal(
        listing.body.data.find((row) => row.id === unusedAssessment).can_delete,
        true,
      );
      assert.equal(await vessels.deleteVessel(unusedVessel), true);
      assert.equal(await vessels.getVesselById(unusedVessel), null);
      const res = response();
      await assessments.deleteCourse(
        { params: { id: unusedAssessment }, user: { id: 'admin' } },
        res,
      );
      assert.equal(res.code, 200, JSON.stringify(res.body));
      assert.equal(logs.length, 1);
      assert.equal(logs[0][1], 'DELETE_ASSESSMENT_TYPE');
      assert.equal(await vessels.deleteVessel(randomUUID()), false);
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
