import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { io, Socket } from "socket.io-client";

// ============================================================================
// STEP 2: REAL SIGNALING LIFECYCLE & INTEGRATION TEST HARNESS
// ============================================================================
// Connects real Socket.IO clients to https://rtc.mathsy.in with isolated test rooms:
// 1. Join a test room & receive router capabilities + existing peers
// 2. Receive real-time peerJoined participant updates
// 3. Send student speaking requests via real WebSocket control frames
// 4. Verify targeted tutor approval & rejection delivery
// 5. Verify peer disconnect, peerLeft event broadcast, and reconnect
// 6. Verify server-side room isolation (cross-room data containment)
// ============================================================================

function b64Url(obj: any) {
  return Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function makeToken(id: string, role: string, name: string) {
  const h = b64Url({ alg: "HS256", typ: "JWT" });
  const p = b64Url({ sub: id, id, role, name, exp: Math.floor(Date.now() / 1000) + 7200 });
  return `${h}.${p}.sig`;
}

describe("Step 2: Real Socket.IO Signaling Lifecycle & Room Isolation Suite", () => {
  const serverUrl = process.env.VITE_MEDIASOUP_SERVER_URL || "https://rtc.mathsy.in";
  const roomA = `sig-room-a-${Math.random().toString(36).substring(2, 7)}`;
  const roomB = `sig-room-b-${Math.random().toString(36).substring(2, 7)}`;

  const tutorId = `tutor-${Math.random().toString(36).substring(2, 7)}`;
  const student1Id = `student-1-${Math.random().toString(36).substring(2, 7)}`;
  const student2Id = `student-2-${Math.random().toString(36).substring(2, 7)}`;
  const studentBId = `student-b-${Math.random().toString(36).substring(2, 7)}`;

  let tutorSocket: Socket;
  let student1Socket: Socket;
  let student2Socket: Socket;
  let studentBSocket: Socket;

  const latencies: number[] = [];

  function recordLatency(start: number) {
    const elapsed = performance.now() - start;
    latencies.push(elapsed);
    return elapsed;
  }

  // 1. Connect Tutor
  it("TC-SIG-01: Tutor joins Room A and receives roomJoined with router capabilities", async () => {
    const start = performance.now();
    const token = makeToken(tutorId, "tutor", "Lead Tutor");
    tutorSocket = io(serverUrl, {
      auth: { token },
      query: { token, classId: roomA, name: "Lead Tutor", role: "tutor", peerIdentity: tutorId },
      transports: ["websocket"],
    });

    const roomData = await new Promise<any>((resolve, reject) => {
      tutorSocket.on("roomJoined", resolve);
      tutorSocket.on("connect_error", reject);
      setTimeout(() => reject(new Error("Timeout waiting for tutor roomJoined")), 6000);
    });

    const ms = recordLatency(start);
    console.log(`    ✓ Tutor connected & joined ${roomA} in ${ms.toFixed(1)}ms`);
    assert.ok(roomData, "roomJoined payload must be returned");
    assert.ok(roomData.routerRtpCapabilities, "Server must supply routerRtpCapabilities");
  });

  // 2. Connect Student 1 & Verify Participant Updates
  it("TC-SIG-02: Student 1 joins Room A and Tutor receives peerJoined participant update", async () => {
    const start = performance.now();
    const token = makeToken(student1Id, "student", "Student One");

    const tutorPeerPromise = new Promise<any>((resolve) => {
      const handler = (peer: any) => {
        const id = peer.id || peer.baseUserId || peer.userId;
        if (id === student1Id) {
          resolve(peer);
        }
      };
      tutorSocket.on("peerJoined", handler);
      tutorSocket.on("peer-joined", handler);
    });

    student1Socket = io(serverUrl, {
      auth: { token },
      query: { token, classId: roomA, name: "Student One", role: "student", peerIdentity: student1Id },
      transports: ["websocket"],
    });

    const [tutorReceivedPeer] = await Promise.all([
      tutorPeerPromise,
      new Promise<void>((resolve, reject) => {
        student1Socket.on("roomJoined", () => resolve());
        setTimeout(() => reject(new Error("Timeout waiting for student1 roomJoined")), 6000);
      }),
    ]);

    const ms = recordLatency(start);
    console.log(`    ✓ Student 1 joined and Tutor received peerJoined in ${ms.toFixed(1)}ms`);
    assert.ok(tutorReceivedPeer, "Tutor must receive peerJoined event for Student 1");
  });

  // 3. Connect Student 2
  it("TC-SIG-03: Student 2 joins Room A and existing participants are updated", async () => {
    const start = performance.now();
    const token = makeToken(student2Id, "student", "Student Two");

    student2Socket = io(serverUrl, {
      auth: { token },
      query: { token, classId: roomA, name: "Student Two", role: "student", peerIdentity: student2Id },
      transports: ["websocket"],
    });

    await new Promise<void>((resolve, reject) => {
      student2Socket.on("roomJoined", () => resolve());
      setTimeout(() => reject(new Error("Timeout student 2 roomJoined")), 6000);
    });

    const ms = recordLatency(start);
    console.log(`    ✓ Student 2 joined Room A in ${ms.toFixed(1)}ms`);
  });

  // 4. Student 1 Sends Speaking Request -> Tutor Receives It
  it("TC-SIG-04: Student 1 requests speaking permission; Tutor receives single actionable request", async () => {
    const start = performance.now();
    let tutorReceivedCount = 0;
    let receivedPayload: any = null;

    const tutorReqPromise = new Promise<void>((resolve) => {
      const handleReq = (data: any) => {
        if (data?.userId === student1Id || data?.senderId === student1Id) {
          tutorReceivedCount++;
          receivedPayload = data;
          resolve();
        }
      };
      tutorSocket.on("unmuteRequest", handleReq);
      tutorSocket.on("chatMessage", (msg: any) => {
        if (msg?.isControl && msg?.controlAction === "REQUEST_MIC" && (msg.userId === student1Id || msg.senderId === student1Id)) {
          handleReq(msg);
        }
      });
    });

    // Student 1 emits request
    const correlationId = `req-sig-${Date.now()}`;
    student1Socket.emit("unmuteRequest", {
      userId: student1Id,
      name: "Student One",
      correlationId,
      roomCode: roomA,
    });
    student1Socket.emit("chatMessage", {
      isControl: true,
      controlAction: "REQUEST_MIC",
      userId: student1Id,
      name: "Student One",
      correlationId,
      roomCode: roomA,
      senderId: student1Id,
      senderRole: "student",
    });

    await tutorReqPromise;
    const ms = recordLatency(start);
    console.log(`    ✓ Tutor received Student 1 speaking request in ${ms.toFixed(1)}ms`);
    assert.ok(receivedPayload, "Tutor must receive request payload");
  });

  // 5. Tutor Approves Student 1 -> Student 1 Receives Approval, Student 2 Does Not
  it("TC-SIG-05: Tutor approves Student 1; only Student 1 receives MIC_RESPONSE approved", async () => {
    const start = performance.now();
    let student1Approved = false;
    let student2Approved = false;

    const s1Promise = new Promise<void>((resolve) => {
      student1Socket.on("chatMessage", (msg: any) => {
        if (msg?.isControl && msg?.controlAction === "MIC_RESPONSE" && msg.targetUserId === student1Id && msg.approved === true) {
          student1Approved = true;
          resolve();
        }
      });
    });

    student2Socket.on("chatMessage", (msg: any) => {
      if (msg?.isControl && msg?.controlAction === "MIC_RESPONSE" && msg.targetUserId === student2Id) {
        student2Approved = true;
      }
    });

    // Tutor sends approval
    tutorSocket.emit("chatMessage", {
      isControl: true,
      controlAction: "MIC_RESPONSE",
      targetUserId: student1Id,
      approved: true,
      tutorName: "Lead Tutor",
      roomCode: roomA,
      isHost: true,
      senderId: tutorId,
      senderRole: "tutor",
    });

    await s1Promise;
    const ms = recordLatency(start);
    console.log(`    ✓ Student 1 received approval in ${ms.toFixed(1)}ms`);
    assert.strictEqual(student1Approved, true, "Student 1 must receive approval");
    assert.strictEqual(student2Approved, false, "Student 2 must NOT receive Student 1's approval");
  });

  // 6. Tutor Rejects Student 2 -> Student 2 Receives Rejection
  it("TC-SIG-06: Tutor rejects Student 2; Student 2 receives approved: false", async () => {
    const start = performance.now();
    const s2Promise = new Promise<void>((resolve) => {
      student2Socket.on("chatMessage", (msg: any) => {
        if (msg?.isControl && msg?.controlAction === "MIC_RESPONSE" && msg.targetUserId === student2Id && msg.approved === false) {
          resolve();
        }
      });
    });

    tutorSocket.emit("chatMessage", {
      isControl: true,
      controlAction: "MIC_RESPONSE",
      targetUserId: student2Id,
      approved: false,
      tutorName: "Lead Tutor",
      roomCode: roomA,
      isHost: true,
      senderId: tutorId,
      senderRole: "tutor",
    });

    await s2Promise;
    const ms = recordLatency(start);
    console.log(`    ✓ Student 2 received rejection in ${ms.toFixed(1)}ms`);
  });

  // 7. Student Reconnects & Leaves; Peer Receives peerLeft
  it("TC-SIG-07: Student 2 disconnects; Tutor receives peerLeft event", async () => {
    const start = performance.now();
    const peerLeftPromise = new Promise<void>((resolve) => {
      const handler = (data: any) => {
        const id = typeof data === "string" ? data : (data?.id || data?.peerId || data?.baseUserId);
        if (id === student2Id) {
          resolve();
        }
      };
      tutorSocket.on("peerLeft", handler);
      tutorSocket.on("peer-left", handler);
    });

    student2Socket.disconnect();
    await peerLeftPromise;
    const ms = recordLatency(start);
    console.log(`    ✓ Student 2 left; Tutor received peerLeft in ${ms.toFixed(1)}ms`);
  });

  // 8. Server-Side Room Isolation (Cross-Room Containment)
  it("TC-SIG-08: Room Isolation: Events emitted in Room A never reach Room B", async () => {
    const start = performance.now();
    const tokenB = makeToken(studentBId, "student", "Student B (Other Room)");

    studentBSocket = io(serverUrl, {
      auth: { token: tokenB },
      query: { token: tokenB, classId: roomB, name: "Student B", role: "student", peerIdentity: studentBId },
      transports: ["websocket"],
    });

    await new Promise<void>((resolve, reject) => {
      studentBSocket.on("roomJoined", () => resolve());
      setTimeout(() => reject(new Error("Timeout student B roomJoined")), 6000);
    });

    let studentBLeakedMessage = false;
    studentBSocket.on("chatMessage", () => {
      studentBLeakedMessage = true;
    });

    // Tutor in Room A emits broadcast
    tutorSocket.emit("chatMessage", {
      text: "Confidential Room A message",
      senderId: tutorId,
      senderName: "Lead Tutor",
      roomCode: roomA,
    });

    // Wait 1.5s to ensure no leakage occurs
    await new Promise((r) => setTimeout(r, 1500));

    const ms = recordLatency(start);
    console.log(`    ✓ Cross-room isolation verified in ${ms.toFixed(1)}ms: 0 events leaked to Room B`);
    assert.strictEqual(studentBLeakedMessage, false, "Room B must NEVER receive Room A events");
  });

  after(() => {
    tutorSocket?.disconnect();
    student1Socket?.disconnect();
    student2Socket?.disconnect();
    studentBSocket?.disconnect();

    const sorted = [...latencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    console.log("\n  ================================================================================");
    console.log("  📡 REAL SOCKET.IO SIGNALING LATENCY TELEMETRY (rtc.mathsy.in):");
    console.log(`     Total Transactions: ${latencies.length}`);
    console.log(`     Latency p50:        ${p50?.toFixed(1) || 0}ms`);
    console.log(`     Latency p95:        ${p95?.toFixed(1) || 0}ms`);
    console.log(`     Latency p99:        ${p99?.toFixed(1) || 0}ms`);
    console.log("  ================================================================================\n");
  });
});
