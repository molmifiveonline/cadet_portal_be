const test = require('node:test');
const assert = require('node:assert/strict');

test('assessment scale migration preserves percentages, history and repeated runs', {
  skip: process.env.ALLOCATION_DB_TESTS !== '1',
}, async () => {
  const db = require('../src/config/database');
  const { migrateAssessmentScores } = require('../src/services/assessmentScaleService');
  const connection = await db.getConnection();
  // Connection-local tables shadow the real tables; no application rows are changed.
  const database = { getConnection: async () => ({
    query: connection.query.bind(connection),
    beginTransaction: connection.beginTransaction.bind(connection),
    commit: connection.commit.bind(connection),
    rollback: connection.rollback.bind(connection),
    release() {},
  }) };
  try {
    await connection.query(`CREATE TEMPORARY TABLE allocation_score_entries (
      id VARCHAR(36) PRIMARY KEY, score DECIMAL(10,2) NULL,
      max_score_snapshot DECIMAL(10,2) NOT NULL, updated_by VARCHAR(36),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    await connection.query(`CREATE TEMPORARY TABLE allocation_rank_lists (
      id VARCHAR(36) PRIMARY KEY, formula_snapshot JSON, status VARCHAR(20),
      ranking_mode VARCHAR(20), updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    await connection.query(`INSERT INTO allocation_score_entries (id,score,max_score_snapshot,updated_by,updated_at) VALUES
      ('zero',0,10,'original-admin','2026-01-01'),
      ('decimal',7.25,10,'original-admin','2026-01-01'),
      ('maximum',10,10,'original-admin','2026-01-01'),
      ('incomplete',NULL,10,'original-admin','2026-01-01'),
      ('converted',70,100,'original-admin','2026-01-01')`);
    for (const status of ['Draft', 'Finalized']) {
      await connection.query(`INSERT INTO allocation_rank_lists (id,formula_snapshot,status,ranking_mode,updated_at)
        VALUES (?,?,?,'Manual','2026-01-01')`, [status, JSON.stringify({
        scoring_method: 'AcademicAssessmentAverage', components: [{ course_id: 'course', max_score: 10, weight: 0 }],
      }), status]);
    }
    assert.equal(await migrateAssessmentScores(database), 4);
    const [entries] = await connection.query('SELECT * FROM allocation_score_entries ORDER BY id');
    assert.deepEqual(Object.fromEntries(entries.map((entry) => [entry.id, entry.score === null ? null : Number(entry.score)])), {
      converted: 70, decimal: 72.5, incomplete: null, maximum: 100, zero: 0,
    });
    assert.ok(entries.every((entry) => Number(entry.max_score_snapshot) === 100 && entry.updated_by === 'original-admin'));
    const [lists] = await connection.query('SELECT * FROM allocation_rank_lists ORDER BY id');
    for (const list of lists) {
      const snapshot = typeof list.formula_snapshot === 'string' ? JSON.parse(list.formula_snapshot) : list.formula_snapshot;
      assert.equal(snapshot.components[0].max_score, 100);
      assert.equal(snapshot.scoring_method, 'AcademicAssessmentAverage');
      assert.equal(list.status, list.id);
      assert.equal(list.ranking_mode, 'Manual');
    }
    assert.equal(await migrateAssessmentScores(database), 0);
    assert.deepEqual((await connection.query('SELECT * FROM allocation_score_entries ORDER BY id'))[0], entries);
    assert.deepEqual((await connection.query('SELECT * FROM allocation_rank_lists ORDER BY id'))[0], lists);
  } finally {
    // DROP TEMPORARY cannot remove a persistent table with the same name.
    await connection.query('DROP TEMPORARY TABLE IF EXISTS allocation_score_entries, allocation_rank_lists');
    connection.release();
    await db.end();
  }
});
