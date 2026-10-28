import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import http from "node:http";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { pool, query } from "../server/db";
import {
  validateWebhookUrl,
  computeWebhookSignature,
  createWebhookEndpoint,
  listWebhookEndpoints,
  encryptWebhookSecret,
  decryptWebhookSecret,
} from "../server/services/webhookService";
import {
  validateStartupEnvironment,
  getJwtSecret,
  getWebhookEncryptionKey,
} from "../server/services/envValidator";
import { isRoomHost } from "../server/routes/chat";
import { MathsyMeetServerClient } from "../sdk/dist/server.mjs";
import { MathsyMediasoupEngine } from "../src/engine/mediasoupClient";

const API_BASE = "http://localhost:5001";

describe("Phase 7: Security Remediation Checkpoint 1 Test Suite", () => {
  let orgAId: string;
  let orgBId: string;
  let tutorUserA: { id: string; email: string; token: string };
  let tutorUserB: { id: string; email: string; token: string };
  let studentUser: { id: string; email: string; token: string };
  let roomCodeA: string;
  let roomCodeB: string;

  before(async () => {
    const timestamp = Date.now().toString(36);

    // 1. Create Organization A
    const orgARes = await query(
      `INSERT INTO organizations (name, slug, status, settings, plan_tier, monthly_minute_limit)
       VALUES ('Security Org Alpha', $1, 'active', '{"plan": "enterprise"}'::jsonb, 'enterprise', 50000)
       RETURNING id;`,
      [`sec-alpha-${timestamp}`]
    );
    orgAId = orgARes.rows[0].id;

    // 2. Create Organization B
    const orgBRes = await query(
      `INSERT INTO organizations (name, slug, status, settings, plan_tier, monthly_minute_limit)
       VALUES ('Security Org Beta', $1, 'active', '{"plan": "starter"}'::jsonb, 'starter', 5000)
       RETURNING id;`,
      [`sec-beta-${timestamp}`]
    );
    orgBId = orgBRes.rows[0].id;

    // 3. Register Customer App with allowed domains for Org A
    await query(
      `INSERT INTO customer_apps (organization_id, app_name, allowed_domains, branding)
       VALUES ($1, 'Alpha Portal', ARRAY['https://alpha.example.com', 'https://partner.org'], '{"theme": "dark"}'::jsonb);`,
      [orgAId]
    );


    // 4. Create Tutor User A (Assigned to Room A)
    const tutorAId = crypto.randomUUID();
    const tutorAEmail = `tutor-a-${timestamp}@mathsy.in`;
    await query(
      `INSERT INTO users (id, email, full_name, role, auth_provider)
       VALUES ($1, $2, 'Tutor Alice', 'tutor', 'google');`,
      [tutorAId, tutorAEmail]
    );
    const tutorAToken = jwt.sign(
      { id: tutorAId, email: tutorAEmail, full_name: "Tutor Alice", role: "tutor" },
      getJwtSecret(),
      { expiresIn: "1h" }
    );
    tutorUserA = { id: tutorAId, email: tutorAEmail, token: tutorAToken };

    // 5. Create Tutor User B (Assigned to Room B)
    const tutorBId = crypto.randomUUID();
    const tutorBEmail = `tutor-b-${timestamp}@mathsy.in`;
    await query(
      `INSERT INTO users (id, email, full_name, role, auth_provider)
       VALUES ($1, $2, 'Tutor Bob', 'tutor', 'google');`,
      [tutorBId, tutorBEmail]
    );
    const tutorBToken = jwt.sign(
      { id: tutorBId, email: tutorBEmail, full_name: "Tutor Bob", role: "tutor" },
      getJwtSecret(),
      { expiresIn: "1h" }
    );
    tutorUserB = { id: tutorBId, email: tutorBEmail, token: tutorBToken };

    // 6. Create Student User
    const studentId = crypto.randomUUID();
    const studentEmail = `student-${timestamp}@mathsy.in`;
    await query(
      `INSERT INTO users (id, email, full_name, role, auth_provider)
       VALUES ($1, $2, 'Student Sam', 'student', 'google');`,
      [studentId, studentEmail]
    );
    const studentToken = jwt.sign(
      { id: studentId, email: studentEmail, full_name: "Student Sam", role: "student" },
      getJwtSecret(),
      { expiresIn: "1h" }
    );
    studentUser = { id: studentId, email: studentEmail, token: studentToken };

    // 7. Create Room A (Owned by Tutor A, Org A)
    roomCodeA = `sec-room-a-${timestamp}`;
    await query(
      `INSERT INTO live_classes (id, room_code, title, tutor_id, tutor_name, is_active, organization_id, metadata)
       VALUES (uuid_generate_v4(), $1, 'Alpha Security Class', $2, 'Tutor Alice', TRUE, $3, '{"session_id": "sess-alpha"}'::jsonb);`,
      [roomCodeA, tutorUserA.id, orgAId]
    );

    // 8. Create Room B (Owned by Tutor B, Org B)
    roomCodeB = `sec-room-b-${timestamp}`;
    await query(
      `INSERT INTO live_classes (id, room_code, title, tutor_id, tutor_name, is_active, organization_id, metadata)
       VALUES (uuid_generate_v4(), $1, 'Beta Security Class', $2, 'Tutor Bob', TRUE, $3, '{"session_id": "sess-beta"}'::jsonb);`,
      [roomCodeB, tutorUserB.id, orgBId]
    );

    // 9. Register Student User as participant in Room A
    await query(
      `INSERT INTO room_participants (room_code, user_id, display_name, role, camera_allowed, organization_id, joined_at)
       VALUES ($1, $2, 'Student Sam', 'student', TRUE, $3, NOW());`,
      [roomCodeA, studentUser.id, orgAId]
    );
  });


  // =========================================================================
  // 1. Webhook Signing-Key Mismatch & SDK Verification (P0-1)
  // =========================================================================
  describe("1. Webhook Signing-Key Mismatch & Customer SDK Verification", () => {
    it("should encrypt and decrypt webhook secrets reversibly without leaking plaintext", () => {
      const rawSecret = "whsec_0123456789abcdef0123456789abcdef";
      const key = getWebhookEncryptionKey();

      const encrypted = encryptWebhookSecret(rawSecret, key);
      assert.notStrictEqual(encrypted, rawSecret);
      assert.ok(encrypted.includes(":"), "Encrypted secret must contain iv:tag:ciphertext format");

      const decrypted = decryptWebhookSecret(encrypted, key);
      assert.strictEqual(decrypted, rawSecret, "Decrypted secret must match original secret exactly");
    });

    it("should create webhook endpoint with encrypted_secret and sign with rawSecret matching SDK verifier", async () => {
      // Create endpoint in DB via service (example.com is an IANA resolvable public domain)
      const res = await createWebhookEndpoint({
        organizationId: orgAId,
        url: "https://example.com/webhook",
        events: ["room.created", "room.ended"],
        description: "Production Webhook",
      });


      const { endpoint, rawSecret } = res;
      assert.ok(rawSecret, "One-time reveal secret must be returned on creation");
      assert.ok(rawSecret.startsWith("whsec_"));

      // Verify DB row contains encrypted_secret, not plaintext secret
      const rowRes = await query("SELECT secret_hash, encrypted_secret FROM webhook_endpoints WHERE id = $1;", [endpoint.id]);
      assert.strictEqual(rowRes.rows.length, 1);
      const row = rowRes.rows[0];
      assert.ok(row.encrypted_secret, "encrypted_secret must be persisted in database");
      assert.notStrictEqual(row.encrypted_secret, rawSecret, "Database must not store plaintext secret");

      // Verify listWebhookEndpoints never exposes encrypted_secret or secret
      const list = await listWebhookEndpoints(orgAId);
      const found = list.find((e) => e.id === endpoint.id);
      assert.ok(found);
      assert.strictEqual((found as any).secret, undefined, "List endpoint must not reveal secret");
      assert.strictEqual((found as any).encrypted_secret, undefined, "List endpoint must not reveal encrypted_secret");

      // Simulate webhook dispatch payload
      const payload = {
        event: "room.created",
        roomId: roomCodeA,
        organizationId: orgAId,
        timestamp: new Date().toISOString(),
      };
      const rawBody = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000);

      // Compute signature using raw secret
      const sigHex = computeWebhookSignature(rawSecret, timestamp, rawBody);
      const sigHeader = `t=${timestamp},v1=${sigHex}`;

      // Verify signature via customer SDK
      const verifyResult = MathsyMeetServerClient.verifyWebhookSignature({
        payload: rawBody,
        signatureHeader: sigHeader,
        secret: rawSecret,
      });
      assert.strictEqual(verifyResult.valid, true, "Customer SDK verifyWebhookSignature must accept valid signature");

      // Verify customer SDK rejects tampered payload
      const tamperedBody = JSON.stringify({ ...payload, event: "room.ended" });
      const tamperedResult = MathsyMeetServerClient.verifyWebhookSignature({
        payload: tamperedBody,
        signatureHeader: sigHeader,
        secret: rawSecret,
      });
      assert.strictEqual(tamperedResult.valid, false, "Customer SDK must reject tampered payload");

      // Verify customer SDK rejects incorrect secret
      const wrongSecretResult = MathsyMeetServerClient.verifyWebhookSignature({
        payload: rawBody,
        signatureHeader: sigHeader,
        secret: "whsec_wrongsecret123456789012345678",
      });
      assert.strictEqual(wrongSecretResult.valid, false, "Customer SDK must reject incorrect secret");

      // Verify customer SDK rejects stale timestamp
      const staleTimestamp = Math.floor(Date.now() / 1000) - 400; // 400s old (tolerance is 300s)
      const staleSigHex = computeWebhookSignature(rawSecret, staleTimestamp, rawBody);
      const staleHeader = `t=${staleTimestamp},v1=${staleSigHex}`;
      const staleResult = MathsyMeetServerClient.verifyWebhookSignature({
        payload: rawBody,
        signatureHeader: staleHeader,
        secret: rawSecret,
        toleranceSeconds: 300,
      });
      assert.strictEqual(staleResult.valid, false, "Customer SDK must reject stale timestamp > 300 seconds");
    });
  });

  // =========================================================================
  // 2. SSRF Protection & Safe Redirect Handling (P1-5)
  // =========================================================================
  describe("2. SSRF Protection & Safe Redirect Handling", () => {
    it("should reject private, loopback, and cloud metadata URLs", async () => {
      const maliciousUrls = [
        "http://127.0.0.1:8080/hook",
        "http://localhost:5001/api",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]:8080/hook",
        "http://10.0.0.1/webhook",
        "http://172.16.0.1/webhook",
        "http://192.168.1.1/webhook",
        "ftp://example.com/webhook",
      ];

      for (const url of maliciousUrls) {
        const result = await validateWebhookUrl(url);
        assert.strictEqual(
          result.valid,
          false,
          `Webhook URL validator must reject SSRF target: ${url}`
        );
      }

      const validResult = await validateWebhookUrl("https://api.github.com/webhook");
      assert.strictEqual(
        validResult.valid,
        true,
        "Public HTTPS URL must be accepted"
      );
    });

    it("should reject HTTP redirects during fetch with redirect: error to prevent redirect-based SSRF", async () => {
      // Spin up local HTTP redirect server
      const redirectServer = http.createServer((req, res) => {
        res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" });
        res.end();
      });

      await new Promise<void>((resolve) => redirectServer.listen(0, resolve));
      const port = (redirectServer.address() as any).port;
      const redirectUrl = `http://127.0.0.1:${port}/redirect`;

      try {
        // Outbound fetch with redirect: "error" MUST reject HTTP redirects
        await assert.rejects(
          async () => {
            await fetch(redirectUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ test: "data" }),
              redirect: "error",
            });
          },
          /redirect|fetch failed/i,
          "fetch with redirect: error must throw when redirect is encountered"
        );
      } finally {
        await new Promise<void>((resolve) => redirectServer.close(() => resolve()));
      }
    });
  });

  // =========================================================================
  // 3. Production JWT Secret Startup Validation (P0-2)
  // =========================================================================
  describe("3. Production JWT Secret Startup Validation", () => {
    it("should fail fast in production mode if JWT secrets or encryption key are missing or dev defaults", () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalJwt = process.env.JWT_SECRET;
      const originalPartJwt = process.env.PARTICIPANT_JWT_SECRET;
      const originalEncKey = process.env.WEBHOOK_ENCRYPTION_KEY;
      const originalDbUrl = process.env.DATABASE_URL;

      try {
        process.env.NODE_ENV = "production";
        process.env.DATABASE_URL = "postgres://prod_user:prod_pass@db.example.com:5432/mathsy_meet";
        process.env.WEBHOOK_ENCRYPTION_KEY = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
        process.env.PARTICIPANT_JWT_SECRET = "production_participant_jwt_secret_key_32_chars_1234";

        // 1. Missing JWT_SECRET
        delete process.env.JWT_SECRET;
        assert.throws(
          () => validateStartupEnvironment(),
          /JWT_SECRET/,
          "Must throw when JWT_SECRET is unset in production"
        );

        // 2. Weak JWT_SECRET
        process.env.JWT_SECRET = "too-short";
        assert.throws(
          () => validateStartupEnvironment(),
          /at least 32 characters/,
          "Must throw when JWT_SECRET is weak in production"
        );

        // 3. Dev default JWT_SECRET
        process.env.JWT_SECRET = "mathsy_meet_jwt_secret_dev_key_2026";
        assert.throws(
          () => validateStartupEnvironment(),
          /development default key/,
          "Must throw when development default JWT_SECRET is used in production"
        );

        // Reset valid JWT_SECRET
        process.env.JWT_SECRET = "super_secure_production_secret_key_32_characters_long_12345";

        // 4. Missing PARTICIPANT_JWT_SECRET
        delete process.env.PARTICIPANT_JWT_SECRET;
        assert.throws(
          () => validateStartupEnvironment(),
          /PARTICIPANT_JWT_SECRET/,
          "Must throw when PARTICIPANT_JWT_SECRET is unset in production"
        );

        // 5. Dev default PARTICIPANT_JWT_SECRET
        process.env.PARTICIPANT_JWT_SECRET = "mathsy_participant_token_signing_secret_dev_2026_at_least_32_chars";
        assert.throws(
          () => validateStartupEnvironment(),
          /development default key/,
          "Must throw when default PARTICIPANT_JWT_SECRET is used in production"
        );

        // Reset valid PARTICIPANT_JWT_SECRET
        process.env.PARTICIPANT_JWT_SECRET = "production_participant_jwt_secret_key_32_chars_1234";

        // 6. Missing WEBHOOK_ENCRYPTION_KEY
        delete process.env.WEBHOOK_ENCRYPTION_KEY;
        assert.throws(
          () => validateStartupEnvironment(),
          /WEBHOOK_ENCRYPTION_KEY/,
          "Must throw when WEBHOOK_ENCRYPTION_KEY is unset in production"
        );

        // 7. Invalid hex WEBHOOK_ENCRYPTION_KEY
        process.env.WEBHOOK_ENCRYPTION_KEY = "not-a-64-char-hex-key";
        assert.throws(
          () => validateStartupEnvironment(),
          /32 bytes/,
          "Must throw when WEBHOOK_ENCRYPTION_KEY is not 32 bytes in production"
        );

        // 8. Dev default WEBHOOK_ENCRYPTION_KEY
        process.env.WEBHOOK_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        assert.throws(
          () => validateStartupEnvironment(),
          /development default key/,
          "Must throw when development default WEBHOOK_ENCRYPTION_KEY is used in production"
        );

        // Reset valid WEBHOOK_ENCRYPTION_KEY
        process.env.WEBHOOK_ENCRYPTION_KEY = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

        // 9. Error messages must never print secret values
        try {
          process.env.JWT_SECRET = "leaky_secret_value_attempt_12345";
          validateStartupEnvironment();
        } catch (err: any) {
          assert.strictEqual(err.message.includes("leaky_secret_value_attempt_12345"), false, "Error message must never leak secret content");
        }
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalJwt) process.env.JWT_SECRET = originalJwt; else delete process.env.JWT_SECRET;
        if (originalPartJwt) process.env.PARTICIPANT_JWT_SECRET = originalPartJwt; else delete process.env.PARTICIPANT_JWT_SECRET;
        if (originalEncKey) process.env.WEBHOOK_ENCRYPTION_KEY = originalEncKey; else delete process.env.WEBHOOK_ENCRYPTION_KEY;
        if (originalDbUrl) process.env.DATABASE_URL = originalDbUrl; else delete process.env.DATABASE_URL;
      }
    });


    it("should allow development defaults safely in development/test mode", () => {
      const originalNodeEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = "test";
        // Must not throw in test mode
        assert.doesNotThrow(() => validateStartupEnvironment());
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });
  });

  // =========================================================================
  // 4. Authenticate Legacy Classroom Routes (P0-3)
  // =========================================================================
  describe("4. Authenticate Legacy Classroom Routes (Whiteboard, Polls, Tablet)", () => {
    // 4.1 Whiteboard Authorization
    it("should reject unauthenticated access to whiteboard routes", async () => {
      const res = await fetch(`${API_BASE}/api/rooms/${roomCodeA}/whiteboard`);
      assert.strictEqual(res.status, 401, "Whiteboard snapshot endpoint must reject anonymous requests");
    });

    it("should prevent students from saving whiteboard snapshots without drawing permission", async () => {
      const res = await fetch(`${API_BASE}/api/rooms/${roomCodeA}/whiteboard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${studentUser.token}`,
        },
        body: JSON.stringify({ snapshot: { elements: [] } }),
      });
      assert.strictEqual(res.status, 403, "Student must not be allowed to save whiteboard snapshot when drawing is locked");
    });

    it("should allow the room tutor to save and retrieve whiteboard snapshots", async () => {
      const saveRes = await fetch(`${API_BASE}/api/rooms/${roomCodeA}/whiteboard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tutorUserA.token}`,
        },
        body: JSON.stringify({ snapshot: { shapes: { s1: { id: "s1" } } } }),
      });
      assert.strictEqual(saveRes.status, 200, "Assigned room tutor must be allowed to save snapshot");

      const getRes = await fetch(`${API_BASE}/api/rooms/${roomCodeA}/whiteboard`, {
        headers: { Authorization: `Bearer ${tutorUserA.token}` },
      });
      assert.strictEqual(getRes.status, 200);
      const data = await getRes.json();
      assert.ok(data.snapshot);
    });


    // 4.2 Polls Authorization
    it("should reject unauthenticated access to polls routes", async () => {
      const res = await fetch(`${API_BASE}/api/rooms/${roomCodeA}/polls`);
      assert.strictEqual(res.status, 401, "Polls endpoint must reject anonymous requests");
    });

    it("should prevent students from creating or ending polls", async () => {
      // Attempt poll creation as student
      const createRes = await fetch(`${API_BASE}/api/rooms/${roomCodeA}/polls`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${studentUser.token}`,
        },
        body: JSON.stringify({
          question: "Can student create poll?",
          options: ["Yes", "No"],
        }),
      });
      assert.strictEqual(createRes.status, 403, "Student must be rejected when creating a poll");
    });

    it("should allow room tutor to manage polls and participants to vote", async () => {
      // Tutor creates poll
      const createRes = await fetch(`${API_BASE}/api/rooms/${roomCodeA}/polls`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tutorUserA.token}`,
        },
        body: JSON.stringify({
          question: "Is Mathsy Meet secure?",
          options: ["Absolutely", "Needs Checkpoint 1"],
        }),
      });
      assert.strictEqual(createRes.status, 200);
      const pollData = await createRes.json();
      const pollId = pollData.poll.id;

      // Student votes
      const voteRes = await fetch(`${API_BASE}/api/polls/${pollId}/vote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${studentUser.token}`,
        },
        body: JSON.stringify({ option_index: 0, room_code: roomCodeA }),
      });
      assert.strictEqual(voteRes.status, 200, "Participant must be allowed to vote");

      // Tutor ends poll
      const endRes = await fetch(`${API_BASE}/api/polls/${pollId}/end`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tutorUserA.token}`,
        },
        body: JSON.stringify({ room_code: roomCodeA }),
      });
      assert.strictEqual(endRes.status, 200, "Tutor must be allowed to end poll");
    });

    // 4.3 Tablet Pairing Authorization & Replay Protection
    it("should reject unauthenticated access to tablet generation", async () => {
      const res = await fetch(`${API_BASE}/api/tablet/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_code: roomCodeA, pairing_code: "123-456-789" }),
      });
      assert.strictEqual(res.status, 401, "Tablet generate endpoint must reject anonymous requests");
    });

    it("should prevent students from generating tablet pairings", async () => {
      const res = await fetch(`${API_BASE}/api/tablet/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${studentUser.token}`,
        },
        body: JSON.stringify({ room_code: roomCodeA, pairing_code: "123-456-789" }),
      });
      assert.strictEqual(res.status, 403, "Student must not be allowed to generate tablet pairing code");
    });

    it("should allow tutor to generate tablet pairing and protect against claim replays", async () => {
      const pairingCode = "ABC-DEF-123";

      // 1. Tutor generates code
      const genRes = await fetch(`${API_BASE}/api/tablet/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tutorUserA.token}`,
        },
        body: JSON.stringify({ room_code: roomCodeA, pairing_code: pairingCode }),
      });
      assert.strictEqual(genRes.status, 200, "Tutor must be allowed to generate pairing code");

      // 2. Validate code is active
      const getRes = await fetch(`${API_BASE}/api/tablet/${pairingCode}`);
      assert.strictEqual(getRes.status, 200);
      const pairingData = await getRes.json();
      assert.strictEqual(pairingData.tabletPairing.is_paired, false);

      // 3. First claim succeeds
      const claimRes1 = await fetch(`${API_BASE}/api/tablet/${pairingCode}/claim`, {
        method: "POST",
      });
      assert.strictEqual(claimRes1.status, 200, "First tablet claim must succeed");
      const claimData = await claimRes1.json();
      assert.strictEqual(claimData.tabletPairing.is_paired, true);

      // 4. Second claim (replay attack) is rejected with 409 Conflict
      const claimRes2 = await fetch(`${API_BASE}/api/tablet/${pairingCode}/claim`, {
        method: "POST",
      });
      assert.strictEqual(claimRes2.status, 409, "Replayed claim attempt must be rejected with 409 Conflict");
      const replayData = await claimRes2.json();
      assert.strictEqual(replayData.code, "CODE_ALREADY_CLAIMED");
    });
  });

  // =========================================================================
  // 5. Prevent Self-Service Tutor Privilege Escalation (P0-4)
  // =========================================================================
  describe("5. Prevent Self-Service Tutor Privilege Escalation", () => {
    it("should reject student self-elevation to tutor or admin role", async () => {
      const res = await fetch(`${API_BASE}/api/auth/role`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${studentUser.token}`,
        },
        body: JSON.stringify({ role: "tutor" }),
      });

      assert.strictEqual(res.status, 403, "Self-service promotion to tutor must be rejected with 403");
      const data = await res.json();
      assert.strictEqual(data.code, "FORBIDDEN_ROLE_ELEVATION");

      // Verify DB role was not changed
      const userRes = await query("SELECT role FROM users WHERE id = $1;", [studentUser.id]);
      assert.strictEqual(userRes.rows[0].role, "student", "User role in database must remain student");
    });

    it("should prevent visiting tutors from gaining host privileges in another tutor's room", async () => {
      // Tutor B visits Room A (which is owned by Tutor A)
      const mockRoomA = {
        id: "room-a-id",
        room_code: roomCodeA,
        tutor_id: tutorUserA.id,
        metadata: { tutor_id: tutorUserA.id },
      };

      // Tutor B has user.role === 'tutor', but is NOT the owner of Room A
      const mockTutorBUser = {
        id: tutorUserB.id,
        role: "tutor",
        isParticipantToken: false,
      };

      const isHostInRoomA = isRoomHost(mockTutorBUser, mockRoomA);
      assert.strictEqual(isHostInRoomA, false, "Visiting tutor must NOT be granted isHost in an unassigned room");

      // Legitimate Tutor A in Room A
      const mockTutorAUser = {
        id: tutorUserA.id,
        role: "tutor",
        isParticipantToken: false,
      };
      const isOwnerHost = isRoomHost(mockTutorAUser, mockRoomA);
      assert.strictEqual(isOwnerHost, true, "Assigned room owner must be granted isHost");

      // Tutor B attempting to lock chat in Room A via API
      const lockRes = await fetch(`${API_BASE}/api/rooms/${roomCodeA}/chat/lock`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tutorUserB.token}`,
        },
        body: JSON.stringify({ locked: true }),
      });
      assert.strictEqual(lockRes.status, 403, "Visiting tutor must be rejected when attempting to lock chat in another room");
    });
  });

  // =========================================================================
  // 6. Restrict CORS & IP Handling (P1-6, P1-7)
  // =========================================================================
  describe("6. Restrict CORS & Safe Reverse-Proxy IP Handling", () => {
    it("should allow configured origins and reject unauthorized external origins", async () => {
      // Approved origin: localhost in dev mode
      const approvedRes = await fetch(`${API_BASE}/api/health/live`, {
        headers: { Origin: "http://localhost:5174" },
      });
      assert.strictEqual(
        approvedRes.headers.get("access-control-allow-origin"),
        "http://localhost:5174",
        "Approved local frontend origin must receive allow header"
      );

      // Unauthorized external origin
      const unauthRes = await fetch(`${API_BASE}/api/health/live`, {
        headers: { Origin: "https://evil-hacker-site.com" },
      });
      assert.strictEqual(
        unauthRes.headers.get("access-control-allow-origin"),
        null,
        "Unauthorized external origin must NOT receive access-control-allow-origin header"
      );
    });

    it("should handle CORS preflight OPTIONS requests securely", async () => {
      const preflightRes = await fetch(`${API_BASE}/api/auth/profile`, {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5174",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "Authorization, Content-Type",
        },
      });

      assert.strictEqual(preflightRes.status, 204, "Preflight OPTIONS request must return 204");
      assert.strictEqual(preflightRes.headers.get("access-control-allow-origin"), "http://localhost:5174");
      assert.ok(preflightRes.headers.get("access-control-allow-methods")?.includes("GET"));
    });
  });

  // =========================================================================
  // 7. Enforce CSP frame-ancestors on HTML Embed Document (P1-8)
  // =========================================================================
  describe("7. Enforce CSP frame-ancestors on HTML Embed Document", () => {
    it("should deliver dynamic room/tenant-specific Content-Security-Policy on GET /embed/:roomCode", async () => {
      const res = await fetch(`${API_BASE}/embed/${roomCodeA}`);

      assert.strictEqual(res.status, 200, "Embed HTML document must return HTTP 200");
      assert.ok(
        res.headers.get("content-type")?.includes("text/html"),
        "Embed document response must be text/html"
      );

      const csp = res.headers.get("content-security-policy");
      assert.ok(csp, "Response must include Content-Security-Policy header");
      assert.ok(csp.includes("frame-ancestors"), "CSP must include frame-ancestors directive");
      assert.ok(
        csp.includes("https://alpha.example.com") && csp.includes("https://partner.org"),
        "CSP frame-ancestors must list the tenant customer app's allowed domains"
      );
      assert.ok(csp.includes("'self'"), "CSP frame-ancestors must include 'self'");
    });

    it("should set frame-ancestors 'none' for non-existent or inactive rooms", async () => {
      const res = await fetch(`${API_BASE}/embed/non-existent-room-code-9999`);

      assert.strictEqual(res.status, 404, "Non-existent room must return HTTP 404");
      const csp = res.headers.get("content-security-policy");
      assert.ok(csp, "Error response must include Content-Security-Policy header");
      assert.strictEqual(csp, "frame-ancestors 'none';", "Invalid room must restrict embedding with frame-ancestors 'none'");
    });
  });

  // =========================================================================
  // 8. Fix False-Positive Mediasoup Connection State (P1-9)
  // =========================================================================
  describe("8. Fix False-Positive Mediasoup SFU Connection State", () => {
    it("should report failed connection state and reject promise on socket connect_error", async () => {
      // Connect to a closed port / non-existent signaling endpoint to trigger connect_error
      const client = new MathsyMediasoupEngine("http://127.0.0.1:59999");

      let connectionStates: string[] = [];
      client.onConnectionStateChange = (state: string) => {
        connectionStates.push(state);
      };

      await assert.rejects(
        async () => {
          await client.connect({
            roomId: "test-room-fail",
            userId: "user-1",
            userName: "Test Host",
            role: "host",
            token: "simulated-test-token",
          });
        },
        /websocket|connect|failed|timeout/i,
        "connect must reject the connection promise when Socket.IO fails to connect"
      );


      assert.ok(
        connectionStates.includes("failed"),
        "onConnectionStateChange must emit 'failed' on connect_error"
      );
      assert.strictEqual(
        connectionStates.includes("connected"),
        false,
        "False-positive 'connected' state must NEVER be emitted on connect_error"
      );

      client.disconnect();
    });
  });

  after(async () => {
    // Clean up test data
    await query("DELETE FROM room_participants WHERE room_code IN ($1, $2);", [roomCodeA, roomCodeB]);
    await query("DELETE FROM tablet_pairings WHERE room_code IN ($1, $2);", [roomCodeA, roomCodeB]);
    await query("DELETE FROM whiteboard_snapshots WHERE room_code IN ($1, $2);", [roomCodeA, roomCodeB]);
    await query("DELETE FROM polls WHERE room_code IN ($1, $2);", [roomCodeA, roomCodeB]);
    await query("DELETE FROM live_classes WHERE room_code IN ($1, $2);", [roomCodeA, roomCodeB]);
    await query("DELETE FROM customer_apps WHERE organization_id IN ($1, $2);", [orgAId, orgBId]);
    await query("DELETE FROM webhook_endpoints WHERE organization_id IN ($1, $2);", [orgAId, orgBId]);
    await query("DELETE FROM organizations WHERE id IN ($1, $2);", [orgAId, orgBId]);
    await query("DELETE FROM users WHERE id IN ($1, $2, $3);", [tutorUserA.id, tutorUserB.id, studentUser.id]);
    await pool.end();
    setTimeout(() => process.exit(0), 500);
  });
});
