import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { generateToken } from "../server/routes/auth";
import { query } from "../server/db";

const BASE_URL = "http://localhost:5001/api";

describe("Google Meet Host Admission & Knocking Test Suite", () => {
  const hostId = crypto.randomUUID();
  const hostEmail = `host_${Date.now()}@example.com`;
  const hostToken = generateToken({
    id: hostId,
    email: hostEmail,
    role: "tutor",
    name: "Dr. Host Tutor",
  });

  const studentId = crypto.randomUUID();
  const studentEmail = `student_${Date.now()}@example.com`;
  const studentToken = generateToken({
    id: studentId,
    email: studentEmail,
    role: "student",
    name: "Alex Student",
  });

  const student2Id = crypto.randomUUID();
  const student2Email = `student2_${Date.now()}@example.com`;
  const student2Token = generateToken({
    id: student2Id,
    email: student2Email,
    role: "student",
    name: "Bella Student",
  });

  const testRoomCode = `adm-${Math.random().toString(36).substring(2, 8)}`;

  before(async () => {
    // Seed host tutor into users table
    await query(
      `INSERT INTO users (id, email, full_name, role, auth_provider, onboarding_completed)
       VALUES ($1, $2, 'Dr. Host Tutor', 'tutor', 'google', true)
       ON CONFLICT (id) DO NOTHING;`,
      [hostId, hostEmail]
    );

    // Seed student into users table
    await query(
      `INSERT INTO users (id, email, full_name, role, auth_provider, onboarding_completed)
       VALUES ($1, $2, 'Alex Student', 'student', 'google', true)
       ON CONFLICT (id) DO NOTHING;`,
      [studentId, studentEmail]
    );

    // Seed student2 into users table
    await query(
      `INSERT INTO users (id, email, full_name, role, auth_provider, onboarding_completed)
       VALUES ($1, $2, 'Bella Student', 'student', 'google', true)
       ON CONFLICT (id) DO NOTHING;`,
      [student2Id, student2Email]
    );

    // Create the test room as host
    const createRes = await fetch(`${BASE_URL}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({
        room_code: testRoomCode,
        title: "Host Admission Test Room",
      }),
    });
    assert.equal(createRes.status, 200, "Host should successfully create meeting");
  });

  after(async () => {
    // Cleanup room knocks and room
    await query("DELETE FROM room_knocks WHERE room_code = $1", [testRoomCode]);
    await query("DELETE FROM room_participants WHERE room_code = $1", [testRoomCode]);
    await query("DELETE FROM live_classes WHERE room_code = $1", [testRoomCode]);
    await query("DELETE FROM users WHERE id IN ($1, $2, $3)", [hostId, studentId, student2Id]);
    setTimeout(() => process.exit(0), 100);
  });

  it("TC-KNOCK-01: Room host bypasses admission and can join directly", async () => {
    const res = await fetch(`${BASE_URL}/rooms/${testRoomCode}/participants`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({ camera_allowed: true }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.isHost, true);
    assert.equal(data.participant.role, "tutor");
  });

  it("TC-KNOCK-02: Non-host joining without prior admission is blocked with 403 ADMISSION_REQUIRED", async () => {
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
    assert.equal(data.code, "ADMISSION_REQUIRED");
  });

  let knockId: string;

  it("TC-KNOCK-03: Non-host asks to join (knocks), creating a pending knock record", async () => {
    const res = await fetch(`${BASE_URL}/rooms/${testRoomCode}/knock`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        display_name: "Alex Student",
        email: studentEmail,
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, "pending");
    assert.ok(data.knock.id);
    knockId = data.knock.id;
  });

  it("TC-KNOCK-04: Submitting repeat knock while pending returns existing knock idempotently", async () => {
    const res = await fetch(`${BASE_URL}/rooms/${testRoomCode}/knock`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({}),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, "pending");
    assert.equal(data.knock.id, knockId);
  });

  it("TC-KNOCK-05: Non-host blocked with 403 from listing room knocks", async () => {
    const res = await fetch(`${BASE_URL}/rooms/${testRoomCode}/knocks`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert.equal(res.status, 403);
  });

  it("TC-KNOCK-06: Room Host can list pending knocks in waiting room", async () => {
    const res = await fetch(`${BASE_URL}/rooms/${testRoomCode}/knocks`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.knocks));
    assert.ok(data.knocks.some((k: any) => k.id === knockId));
  });

  it("TC-KNOCK-07: Waiting participant can poll their knock status", async () => {
    const res = await fetch(`${BASE_URL}/rooms/${testRoomCode}/knock/${knockId}`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, "pending");
  });

  it("TC-KNOCK-08: Host admits student -> status becomes 'admitted'", async () => {
    const res = await fetch(`${BASE_URL}/rooms/${testRoomCode}/knock/${knockId}/respond`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({ action: "admit" }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, "admitted");
  });

  it("TC-KNOCK-09: Admitted student can now successfully join the room with 200 OK", async () => {
    const res = await fetch(`${BASE_URL}/rooms/${testRoomCode}/participants`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({ camera_allowed: false }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.isHost, false);
    assert.equal(data.participant.display_name, "Alex Student");
  });

  it("TC-KNOCK-10: Host denies second student -> anti-spam cooldown triggers on retry", async () => {
    // 1. Student 2 knocks
    const knockRes = await fetch(`${BASE_URL}/rooms/${testRoomCode}/knock`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${student2Token}`,
      },
      body: JSON.stringify({
        display_name: "Bella Student",
        email: student2Email,
      }),
    });
    assert.equal(knockRes.status, 200);
    const knockData = await knockRes.json();
    const student2KnockId = knockData.knock.id;

    // 2. Host denies
    const denyRes = await fetch(`${BASE_URL}/rooms/${testRoomCode}/knock/${student2KnockId}/respond`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({ action: "deny" }),
    });
    assert.equal(denyRes.status, 200);

    // 3. Student 2 tries knocking again immediately -> should be blocked by 60s cooldown
    const retryRes = await fetch(`${BASE_URL}/rooms/${testRoomCode}/knock`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${student2Token}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(retryRes.status, 429, "Immediate knock retry after denial must return 429 Too Many Requests");
    const retryData = await retryRes.json();
    assert.equal(retryData.code, "KNOCK_COOLDOWN");
    assert.ok(retryData.cooldownRemaining > 0);
  });

  it("TC-KNOCK-11: Participant can cancel their pending knock request", async () => {
    const dummyId = crypto.randomUUID();
    const dummyEmail = `dummy_${Date.now()}@example.com`;
    const dummyToken = generateToken({
      id: dummyId,
      email: dummyEmail,
      role: "student",
      name: "Cancel Test User",
    });

    const kRes = await fetch(`${BASE_URL}/rooms/${testRoomCode}/knock`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${dummyToken}`,
      },
      body: JSON.stringify({ display_name: "Cancel Test User", email: dummyEmail }),
    });
    const kData = await kRes.json();
    const kId = kData.knock.id;

    const cancelRes = await fetch(`${BASE_URL}/rooms/${testRoomCode}/knock/${kId}/cancel`, {
      method: "POST",
    });
    assert.equal(cancelRes.status, 200);

    const checkRes = await fetch(`${BASE_URL}/rooms/${testRoomCode}/knock/${kId}`);
    const checkData = await checkRes.json();
    assert.equal(checkData.status, "cancelled");

    await query("DELETE FROM room_knocks WHERE id = $1", [kId]);
  });

  it("TC-KNOCK-12: Host can batch admit all pending knocks via respond-all", async () => {
    const batchUserId = crypto.randomUUID();
    const batchEmail = `batch_${Date.now()}@example.com`;
    const batchToken = generateToken({
      id: batchUserId,
      email: batchEmail,
      role: "student",
      name: "Batch User",
    });

    const kRes = await fetch(`${BASE_URL}/rooms/${testRoomCode}/knock`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${batchToken}`,
      },
      body: JSON.stringify({ display_name: "Batch User", email: batchEmail }),
    });
    assert.equal(kRes.status, 200);

    const respondAllRes = await fetch(`${BASE_URL}/rooms/${testRoomCode}/knocks/respond-all`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({ action: "admit" }),
    });
    assert.equal(respondAllRes.status, 200);
    const data = await respondAllRes.json();
    assert.equal(data.success, true);
    assert.equal(data.action, "admitted");
    assert.ok(data.updatedCount >= 1);
  });

  it("TC-KNOCK-13: Student knocking on scheduled/unstarted class receives waiting_for_host (not 404 rejection)", async () => {
    const unstartedRoomCode = `sched-${Math.random().toString(36).substring(2, 8)}`;

    // Create an unstarted scheduled class using established host
    await query(
      `INSERT INTO live_classes (room_code, title, tutor_id, tutor_name, is_active, metadata)
       VALUES ($1, 'Scheduled Math Class', $2, 'Dr. Host Tutor', FALSE, '{"isScheduled": true}')`,
      [unstartedRoomCode, hostId]
    );

    const studentUserId = crypto.randomUUID();
    const studentToken = generateToken({
      id: studentUserId,
      email: `wait_${Date.now()}@example.com`,
      role: "student",
      name: "Waiting Student",
    });

    // Knocking on unstarted class must return waiting_for_host with status 200, NOT 404 rejection!
    const knockRes = await fetch(`${BASE_URL}/rooms/${unstartedRoomCode}/knock`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({ display_name: "Waiting Student" }),
    });

    assert.equal(knockRes.status, 200);
    const knockData = await knockRes.json();
    assert.equal(knockData.status, "waiting_for_host");
    assert.equal(knockData.isWaitingForHost, true);

    // Clean up
    await query("DELETE FROM live_classes WHERE room_code = $1", [unstartedRoomCode]);
  });

  it("TC-KNOCK-14: Tutor host starting class auto-activates room and allows waiting student to knock and be admitted", async () => {
    const startRoomCode = `start-${Math.random().toString(36).substring(2, 8)}`;

    // Create unstarted room using established host
    await query(
      `INSERT INTO live_classes (room_code, title, tutor_id, tutor_name, is_active, metadata)
       VALUES ($1, 'Live Algebra', $2, 'Dr. Host Tutor', FALSE, '{"isScheduled": true}')`,
      [startRoomCode, hostId]
    );

    // Tutor joins -> activates room
    const tutorJoinRes = await fetch(`${BASE_URL}/rooms/${startRoomCode}/participants`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({ camera_allowed: true }),
    });
    assert.equal(tutorJoinRes.status, 200);

    // Verify room is now active
    const roomCheck = await query("SELECT is_active FROM live_classes WHERE room_code = $1", [startRoomCode]);
    assert.equal(roomCheck.rows[0].is_active, true);

    // Student now knocks on the active room
    const studentUserId = crypto.randomUUID();
    const studentToken = generateToken({
      id: studentUserId,
      email: `student_knock_${Date.now()}@example.com`,
      role: "student",
      name: "Knocking Student",
    });

    const knockRes = await fetch(`${BASE_URL}/rooms/${startRoomCode}/knock`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({ display_name: "Knocking Student" }),
    });
    assert.equal(knockRes.status, 200);
    const knockData = await knockRes.json();
    assert.equal(knockData.status, "pending");
    const knockId = knockData.knock.id;

    // Student polls knock status -> must stay pending while host hasn't responded
    const pollRes = await fetch(`${BASE_URL}/rooms/${startRoomCode}/knock/${knockId}`);
    assert.equal(pollRes.status, 200);
    const pollData = await pollRes.json();
    assert.equal(pollData.status, "pending");

    // Host admits student
    const admitRes = await fetch(`${BASE_URL}/rooms/${startRoomCode}/knock/${knockId}/respond`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({ action: "admit" }),
    });
    assert.equal(admitRes.status, 200);

    // Student polls again -> status is admitted
    const finalPoll = await fetch(`${BASE_URL}/rooms/${startRoomCode}/knock/${knockId}`);
    const finalData = await finalPoll.json();
    assert.equal(finalData.status, "admitted");

    // Clean up
    await query("DELETE FROM room_participants WHERE room_code = $1", [startRoomCode]);
    await query("DELETE FROM room_knocks WHERE room_code = $1", [startRoomCode]);
    await query("DELETE FROM live_classes WHERE room_code = $1", [startRoomCode]);
  });
});
