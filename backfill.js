const db = require('./src/config/database');

async function backfill() {
  try {
    const [result] = await db.query(`
      UPDATE cadets c 
      JOIN recruitment_drives rd ON c.institute_id = rd.institute_id 
        AND c.batch_year = COALESCE(rd.year, YEAR(rd.created_at)) 
        AND c.course LIKE CONCAT('%', rd.course_type, '%') 
      SET c.drive_id = rd.id 
      WHERE c.drive_id IS NULL OR c.drive_id = ''
    `);
    console.log("Backfill result:", result);
  } catch (err) {
    console.error("Error backfilling:", err);
  } finally {
    process.exit(0);
  }
}

backfill();
