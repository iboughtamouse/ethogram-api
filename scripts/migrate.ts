import "dotenv/config";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Pool } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error("DATABASE_URL environment variable is required");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('rlwy.net') || databaseUrl.includes('railway.app')
      ? { rejectUnauthorized: false }
      : false
  });

  try {
    // Ensure migrations tracking table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Get all migration files, sorted
    const migrationsDir = join(__dirname, "..", "migrations");
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    // Get already applied migrations
    const { rows: appliedRows } = await pool.query(
      "SELECT name FROM migrations"
    );
    const applied = new Set(appliedRows.map((r: { name: string }) => r.name));

    // Filter to pending migrations
    const pending = files.filter((f) => !applied.has(f));

    console.log(
      `Found ${files.length} migration(s), ${pending.length} pending`
    );

    for (const file of pending) {
      console.log(`Running: ${file}`);
      const sql = readFileSync(join(migrationsDir, file), "utf-8");

      // Run migration in a transaction
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`  ✓ Complete`);
      } catch (error) {
        await client.query("ROLLBACK");
        console.error(`Migration failed in ${file}:`, error);
        process.exit(1);
      } finally {
        client.release();
      }
    }

    console.log("\nAll migrations complete");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
