const db = require('../config/database');

// Historical formulas, scores and disabled allocation drives retain their links.
const dependencies = {
  assessment: [
    [
      'formulas',
      'score formulas',
      'score_formula_components',
      'd.course_id = m.id',
    ],
    [
      'scores',
      'cadet scores',
      'allocation_score_entries',
      'd.course_id = m.id',
    ],
  ],
  vessel: [
    [
      'allocations',
      'primary or secondary vessel allocations',
      'allocations',
      'd.vessel_id = m.id OR d.secondary_vessel_id = m.id',
    ],
  ],
};

const getAllocationMasterDependencySelect = (kind, lockRows = false) =>
  dependencies[kind]
    .map(
      ([key, , table, condition]) =>
        `EXISTS (SELECT 1 FROM ${table} d WHERE (${condition}) ${lockRows ? 'FOR UPDATE' : ''}) AS has_${key}`,
    )
    .join(', ');

const getAllocationMasterDeletionInfo = (kind, row) => {
  const linked = dependencies[kind]
    .filter(([key]) => Number(row[`has_${key}`]) > 0)
    .map(([, label]) => label);
  const subject = kind === 'assessment' ? 'assessment type' : 'vessel';
  return {
    can_delete: linked.length === 0,
    delete_blocked_reason: linked.length
      ? `Cannot delete this ${subject} because it is linked to ${linked.join(', ')}.`
      : null,
  };
};

const deleteUnusedVessel = async (id) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      'SELECT id FROM vessels WHERE id = ? FOR UPDATE',
      [id],
    );
    if (!rows.length) {
      await connection.rollback();
      return false;
    }
    const [[links]] = await connection.query(
      `SELECT ${getAllocationMasterDependencySelect('vessel', true)} FROM vessels m WHERE m.id = ?`,
      [id],
    );
    const deletion = getAllocationMasterDeletionInfo('vessel', links);
    if (!deletion.can_delete)
      throw Object.assign(new Error(deletion.delete_blocked_reason), {
        statusCode: 409,
      });
    const [result] = await connection.query(
      'DELETE FROM vessels WHERE id = ?',
      [id],
    );
    await connection.commit();
    return result.affectedRows > 0;
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.errno === 1451) {
      throw Object.assign(
        new Error(
          'Cannot delete this vessel because other records depend on it.',
        ),
        { statusCode: 409 },
      );
    }
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  getAllocationMasterDependencySelect,
  getAllocationMasterDeletionInfo,
  deleteUnusedVessel,
};
