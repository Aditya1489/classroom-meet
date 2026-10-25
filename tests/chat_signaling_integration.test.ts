import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { io, Socket } from "socket.io-client";

function b64Url(obj: any) {
  return Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function makeToken(id: string, role: string, name: string) {
  const h = b64Url({ alg: "HS256", typ: "JWT" });
  const p = b64Url({ sub: id, id, role, name, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.sig`;
}

function waitForMessage(socket: Socket, filter: (msg: any) => boolean, timeoutMs = 4000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("chatMessage", listener);
      reject(new Error(`Timeout (${timeoutMs}ms) waiting for message matching filter`));
    }, timeoutMs);

    const listener = (data: any) => {
      if (filter(data)) {
        clearTimeout(timer);
        socket.off("chatMessage", listener);
        resolve(data);
      }
    };
    socket.on("chatMessage", listener);
  });
}

describe("Signaling Server Real-Time Chat Integration (https://rtc.mathsy.in)", () => {
  const serverUrl = "https://rtc.mathsy.in";
  const roomA = "test-chat-roomA-" + Math.random().toString(36).substring(2, 7);
  const roomB = "test-chat-roomB-" + Math.random().toString(36).substring(2, 7);

  let tutorA: Socket;
  let studentA1: Socket;
  let studentA2: Socket;
  let studentB: Socket;

  const tutorAId = "tutor-a-" + Math.random().toString(36).substring(2, 6);
  const studentA1Id = "student-a1-" + Math.random().toString(36).substring(2, 6);
  const studentA2Id = "student-a2-" + Math.random().toString(36).substring(2, 6);
  const studentBId = "student-b-" + Math.random().toString(36).substring(2, 6);

  before(async () => {
    const tTokenA = makeToken(tutorAId, "tutor", "Prof. Euler");
    tutorA = io(serverUrl, {
      auth: { token: tTokenA },
      query: { token: tTokenA, classId: roomA, name: "Prof. Euler", role: "tutor", peerIdentity: tutorAId },
      transports: ["websocket"],
    });

    const s1TokenA = makeToken(studentA1Id, "student", "Student Bob");
    studentA1 = io(serverUrl, {
      auth: { token: s1TokenA },
      query: { token: s1TokenA, classId: roomA, name: "Student Bob", role: "student", peerIdentity: studentA1Id },
      transports: ["websocket"],
    });

    const s2TokenA = makeToken(studentA2Id, "student", "Student Charlie");
    studentA2 = io(serverUrl, {
      auth: { token: s2TokenA },
      query: { token: s2TokenA, classId: roomA, name: "Student Charlie", role: "student", peerIdentity: studentA2Id },
      transports: ["websocket"],
    });

    const sTokenB = makeToken(studentBId, "student", "Student Dave (Room B)");
    studentB = io(serverUrl, {
      auth: { token: sTokenB },
      query: { token: sTokenB, classId: roomB, name: "Student Dave", role: "student", peerIdentity: studentBId },
      transports: ["websocket"],
    });

    await Promise.all([
      new Promise<void>((r) => tutorA.on("connect", r)),
      new Promise<void>((r) => studentA1.on("connect", r)),
      new Promise<void>((r) => studentA2.on("connect", r)),
      new Promise<void>((r) => studentB.on("connect", r)),
    ]);

    // Give SFU time to initialize room states
    await new Promise((r) => setTimeout(r, 1000));
  });

  after(() => {
    tutorA?.disconnect();
    studentA1?.disconnect();
    studentA2?.disconnect();
    studentB?.disconnect();
  });

  // ── CHAT-001: Single message delivery (Tutor -> Student) ──
  it("CHAT-001: Tutor-to-student message is delivered via chatMessage event", async () => {
    const msgPromise = waitForMessage(studentA1, (d) => d.id === "msg-c001");

    tutorA.emit("chatMessage", {
      id: "msg-c001",
      senderId: tutorAId,
      senderName: "Prof. Euler",
      text: "Welcome to class everyone!",
      isHost: true,
    });

    const receivedPayload = await msgPromise;

    assert.ok(receivedPayload, "Student must receive chatMessage event");
    assert.equal(receivedPayload.text, "Welcome to class everyone!");
    assert.equal(receivedPayload.senderName, "Prof. Euler");
    assert.equal(receivedPayload.isHost, true);
  });

  // ── CHAT-002: Student-to-tutor delivery ──
  it("CHAT-002: Student-to-tutor message is delivered via chatMessage event", async () => {
    const msgPromise = waitForMessage(tutorA, (d) => d.id === "msg-c002");

    studentA1.emit("chatMessage", {
      id: "msg-c002",
      senderId: studentA1Id,
      senderName: "Student Bob",
      text: "Sir, I have a doubt on step 3",
      isHost: false,
    });

    const tutorReceived = await msgPromise;

    assert.ok(tutorReceived, "Tutor must receive student's message");
    assert.equal(tutorReceived.text, "Sir, I have a doubt on step 3");
    assert.equal(tutorReceived.senderName, "Student Bob");
    assert.equal(tutorReceived.isHost, false);
  });

  // ── CHAT-003: Multiple recipients in room receive message ──
  it("CHAT-003: All other participants in the same room receive the message", async () => {
    const s1Promise = waitForMessage(studentA1, (d) => d.id === "msg-c003");
    const s2Promise = waitForMessage(studentA2, (d) => d.id === "msg-c003");

    tutorA.emit("chatMessage", {
      id: "msg-c003",
      senderId: tutorAId,
      senderName: "Prof. Euler",
      text: "Broadcast announcement",
      isHost: true,
    });

    const [s1Msg, s2Msg] = await Promise.all([s1Promise, s2Promise]);

    assert.ok(s1Msg, "Student 1 in room A must receive broadcast");
    assert.ok(s2Msg, "Student 2 in room A must receive broadcast");
    assert.equal(s1Msg.text, "Broadcast announcement");
    assert.equal(s2Msg.text, "Broadcast announcement");
  });

  // ── CHAT-004: Room Isolation ──
  it("CHAT-004: Messages in Room A are never leaked to participants in Room B", async () => {
    let bReceived = false;

    const bListener = (data: any) => {
      if (data.text === "Secret message for Room A only") {
        bReceived = true;
      }
    };
    studentB.on("chatMessage", bListener);

    tutorA.emit("chatMessage", {
      id: "msg-c004",
      senderId: tutorAId,
      senderName: "Prof. Euler",
      text: "Secret message for Room A only",
      isHost: true,
    });

    // Wait to ensure no delayed delivery arrives in Room B
    await new Promise((r) => setTimeout(r, 1000));
    studentB.off("chatMessage", bListener);

    assert.equal(bReceived, false, "Room isolation failed! Room B received Room A message");
  });

  // ── CHAT-005: Message ordering ──
  it("CHAT-005: Rapid sequence of messages arrives in FIFO order", async () => {
    const receivedOrder: number[] = [];

    const listener = (data: any) => {
      if (data.seq !== undefined) {
        receivedOrder.push(data.seq);
      }
    };
    studentA1.on("chatMessage", listener);

    for (let i = 1; i <= 5; i++) {
      tutorA.emit("chatMessage", {
        id: `msg-seq-${i}`,
        senderId: tutorAId,
        seq: i,
        text: `Sequence message #${i}`,
      });
    }

    await new Promise((r) => setTimeout(r, 1200));
    studentA1.off("chatMessage", listener);

    assert.deepEqual(receivedOrder, [1, 2, 3, 4, 5], "Messages must arrive in exact emitted sequence");
  });

  // ── CHAT-009: Special Characters, Emojis, Multiline ──
  it("CHAT-009: Special characters, emoji, and non-ASCII text are transmitted cleanly", async () => {
    const specialText = "Math formulas: ∫₀^∞ e^(-x²) dx = √π/2 🎉 🚀 \n Line 2 \t Tabbed & <script>alert(1)</script>";

    const msgPromise = waitForMessage(studentA1, (d) => d.id === "msg-c009");

    tutorA.emit("chatMessage", {
      id: "msg-c009",
      senderId: tutorAId,
      senderName: "Prof. Euler",
      text: specialText,
      isHost: true,
    });

    const receivedPayload = await msgPromise;

    assert.equal(receivedPayload.text, specialText, "Special characters, emojis, and symbols must not be corrupted");
  });

  // ── CHAT-012 & CHAT-014: Security / Spoofing over Socket ──
  it("CHAT-012 & CHAT-014: [VULNERABILITY CONFIRMED] Signaling server blindly trusts client payload senderName and isHost flag", async () => {
    const promise = waitForMessage(studentA2, (d) => d.id === "spoof-msg-1");

    // Student A1 sends a spoofed message claiming to be 'System Admin' with isHost: true
    studentA1.emit("chatMessage", {
      id: "spoof-msg-1",
      senderId: "fake-admin-uuid",
      senderName: "Mathsy Meeting Administrator",
      text: "URGENT: All students must submit exam immediately",
      isHost: true, // Student elevates itself to Host!
    });

    const receivedData = await promise;

    // The signaling server does NOT sanitize or overwrite senderName or isHost from socket auth session!
    console.log("    Observed receivedData for spoofed student payload:", receivedData);
    assert.equal(
      receivedData.senderName,
      "Mathsy Meeting Administrator",
      "Vulnerability: Signaling server accepts arbitrary spoofed senderName from client"
    );
    assert.equal(
      receivedData.isHost,
      true,
      "Vulnerability: Signaling server broadcasts spoofed isHost: true from regular student socket"
    );
  });

  // ── CHAT-063: Control Message Spoofing ──
  it("CHAT-063: [SECURITY FLAW] Student socket can broadcast FORCE_MUTE control message to entire room", async () => {
    const s2Promise = waitForMessage(studentA2, (d) => d.isControl && d.controlAction === "FORCE_MUTE");

    // Student A1 emits FORCE_MUTE
    studentA1.emit("chatMessage", {
      isControl: true,
      controlAction: "FORCE_MUTE",
      all: true,
      targetUserId: tutorAId,
    });

    const student2ReceivedControl = await s2Promise;

    assert.ok(student2ReceivedControl, "Student 2 received student-forged FORCE_MUTE signal");
    assert.equal(student2ReceivedControl.controlAction, "FORCE_MUTE");
    assert.equal(student2ReceivedControl.all, true);
  });

  // ── CHAT-047: Dual outgoing event names analysis ──
  it("CHAT-047: Signaling server listens to chatMessage, but completely ignores chat:send", async () => {
    let chatSendReceived = false;

    const listener = (data: any) => {
      if (data.id === "msg-chatsend-only") {
        chatSendReceived = true;
      }
    };
    studentA1.on("chatMessage", listener);
    studentA1.on("chat:message", listener);

    tutorA.emit("chat:send", {
      id: "msg-chatsend-only",
      senderId: tutorAId,
      senderName: "Prof. Euler",
      text: "Testing chat:send event emission",
    });

    await new Promise((r) => setTimeout(r, 1200));
    studentA1.off("chatMessage", listener);
    studentA1.off("chat:message", listener);

    assert.equal(
      chatSendReceived,
      false,
      "Confirmed: Signaling server does NOT handle chat:send. Emitting chat:send in mediasoupClient is dead/redundant code."
    );
  });

  // ── CHAT-025 & CHAT-027: Pinned notices over socket ──
  it("CHAT-025 & CHAT-027: [MISSING FEATURE] Signaling server has no handler for pinMessage or unpinMessage", async () => {
    let pinReceived = false;

    studentA1.on("pinMessage", () => { pinReceived = true; });
    studentA1.on("chat:pin", () => { pinReceived = true; });

    tutorA.emit("pinMessage", { room: roomA, text: "Pinned Link: https://mathsy.in" });
    tutorA.emit("chat:pin", { room: roomA, text: "Pinned Link: https://mathsy.in" });

    await new Promise((r) => setTimeout(r, 1000));

    assert.equal(
      pinReceived,
      false,
      "Confirmed: Signaling server has no pin event handling; pinned notices in frontend are purely local state."
    );
  });

  // ── CHAT-055: Reconnecting participant receives no server-side buffered chat messages ──
  it("CHAT-055: Disconnected peer misses messages sent during outage (no SFU chat buffering)", async () => {
    // Disconnect student A2
    studentA2.disconnect();
    await new Promise((r) => setTimeout(r, 500));

    // Tutor sends message while student A2 is offline
    tutorA.emit("chatMessage", {
      id: "msg-offline-1",
      senderId: tutorAId,
      senderName: "Prof. Euler",
      text: "Message sent while Charlie is disconnected",
    });

    await new Promise((r) => setTimeout(r, 500));

    // Reconnect student A2
    const s2TokenA = makeToken(studentA2Id, "student", "Student Charlie");
    const reconnectedS2 = io(serverUrl, {
      auth: { token: s2TokenA },
      query: { token: s2TokenA, classId: roomA, name: "Student Charlie", role: "student", peerIdentity: studentA2Id },
      transports: ["websocket"],
    });

    const receivedAfterReconnect: any[] = [];
    reconnectedS2.on("chatMessage", (data) => receivedAfterReconnect.push(data));

    await new Promise<void>((r) => reconnectedS2.on("connect", r));
    await new Promise((r) => setTimeout(r, 1500));

    reconnectedS2.disconnect();

    const found = receivedAfterReconnect.find((m) => m.id === "msg-offline-1");
    assert.equal(
      found,
      undefined,
      "Confirmed: SFU does not buffer or replay chat messages sent during disconnect. Offline messages are lost unless fetched from DB."
    );
  });
});
