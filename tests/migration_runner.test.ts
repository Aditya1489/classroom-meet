import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pool, query, runMigrations, initDb, resolveSchemaPath, resolveMigrationsDir, MIGRATION_ADVISORY_LOCK_ID } from "../server/db";

describe("Phase 7 Checkpoint 2: Migration Runner & Safe Concurrency", () => {
  let tempMigrationsDir: string;

  before(async () => {
    tempMigrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), "mathsy-migrations-test-"));
  });

  after(async () => {
    // Clean up temporary test migrations directory
    if (tempMigrationsDir && fs.existsSync(tempMigrationsDir)) {
      fs.rmSync(tempMigrationsDir, { recursive: true, force: true });
    }
    // Clean up test entries from schema_migrations
    await query("DELETE FROM schema_migrations WHERE name LIKE 'test_%';");
    await pool.end();
  });

  it("MIG-01: First application records migration into schema_migrations with SHA-256 checksum", async () => {
    const testMigName = "test_001_create_sample_table.sql";
    const testMigSql = `
      CREATE TABLE IF NOT EXISTS test_sample_users (
        id SERIAL PRIMARY KEY,
        test_val VARCHAR(50) NOT NULL
      );
    `;
    fs.writeFileSync(path.join(tempMigrationsDir, testMigName), testMigSql, "utf-8");

    const results = await runMigrations({ migrationsDir: tempMigrationsDir });
    const applied = results.find((r) => r.file === testMigName);

    assert.ok(applied, "Test migration must be reported");
    assert.strictEqual(applied.status, "applied", "First application must have status 'applied'");
    assert.ok(applied.durationMs >= 0, "Execution duration must be non-negative");
    assert.strictEqual(applied.checksum.length, 64, "Checksum must be 64-char hex (SHA-256)");

    // Verify row in schema_migrations table
    const dbRow = await query("SELECT * FROM schema_migrations WHERE name = $1;", [testMigName]);
    assert.strictEqual(dbRow.rows.length, 1, "Must be recorded in schema_migrations");
    assert.strictEqual(dbRow.rows[0].checksum, applied.checksum);
    assert.ok(dbRow.rows[0].execution_time_ms >= 0);

    // Verify the table was actually created
    const tableCheck = await query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'test_sample_users';"
    );
    assert.strictEqual(tableCheck.rows.length, 1, "Table test_sample_users must exist in DB");
  });

  it("MIG-02: Repeat execution skips already recorded migrations (idempotent startup)", async () => {
    const testMigName = "test_001_create_sample_table.sql";

    // Run again with the exact same migrations directory
    const results = await runMigrations({ migrationsDir: tempMigrationsDir });
    const skipped = results.find((r) => r.file === testMigName);

    assert.ok(skipped, "Test migration must be reported");
    assert.strictEqual(skipped.status, "skipped", "Repeated application must be skipped");
    assert.strictEqual(skipped.durationMs, 0, "Skipped migration duration should be 0");

    // Ensure count in schema_migrations did not increase
    const countRes = await query("SELECT COUNT(*)::int as count FROM schema_migrations WHERE name = $1;", [testMigName]);
    assert.strictEqual(countRes.rows[0].count, 1, "Must still have exactly one entry in schema_migrations");
  });

  it("MIG-03: Failed migration rolls back transaction and is NOT recorded, allowing clean retry", async () => {
    const failedMigName = "test_002_broken_syntax.sql";
    const invalidSql = "CREATE TABLE broken_table ( invalid syntax here !!! );";
    fs.writeFileSync(path.join(tempMigrationsDir, failedMigName), invalidSql, "utf-8");

    // Migration must reject
    await assert.rejects(
      async () => {
        await runMigrations({ migrationsDir: tempMigrationsDir });
      },
      /Migration test_002_broken_syntax.sql failed/
    );

    // Ensure broken migration is NOT in schema_migrations
    const checkRow = await query("SELECT * FROM schema_migrations WHERE name = $1;", [failedMigName]);
    assert.strictEqual(checkRow.rows.length, 0, "Failed migration must NOT be recorded in schema_migrations");

    // Now fix the migration and retry
    const fixedSql = "CREATE TABLE IF NOT EXISTS test_fixed_table ( id SERIAL PRIMARY KEY );";
    fs.writeFileSync(path.join(tempMigrationsDir, failedMigName), fixedSql, "utf-8");

    const retryResults = await runMigrations({ migrationsDir: tempMigrationsDir });
    const fixedResult = retryResults.find((r) => r.file === failedMigName);

    assert.ok(fixedResult, "Fixed migration should run");
    assert.strictEqual(fixedResult.status, "applied", "Fixed migration should successfully apply");

    // Verify record now exists
    const fixedRow = await query("SELECT * FROM schema_migrations WHERE name = $1;", [failedMigName]);
    assert.strictEqual(fixedRow.rows.length, 1, "Fixed migration must now be recorded");

    // Clean up test tables
    await query("DROP TABLE IF EXISTS test_fixed_table;");
    await query("DROP TABLE IF EXISTS test_sample_users;");
  });

  it("MIG-04: Concurrent migration attempts coordinate safely using PostgreSQL advisory locks", async () => {
    const concMigName = "test_003_concurrent_table.sql";
    const concSql = `
      CREATE TABLE IF NOT EXISTS test_concurrent_users (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;
    fs.writeFileSync(path.join(tempMigrationsDir, concMigName), concSql, "utf-8");

    // Launch two parallel migration runs simultaneously using separate clients
    const client1 = await pool.connect();
    const client2 = await pool.connect();

    try {
      const [res1, res2] = await Promise.all([
        runMigrations({ client: client1, migrationsDir: tempMigrationsDir }),
        runMigrations({ client: client2, migrationsDir: tempMigrationsDir }),
      ]);

      const applied1 = res1.find((r) => r.file === concMigName)?.status;
      const applied2 = res2.find((r) => r.file === concMigName)?.status;

      // Exactly one should have applied, and the other must have skipped cleanly!
      const appliedCount = (applied1 === "applied" ? 1 : 0) + (applied2 === "applied" ? 1 : 0);
      const skippedCount = (applied1 === "skipped" ? 1 : 0) + (applied2 === "skipped" ? 1 : 0);

      assert.strictEqual(appliedCount, 1, "Exactly one concurrent runner must apply the migration");
      assert.strictEqual(skippedCount, 1, "The second concurrent runner must cleanly skip the migration");

      // Verify DB row
      const row = await query("SELECT COUNT(*)::int as count FROM schema_migrations WHERE name = $1;", [concMigName]);
      assert.strictEqual(row.rows[0].count, 1, "Must have exactly 1 record in schema_migrations");
    } finally {
      client1.release();
      client2.release();
      await query("DROP TABLE IF EXISTS test_concurrent_users;");
    }
  });

  it("MIG-05: Migration checksum mismatch aborts startup and preserves recorded state", async () => {
    const migName = "test_004_checksum_enforcement.sql";
    const originalSql = "CREATE TABLE IF NOT EXISTS test_checksum_tbl ( id INT );";
    const alteredSql = "CREATE TABLE IF NOT EXISTS test_checksum_tbl ( id INT, altered_col TEXT );";

    const filePath = path.join(tempMigrationsDir, migName);
    fs.writeFileSync(filePath, originalSql, "utf-8");

    // 1. First run applies cleanly
    const firstRes = await runMigrations({ migrationsDir: tempMigrationsDir });
    const applied = firstRes.find((r) => r.file === migName);
    assert.strictEqual(applied?.status, "applied");
    const recordedChecksum = applied?.checksum;

    // 2. Tamper with the migration file on disk
    fs.writeFileSync(filePath, alteredSql, "utf-8");

    // 3. Second run must detect checksum mismatch and reject
    await assert.rejects(
      async () => {
        await runMigrations({ migrationsDir: tempMigrationsDir });
      },
      (err: any) => {
        return (
          err instanceof Error &&
          err.message.includes(`Migration checksum mismatch for '${migName}'`) &&
          err.message.includes("Previously applied migrations must not be modified")
        );
      }
    );

    // 4. Verify recorded checksum in DB was NOT overwritten or updated
    const dbCheck = await query("SELECT checksum FROM schema_migrations WHERE name = $1;", [migName]);
    assert.strictEqual(dbCheck.rows[0].checksum, recordedChecksum, "Recorded checksum must remain unmodified");

    // Cleanup
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await query("DELETE FROM schema_migrations WHERE name = $1;", [migName]);
    await query("DROP TABLE IF EXISTS test_checksum_tbl;");
  });

  it("MIG-06: Compiled and runtime asset path discovery correctly locates assets and fails fast when missing", () => {
    // 1. Successful resolution of schema and migrations in local environment
    const schemaPath = resolveSchemaPath();
    assert.ok(fs.existsSync(schemaPath), `Resolved schema path must exist: ${schemaPath}`);
    assert.ok(schemaPath.endsWith("schema.sql"));

    const migrationsDir = resolveMigrationsDir();
    assert.ok(fs.existsSync(migrationsDir), `Resolved migrations dir must exist: ${migrationsDir}`);
    assert.ok(fs.statSync(migrationsDir).isDirectory());

    // 2. Fails fast with clear descriptive error when pointing to nonexistent targets
    assert.throws(
      () => resolveSchemaPath("/invalid/path/nonexistent/schema.sql"),
      /Configured schema.sql path does not exist/
    );

    assert.throws(
      () => resolveMigrationsDir("/invalid/path/nonexistent/migrations"),
      /Configured migrations directory does not exist/
    );
  });

  it("MIG-07: Advisory lock releases cleanly after initDb failure without holding zombie locks", async () => {
    const invalidSchemaPath = path.join(os.tmpdir(), "mathsy_test_broken_schema.sql");
    fs.writeFileSync(invalidSchemaPath, "INVALID DDL SYNTAX HERE SHOULD FAIL;", "utf-8");

    try {
      // initDb should fail fast
      await assert.rejects(
        async () => {
          await initDb({ schemaPath: invalidSchemaPath, migrationsDir: tempMigrationsDir });
        },
        /syntax error/
      );

      // Verify advisory lock is released and can immediately be acquired by another connection
      const testClient = await pool.connect();
      try {
        const lockRes = await testClient.query("SELECT pg_try_advisory_lock($1) as acquired;", [MIGRATION_ADVISORY_LOCK_ID]);
        assert.strictEqual(lockRes.rows[0].acquired, true, "Advisory lock must be freed after initDb failure");
        await testClient.query("SELECT pg_advisory_unlock($1);", [MIGRATION_ADVISORY_LOCK_ID]);
      } finally {
        testClient.release();
      }
    } finally {
      if (fs.existsSync(invalidSchemaPath)) fs.unlinkSync(invalidSchemaPath);
    }
  });

  it("MIG-08: Concurrent initDb calls execute safely without catalog race conditions", async () => {
    const validSchemaPath = path.join(os.tmpdir(), "mathsy_test_valid_concurrent_schema.sql");
    fs.writeFileSync(validSchemaPath, "CREATE TABLE IF NOT EXISTS test_init_concurrent ( id INT PRIMARY KEY );", "utf-8");

    try {
      // Launch two initDb attempts concurrently
      const [res1, res2] = await Promise.all([
        initDb({ schemaPath: validSchemaPath, migrationsDir: tempMigrationsDir }),
        initDb({ schemaPath: validSchemaPath, migrationsDir: tempMigrationsDir }),
      ]);

      assert.strictEqual(res1, true, "First initDb must succeed");
      assert.strictEqual(res2, true, "Second concurrent initDb must succeed under advisory lock");

      // Clean up test table
      await query("DROP TABLE IF EXISTS test_init_concurrent;");
    } finally {
      if (fs.existsSync(validSchemaPath)) fs.unlinkSync(validSchemaPath);
    }
  });
});
