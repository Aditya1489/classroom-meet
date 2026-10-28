import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { pool, query } from "../server/db";
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

  mergeRemoteChanges(fn: () => void) {
    this.isMergingRemote = true;
    try {
      fn();
    } finally {
      this.isMergingRemote = false;
    }
  }

  applyDiff(diff: { added?: Record<string, any>; updated?: Record<string, [any, any]>; removed?: Record<string, any> }) {
    this.mergeRemoteChanges(() => {
      if (diff.added) {
        for (const [id, record] of Object.entries(diff.added)) {
          this.records.set(id, record);
        }
      }
      if (diff.updated) {
        for (const [id, [, to]] of Object.entries(diff.updated)) {
          this.records.set(id, to);
        }
      }
      if (diff.removed) {
        for (const id of Object.keys(diff.removed)) {
          this.records.delete(id);
        }
      }
      this.listener?.({
        source: "remote",
        changes: diff,
      });
    });
  }
}

const isRemoteSfuOptedIn = process.env.RUN_REMOTE_SFU_TESTS === "true";

describe("Whiteboard Synchronization & View Switching Suite", () => {
  let createdRoomCodes: string[] = [];

  after(async () => {
    if (createdRoomCodes.length > 0) {
      try {
        await query("DELETE FROM whiteboard_snapshots WHERE room_code = ANY($1)", [createdRoomCodes]);
        await query("DELETE FROM live_classes WHERE room_code = ANY($1)", [createdRoomCodes]);
      } catch (_) {}
    }
    await pool.end();
  });

  it("WB-01: Local drawing and shape insertion triggers broadcast accurately", () => {
    const store = new MockTLStore();
    let userBroadcastCount = 0;

    store.listener = (entry) => {
      if (entry.source === "user") {
        userBroadcastCount++;
      }
    };

    store.put([
      { id: "shape:compass_1", typeName: "shape", type: "compass", x: 10, y: 20 },
      { id: "shape:ruler_1", typeName: "shape", type: "ruler", x: 50, y: 50 },
    ]);

    assert.strictEqual(store.records.size, 2);
    assert.strictEqual(userBroadcastCount, 1, "Local drawing must trigger single user broadcast");
  });

  it("WB-02: Merging remote changes prevents infinite echo loops", () => {
    const store = new MockTLStore();
    let userBroadcastCount = 0;

    store.listener = (entry) => {
      if (entry.source === "user") {
        userBroadcastCount++;
      }
    };

    // Initial local shape
    store.put([{ id: "shape:compass_1", typeName: "shape", type: "compass", x: 10, y: 20 }]);
    assert.strictEqual(userBroadcastCount, 1);

    // Apply remote diff
    store.applyDiff({
      updated: { "shape:ruler_1": [null, { id: "shape:ruler_1", typeName: "shape", type: "ruler", w: 600 }] },
      removed: { "shape:compass_1": { id: "shape:compass_1" } },
    });

    assert.strictEqual(store.records.get("shape:ruler_1")?.w, 600, "Updated property reflected in store");
    assert.strictEqual(store.records.has("shape:compass_1"), false, "Erased/removed shape removed from store");
    assert.strictEqual(userBroadcastCount, 1, "No local user echo triggered on remote update/remove");
  });

  it("WB-03: Security & Negative testing rejects mismatched room and unauthorized non-host control messages", () => {
    const handleControlMessage = (ctrl: any, currentRoom: string, isLocalHost: boolean): boolean => {
      if (!ctrl || !ctrl.isControl || ctrl.controlAction !== "WHITEBOARD_STATE") return false;
      if (ctrl.roomCode !== currentRoom) return false;
      if (!ctrl.isHost && ctrl.role !== "tutor") return false;
      return true;
    };

    const targetRoom = "room-valid-123";

    // 1. Mismatched room code
    const resMismatched = handleControlMessage(
      { isControl: true, controlAction: "WHITEBOARD_STATE", roomCode: "other-room", isOpen: true, isHost: true },
      targetRoom,
      false
    );
    assert.strictEqual(resMismatched, false, "Mismatched room event must be rejected");

    // 2. Student trying to force view change
    const resStudent = handleControlMessage(
      { isControl: true, controlAction: "WHITEBOARD_STATE", roomCode: targetRoom, isOpen: true, isHost: false, role: "student" },
      targetRoom,
      false
    );
    assert.strictEqual(resStudent, false, "Student non-host broadcast must be rejected");

    // 3. Authorized tutor
    const resTutor = handleControlMessage(
      { isControl: true, controlAction: "WHITEBOARD_STATE", roomCode: targetRoom, isOpen: true, isHost: true, role: "tutor" },
      targetRoom,
      false
    );
    assert.strictEqual(resTutor, true, "Authorized tutor event must be accepted");
  });

  describe("SFU Live Signaling Integration", {
    skip: !isRemoteSfuOptedIn
      ? "Opt-in only: Set RUN_REMOTE_SFU_TESTS=true to enable live tests connecting to production SFU (https://rtc.mathsy.in)"
      : false,
  }, () => {
    const serverUrl = process.env.TEST_SFU_URL || "https://rtc.mathsy.in";
    const testRoomCode = "wb-view-test-" + Date.now();
    let tutorSocket: Socket;
    let studentSocket: Socket;

    after(() => {
      tutorSocket?.disconnect();
      tutorSocket?.close();
      studentSocket?.disconnect();
      studentSocket?.close();
    });

    it("Tutor opening whiteboard switches student view state to whiteboard and back to grid", async () => {
      const tutorToken = makeToken("tutor-v", "tutor", "Tutor View");
      tutorSocket = io(serverUrl, {
        auth: { token: tutorToken },
        query: { token: tutorToken, classId: testRoomCode, name: "Tutor View", role: "tutor", peerIdentity: "tutor-v" },
        transports: ["websocket"],
      });

      const studentToken = makeToken("student-v", "student", "Student View");
      studentSocket = io(serverUrl, {
        auth: { token: studentToken },
        query: { token: studentToken, classId: testRoomCode, name: "Student View", role: "student", peerIdentity: "student-v" },
        transports: ["websocket"],
      });

      await Promise.all([
        new Promise<void>((res) => tutorSocket.on("connect", res)),
        new Promise<void>((res) => studentSocket.on("connect", res)),
      ]);

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

      await new Promise((r) => setTimeout(r, 1200));
      assert.notStrictEqual(studentReceivedState, null);
      assert.strictEqual(studentReceivedState.isOpen, true);

      // Tutor closes whiteboard
      studentReceivedState = null;
      tutorSocket.emit("chatMessage", {
        isControl: true,
        controlAction: "WHITEBOARD_STATE",
        roomCode: testRoomCode,
        isOpen: false,
        layoutMode: "grid",
        isHost: true,
      });

      await new Promise((r) => setTimeout(r, 1200));
      assert.notStrictEqual(studentReceivedState, null);
      assert.strictEqual(studentReceivedState.isOpen, false);
    });
  });

  it("WB-04: Database persistence and late-join state recovery", async () => {
    const testDbRoomCode = "wb-db-test-" + Date.now();
    createdRoomCodes.push(testDbRoomCode);

    await query(
      `INSERT INTO live_classes (room_code, title, is_active, metadata)
       VALUES ($1, $2, true, '{"is_whiteboard_open": true}'::jsonb)`,
      [testDbRoomCode, "Test WB Class"]
    );

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

    const roomRes = await query("SELECT metadata FROM live_classes WHERE room_code = $1", [testDbRoomCode]);
    const wbRes = await query("SELECT snapshot_json FROM whiteboard_snapshots WHERE room_code = $1", [testDbRoomCode]);

    assert.strictEqual(Boolean(roomRes.rows[0]?.metadata?.is_whiteboard_open), true);
    assert.deepStrictEqual(wbRes.rows[0]?.snapshot_json, mockSnapshot);
  });
});
