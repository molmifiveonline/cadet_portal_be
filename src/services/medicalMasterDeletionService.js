const db = require('../config/database');

// Check structured references, including secondary appointments and historical
// results. Do not restrict these checks to active centers or pending medicals.
const masters = {
  center: {
    table: 'medical_centers',
    label: 'medical center',
    dependencies: [
      [
        'cadet_medicals',
        'cadet medical appointments or results',
        'cadet_medical_results',
        `d.medical_center_id = m.id COLLATE utf8mb4_unicode_ci
        OR JSON_CONTAINS(JSON_EXTRACT(d.appointments, '$[*].medical_center_id'), JSON_QUOTE(m.id))`,
      ],
    ],
  },
  report: {
    table: 'medical_reports',
    label: 'medical report',
    dependencies: [
      [
        'centers',
        'medical centers',
        'medical_centers',
        'JSON_CONTAINS(d.medical_reports, JSON_QUOTE(m.id))',
      ],
      [
        'cadet_medicals',
        'cadet medical appointments or results',
        'cadet_medical_results',
        `JSON_CONTAINS(JSON_EXTRACT(d.appointments, '$[*].medical_reports'), JSON_QUOTE(m.id))
        OR JSON_CONTAINS(JSON_EXTRACT(d.report_results, '$[*].report_id'), JSON_QUOTE(m.id))`,
      ],
    ],
  },
};

const getMedicalDependencySelect = (kind, lockRows = false) =>
  masters[kind].dependencies
    .map(
      ([key, , table, condition]) =>
        `EXISTS (SELECT 1 FROM ${table} d WHERE (${condition}) ${lockRows ? 'FOR UPDATE' : ''}) AS has_${key}`,
    )
    .join(', ');

const getMedicalDeletionInfo = (kind, row) => {
  const config = masters[kind];
  const linked = config.dependencies
    .filter(([key]) => Number(row[`has_${key}`]) > 0)
    .map(([, label]) => label);
  return {
    can_delete: linked.length === 0,
    delete_blocked_reason: linked.length
      ? `Cannot delete this ${config.label} because it is linked to ${linked.join(', ')}.`
      : null,
  };
};

const deleteUnusedMedicalMaster = async (kind, id) => {
  const config = masters[kind];
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT id FROM ${config.table} WHERE id = ? FOR UPDATE`,
      [id],
    );
    if (!rows.length) {
      await connection.rollback();
      return false;
    }
    const [[links]] = await connection.query(
      `SELECT ${getMedicalDependencySelect(kind, true)} FROM ${config.table} m WHERE m.id = ?`,
      [id],
    );
    const deletion = getMedicalDeletionInfo(kind, links);
    if (!deletion.can_delete) {
      throw Object.assign(new Error(deletion.delete_blocked_reason), {
        statusCode: 409,
      });
    }
    const [result] = await connection.query(
      `DELETE FROM ${config.table} WHERE id = ?`,
      [id],
    );
    await connection.commit();
    return result.affectedRows > 0;
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.errno === 1451) {
      throw Object.assign(
        new Error(
          `Cannot delete this ${config.label} because other records depend on it.`,
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
  getMedicalDependencySelect,
  getMedicalDeletionInfo,
  deleteUnusedMedicalMaster,
};
