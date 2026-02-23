const fs = require('fs');
const path = require('path');
const db = require('../config/database');

const setup = async () => {
  try {
    console.log('Starting database setup...');
    const sqlPath = path.join(__dirname, '../../setup_submissions.sql');

    if (!fs.existsSync(sqlPath)) {
      throw new Error(`File not found: ${sqlPath}`);
    }

    const sql = fs.readFileSync(sqlPath, 'utf8');
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      await db.query(statement);
      console.log(
        'Executed:',
        statement.substring(0, 50).replace(/(\r\n|\n|\r)/gm, ' ') + '...',
      );
    }

    console.log('✅ Database setup completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Setup failed:', error);
    process.exit(1);
  }
};

setup();
