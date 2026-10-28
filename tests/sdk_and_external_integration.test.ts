import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { query, pool } from "../server/db";
import { createApiKey } from "../server/services/apiKeyService";
import {
  MathsyMeetServerClient,
  MathsyMeetError,
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  SecurityError,
  embedMeeting,
} from "../sdk/src/index";
import { verifyParticipantToken, PARTICIPANT_JWT_SECRET } from "../server/services/participantTokenService";

const PORT = process.env.PORT || 5001;
const API_BASE = `http://localhost:${PORT}/api/v1`;
const EMBED_BASE = `http://localhost:${PORT}`;

describe("Phase 3: Developer SDK & External Website Integration Suite", () => {
  let orgAId: string;
  let orgBId: string;
  let keyFullA: string;
  let keyReadOnlyA: string;
  let keyNoTokensA: string;
  let keyFullB: string;

  let clientA: MathsyMeetServerClient;
  let clientReadOnlyA: MathsyMeetServerClient;
  let clientNoTokensA: MathsyMeetServerClient;
  let clientB: MathsyMeetServerClient;

  let createdRoomCodeA: string;
  let createdRoomIdA: string;

  before(async () => {
    // 1. Setup Tenant A
    const orgARes = await query(
      `INSERT INTO organizations (name, slug, status, settings)
       VALUES ('Acme University Phase 3', 'acme-p3-${Date.now()}', 'active', '{"plan": "enterprise"}'::jsonb)
       RETURNING id;`
    );
    orgAId = orgARes.rows[0].id;

    // Allowed domains for Tenant A
    await query(
      `INSERT INTO customer_apps (organization_id, app_name, allowed_domains, branding)
       VALUES ($1, 'Acme Portal', ARRAY['https://acme-portal.edu', 'http://localhost:5002'], '{"primary_color": "#4f46e5"}'::jsonb);`,
      [orgAId]
    );

    // Setup Tenant B
    const orgBRes = await query(
      `INSERT INTO organizations (name, slug, status, settings)
       VALUES ('Beta LMS Phase 3', 'beta-p3-${Date.now()}', 'active', '{}'::jsonb)
       RETURNING id;`
    );
    orgBId = orgBRes.rows[0].id;

    // 2. Generate API Keys
    const k1 = await createApiKey({
      organizationId: orgAId,
      name: "Acme Full Key",
      permissions: ["rooms:read", "rooms:write", "tokens:write"],
    });
    keyFullA = k1.rawKey;

    const k2 = await createApiKey({
      organizationId: orgAId,
      name: "Acme Read Only Key",
      permissions: ["rooms:read"],
    });
    keyReadOnlyA = k2.rawKey;

    const k3 = await createApiKey({
      organizationId: orgAId,
      name: "Acme Rooms Only Key",
      permissions: ["rooms:read", "rooms:write"],
    });
    keyNoTokensA = k3.rawKey;

    const k4 = await createApiKey({
      organizationId: orgBId,
      name: "Beta Full Key",
      permissions: ["rooms:read", "rooms:write", "tokens:write"],
    });
    keyFullB = k4.rawKey;

    // 3. Instantiate SDK Clients
    clientA = new MathsyMeetServerClient({ apiKey: keyFullA, apiBaseUrl: API_BASE });
    clientReadOnlyA = new MathsyMeetServerClient({ apiKey: keyReadOnlyA, apiBaseUrl: API_BASE });
    clientNoTokensA = new MathsyMeetServerClient({ apiKey: keyNoTokensA, apiBaseUrl: API_BASE });
    clientB = new MathsyMeetServerClient({ apiKey: keyFullB, apiBaseUrl: API_BASE });
  });

  // =========================================================================
  // SUB-SUITE 1: SERVER SDK CREDENTIALS & INTEGRITY
  // =========================================================================
  describe("1. Server SDK Credentials & Browser Leak Prevention", () => {
    it("TC-SDK-01: Rejects missing, non-string, or invalid API key formats", () => {
      assert.throws(
        () => new MathsyMeetServerClient({ apiKey: "" }),
        (err: any) => err instanceof SecurityError && err.message.includes("API key is required")
      );

      assert.throws(
        () => new MathsyMeetServerClient({ apiKey: "invalid_key_format_123" }),
        (err: any) => err instanceof SecurityError && err.message.includes("Invalid API key format")
      );
    });

    it("TC-SDK-02: Throws SecurityError if initialized in a browser environment", () => {
      // Simulate browser global window
      (globalThis as any).window = {};
      try {
        assert.throws(
          () => new MathsyMeetServerClient({ apiKey: keyFullA }),
          (err: any) => err instanceof SecurityError && err.message.includes("browser")
        );
      } finally {
        delete (globalThis as any).window;
      }
    });

    it("TC-SDK-03: Successfully authenticates valid API key and verifies scopes", async () => {
      const verifyRes = await clientA.verifyApiKey();
      assert.strictEqual(verifyRes.authenticated, true);
      assert.strictEqual(verifyRes.organization.id, orgAId);
      assert.ok(verifyRes.permissions.includes("rooms:write"));
      assert.ok(verifyRes.permissions.includes("tokens:write"));
    });
  });

  // =========================================================================
  // SUB-SUITE 2: ROOM LIFECYCLE MANAGEMENT VIA SERVER SDK
  // =========================================================================
  describe("2. Meeting Room Lifecycle via Server SDK", () => {
    it("TC-SDK-04: Creates a meeting room with custom title, metadata, and auto roomCode", async () => {
      const room = await clientA.createMeeting({
        title: "Introduction to Calculus",
        metadata: { courseId: "MATH-201", semester: "Fall 2026" },
        settings: { default_camera_locked: true },
      });

      assert.ok(room.id);
      assert.ok(room.roomCode);
      assert.strictEqual(room.title, "Introduction to Calculus");
      assert.strictEqual(room.isActive, true);
      assert.strictEqual(room.organizationId, orgAId);
      assert.strictEqual(room.metadata?.courseId, "MATH-201");

      createdRoomCodeA = room.roomCode;
      createdRoomIdA = room.id;
    });

    it("TC-SDK-05: Retrieves room metadata by roomCode and UUID", async () => {
      // By room code
      const roomByCode = await clientA.getMeeting(createdRoomCodeA);
      assert.strictEqual(roomByCode.id, createdRoomIdA);
      assert.strictEqual(roomByCode.roomCode, createdRoomCodeA);
      assert.strictEqual(roomByCode.title, "Introduction to Calculus");

      // By UUID
      const roomById = await clientA.getMeeting(createdRoomIdA);
      assert.strictEqual(roomById.id, createdRoomIdA);
    });

    it("TC-SDK-06: Lists participants in the room", async () => {
      const pList = await clientA.listParticipants(createdRoomCodeA);
      assert.strictEqual(pList.roomCode, createdRoomCodeA);
      assert.ok(Array.isArray(pList.participants));
    });

    it("TC-SDK-07: Fails when API key lacks rooms:write permission", async () => {
      await assert.rejects(
        () => clientReadOnlyA.createMeeting({ title: "Unauthorized Class" }),
        (err: any) => err instanceof ForbiddenError && err.statusCode === 403
      );
    });

    it("TC-SDK-08: Tenant B cannot access Tenant A's room (Tenant Isolation)", async () => {
      await assert.rejects(
        () => clientB.getMeeting(createdRoomCodeA),
        (err: any) => err instanceof NotFoundError && err.statusCode === 404
      );
    });
  });

  // =========================================================================
  // SUB-SUITE 3: PARTICIPANT TOKEN ISSUANCE VIA SERVER SDK
  // =========================================================================
  describe("3. Participant Token Issuance & Permission Guarding", () => {
    it("TC-SDK-09: Mints authoritative tutor token with host privileges", async () => {
      const result = await clientA.createParticipantToken(createdRoomCodeA, {
        participantId: "prof-curie",
        name: "Professor Curie",
        role: "tutor",
        expiresInSeconds: 3600,
        permissions: {
          canPublishAudio: true,
          canPublishVideo: true,
          canPublishScreen: true,
          canChat: true,
          isHost: true,
        },
      });

      assert.ok(result.token);
      assert.ok(result.expiresAt);
      assert.strictEqual(result.room.roomCode, createdRoomCodeA);
      assert.strictEqual(result.participant.id, "prof-curie");
      assert.strictEqual(result.participant.role, "tutor");
      assert.strictEqual(result.participant.permissions.isHost, true);

      // Verify token signature and claims cryptographically
      const claims = verifyParticipantToken(result.token);
      assert.strictEqual(claims.sub, "prof-curie");
      assert.strictEqual(claims.tenant_id, orgAId);
      assert.strictEqual(claims.room_code, createdRoomCodeA);
      assert.strictEqual(claims.permissions.isHost, true);
    });

    it("TC-SDK-10: Mints student token and strips host privileges authoritatively", async () => {
      const result = await clientA.createParticipantToken(createdRoomCodeA, {
        participantId: "student-john",
        name: "John Doe",
        role: "student",
        // Student attempts to elevate privileges to host
        permissions: {
          isHost: true as any,
          canPublishScreen: true,
        },
      });

      assert.strictEqual(result.participant.role, "student");
      assert.strictEqual(result.participant.permissions.isHost, false, "Host privileges must be stripped");
      assert.strictEqual(result.participant.permissions.canPublishScreen, false, "Screen share must be disabled for student");

      const claims = verifyParticipantToken(result.token);
      assert.strictEqual(claims.permissions.isHost, false);
      assert.strictEqual(claims.permissions.canPublishScreen, false);
    });

    it("TC-SDK-11: Rejects token issuance when API key lacks tokens:write permission", async () => {
      await assert.rejects(
        () => clientNoTokensA.createParticipantToken(createdRoomCodeA, {
          participantId: "student-fail",
          name: "Denied Student",
          role: "student",
        }),
        (err: any) => err instanceof ForbiddenError && err.statusCode === 403
      );
    });

    it("TC-SDK-12: Tenant B cannot mint token for Tenant A's room", async () => {
      await assert.rejects(
        () => clientB.createParticipantToken(createdRoomCodeA, {
          participantId: "intruder-beta",
          name: "Intruder",
          role: "student",
        }),
        (err: any) => err instanceof NotFoundError && err.statusCode === 404
      );
    });
  });

  // =========================================================================
  // SUB-SUITE 4: BROWSER SDK & EMBEDDING CONTROLLER
  // =========================================================================
  describe("4. Browser SDK (embedMeeting helper & postMessage protocol)", () => {
    let studentToken: string;

    before(async () => {
      const res = await clientA.createParticipantToken(createdRoomCodeA, {
        participantId: "browser-test-student",
        name: "Browser Tester",
        role: "student",
      });
      studentToken = res.token;
    });

    it("TC-SDK-13: Validates required options and generates iframe with security attributes", () => {
      // Mock DOM container and iframe creation in Node test environment
      const mockChildren: any[] = [];
      const mockContainer: any = {
        appendChild: (child: any) => mockChildren.push(child),
        removeChild: (child: any) => {
          const idx = mockChildren.indexOf(child);
          if (idx !== -1) mockChildren.splice(idx, 1);
        },
      };

      const controller = embedMeeting({
        container: mockContainer,
        roomCode: createdRoomCodeA,
        token: studentToken,
        embedBaseUrl: EMBED_BASE,
        parentOrigin: "https://acme-portal.edu",
      });

      assert.ok(controller);
      assert.ok(controller.iframe);
      assert.strictEqual(mockChildren.length, 1);

      const iframe = controller.iframe;
      assert.ok(iframe.src.includes(`/embed/${createdRoomCodeA}`));
      assert.ok(iframe.src.includes(`parentOrigin=${encodeURIComponent("https://acme-portal.edu")}`));
      // Check allow attribute for camera and microphone permissions
      assert.ok(iframe.allow.includes("camera"));
      assert.ok(iframe.allow.includes("microphone"));
      assert.ok(iframe.allow.includes("display-capture"));

      // Clean up
      controller.destroy();
      assert.strictEqual(mockChildren.length, 0);
    });

    it("TC-SDK-14: Dispatches typed postMessage commands to iframe using exact target origin (No wildcard)", () => {
      let sentMessage: any = null;
      let targetOriginSent: string | null = null;

      const mockIframe: any = {
        contentWindow: {
          postMessage: (msg: any, target: string) => {
            sentMessage = msg;
            targetOriginSent = target;
          },
        },
      };

      const mockContainer: any = {
        appendChild: () => {},
        removeChild: () => {},
      };

      const controller = embedMeeting({
        container: mockContainer,
        roomCode: createdRoomCodeA,
        token: studentToken,
        embedBaseUrl: EMBED_BASE,
        parentOrigin: "https://acme-portal.edu",
        _mockIframe: mockIframe, // Test hook
      });

      // 1. Mute Audio Command
      controller.muteAudio();
      assert.strictEqual(sentMessage.type, "MUTE_AUDIO");
      assert.strictEqual(targetOriginSent, EMBED_BASE);
      assert.notStrictEqual(targetOriginSent, "*", "Target origin must NEVER be wildcard");

      // 2. Unmute Audio Command
      controller.unmuteAudio();
      assert.strictEqual(sentMessage.type, "UNMUTE_AUDIO");

      // 3. Enable Video Command
      controller.enableVideo();
      assert.strictEqual(sentMessage.type, "ENABLE_VIDEO");

      // 4. Disable Video Command
      controller.disableVideo();
      assert.strictEqual(sentMessage.type, "DISABLE_VIDEO");

      // 5. Leave Meeting Command
      controller.leaveMeeting();
      assert.strictEqual(sentMessage.type, "LEAVE_MEETING");

      controller.destroy();
    });

    it("TC-SDK-15: Emits typed events to subscribers and ignores untrusted event origins", () => {
      const mockContainer: any = { appendChild: () => {}, removeChild: () => {} };
      const controller = embedMeeting({
        container: mockContainer,
        roomCode: createdRoomCodeA,
        token: studentToken,
        embedBaseUrl: EMBED_BASE,
        parentOrigin: "https://acme-portal.edu",
      });

      let readyFired = false;
      let readyPayload: any = null;

      controller.on("ready", (payload: any) => {
        readyFired = true;
        readyPayload = payload;
      });

      // Simulate inbound postMessage from embed iframe
      // 1. From legitimate EMBED_BASE origin
      controller._handleIncomingMessage?.({
        origin: EMBED_BASE,
        data: {
          type: "meeting.ready",
          payload: { roomCode: createdRoomCodeA, participantId: "p-1" },
        },
      });

      assert.strictEqual(readyFired, true);
      assert.strictEqual(readyPayload.roomCode, createdRoomCodeA);

      // 2. From malicious origin: should be ignored
      let errorFiredFromEvil = false;
      controller.on("error", () => {
        errorFiredFromEvil = true;
      });

      controller._handleIncomingMessage?.({
        origin: "https://attacker.evil",
        data: {
          type: "meeting.error",
          payload: { code: "FORGED_ERROR" },
        },
      });

      assert.strictEqual(errorFiredFromEvil, false, "Events from untrusted origins must be ignored");

      controller.destroy();
    });
  });

  // =========================================================================
  // SUB-SUITE 5: MEETING TERMINATION & POST-END TOKEN BLOCKING
  // =========================================================================
  describe("5. Meeting Termination & Cleanup", () => {
    it("TC-SDK-16: Ends meeting through Server SDK and verifies isActive: false", async () => {
      const endRes = await clientA.endMeeting(createdRoomCodeA);
      assert.strictEqual(endRes.success, true);
      assert.strictEqual(endRes.room.isActive, false);

      // Subsequent token issuance on ended room must be rejected
      await assert.rejects(
        () => clientA.createParticipantToken(createdRoomCodeA, {
          participantId: "student-late",
          name: "Late Student",
          role: "student",
        }),
        (err: any) => err instanceof MathsyMeetError && err.code === "ROOM_ENDED"
      );
    });
  });

  after(async () => {
    try {
      if (orgAId) {
        await query("DELETE FROM organizations WHERE id = $1;", [orgAId]);
      }
      if (orgBId) {
        await query("DELETE FROM organizations WHERE id = $1;", [orgBId]);
      }
      await pool.end();
    } catch (e) {
      // ignore
    }
    setTimeout(() => process.exit(0), 500);
  });
});
