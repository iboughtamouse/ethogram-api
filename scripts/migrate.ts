import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    // Get all migration files, sorted
    const migrationsDir = join(__dirname, '..', 'migrations');
    const files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`Found ${files.length} migration(s)`);

    for (const file of files) {
      console.log(`Running: ${file}`);
      const sql = readFileSync(join(migrationsDir, file), 'utf-8');
      await pool.query(sql);
      console.log(`  ✓ Complete`);
    }

    console.log('\nAll migrations complete');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
