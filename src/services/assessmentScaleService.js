const db = require('../config/database');

// The stored maximum marks migrated entries, so repeated startup runs do not
// scale scores again. Preserve the original score editor and edit timestamp.
const migrateAssessmentScores = async (database = db) => {
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [invalid] = await connection.query(
      'SELECT id FROM allocation_score_entries WHERE max_score_snapshot <= 0 LIMIT 1',
    );
    if (invalid.length) throw new Error('Cannot convert an assessment with a non-positive maximum score');
    const [result] = await connection.query(
      `UPDATE allocation_score_entries
       SET score=ROUND(score * 100 / max_score_snapshot, 2),
           max_score_snapshot=100, updated_at=updated_at
       WHERE max_score_snapshot<>100`,
    );
    const [lists] = await connection.query(
      'SELECT id,formula_snapshot FROM allocation_rank_lists WHERE formula_snapshot IS NOT NULL FOR UPDATE',
    );
    for (const list of lists) {
      const snapshot = typeof list.formula_snapshot === 'string'
        ? JSON.parse(list.formula_snapshot) : list.formula_snapshot;
      if (!Array.isArray(snapshot?.components) || !snapshot.components.some((component) => Number(component.max_score) !== 100)) continue;
      snapshot.components = snapshot.components.map((component) => ({ ...component, max_score: 100 }));
      await connection.query(
        'UPDATE allocation_rank_lists SET formula_snapshot=?,updated_at=updated_at WHERE id=?',
        [JSON.stringify(snapshot), list.id],
      );
    }
    await connection.commit();
    return result.affectedRows;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = { migrateAssessmentScores };
