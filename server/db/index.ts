import pg from "pg";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://postgres:meet24@localhost:5432/mathsy_meet";

const isLocalhost = connectionString.includes("localhost") || connectionString.includes("127.0.0.1");

export const pool = new Pool({
  connectionString,
  max: 50,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: isLocalhost ? false : { rejectUnauthorized: false },
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

export const MIGRATION_ADVISORY_LOCK_ID = 849204812;

export interface MigrationResult {
  file: string;
  checksum: string;
  status: "applied" | "skipped";
  durationMs: number;
}

/**
 * Resolves the location of schema.sql.
 * Supports:
 * - Compiled production layout: dist-server/db/schema.sql
 * - Development source layout: server/db/schema.sql
 * - Custom overrides
 * Throws a clear, secret-free error if the file cannot be located.
 */
export function resolveSchemaPath(customPath?: string): string {
  if (customPath) {
    if (fs.existsSync(customPath)) return customPath;
    throw new Error(`Configured schema.sql path does not exist: ${customPath}`);
  }

  const candidates = [
    path.join(__dirname, "db", "schema.sql"),
    path.join(__dirname, "schema.sql"),
    path.resolve(process.cwd(), "dist-server/db/schema.sql"),
    path.resolve(process.cwd(), "server/db/schema.sql"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Required database schema file 'schema.sql' could not be found. Checked: [${candidates.join(", ")}]. Ensure production build copies schema to dist-server/db/schema.sql.`
  );
}

/**
 * Resolves the migrations directory.
 * Supports:
 * - Compiled production layout: dist-server/db/migrations
 * - Development source layout: server/db/migrations
 * - Custom overrides
 * Throws a clear, secret-free error if the directory cannot be located.
 */
export function resolveMigrationsDir(customDir?: string): string {
  if (customDir) {
    if (fs.existsSync(customDir) && fs.statSync(customDir).isDirectory()) return customDir;
    throw new Error(`Configured migrations directory does not exist or is not a directory: ${customDir}`);
  }

  const candidates = [
    path.join(__dirname, "db", "migrations"),
    path.join(__dirname, "migrations"),
    path.resolve(process.cwd(), "dist-server/db/migrations"),
    path.resolve(process.cwd(), "server/db/migrations"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  throw new Error(
    `Required migrations directory could not be found. Checked: [${candidates.join(", ")}]. Ensure production build copies migrations to dist-server/db/migrations/.`
  );
}

export interface RunMigrationsOptions {
  client?: pg.PoolClient;
  migrationsDir?: string;
  skipLock?: boolean;
}

/**
 * Executes database migrations with PostgreSQL session advisory lock and schema_migrations tracking.
 * - Concurrency safe: Only one process can execute migrations at a time.
 * - Idempotent: Migrations already recorded in schema_migrations are skipped if checksum matches.
 * - Checksum enforced: Throws if an applied migration's content has been altered.
 * - Transactional: Each migration runs in BEGIN...COMMIT with rollback on error.
 * - Auditable: Tracks file name, SHA-256 checksum, executed_at, and duration.
 */
export async function runMigrations(options: RunMigrationsOptions = {}): Promise<MigrationResult[]> {
  const client = options.client || (await pool.connect());
  const shouldRelease = !options.client;
  let lockAcquired = false;

  const results: MigrationResult[] = [];

  try {
    // 1. Acquire PostgreSQL session advisory lock unless already held by caller
    if (!options.skipLock) {
      await client.query("SELECT pg_advisory_lock($1);", [MIGRATION_ADVISORY_LOCK_ID]);
      lockAcquired = true;
    }

    // 2. Ensure schema_migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        checksum VARCHAR(64) NOT NULL,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        execution_time_ms INTEGER NOT NULL
      );
    `);

    // 3. Query existing applied migrations
    const existingRes = await client.query("SELECT name, checksum FROM schema_migrations;");
    const appliedMap = new Map<string, string>();
    for (const row of existingRes.rows) {
      appliedMap.set(row.name, row.checksum);
    }

    // 4. Resolve migrations directory (fails fast with descriptive error if missing)
    const targetDir = resolveMigrationsDir(options.migrationsDir);
    const files = fs.readdirSync(targetDir).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      const filePath = path.join(targetDir, file);
      const sqlContent = fs.readFileSync(filePath, "utf-8");
      const checksum = crypto.createHash("sha256").update(sqlContent).digest("hex");

      if (appliedMap.has(file)) {
        const recordedChecksum = appliedMap.get(file);
        if (recordedChecksum !== checksum) {
          throw new Error(
            `Migration checksum mismatch for '${file}'. Recorded checksum: ${recordedChecksum}, active file checksum: ${checksum}. Previously applied migrations must not be modified.`
          );
        }
        results.push({
          file,
          checksum,
          status: "skipped",
          durationMs: 0,
        });
        continue;
      }

      // Execute migration inside an isolated transaction
      const startTime = Date.now();
      await client.query("BEGIN;");
      try {
        await client.query(sqlContent);
        const durationMs = Date.now() - startTime;

        await client.query(
          "INSERT INTO schema_migrations (name, checksum, execution_time_ms) VALUES ($1, $2, $3);",
          [file, checksum, durationMs]
        );
        await client.query("COMMIT;");

        console.log(`[PostgreSQL] Applied migration: ${file} (${durationMs}ms)`);
        results.push({
          file,
          checksum,
          status: "applied",
          durationMs,
        });
      } catch (migrationErr: any) {
        await client.query("ROLLBACK;");
        console.error(`[PostgreSQL] Migration failed: ${file}:`, migrationErr.message);
        throw new Error(`Migration ${file} failed: ${migrationErr.message}`);
      }
    }

    return results;
  } finally {
    if (lockAcquired) {
      try {
        await client.query("SELECT pg_advisory_unlock($1);", [MIGRATION_ADVISORY_LOCK_ID]);
      } catch (unlockErr: any) {
        console.error("[PostgreSQL] Error releasing advisory lock:", unlockErr.message);
      }
    }
    if (shouldRelease) {
      client.release();
    }
  }
}

export interface InitDbOptions {
  schemaPath?: string;
  migrationsDir?: string;
}

/**
 * Initializes database schema and executes migrations.
 * Wraps BOTH baseline schema and migrations inside the PostgreSQL advisory lock
 * to prevent concurrent container boots from running uncoordinated DDL.
 */
export async function initDb(options: InitDbOptions = {}): Promise<boolean> {
  let client: pg.PoolClient | null = null;
  let lockAcquired = false;

  try {
    console.log(`[PostgreSQL] Connecting to database: ${connectionString.replace(/:[^:@]+@/, ":****@")}`);
    client = await pool.connect();

    // 1. Acquire PostgreSQL session advisory lock BEFORE any DDL or initialization runs
    await client.query("SELECT pg_advisory_lock($1);", [MIGRATION_ADVISORY_LOCK_ID]);
    lockAcquired = true;

    // 2. Resolve and apply baseline schema under advisory lock
    const schemaFile = resolveSchemaPath(options.schemaPath);
    const schemaSql = fs.readFileSync(schemaFile, "utf-8");
    await client.query(schemaSql);
    console.log(`[PostgreSQL] Schema initialized successfully from ${schemaFile}. All tables verified.`);

    // 3. Run database migrations under the same advisory lock
    await runMigrations({ client, migrationsDir: options.migrationsDir, skipLock: true });
    return true;
  } catch (err: any) {
    console.error("\n🚨 [PostgreSQL Initialization Error]:", err.message);
    if (
      process.env.NODE_ENV === "production" ||
      options.schemaPath ||
      options.migrationsDir ||
      err.message?.includes("checksum mismatch") ||
      err.message?.includes("could not be found") ||
      err.message?.includes("syntax error") ||
      err.message?.includes("failed:")
    ) {
      throw err;
    }
    console.warn("   Make sure PostgreSQL is running on port 5432 or configure DATABASE_URL in your .env file.");
    console.warn("   Tip: Run 'docker compose up -d' to start a local PostgreSQL container.\n");
    return false;
  } finally {
    if (client) {
      if (lockAcquired) {
        try {
          await client.query("SELECT pg_advisory_unlock($1);", [MIGRATION_ADVISORY_LOCK_ID]);
        } catch (unlockErr: any) {
          console.error("[PostgreSQL] Error releasing advisory lock in initDb:", unlockErr.message);
        }
      }
      client.release();
    }
  }
}


