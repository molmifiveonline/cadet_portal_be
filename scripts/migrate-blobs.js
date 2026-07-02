require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../src/config/database');

const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

async function migrateTable(tableName, idCol, blobCol, nameCol, mimeCol, pathColToUpdate = null) {
  console.log(`Migrating ${tableName}...`);
  try {
    const [rows] = await db.query(`SELECT ${idCol}, ${blobCol}, ${nameCol} FROM ${tableName} WHERE ${blobCol} IS NOT NULL`);
    console.log(`Found ${rows.length} rows to migrate in ${tableName}.`);
    
    for (const row of rows) {
      if (!row[blobCol]) continue;
      
      const originalName = row[nameCol] || 'file.bin';
      const ext = path.extname(originalName) || '';
      const filename = `${uuidv4()}${ext}`;
      const filepath = path.join(uploadsDir, filename);
      
      fs.writeFileSync(filepath, row[blobCol]);
      
      const newPathUrl = `/uploads/${filename}`;
      
      let updateSql = `UPDATE ${tableName} SET ${blobCol} = NULL`;
      let params = [];
      
      if (pathColToUpdate) {
         updateSql += `, ${pathColToUpdate} = ?`;
         params.push(newPathUrl);
      }
      // Also update the name column to filename just in case
      updateSql += `, ${nameCol} = ? WHERE ${idCol} = ?`;
      params.push(filename, row[idCol]);
      
      await db.query(updateSql, params);
      console.log(`Migrated ID ${row[idCol]} to ${filename}`);
    }
  } catch (err) {
    console.error(`Error migrating ${tableName}:`, err.message);
  }
}

async function run() {
  console.log('Starting migration...');
  
  // cadets.photo_data
  await migrateTable('cadets', 'id', 'photo_data', 'photo_name', 'photo_mime_type', 'photo_path');
  
  // documents.document_data
  await migrateTable('documents', 'id', 'document_data', 'document_name', 'document_mime_type');
  
  // assessments.essay_data
  await migrateTable('assessments', 'cadet_id', 'essay_data', 'essay_name', 'essay_mime_type');
  
  // interviews.interview_sheet_data
  await migrateTable('interviews', 'cadet_id', 'interview_sheet_data', 'interview_sheet_name', 'interview_sheet_mime_type');
  
  console.log('Migration complete.');
  process.exit(0);
}

run();
