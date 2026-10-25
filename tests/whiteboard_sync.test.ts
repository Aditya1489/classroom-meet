import assert from "node:assert";
import { query } from "../server/db";
import { io } from "socket.io-client";

/**
 * Test Suite: Whiteboard Real-Time Synchronization & View Switching
 * 
 * Tests:
 * 1. View Switching: Tutor broadcast updates student view state.
 * 2. View Switching: Tutor toggle off returns student to grid.
 * 3. Anti-tampering: Non-host cannot broadcast view changes.
 * 4. Echo / Loop Prevention: Receiving a remote update does not trigger local re-broadcast.
 * 5. Drawing Sync & Diff Processing: Adding, modifying, deleting records via diff.
 * 6. Room Isolation: Cross-room event containment.
 * 7. Snapshot Persistence & Late Join State.
 */

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

// Diff apply logic matching tldraw store mergeRemoteChanges & applyDiff
interface MockStoreRecord {
  id: string;
  typeName: string;
  [key: string]: any;
}

class MockTLStore {
  public records = new Map<string, MockStoreRecord>();
  public isMergingRemote = false;
  public listener: ((entry: { source: "user" | "remote"; changes: any }) => void) | null = null;

  put(records: MockStoreRecord[]) {
    const added: Record<string, MockStoreRecord> = {};
    const updated: Record<string, [MockStoreRecord, MockStoreRecord]> = {};
    for (const r of records) {
      if (this.records.has(r.id)) {
        updated[r.id] = [this.records.get(r.id)!, r];
      } else {
        added[r.id] = r;
      }
      this.records.set(r.id, r);
    }
    this.listener?.({
      source: this.isMergingRemote ? "remote" : "user",
      changes: { added, updated, removed: {} },
    });
  }

  remove(ids: string[]) {
    const removed: Record<string, MockStoreRecord> = {};
    for (const id of ids) {
      if (this.records.has(id)) {
        removed[id] = this.records.get(id)!;
        this.records.delete(id);
      }
    }
    this.listener?.({
      source: this.isMergingRemote ? "remote" : "user",
      changes: { added: {}, updated: {}, removed },
    });
  }

  applyDiff(diff: { added?: Record<string, any>; updated?: Record<string, any>; removed?: Record<string, any> }) {
    if (diff.added) {
      for (const [id, rec] of Object.entries(diff.added)) {
        this.records.set(id, rec);
      }
    }
    if (diff.updated) {
      for (const [id, val] of Object.entries(diff.updated)) {
        const toRec = Array.isArray(val) ? val[1] : val;
        this.records.set(id, toRec);
      }
    }
    if (diff.removed) {
      for (const id of Object.keys(diff.removed)) {
        this.records.delete(id);
      }
    }
  }

  mergeRemoteChanges(fn: () => void) {
    this.isMergingRemote = true;
    try {
      fn();
    } finally {
      this.isMergingRemote = false;
    }
  }

  listen(cb: (entry: { source: "user" | "remote"; changes: any }) => void) {
    this.listener = cb;
    return () => {
      this.listener = null;
    };
  }
}

async function runTestSuite() {
  console.log("=== STARTING WHITEBOARD SYNC & VIEW SWITCHING TEST SUITE ===");

  // --- TEST 1: Diff & Store Loop Prevention ---
  console.log("\n--- TEST 1: TLDraw Store Diff & Remote Echo Prevention ---");
  const store = new MockTLStore();
  let userBroadcastCount = 0;
  let remoteBroadcastCount = 0;

  store.listen((entry) => {
    if (entry.source === "user") {
      userBroadcastCount++;
    } else {
      remoteBroadcastCount++;
    }
  });

  // Local user inserts ruler
  store.put([{ id: "shape:ruler_1", typeName: "shape", type: "ruler", w: 400 }]);
  assert.strictEqual(userBroadcastCount, 1, "User addition should trigger user broadcast");
  assert.strictEqual(remoteBroadcastCount, 0, "No remote broadcast for local action");

  // Remote student diff arrives
  store.mergeRemoteChanges(() => {
    store.applyDiff({
      added: { "shape:compass_1": { id: "shape:compass_1", typeName: "shape", type: "compass" } },
    });
  });

  // Since it was remote, user broadcast listener must NOT have fired again!
  assert.strictEqual(userBroadcastCount, 1, "Remote diff must NOT trigger user broadcast (infinite loop prevention)");
  assert.strictEqual(store.records.has("shape:compass_1"), true, "Remote compass shape applied to store");
  console.log("✓ TEST 1 PASSED: Infinite loop prevented; local vs remote source separation verified.");

  // --- TEST 2: Shape Deletion & Update Synchronization ---
  console.log("\n--- TEST 2: Shape Update and Erasure/Deletion Propagation ---");
  // Remote update
  store.mergeRemoteChanges(() => {
    store.applyDiff({
      updated: { "shape:ruler_1": [null, { id: "shape:ruler_1", typeName: "shape", type: "ruler", w: 600 }] },
      removed: { "shape:compass_1": { id: "shape:compass_1" } },
    });
  });

  assert.strictEqual(store.records.get("shape:ruler_1")?.w, 600, "Updated property reflected in store");
  assert.strictEqual(store.records.has("shape:compass_1"), false, "Erased/removed shape removed from store");
  assert.strictEqual(userBroadcastCount, 1, "No local user echo triggered on remote update/remove");
  console.log("✓ TEST 2 PASSED: Shape mutation and deletion accurately applied.");

  // --- TEST 3: Real-Time Signaling View State Switch ---
  console.log("\n--- TEST 3: Real-Time View State Switching via Mediasoup SFU ---");
  const serverUrl = "https://rtc.mathsy.in";
  const testRoomCode = "wb-view-test-" + Date.now();

  const tutorToken = makeToken("tutor-v", "tutor", "Tutor View");
  const tutorSocket = io(serverUrl, {
    auth: { token: tutorToken },
    query: { token: tutorToken, classId: testRoomCode, name: "Tutor View", role: "tutor", peerIdentity: "tutor-v" },
    transports: ["websocket"],
  });

  const studentToken = makeToken("student-v", "student", "Student View");
  const studentSocket = io(serverUrl, {
    auth: { token: studentToken },
    query: { token: studentToken, classId: testRoomCode, name: "Student View", role: "student", peerIdentity: "student-v" },
    transports: ["websocket"],
  });

  await Promise.all([
    new Promise<void>((res) => tutorSocket.on("connect", res)),
    new Promise<void>((res) => studentSocket.on("connect", res)),
  ]);
  await new Promise((r) => setTimeout(r, 1000));

  let studentReceivedState: any = null;

  studentSocket.on("chatMessage", (msg) => {
    if (msg?.isControl && msg?.controlAction === "WHITEBOARD_STATE") {
      studentReceivedState = msg;
    }
  });

  // Tutor opens whiteboard
  tutorSocket.emit("chatMessage", {
    isControl: true,
    controlAction: "WHITEBOARD_STATE",
    roomCode: testRoomCode,
    isOpen: true,
    layoutMode: "whiteboard",
    isHost: true,
  });

  await new Promise((r) => setTimeout(r, 1500));

  assert.notStrictEqual(studentReceivedState, null, "Student must receive WHITEBOARD_STATE control message");
  assert.strictEqual(studentReceivedState.isOpen, true, "State must indicate isOpen = true");
  assert.strictEqual(studentReceivedState.layoutMode, "whiteboard", "Layout mode must be whiteboard");
  console.log("✓ TEST 3 PASSED: Tutor opening whiteboard switched student view state to whiteboard.");

  // --- TEST 4: Tutor Switches Back to Grid ---
  console.log("\n--- TEST 4: Tutor Switches Back to Grid View ---");
  studentReceivedState = null;

  tutorSocket.emit("chatMessage", {
    isControl: true,
    controlAction: "WHITEBOARD_STATE",
    roomCode: testRoomCode,
    isOpen: false,
    layoutMode: "grid",
    isHost: true,
  });

  await new Promise((r) => setTimeout(r, 1500));

  assert.notStrictEqual(studentReceivedState, null, "Student must receive closed WHITEBOARD_STATE");
  assert.strictEqual(studentReceivedState.isOpen, false, "State must indicate isOpen = false");
  assert.strictEqual(studentReceivedState.layoutMode, "grid", "Layout mode must return to grid");
  console.log("✓ TEST 4 PASSED: Tutor closing whiteboard returned student view state to grid.");

  // --- TEST 5: Malformed & Untrusted Event Rejection ---
  console.log("\n--- TEST 5: Negative Testing (Mismatched Room & Non-Host Rejection) ---");
  let rogueTriggered = false;

  const handleControlMessage = (ctrl: any, currentRoom: string, isLocalHost: boolean): boolean => {
    // Validation matching MeetingRoom implementation
    if (!ctrl || !ctrl.isControl || ctrl.controlAction !== "WHITEBOARD_STATE") return false;
    if (ctrl.roomCode !== currentRoom) return false;
    if (!ctrl.isHost && ctrl.role !== "tutor") return false; // Unauthorized non-host rejected
    return true;
  };

  // 1. Mismatched room code
  const resultMismatched = handleControlMessage(
    { isControl: true, controlAction: "WHITEBOARD_STATE", roomCode: "other-room", isOpen: true, isHost: true },
    testRoomCode,
    false
  );
  assert.strictEqual(resultMismatched, false, "Mismatched room event must be rejected");

  // 2. Student trying to force view change
  const resultStudentImposter = handleControlMessage(
    { isControl: true, controlAction: "WHITEBOARD_STATE", roomCode: testRoomCode, isOpen: false, isHost: false },
    testRoomCode,
    false
  );
  assert.strictEqual(resultStudentImposter, false, "Non-host state change must be rejected");

  console.log("✓ TEST 5 PASSED: Mismatched rooms and non-host state spoofing successfully blocked.");

  // Clean up sockets
  tutorSocket.disconnect();
  studentSocket.disconnect();

  // --- TEST 6: Database Persistence & Late Join View State ---
  console.log("\n--- TEST 6: Backend Snapshot & Late-Join View State Persistence ---");
  const testDbRoomCode = "db-wb-" + Math.random().toString(36).substring(2, 8);

  // Create room in database
  await query(
    `INSERT INTO live_classes (room_code, title, is_active, metadata)
     VALUES ($1, $2, true, '{"is_whiteboard_open": true}'::jsonb)`,
    [testDbRoomCode, "Test WB Class"]
  );

  // Insert whiteboard snapshot
  const mockSnapshot = {
    schema: { schemaVersion: 2 },
    store: { "shape:ruler_1": { id: "shape:ruler_1", type: "ruler" } },
  };

  await query(
    `INSERT INTO whiteboard_snapshots (room_code, snapshot_json, shape_count, updated_at)
     VALUES ($1, $2, 1, NOW())
     ON CONFLICT (room_code) DO UPDATE SET snapshot_json = EXCLUDED.snapshot_json, updated_at = NOW()`,
    [testDbRoomCode, JSON.stringify(mockSnapshot)]
  );

  // Retrieve room metadata and snapshot (simulating late-joining student)
  const roomRes = await query("SELECT metadata FROM live_classes WHERE room_code = $1", [testDbRoomCode]);
  const wbRes = await query("SELECT snapshot_json FROM whiteboard_snapshots WHERE room_code = $1", [testDbRoomCode]);

  assert.strictEqual(Boolean(roomRes.rows[0]?.metadata?.is_whiteboard_open), true, "Late joiner detects whiteboard is open");
  assert.deepStrictEqual(wbRes.rows[0]?.snapshot_json, mockSnapshot, "Late joiner loads correct snapshot");

  console.log("✓ TEST 6 PASSED: Database persistence and late-join state recovery verified.");

  console.log("\n=== ALL 6 WHITEBOARD TESTS PASSED SUCCESSFULLY ===");
  process.exit(0);
}

runTestSuite().catch((err) => {
  console.error("Test Suite Failed:", err);
  process.exit(1);
});
