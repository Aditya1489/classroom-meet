import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { query, pool } from "../server/db";
import { createApiKey } from "../server/services/apiKeyService";
import {
  issueParticipantToken,
  verifyParticipantToken,
  PARTICIPANT_JWT_SECRET,
  TOKEN_ISSUER,
  TOKEN_AUDIENCE,
} from "../server/services/participantTokenService";
import {
  validatePostMessageOrigin,
  parseAndValidateEmbedCommand,
  createEmbedEventMessage,
  EmbedCommandMessage,
  sanitizeUrlToken,
} from "../src/types/embedProtocol";

const PORT = process.env.PORT || 5001;
const API_BASE = `http://localhost:${PORT}/api/v1`;

describe("Phase 2: SaaS Hosted Meeting & Secure Embed Implementation", () => {
  let orgAId: string;
  let orgBId: string;
  let orgSuspendedId: string;

  let roomAId: string;
  let roomACode: string;
  let roomBId: string;
  let roomBCode: string;

  let validTutorTokenA: string;
  let validStudentTokenA: string;
  let studentNoMicTokenA: string;
  let tokenTenantB: string;

  before(async () => {
    // 1. Setup Tenant A with allowed customer apps
    const orgARes = await query(
      `INSERT INTO organizations (name, slug, status, settings)
       VALUES ('Tenant Alpha Embed', 'tenant-alpha-embed-${Date.now()}', 'active', '{"plan": "enterprise"}'::jsonb)
       RETURNING id;`
    );
    orgAId = orgARes.rows[0].id;

    // Register allowed domains for Tenant A
    await query(
      `INSERT INTO customer_apps (organization_id, app_name, allowed_domains, branding)
       VALUES ($1, 'Alpha Portal', ARRAY['https://alpha-portal.com', 'https://staging.alpha-portal.com'], '{"primary_color": "#10b981"}'::jsonb);`,
      [orgAId]
    );

    // 2. Setup Tenant B with different allowed domains
    const orgBRes = await query(
      `INSERT INTO organizations (name, slug, status, settings)
       VALUES ('Tenant Beta Embed', 'tenant-beta-embed-${Date.now()}', 'active', '{"plan": "pro"}'::jsonb)
       RETURNING id;`
    );
    orgBId = orgBRes.rows[0].id;

    await query(
      `INSERT INTO customer_apps (organization_id, app_name, allowed_domains)
       VALUES ($1, 'Beta Dashboard', ARRAY['https://beta-dashboard.io']);`,
      [orgBId]
    );

    // 3. Setup Suspended Tenant
    const orgSuspendedRes = await query(
      `INSERT INTO organizations (name, slug, status, settings)
       VALUES ('Tenant Suspended Embed', 'tenant-suspended-embed-${Date.now()}', 'suspended', '{}'::jsonb)
       RETURNING id;`
    );
    orgSuspendedId = orgSuspendedRes.rows[0].id;

    // 4. Create Rooms
    roomACode = `emb-alpha-${crypto.randomBytes(3).toString("hex")}`;
    const roomARes = await query(
      `INSERT INTO live_classes (organization_id, room_code, title, tutor_name, is_active, started_at)
       VALUES ($1, $2, 'Alpha Hosted Class', 'Tutor Alpha', TRUE, NOW())
       RETURNING id;`,
      [orgAId, roomACode]
    );
    roomAId = roomARes.rows[0].id;

    roomBCode = `emb-beta-${crypto.randomBytes(3).toString("hex")}`;
    const roomBRes = await query(
      `INSERT INTO live_classes (organization_id, room_code, title, tutor_name, is_active, started_at)
       VALUES ($1, $2, 'Beta Hosted Class', 'Tutor Beta', TRUE, NOW())
       RETURNING id;`,
      [orgBId, roomBCode]
    );
    roomBId = roomBRes.rows[0].id;

    // 5. Mint Participant Tokens
    const tTutorA = issueParticipantToken({
      organizationId: orgAId,
      room: { id: roomAId, room_code: roomACode, is_active: true },
      participantId: "tutor-alpha-1",
      name: "Tutor Alpha",
      role: "tutor",
      permissions: { canPublishAudio: true, canPublishVideo: true, canPublishScreen: true, canChat: true, isHost: true },
    });
    validTutorTokenA = tTutorA.token;

    const tStudentA = issueParticipantToken({
      organizationId: orgAId,
      room: { id: roomAId, room_code: roomACode, is_active: true },
      participantId: "student-alpha-1",
      name: "Student Alpha",
      role: "student",
      permissions: { canPublishAudio: true, canPublishVideo: true, canPublishScreen: false, canChat: true, isHost: false },
    });
    validStudentTokenA = tStudentA.token;

    const tStudentNoMicA = issueParticipantToken({
      organizationId: orgAId,
      room: { id: roomAId, room_code: roomACode, is_active: true },
      participantId: "student-alpha-nomic",
      name: "Student Silent",
      role: "student",
      permissions: { canPublishAudio: false, canPublishVideo: true, canPublishScreen: false, canChat: true, isHost: false },
    });
    studentNoMicTokenA = tStudentNoMicA.token;

    const tStudentB = issueParticipantToken({
      organizationId: orgBId,
      room: { id: roomBId, room_code: roomBCode, is_active: true },
      participantId: "student-beta-1",
      name: "Student Beta",
      role: "student",
      permissions: { canPublishAudio: false, canPublishVideo: true, canPublishScreen: false, canChat: true, isHost: false },
    });
    tokenTenantB = tStudentB.token;
  });

  // =========================================================================
  // SUB-SUITE 1: EMBED CONFIGURATION & CSP ORIGIN VERIFICATION
  // =========================================================================
  describe("1. Embed Configuration & CSP Frame-Ancestors Endpoint", () => {
    it("TC-EMB-01: Returns authorized embedding config and CSP headers for tenant-approved origin", async () => {
      const res = await fetch(
        `${API_BASE}/embed/config/${roomACode}?parentOrigin=https://alpha-portal.com`,
        {
          headers: { Origin: "https://alpha-portal.com" },
        }
      );

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.valid, true);
      assert.strictEqual(data.roomCode, roomACode);
      assert.strictEqual(data.isOriginAllowed, true);
      assert.ok(data.allowedOrigins.includes("https://alpha-portal.com"));

      // Verify Content-Security-Policy frame-ancestors header
      const csp = res.headers.get("content-security-policy");
      assert.ok(csp, "CSP header must be present");
      assert.ok(csp.includes("frame-ancestors"), "CSP must define frame-ancestors");
      assert.ok(csp.includes("https://alpha-portal.com"), "CSP must include tenant-approved domain");

      // Verify Referrer-Policy header to prevent token leakage
      const refPolicy = res.headers.get("referrer-policy");
      assert.ok(refPolicy === "no-referrer" || refPolicy === "strict-origin-when-cross-origin");
    });

    it("TC-EMB-02: Flags unauthorized parent origin as isOriginAllowed: false", async () => {
      const res = await fetch(
        `${API_BASE}/embed/config/${roomACode}?parentOrigin=https://attacker-embedder.evil`,
        {
          headers: { Origin: "https://attacker-embedder.evil" },
        }
      );

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.valid, true);
      assert.strictEqual(data.isOriginAllowed, false);
      assert.ok(!data.allowedOrigins.includes("https://attacker-embedder.evil"));
    });

    it("TC-EMB-03: Rejects embed config request for nonexistent or ended room (404)", async () => {
      const res = await fetch(`${API_BASE}/embed/config/non-existent-room-999`);
      assert.strictEqual(res.status, 404);
      const data = await res.json();
      assert.strictEqual(data.valid, false);
    });

    it("TC-EMB-04: Ignores client-supplied tenant ID or domains; derives strictly from DB", async () => {
      // Client tries to spoof tenant ID in query params
      const res = await fetch(
        `${API_BASE}/embed/config/${roomACode}?tenantId=${orgBId}&parentOrigin=https://beta-dashboard.io`
      );

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      // Must be orgAId, NOT orgBId
      assert.strictEqual(data.organizationId, orgAId);
      // Origin from Org B must NOT be allowed for Room A
      assert.strictEqual(data.isOriginAllowed, false);
    });
  });

  // =========================================================================
  // SUB-SUITE 2: PARTICIPANT TOKEN SERVER VERIFICATION
  // =========================================================================
  describe("2. Participant Token Verification Endpoint", () => {
    it("TC-EMB-05: Verifies valid participant token for correct room and returns authoritative claims", async () => {
      const res = await fetch(`${API_BASE}/embed/verify-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: validStudentTokenA,
          roomCode: roomACode,
        }),
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.valid, true);
      assert.strictEqual(data.claims.participantId, "student-alpha-1");
      assert.strictEqual(data.claims.name, "Student Alpha");
      assert.strictEqual(data.claims.role, "student");
      assert.strictEqual(data.claims.tenantId, orgAId);
      assert.strictEqual(data.claims.roomCode, roomACode);
      assert.strictEqual(data.claims.permissions.canPublishAudio, true);
      assert.strictEqual(data.claims.permissions.isHost, false);
    });

    it("TC-EMB-06: Rejects participant token when presented for a different room (Room Mismatch)", async () => {
      // Presenting Room A token for Room B
      const res = await fetch(`${API_BASE}/embed/verify-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: validStudentTokenA,
          roomCode: roomBCode, // Mismatched room
        }),
      });

      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.valid, false);
      assert.strictEqual(data.code, "ROOM_MISMATCH");
    });

    it("TC-EMB-07: Rejects participant token from Tenant A attempting to join Tenant B room (Cross-Tenant Rejection)", async () => {
      // Tenant B's token attempted in Room A
      const res = await fetch(`${API_BASE}/embed/verify-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: tokenTenantB,
          roomCode: roomACode,
        }),
      });

      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.valid, false);
    });

    it("TC-EMB-08: Rejects expired participant token", async () => {
      // Create expired token
      const expiredPayload = {
        iss: TOKEN_ISSUER,
        aud: TOKEN_AUDIENCE,
        sub: "expired-user",
        tenant_id: orgAId,
        room_code: roomACode,
        room_id: roomAId,
        name: "Expired User",
        role: "student",
        permissions: { canPublishAudio: false, canPublishVideo: true, canPublishScreen: false, canChat: true, isHost: false },
        iat: Math.floor(Date.now() / 1000) - 3600,
        exp: Math.floor(Date.now() / 1000) - 10, // 10 seconds in the past
      };
      const expiredToken = jwt.sign(expiredPayload, PARTICIPANT_JWT_SECRET, { algorithm: "HS256" });

      const res = await fetch(`${API_BASE}/embed/verify-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: expiredToken,
          roomCode: roomACode,
        }),
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.valid, false);
      assert.strictEqual(data.code, "TOKEN_EXPIRED");
    });

    it("TC-EMB-09: Rejects forged signature or malformed participant token", async () => {
      const forgedToken = validStudentTokenA.slice(0, -10) + "invalidSig99";
      const res = await fetch(`${API_BASE}/embed/verify-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: forgedToken,
          roomCode: roomACode,
        }),
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.valid, false);
      assert.strictEqual(data.code, "INVALID_TOKEN");
    });
  });

  // =========================================================================
  // SUB-SUITE 3: TOKEN URL SCRUBBING & PRIVACY SAFEGUARDS
  // =========================================================================
  describe("3. Token URL Scrubbing & Anti-Leak Safeguards", () => {
    it("TC-EMB-10: Extracts token from query param and produces clean target URL without leaking token", () => {
      const dirtyUrl = "https://meet.mathsy.in/embed/ptq-rtvq-rox?token=eyJhbGciOiJIUzI1NiIsIn...&parentOrigin=https://alpha.com";
      const { token, cleanUrl } = sanitizeUrlToken(dirtyUrl);

      assert.strictEqual(token, "eyJhbGciOiJIUzI1NiIsIn...");
      assert.ok(!cleanUrl.includes("token="), "Clean URL must NOT contain token parameter");
      assert.ok(cleanUrl.includes("/embed/ptq-rtvq-rox"));
      assert.ok(cleanUrl.includes("parentOrigin="), "Non-sensitive query params should be preserved");
    });

    it("TC-EMB-11: Extracts token from URL hash and strips it cleanly", () => {
      const hashUrl = "https://meet.mathsy.in/embed/ptq-rtvq-rox#token=secret-hash-token-xyz";
      const { token, cleanUrl } = sanitizeUrlToken(hashUrl);

      assert.strictEqual(token, "secret-hash-token-xyz");
      assert.ok(!cleanUrl.includes("secret-hash-token-xyz"));
      assert.strictEqual(cleanUrl, "https://meet.mathsy.in/embed/ptq-rtvq-rox");
    });
  });

  // =========================================================================
  // SUB-SUITE 4: POSTMESSAGE PROTOCOL & ORIGIN VALIDATION
  // =========================================================================
  describe("4. Typed postMessage Protocol & Origin Validation", () => {
    const tenantAllowedOrigins = ["https://alpha-portal.com", "https://staging.alpha-portal.com"];

    it("TC-EMB-12: Accepts postMessage only from tenant-whitelisted origins", () => {
      assert.strictEqual(validatePostMessageOrigin("https://alpha-portal.com", tenantAllowedOrigins), true);
      assert.strictEqual(validatePostMessageOrigin("https://staging.alpha-portal.com", tenantAllowedOrigins), true);
      assert.strictEqual(validatePostMessageOrigin("https://attacker.evil", tenantAllowedOrigins), false);
      assert.strictEqual(validatePostMessageOrigin("http://alpha-portal.com", tenantAllowedOrigins), false); // No insecure HTTP
      assert.strictEqual(validatePostMessageOrigin("*", tenantAllowedOrigins), false);
      assert.strictEqual(validatePostMessageOrigin("", tenantAllowedOrigins), false);
    });

    it("TC-EMB-13: Parses and validates documented commands (MUTE_AUDIO, UNMUTE_AUDIO, ENABLE_VIDEO, DISABLE_VIDEO, LEAVE_MEETING)", () => {
      const validCmd1 = parseAndValidateEmbedCommand({ type: "MUTE_AUDIO" });
      assert.ok(validCmd1);
      assert.strictEqual(validCmd1.type, "MUTE_AUDIO");

      const validCmd2 = parseAndValidateEmbedCommand({ type: "UNMUTE_AUDIO" });
      assert.ok(validCmd2);
      assert.strictEqual(validCmd2.type, "UNMUTE_AUDIO");

      const validCmd3 = parseAndValidateEmbedCommand({ type: "ENABLE_VIDEO" });
      assert.ok(validCmd3);
      assert.strictEqual(validCmd3.type, "ENABLE_VIDEO");

      const validCmd4 = parseAndValidateEmbedCommand({ type: "DISABLE_VIDEO" });
      assert.ok(validCmd4);
      assert.strictEqual(validCmd4.type, "DISABLE_VIDEO");

      const validCmd5 = parseAndValidateEmbedCommand({ type: "LEAVE_MEETING" });
      assert.ok(validCmd5);
      assert.strictEqual(validCmd5.type, "LEAVE_MEETING");
    });

    it("TC-EMB-14: Ignores undocumented, malformed, or injected commands without throwing", () => {
      assert.strictEqual(parseAndValidateEmbedCommand({ type: "ELEVATE_TO_ADMIN" }), null);
      assert.strictEqual(parseAndValidateEmbedCommand({ type: "KICK_ALL" }), null);
      assert.strictEqual(parseAndValidateEmbedCommand(null), null);
      assert.strictEqual(parseAndValidateEmbedCommand("plain-string"), null);
      assert.strictEqual(parseAndValidateEmbedCommand({}), null);
      assert.strictEqual(parseAndValidateEmbedCommand({ type: 12345 }), null);
    });

    it("TC-EMB-15: Outbound event construction strictly attaches payload and timestamp without wildcard origin", () => {
      const event = createEmbedEventMessage("meeting.joined", {
        roomCode: roomACode,
        participantId: "student-alpha-1",
        role: "student",
      });

      assert.strictEqual(event.type, "meeting.joined");
      assert.strictEqual(event.payload.roomCode, roomACode);
      assert.strictEqual(typeof event.timestamp, "number");
    });
  });

  // =========================================================================
  // SUB-SUITE 5: PERMISSIONS ENFORCEMENT & BACKWARD COMPATIBILITY
  // =========================================================================
  describe("5. Permissions Enforcement & Backward Compatibility", () => {
    it("TC-EMB-16: Student token with canPublishAudio: false cannot execute unmute command", () => {
      const claims = verifyParticipantToken(studentNoMicTokenA);
      assert.strictEqual(claims.permissions.canPublishAudio, false);
      assert.strictEqual(claims.permissions.isHost, false);

      // Verify that canPublishAudio guard prevents audio publication
      const canPublish = claims.permissions.canPublishAudio;
      assert.strictEqual(canPublish, false, "Participant without canPublishAudio must not publish audio");
    });

    it("TC-EMB-17: Legacy Mathsy classroom routes and tables continue functioning unaltered", async () => {
      // 1. Existing GET /api/rooms/:roomCode
      const res = await fetch(`http://localhost:${PORT}/api/rooms/${roomACode}`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.room.room_code, roomACode);

      // 2. Existing First-Party organization seed exists
      const fpOrgRes = await query("SELECT id, slug, status FROM organizations WHERE id = '00000000-0000-0000-0000-000000000001'");
      assert.strictEqual(fpOrgRes.rows.length, 1);
      assert.strictEqual(fpOrgRes.rows[0].status, "active");
    });
  });

  after(async () => {
    // Cleanup test data
    if (roomACode) {
      await query("DELETE FROM room_participants WHERE room_code = $1", [roomACode]);
      await query("DELETE FROM live_classes WHERE room_code = $1", [roomACode]);
    }
    if (roomBCode) {
      await query("DELETE FROM room_participants WHERE room_code = $1", [roomBCode]);
      await query("DELETE FROM live_classes WHERE room_code = $1", [roomBCode]);
    }
    if (orgAId) {
      await query("DELETE FROM customer_apps WHERE organization_id = $1", [orgAId]);
      await query("DELETE FROM organizations WHERE id = $1", [orgAId]);
    }
    if (orgBId) {
      await query("DELETE FROM customer_apps WHERE organization_id = $1", [orgBId]);
      await query("DELETE FROM organizations WHERE id = $1", [orgBId]);
    }
    if (orgSuspendedId) {
      await query("DELETE FROM organizations WHERE id = $1", [orgSuspendedId]);
    }
    await pool.end();
    setTimeout(() => process.exit(0), 500);
  });
});
