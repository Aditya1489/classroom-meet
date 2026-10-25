import { describe, it } from "node:test";
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

describe("Mathsy Meet — Real Multi-Peer Microphone Flow Integration Tests", () => {
  const signalingUrl = "https://rtc.mathsy.in";
  const testRoomCode = "int-test-" + Math.random().toString(36).substring(2, 8);
  const otherRoomCode = "int-other-" + Math.random().toString(36).substring(2, 8);

  const tutorId = "tutor-" + Math.random().toString(36).substring(2, 8);
  const student1Id = "student1-" + Math.random().toString(36).substring(2, 8);
  const student2Id = "student2-" + Math.random().toString(36).substring(2, 8);

  let tutorSocket: Socket;
  let student1Socket: Socket;
  let student2Socket: Socket;

  // Simulated Tutor Component State Machine (reflecting MeetingRoom.tsx fix)
  let tutorIsHostState = false; // Initially false due to async profile loading!
  const tutorIsHostRef = { current: false };
  let tutorUnmuteRequests: Array<{ userId: string; name: string; correlationId?: string }> = [];

  function registerTutorListeners(socket: Socket) {
    const recentMicRequests = new Map<string, number>();

    const dispatchMicRequest = (userId: string, name: string, correlationId?: string, roomCode?: string) => {
      const now = Date.now();
      const last = recentMicRequests.get(userId) || 0;
      if (now - last < 2000) return;
      recentMicRequests.set(userId, now);

      // CRITICAL FIX: Tutor reads live isHostRef instead of stale closure
      if (!tutorIsHostRef.current) {
        return; // Rejected if not host
      }

      if (!tutorUnmuteRequests.some((r) => r.userId === userId)) {
        tutorUnmuteRequests.push({ userId, name, correlationId });
      }
    };

    socket.on("unmuteRequest", (req: any) => {
      const reqRoom = (req?.roomCode || "").toLowerCase().trim();
      const curRoom = testRoomCode.toLowerCase().trim();
      if (reqRoom && curRoom && reqRoom !== curRoom) return;

      const userId = req.userId || req.peerId || req.id || req.senderId || "unknown";
      const name = req.name || req.senderName || "Student";
      dispatchMicRequest(userId, name, req.correlationId, reqRoom);
    });

    socket.on("chatMessage", (msg: any) => {
      if (msg?.isControl) {
        const msgRoom = (msg.roomCode || "").toLowerCase().trim();
        const curRoom = testRoomCode.toLowerCase().trim();
        if (msgRoom && curRoom && msgRoom !== curRoom) return;

        if (msg.controlAction === "REQUEST_MIC") {
          dispatchMicRequest(msg.userId || msg.senderId || "unknown", msg.name || "Student", msg.correlationId, msg.roomCode);
        } else if (msg.controlAction === "CANCEL_REQUEST") {
          if (tutorIsHostRef.current) {
            tutorUnmuteRequests = tutorUnmuteRequests.filter(
              (r) => r.userId !== msg.userId && r.userId !== msg.senderId
            );
          }
        }
      }
    });
  }

  // Simulated Student Component State Machine
  const student1State = {
    hasSpeakingPermission: false,
    unmuteRequestStatus: "none" as "none" | "requesting" | "approved",
    isMicEnabled: false,
  };

  const student2State = {
    hasSpeakingPermission: false,
    unmuteRequestStatus: "none" as "none" | "requesting" | "approved",
    isMicEnabled: false,
  };

  function registerStudentListeners(socket: Socket, studentState: typeof student1State, myUserId: string) {
    const handleControl = (msg: any) => {
      if (msg?.isControl) {
        if (msg.controlAction === "MIC_RESPONSE") {
          // Security gate: non-host cannot self-authorize
          if (msg.senderId === myUserId) return;
          if (!msg.isHost && msg.senderRole !== "tutor") return;

          if (msg.targetUserId === myUserId) {
            if (msg.approved) {
              studentState.hasSpeakingPermission = true;
              studentState.unmuteRequestStatus = "approved";
              studentState.isMicEnabled = true;
            } else {
              studentState.hasSpeakingPermission = false;
              studentState.unmuteRequestStatus = "none";
              studentState.isMicEnabled = false;
            }
          }
        } else if (msg.controlAction === "FORCE_MUTE") {
          if (msg.all || msg.targetUserId === myUserId) {
            studentState.hasSpeakingPermission = false;
            studentState.unmuteRequestStatus = "none";
            studentState.isMicEnabled = false;
          }
        }
      }
    };

    socket.on("chatMessage", handleControl);
    socket.on("unmuteResponse", handleControl);
  }

  it("Step 0: Connect real Tutor and Students to signaling server", async () => {
    const tutorToken = makeToken(tutorId, "tutor", "Dr. Gauss");
    tutorSocket = io(signalingUrl, {
      auth: { token: tutorToken },
      query: { token: tutorToken, classId: testRoomCode, name: "Dr. Gauss", role: "tutor", peerIdentity: tutorId },
      transports: ["websocket"],
    });
    registerTutorListeners(tutorSocket);

    const s1Token = makeToken(student1Id, "student", "Alice");
    student1Socket = io(signalingUrl, {
      auth: { token: s1Token },
      query: { token: s1Token, classId: testRoomCode, name: "Alice", role: "student", peerIdentity: student1Id },
      transports: ["websocket"],
    });
    registerStudentListeners(student1Socket, student1State, student1Id);

    const s2Token = makeToken(student2Id, "student", "Bob");
    student2Socket = io(signalingUrl, {
      auth: { token: s2Token },
      query: { token: s2Token, classId: testRoomCode, name: "Bob", role: "student", peerIdentity: student2Id },
      transports: ["websocket"],
    });
    registerStudentListeners(student2Socket, student2State, student2Id);

    await Promise.all([
      new Promise<void>((r) => tutorSocket.on("connect", r)),
      new Promise<void>((r) => student1Socket.on("connect", r)),
      new Promise<void>((r) => student2Socket.on("connect", r)),
    ]);

    assert.equal(tutorSocket.connected, true);
    assert.equal(student1Socket.connected, true);
    assert.equal(student2Socket.connected, true);

    // Simulate async DB participant join resolving and setting tutor host status
    tutorIsHostState = true;
    tutorIsHostRef.current = true;

    await new Promise((r) => setTimeout(r, 1000));
  });

  it("Step 1 & 2 & 3: Student 1 emits requestMic -> Tutor receives it -> Tutor UI displays correct student", async () => {
    const correlationId = "mic-test-alice-1";
    student1State.unmuteRequestStatus = "requesting";

    const payload = {
      type: "REQUEST_UNMUTE",
      correlationId,
      userId: student1Id,
      name: "Alice",
      senderId: student1Id,
      roomCode: testRoomCode,
      timestamp: Date.now(),
    };

    student1Socket.emit("unmuteRequest", payload);
    student1Socket.emit("chatMessage", {
      isControl: true,
      controlAction: "REQUEST_MIC",
      correlationId,
      userId: student1Id,
      name: "Alice",
      senderId: student1Id,
      roomCode: testRoomCode,
      timestamp: Date.now(),
    });

    // Wait for delivery over internet
    await new Promise((r) => setTimeout(r, 1500));

    // Verify Tutor UI has the request in queue
    assert.equal(tutorUnmuteRequests.length, 1);
    assert.equal(tutorUnmuteRequests[0].userId, student1Id);
    assert.equal(tutorUnmuteRequests[0].name, "Alice");
    assert.equal(tutorUnmuteRequests[0].correlationId, correlationId);
  });

  it("Step 4 & 5 & 6: Tutor clicks Allow -> Only Student 1 receives approval -> Student 1 microphone enabled", async () => {
    // Tutor approves Student 1
    const targetUserId = student1Id;
    const respCorrelationId = "mic-resp-alice-1";

    const approvalPayload = {
      isControl: true,
      controlAction: "MIC_RESPONSE",
      correlationId: respCorrelationId,
      targetUserId,
      approved: true,
      tutorName: "Dr. Gauss",
      senderId: tutorId,
      senderRole: "tutor",
      isHost: true,
      roomCode: testRoomCode,
      timestamp: Date.now(),
    };

    tutorSocket.emit("chatMessage", approvalPayload);
    tutorSocket.emit("unmuteResponse", approvalPayload);
    // Tutor removes from local queue upon clicking Allow
    tutorUnmuteRequests = tutorUnmuteRequests.filter((r) => r.userId !== targetUserId);

    await new Promise((r) => setTimeout(r, 1500));

    // Verify Student 1 received approval and activated microphone
    assert.equal(student1State.hasSpeakingPermission, true);
    assert.equal(student1State.unmuteRequestStatus, "approved");
    assert.equal(student1State.isMicEnabled, true);

    // Verify Student 2 did NOT receive speaking permission (isolation)
    assert.equal(student2State.hasSpeakingPermission, false);
    assert.equal(student2State.unmuteRequestStatus, "none");
    assert.equal(student2State.isMicEnabled, false);
  });

  it("Step 7a: Cancellation flow — Student 2 requests and then cancels before tutor responds", async () => {
    const s2Correlation = "mic-test-bob-1";
    student2State.unmuteRequestStatus = "requesting";

    // Bob requests
    student2Socket.emit("unmuteRequest", {
      type: "REQUEST_UNMUTE",
      correlationId: s2Correlation,
      userId: student2Id,
      name: "Bob",
      senderId: student2Id,
      roomCode: testRoomCode,
      timestamp: Date.now(),
    });
    student2Socket.emit("chatMessage", {
      isControl: true,
      controlAction: "REQUEST_MIC",
      correlationId: s2Correlation,
      userId: student2Id,
      name: "Bob",
      senderId: student2Id,
      roomCode: testRoomCode,
      timestamp: Date.now(),
    });

    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(tutorUnmuteRequests.some((r) => r.userId === student2Id), true);

    // Bob cancels
    student2State.unmuteRequestStatus = "none";
    student2Socket.emit("chatMessage", {
      isControl: true,
      controlAction: "CANCEL_REQUEST",
      correlationId: "cancel-bob-1",
      userId: student2Id,
      senderId: student2Id,
      roomCode: testRoomCode,
      timestamp: Date.now(),
    });

    await new Promise((r) => setTimeout(r, 1500));
    // Tutor queue must no longer contain Bob
    assert.equal(tutorUnmuteRequests.some((r) => r.userId === student2Id), false);
  });

  it("Step 7b: Deny flow — Tutor declines request and student status returns to none", async () => {
    // Bob requests again
    student2State.unmuteRequestStatus = "requesting";
    student2Socket.emit("unmuteRequest", {
      type: "REQUEST_UNMUTE",
      correlationId: "mic-test-bob-2",
      userId: student2Id,
      name: "Bob",
      senderId: student2Id,
      roomCode: testRoomCode,
      timestamp: Date.now(),
    });

    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(tutorUnmuteRequests.some((r) => r.userId === student2Id), true);

    // Tutor denies Bob
    tutorSocket.emit("chatMessage", {
      isControl: true,
      controlAction: "MIC_RESPONSE",
      targetUserId: student2Id,
      approved: false,
      tutorName: "Dr. Gauss",
      senderId: tutorId,
      senderRole: "tutor",
      isHost: true,
      roomCode: testRoomCode,
      timestamp: Date.now(),
    });
    tutorUnmuteRequests = tutorUnmuteRequests.filter((r) => r.userId !== student2Id);

    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(student2State.hasSpeakingPermission, false);
    assert.equal(student2State.unmuteRequestStatus, "none");
    assert.equal(student2State.isMicEnabled, false);
  });

  it("Step 8: Requests in another room are not delivered (room isolation)", async () => {
    const initialQueueLength = tutorUnmuteRequests.length;

    // Rogue student in another room
    const rogueId = "rogue-student-99";
    const rogueToken = makeToken(rogueId, "student", "Rogue");
    const rogueSocket = io(signalingUrl, {
      auth: { token: rogueToken },
      query: { token: rogueToken, classId: otherRoomCode, name: "Rogue", role: "student", peerIdentity: rogueId },
      transports: ["websocket"],
    });

    await new Promise<void>((r) => rogueSocket.on("connect", r));

    rogueSocket.emit("unmuteRequest", {
      type: "REQUEST_UNMUTE",
      correlationId: "rogue-req",
      userId: rogueId,
      name: "Rogue",
      senderId: rogueId,
      roomCode: otherRoomCode,
      timestamp: Date.now(),
    });

    await new Promise((r) => setTimeout(r, 1500));
    // Tutor in testRoomCode must NOT have received rogue student's request
    assert.equal(tutorUnmuteRequests.length, initialQueueLength);
    assert.equal(tutorUnmuteRequests.some((r) => r.userId === rogueId), false);

    rogueSocket.disconnect();
  });

  it("Step 9: Reconnecting does not break request delivery", async () => {
    // Disconnect tutor socket and reconnect
    tutorSocket.disconnect();
    await new Promise((r) => setTimeout(r, 1000));

    const tutorToken = makeToken(tutorId, "tutor", "Dr. Gauss");
    tutorSocket = io(signalingUrl, {
      auth: { token: tutorToken },
      query: { token: tutorToken, classId: testRoomCode, name: "Dr. Gauss", role: "tutor", peerIdentity: tutorId },
      transports: ["websocket"],
    });
    registerTutorListeners(tutorSocket);
    await new Promise<void>((r) => tutorSocket.on("connect", r));

    await new Promise((r) => setTimeout(r, 1000));

    // Student 2 requests mic again
    const cId = "reconnect-test-bob";
    student2Socket.emit("unmuteRequest", {
      type: "REQUEST_UNMUTE",
      correlationId: cId,
      userId: student2Id,
      name: "Bob",
      senderId: student2Id,
      roomCode: testRoomCode,
      timestamp: Date.now(),
    });

    await new Promise((r) => setTimeout(r, 1500));
    // Reconnected tutor must successfully receive and queue request
    assert.equal(tutorUnmuteRequests.some((r) => r.userId === student2Id), true);
  });

  it("Teardown sockets cleanly", () => {
    tutorSocket?.disconnect();
    student1Socket?.disconnect();
    student2Socket?.disconnect();
  });
});
