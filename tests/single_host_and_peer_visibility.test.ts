import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { generateToken } from "../server/routes/auth.ts";
import { query } from "../server/db/index.ts";
import { io } from "socket.io-client";

const BASE_URL = "http://localhost:5001/api";

describe("Single-Host Room Ownership & Peer Visibility Suite", () => {
  const hostId = crypto.randomUUID();
  const hostEmail = `host_${Date.now()}@mathsy.in`;
  const hostToken = generateToken({
    id: hostId,
    email: hostEmail,
    role: "tutor",
    name: "Tutor Host",
  });

  const attendeeId = crypto.randomUUID();
  const attendeeEmail = `attendee_${Date.now()}@mathsy.in`;
  const attendeeToken = generateToken({
    id: attendeeId,
    email: attendeeEmail,
    role: "tutor", // User profile is tutor, but joining someone else's class!
    name: "Attendee Tutor",
  });

  const studentId = crypto.randomUUID();
  const studentEmail = `student_${Date.now()}@mathsy.in`;
  const studentToken = generateToken({
    id: studentId,
    email: studentEmail,
    role: "student",
    name: "Regular Student",
  });

  const roomCode = `test-sh-${Math.random().toString(36).substring(2, 7)}`;

  before(async () => {
    // Upsert test users into users table
    await query(
      `INSERT INTO users (id, email, full_name, role, auth_provider)
       VALUES 
         ($1, $2, 'Tutor Host', 'tutor', 'google'),
         ($3, $4, 'Attendee Tutor', 'tutor', 'google'),
         ($5, $6, 'Regular Student', 'student', 'google')
       ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role;`,
      [hostId, hostEmail, attendeeId, attendeeEmail, studentId, studentEmail]
    );

    // Host schedules the class
    await query(
      `INSERT INTO class_schedules (room_code, title, tutor_id, scheduled_at, duration_minutes, status)
       VALUES ($1, 'Single Host Test Class', $2, NOW(), 60, 'scheduled');`,
      [roomCode, hostId]
    );
  });

  after(async () => {
    await query("DELETE FROM room_participants WHERE room_code = $1", [roomCode]);
    await query("DELETE FROM room_knocks WHERE room_code = $1", [roomCode]);
    await query("DELETE FROM live_classes WHERE room_code = $1", [roomCode]);
    await query("DELETE FROM class_schedules WHERE room_code = $1", [roomCode]);
    await query("DELETE FROM users WHERE id IN ($1, $2, $3)", [hostId, attendeeId, studentId]);
  });

  it("SH-01: GET /api/rooms/:roomCode/role identifies ONLY the scheduler as room owner", async () => {
    // 1. Host checks role
    const hostRoleRes = await fetch(`${BASE_URL}/rooms/${roomCode}/role`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    assert.equal(hostRoleRes.status, 200);
    const hostRoleData = await hostRoleRes.json();
    assert.equal(hostRoleData.isOwner, true, "Host user who scheduled the meet must be identified as isOwner=true");
    assert.equal(String(hostRoleData.tutorId), hostId);

    // 2. Attendee with tutor profile checks role
    const attendeeRoleRes = await fetch(`${BASE_URL}/rooms/${roomCode}/role`, {
      headers: { Authorization: `Bearer ${attendeeToken}` },
    });
    assert.equal(attendeeRoleRes.status, 200);
    const attendeeRoleData = await attendeeRoleRes.json();
    assert.equal(attendeeRoleData.isOwner, false, "Attendee with global tutor role MUST NOT be room owner (isOwner=false)");

    // 3. Student checks role
    const studentRoleRes = await fetch(`${BASE_URL}/rooms/${roomCode}/role`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert.equal(studentRoleRes.status, 200);
    const studentRoleData = await studentRoleRes.json();
    assert.equal(studentRoleData.isOwner, false, "Student attendee is not owner");
  });

  it("SH-02: Non-host tutor cannot launch or hijack the scheduled room", async () => {
    const hijackRes = await fetch(`${BASE_URL}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${attendeeToken}`,
      },
      body: JSON.stringify({
        room_code: roomCode,
        title: "Hijacked Class",
      }),
    });
    assert.equal(hijackRes.status, 403, "Non-scheduler tutor must be blocked with 403 from hijacking room");
  });

  it("SH-03: Room host launches meeting and becomes isHost=true", async () => {
    const launchRes = await fetch(`${BASE_URL}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({
        room_code: roomCode,
        title: "Single Host Test Class",
        is_active: true,
      }),
    });
    assert.equal(launchRes.status, 200);
    const launchData = await launchRes.json();
    assert.equal(launchData.room.room_code, roomCode);
    assert.equal(launchData.room.is_active, true);

    const joinHostRes = await fetch(`${BASE_URL}/rooms/${roomCode}/participants`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({
        display_name: "Tutor Host",
        role: "tutor",
      }),
    });
    assert.equal(joinHostRes.status, 200);
    const joinHostData = await joinHostRes.json();
    assert.equal(joinHostData.isHost, true, "Host user must have isHost=true");
    assert.equal(joinHostData.participant.role, "tutor");
  });

  it("SH-04: Attendee tutor joining is strictly assigned role='student' and isHost=false", async () => {
    // First, attendee knocks to request admission
    const knockRes = await fetch(`${BASE_URL}/rooms/${roomCode}/knock`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${attendeeToken}`,
      },
      body: JSON.stringify({
        display_name: "Attendee Tutor",
        email: attendeeEmail,
        role: "student",
      }),
    });
    assert.equal(knockRes.status, 200);
    const knockData = await knockRes.json();
    const knockId = knockData.knock.id;

    // Host admits attendee
    const admitRes = await fetch(`${BASE_URL}/rooms/${roomCode}/knock/${knockId}/respond`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({ action: "admit" }),
    });
    assert.equal(admitRes.status, 200);
    const admitData = await admitRes.json();
    assert.equal(admitData.knock.status, "admitted");

    // Attendee joins: even if client attempts to pass role='tutor', server enforces single-host invariant!
    const joinAttendeeRes = await fetch(`${BASE_URL}/rooms/${roomCode}/participants`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${attendeeToken}`,
      },
      body: JSON.stringify({
        display_name: "Attendee Tutor",
        role: "tutor", // client attempt
      }),
    });
    assert.equal(joinAttendeeRes.status, 200);
    const joinAttendeeData = await joinAttendeeRes.json();
    assert.equal(joinAttendeeData.isHost, false, "Attendee tutor must be isHost=false");
    assert.equal(joinAttendeeData.participant.role, "student", "Attendee role must strictly be 'student'");
  });

  it("SH-05: Real Mediasoup SFU connection allows mutual peer visibility between host and admitted attendee", async () => {
    // Verify that two clients can connect to Mediasoup SFU without non-ES256 token rejection
    const sfuRoom = `sfu-${roomCode}`;
    const sfuHost = io("https://152-67-5-129.sslip.io", {
      query: { classId: sfuRoom, name: "Host Mathsy", role: "tutor", peerIdentity: "sfu-host-1" },
      transports: ["websocket"],
      reconnection: false,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        sfuHost.disconnect();
        reject(new Error("Host Mediasoup SFU connection timed out"));
      }, 7000);

      sfuHost.on("roomJoined", (hostData: any) => {
        assert.ok(hostData.routerRtpCapabilities, "Host must receive routerRtpCapabilities");

        // Now connect admitted attendee
        const sfuAttendee = io("https://152-67-5-129.sslip.io", {
          query: { classId: sfuRoom, name: "Aditya Chavhan", role: "student", peerIdentity: "sfu-student-2" },
          transports: ["websocket"],
          reconnection: false,
        });

        sfuAttendee.on("roomJoined", (attData: any) => {
          assert.ok(attData.peers.some((p: any) => p.name === "Host Mathsy"), "Attendee must see Host Mathsy in roomJoined peers");
        });

        sfuHost.on("peerJoined", (peer: any) => {
          assert.equal(peer.name, "Aditya Chavhan", "Host must receive peerJoined event for Aditya Chavhan");
          clearTimeout(timeout);
          sfuHost.disconnect();
          sfuAttendee.disconnect();
          resolve();
        });

        sfuAttendee.on("connect_error", (e) => {
          clearTimeout(timeout);
          sfuHost.disconnect();
          sfuAttendee.disconnect();
          reject(e);
        });
      });

      sfuHost.on("connect_error", (e) => {
        clearTimeout(timeout);
        sfuHost.disconnect();
        reject(e);
      });
    });
  });
});
