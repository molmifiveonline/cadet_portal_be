const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

const nextAllocationNumber = async (connection, year) => {
  await connection.query(
    `INSERT INTO allocation_year_sequences (allocation_year,last_number) VALUES (?,0)
     ON DUPLICATE KEY UPDATE allocation_year=VALUES(allocation_year)`, [year],
  );
  const [sequences] = await connection.query(
    `SELECT last_number FROM allocation_year_sequences WHERE allocation_year=? FOR UPDATE`, [year],
  );
  const nextNumber = Number(sequences[0].last_number) + 1;
  await connection.query(
    `UPDATE allocation_year_sequences SET last_number=? WHERE allocation_year=?`, [nextNumber, year],
  );
  return `CTV-${year}-${String(nextNumber).padStart(4, '0')}`;
};

const createCycle = async ({ year, department, userId }, database = db) => {
  const allocationYear = Number(year);
  if (!Number.isInteger(allocationYear) || allocationYear < 2000 || allocationYear > 2100) {
    throw Object.assign(new Error('A valid allocation year is required'), { status: 400 });
  }
  if (!['Deck', 'Engine'].includes(department)) {
    throw Object.assign(new Error('Select Deck or Engine for this allocation'), { status: 400 });
  }

  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const allocationNumber = await nextAllocationNumber(connection, allocationYear);
    const cycleId = uuidv4();
    const [courses] = await connection.query(
      `SELECT id, code, name FROM assessment_courses WHERE status='Active' ORDER BY name`,
    );
    const snapshot = {
      name: 'Assessment Types',
      version: 1,
      department,
      scoring_method: 'AcademicAssessmentAverage',
      components: courses.map((course, index) => ({
        course_id: course.id, code: course.code, name: course.name,
        max_score: 100, weight: 0, sort_order: index,
      })),
    };
    await connection.query(
      `INSERT INTO allocation_cycles (id,allocation_number,allocation_year,department,created_by) VALUES (?,?,?,?,?)`,
      [cycleId, allocationNumber, allocationYear, department, userId],
    );
    await connection.query(
      `INSERT INTO allocation_rank_lists (id,cycle_id,department,formula_template_id,formula_snapshot) VALUES (?,?,?,?,?)`,
      [uuidv4(), cycleId, department, null, JSON.stringify(snapshot)],
    );
    await connection.commit();
    return { id: cycleId, allocation_number: allocationNumber, department };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// Keep rank-list IDs intact so scores, ranks, joining plans and onboarding retain
// their existing relationships. A non-null department marks a migrated cycle.
const splitCombinedCycles = async (database = db) => {
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [cycles] = await connection.query(
      `SELECT * FROM allocation_cycles WHERE department IS NULL ORDER BY allocation_year,id FOR UPDATE`,
    );
    const movedLists = [];
    for (const cycle of cycles) {
      const [lists] = await connection.query(
        `SELECT id,department FROM allocation_rank_lists WHERE cycle_id=?
         ORDER BY FIELD(department,'Deck','Engine') FOR UPDATE`, [cycle.id],
      );
      if (!lists.length) throw new Error(`Allocation ${cycle.allocation_number} has no department rank list`);

      await connection.query(
        `UPDATE allocation_cycles SET department=?,updated_at=updated_at WHERE id=?`,
        [lists[0].department, cycle.id],
      );
      for (const list of lists.slice(1)) {
        const cycleId = uuidv4();
        const allocationNumber = await nextAllocationNumber(connection, cycle.allocation_year);
        await connection.query(
          `INSERT INTO allocation_cycles
           (id,allocation_number,allocation_year,department,status,created_by,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?)`,
          [cycleId, allocationNumber, cycle.allocation_year, list.department, cycle.status,
            cycle.created_by, cycle.created_at, cycle.updated_at],
        );
        await connection.query(
          `UPDATE allocation_rank_lists SET cycle_id=?,updated_at=updated_at WHERE id=?`,
          [cycleId, list.id],
        );
        movedLists.push({ previous_number: cycle.allocation_number, allocation_number: allocationNumber, department: list.department });
      }
    }
    await connection.commit();
    return movedLists;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = { createCycle, splitCombinedCycles };
