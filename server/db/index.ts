import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://postgres:meet24@localhost:5432/mathsy_meet";

export const pool = new Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("[PostgreSQL] Unexpected error on idle client:", err.message);
});

export async function query(text: string, params?: any[]) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === "development") {
      // console.log("[PostgreSQL Query]", { text: text.slice(0, 80), duration, rows: res.rowCount });
    }
    return res;
  } catch (err: any) {
    console.error("[PostgreSQL Error]:", err.message, "in query:", text);
    throw err;
  }
}

export async function initDb(): Promise<boolean> {
  try {
    console.log(`[PostgreSQL] Connecting to database: ${connectionString.replace(/:[^:@]+@/, ":****@")}`);
    const client = await pool.connect();
    try {
      const schemaPath = path.join(__dirname, "schema.sql");
      if (fs.existsSync(schemaPath)) {
        const schemaSql = fs.readFileSync(schemaPath, "utf-8");
        await client.query(schemaSql);
        console.log("[PostgreSQL] Schema initialized successfully. All tables verified.");
      } else {
        console.warn("[PostgreSQL] schema.sql not found at", schemaPath);
      }

      // Run database migrations in migrations/ directory
      const migrationsDir = path.join(__dirname, "migrations");
      if (fs.existsSync(migrationsDir)) {
        const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
        for (const file of files) {
          const migrationSql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
          await client.query(migrationSql);
          console.log(`[PostgreSQL] Applied migration: ${file}`);
        }
      }
      return true;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.warn("\n⚠️  [PostgreSQL Connection Warning]:", err.message);
    console.warn("   Make sure PostgreSQL is running on port 5432 or configure DATABASE_URL in your .env file.");
    console.warn("   Tip: Run 'docker compose up -d' to start a local PostgreSQL container.\n");
    return false;
  }
}
