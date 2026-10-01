const db = require('../config/database');
const { clearSchemaCache } = require('./schemaCompatibilityService');

// This migration only adds metadata; it never disables an existing allocation.
const ensureAllocationSoftDeleteSupport = async () => {
  const columns = {
    deleted_at: 'TIMESTAMP NULL DEFAULT NULL',
    deleted_by: 'VARCHAR(36) NULL',
    delete_reason: 'TEXT NULL',
  };
  for (const [column, definition] of Object.entries(columns)) {
    const [rows] = await db.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='allocation_cycles' AND COLUMN_NAME=?`,
      [column],
    );
    if (!rows.length) {
      await db.query(`ALTER TABLE allocation_cycles ADD COLUMN ${column} ${definition}`);
      clearSchemaCache();
    }
  }
};

module.exports = { ensureAllocationSoftDeleteSupport };
