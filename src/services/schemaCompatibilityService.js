const db = require('../config/database');

const tableCache = new Map();
const columnCache = new Map();
let isWarmed = false;

const warmCache = async () => {
  if (isWarmed) return;

  try {
    // 1. Get all tables in the current database
    const [tables] = await db.query(
      `SELECT TABLE_NAME 
       FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE()`
    );
    
    tableCache.clear();
    tables.forEach(t => tableCache.set(t.TABLE_NAME, true));

    // 2. Get all columns for all tables in the current database
    const [columns] = await db.query(
      `SELECT TABLE_NAME, COLUMN_NAME 
       FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE()`
    );

    columnCache.clear();
    columns.forEach(c => {
      if (!columnCache.has(c.TABLE_NAME)) {
        columnCache.set(c.TABLE_NAME, new Set());
      }
      columnCache.get(c.TABLE_NAME).add(c.COLUMN_NAME);
    });

    isWarmed = true;
    console.log('Schema cache warmed successfully');
  } catch (error) {
    console.error('Error warming schema cache:', error);
  }
};

const getTableColumns = async (tableName) => {
  if (!isWarmed) await warmCache();
  return columnCache.get(tableName) || new Set();
};

const hasTable = async (tableName) => {
  if (!isWarmed) await warmCache();
  return tableCache.has(tableName);
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
  isWarmed = false;
};

module.exports = {
  hasTable,
  hasColumn,
  getTableColumns,
  filterExistingColumns,
  pickExistingColumns,
  clearSchemaCache,
  warmCache,
};
