import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { query, pool } from "../server/db";
import { createApiKey } from "../server/services/apiKeyService";
import { issueParticipantToken, verifyParticipantToken, PARTICIPANT_JWT_SECRET } from "../server/services/participantTokenService";

const PORT = process.env.PORT || 5001;
const API_BASE = `http://localhost:${PORT}/api/v1`;

describe("Milestone 4: Tenant-Scoped Room API & Participant Token Suite", () => {
  let orgAId: string;
  let orgBId: string;
  let orgSuspendedId: string;

  // Org A API Keys
  let keyFullA: string;
  let keyReadOnlyA: string;
  let keyNoTokensA: string;

  // Org B API Keys
  let keyFullB: string;

  // Suspended Org API Key
  let keySuspended: string;

  // Created Room in Org A
  let roomAId: string;
  let roomACode: string;

  before(async () => {
    // 1. Create test organizations
    const orgARes = await query(
      `INSERT INTO organizations (name, slug, status, settings)
       VALUES ('Tenant Alpha M4', 'tenant-alpha-m4-${Date.now()}', 'active', '{"plan": "pro"}'::jsonb)
       RETURNING id;`
    );
    orgAId = orgARes.rows[0].id;

    const orgBRes = await query(
      `INSERT INTO organizations (name, slug, status, settings)
       VALUES ('Tenant Beta M4', 'tenant-beta-m4-${Date.now()}', 'active', '{"plan": "pro"}'::jsonb)
       RETURNING id;`
    );
    orgBId = orgBRes.rows[0].id;

    const orgSuspendedRes = await query(
      `INSERT INTO organizations (name, slug, status, settings)
       VALUES ('Suspended Org M4', 'suspended-m4-${Date.now()}', 'active', '{}'::jsonb)
       RETURNING id;`
    );
    orgSuspendedId = orgSuspendedRes.rows[0].id;

    // 2. Generate API keys
    // Org A - Full access (rooms:read, rooms:write, tokens:write)
    const k1 = await createApiKey({
      organizationId: orgAId,
      name: "Alpha Full Key",
      permissions: ["rooms:read", "rooms:write", "tokens:write"],
    });
    keyFullA = k1.rawKey;

    // Org A - Read Only (rooms:read)
    const k2 = await createApiKey({
      organizationId: orgAId,
      name: "Alpha Read Only",
      permissions: ["rooms:read"],
    });
    keyReadOnlyA = k2.rawKey;

    // Org A - Rooms Only (no tokens:write)
    const k3 = await createApiKey({
      organizationId: orgAId,
      name: "Alpha Rooms Only",
      permissions: ["rooms:read", "rooms:write"],
    });
    keyNoTokensA = k3.rawKey;

    // Org B - Full access
    const k4 = await createApiKey({
      organizationId: orgBId,
      name: "Beta Full Key",
      permissions: ["rooms:read", "rooms:write", "tokens:write"],
    });
    keyFullB = k4.rawKey;

    // Suspended Org (create key while active, then suspend org)
    const k5 = await createApiKey({
      organizationId: orgSuspendedId,
      name: "Suspended Key",
      permissions: ["rooms:read", "rooms:write", "tokens:write"],
    });
    keySuspended = k5.rawKey;
    await query("UPDATE organizations SET status = 'suspended' WHERE id = $1;", [orgSuspendedId]);
  });

  after(async () => {
    // Clean up created test data
    if (roomACode) {
      await query("DELETE FROM room_participants WHERE room_code = $1;", [roomACode]);
      await query("DELETE FROM live_classes WHERE room_code = $1;", [roomACode]);
    }
    await query("DELETE FROM live_classes WHERE organization_id IN ($1, $2, $3);", [orgAId, orgBId, orgSuspendedId]);
    await query("DELETE FROM api_keys WHERE organization_id IN ($1, $2, $3);", [orgAId, orgBId, orgSuspendedId]);
    await query("DELETE FROM api_key_audit_logs WHERE organization_id IN ($1, $2, $3);", [orgAId, orgBId, orgSuspendedId]);
    await query("DELETE FROM organizations WHERE id IN ($1, $2, $3);", [orgAId, orgBId, orgSuspendedId]);
    await pool.end();
  });

  // --- TC-M4-01: Room Creation with Valid API Key & Organization Scoping ---
  it("TC-M4-01: Creates room with valid API key, derives organization, and stores metadata", async () => {
    const res = await fetch(`${API_BASE}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": keyFullA,
      },
      body: JSON.stringify({
        title: "Calculus Advanced",
        settings: { cameraDefault: true, micDefault: false },
        metadata: { department: "Mathematics" },
      }),
    });

    assert.strictEqual(res.status, 201, "Expected 201 Created");
    const json = await res.json();
    assert.ok(json.room, "Response must include room object");
    assert.strictEqual(json.room.title, "Calculus Advanced");
    assert.strictEqual(json.room.organizationId, orgAId, "Must be bound to Org A");
    assert.strictEqual(json.room.isActive, true);
    assert.strictEqual(json.room.settings.cameraDefault, true);
    assert.ok(json.room.roomCode, "Must generate roomCode");

    roomAId = json.room.id;
    roomACode = json.room.roomCode;
  });

  // --- TC-M4-02: Spoofing Prevention ---
  it("TC-M4-02: Ignores client-supplied organization_id in request body and enforces authenticated tenant", async () => {
    const res = await fetch(`${API_BASE}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": keyFullA,
      },
      body: JSON.stringify({
        title: "Spoof Attempt Room",
        organization_id: orgBId, // Attempting to spoof Org B
        tenantId: orgBId,
      }),
    });

    assert.strictEqual(res.status, 201);
    const json = await res.json();
    // Must remain assigned to Org A (the authenticated key's owner)
    assert.strictEqual(json.room.organizationId, orgAId);
    assert.notStrictEqual(json.room.organizationId, orgBId);

    // Clean up spoof attempt room
    await query("DELETE FROM live_classes WHERE id = $1;", [json.room.id]);
  });

  // --- TC-M4-03: Scope Enforcement (Missing rooms:write) ---
  it("TC-M4-03: Rejects room creation when API key lacks rooms:write permission", async () => {
    const res = await fetch(`${API_BASE}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": keyReadOnlyA,
      },
      body: JSON.stringify({ title: "Unauthorized Room" }),
    });

    assert.strictEqual(res.status, 403);
    const json = await res.json();
    assert.strictEqual(json.code, "INSUFFICIENT_PERMISSIONS");
  });

  // --- TC-M4-04: Global Room Code Uniqueness Enforcement ---
  it("TC-M4-04: Enforces global room_code uniqueness and returns 409 Conflict on collision", async () => {
    const res = await fetch(`${API_BASE}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": keyFullB,
      },
      body: JSON.stringify({
        title: "Duplicate Code Attempt",
        roomCode: roomACode, // Attempting to reuse Org A's code
      }),
    });

    assert.strictEqual(res.status, 409);
    const json = await res.json();
    assert.strictEqual(json.code, "ROOM_CODE_ALREADY_EXISTS");
  });

  // --- TC-M4-05: Tenant Room Retrieval by ID and room_code ---
  it("TC-M4-05: Retrieves room metadata by UUID and room_code for authorized owner", async () => {
    // 1. By UUID
    const resById = await fetch(`${API_BASE}/rooms/${roomAId}`, {
      headers: { "X-API-Key": keyFullA },
    });
    assert.strictEqual(resById.status, 200);
    const jsonById = await resById.json();
    assert.strictEqual(jsonById.room.id, roomAId);
    assert.strictEqual(jsonById.room.roomCode, roomACode);

    // 2. By room_code
    const resByCode = await fetch(`${API_BASE}/rooms/${roomACode}`, {
      headers: { "X-API-Key": keyReadOnlyA },
    });
    assert.strictEqual(resByCode.status, 200);
    const jsonByCode = await resByCode.json();
    assert.strictEqual(jsonByCode.room.id, roomAId);
  });

  // --- TC-M4-06: Cross-Tenant Isolation on Room Retrieval (Zero Info Leakage) ---
  it("TC-M4-06: Org B cannot retrieve Org A's room (returns 404 ROOM_NOT_FOUND)", async () => {
    const res = await fetch(`${API_BASE}/rooms/${roomAId}`, {
      headers: { "X-API-Key": keyFullB },
    });
    assert.strictEqual(res.status, 404);
    const json = await res.json();
    assert.strictEqual(json.code, "ROOM_NOT_FOUND");
  });

  // --- TC-M4-07: Participant Token Issuance with Valid Roles & Permissions ---
  it("TC-M4-07: Mints short-lived participant JWT for tutor and student with authoritative claims", async () => {
    // 1. Tutor Token
    const tutorRes = await fetch(`${API_BASE}/rooms/${roomAId}/tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": keyFullA,
      },
      body: JSON.stringify({
        participantId: "prof-alan-101",
        name: "Professor Alan Turing",
        role: "tutor",
        expiresInSeconds: 3600,
      }),
    });

    assert.strictEqual(tutorRes.status, 201);
    const tutorJson = await tutorRes.json();
    assert.ok(tutorJson.token, "Must return signed JWT");
    assert.strictEqual(tutorJson.participant.role, "tutor");
    assert.strictEqual(tutorJson.participant.permissions.isHost, true);
    assert.strictEqual(tutorJson.participant.permissions.canPublishAudio, true);

    // Verify token claims cryptographically
    const verifiedTutor = verifyParticipantToken(tutorJson.token);
    assert.strictEqual(verifiedTutor.iss, "mathsy-meet-saas");
    assert.strictEqual(verifiedTutor.aud, "mathsy-meet-sfu");
    assert.strictEqual(verifiedTutor.sub, "prof-alan-101");
    assert.strictEqual(verifiedTutor.tenant_id, orgAId);
    assert.strictEqual(verifiedTutor.room_code, roomACode);
    assert.strictEqual(verifiedTutor.role, "tutor");
    assert.strictEqual(verifiedTutor.permissions.isHost, true);

    // 2. Student Token
    const studentRes = await fetch(`${API_BASE}/rooms/${roomACode}/tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": keyFullA,
      },
      body: JSON.stringify({
        participantId: "student-ada-202",
        name: "Ada Lovelace",
        role: "student",
        expiresInSeconds: 3600,
      }),
    });

    assert.strictEqual(studentRes.status, 201);
    const studentJson = await studentRes.json();
    assert.strictEqual(studentJson.participant.role, "student");
    assert.strictEqual(studentJson.participant.permissions.isHost, false);
    // Student mic is muted by default (requires approval)
    assert.strictEqual(studentJson.participant.permissions.canPublishAudio, false);

    const verifiedStudent = verifyParticipantToken(studentJson.token);
    assert.strictEqual(verifiedStudent.sub, "student-ada-202");
    assert.strictEqual(verifiedStudent.permissions.isHost, false);
  });

  // --- TC-M4-08: Authoritative Privilege Boundaries (Student Elevation Blocked) ---
  it("TC-M4-08: Authoritatively strips host privileges if student attempts permission elevation", async () => {
    const res = await fetch(`${API_BASE}/rooms/${roomAId}/tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": keyFullA,
      },
      body: JSON.stringify({
        participantId: "malicious-student",
        name: "Malicious User",
        role: "student",
        permissions: { isHost: true, canPublishScreen: true }, // Forged elevated permissions
      }),
    });

    assert.strictEqual(res.status, 201);
    const json = await res.json();
    assert.strictEqual(json.participant.permissions.isHost, false, "Must strictly reject isHost for student");
    assert.strictEqual(json.participant.permissions.canPublishScreen, false, "Must strictly reject screen sharing for student");

    const claims = verifyParticipantToken(json.token);
    assert.strictEqual(claims.permissions.isHost, false);
  });

  // --- TC-M4-09: Token Issuance Scope Enforcement (Missing tokens:write) ---
  it("TC-M4-09: Rejects token issuance when API key lacks tokens:write permission", async () => {
    const res = await fetch(`${API_BASE}/rooms/${roomAId}/tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": keyNoTokensA,
      },
      body: JSON.stringify({
        participantId: "user-test",
        name: "Test User",
        role: "student",
      }),
    });

    assert.strictEqual(res.status, 403);
    const json = await res.json();
    assert.strictEqual(json.code, "INSUFFICIENT_PERMISSIONS");
  });

  // --- TC-M4-10: Cross-Tenant Token Minting Prevention ---
  it("TC-M4-10: Org B cannot mint participant token for Org A room (returns 404 ROOM_NOT_FOUND)", async () => {
    const res = await fetch(`${API_BASE}/rooms/${roomAId}/tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": keyFullB,
      },
      body: JSON.stringify({
        participantId: "attacker",
        name: "Attacker",
        role: "tutor",
      }),
    });

    assert.strictEqual(res.status, 404);
    const json = await res.json();
    assert.strictEqual(json.code, "ROOM_NOT_FOUND");
  });

  // --- TC-M4-11: Invalid Roles and Suspended Org Rejections ---
  it("TC-M4-11: Rejects invalid roles and suspended organization key requests", async () => {
    // 1. Invalid role
    const invalidRoleRes = await fetch(`${API_BASE}/rooms/${roomAId}/tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": keyFullA,
      },
      body: JSON.stringify({
        participantId: "user-1",
        name: "Admin Attempter",
        role: "superadmin", // Invalid role
      }),
    });
    assert.strictEqual(invalidRoleRes.status, 400);
    const invalidRoleJson = await invalidRoleRes.json();
    assert.strictEqual(invalidRoleJson.code, "INVALID_ROLE");

    // 2. Suspended Org Key
    const suspendedRes = await fetch(`${API_BASE}/rooms/${roomAId}`, {
      headers: { "X-API-Key": keySuspended },
    });
    assert.strictEqual(suspendedRes.status, 403);
    const suspendedJson = await suspendedRes.json();
    assert.strictEqual(suspendedJson.code, "ORG_SUSPENDED");
  });

  // --- TC-M4-12: Participant Listing & Isolation ---
  it("TC-M4-12: Lists active participants for tenant room and isolates from other tenants", async () => {
    // Insert a dummy participant record into Org A's room
    await query(
      `INSERT INTO room_participants (organization_id, room_code, display_name, role, camera_allowed, joined_at)
       VALUES ($1, $2, 'Jane Student', 'student', true, NOW());`,
      [orgAId, roomACode]
    );

    // 1. Authorized read
    const res = await fetch(`${API_BASE}/rooms/${roomACode}/participants`, {
      headers: { "X-API-Key": keyFullA },
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.roomCode, roomACode);
    assert.ok(json.participants.length >= 1);
    assert.strictEqual(json.participants[0].displayName, "Jane Student");

    // 2. Cross-tenant attempt
    const crossRes = await fetch(`${API_BASE}/rooms/${roomACode}/participants`, {
      headers: { "X-API-Key": keyFullB },
    });
    assert.strictEqual(crossRes.status, 404);
  });

  // --- TC-M4-13: Room Termination & Rejection of Token Issuance for Ended Rooms ---
  it("TC-M4-13: Ends room authorized by owner, marks participants left, and blocks further token minting", async () => {
    // 1. Cross-tenant attempt to end room
    const crossEndRes = await fetch(`${API_BASE}/rooms/${roomAId}/end`, {
      method: "POST",
      headers: { "X-API-Key": keyFullB },
    });
    assert.strictEqual(crossEndRes.status, 404);

    // 2. Authorized owner ends room
    const endRes = await fetch(`${API_BASE}/rooms/${roomAId}/end`, {
      method: "POST",
      headers: { "X-API-Key": keyFullA },
    });
    assert.strictEqual(endRes.status, 200);
    const endJson = await endRes.json();
    assert.strictEqual(endJson.success, true);
    assert.strictEqual(endJson.room.isActive, false);

    // Verify room is marked inactive in database
    const dbRes = await query("SELECT is_active, ended_at FROM live_classes WHERE id = $1;", [roomAId]);
    assert.strictEqual(dbRes.rows[0].is_active, false);
    assert.ok(dbRes.rows[0].ended_at);

    // Verify active participants marked as left
    const partRes = await query("SELECT left_at FROM room_participants WHERE room_code = $1;", [roomACode]);
    for (const p of partRes.rows) {
      assert.ok(p.left_at, "Participants must have left_at timestamp set");
    }

    // 3. Attempt to issue token for ended room
    const tokenAfterEndRes = await fetch(`${API_BASE}/rooms/${roomAId}/tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": keyFullA,
      },
      body: JSON.stringify({
        participantId: "late-user",
        name: "Late User",
        role: "student",
      }),
    });
    assert.strictEqual(tokenAfterEndRes.status, 400);
    const tokenAfterEndJson = await tokenAfterEndRes.json();
    assert.strictEqual(tokenAfterEndJson.code, "ROOM_ENDED");
  });

  // --- TC-M4-14: Token Cryptographic Tampering Rejection ---
  it("TC-M4-14: Rejects tampered participant token signature", () => {
    const valid = issueParticipantToken({
      organizationId: orgAId,
      room: { id: roomAId, room_code: roomACode, is_active: true },
      participantId: "test-user",
      name: "Test User",
      role: "student",
    });

    // Tamper with payload (modify role to tutor)
    const [header, payload, sig] = valid.token.split(".");
    const decodedPayload = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    decodedPayload.role = "tutor";
    decodedPayload.permissions.isHost = true;
    const tamperedPayload = Buffer.from(JSON.stringify(decodedPayload)).toString("base64url");
    const tamperedToken = `${header}.${tamperedPayload}.${sig}`;

    assert.throws(
      () => {
        verifyParticipantToken(tamperedToken);
      },
      /invalid signature/,
      "Tampered token must fail signature verification"
    );
  });
});
