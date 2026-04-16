const db = require('../config/database');

const tableCache = new Map();
const columnCache = new Map();

const getTableColumns = async (tableName) => {
  if (columnCache.has(tableName)) {
    return columnCache.get(tableName);
  }

  const [rows] = await db.query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?`,
    [tableName],
  );

  const columns = new Set(rows.map((row) => row.COLUMN_NAME));
  columnCache.set(tableName, columns);
  return columns;
};

const hasTable = async (tableName) => {
  if (tableCache.has(tableName)) {
    return tableCache.get(tableName);
  }

  const [rows] = await db.query(
    `SELECT 1
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
     LIMIT 1`,
    [tableName],
  );

  const exists = rows.length > 0;
  tableCache.set(tableName, exists);
  return exists;
};

const hasColumn = async (tableName, columnName) => {
  const columns = await getTableColumns(tableName);
  return columns.has(columnName);
};

const filterExistingColumns = async (tableName, data = {}) => {
  const columns = await getTableColumns(tableName);
  return Object.fromEntries(
    Object.entries(data).filter(
      ([key, value]) => value !== undefined && columns.has(key),
    ),
  );
};

const pickExistingColumns = async (tableName, columnNames = []) => {
  const columns = await getTableColumns(tableName);
  return columnNames.filter((columnName) => columns.has(columnName));
};

const clearSchemaCache = () => {
  tableCache.clear();
  columnCache.clear();
};

module.exports = {
  hasTable,
  hasColumn,
  getTableColumns,
  filterExistingColumns,
  pickExistingColumns,
  clearSchemaCache,
};
