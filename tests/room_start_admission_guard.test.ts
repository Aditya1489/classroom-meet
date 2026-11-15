import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { generateToken } from "../server/routes/auth";
import { query } from "../server/db";

const BASE_URL = "http://localhost:5001/api";

describe("Room Start Admission Guard & Unstarted Room Containment", () => {
  const hostId = crypto.randomUUID();
  const hostEmail = `host_guard_${Date.now()}@example.com`;
  const hostToken = generateToken({
    id: hostId,
    email: hostEmail,
    role: "tutor",
    name: "Dr. Guard Tutor",
  });

  const studentId = crypto.randomUUID();
  const studentEmail = `student_guard_${Date.now()}@example.com`;
  const studentToken = generateToken({
    id: studentId,
    email: studentEmail,
    role: "student",
    name: "Sam Student",
  });

  const testRoomCode = `grd-${Math.random().toString(36).substring(2, 8)}`;

  before(async () => {
    // Seed host tutor into users table
    await query(
      `INSERT INTO users (id, email, full_name, role, auth_provider, onboarding_completed)
       VALUES ($1, $2, 'Dr. Guard Tutor', 'tutor', 'google', true)
       ON CONFLICT (id) DO NOTHING;`,
      [hostId, hostEmail]
    );

    // Seed student into users table
    await query(
      `INSERT INTO users (id, email, full_name, role, auth_provider, onboarding_completed)
       VALUES ($1, $2, 'Sam Student', 'student', 'google', true)
       ON CONFLICT (id) DO NOTHING;`,
      [studentId, studentEmail]
    );

    // Create the test room with is_active = FALSE (simulating host creating meeting from Landing)
    const createRes = await fetch(`${BASE_URL}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({
        room_code: testRoomCode,
        title: "Unstarted Room Test",
        is_active: false,
      }),
    });
    assert.equal(createRes.status, 200, "Room should be created in database");
  });

  after(async () => {
    await query("DELETE FROM room_knocks WHERE room_code = $1", [testRoomCode]);
    await query("DELETE FROM room_participants WHERE room_code = $1", [testRoomCode]);
    await query("DELETE FROM live_classes WHERE room_code = $1", [testRoomCode]);
    await query("DELETE FROM users WHERE id IN ($1, $2)", [hostId, studentId]);
  });

  it("TC-GUARD-01: Room created from landing starts in inactive state (is_active: false)", async () => {
    const res = await fetch(`${BASE_URL}/rooms/${testRoomCode}`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.room.is_active, false, "Room must be inactive before host starts");
  });

  it("TC-GUARD-02: Non-host knocking on unstarted room receives 'waiting_for_host' status", async () => {
    const res = await fetch(`${BASE_URL}/rooms/${testRoomCode}/knock`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        display_name: "Sam Student",
        email: studentEmail,
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, "waiting_for_host", "Must keep student in waiting_for_host state");
    assert.equal(data.isWaitingForHost, true);
  });

  it("TC-GUARD-03: Non-host attempting to record participant entry in unstarted room is rejected with 403 CLASS_NOT_STARTED", async () => {
    const res = await fetch(`${BASE_URL}/rooms/${testRoomCode}/participants`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({ camera_allowed: false }),
    });

    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.code, "CLASS_NOT_STARTED");
  });

  it("TC-GUARD-04: Host entering calls reactivate/starts class, turning is_active to TRUE", async () => {
    const reactivateRes = await fetch(`${BASE_URL}/rooms/${testRoomCode}/reactivate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hostToken}`,
      },
    });
    assert.equal(reactivateRes.status, 200);

    const roomRes = await fetch(`${BASE_URL}/rooms/${testRoomCode}`);
    const roomData = await roomRes.json();
    assert.equal(roomData.room.is_active, true, "Room should now be active after host starts");
  });

  it("TC-GUARD-05: Non-host can now submit pending knock once class is active", async () => {
    const res = await fetch(`${BASE_URL}/rooms/${testRoomCode}/knock`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        display_name: "Sam Student",
        email: studentEmail,
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, "pending");
  });

  it("TC-GUARD-06: Ending the class expires all admitted knocks so they cannot leak into future sessions", async () => {
    // Host admits student
    const knocksRes = await fetch(`${BASE_URL}/rooms/${testRoomCode}/knocks`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    const knocksData = await knocksRes.json();
    const studentKnock = knocksData.knocks.find((k: any) => k.email === studentEmail);
    assert.ok(studentKnock, "Must find pending knock");

    const admitRes = await fetch(`${BASE_URL}/rooms/${testRoomCode}/knock/${studentKnock.id}/respond`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({ action: "admit" }),
    });
    assert.equal(admitRes.status, 200);

    // Host ends class
    const endRes = await fetch(`${BASE_URL}/rooms/${testRoomCode}/end`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    assert.equal(endRes.status, 200);

    // Verify room knocks are cancelled
    const checkKnocks = await query("SELECT status FROM room_knocks WHERE id = $1", [studentKnock.id]);
    assert.equal(checkKnocks.rows[0].status, "cancelled", "Knock must be cancelled upon class end");
  });

  after(async () => {
    // Clean up test data
    try {
      await query("DELETE FROM room_knocks WHERE room_code = $1", [testRoomCode]);
      await query("DELETE FROM room_participants WHERE room_code = $1", [testRoomCode]);
      await query("DELETE FROM rooms WHERE room_code = $1", [testRoomCode]);
      await query("DELETE FROM users WHERE id IN ($1, $2)", [hostId, studentId]);
    } catch {}
  });

  it("TC-GUARD-07: Frontend source verification: LandingView creates rooms inactive, LobbyView enforces guards", async () => {
    const fs = await import("node:fs/promises");
    const landingCode = await fs.readFile("src/components/landing/LandingView.tsx", "utf-8");
    const lobbyCode = await fs.readFile("src/components/lobby/LobbyView.tsx", "utf-8");
    const meetingCode = await fs.readFile("src/components/meet/MeetingRoom.tsx", "utf-8");

    // LandingView must create rooms inactive
    assert.ok(
      landingCode.includes("is_active: false"),
      "LandingView must initialize rooms with is_active: false"
    );

    // LobbyView must guard handleJoinDirect
    assert.ok(
      lobbyCode.includes("!isRoomHost && (!roomRecord || !roomRecord.is_active)"),
      "LobbyView must prevent non-hosts from joining inactive rooms"
    );

    // MeetingRoom must reject CLASS_NOT_STARTED
    assert.ok(
      meetingCode.includes('joinRes.code === "CLASS_NOT_STARTED"'),
      "MeetingRoom must redirect non-hosts if class has not started"
    );
  });
});
