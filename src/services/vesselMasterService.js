const db = require('../config/database');

const INITIAL_VESSEL_TYPES = ['DRY', 'LNG', 'LPG'];
const LEGACY_TYPE_MAPPING = Object.freeze({
  'Bulk Carrier': 'DRY',
  'Chemical Tanker': 'LPG',
  'Container Ship': 'DRY',
  'General Cargo': 'DRY',
  'LNG Carrier': 'LNG',
  'Offshore Support Vessel': 'LPG',
  'Oil Tanker': 'LPG',
  'Ro-Ro Vessel': 'DRY',
});

const ensureVesselMasterTypes = async () => {
  const [[{ count }]] = await db.query(
    'SELECT COUNT(*) AS count FROM vessel_types WHERE is_master = 1',
  );
  if (Number(count) > 0) return;

  for (const name of INITIAL_VESSEL_TYPES) {
    await db.query(
      `INSERT INTO vessel_types (id, name, department, status, is_master)
       VALUES (UUID(), ?, 'Both', 'Active', 1)
       ON DUPLICATE KEY UPDATE is_master = 1`,
      [name],
    );
  }
};

const listVesselMasterTypes = async () => {
  const [rows] = await db.query(
    `SELECT vt.id, vt.name, vt.department, vt.status
     FROM vessel_types vt
     WHERE vt.is_master = 1
     ORDER BY CASE WHEN vt.status = 'Active' THEN 0 ELSE 1 END, vt.name`,
  );
  return rows;
};

const findVesselMasterType = async ({ id, name }, connection = db) => {
  if (!id && !name) return null;
  const [rows] = await connection.query(
    `SELECT id, name, department, status FROM vessel_types
     WHERE is_master = 1 AND ${id ? 'id = ?' : 'LOWER(name) = LOWER(?)'} LIMIT 1`,
    [id || String(name).trim()],
  );
  return rows[0] || null;
};

const migrateLegacyVesselTypes = async () => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [masterRows] = await connection.query(
      'SELECT id, name FROM vessel_types WHERE is_master = 1',
    );
    const masterIds = new Map(masterRows.map((row) => [row.name, row.id]));

    for (const [oldName, newName] of Object.entries(LEGACY_TYPE_MAPPING)) {
      const [oldRows] = await connection.query(
        'SELECT id FROM vessel_types WHERE name = ? AND is_master = 0 FOR UPDATE',
        [oldName],
      );
      if (!oldRows[0]) continue;
      const newId = masterIds.get(newName);
      if (!newId) throw new Error(`Missing master vessel type: ${newName}`);
      const oldId = oldRows[0].id;

      await connection.query(
        'UPDATE vessels SET vessel_type_id = ?, vessel_type = ? WHERE vessel_type_id = ?',
        [newId, newName, oldId],
      );
      await connection.query(
        'UPDATE vessels SET vessel_type_id = ?, vessel_type = ? WHERE vessel_type_id IS NULL AND vessel_type = ?',
        [newId, newName, oldName],
      );
      await connection.query(
        'UPDATE allocations SET vessel_type_id = ? WHERE vessel_type_id = ?',
        [newId, oldId],
      );
      await connection.query(
        'UPDATE allocations SET secondary_vessel_type_id = ? WHERE secondary_vessel_type_id = ?',
        [newId, oldId],
      );
      await connection.query(
        'UPDATE joining_plans SET vessel_type = ? WHERE vessel_type = ?',
        [newName, oldName],
      );
      await connection.query('DELETE FROM vessel_types WHERE id = ?', [oldId]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = { ensureVesselMasterTypes, listVesselMasterTypes, findVesselMasterType, migrateLegacyVesselTypes };
