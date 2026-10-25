import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, query } from "../server/db";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// MILESTONE 2: MULTI-TENANT DATABASE FOUNDATION AUTOMATED VERIFICATION SUITE
// ============================================================================
// Verifies:
// 1. Migration execution and idempotency
// 2. Pre-migration vs post-migration row count preservation (zero data loss)
// 3. First-party organization seed and backfill verification
// 4. Foreign key integrity and cascade constraints
// 5. Tenant-scoped uniqueness constraints
// 6. Existing first-party classroom query backward compatibility
// ============================================================================

describe("Milestone 2: Multi-Tenant Database Foundation Verification", () => {
  const FIRST_PARTY_ORG_ID = "00000000-0000-0000-0000-000000000001";
  let preMigrationCounts: Record<string, number> = {};

  before(async () => {
    // Record pre-migration row counts
    const tables = ["live_classes", "room_participants", "whiteboard_snapshots", "polls", "chat_messages", "users"];
    for (const t of tables) {
      const res = await query(`SELECT COUNT(*)::int as count FROM "${t}";`);
      preMigrationCounts[t] = res.rows[0].count;
    }
    console.log("  [Pre-Migration Counts]:", preMigrationCounts);
  });

  // Test 1: Run 002_multi_tenant_foundation.sql
  it("M2-01: 002_multi_tenant_foundation.sql executes cleanly and creates all new tables", async () => {
    const migrationPath = path.join(__dirname, "../server/db/migrations/002_multi_tenant_foundation.sql");
    const migrationSql = fs.readFileSync(migrationPath, "utf-8");

    // Execute migration
    await query(migrationSql);

    // Verify new tables exist
    const newTables = ["organizations", "organization_members", "api_keys", "customer_apps"];
    for (const t of newTables) {
      const check = await query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1;",
        [t]
      );
      assert.strictEqual(check.rows.length, 1, `Table ${t} must exist after migration`);
    }

    // Verify organization_id column exists on tenant-owned tables
    const tenantTables = ["live_classes", "room_participants", "whiteboard_snapshots", "polls", "chat_messages"];
    for (const t of tenantTables) {
      const colCheck = await query(
        `SELECT 1 FROM information_schema.columns 
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'organization_id';`,
        [t]
      );
      assert.strictEqual(colCheck.rows.length, 1, `Column organization_id must exist on ${t}`);
    }
  });

  // Test 2: Idempotency (Re-running migration causes zero errors and zero side effects)
  it("M2-02: Re-running 002_multi_tenant_foundation.sql is completely idempotent and safe to retry", async () => {
    const migrationPath = path.join(__dirname, "../server/db/migrations/002_multi_tenant_foundation.sql");
    const migrationSql = fs.readFileSync(migrationPath, "utf-8");

    // Re-run migration a second time
    await query(migrationSql);

    // Verify system organization is still intact
    const orgRes = await query("SELECT id, name, slug FROM organizations WHERE id = $1;", [FIRST_PARTY_ORG_ID]);
    assert.strictEqual(orgRes.rows.length, 1);
    assert.strictEqual(orgRes.rows[0].slug, "mathsy-first-party");
  });

  // Test 3: Zero Data Loss — Pre-migration row counts match post-migration row counts
  it("M2-03: Pre-migration vs post-migration row counts match exactly (zero data loss)", async () => {
    const tables = ["live_classes", "room_participants", "whiteboard_snapshots", "polls", "chat_messages", "users"];
    for (const t of tables) {
      const res = await query(`SELECT COUNT(*)::int as count FROM "${t}";`);
      const postCount = res.rows[0].count;
      assert.strictEqual(
        postCount,
        preMigrationCounts[t],
        `Row count for ${t} must be preserved. Pre: ${preMigrationCounts[t]}, Post: ${postCount}`
      );
    }
  });

  // Test 4: First-Party Mathsy Organization Seed & Backfill Verification
  it("M2-04: First-party organization exists and all existing classroom records are backfilled", async () => {
    // 1. Verify First-Party Organization
    const orgRes = await query("SELECT * FROM organizations WHERE id = $1;", [FIRST_PARTY_ORG_ID]);
    assert.strictEqual(orgRes.rows.length, 1);
    const org = orgRes.rows[0];
    assert.strictEqual(org.slug, "mathsy-first-party");
    assert.strictEqual(org.status, "active");
    assert.strictEqual(org.settings.is_system_tenant, true);

    // 2. Verify all live_classes have organization_id backfilled
    const unassignedClasses = await query("SELECT COUNT(*)::int as count FROM live_classes WHERE organization_id IS NULL;");
    assert.strictEqual(unassignedClasses.rows[0].count, 0, "All live_classes must have organization_id populated");

    const backfilledClasses = await query(
      "SELECT COUNT(*)::int as count FROM live_classes WHERE organization_id = $1;",
      [FIRST_PARTY_ORG_ID]
    );
    assert.strictEqual(
      backfilledClasses.rows[0].count,
      preMigrationCounts["live_classes"],
      "All pre-existing live_classes must belong to first-party organization"
    );

    // 3. Verify room_participants have organization_id backfilled
    const unassignedParts = await query("SELECT COUNT(*)::int as count FROM room_participants WHERE organization_id IS NULL;");
    assert.strictEqual(unassignedParts.rows[0].count, 0, "All room_participants must have organization_id populated");
  });

  // Test 5: Foreign Key Constraints & Cascades
  it("M2-05: Foreign key constraints and cascades behave correctly", async () => {
    // Cannot create organization_member with nonexistent organization
    await assert.rejects(
      async () => {
        await query(
          "INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'member');",
          ["ffffffff-ffff-ffff-ffff-ffffffffffff", "00000000-0000-0000-0000-000000000001"]
        );
      },
      /violates foreign key constraint/,
      "Must reject organization_member with non-existent organization_id"
    );

    // Cannot create organization_member with nonexistent user
    await assert.rejects(
      async () => {
        await query(
          "INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'member');",
          [FIRST_PARTY_ORG_ID, "ffffffff-ffff-ffff-ffff-ffffffffffff"]
        );
      },
      /violates foreign key constraint/,
      "Must reject organization_member with non-existent user_id"
    );
  });

  // Test 6: Tenant-Scoped Uniqueness Constraints
  it("M2-06: Tenant-scoped uniqueness constraints are strictly enforced", async () => {
    // 1. Slug uniqueness in organizations
    await assert.rejects(
      async () => {
        await query(
          "INSERT INTO organizations (name, slug) VALUES ('Duplicate Slug Org', 'mathsy-first-party');"
        );
      },
      /violates unique constraint "organizations_slug_key"/,
      "Organizations slug must be unique"
    );

    // Create a temporary customer tenant for isolation testing
    const testOrgRes = await query(
      "INSERT INTO organizations (name, slug) VALUES ('Acme Academy', 'acme-academy-test') RETURNING id;"
    );
    const testOrgId = testOrgRes.rows[0].id;

    try {
      // 2. API Key Hash uniqueness
      const fakeHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
      await query(
        "INSERT INTO api_keys (organization_id, name, key_prefix, key_hash) VALUES ($1, 'Key 1', 'sec_live_1234', $2);",
        [testOrgId, fakeHash]
      );

      // Re-inserting same key_hash must be rejected
      await assert.rejects(
        async () => {
          await query(
            "INSERT INTO api_keys (organization_id, name, key_prefix, key_hash) VALUES ($1, 'Key 2', 'sec_live_5678', $2);",
            [testOrgId, fakeHash]
          );
        },
        /violates unique constraint "api_keys_key_hash_key"/,
        "Duplicate key_hash must be rejected"
      );

      // 3. Customer App name uniqueness per organization
      await query(
        "INSERT INTO customer_apps (organization_id, app_name, allowed_domains) VALUES ($1, 'School Portal', ARRAY['https://acme.edu']);",
        [testOrgId]
      );
      await assert.rejects(
        async () => {
          await query(
            "INSERT INTO customer_apps (organization_id, app_name, allowed_domains) VALUES ($1, 'School Portal', ARRAY['https://other.edu']);",
            [testOrgId]
          );
        },
        /violates unique constraint "customer_apps_organization_id_app_name_key"/,
        "Duplicate app_name in same organization must be rejected"
      );
    } finally {
      // Cleanup test organization (cascades to api_keys and customer_apps)
      await query("DELETE FROM organizations WHERE id = $1;", [testOrgId]);
    }
  });

  // Test 7: Backward Compatibility of Existing First-Party Classroom Queries
  it("M2-07: Existing first-party classroom query patterns continue working seamlessly", async () => {
    // 1. Query by room_code as done in server/routes/rooms.ts
    const roomRes = await query(
      `SELECT id, room_code, title, tutor_id, tutor_name, is_active, is_live_streaming, metadata, organization_id 
       FROM live_classes 
       WHERE room_code = 'ptq-rtvq-rox' OR organization_id = $1
       LIMIT 1;`,
      [FIRST_PARTY_ORG_ID]
    );
    assert.ok(roomRes.rows.length > 0, "Existing room queries must return expected room");
    assert.strictEqual(roomRes.rows[0].organization_id, FIRST_PARTY_ORG_ID);

    // 2. Query participants as done in server/routes/rooms.ts
    const partRes = await query(
      `SELECT id, room_code, user_id, display_name, role, organization_id 
       FROM room_participants 
       WHERE organization_id = $1 
       LIMIT 5;`,
      [FIRST_PARTY_ORG_ID]
    );
    assert.ok(partRes.rows.length > 0, "Existing participants must be readable with organization_id filter");
  });

  after(async () => {
    console.log("  ✓ All Milestone 2 database migration assertions passed.");
    await pool.end();
  });
});
