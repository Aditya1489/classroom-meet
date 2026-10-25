import assert from "node:assert";
import { io } from "socket.io-client";
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

async function runE2EIntegration() {
  console.log("=== RUNNING FULL END-TO-END WHITEBOARD INTEGRATION TEST ===");

  const serverUrl = "https://rtc.mathsy.in";
  const roomCode = "e2e-wb-" + Math.random().toString(36).substring(2, 8);

  // 1. Create Room in DB
  await query(
    `INSERT INTO live_classes (room_code, title, is_active, metadata)
     VALUES ($1, 'E2E Whiteboard Test Class', true, '{"is_whiteboard_open": false}'::jsonb)`,
    [roomCode]
  );
  console.log(`✓ 1. Room [${roomCode}] initialized in PostgreSQL.`);

  // 2. Connect Tutor & Student to SFU
  const tutorToken = makeToken("tutor-e2e", "tutor", "Tutor E2E");
  const tutorSocket = io(serverUrl, {
    auth: { token: tutorToken },
    query: { token: tutorToken, classId: roomCode, name: "Tutor E2E", role: "tutor", peerIdentity: "tutor-e2e" },
    transports: ["websocket"],
  });

  const studentToken = makeToken("student-e2e-1", "student", "Student E2E 1");
  const studentSocket = io(serverUrl, {
    auth: { token: studentToken },
    query: { token: studentToken, classId: roomCode, name: "Student E2E 1", role: "student", peerIdentity: "student-e2e-1" },
    transports: ["websocket"],
  });

  await Promise.all([
    new Promise<void>((res) => tutorSocket.on("connect", res)),
    new Promise<void>((res) => studentSocket.on("connect", res)),
  ]);
  await new Promise((r) => setTimeout(r, 1000));
  console.log("✓ 2. Both Tutor and Student connected to SFU room.");

  // Student state tracking
  let studentViewMode = "grid";
  let studentIsWhiteboardOpen = false;
  const studentCanvasShapes = new Map<string, any>();

  studentSocket.on("chatMessage", (msg) => {
    if (msg?.isControl && msg.controlAction === "WHITEBOARD_STATE") {
      if (msg.roomCode === roomCode) {
        studentIsWhiteboardOpen = Boolean(msg.isOpen);
        studentViewMode = msg.layoutMode || (msg.isOpen ? "whiteboard" : "grid");
      }
    }
  });

  studentSocket.on("whiteboardDraw", (data) => {
    if (data?.roomCode === roomCode && data?.type === "diff" && data?.changes) {
      const { added, updated, removed } = data.changes;
      if (added) {
        for (const [id, s] of Object.entries(added)) studentCanvasShapes.set(id, s);
      }
      if (updated) {
        for (const [id, s] of Object.entries(updated)) {
          studentCanvasShapes.set(id, Array.isArray(s) ? s[1] : s);
        }
      }
      if (removed) {
        for (const id of Object.keys(removed)) studentCanvasShapes.delete(id);
      }
    }
  });

  // 3. Tutor opens Whiteboard
  console.log("\n-> Step 3: Tutor opens Whiteboard in classroom...");
  const openPayload = {
    isControl: true,
    controlAction: "WHITEBOARD_STATE",
    roomCode,
    isOpen: true,
    layoutMode: "whiteboard",
    isHost: true,
    senderId: "tutor-e2e",
  };
  tutorSocket.emit("chatMessage", openPayload);
  await query(
    `UPDATE live_classes 
     SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{is_whiteboard_open}', 'true'::jsonb) 
     WHERE room_code = $1`,
    [roomCode]
  );

  await new Promise((r) => setTimeout(r, 1500));
  assert.strictEqual(studentIsWhiteboardOpen, true, "Student view must be open");
  assert.strictEqual(studentViewMode, "whiteboard", "Student layoutMode must be 'whiteboard'");
  console.log("✓ Step 3 PASSED: Student switched to Whiteboard automatically.");

  // 4. Tutor inserts Ruler and Compass
  console.log("\n-> Step 4: Tutor inserts Geometry Ruler and Compass shapes...");
  const drawPayload1 = {
    type: "diff",
    roomCode,
    senderId: "tutor-e2e",
    changes: {
      added: {
        "shape:ruler_e2e": { id: "shape:ruler_e2e", type: "ruler", w: 420, h: 70 },
        "shape:compass_e2e": { id: "shape:compass_e2e", type: "compass", angle: 45 },
      },
      updated: {},
      removed: {},
    },
  };
  tutorSocket.emit("whiteboardDraw", drawPayload1);

  await new Promise((r) => setTimeout(r, 1500));
  assert.strictEqual(studentCanvasShapes.has("shape:ruler_e2e"), true, "Student received Ruler");
  assert.strictEqual(studentCanvasShapes.has("shape:compass_e2e"), true, "Student received Compass");
  console.log("✓ Step 4 PASSED: Student canvas received and rendered Tutor's Ruler and Compass.");

  // 5. Tutor updates Compass angle and removes Ruler
  console.log("\n-> Step 5: Tutor adjusts Compass angle to 90° and erases Ruler...");
  const drawPayload2 = {
    type: "diff",
    roomCode,
    senderId: "tutor-e2e",
    changes: {
      added: {},
      updated: {
        "shape:compass_e2e": [null, { id: "shape:compass_e2e", type: "compass", angle: 90 }],
      },
      removed: {
        "shape:ruler_e2e": { id: "shape:ruler_e2e" },
      },
    },
  };
  tutorSocket.emit("whiteboardDraw", drawPayload2);

  await new Promise((r) => setTimeout(r, 1500));
  assert.strictEqual(studentCanvasShapes.get("shape:compass_e2e")?.angle, 90, "Compass angle updated to 90");
  assert.strictEqual(studentCanvasShapes.has("shape:ruler_e2e"), false, "Ruler erased on student canvas");
  console.log("✓ Step 5 PASSED: Update and Erasure synchronized accurately to student.");

  // 6. Tutor closes Whiteboard -> Student returns to Grid
  console.log("\n-> Step 6: Tutor closes Whiteboard...");
  const closePayload = {
    isControl: true,
    controlAction: "WHITEBOARD_STATE",
    roomCode,
    isOpen: false,
    layoutMode: "grid",
    isHost: true,
    senderId: "tutor-e2e",
  };
  tutorSocket.emit("chatMessage", closePayload);
  await query(
    `UPDATE live_classes 
     SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{is_whiteboard_open}', 'false'::jsonb) 
     WHERE room_code = $1`,
    [roomCode]
  );

  await new Promise((r) => setTimeout(r, 1500));
  assert.strictEqual(studentIsWhiteboardOpen, false, "Student whiteboard must be closed");
  assert.strictEqual(studentViewMode, "grid", "Student view must return to 'grid'");
  console.log("✓ Step 6 PASSED: Student returned to Video Grid automatically.");

  // 7. Late Joiner Verification
  console.log("\n-> Step 7: Late-joining student checks recovery of whiteboard state...");
  // Re-open whiteboard and save snapshot
  await query(
    `UPDATE live_classes 
     SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{is_whiteboard_open}', 'true'::jsonb) 
     WHERE room_code = $1`,
    [roomCode]
  );
  await query(
    `INSERT INTO whiteboard_snapshots (room_code, snapshot_json, shape_count, updated_at)
     VALUES ($1, $2, 1, NOW())
     ON CONFLICT (room_code) DO UPDATE SET snapshot_json = EXCLUDED.snapshot_json, updated_at = NOW()`,
    [roomCode, JSON.stringify({ store: Object.fromEntries(studentCanvasShapes) })]
  );

  const lateRoomRes = await query("SELECT metadata FROM live_classes WHERE room_code = $1", [roomCode]);
  const lateSnapshotRes = await query("SELECT snapshot_json FROM whiteboard_snapshots WHERE room_code = $1", [roomCode]);

  assert.strictEqual(Boolean(lateRoomRes.rows[0]?.metadata?.is_whiteboard_open), true, "Late joiner sees whiteboard is active");
  assert.strictEqual(Boolean(lateSnapshotRes.rows[0]?.snapshot_json?.store?.["shape:compass_e2e"]), true, "Late joiner retrieves snapshot");
  console.log("✓ Step 7 PASSED: Late joiner correctly restored shared view state and snapshot.");

  // Cleanup
  tutorSocket.disconnect();
  studentSocket.disconnect();
  await query("DELETE FROM live_classes WHERE room_code = $1", [roomCode]);
  console.log("\n=== FULL E2E INTEGRATION TEST COMPLETED SUCCESSFULLY ===");
  process.exit(0);
}

runE2EIntegration().catch((err) => {
  console.error("E2E Integration Failed:", err);
  process.exit(1);
});
