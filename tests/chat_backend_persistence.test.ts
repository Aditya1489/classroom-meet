import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { query, pool } from "../server/db";
import { connectMongo, getChatCollection, getSessionsCollection, closeMongo } from "../server/db/mongo";
import { generateToken } from "../server/routes/auth";

const API_BASE = process.env.API_BASE || "http://localhost:5001/api";

describe("Temporary MongoDB Chat Backend & Security Verification", () => {
  const roomCode = "room-test-" + Math.random().toString(36).substring(2, 7);
  const tutorId = "11111111-1111-4111-8111-111111111111";
  const studentId = "22222222-2222-4222-8222-222222222222";

  let tutorToken: string;
  let studentToken: string;
  let sessionId: string;

  before(async () => {
    // 1. Connect to Mongo
    await connectMongo();

    // 2. Ensure test users exist in PostgreSQL
    await query(
      `INSERT INTO users (id, email, full_name, role)
       VALUES ($1, 'tutor.gauss@mathsy.in', 'Prof. Gauss', 'tutor')
       ON CONFLICT (id) DO NOTHING;`,
      [tutorId]
    );
    await query(
      `INSERT INTO users (id, email, full_name, role)
       VALUES ($1, 'student.ada@mathsy.in', 'Ada Lovelace', 'student')
       ON CONFLICT (id) DO NOTHING;`,
      [studentId]
    );

    // 3. Generate verified tokens
    tutorToken = generateToken({
      id: tutorId,
      email: "tutor.gauss@mathsy.in",
      role: "tutor",
      name: "Prof. Gauss",
    });

    studentToken = generateToken({
      id: studentId,
      email: "student.ada@mathsy.in",
      role: "student",
      name: "Ada Lovelace",
    });

    // 4. Create active classroom session via rooms API
    const createRes = await fetch(`${API_BASE}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tutorToken}`,
      },
      body: JSON.stringify({
        roomCode,
        title: "Calculus & Topology",
      }),
    });

    assert.equal(createRes.status, 200, "POST /api/rooms must create room");
    const createJson = await createRes.json();
    sessionId = createJson.room?.sessionId || createJson.sessionId;
    assert.ok(sessionId, "Room creation must return unique sessionId");
  });



  // ── 1. Authentication Security Gates ──
  it("TC-SEC-01: Rejects unauthenticated GET /:roomCode/chat with 401", async () => {
    const res = await fetch(`${API_BASE}/rooms/${roomCode}/chat`);
    assert.equal(res.status, 401, "Unauthenticated GET must be blocked with 401");
  });

  it("TC-SEC-02: Rejects unauthenticated POST /:roomCode/chat with 401", async () => {
    const res = await fetch(`${API_BASE}/rooms/${roomCode}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "I have no token" }),
    });
    assert.equal(res.status, 401, "Unauthenticated POST must be blocked with 401");
  });

  // ── 2. Temporary Storage & Identity Verification ──
  it("TC-MONGO-01: Persists message into MongoDB chat_messages with server-verified identity", async () => {
    // Student attempts to spoof sender_name and sender_role as 'tutor'
    const res = await fetch(`${API_BASE}/rooms/${roomCode}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        text: "Hello professor!",
        sender_name: "Spoofed Tutor",
        sender_role: "tutor",
        is_host: true,
      }),
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(json.success);
    assert.equal(json.message.text, "Hello professor!");
    // Identity must come from JWT, NOT the client payload!
    assert.equal(json.message.senderId, studentId);
    assert.equal(json.message.senderName, "Ada Lovelace", "Server must enforce authenticated display name");
    assert.equal(json.message.senderRole, "student", "Server must enforce authenticated role");
    assert.equal(json.message.isHost, false, "Student cannot self-grant host badge");

    // Verify record directly in MongoDB collection
    const chatCol = getChatCollection()!;
    const mongoDoc = await chatCol.findOne({ sessionId, text: "Hello professor!" });
    assert.ok(mongoDoc, "Document must exist in MongoDB chat_messages");
    assert.equal(mongoDoc?.sessionId, sessionId);
    assert.equal(mongoDoc?.text, "Hello professor!");
    assert.equal(mongoDoc?.senderRole, "student");
  });

  // ── 3. Chronological Order & History Fetching ──
  it("TC-MONGO-02: GET /:roomCode/chat retrieves complete active class history in chronological order", async () => {
    // Tutor sends a message
    await fetch(`${API_BASE}/rooms/${roomCode}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tutorToken}`,
      },
      body: JSON.stringify({ text: "Welcome students to calculus!" }),
    });

    // Student fetches history (simulating late joiner or page refresh)
    const res = await fetch(`${API_BASE}/rooms/${roomCode}/chat`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(Array.isArray(json.messages));
    assert.ok(json.messages.length >= 2, "Late joiner must see all messages sent since class start");

    // Chronological order verification
    for (let i = 1; i < json.messages.length; i++) {
      const prev = new Date(json.messages[i - 1].createdAt).getTime();
      const curr = new Date(json.messages[i].createdAt).getTime();
      assert.ok(curr >= prev, "Messages must be ordered chronologically ascending");
    }
  });

  // ── 4. Idempotency Key Deduplication ──
  it("TC-DEDUP-01: Retrying the same clientMessageId returns existing message without duplicate insert", async () => {
    const clientMessageId = "client-dedup-" + Date.now();

    const post1 = await fetch(`${API_BASE}/rooms/${roomCode}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        text: "Network retry test",
        clientMessageId,
      }),
    });
    const json1 = await post1.json();

    const post2 = await fetch(`${API_BASE}/rooms/${roomCode}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        text: "Network retry test",
        clientMessageId,
      }),
    });
    const json2 = await post2.json();

    assert.equal(json1.message._id, json2.message._id, "Retried message must return identical canonical ID");

    // Verify MongoDB only stored 1 document for this clientMessageId
    const chatCol = getChatCollection()!;
    const count = await chatCol.countDocuments({ sessionId, clientMessageId });
    assert.equal(count, 1, "MongoDB must contain exactly 1 document for idempotency key");
  });

  // ── 5. Message Content & Validation ──
  it("TC-VAL-01: Rejects empty text and messages exceeding 2000 characters", async () => {
    // Empty
    const resEmpty = await fetch(`${API_BASE}/rooms/${roomCode}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({ text: "   " }),
    });
    assert.equal(resEmpty.status, 400);

    // Exceeding 2000 chars
    const resLong = await fetch(`${API_BASE}/rooms/${roomCode}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({ text: "x".repeat(2001) }),
    });
    assert.equal(resLong.status, 400);
  });

  // ── 6. Chat Lock Synchronization & Server Enforcement ──
  it("TC-LOCK-01: Tutor can lock chat; students receive 423 Locked; student cannot toggle lock", async () => {
    // 1. Student attempts to lock chat -> 403 Forbidden
    const studentLockRes = await fetch(`${API_BASE}/rooms/${roomCode}/chat/lock`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({ locked: true }),
    });
    assert.equal(studentLockRes.status, 403, "Student must NOT be permitted to lock chat");

    // 2. Tutor locks chat -> 200 OK
    const tutorLockRes = await fetch(`${API_BASE}/rooms/${roomCode}/chat/lock`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tutorToken}`,
      },
      body: JSON.stringify({ locked: true }),
    });
    assert.equal(tutorLockRes.status, 200);

    // 3. Student attempts to post message while locked -> 423 Locked
    const studentSendRes = await fetch(`${API_BASE}/rooms/${roomCode}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({ text: "Can I speak?" }),
    });
    assert.equal(studentSendRes.status, 423, "Student message must be rejected with 423 when locked");

    // 4. Tutor CAN still post announcements while locked
    const tutorSendRes = await fetch(`${API_BASE}/rooms/${roomCode}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tutorToken}`,
      },
      body: JSON.stringify({ text: "Eyes on the board everyone." }),
    });
    assert.equal(tutorSendRes.status, 200, "Tutor can post while chat is locked");

    // 5. Tutor unlocks chat
    await fetch(`${API_BASE}/rooms/${roomCode}/chat/lock`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tutorToken}`,
      },
      body: JSON.stringify({ locked: false }),
    });
  });

  // ── 7. Pinned Notices Synchronization ──
  it("TC-PIN-01: Tutor can pin/unpin message; student cannot pin notices", async () => {
    // Student pin attempt -> 403
    const studentPinRes = await fetch(`${API_BASE}/rooms/${roomCode}/chat/pin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({ text: "Hacked pin" }),
    });
    assert.equal(studentPinRes.status, 403, "Student cannot pin message");

    // Tutor pins message -> 200
    const tutorPinRes = await fetch(`${API_BASE}/rooms/${roomCode}/chat/pin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tutorToken}`,
      },
      body: JSON.stringify({ text: "Quiz on Tuesday at 9 AM" }),
    });
    assert.equal(tutorPinRes.status, 200);

    // Verify GET history returns pinned message
    const historyRes = await fetch(`${API_BASE}/rooms/${roomCode}/chat`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    const historyJson = await historyRes.json();
    assert.equal(historyJson.pinnedMessage?.text, "Quiz on Tuesday at 9 AM");
  });

  // ── 8. Immediate Deletion on Class End ──
  it("TC-END-01: Ending class immediately purges ALL MongoDB messages for the session", async () => {
    const chatCol = getChatCollection()!;

    // Verify messages exist right now
    const beforeCount = await chatCol.countDocuments({ sessionId });
    assert.ok(beforeCount > 0, "Messages must exist before ending class");

    // Tutor ends the class via POST /api/rooms/:roomCode/end
    const endRes = await fetch(`${API_BASE}/rooms/${roomCode}/end`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tutorToken}`,
      },
    });
    assert.equal(endRes.status, 200, "POST /api/rooms/:roomCode/end must succeed");

    // Immediate MongoDB verification: ALL messages for sessionId must be DELETED!
    const afterCount = await chatCol.countDocuments({ sessionId });
    assert.equal(afterCount, 0, "All MongoDB chat messages for ended session must be IMMEDIATELY deleted");

    // Session status in class_sessions must be 'ended'
    const sessCol = getSessionsCollection()!;
    const sessionDoc = await sessCol.findOne({ sessionId });
    assert.equal(sessionDoc?.status, "ended");

    // GET chat history after end must return 404 / 410 or empty
    const getEnded = await fetch(`${API_BASE}/rooms/${roomCode}/chat`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert.equal(getEnded.status, 404, "GET chat on ended room must be rejected with 404");

    // POST to ended room must be rejected with 404
    const postEnded = await fetch(`${API_BASE}/rooms/${roomCode}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({ text: "Can I still talk?" }),
    });
    assert.equal(postEnded.status, 404, "POST chat to ended room must be rejected with 404");
  });

  // ── 9. Room Code Reuse Isolation ──
  it("TC-REUSE-01: Reusing roomCode for a new class generates new sessionId and starts with 0 messages", async () => {
    // Tutor starts a brand new class using the SAME roomCode
    const newClassRes = await fetch(`${API_BASE}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tutorToken}`,
      },
      body: JSON.stringify({
        roomCode,
        title: "Next Semester Topology",
      }),
    });
    assert.equal(newClassRes.status, 200);
    const newClassJson = await newClassRes.json();
    const newSessionId = newClassJson.room?.sessionId || newClassJson.sessionId;
    assert.ok(newSessionId, "New class must have a sessionId");
    assert.notEqual(newSessionId, sessionId, "New class must have a DIFFERENT sessionId than the ended class");

    // Fetch chat history for the newly created class
    const newHistoryRes = await fetch(`${API_BASE}/rooms/${roomCode}/chat`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert.equal(newHistoryRes.status, 200);
    const newHistoryJson = await newHistoryRes.json();
    assert.equal(newHistoryJson.messages.length, 0, "Reused roomCode must start with zero chat messages");
  });

  after(async () => {
    // Cleanup MongoDB
    try {
      const chatCol = getChatCollection()!;
      const sessCol = getSessionsCollection()!;
      await chatCol.deleteMany({ roomCode });
      await sessCol.deleteMany({ roomCode });
    } catch (e) {}

    // Cleanup PostgreSQL
    await query("DELETE FROM live_classes WHERE room_code = $1", [roomCode]);
    await query("DELETE FROM users WHERE id IN ($1, $2)", [tutorId, studentId]);
    await closeMongo();
    await pool.end();
    setTimeout(() => process.exit(0), 500);
  });
});
