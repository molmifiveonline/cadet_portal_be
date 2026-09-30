const test = require('node:test');
const assert = require('node:assert/strict');

// All business tables are shadowed on one connection; no real cadet records are changed.
test('allocation ranking with MySQL temporary tables', {
  skip: process.env.ALLOCATION_DB_TESTS !== '1',
}, async (t) => {
  const db = require('../src/config/database');
  const { addCandidates, recalculateRanks, updateFinalScore } = require('../src/services/allocationService');
  const connection = await db.getConnection();
  const rows = async (sql, params = []) => (await connection.query(sql, params))[0];
  const definitions = {
    allocation_cycles: 'id VARCHAR(36) PRIMARY KEY, allocation_number VARCHAR(30), allocation_year INT, status VARCHAR(20)',
    allocation_rank_lists: 'id VARCHAR(36) PRIMARY KEY, cycle_id VARCHAR(36), department VARCHAR(20), status VARCHAR(20), ranking_mode VARCHAR(20), formula_snapshot JSON',
    cadets: 'id VARCHAR(36) PRIMARY KEY, cadet_unique_id VARCHAR(50), name_as_in_indos_cert VARCHAR(100), course VARCHAR(50), imu_avg_all_semester_percentage DECIMAL(10,2), status VARCHAR(30), workflow_phase VARCHAR(30)',
    allocations: 'id VARCHAR(36) PRIMARY KEY, rank_list_id VARCHAR(36), cadet_id VARCHAR(36), academic_score DECIMAL(10,2), final_score DECIMAL(10,2), current_rank INT NULL, is_active TINYINT DEFAULT 1, allocation_status VARCHAR(30), vessel_type_id VARCHAR(36), added_by VARCHAR(36)',
    allocation_score_entries: 'id VARCHAR(36) PRIMARY KEY, allocation_id VARCHAR(36), course_id VARCHAR(36), course_name_snapshot VARCHAR(100), max_score_snapshot DECIMAL(10,2), weight_snapshot DECIMAL(10,2), score DECIMAL(10,2), updated_by VARCHAR(36), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
    assessment_courses: 'id VARCHAR(36) PRIMARY KEY, name VARCHAR(100), status VARCHAR(20)',
    document_verifications: 'cadet_id VARCHAR(36), status VARCHAR(30)',
    cadet_documents: 'id VARCHAR(36) PRIMARY KEY, cadet_id VARCHAR(36), status VARCHAR(30)',
    vessel_types: 'id VARCHAR(36) PRIMARY KEY, name VARCHAR(100), department VARCHAR(20), status VARCHAR(20)',
  };
  const reset = async () => {
    for (const table of Object.keys(definitions)) await connection.query(`DELETE FROM ${table}`);
    await connection.query("INSERT INTO allocation_cycles VALUES ('cycle','CTV-TEST',2090,'Active')");
    await connection.query("INSERT INTO allocation_rank_lists VALUES ('list','cycle','Deck','Draft','Manual',?)", [JSON.stringify({ scoring_method: 'AcademicAssessmentAverage' })]);
    await connection.query(`INSERT INTO cadets VALUES
      ('first','C-001','First Cadet','Deck',74,'Selected','selected'),
      ('second','C-002','Second Cadet','Deck',90,'Selected','selected'),
      ('new','C-003','New Cadet','Deck',79,'Selected','selected')`);
    await connection.query(`INSERT INTO allocations (id,rank_list_id,cadet_id,academic_score,final_score,current_rank)
      VALUES ('first','list','first',74,72,1),('second','list','second',90,90,2)`);
    await connection.query("INSERT INTO assessment_courses VALUES ('assessment','Safety','Active')");
    await connection.query("INSERT INTO document_verifications VALUES ('new','Verified')");
    await connection.query("INSERT INTO cadet_documents VALUES ('document','new','accepted')");
  };
  const storedRanks = () => rows('SELECT cadet_id,current_rank FROM allocations WHERE is_active=1 ORDER BY current_rank IS NULL,current_rank');
  const expectedManualRanks = [
    { cadet_id: 'first', current_rank: 1 },
    { cadet_id: 'second', current_rank: 2 },
    { cadet_id: 'new', current_rank: 3 },
  ];
  try {
    for (const [table, definition] of Object.entries(definitions)) {
      await connection.query(`CREATE TEMPORARY TABLE ${table} (${definition}) ENGINE=InnoDB`);
    }
    t.mock.method(db, 'getConnection', async () => ({
      query: connection.query.bind(connection),
      beginTransaction: connection.beginTransaction.bind(connection),
      commit: connection.commit.bind(connection),
      rollback: connection.rollback.bind(connection),
      release() {},
    }));

    await t.test('adding an assessed cadet assigns a rank while preserving manual order', async () => {
      await reset();
      await addCandidates({ rankListId: 'list', userId: 'tester', candidates: [
        { cadet_id: 'new', scores: [{ course_id: 'assessment', score: 32 }] },
      ] });
      assert.deepEqual(await storedRanks(), expectedManualRanks);
      const [list] = await rows("SELECT ranking_mode FROM allocation_rank_lists WHERE id='list'");
      assert.equal(list.ranking_mode, 'Manual');
    });

    await t.test('saving the first assessment assigns a missing rank in manual mode', async () => {
      await reset();
      const [added] = await addCandidates({ rankListId: 'list', userId: 'tester', cadetIds: ['new'] });
      const [unscored] = await rows('SELECT final_score,current_rank FROM allocations WHERE id=?', [added.allocation_id]);
      assert.equal(unscored.current_rank, null);
      await connection.query(`INSERT INTO allocation_score_entries
        (id,allocation_id,course_id,score,max_score_snapshot) VALUES ('score',?,'assessment',32,100)`, [added.allocation_id]);
      await connection.beginTransaction();
      try {
        assert.equal(await updateFinalScore(connection, added.allocation_id, 'tester'), 55.5);
        assert.deepEqual(await storedRanks(), expectedManualRanks);
      } finally { await connection.rollback(); }
    });

    await t.test('repairing missing ranks appends scored cadets without resetting manual ranks', async () => {
      await reset();
      await connection.query(`INSERT INTO allocations (id,rank_list_id,cadet_id,academic_score,final_score)
        VALUES ('new','list','new',79,99)`);
      await connection.beginTransaction();
      try {
        await recalculateRanks(connection, 'list');
        assert.deepEqual(await storedRanks(), expectedManualRanks);
      } finally { await connection.rollback(); }
    });

    await t.test('editing scores preserves manual positions; clearing scores removes the rank and closes gaps', async () => {
      await reset();
      await connection.query(`INSERT INTO allocation_score_entries
        (id,allocation_id,course_id,score,max_score_snapshot) VALUES ('score','first','assessment',0,100)`);
      await connection.beginTransaction();
      try {
        assert.equal(await updateFinalScore(connection, 'first', 'tester'), 37);
        assert.deepEqual(await storedRanks(), expectedManualRanks.slice(0, 2));
        await connection.query("DELETE FROM allocation_score_entries WHERE allocation_id='first'");
        assert.equal(await updateFinalScore(connection, 'first', 'tester'), null);
        assert.deepEqual(await storedRanks(), [
          { cadet_id: 'second', current_rank: 1 }, { cadet_id: 'first', current_rank: null },
        ]);
      } finally { await connection.rollback(); }
    });

    await t.test('automatic mode and explicit reset still sort everyone by score', async () => {
      for (const force of [false, true]) {
        await reset();
        if (!force) await connection.query("UPDATE allocation_rank_lists SET ranking_mode='Auto' WHERE id='list'");
        await connection.beginTransaction();
        try {
          await recalculateRanks(connection, 'list', force);
          assert.deepEqual(await storedRanks(), [
            { cadet_id: 'second', current_rank: 1 }, { cadet_id: 'first', current_rank: 2 },
          ]);
        } finally { await connection.rollback(); }
      }
    });
  } finally {
    t.mock.restoreAll();
    connection.release();
    await db.end();
  }
});
