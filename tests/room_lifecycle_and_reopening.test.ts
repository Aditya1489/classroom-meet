import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { pool, query } from "../server/db";
import { app } from "../server/index";
import {
  reconcileAbandonedRooms,
  DEFAULT_UNSTARTED_EMPTY_ROOM_HOURS,
  DEFAULT_ABANDONED_IDLE_MINUTES,
} from "../server/services/meteringService";
import { createSsoLaunchToken, getOrCreateSsoConfig } from "../server/services/ssoService";
import { generateToken } from "../server/routes/auth";

describe("Room Lifecycle, Extended Grace Period & Tutor Reactivation Suite", () => {
  let server: http.Server;
  let testPort: number;
  let apiBase: string;

  let testOrgId: string;
  let testTutorId: string;
  let testStudentId: string;

  before(async () => {
    // 1. Create test organization
    const orgRes = await query(
      `INSERT INTO organizations (name, slug, status, settings)
       VALUES ('Lifecycle Test Org', $1, 'active', '{}')
       RETURNING id;`,
      [`lifecycle-test-${Date.now()}`]
    );
    testOrgId = orgRes.rows[0].id;

    // Enable SSO with mathsy.in domain
    await query(
      `INSERT INTO organization_sso_configs (organization_id, sso_enabled, default_role, allow_auto_provisioning)
       VALUES ($1, TRUE, 'student', TRUE);`,
      [testOrgId]
    );
    await query(
      `INSERT INTO organization_sso_domains (organization_id, domain, is_verified)
       VALUES ($1, 'mathsy.in', TRUE);`,
      [testOrgId]
    );

    // Create test tutor and student in users table
    testTutorId = crypto.randomUUID();
    testStudentId = crypto.randomUUID();

    await query(
      `INSERT INTO users (id, email, full_name, role, auth_provider)
       VALUES ($1, $2, 'Test Tutor', 'tutor', 'google'),
              ($3, $4, 'Test Student', 'student', 'google');`,
      [
        testTutorId, `tutor_${Date.now()}@mathsy.in`,
        testStudentId, `student_${Date.now()}@mathsy.in`
      ]
    );

    // Start ephemeral server
    await new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, () => {
        const addr = server.address() as any;
        testPort = addr.port;
        apiBase = `http://localhost:${testPort}/api`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (testOrgId) {
      await query("DELETE FROM organizations WHERE id = $1;", [testOrgId]);
    }
    if (testTutorId) {
      await query("DELETE FROM users WHERE id IN ($1, $2);", [testTutorId, testStudentId]);
    }
    await pool.end();
    process.exit(0);
  });

  it("TC-LIFE-01: Verifies DEFAULT_UNSTARTED_EMPTY_ROOM_HOURS is at least 24 hours", () => {
    assert.ok(
      DEFAULT_UNSTARTED_EMPTY_ROOM_HOURS >= 24,
      `Expected unstarted empty room grace hours to be at least 24h, got ${DEFAULT_UNSTARTED_EMPTY_ROOM_HOURS}`
    );
  });

  it("TC-LIFE-02: Preserves unstarted scheduled room after 45 minutes of zero participants", async () => {
    const roomCode = `test-sched-${Date.now()}`.slice(0, 30);
    
    // Insert room created 45 minutes ago with 0 participants
    await query(
      `INSERT INTO live_classes (
         organization_id, room_code, title, is_active, created_at, started_at
       )
       VALUES ($1, $2, 'Scheduled Calculus', TRUE, NOW() - interval '45 minutes', NOW() - interval '45 minutes');`,
      [testOrgId, roomCode]
    );

    // Run reconciliation with standard settings
    const result = await reconcileAbandonedRooms({
      idleMinutes: 30,
      unstartedGraceHours: 24,
      maxDurationHours: 24,
    });

    assert.ok(!result.roomCodes.includes(roomCode), "Scheduled empty room should NOT be swept after only 45 minutes");

    // Verify room is still active in database
    const checkRes = await query("SELECT is_active FROM live_classes WHERE room_code = $1;", [roomCode]);
    assert.equal(checkRes.rows[0].is_active, true, "Room must remain is_active = TRUE");

    // Cleanup
    await query("DELETE FROM live_classes WHERE room_code = $1;", [roomCode]);
  });

  it("TC-LIFE-03: Correctly reaps a completed room where all participants left > 30 minutes ago", async () => {
    const roomCode = `test-ended-${Date.now()}`.slice(0, 30);

    // Insert room
    await query(
      `INSERT INTO live_classes (
         organization_id, room_code, title, is_active, created_at, started_at
       )
       VALUES ($1, $2, 'Completed Class', TRUE, NOW() - interval '2 hours', NOW() - interval '2 hours');`,
      [testOrgId, roomCode]
    );

    // Record participant who joined and left 35 minutes ago
    await query(
      `INSERT INTO room_participants (
         room_code, user_id, display_name, role, joined_at, left_at
       )
       VALUES ($1, $2, 'Student A', 'student', NOW() - interval '1 hour', NOW() - interval '35 minutes');`,
      [roomCode, testStudentId]
    );

    // Run reconciliation
    const result = await reconcileAbandonedRooms({
      idleMinutes: 30,
      unstartedGraceHours: 24,
      maxDurationHours: 24,
    });

    assert.ok(result.roomCodes.includes(roomCode), "Completed room where everyone left >30m ago MUST be reaped");

    // Verify room is marked inactive
    const checkRes = await query("SELECT is_active, ended_at FROM live_classes WHERE room_code = $1;", [roomCode]);
    assert.equal(checkRes.rows[0].is_active, false);
    assert.ok(checkRes.rows[0].ended_at !== null);

    // Cleanup
    await query("DELETE FROM live_classes WHERE room_code = $1;", [roomCode]);
  });

  it("TC-LIFE-04: Tutor launch token generation automatically reactivates an ended room", async () => {
    const roomCode = `test-reactivate-${Date.now()}`.slice(0, 30);

    // Create inactive/ended room
    await query(
      `INSERT INTO live_classes (
         organization_id, room_code, title, is_active, created_at, started_at, ended_at
       )
       VALUES ($1, $2, 'Ended Lecture', FALSE, NOW() - interval '1 hour', NOW() - interval '1 hour', NOW() - interval '10 minutes');`,
      [testOrgId, roomCode]
    );

    // Request launch token as tutor
    const ssoResult = await createSsoLaunchToken({
      organizationId: testOrgId,
      roomCode,
      userId: "tutor_sso_1",
      email: "tutor@mathsy.in",
      name: "Tutor Aditya",
      role: "tutor",
    });

    assert.ok(ssoResult.launchToken, "Should generate launch token for reactivated room");

    // Verify room is now is_active = TRUE in PostgreSQL
    const checkRes = await query("SELECT is_active, ended_at FROM live_classes WHERE room_code = $1;", [roomCode]);
    assert.equal(checkRes.rows[0].is_active, true, "Room should be reactivated by tutor");
    assert.equal(checkRes.rows[0].ended_at, null, "ended_at should be cleared on reactivation");

    // Cleanup
    await query("DELETE FROM live_classes WHERE room_code = $1;", [roomCode]);
  });

  it("TC-LIFE-05: Authenticated tutor can reactivate an ended room via POST /api/rooms/:roomCode/reactivate", async () => {
    const roomCode = `test-tutor-reopen-${Date.now()}`.slice(0, 30);

    // Create inactive room owned by testTutorId
    await query(
      `INSERT INTO live_classes (
         organization_id, room_code, title, tutor_id, tutor_name, is_active, created_at, started_at, ended_at
       )
       VALUES ($1, $2, 'Ended Calculus Class', $3, 'Test Tutor', FALSE, NOW() - interval '2 hours', NOW() - interval '2 hours', NOW() - interval '30 minutes');`,
      [testOrgId, roomCode, testTutorId]
    );

    const tutorJwt = generateToken({
      id: testTutorId,
      email: "tutor@mathsy.in",
      role: "tutor",
      name: "Test Tutor",
    });

    const res = await fetch(`${apiBase}/rooms/${roomCode}/reactivate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tutorJwt}`,
        "Content-Type": "application/json",
      },
    });

    assert.equal(res.status, 200, `Expected 200 OK, got ${res.status}`);
    const data: any = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.room.is_active, true);

    const dbCheck = await query("SELECT is_active, ended_at FROM live_classes WHERE room_code = $1;", [roomCode]);
    assert.equal(dbCheck.rows[0].is_active, true);
    assert.equal(dbCheck.rows[0].ended_at, null);

    // Cleanup
    await query("DELETE FROM live_classes WHERE room_code = $1;", [roomCode]);
  });

  it("TC-LIFE-06: Student is forbidden from reactivating room (403 FORBIDDEN)", async () => {
    const roomCode = `test-student-blocked-${Date.now()}`.slice(0, 30);

    await query(
      `INSERT INTO live_classes (
         organization_id, room_code, title, tutor_id, tutor_name, is_active, created_at, started_at, ended_at
       )
       VALUES ($1, $2, 'Ended Class', $3, 'Test Tutor', FALSE, NOW() - interval '1 hour', NOW() - interval '1 hour', NOW() - interval '20 minutes');`,
      [testOrgId, roomCode, testTutorId]
    );

    const studentJwt = generateToken({
      id: testStudentId,
      email: "student@mathsy.in",
      role: "student",
      name: "Test Student",
    });

    const res = await fetch(`${apiBase}/rooms/${roomCode}/reactivate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${studentJwt}`,
        "Content-Type": "application/json",
      },
    });

    assert.equal(res.status, 403, `Expected 403 Forbidden, got ${res.status}`);
    const data: any = await res.json();
    assert.equal(data.code, "FORBIDDEN");

    // Cleanup
    await query("DELETE FROM live_classes WHERE room_code = $1;", [roomCode]);
  });

  it("TC-LIFE-07: Unauthenticated request to reactivate room is rejected (401 Unauthorized)", async () => {
    const res = await fetch(`${apiBase}/rooms/random-room-code/reactivate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(res.status, 401);
  });

  it("TC-LIFE-08: Authenticated tutor can initialize/create a room on-the-fly via POST /api/rooms", async () => {
    const roomCode = `onthefly-${Date.now()}`.slice(0, 30);

    const tutorJwt = generateToken({
      id: testTutorId,
      email: "tutor@mathsy.in",
      role: "tutor",
      name: "Test Tutor",
    });

    const res = await fetch(`${apiBase}/rooms`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tutorJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        room_code: roomCode,
        title: "On The Fly Class",
        is_active: true,
      }),
    });

    assert.equal(res.status, 200, `Expected 200 OK, got ${res.status}`);
    const data: any = await res.json();
    assert.equal(data.room.room_code, roomCode);
    assert.equal(data.room.is_active, true);

    const dbCheck = await query("SELECT id, room_code, is_active FROM live_classes WHERE room_code = $1;", [roomCode]);
    assert.equal(dbCheck.rows.length, 1);
    assert.equal(dbCheck.rows[0].is_active, true);

    // Cleanup
    await query("DELETE FROM live_classes WHERE room_code = $1;", [roomCode]);
  });

  it("TC-LIFE-09: Student is forbidden from creating room via POST /api/rooms (403)", async () => {
    const roomCode = `student-room-${Date.now()}`.slice(0, 30);

    const studentJwt = generateToken({
      id: testStudentId,
      email: "student@mathsy.in",
      role: "student",
      name: "Test Student",
    });

    const res = await fetch(`${apiBase}/rooms`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${studentJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        room_code: roomCode,
        title: "Unauthorized Student Room",
      }),
    });

    assert.equal(res.status, 403);
  });

  it("TC-LIFE-10: Reject invalid room code format with 400 Bad Request", async () => {
    const tutorJwt = generateToken({
      id: testTutorId,
      email: "tutor@mathsy.in",
      role: "tutor",
      name: "Test Tutor",
    });

    const res = await fetch(`${apiBase}/rooms`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tutorJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        room_code: "<script>alert('xss')</script>",
        title: "Bad Room",
      }),
    });

    assert.equal(res.status, 400);
    const data: any = await res.json();
    assert.equal(data.code, "INVALID_ROOM_CODE_FORMAT");
  });
});
