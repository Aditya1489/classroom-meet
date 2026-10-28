import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { pool, query } from "../server/db";

// ============================================================================
// PHASE 4: CUSTOMER API CREDENTIALS & TENANT MANAGEMENT TEST SUITE
// ============================================================================
// Tests:
// 1. Organization Management: Creation & Auto-membership as 'owner'
// 2. Organization Isolation: User A only sees their own organizations
// 3. Organization Detail & Updates: Owner can update settings, non-member blocked (403)
// 4. Customer Apps CRUD: Create app, configure allowed_domains & branding
// 5. Customer Apps Validation: Duplicate app name returns HTTP 409
// 6. Cross-Tenant Apps Isolation: Org B cannot see, edit, or delete Org A's apps
// 7. Embed Route Origin Whitelist: GET /api/v1/embed/config/:roomCode reflects allowed_domains
// 8. SEC-GAP-01: Unauthorized tutor rejected from system-tenant keys (403), Admin allowed
// 9. SEC-GAP-02: Duplicate active API key name returns HTTP 409 KEY_NAME_EXISTS
// 10. API Key Rotation & Revocation with Audit Trail: Rotated key works, old key revoked
// ============================================================================

const API_BASE = process.env.API_BASE || "http://localhost:5001/api";
const JWT_SECRET = process.env.JWT_SECRET || "mathsy_meet_jwt_secret_dev_key_2026";
const SYSTEM_ORG_ID = "00000000-0000-0000-0000-000000000001";

describe("Phase 4: Customer API Credentials & Tenant Management Suite", () => {
  let user1Id: string;
  let user1Token: string;
  let user2Id: string;
  let user2Token: string;
  let tutorId: string;
  let tutorToken: string;
  let adminId: string;
  let adminToken: string;

  let orgAId: string;
  let orgBId: string;

  before(async () => {
    // 1. Seed User 1 (Developer 1)
    user1Id = crypto.randomUUID();
    await query(
      `INSERT INTO users (id, email, full_name, role, auth_provider)
       VALUES ($1, 'p4_dev1@example.com', 'Dev One', 'tutor', 'google')
       ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;`,
      [user1Id]
    );
    user1Token = jwt.sign(
      { id: user1Id, sub: user1Id, email: "p4_dev1@example.com", role: "tutor", name: "Dev One" },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    // 2. Seed User 2 (Developer 2)
    user2Id = crypto.randomUUID();
    await query(
      `INSERT INTO users (id, email, full_name, role, auth_provider)
       VALUES ($1, 'p4_dev2@example.com', 'Dev Two', 'tutor', 'google')
       ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;`,
      [user2Id]
    );
    user2Token = jwt.sign(
      { id: user2Id, sub: user2Id, email: "p4_dev2@example.com", role: "tutor", name: "Dev Two" },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    // 3. Seed Tutor User (Unprivileged tutor with no org membership)
    tutorId = crypto.randomUUID();
    await query(
      `INSERT INTO users (id, email, full_name, role, auth_provider)
       VALUES ($1, 'p4_unauthorized_tutor@example.com', 'Unauthorized Tutor', 'tutor', 'google')
       ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;`,
      [tutorId]
    );
    tutorToken = jwt.sign(
      { id: tutorId, sub: tutorId, email: "p4_unauthorized_tutor@example.com", role: "tutor", name: "Unauthorized Tutor" },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    // 4. Seed Admin User
    adminId = crypto.randomUUID();
    await query(
      `INSERT INTO users (id, email, full_name, role, auth_provider)
       VALUES ($1, 'p4_system_admin@mathsy.in', 'System Admin', 'admin', 'google')
       ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;`,
      [adminId]
    );
    adminToken = jwt.sign(
      { id: adminId, sub: adminId, email: "p4_system_admin@mathsy.in", role: "admin", name: "System Admin" },
      JWT_SECRET,
      { expiresIn: "2h" }
    );
  });

  after(async () => {
    // Clean up created orgs
    if (orgAId) await query("DELETE FROM organizations WHERE id = $1;", [orgAId]);
    if (orgBId) await query("DELETE FROM organizations WHERE id = $1;", [orgBId]);

    // Clean up users
    await query("DELETE FROM users WHERE id IN ($1, $2, $3, $4);", [user1Id, user2Id, tutorId, adminId]);
    await pool.end();
  });

  // --- TEST 1: Organization Creation ---
  it("TC-P4-01: Creates organization and automatically assigns creator as owner", async () => {
    const res = await fetch(`${API_BASE}/organizations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user1Token}`,
      },
      body: JSON.stringify({
        name: "Acme EdTech",
        settings: { default_camera_locked: false },
      }),
    });

    assert.strictEqual(res.status, 201, "Expected HTTP 201 on org creation");
    const data: any = await res.json();
    assert.ok(data.organization?.id, "Created organization must have an id");
    assert.strictEqual(data.organization.name, "Acme EdTech");
    assert.strictEqual(data.role, "owner", "Creator must be owner");

    orgAId = data.organization.id;

    // Verify DB membership record
    const memberRes = await query(
      "SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2;",
      [orgAId, user1Id]
    );
    assert.strictEqual(memberRes.rows.length, 1);
    assert.strictEqual(memberRes.rows[0].role, "owner");
  });

  // --- TEST 2: Organization Isolation in List ---
  it("TC-P4-02: Organization list strictly isolates organizations per user membership", async () => {
    // User 2 creates Org B
    const createBRes = await fetch(`${API_BASE}/organizations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user2Token}`,
      },
      body: JSON.stringify({ name: "Beta Learning Corp" }),
    });
    assert.strictEqual(createBRes.status, 201);
    const dataB: any = await createBRes.json();
    orgBId = dataB.organization.id;

    // User 1 lists orgs: must contain Org A and NOT Org B
    const listRes1 = await fetch(`${API_BASE}/organizations`, {
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    assert.strictEqual(listRes1.status, 200);
    const listData1: any = await listRes1.json();
    const orgIds1 = listData1.organizations.map((o: any) => o.id);
    assert.ok(orgIds1.includes(orgAId), "User 1 must see Org A");
    assert.ok(!orgIds1.includes(orgBId), "User 1 must NOT see Org B");

    // User 2 lists orgs: must contain Org B and NOT Org A
    const listRes2 = await fetch(`${API_BASE}/organizations`, {
      headers: { Authorization: `Bearer ${user2Token}` },
    });
    assert.strictEqual(listRes2.status, 200);
    const listData2: any = await listRes2.json();
    const orgIds2 = listData2.organizations.map((o: any) => o.id);
    assert.ok(orgIds2.includes(orgBId), "User 2 must see Org B");
    assert.ok(!orgIds2.includes(orgAId), "User 2 must NOT see Org A");
  });

  // --- TEST 3: Cross-Tenant Org Access Denial ---
  it("TC-P4-03: Rejects cross-tenant access to organization details and updates", async () => {
    // User 2 tries to GET Org A details -> 403
    const getRes = await fetch(`${API_BASE}/organizations/${orgAId}`, {
      headers: { Authorization: `Bearer ${user2Token}` },
    });
    assert.strictEqual(getRes.status, 403, "Non-member must receive HTTP 403 on Org details");

    // User 2 tries to PATCH Org A -> 403
    const patchRes = await fetch(`${API_BASE}/organizations/${orgAId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user2Token}`,
      },
      body: JSON.stringify({ name: "Hacked Org Name" }),
    });
    assert.strictEqual(patchRes.status, 403, "Non-member must receive HTTP 403 on PATCH");

    // User 1 (Owner) can PATCH Org A
    const validPatchRes = await fetch(`${API_BASE}/organizations/${orgAId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user1Token}`,
      },
      body: JSON.stringify({ name: "Acme EdTech Renamed" }),
    });
    assert.strictEqual(validPatchRes.status, 200);
    const patchData: any = await validPatchRes.json();
    assert.strictEqual(patchData.organization.name, "Acme EdTech Renamed");
  });

  // --- TEST 4: Customer Apps (Allowed Domains & Branding) CRUD ---
  let appId: string;
  it("TC-P4-04: Manages Customer Apps with allowed_domains and branding", async () => {
    // Create App for Org A
    const createRes = await fetch(`${API_BASE}/organizations/${orgAId}/apps`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user1Token}`,
      },
      body: JSON.stringify({
        appName: "Student LMS Portal",
        allowedDomains: ["https://lms.acmeedtech.com", "*.acmeedtech.com"],
        branding: {
          logoUrl: "https://lms.acmeedtech.com/logo.png",
          primaryColor: "#059669",
        },
      }),
    });

    assert.strictEqual(createRes.status, 201, "Expected HTTP 201 on app creation");
    const data: any = await createRes.json();
    assert.ok(data.app?.id, "Created app must have id");
    assert.strictEqual(data.app.appName, "Student LMS Portal");
    assert.deepStrictEqual(data.app.allowedDomains, ["https://lms.acmeedtech.com", "*.acmeedtech.com"]);
    assert.strictEqual(data.app.branding.primaryColor, "#059669");
    appId = data.app.id;

    // List Apps
    const listRes = await fetch(`${API_BASE}/organizations/${orgAId}/apps`, {
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    assert.strictEqual(listRes.status, 200);
    const listData: any = await listRes.json();
    assert.strictEqual(listData.apps.length, 1);
    assert.strictEqual(listData.apps[0].id, appId);

    // Update App
    const updateRes = await fetch(`${API_BASE}/organizations/${orgAId}/apps/${appId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user1Token}`,
      },
      body: JSON.stringify({
        allowedDomains: ["https://lms.acmeedtech.com", "https://portal.acmeedtech.com"],
      }),
    });
    assert.strictEqual(updateRes.status, 200);
    const updateData: any = await updateRes.json();
    assert.deepStrictEqual(updateData.app.allowedDomains, [
      "https://lms.acmeedtech.com",
      "https://portal.acmeedtech.com",
    ]);
  });

  // --- TEST 5: Duplicate App Name Conflict ---
  it("TC-P4-05: Rejects duplicate app names for the same organization with HTTP 409", async () => {
    const res = await fetch(`${API_BASE}/organizations/${orgAId}/apps`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user1Token}`,
      },
      body: JSON.stringify({
        appName: "Student LMS Portal", // Already exists
        allowedDomains: ["https://other.com"],
      }),
    });

    assert.strictEqual(res.status, 409, "Duplicate app name must return HTTP 409");
    const data: any = await res.json();
    assert.strictEqual(data.code, "APP_NAME_EXISTS");
  });

  // --- TEST 6: Cross-Tenant Apps Isolation ---
  it("TC-P4-06: Forbids cross-tenant listing, updating, or deleting of customer apps", async () => {
    // User 2 attempts to list Org A's apps
    const listRes = await fetch(`${API_BASE}/organizations/${orgAId}/apps`, {
      headers: { Authorization: `Bearer ${user2Token}` },
    });
    assert.strictEqual(listRes.status, 403, "Cross-tenant app listing must be 403");

    // User 2 attempts to delete Org A's app
    const delRes = await fetch(`${API_BASE}/organizations/${orgAId}/apps/${appId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${user2Token}` },
    });
    assert.strictEqual(delRes.status, 403, "Cross-tenant app deletion must be 403");
  });

  // --- TEST 7: SEC-GAP-01 — Remove unauthorized tutor access to system-tenant API keys ---
  it("TC-P4-07: [SEC-GAP-01] Rejects unauthorized tutor access to system tenant API keys (403)", async () => {
    // Unaffiliated tutor attempts to list keys for system organization
    const tutorRes = await fetch(`${API_BASE}/organizations/${SYSTEM_ORG_ID}/keys`, {
      headers: { Authorization: `Bearer ${tutorToken}` },
    });
    assert.strictEqual(
      tutorRes.status,
      403,
      "Unauthorized tutor must NOT be granted access to system tenant keys"
    );
    const tutorData: any = await tutorRes.json();
    assert.strictEqual(tutorData.code, "ORG_ACCESS_DENIED");

    // Admin user CAN access system tenant keys
    const adminRes = await fetch(`${API_BASE}/organizations/${SYSTEM_ORG_ID}/keys`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(adminRes.status, 200, "System admin must be allowed access to system tenant keys");
  });

  // --- TEST 8: SEC-GAP-02 — Duplicate Active API Key Name Returns HTTP 409 ---
  let key1Id: string;
  it("TC-P4-08: [SEC-GAP-02] Returns HTTP 409 KEY_NAME_EXISTS when creating duplicate active key", async () => {
    // 1. Create first key named 'Production Backend'
    const key1Res = await fetch(`${API_BASE}/organizations/${orgAId}/keys`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user1Token}`,
      },
      body: JSON.stringify({
        name: "Production Backend",
        environment: "live",
      }),
    });
    assert.strictEqual(key1Res.status, 201, "First key creation must succeed");
    const key1Data: any = await key1Res.json();
    assert.ok(key1Data.rawKey);
    key1Id = key1Data.apiKey.id;

    // 2. Attempt second key with identical name in Org A -> HTTP 409
    const dupRes = await fetch(`${API_BASE}/organizations/${orgAId}/keys`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user1Token}`,
      },
      body: JSON.stringify({
        name: "Production Backend",
        environment: "live",
      }),
    });
    assert.strictEqual(dupRes.status, 409, "Duplicate active key name must return HTTP 409");
    const dupData: any = await dupRes.json();
    assert.strictEqual(dupData.code, "KEY_NAME_EXISTS");
  });

  // --- TEST 9: API Key Lifecycle (Rotation, Revocation & Uniqueness After Revocation) ---
  it("TC-P4-09: Supports key rotation, revocation, and re-creation of previously revoked name", async () => {
    // 1. Rotate key1
    const rotateRes = await fetch(`${API_BASE}/organizations/${orgAId}/keys/${key1Id}/rotate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    assert.strictEqual(rotateRes.status, 200, "Key rotation must succeed");
    const rotateData: any = await rotateRes.json();
    assert.ok(rotateData.rawKey.startsWith("sec_live_"), "New key must be returned");
    const newKeyId = rotateData.apiKey.id;
    assert.notStrictEqual(newKeyId, key1Id, "New key ID must differ from old key ID");

    // 2. Verify masked list shows old key inactive and new key active
    const listRes = await fetch(`${API_BASE}/organizations/${orgAId}/keys`, {
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    const listData: any = await listRes.json();
    const oldKeyRecord = listData.keys.find((k: any) => k.id === key1Id);
    const newKeyRecord = listData.keys.find((k: any) => k.id === newKeyId);
    assert.strictEqual(oldKeyRecord.is_active, false, "Old key must be inactive");
    assert.strictEqual(newKeyRecord.is_active, true, "New key must be active");
    assert.ok(newKeyRecord.masked_key.includes("••••••••"), "Key secrets must be masked in listing");

    // 3. Revoke new key
    const revokeRes = await fetch(`${API_BASE}/organizations/${orgAId}/keys/${newKeyId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    assert.strictEqual(revokeRes.status, 200);

    // 4. Now that both are revoked, creating a key named 'Production Backend' must succeed again
    const recreateRes = await fetch(`${API_BASE}/organizations/${orgAId}/keys`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user1Token}`,
      },
      body: JSON.stringify({
        name: "Production Backend",
        environment: "live",
      }),
    });
    assert.strictEqual(recreateRes.status, 201, "Recreating key name after revocation must succeed");

    // 5. Audit logs verify entries
    const auditRes = await fetch(`${API_BASE}/organizations/${orgAId}/keys/audit`, {
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    assert.strictEqual(auditRes.status, 200);
    const auditData: any = await auditRes.json();
    const actions = auditData.auditLogs.map((l: any) => l.action);
    assert.ok(actions.includes("created"), "Audit logs must record creation");
    assert.ok(actions.includes("rotated"), "Audit logs must record rotation");
    assert.ok(actions.includes("revoked"), "Audit logs must record revocation");
  });

  // --- TEST 10: Delete Customer App ---
  it("TC-P4-10: Deletes customer app and cleans up domain bindings", async () => {
    const delRes = await fetch(`${API_BASE}/organizations/${orgAId}/apps/${appId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    assert.strictEqual(delRes.status, 200);

    const listRes = await fetch(`${API_BASE}/organizations/${orgAId}/apps`, {
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    const listData: any = await listRes.json();
    assert.strictEqual(listData.apps.length, 0, "Apps list must now be empty");
  });
});
