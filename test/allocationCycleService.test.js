const test = require('node:test');
const assert = require('node:assert/strict');

// Opt in with ALLOCATION_DB_TESTS=1. Every table below is connection-local;
// production tables and records are never used or changed by these tests.
test('department allocations with MySQL temporary tables', {
  skip: process.env.ALLOCATION_DB_TESTS !== '1',
}, async (t) => {
  const db = require('../src/config/database');
  const { createCycle, splitCombinedCycles } = require('../src/services/allocationCycleService');
  const connection = await db.getConnection();
  const database = {
    getConnection: async () => ({
      query: connection.query.bind(connection),
      beginTransaction: connection.beginTransaction.bind(connection),
      commit: connection.commit.bind(connection),
      rollback: connection.rollback.bind(connection),
      release() {},
    }),
  };
  const rows = async (sql, values = []) => (await connection.query(sql, values))[0];
  try {
    await connection.query(`CREATE TEMPORARY TABLE allocation_year_sequences (
      allocation_year INT PRIMARY KEY, last_number INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB`);
    await connection.query(`CREATE TEMPORARY TABLE allocation_cycles (
      id VARCHAR(36) PRIMARY KEY, allocation_number VARCHAR(30) NOT NULL UNIQUE,
      allocation_year INT NOT NULL, department ENUM('Deck','Engine') NULL,
      status ENUM('Active','Closed') NOT NULL DEFAULT 'Active', created_by VARCHAR(36),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
    await connection.query(`CREATE TEMPORARY TABLE allocation_rank_lists (
      id VARCHAR(36) PRIMARY KEY, cycle_id VARCHAR(36) NOT NULL,
      department ENUM('Deck','Engine') NOT NULL, formula_template_id VARCHAR(36),
      formula_snapshot JSON NOT NULL, status VARCHAR(20) DEFAULT 'Draft',
      ranking_mode VARCHAR(20) DEFAULT 'Auto', finalized_by VARCHAR(36),
      finalized_at DATETIME, unlock_remarks TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_cycle_department (cycle_id, department)
    ) ENGINE=InnoDB`);
    await connection.query(`CREATE TEMPORARY TABLE assessment_courses (
      id VARCHAR(36) PRIMARY KEY, code VARCHAR(50), name VARCHAR(150), status VARCHAR(20)
    ) ENGINE=InnoDB`);
    await connection.query(`CREATE TEMPORARY TABLE allocations (
      id VARCHAR(36) PRIMARY KEY, rank_list_id VARCHAR(36), final_score DECIMAL(10,2),
      current_rank INT, vessel_id VARCHAR(36)
    ) ENGINE=InnoDB`);
    await connection.query(`INSERT INTO assessment_courses VALUES ('course','SAFETY','Safety','Active')`);

    await t.test('Deck and Engine create independent cycles with exactly one matching list', async () => {
      const created = [];
      for (const department of ['Deck', 'Engine']) {
        const cycle = await createCycle({ year: 2090, department, userId: 'test-user' }, database);
        const [stored] = await rows('SELECT * FROM allocation_cycles WHERE id=?', [cycle.id]);
        const lists = await rows('SELECT * FROM allocation_rank_lists WHERE cycle_id=?', [cycle.id]);
        assert.equal(cycle.department, department);
        assert.equal(stored.department, department);
        assert.equal(lists.length, 1);
        assert.equal(lists[0].department, department);
        const snapshot = typeof lists[0].formula_snapshot === 'string'
          ? JSON.parse(lists[0].formula_snapshot) : lists[0].formula_snapshot;
        assert.equal(snapshot.department, department);
        assert.equal(snapshot.components[0].course_id, 'course');
        created.push(cycle);
      }
      assert.notEqual(created[0].id, created[1].id);
      assert.notEqual(created[0].allocation_number, created[1].allocation_number);
    });

    await t.test('missing, combined and invalid departments are rejected without creating records', async () => {
      const before = await rows('SELECT * FROM allocation_cycles ORDER BY id');
      for (const department of [undefined, '', 'Both', 'Deck and Engine', 'Invalid']) {
        await assert.rejects(createCycle({ year: 2090, department }, database),
          (error) => error.status === 400 && /Deck or Engine/.test(error.message));
      }
      await assert.rejects(createCycle({ year: 1999, department: 'Deck' }, database),
        (error) => error.status === 400);
      assert.deepEqual(await rows('SELECT * FROM allocation_cycles ORDER BY id'), before);
    });

    await t.test('a failed rank-list insert rolls back its cycle and allocation number', async () => {
      const before = await rows('SELECT * FROM allocation_cycles ORDER BY id');
      const sequences = await rows('SELECT * FROM allocation_year_sequences ORDER BY allocation_year');
      await connection.query('CREATE UNIQUE INDEX test_unique_department ON allocation_rank_lists(department)');
      try {
        await assert.rejects(createCycle({ year: 2090, department: 'Engine' }, database),
          (error) => error.code === 'ER_DUP_ENTRY');
        assert.deepEqual(await rows('SELECT * FROM allocation_cycles ORDER BY id'), before);
        assert.deepEqual(await rows('SELECT * FROM allocation_year_sequences ORDER BY allocation_year'), sequences);
      } finally {
        await connection.query('DROP INDEX test_unique_department ON allocation_rank_lists');
      }
    });

    await t.test('splitting preserves finalized lists, ranks, scores and existing relationships', async () => {
      await connection.query(`INSERT INTO allocation_cycles
        (id,allocation_number,allocation_year,status,created_by)
        VALUES ('legacy','CTV-2089-0001',2089,'Closed','original-user'),
               ('engine-only','CTV-2089-0002',2089,'Active','original-user')`);
      await connection.query('INSERT INTO allocation_year_sequences VALUES (2089,2)');
      const snapshot = JSON.stringify({ department: 'Engine', components: [{ course_id: 'historical' }] });
      await connection.query(`INSERT INTO allocation_rank_lists
        (id,cycle_id,department,formula_snapshot,status,ranking_mode,finalized_by,finalized_at)
        VALUES ('old-deck','legacy','Deck',?,'Finalized','Auto','finalizer','2026-01-01'),
               ('old-engine','legacy','Engine',?,'Finalized','Manual','finalizer','2026-01-02'),
               ('only-engine','engine-only','Engine',?,'Draft','Auto',NULL,NULL)`,
      [JSON.stringify({ department: 'Deck' }), snapshot, snapshot]);
      await connection.query(`INSERT INTO allocations VALUES
        ('deck-cadet','old-deck',90,1,'vessel-a'), ('engine-cadet','old-engine',80,1,'vessel-b')`);
      const candidatesBefore = await rows('SELECT * FROM allocations ORDER BY id');
      const listsBefore = await rows('SELECT * FROM allocation_rank_lists ORDER BY id');
      const moved = await splitCombinedCycles(database);
      assert.equal(moved.length, 1);
      assert.equal(moved[0].department, 'Engine');
      const [deckCycle] = await rows('SELECT * FROM allocation_cycles WHERE id=?', ['legacy']);
      assert.equal(deckCycle.department, 'Deck');
      assert.equal(deckCycle.allocation_number, 'CTV-2089-0001');
      const [engineList] = await rows('SELECT * FROM allocation_rank_lists WHERE id=?', ['old-engine']);
      assert.notEqual(engineList.cycle_id, 'legacy');
      const [engineCycle] = await rows('SELECT * FROM allocation_cycles WHERE id=?', [engineList.cycle_id]);
      assert.equal(engineCycle.department, 'Engine');
      assert.equal(engineCycle.status, 'Closed');
      assert.equal(engineCycle.created_by, deckCycle.created_by);
      assert.equal(engineCycle.created_at.getTime(), deckCycle.created_at.getTime());
      assert.equal(engineCycle.allocation_number, 'CTV-2089-0003');
      const [singleCycle] = await rows('SELECT * FROM allocation_cycles WHERE id=?', ['engine-only']);
      assert.equal(singleCycle.department, 'Engine');
      assert.deepEqual(await rows('SELECT * FROM allocations ORDER BY id'), candidatesBefore);
      const withoutCycle = ({ cycle_id, ...rest }) => rest;
      assert.deepEqual((await rows('SELECT * FROM allocation_rank_lists ORDER BY id')).map(withoutCycle),
        listsBefore.map(withoutCycle));
      assert.deepEqual(await splitCombinedCycles(database), []);
      assert.equal((await rows('SELECT * FROM allocation_cycles')).length, 5);
      await connection.query('CREATE UNIQUE INDEX uq_single_department_cycle ON allocation_rank_lists(cycle_id)');
    });
  } finally {
    // Destroy the session so all temporary tables disappear before reuse.
    connection.destroy();
    await db.end();
  }
});
