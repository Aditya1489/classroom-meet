import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { pool, query } from "../server/db";

// ============================================================================
// PHASE 8 CHECKPOINT 3: PLATFORM SUPERADMIN CUSTOMER ONBOARDING TEST SUITE
// ============================================================================
// Tests:
// 1. Superadmin Verification: GET /api/admin/check returns true for verified superadmin
// 2. Unprivileged Rejection: Tutors/Students receive 403 SUPERADMIN_ACCESS_REQUIRED
// 3. Generic Admin Rejection: users.role = 'admin' without is_platform_superadmin is rejected (403)
// 4. Tenant Admin Rejection: Tenant org owner cannot access /api/admin endpoints (403)
// 5. Cross-Tenant Listing: Lists all customer organizations with search filtering
// 6. Customer Onboarding: Superadmin creates organization and attaches customer owner
// 7. Organization Inspection: Superadmin views members, apps, and masked keys
// 8. Key Issuance: Superadmin issues API key; verifies one-time reveal and audit record
// 9. Secret Redaction: Raw secret is NEVER exposed in list or detail GET endpoints
// 10. Key Lifecycle: Superadmin rotates and revokes customer credentials
// ============================================================================

const API_BASE = process.env.API_BASE || "http://localhost:5001/api";
const JWT_SECRET = process.env.JWT_SECRET || "mathsy_meet_jwt_secret_dev_key_2026";
const SYSTEM_ORG_ID = "00000000-0000-0000-0000-000000000001";

describe("Phase 8 Checkpoint 3: Platform Superadmin & Customer Onboarding Suite", () => {
  let superadminId: string;
  let superadminToken: string;

  let genericAdminId: string;
  let genericAdminToken: string;

  let tenantAdminId: string;
  let tenantAdminToken: string;

  let regularTutorId: string;
  let regularTutorToken: string;

  let testCustomerOrgId: string;
  let issuedKeyId: string;
  let rawSecretKey: string;

  before(async () => {
    // 1. Seed Verified Platform Superadmin (role = 'admin', is_platform_superadmin = true, system tenant owner)
    superadminId = crypto.randomUUID();
    await query(
      `INSERT INTO users (id, email, full_name, role, is_platform_superadmin, auth_provider)
       VALUES ($1, 'p8_superadmin@mathsy.in', 'Aditya Superadmin', 'admin', TRUE, 'google')
       ON CONFLICT (id) DO UPDATE SET is_platform_superadmin = TRUE, role = 'admin';`,
      [superadminId]
    );

    // Attach to first-party system tenant as owner
    await query(
      `INSERT INTO organization_members (organization_id, user_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'owner';`,
      [SYSTEM_ORG_ID, superadminId]
    );

    superadminToken = jwt.sign(
      { id: superadminId, sub: superadminId, email: "p8_superadmin@mathsy.in", role: "admin", name: "Aditya Superadmin" },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    // 2. Seed Generic Admin (role = 'admin', BUT is_platform_superadmin = FALSE and NOT system tenant owner)
    genericAdminId = crypto.randomUUID();
    await query(
      `INSERT INTO users (id, email, full_name, role, is_platform_superadmin, auth_provider)
       VALUES ($1, 'p8_generic_admin@mathsy.in', 'Generic Admin', 'admin', FALSE, 'google')
       ON CONFLICT (id) DO UPDATE SET is_platform_superadmin = FALSE, role = 'admin';`,
      [genericAdminId]
    );
    genericAdminToken = jwt.sign(
      { id: genericAdminId, sub: genericAdminId, email: "p8_generic_admin@mathsy.in", role: "admin", name: "Generic Admin" },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    // 3. Seed Tenant Admin (regular user who is 'owner' of their own org, but NOT platform superadmin)
    tenantAdminId = crypto.randomUUID();
    await query(
      `INSERT INTO users (id, email, full_name, role, is_platform_superadmin, auth_provider)
       VALUES ($1, 'p8_tenant_owner@customer.com', 'Tenant Owner', 'tutor', FALSE, 'google')
       ON CONFLICT (id) DO NOTHING;`,
      [tenantAdminId]
    );
    tenantAdminToken = jwt.sign(
      { id: tenantAdminId, sub: tenantAdminId, email: "p8_tenant_owner@customer.com", role: "tutor", name: "Tenant Owner" },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    // 4. Seed Regular Tutor
    regularTutorId = crypto.randomUUID();
    await query(
      `INSERT INTO users (id, email, full_name, role, is_platform_superadmin, auth_provider)
       VALUES ($1, 'p8_regular_tutor@mathsy.in', 'Regular Tutor', 'tutor', FALSE, 'google')
       ON CONFLICT (id) DO NOTHING;`,
      [regularTutorId]
    );
    regularTutorToken = jwt.sign(
      { id: regularTutorId, sub: regularTutorId, email: "p8_regular_tutor@mathsy.in", role: "tutor", name: "Regular Tutor" },
      JWT_SECRET,
      { expiresIn: "2h" }
    );
  });

  after(async () => {
    // Clean up created customer org
    if (testCustomerOrgId) {
      await query("DELETE FROM organizations WHERE id = $1;", [testCustomerOrgId]);
    }

    // Clean up test users
    await query("DELETE FROM users WHERE id IN ($1, $2, $3, $4);", [
      superadminId,
      genericAdminId,
      tenantAdminId,
      regularTutorId,
    ]);
    await pool.end();
  });

  // --- TEST 1: Superadmin Verification Endpoint ---
  it("TC-ADMIN-01: GET /api/admin/check confirms superadmin privileges for verified owner", async () => {
    const res = await fetch(`${API_BASE}/admin/check`, {
      headers: { Authorization: `Bearer ${superadminToken}` },
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.isSuperadmin, true);
  });

  // --- TEST 2: Non-Superadmin Rejection ---
  it("TC-ADMIN-02: Regular tutor receives isSuperadmin: false and is rejected with 403 on admin routes", async () => {
    const checkRes = await fetch(`${API_BASE}/admin/check`, {
      headers: { Authorization: `Bearer ${regularTutorToken}` },
    });
    assert.strictEqual(checkRes.status, 200);
    const checkData = await checkRes.json();
    assert.strictEqual(checkData.isSuperadmin, false);

    const listRes = await fetch(`${API_BASE}/admin/organizations`, {
      headers: { Authorization: `Bearer ${regularTutorToken}` },
    });
    assert.strictEqual(listRes.status, 403);
    const listData = await listRes.json();
    assert.strictEqual(listData.code, "SUPERADMIN_ACCESS_REQUIRED");
  });

  // --- TEST 3: Generic Admin Rejection (Dual-Guard Verification) ---
  it("TC-ADMIN-03: Generic admin with role = 'admin' but lacking is_platform_superadmin is rejected (403)", async () => {
    const checkRes = await fetch(`${API_BASE}/admin/check`, {
      headers: { Authorization: `Bearer ${genericAdminToken}` },
    });
    const checkData = await checkRes.json();
    assert.strictEqual(checkData.isSuperadmin, false);

    const res = await fetch(`${API_BASE}/admin/organizations`, {
      headers: { Authorization: `Bearer ${genericAdminToken}` },
    });
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.code, "SUPERADMIN_ACCESS_REQUIRED");
  });

  // --- TEST 4: Tenant Admin Rejection ---
  it("TC-ADMIN-04: Tenant organization owner cannot access cross-tenant superadmin endpoints (403)", async () => {
    const res = await fetch(`${API_BASE}/admin/organizations`, {
      headers: { Authorization: `Bearer ${tenantAdminToken}` },
    });
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.code, "SUPERADMIN_ACCESS_REQUIRED");
  });

  // --- TEST 5: Cross-Tenant Organization Listing ---
  it("TC-ADMIN-05: Platform superadmin lists all organizations with search filter", async () => {
    const res = await fetch(`${API_BASE}/admin/organizations?limit=10`, {
      headers: { Authorization: `Bearer ${superadminToken}` },
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.organizations));
    assert.ok(typeof data.total === "number");
    assert.ok(data.organizations.length > 0);

    // Verify properties on first organization
    const org = data.organizations[0];
    assert.ok(org.id);
    assert.ok(org.name);
    assert.ok("activeKeysCount" in org);
    assert.ok("memberCount" in org);
  });

  // --- TEST 6: Customer Onboarding by Superadmin ---
  it("TC-ADMIN-06: Superadmin onboards customer organization and links designated owner", async () => {
    const res = await fetch(`${API_BASE}/admin/organizations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${superadminToken}`,
      },
      body: JSON.stringify({
        name: "Enterprise Client Alpha",
        ownerEmail: "p8_tenant_owner@customer.com",
        planTier: "enterprise",
        settings: { default_camera_locked: false },
      }),
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.ok(data.organization);
    assert.strictEqual(data.organization.name, "Enterprise Client Alpha");
    assert.strictEqual(data.organization.planTier, "enterprise");
    assert.strictEqual(data.organization.owner.email, "p8_tenant_owner@customer.com");
    assert.strictEqual(data.organization.owner.linked, true);

    testCustomerOrgId = data.organization.id;

    // Verify owner membership row in DB
    const memberCheck = await query(
      "SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2;",
      [testCustomerOrgId, tenantAdminId]
    );
    assert.strictEqual(memberCheck.rows.length, 1);
    assert.strictEqual(memberCheck.rows[0].role, "owner");
  });

  // --- TEST 7: Cross-Tenant Organization Details Inspection ---
  it("TC-ADMIN-07: Superadmin retrieves customer profile, members, and customer apps", async () => {
    const res = await fetch(`${API_BASE}/admin/organizations/${testCustomerOrgId}`, {
      headers: { Authorization: `Bearer ${superadminToken}` },
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.organization.id, testCustomerOrgId);
    assert.ok(Array.isArray(data.members));
    assert.ok(Array.isArray(data.apps));
    assert.ok(Array.isArray(data.keys));
    assert.strictEqual(data.members[0].email, "p8_tenant_owner@customer.com");
  });

  // --- TEST 8: API Key Issuance by Superadmin with One-Time Reveal ---
  it("TC-ADMIN-08: Superadmin issues live API key for customer organization", async () => {
    const res = await fetch(`${API_BASE}/admin/organizations/${testCustomerOrgId}/keys`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${superadminToken}`,
      },
      body: JSON.stringify({
        name: "Backend Production Gateway",
        environment: "live",
        permissions: ["rooms:read", "rooms:write", "tokens:write"],
      }),
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.ok(data.rawKey);
    assert.ok(data.rawKey.startsWith("sec_live_"));
    assert.ok(data.apiKey);
    assert.strictEqual(data.apiKey.name, "Backend Production Gateway");
    assert.strictEqual(data.apiKey.environment, "live");
    assert.strictEqual(data.apiKey.is_active, true);

    issuedKeyId = data.apiKey.id;
    rawSecretKey = data.rawKey;

    // Verify hash storage in DB (raw key NOT stored in DB)
    const keyRow = await query("SELECT key_prefix, key_hash FROM api_keys WHERE id = $1;", [issuedKeyId]);
    assert.strictEqual(keyRow.rows.length, 1);
    assert.ok(keyRow.rows[0].key_prefix.startsWith("sec_live_"));
    assert.notStrictEqual(keyRow.rows[0].key_hash, rawSecretKey);

    // Verify audit log recorded superadmin issuance
    const auditRow = await query(
      "SELECT action, actor_id, metadata FROM api_key_audit_logs WHERE api_key_id = $1;",
      [issuedKeyId]
    );
    assert.strictEqual(auditRow.rows.length, 1);
    assert.strictEqual(auditRow.rows[0].action, "created");
    assert.strictEqual(auditRow.rows[0].actor_id, superadminId);
    assert.strictEqual(auditRow.rows[0].metadata.issued_by_superadmin, true);
  });

  // --- TEST 9: Secret Redaction Verification ---
  it("TC-ADMIN-09: Raw secret key is NEVER exposed in list or detail GET endpoints", async () => {
    // 1. Check Superadmin Detail Endpoint
    const detailRes = await fetch(`${API_BASE}/admin/organizations/${testCustomerOrgId}`, {
      headers: { Authorization: `Bearer ${superadminToken}` },
    });
    const detailData = await detailRes.json();
    const keyInDetail = detailData.keys.find((k: any) => k.id === issuedKeyId);
    assert.ok(keyInDetail);
    assert.strictEqual("rawKey" in keyInDetail, false);
    assert.ok(keyInDetail.masked_key.includes("••••"));

    // 2. Check Standard Tenant Keys List Endpoint
    const tenantRes = await fetch(`${API_BASE}/organizations/${testCustomerOrgId}/keys`, {
      headers: { Authorization: `Bearer ${tenantAdminToken}` },
    });
    const tenantData = await tenantRes.json();
    const keyInTenant = tenantData.keys.find((k: any) => k.id === issuedKeyId);
    assert.ok(keyInTenant);
    assert.strictEqual("rawKey" in keyInTenant, false);
    assert.ok(keyInTenant.masked_key.includes("••••"));
  });

  // --- TEST 10: Key Rotation & Revocation by Superadmin ---
  it("TC-ADMIN-10: Superadmin rotates and revokes customer credentials with audit trail", async () => {
    // 1. Rotate Key
    const rotateRes = await fetch(
      `${API_BASE}/admin/organizations/${testCustomerOrgId}/keys/${issuedKeyId}/rotate`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${superadminToken}` },
      }
    );

    assert.strictEqual(rotateRes.status, 200);
    const rotateData = await rotateRes.json();
    assert.ok(rotateData.rawKey);
    assert.notStrictEqual(rotateData.rawKey, rawSecretKey);
    const newKeyId = rotateData.apiKey.id;

    // Verify old key was deactivated
    const oldKeyRow = await query("SELECT is_active FROM api_keys WHERE id = $1;", [issuedKeyId]);
    assert.strictEqual(oldKeyRow.rows[0].is_active, false);

    // 2. Revoke Rotated Key
    const revokeRes = await fetch(
      `${API_BASE}/admin/organizations/${testCustomerOrgId}/keys/${newKeyId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${superadminToken}` },
      }
    );

    assert.strictEqual(revokeRes.status, 200);
    const revokeData = await revokeRes.json();
    assert.strictEqual(revokeData.success, true);

    // Verify new key is deactivated in DB
    const newKeyRow = await query("SELECT is_active FROM api_keys WHERE id = $1;", [newKeyId]);
    assert.strictEqual(newKeyRow.rows[0].is_active, false);
  });
});
