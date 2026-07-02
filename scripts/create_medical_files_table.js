require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../src/config/database');

const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

async function run() {
  console.log('Starting medical files migration...');

  try {
    // 1. Create table
    await db.query(`
      CREATE TABLE IF NOT EXISTS cadet_medical_result_files (
          id VARCHAR(255) PRIMARY KEY,
          medical_result_id VARCHAR(255) NOT NULL,
          file_name VARCHAR(255),
          file_path VARCHAR(255),
          mime_type VARCHAR(100),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Table cadet_medical_result_files created or already exists.');

    // 2. Migrate existing data
    const [rows] = await db.query(`SELECT id, report_data, report_name, report_mime_type FROM cadet_medical_results WHERE report_data IS NOT NULL`);
    console.log(`Found ${rows.length} rows to migrate in cadet_medical_results.`);

    for (const row of rows) {
      if (!row.report_data) continue;

      const originalName = row.report_name || 'report.bin';
      const ext = path.extname(originalName) || '';
      const filename = `${uuidv4()}${ext}`;
      const filepath = path.join(uploadsDir, filename);

      fs.writeFileSync(filepath, row.report_data);

      const newPathUrl = `/uploads/${filename}`;
      const fileId = uuidv4();

      // Insert into new table
      await db.query(
        `INSERT INTO cadet_medical_result_files (id, medical_result_id, file_name, file_path, mime_type) VALUES (?, ?, ?, ?, ?)`,
        [fileId, row.id, filename, newPathUrl, row.report_mime_type]
      );

      // Clear blob
      await db.query(
        `UPDATE cadet_medical_results SET report_data = NULL, report_name = ? WHERE id = ?`,
        [filename, row.id]
      );

      console.log(`Migrated medical report for result ID ${row.id} to ${filename}`);
    }

    console.log('Medical files migration complete.');
  } catch (err) {
    console.error(`Error migrating medical files:`, err.message);
  }

  process.exit(0);
}

run();
