import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { query, pool } from "../server/db";

const JWT_SECRET = process.env.JWT_SECRET || "mathsy_meet_jwt_secret_dev_key_2026";
const API_BASE = process.env.API_BASE || "http://localhost:5001/api";

const tutor1Id = "11111111-1111-4111-8111-111111111111";
const tutor2Id = "22222222-2222-4222-8222-222222222222";
const student1Id = "33333333-3333-4333-8333-333333333333";
const student2Id = "44444444-4444-4444-8444-444444444444";

const tutor1Token = jwt.sign(
  { id: tutor1Id, sub: tutor1Id, email: "tutor1@mathsy.in", name: "Prof. Ramanujan", role: "tutor" },
  JWT_SECRET,
  { expiresIn: "1h" }
);

const tutor2Token = jwt.sign(
  { id: tutor2Id, sub: tutor2Id, email: "tutor2@mathsy.in", name: "Prof. Euler", role: "tutor" },
  JWT_SECRET,
  { expiresIn: "1h" }
);

const studentToken = jwt.sign(
  { id: student1Id, sub: student1Id, email: "student@mathsy.in", name: "Student Host Impositor", role: "student" },
  JWT_SECRET,
  { expiresIn: "1h" }
);

describe("Phase 4 & 5: Room Authorization, Trustworthy Roles & Meeting Join Flow", () => {
  const testRoomCode = "sec-auth-tst-" + Math.random().toString(36).substring(2, 6);

  it("TC-ROOM-01: Unauthenticated room creation is rejected with 401", async () => {
    const res = await fetch(`${API_BASE}/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room_code: "unauth-room-code",
        title: "Unauth Class",
      }),
    });

    assert.equal(res.status, 401, "Unauthenticated room creation must return 401");
  });

  it("TC-ROOM-02: Student cannot create a room (returns 403 Forbidden)", async () => {
    const res = await fetch(`${API_BASE}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        room_code: "student-room-attempt",
        title: "Student Trying to Host",
      }),
    });

    assert.equal(res.status, 403, "Student must not be allowed to create rooms");
    const data = await res.json();
    assert.ok(data.error.includes("Only tutors"));
  });

  it("TC-ROOM-03: Authenticated tutor successfully creates and persists room", async () => {
    const res = await fetch(`${API_BASE}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tutor1Token}`,
      },
      body: JSON.stringify({
        room_code: testRoomCode,
        title: "Calculus I Lecture",
        is_active: true,
      }),
    });

    assert.equal(res.status, 200, "Tutor creating room must return 200");
    const data = await res.json();
    assert.equal(data.room.room_code, testRoomCode);
    assert.equal(data.room.tutor_id, tutor1Id);
    assert.equal(data.room.tutor_name, "Prof. Ramanujan");
    assert.equal(data.room.is_active, true);
  });

  it("TC-ROOM-04: Student joining nonexistent room returns 404 and does NOT auto-create row", async () => {
    const ghostRoomCode = "ghost-nonexistent-" + Math.random().toString(36).substring(2, 8);

    const res = await fetch(`${API_BASE}/rooms/${ghostRoomCode}/participants`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        display_name: "Lost Student",
        role: "student",
      }),
    });

    assert.equal(res.status, 404, "Joining nonexistent room must return 404");

    // Check DB directly to ensure NO row was inserted into live_classes with null tutor
    const checkDb = await query("SELECT * FROM live_classes WHERE room_code = $1", [ghostRoomCode]);
    assert.equal(checkDb.rows.length, 0, "Nonexistent room must NOT cause DB creation of orphan rooms");
  });

  it("TC-ROOM-05: Authenticated student joins valid active room with server-assigned role", async () => {
    const res = await fetch(`${API_BASE}/rooms/${testRoomCode}/participants`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        display_name: "Student Host Impositor",
        role: "tutor", // Malicious client claims to be a tutor!
      }),
    });

    assert.equal(res.status, 200, "Student joining valid room must return 200");
    const data = await res.json();
    // Server must strictly override client self-elevation!
    assert.equal(data.isHost, false, "Student must never be granted isHost");
    assert.equal(data.participant.role, "student", "Role must be server-assigned to 'student'");
    assert.equal(data.participant.user_id, student1Id, "Participant user_id must match authenticated session");
  });

  it("TC-ROOM-06: Display name containing 'tutor' or 'host' confers ZERO host privileges", async () => {
    const tricksterToken = jwt.sign(
      { id: student2Id, sub: student2Id, email: "tricky@mathsy.in", name: "Tutor Host Admin Boss", role: "student" },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    const res = await fetch(`${API_BASE}/rooms/${testRoomCode}/participants`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tricksterToken}`,
      },
      body: JSON.stringify({
        display_name: "Tutor Host Admin Boss",
        role: "tutor",
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.isHost, false, "Display name with 'tutor' or 'host' must confer 0 privileges");
    assert.equal(data.participant.role, "student");
  });

  it("TC-ROOM-07: Room owner tutor joining is authorized with isHost = true and role = tutor", async () => {
    const res = await fetch(`${API_BASE}/rooms/${testRoomCode}/participants`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tutor1Token}`,
      },
      body: JSON.stringify({
        display_name: "Prof. Ramanujan",
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.isHost, true, "Room owner tutor must have isHost = true");
    assert.equal(data.participant.role, "tutor", "Room owner role must be 'tutor'");
  });

  it("TC-ROOM-08: A tutor cannot overwrite or hijack another tutor's room", async () => {
    const res = await fetch(`${API_BASE}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tutor2Token}`, // Different tutor!
      },
      body: JSON.stringify({
        room_code: testRoomCode,
        title: "Hijacked Class",
      }),
    });

    assert.equal(res.status, 403, "Tutor cannot overwrite another tutor's room");
    const data = await res.json();
    assert.ok(data.error.includes("only the room owner"));
  });

  it("TC-ROOM-09: Reconnecting student closes prior active session with zero duplicates", async () => {
    // Rejoin room with student1
    await fetch(`${API_BASE}/rooms/${testRoomCode}/participants`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        display_name: "Rejoining Student",
      }),
    });

    // Verify active participants in DB for this room and user
    const dbRes = await query(
      "SELECT * FROM room_participants WHERE room_code = $1 AND user_id = $2 AND left_at IS NULL",
      [testRoomCode, student1Id]
    );
    assert.equal(dbRes.rows.length, 1, "There must be exactly 1 active participant session after rejoin");
  });

  it("TC-ROOM-10: Ending class closes room; students cannot subsequently join", async () => {
    // Tutor ends the meeting
    const endRes = await fetch(`${API_BASE}/rooms/${testRoomCode}/end`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tutor1Token}`,
      },
    });
    assert.equal(endRes.status, 200, "Ending meeting must succeed");

    // Student attempts to join closed room
    const joinClosedRes = await fetch(`${API_BASE}/rooms/${testRoomCode}/participants`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
    });
    assert.equal(joinClosedRes.status, 404, "Joining ended room must return 404");
  });

  after(async () => {
    await pool.end();
  });
});
