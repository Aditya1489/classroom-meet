import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import jwt from "jsonwebtoken";
import { pool, query } from "../server/db";
import { app } from "../server/index";
import { createApiKey } from "../server/services/apiKeyService";
import { verifyParticipantToken } from "../server/services/participantTokenService";

// ============================================================================
// PHASE 9: ORGANIZATION-BASED SSO & AUTOMATIC USER PROVISIONING TEST SUITE
// ============================================================================

describe("Phase 9: Organization SSO & Automatic User Provisioning Suite", () => {
  let server: http.Server;
  let testPort: number;
  let apiBase: string;

  const JWT_SECRET = process.env.JWT_SECRET || "mathsy_meet_jwt_secret_dev_key_2026";

  let orgAId: string;
  let orgBId: string;
  let ownerAId: string;
  let ownerAToken: string;
  let apiKeyA: string;
  let apiKeyB: string;

  let roomCodeA: string;
  let roomCodeB: string;

  before(async () => {
    // 1. Start ephemeral HTTP server on dynamic port
    await new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, () => {
        const addr = server.address() as any;
        testPort = addr.port;
        apiBase = `http://localhost:${testPort}/api`;
        resolve();
      });
    });

    // 2. Provision Owner A and Organization A
    const ownerEmail = `sso_owner_${Date.now()}@example.com`;
    const userRes = await query(
      `INSERT INTO users (email, full_name, role, auth_provider)
       VALUES ($1, 'Owner A', 'tutor', 'google')
       RETURNING id;`,
      [ownerEmail]
    );
    ownerAId = userRes.rows[0].id;

    ownerAToken = jwt.sign(
      { id: ownerAId, sub: ownerAId, email: ownerEmail, role: "tutor", name: "Owner A" },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    orgAId = crypto.randomUUID();
    await query(
      `INSERT INTO organizations (id, name, slug, status)
       VALUES ($1, 'Mathsy Academy', 'mathsy-academy-${crypto.randomBytes(3).toString("hex")}', 'active')
       ON CONFLICT (id) DO NOTHING;`,
      [orgAId]
    );

    await query(
      `INSERT INTO organization_members (organization_id, user_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'owner';`,
      [orgAId, ownerAId]
    );

    // 3. Provision Organization B
    orgBId = crypto.randomUUID();
    await query(
      `INSERT INTO organizations (id, name, slug, status)
       VALUES ($1, 'Other School', 'other-school-${crypto.randomBytes(3).toString("hex")}', 'active')
       ON CONFLICT (id) DO NOTHING;`,
      [orgBId]
    );

    // 4. Provision API Keys for Org A and Org B
    const keyARes = await createApiKey({
      organizationId: orgAId,
      name: "Org A SSO Key",
      environment: "live",
      permissions: ["rooms:read", "rooms:write", "tokens:write"],
    });
    apiKeyA = keyARes.rawKey;

    const keyBRes = await createApiKey({
      organizationId: orgBId,
      name: "Org B SSO Key",
      environment: "live",
      permissions: ["rooms:read", "rooms:write", "tokens:write"],
    });
    apiKeyB = keyBRes.rawKey;

    // 5. Create active meeting room for Org A
    roomCodeA = `sso-room-${crypto.randomBytes(3).toString("hex")}`;
    await query(
      `INSERT INTO live_classes (organization_id, room_code, title, tutor_name, is_active, started_at)
       VALUES ($1, $2, 'Mathsy Live Class', 'Owner A', TRUE, NOW())
       ON CONFLICT (room_code) DO NOTHING;`,
      [orgAId, roomCodeA]
    );

    // 6. Create active meeting room for Org B
    roomCodeB = `sso-other-${crypto.randomBytes(3).toString("hex")}`;
    await query(
      `INSERT INTO live_classes (organization_id, room_code, title, tutor_name, is_active, started_at)
       VALUES ($1, $2, 'Other Live Class', 'Tutor B', TRUE, NOW())
       ON CONFLICT (room_code) DO NOTHING;`,
      [orgBId, roomCodeB]
    );
  });

  after(async () => {
    if (server) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await pool.end();
    setTimeout(() => process.exit(0), 100).unref();
  });

  // --------------------------------------------------------------------------
  // 1. SSO Configuration & Policy Management
  // --------------------------------------------------------------------------
  it("TC-SSO-01: Retrieves default SSO config and allows owner to configure settings", async () => {
    // GET initial config
    const getRes = await fetch(`${apiBase}/organizations/${orgAId}/sso/config`, {
      headers: { Authorization: `Bearer ${ownerAToken}` },
    });
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();
    assert.equal(getData.config.ssoEnabled, false); // Disabled by default
    assert.equal(getData.config.defaultRole, "student");
    assert.equal(getData.config.allowAutoProvisioning, true);

    // PATCH update config: Enable SSO, set defaultRole tutor, allowAutoProvisioning true
    const patchRes = await fetch(`${apiBase}/organizations/${orgAId}/sso/config`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ownerAToken}`,
      },
      body: JSON.stringify({
        ssoEnabled: true,
        defaultRole: "student",
        allowAutoProvisioning: true,
      }),
    });
    assert.equal(patchRes.status, 200);
    const patchData = await patchRes.json();
    assert.equal(patchData.config.ssoEnabled, true);
    assert.equal(patchData.config.defaultRole, "student");
  });

  // --------------------------------------------------------------------------
  // 2. Verified Domains Management
  // --------------------------------------------------------------------------
  it("TC-SSO-02: Adds, lists, and normalizes verified domains for automatic provisioning", async () => {
    // Add domain 'mathsy.in'
    const addRes = await fetch(`${apiBase}/organizations/${orgAId}/sso/domains`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ownerAToken}`,
      },
      body: JSON.stringify({ domain: "  @Mathsy.IN  " }), // Test case and @ normalization
    });
    assert.equal(addRes.status, 201);
    const addData = await addRes.json();
    assert.equal(addData.domain.domain, "mathsy.in");
    assert.equal(addData.domain.isVerified, true);

    // List domains
    const listRes = await fetch(`${apiBase}/organizations/${orgAId}/sso/domains`, {
      headers: { Authorization: `Bearer ${ownerAToken}` },
    });
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.ok(Array.isArray(listData.domains));
    assert.ok(listData.domains.some((d: any) => d.domain === "mathsy.in"));
  });

  // --------------------------------------------------------------------------
  // 3. Manual Allowlist Management
  // --------------------------------------------------------------------------
  it("TC-SSO-03: Adds approved user to allowlist and verifies listing", async () => {
    const addRes = await fetch(`${apiBase}/organizations/${orgAId}/sso/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ownerAToken}`,
      },
      body: JSON.stringify({
        email: "manual_tutor@partner.org",
        name: "Dr. Partner Tutor",
        role: "tutor",
        externalIssuer: "partner_lms",
        externalSubject: "partner_usr_99",
      }),
    });
    assert.equal(addRes.status, 201);
    const addData = await addRes.json();
    assert.equal(addData.user.email, "manual_tutor@partner.org");
    assert.equal(addData.user.role, "tutor");
    assert.equal(addData.user.isActive, true);
    assert.equal(addData.user.autoProvisioned, false);

    // List users
    const listRes = await fetch(`${apiBase}/organizations/${orgAId}/sso/users?q=manual_tutor`, {
      headers: { Authorization: `Bearer ${ownerAToken}` },
    });
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.equal(listData.total, 1);
    assert.equal(listData.users[0].email, "manual_tutor@partner.org");
  });

  // --------------------------------------------------------------------------
  // 4. M2M SSO Launch Token Generation & Single-Use Consumption Flow
  // --------------------------------------------------------------------------
  it("TC-SSO-04: Mints single-use SSO launch token and consumes it for participant JWT", async () => {
    // 1. Customer backend calls M2M /api/v1/sso/launch-token with private API key
    const launchRes = await fetch(`${apiBase}/v1/sso/launch-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKeyA}`,
      },
      body: JSON.stringify({
        roomCode: roomCodeA,
        userId: "partner_usr_99",
        email: "manual_tutor@partner.org",
        name: "Dr. Partner Tutor",
        externalIssuer: "partner_lms",
      }),
    });

    assert.equal(launchRes.status, 201);
    const launchData = await launchRes.json();
    assert.ok(launchData.launchToken.startsWith("sso_launch_"));
    assert.equal(launchData.roomCode, roomCodeA);
    assert.ok(launchData.launchUrl.includes(launchData.launchToken));
    assert.ok(launchData.embedUrl.includes(launchData.launchToken));

    // 2. Browser/SDK exchanges single-use launch token for participant JWT
    const consumeRes = await fetch(`${apiBase}/v1/sso/consume-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: launchData.launchToken,
        roomCode: roomCodeA,
      }),
    });

    assert.equal(consumeRes.status, 200);
    const consumeData = await consumeRes.json();
    assert.equal(consumeData.success, true);
    assert.ok(consumeData.participantToken);
    assert.equal(consumeData.role, "tutor");
    assert.equal(consumeData.roomCode, roomCodeA);

    // 3. Verify participant token signature and permissions
    const claims = verifyParticipantToken(consumeData.participantToken);
    assert.equal(claims.room_code, roomCodeA);
    assert.equal(claims.tenant_id, orgAId);
    assert.equal(claims.role, "tutor");
    assert.equal(claims.permissions.isHost, true);
  });

  // --------------------------------------------------------------------------
  // 5. Replay Attack Protection
  // --------------------------------------------------------------------------
  it("TC-SSO-05: Replay attack defense blocks consuming already-used launch token", async () => {
    // Mint token
    const launchRes = await fetch(`${apiBase}/v1/sso/launch-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKeyA}`,
      },
      body: JSON.stringify({
        roomCode: roomCodeA,
        userId: "partner_usr_99",
        email: "manual_tutor@partner.org",
        name: "Dr. Partner Tutor",
        externalIssuer: "partner_lms",
      }),
    });
    const { launchToken } = await launchRes.json();

    // Consume #1: Success
    const firstConsume = await fetch(`${apiBase}/v1/sso/consume-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: launchToken, roomCode: roomCodeA }),
    });
    assert.equal(firstConsume.status, 200);

    // Consume #2: Replay blocked with 401
    const replayConsume = await fetch(`${apiBase}/v1/sso/consume-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: launchToken, roomCode: roomCodeA }),
    });
    assert.equal(replayConsume.status, 401);
    const replayData = await replayConsume.json();
    assert.equal(replayData.code, "SSO_TOKEN_ALREADY_USED");
  });

  // --------------------------------------------------------------------------
  // 6. Automatic Provisioning via Verified Domains
  // --------------------------------------------------------------------------
  it("TC-SSO-06: Automatically provisions new user matching verified organization domain", async () => {
    const studentEmail = `student_${Date.now()}@mathsy.in`;

    const launchRes = await fetch(`${apiBase}/v1/sso/launch-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKeyA}`,
      },
      body: JSON.stringify({
        roomCode: roomCodeA,
        userId: "std_auto_101",
        email: studentEmail,
        name: "Aarav AutoStudent",
      }),
    });

    assert.equal(launchRes.status, 201);
    const launchData = await launchRes.json();
    assert.equal(launchData.user.autoProvisioned, true);
    assert.equal(launchData.user.role, "student");

    // Verify user is recorded in organization_sso_users
    const userRes = await query(
      "SELECT id, auto_provisioned, role FROM organization_sso_users WHERE organization_id = $1 AND email = $2;",
      [orgAId, studentEmail]
    );
    assert.equal(userRes.rows.length, 1);
    assert.equal(userRes.rows[0].auto_provisioned, true);
    assert.equal(userRes.rows[0].role, "student");
  });

  // --------------------------------------------------------------------------
  // 7. Unverified Domain & Non-Allowlisted User Rejection
  // --------------------------------------------------------------------------
  it("TC-SSO-07: Rejects user whose domain is NOT verified and not in allowlist (403)", async () => {
    const launchRes = await fetch(`${apiBase}/v1/sso/launch-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKeyA}`,
      },
      body: JSON.stringify({
        roomCode: roomCodeA,
        userId: "hacker_123",
        email: "unauthorized@unknown-domain.xyz",
        name: "Malicious User",
      }),
    });

    assert.equal(launchRes.status, 403);
    const errData = await launchRes.json();
    assert.equal(errData.code, "SSO_DOMAIN_UNAUTHORIZED");
  });

  // --------------------------------------------------------------------------
  // 8. Revoked User Access Denial
  // --------------------------------------------------------------------------
  it("TC-SSO-08: Revoked user access is immediately denied with 403 SSO_USER_REVOKED", async () => {
    // 1. Allowlist a student
    const addRes = await fetch(`${apiBase}/organizations/${orgAId}/sso/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ownerAToken}`,
      },
      body: JSON.stringify({
        email: "revoked_student@example.com",
        name: "Revoked Student",
        role: "student",
      }),
    });
    const { user } = await addRes.json();

    // 2. Revoke user access (isActive = false)
    const revokeRes = await fetch(`${apiBase}/organizations/${orgAId}/sso/users/${user.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ownerAToken}`,
      },
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(revokeRes.status, 200);

    // 3. Attempt to generate launch token -> must be rejected
    const launchRes = await fetch(`${apiBase}/v1/sso/launch-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKeyA}`,
      },
      body: JSON.stringify({
        roomCode: roomCodeA,
        userId: user.externalSubject,
        email: "revoked_student@example.com",
        name: "Revoked Student",
      }),
    });

    assert.equal(launchRes.status, 403);
    const errData = await launchRes.json();
    assert.equal(errData.code, "SSO_USER_REVOKED");
  });

  // --------------------------------------------------------------------------
  // 9. SSO Disabled Guard
  // --------------------------------------------------------------------------
  it("TC-SSO-09: Rejects launch token generation when organization has SSO disabled (403)", async () => {
    // Org B has not enabled SSO
    const launchRes = await fetch(`${apiBase}/v1/sso/launch-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKeyB}`,
      },
      body: JSON.stringify({
        roomCode: roomCodeB,
        userId: "usr_b_1",
        email: "student@other-school.com",
        name: "Student B",
      }),
    });

    assert.equal(launchRes.status, 403);
    const errData = await launchRes.json();
    assert.equal(errData.code, "SSO_DISABLED");
  });

  // --------------------------------------------------------------------------
  // 10. Cross-Organization Isolation
  // --------------------------------------------------------------------------
  it("TC-SSO-10: Cross-organization protection prevents using Org A key for Org B room", async () => {
    const launchRes = await fetch(`${apiBase}/v1/sso/launch-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKeyA}`,
      },
      body: JSON.stringify({
        roomCode: roomCodeB, // Room belonging to Org B
        userId: "usr_cross_org",
        email: "student@mathsy.in",
        name: "Cross Org Attempt",
      }),
    });

    assert.equal(launchRes.status, 404);
    const errData = await launchRes.json();
    assert.equal(errData.code, "ROOM_NOT_FOUND");
  });

  // --------------------------------------------------------------------------
  // 11. Role Escalation Protection
  // --------------------------------------------------------------------------
  it("TC-SSO-11: Enforces that allowlisted student cannot escalate role to tutor", async () => {
    // Add student to allowlist with role 'student'
    await fetch(`${apiBase}/organizations/${orgAId}/sso/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ownerAToken}`,
      },
      body: JSON.stringify({
        email: "strict_student@partner.org",
        name: "Strict Student",
        role: "student",
      }),
    });

    // Caller requests role: "tutor" in launch token
    const launchRes = await fetch(`${apiBase}/v1/sso/launch-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKeyA}`,
      },
      body: JSON.stringify({
        roomCode: roomCodeA,
        userId: "strict_student_id",
        email: "strict_student@partner.org",
        name: "Strict Student",
        role: "tutor", // Attempt role escalation
      }),
    });

    assert.equal(launchRes.status, 201);
    const launchData = await launchRes.json();
    // Role must remain student!
    assert.equal(launchData.user.role, "student");

    // Consume and verify claims
    const consumeRes = await fetch(`${apiBase}/v1/sso/consume-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: launchData.launchToken, roomCode: roomCodeA }),
    });
    const consumeData = await consumeRes.json();
    assert.equal(consumeData.role, "student");
    const claims = verifyParticipantToken(consumeData.participantToken);
    assert.equal(claims.role, "student");
    assert.equal(claims.permissions.isHost, false);
  });

  // --------------------------------------------------------------------------
  // 12. Expired Launch Token Rejection
  // --------------------------------------------------------------------------
  it("TC-SSO-12: Rejects expired launch token with 401 SSO_TOKEN_EXPIRED", async () => {
    // Generate valid token
    const launchRes = await fetch(`${apiBase}/v1/sso/launch-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKeyA}`,
      },
      body: JSON.stringify({
        roomCode: roomCodeA,
        userId: "expire_test_usr",
        email: "student_exp@mathsy.in",
        name: "Expiring Student",
      }),
    });
    assert.equal(launchRes.status, 201);
    const { launchToken } = await launchRes.json();

    // Manually force expiry in database
    const tokenHash = crypto.createHash("sha256").update(launchToken).digest("hex");
    await query(
      "UPDATE sso_launch_tokens SET expires_at = NOW() - INTERVAL '10 seconds' WHERE token_hash = $1;",
      [tokenHash]
    );

    // Attempt to consume -> 401 SSO_TOKEN_EXPIRED
    const consumeRes = await fetch(`${apiBase}/v1/sso/consume-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: launchToken, roomCode: roomCodeA }),
    });

    assert.equal(consumeRes.status, 401);
    const consumeData = await consumeRes.json();
    assert.equal(consumeData.code, "SSO_TOKEN_EXPIRED");
  });

  // --------------------------------------------------------------------------
  // 13. Audit Log Recording
  // --------------------------------------------------------------------------
  it("TC-SSO-13: Verifies audit logs record sso_launch_created events", async () => {
    const logsRes = await query(
      `SELECT action, key_prefix, metadata FROM api_key_audit_logs
       WHERE organization_id = $1 AND action = 'sso_launch_created'
       ORDER BY created_at DESC LIMIT 1;`,
      [orgAId]
    );

    assert.ok(logsRes.rows.length > 0);
    const log = logsRes.rows[0];
    assert.equal(log.action, "sso_launch_created");
    assert.equal(log.key_prefix, "sso");
    assert.ok(log.metadata.email);
    assert.equal(log.metadata.roomCode, roomCodeA);
  });
});
