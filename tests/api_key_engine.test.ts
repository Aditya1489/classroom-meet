import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { pool, query } from "../server/db";
import {
  createApiKey,
  verifyApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  generateKeyMaterial,
} from "../server/services/apiKeyService";

// ============================================================================
// MILESTONE 3: API KEY ENGINE AUTOMATED TEST SUITE
// ============================================================================
// Tests:
// 1. High-entropy key generation, prefix formats (sec_live_, sec_test_), hash-only storage
// 2. Constant-time hash verification and rejection of forged keys
// 3. Separate live and test environments
// 4. API Key HTTP Authentication Middleware (valid, invalid, malformed, missing)
// 5. Revoked and expired key rejection (401)
// 6. Suspended organization key rejection (403)
// 7. Permission / Scope checking (403 INSUFFICIENT_PERMISSIONS)
// 8. Cross-organization isolation (Org A cannot touch Org B)
// 9. Rate limiting on rapid request bursts (429 RATE_LIMIT_EXCEEDED)
// 10. Key rotation (atomically revokes previous, issues new matching key)
// 11. Audit log verification (logs created, rotated, revoked without leaking raw keys)
// ============================================================================

const API_BASE = process.env.API_BASE || "http://localhost:5001/api";
const JWT_SECRET = process.env.JWT_SECRET || "mathsy_meet_jwt_secret_dev_key_2026";

describe("Milestone 3: API Key Engine & M2M Authentication Suite", () => {
  let orgAId: string;
  let orgBId: string;
  let adminUserId: string;
  let adminToken: string;

  before(async () => {
    // 1. Create Test User (Admin)
    adminUserId = crypto.randomUUID();
    await query(
      `INSERT INTO users (id, email, full_name, role, auth_provider)
       VALUES ($1, 'm3_admin@mathsy.in', 'M3 Admin', 'admin', 'google')
       ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;`,
      [adminUserId]
    );

    adminToken = jwt.sign(
      { id: adminUserId, sub: adminUserId, email: "m3_admin@mathsy.in", role: "admin", name: "M3 Admin" },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    // 2. Create Organization A
    const orgARes = await query(
      `INSERT INTO organizations (name, slug, status)
       VALUES ('Apex Academy', $1, 'active')
       RETURNING id;`,
      [`apex-academy-${crypto.randomBytes(4).toString("hex")}`]
    );
    orgAId = orgARes.rows[0].id;

    // Attach Admin to Org A
    await query(
      "INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner');",
      [orgAId, adminUserId]
    );

    // 3. Create Organization B
    const orgBRes = await query(
      `INSERT INTO organizations (name, slug, status)
       VALUES ('Beacon Institute', $1, 'active')
       RETURNING id;`,
      [`beacon-inst-${crypto.randomBytes(4).toString("hex")}`]
    );
    orgBId = orgBRes.rows[0].id;
  });

  after(async () => {
    // Clean up test organizations (cascades to api_keys, organization_members, audit logs)
    if (orgAId) await query("DELETE FROM organizations WHERE id = $1;", [orgAId]);
    if (orgBId) await query("DELETE FROM organizations WHERE id = $1;", [orgBId]);
    if (adminUserId) await query("DELETE FROM users WHERE id = $1;", [adminUserId]);
    await pool.end();
  });

  // --- TEST 1: Key Generation & Hash-Only Storage ---
  it("TC-KEY-01: Generates high-entropy keys with proper prefixes and hash-only storage", async () => {
    const liveMat = generateKeyMaterial("live");
    assert.ok(liveMat.rawKey.startsWith("sec_live_"), "Live key must start with sec_live_");
    assert.ok(liveMat.rawKey.length >= 40, "Key must have high entropy (>= 40 chars)");
    assert.strictEqual(liveMat.hash.length, 64, "Key hash must be SHA-256 (64 hex characters)");

    const testMat = generateKeyMaterial("test");
    assert.ok(testMat.rawKey.startsWith("sec_test_"), "Test key must start with sec_test_");

    // Persist via Service
    const created = await createApiKey({
      organizationId: orgAId,
      name: "Primary Live Key",
      environment: "live",
      actorId: adminUserId,
    });

    assert.ok(created.rawKey.startsWith("sec_live_"));
    assert.strictEqual(created.apiKey.organization_id, orgAId);

    // Verify raw key is NEVER stored in database
    const dbRecord = await query("SELECT * FROM api_keys WHERE id = $1;", [created.apiKey.id]);
    assert.strictEqual(dbRecord.rows.length, 1);
    const row = dbRecord.rows[0];
    assert.notStrictEqual(row.key_hash, created.rawKey, "Database must store key_hash, NEVER raw key");
    assert.strictEqual(row.key_hash, crypto.createHash("sha256").update(created.rawKey).digest("hex"));
  });

  // --- TEST 2: Key Verification & Constant-Time Validation ---
  it("TC-KEY-02: Verifies valid raw key and rejects tampered secrets", async () => {
    const created = await createApiKey({
      organizationId: orgAId,
      name: "Verification Key",
      environment: "live",
      permissions: ["rooms:read", "rooms:write"],
    });

    // 1. Verify valid key
    const result = await verifyApiKey(created.rawKey);
    assert.strictEqual(result.valid, true);
    assert.ok(result.apiKey);
    assert.strictEqual(result.organization?.id, orgAId);

    // 2. Reject tampered secret (same prefix, modified payload)
    const tampered = `${created.apiKey.key_prefix}tamperedSecretPayload1234567890`;
    const tamperedRes = await verifyApiKey(tampered);
    assert.strictEqual(tamperedRes.valid, false);
    assert.strictEqual(tamperedRes.code, "NOT_FOUND");
  });

  // --- TEST 3: Separate Test and Live Key Environments ---
  it("TC-KEY-03: Segregates live and test key environments", async () => {
    const testKey = await createApiKey({
      organizationId: orgAId,
      name: "Sandbox Key",
      environment: "test",
    });

    // Valid when environment matches
    const validTest = await verifyApiKey(testKey.rawKey, "test");
    assert.strictEqual(validTest.valid, true);
    assert.strictEqual(validTest.apiKey?.environment, "test");

    // Rejected when live environment is required
    const rejectedLive = await verifyApiKey(testKey.rawKey, "live");
    assert.strictEqual(rejectedLive.valid, false);
    assert.strictEqual(rejectedLive.code, "WRONG_ENVIRONMENT");
  });

  // --- TEST 4: Revocation & Expiration ---
  it("TC-KEY-04: Rejects revoked and expired API keys", async () => {
    // 1. Revocation test
    const keyToRevoke = await createApiKey({
      organizationId: orgAId,
      name: "Temporary Key",
      environment: "live",
    });

    const revoked = await revokeApiKey({
      organizationId: orgAId,
      keyId: keyToRevoke.apiKey.id,
      actorId: adminUserId,
    });
    assert.strictEqual(revoked, true);

    const revokedCheck = await verifyApiKey(keyToRevoke.rawKey);
    assert.strictEqual(revokedCheck.valid, false);
    assert.strictEqual(revokedCheck.code, "REVOKED");

    // 2. Expired key test
    const pastDate = new Date(Date.now() - 10000); // 10s in past
    const expiredKey = await createApiKey({
      organizationId: orgAId,
      name: "Expired Key",
      environment: "live",
      expiresAt: pastDate,
    });

    const expiredCheck = await verifyApiKey(expiredKey.rawKey);
    assert.strictEqual(expiredCheck.valid, false);
    assert.strictEqual(expiredCheck.code, "EXPIRED");
  });

  // --- TEST 5: Suspended Organization Check ---
  it("TC-KEY-05: Rejects API keys belonging to a suspended organization", async () => {
    // Create suspended org
    const suspRes = await query(
      "INSERT INTO organizations (name, slug, status) VALUES ('Suspended Org', 'susp-org-test', 'suspended') RETURNING id;"
    );
    const suspOrgId = suspRes.rows[0].id;

    try {
      // Force insert key for suspended org
      const { rawKey, prefix, hash } = generateKeyMaterial("live");
      await query(
        "INSERT INTO api_keys (organization_id, name, key_prefix, key_hash) VALUES ($1, 'Key', $2, $3);",
        [suspOrgId, prefix, hash]
      );

      const res = await verifyApiKey(rawKey);
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.code, "ORG_SUSPENDED");
    } finally {
      await query("DELETE FROM organizations WHERE id = $1;", [suspOrgId]);
    }
  });

  // --- TEST 6: API Key Rotation ---
  it("TC-KEY-06: Rotates key atomically revoking previous and generating new matching key", async () => {
    const initial = await createApiKey({
      organizationId: orgAId,
      name: "Rotatable Key",
      environment: "live",
      permissions: ["rooms:read", "tokens:write"],
    });

    const rotated = await rotateApiKey({
      organizationId: orgAId,
      keyId: initial.apiKey.id,
      actorId: adminUserId,
    });

    assert.notStrictEqual(rotated.rawKey, initial.rawKey, "New raw key must be different");
    assert.strictEqual(rotated.apiKey.name, initial.apiKey.name, "Name must be preserved");
    assert.deepStrictEqual(rotated.apiKey.permissions, initial.apiKey.permissions, "Permissions must match");

    // Old key is now REVOKED
    const oldCheck = await verifyApiKey(initial.rawKey);
    assert.strictEqual(oldCheck.valid, false);
    assert.strictEqual(oldCheck.code, "REVOKED");

    // New key is ACTIVE
    const newCheck = await verifyApiKey(rotated.rawKey);
    assert.strictEqual(newCheck.valid, true);
  });

  // --- TEST 7: HTTP Middleware Authentication (`/api/v1/auth/verify`) ---
  it("TC-KEY-07: HTTP Middleware authenticates valid key and rejects malformed/missing requests", async () => {
    const activeKey = await createApiKey({
      organizationId: orgAId,
      name: "HTTP Test Key",
      environment: "live",
    });

    // 1. Missing key
    const noKeyRes = await fetch(`${API_BASE}/v1/auth/verify`);
    assert.strictEqual(noKeyRes.status, 401);
    const noKeyJson = await noKeyRes.json();
    assert.strictEqual(noKeyJson.code, "MISSING_API_KEY");

    // 2. Malformed key format
    const malformedRes = await fetch(`${API_BASE}/v1/auth/verify`, {
      headers: { Authorization: "Bearer not_a_real_key_format" },
    });
    assert.strictEqual(malformedRes.status, 401);

    // 3. Valid key via Authorization: Bearer
    const validBearerRes = await fetch(`${API_BASE}/v1/auth/verify`, {
      headers: { Authorization: `Bearer ${activeKey.rawKey}` },
    });
    assert.strictEqual(validBearerRes.status, 200);
    const validBearerJson = await validBearerRes.json();
    assert.strictEqual(validBearerJson.authenticated, true);
    assert.strictEqual(validBearerJson.organization.id, orgAId);

    // 4. Valid key via x-api-key header
    const validHeaderRes = await fetch(`${API_BASE}/v1/auth/verify`, {
      headers: { "x-api-key": activeKey.rawKey },
    });
    assert.strictEqual(validHeaderRes.status, 200);
  });

  // --- TEST 8: Permission / Scope Enforcement ---
  it("TC-KEY-08: Enforces permissions and returns 403 INSUFFICIENT_PERMISSIONS", async () => {
    // Key with only rooms:read permission
    const readOnlyKey = await createApiKey({
      organizationId: orgAId,
      name: "Read Only Key",
      environment: "live",
      permissions: ["rooms:read"],
    });

    // Request endpoint requiring rooms:write
    const deniedRes = await fetch(`${API_BASE}/v1/auth/rooms-guard`, {
      headers: { Authorization: `Bearer ${readOnlyKey.rawKey}` },
    });
    assert.strictEqual(deniedRes.status, 403);
    const deniedJson = await deniedRes.json();
    assert.strictEqual(deniedJson.code, "INSUFFICIENT_PERMISSIONS");

    // Key with rooms:write permission
    const writeKey = await createApiKey({
      organizationId: orgAId,
      name: "Write Key",
      environment: "live",
      permissions: ["rooms:write"],
    });

    const allowedRes = await fetch(`${API_BASE}/v1/auth/rooms-guard`, {
      headers: { Authorization: `Bearer ${writeKey.rawKey}` },
    });
    assert.strictEqual(allowedRes.status, 200);
  });

  // --- TEST 9: Cross-Organization Isolation ---
  it("TC-KEY-09: Enforces cross-organization access isolation", async () => {
    // Attempting to access Org B keys using Org A user token
    const crossRes = await fetch(`${API_BASE}/organizations/${orgBId}/keys`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(crossRes.status, 403);
    const crossJson = await crossRes.json();
    assert.strictEqual(crossJson.code, "ORG_ACCESS_DENIED");
  });

  // --- TEST 10: Audit Logging Verification ---
  it("TC-KEY-10: Audit logs record key lifecycle actions without leaking raw keys", async () => {
    const logsRes = await query(
      "SELECT * FROM api_key_audit_logs WHERE organization_id = $1 ORDER BY created_at ASC;",
      [orgAId]
    );
    assert.ok(logsRes.rows.length >= 3, "Must record created, rotated, and revoked actions");

    // Verify no log entry contains raw secrets
    for (const log of logsRes.rows) {
      assert.ok(["created", "rotated", "revoked", "rate_limited", "permission_denied"].includes(log.action));
      assert.ok(log.key_prefix.startsWith("sec_"), "Key prefix must be non-secret prefix only");
      const metadataStr = JSON.stringify(log.metadata);
      assert.strictEqual(metadataStr.includes("sec_live_"), false, "Metadata must NEVER leak raw keys");
    }
  });

  // --- TEST 11: Rate Limiting Enforcement ---
  it("TC-KEY-11: Rate limits rapid request bursts and returns 429 Too Many Requests", async () => {
    const spamKey = await createApiKey({
      organizationId: orgAId,
      name: "Rate Limit Test Key",
      environment: "live",
    });

    let rateLimited = false;
    // Send burst of 115 requests (threshold is 100 per 10s)
    for (let i = 0; i < 115; i++) {
      const res = await fetch(`${API_BASE}/v1/auth/verify`, {
        headers: { Authorization: `Bearer ${spamKey.rawKey}` },
      });
      if (res.status === 429) {
        rateLimited = true;
        const json = await res.json();
        assert.strictEqual(json.code, "RATE_LIMIT_EXCEEDED");
        assert.ok(res.headers.get("retry-after"), "Must return Retry-After header");
        break;
      }
    }
    assert.strictEqual(rateLimited, true, "Rapid burst must trigger 429 Too Many Requests");
  });
});
