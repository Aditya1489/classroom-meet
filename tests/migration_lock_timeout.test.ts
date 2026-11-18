import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pg from "pg";
import { pool, runMigrations, MIGRATION_ADVISORY_LOCK_ID } from "../server/db";

/**
 * A migration advisory lock held by another session (or leaked on a pooled connection) must never hang
 * startup forever: with nothing pending we continue, with pending migrations we fail fast and loudly.
 */
describe("Migration lock: bounded wait instead of hanging", () => {
  let holder: pg.Client;
  let emptyDir: string;
  let pendingDir: string;

  before(async () => {
    holder = new pg.Client({ connectionString: (pool as any).options.connectionString, ssl: (pool as any).options.ssl });
    await holder.connect();
    const got = await holder.query("SELECT pg_try_advisory_lock($1) AS locked;", [MIGRATION_ADVISORY_LOCK_ID]);
    assert.equal(got.rows[0].locked, true, "setup: test session holds the migration lock");

    emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-none-"));
    pendingDir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-pending-"));
    fs.writeFileSync(path.join(pendingDir, `999_lock_timeout_probe_${Date.now()}.sql`), "SELECT 1;");
  });

  after(async () => {
    await holder.query("SELECT pg_advisory_unlock($1);", [MIGRATION_ADVISORY_LOCK_ID]).catch(() => {});
    await holder.end().catch(() => {});
    fs.rmSync(emptyDir, { recursive: true, force: true });
    fs.rmSync(pendingDir, { recursive: true, force: true });
    await pool.end().catch(() => {});
  });

  it("continues without the lock when no migrations are pending", async () => {
    const started = Date.now();
    const results = await runMigrations({ migrationsDir: emptyDir, lockTimeoutMs: 1500 });
    const elapsed = Date.now() - started;
    assert.deepEqual(results, []);
    assert.ok(elapsed < 10000, `must not hang (took ${elapsed}ms)`);
  });

  it("fails fast with a clear error when migrations are pending and the lock stays busy", async () => {
    const started = Date.now();
    await assert.rejects(
      () => runMigrations({ migrationsDir: pendingDir, lockTimeoutMs: 1500 }),
      /Timed out waiting for the migration lock/
    );
    assert.ok(Date.now() - started < 10000, "must not hang");
  });
});
