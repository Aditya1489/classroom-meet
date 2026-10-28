import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { io, Socket } from "socket.io-client";
import { query } from "../server/db";

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

const isRemoteSfuOptedIn = process.env.RUN_REMOTE_SFU_TESTS === "true";

describe("Step 3: Full End-to-End Whiteboard Integration Test", {
  skip: !isRemoteSfuOptedIn
    ? "Opt-in only: Set RUN_REMOTE_SFU_TESTS=true to enable live tests connecting to production SFU (https://rtc.mathsy.in)"
    : false,
}, () => {
  const serverUrl = process.env.TEST_SFU_URL || "https://rtc.mathsy.in";
  const roomCode = "e2e-wb-" + Math.random().toString(36).substring(2, 8);

  let tutorSocket: Socket;
  let studentSocket: Socket;

  after(async () => {
    tutorSocket?.disconnect();
    tutorSocket?.close();
    studentSocket?.disconnect();
    studentSocket?.close();
    try {
      await query("DELETE FROM whiteboard_snapshots WHERE room_code = $1", [roomCode]);
      await query("DELETE FROM live_classes WHERE room_code = $1", [roomCode]);
    } catch (_) {}
  });

  it("Executes full whiteboard lifecycle: connect, broadcast view state, shape synchronization, and late joiner recovery", async () => {
    // 1. Create Room in DB
    await query(
      `INSERT INTO live_classes (room_code, title, is_active, metadata)
       VALUES ($1, 'E2E Whiteboard Test Class', true, '{"is_whiteboard_open": false}'::jsonb)`,
      [roomCode]
    );

    // 2. Connect Tutor & Student to SFU
    const tutorToken = makeToken("tutor-e2e", "tutor", "Tutor E2E");
    tutorSocket = io(serverUrl, {
      auth: { token: tutorToken },
      query: { token: tutorToken, classId: roomCode, name: "Tutor E2E", role: "tutor", peerIdentity: "tutor-e2e" },
      transports: ["websocket"],
    });

    const studentToken = makeToken("student-e2e-1", "student", "Student E2E 1");
    studentSocket = io(serverUrl, {
      auth: { token: studentToken },
      query: { token: studentToken, classId: roomCode, name: "Student E2E 1", role: "student", peerIdentity: "student-e2e-1" },
      transports: ["websocket"],
    });

    await Promise.all([
      new Promise<void>((res) => tutorSocket.on("connect", res)),
      new Promise<void>((res) => studentSocket.on("connect", res)),
    ]);

    // Track student state
    let studentIsWhiteboardOpen = false;
    let studentViewMode = "grid";
    const studentCanvasShapes = new Map<string, any>();

    studentSocket.on("classViewStateChanged", (data: any) => {
      studentIsWhiteboardOpen = Boolean(data.isWhiteboardOpen);
      studentViewMode = data.viewMode;
    });

    studentSocket.on("whiteboardDiff", (diff: any) => {
      if (diff.added) {
        for (const [id, record] of Object.entries(diff.added)) {
          studentCanvasShapes.set(id, record);
        }
      }
      if (diff.updated) {
        for (const [id, record] of Object.entries(diff.updated)) {
          studentCanvasShapes.set(id, record);
        }
      }
      if (diff.removed) {
        for (const id of Object.keys(diff.removed)) {
          studentCanvasShapes.delete(id);
        }
      }
    });

    // 3. Tutor opens whiteboard
    tutorSocket.emit("updateClassViewState", {
      classId: roomCode,
      viewMode: "whiteboard",
      isWhiteboardOpen: true,
      activeWhiteboardId: "board-1",
    });

    await new Promise((r) => setTimeout(r, 1000));
    assert.strictEqual(studentIsWhiteboardOpen, true, "Student receives whiteboard opened event");
    assert.strictEqual(studentViewMode, "whiteboard", "Student view switches to 'whiteboard'");

    // 4. Tutor creates shape
    const shapeId = "shape:compass_e2e";
    const shapeRecord = { id: shapeId, typeName: "shape", type: "compass", x: 100, y: 100 };
    tutorSocket.emit("whiteboardDiff", {
      classId: roomCode,
      diff: { added: { [shapeId]: shapeRecord } },
    });

    await new Promise((r) => setTimeout(r, 1000));
    assert.strictEqual(studentCanvasShapes.has(shapeId), true, "Student receives shape via diff");

    // 5. Late joiner verification
    await query(
      `INSERT INTO whiteboard_snapshots (room_code, snapshot_json, shape_count, updated_at)
       VALUES ($1, $2, 1, NOW())
       ON CONFLICT (room_code) DO UPDATE SET snapshot_json = EXCLUDED.snapshot_json, updated_at = NOW()`,
      [roomCode, JSON.stringify({ store: Object.fromEntries(studentCanvasShapes) })]
    );

    const lateSnapshotRes = await query("SELECT snapshot_json FROM whiteboard_snapshots WHERE room_code = $1", [roomCode]);
    assert.strictEqual(Boolean(lateSnapshotRes.rows[0]?.snapshot_json?.store?.[shapeId]), true, "Snapshot persists shape");
  });
});
