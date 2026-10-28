import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { pool, query } from "../server/db";
import {
  reconcileAbandonedRooms,
  DEFAULT_ABANDONED_IDLE_MINUTES,
  DEFAULT_MAX_ROOM_DURATION_HOURS,
  FIRST_PARTY_ORG_ID,
} from "../server/services/meteringService";

describe("Phase 7 Checkpoint 2: Abandoned-Room Reconciliation Suite", () => {
  let testOrgId: string;
  const testRoomCodes: string[] = [];

  before(async () => {
    // Create dedicated test organization for isolation
    const orgRes = await query(
      `INSERT INTO organizations (name, slug, status)
       VALUES ('Reconciliation Test Org', 'reconcile-test-org-' || substr(md5(random()::text), 1, 8), 'active')
       RETURNING id;`
    );
    testOrgId = orgRes.rows[0].id;
  });

  after(async () => {
    // Clean up created test rooms, participants, and test organization
    if (testRoomCodes.length > 0) {
      await query("DELETE FROM organization_usage_ledger WHERE room_code = ANY($1);", [testRoomCodes]);
      await query("DELETE FROM room_participants WHERE room_code = ANY($1);", [testRoomCodes]);
      await query("DELETE FROM live_classes WHERE room_code = ANY($1);", [testRoomCodes]);
    }
    if (testOrgId) {
      await query("DELETE FROM organizations WHERE id = $1;", [testOrgId]);
    }
    await pool.end();
  });

  it("RECON-01: Genuinely active room with currently connected participant is strictly preserved", async () => {
    const roomCode = "test-active-" + crypto.randomBytes(4).toString("hex");
    testRoomCodes.push(roomCode);

    // Create room started 10 minutes ago
    await query(
      `INSERT INTO live_classes (organization_id, room_code, title, is_active, started_at, created_at)
       VALUES ($1, $2, 'Active Meeting', TRUE, NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '10 minutes');`,
      [testOrgId, roomCode]
    );

    // Add active participant (left_at IS NULL)
    await query(
      `INSERT INTO room_participants (organization_id, room_code, display_name, role, joined_at, left_at)
       VALUES ($1, $2, 'Active Tutor', 'tutor', NOW() - INTERVAL '10 minutes', NULL);`,
      [testOrgId, roomCode]
    );

    // Run reconciliation
    const result = await reconcileAbandonedRooms({ idleMinutes: 30, maxDurationHours: 24 });
    assert.strictEqual(result.roomCodes.includes(roomCode), false, "Active room must NOT be reconciled");

    // Verify room is still active in DB
    const check = await query("SELECT is_active FROM live_classes WHERE room_code = $1;", [roomCode]);
    assert.strictEqual(check.rows[0].is_active, true, "Room must remain active");
  });

  it("RECON-02: Stale empty room (> 30m idle, 0 participants) is safely reconciled", async () => {
    const roomCode = "test-empty-" + crypto.randomBytes(4).toString("hex");
    testRoomCodes.push(roomCode);

    // Created 45 minutes ago with zero participants ever joining
    await query(
      `INSERT INTO live_classes (organization_id, room_code, title, is_active, started_at, created_at)
       VALUES ($1, $2, 'Abandoned Empty Room', TRUE, NOW() - INTERVAL '45 minutes', NOW() - INTERVAL '45 minutes');`,
      [testOrgId, roomCode]
    );

    const result = await reconcileAbandonedRooms({ idleMinutes: 30, maxDurationHours: 24 });
    assert.ok(result.roomCodes.includes(roomCode), "Stale empty room must be reconciled");

    // Verify room is marked inactive
    const check = await query("SELECT is_active, ended_at FROM live_classes WHERE room_code = $1;", [roomCode]);
    assert.strictEqual(check.rows[0].is_active, false, "Room must be marked inactive");
    assert.ok(check.rows[0].ended_at !== null, "ended_at must be populated");
  });

  it("RECON-03: Stale room where all participants left (> 30m ago) is reconciled with accurate metering", async () => {
    const roomCode = "test-departed-" + crypto.randomBytes(4).toString("hex");
    testRoomCodes.push(roomCode);

    // Room created 60 minutes ago
    await query(
      `INSERT INTO live_classes (organization_id, room_code, title, is_active, started_at, created_at)
       VALUES ($1, $2, 'Departed Meeting', TRUE, NOW() - INTERVAL '60 minutes', NOW() - INTERVAL '60 minutes');`,
      [testOrgId, roomCode]
    );

    // Participant joined 60m ago, left 40m ago (session duration = 20 mins)
    await query(
      `INSERT INTO room_participants (organization_id, room_code, display_name, role, joined_at, left_at)
       VALUES ($1, $2, 'Departed Student', 'student', NOW() - INTERVAL '60 minutes', NOW() - INTERVAL '40 minutes');`,
      [testOrgId, roomCode]
    );

    const result = await reconcileAbandonedRooms({ idleMinutes: 30, maxDurationHours: 24 });
    assert.ok(result.roomCodes.includes(roomCode), "Room with all participants left > 30m must be swept");

    // Verify room status
    const check = await query("SELECT is_active, ended_at FROM live_classes WHERE room_code = $1;", [roomCode]);
    assert.strictEqual(check.rows[0].is_active, false);

    // Verify usage ledger recorded
    const ledger = await query(
      "SELECT billed_minutes, duration_seconds FROM organization_usage_ledger WHERE room_code = $1;",
      [roomCode]
    );
    assert.strictEqual(ledger.rows.length, 1, "Must have exactly 1 ledger record");
    assert.strictEqual(ledger.rows[0].billed_minutes, 20, "20-minute session must equal 20 billed minutes");
  });

  it("RECON-04: Recently updated room (< 30m idle) is preserved to allow reconnection", async () => {
    const roomCode = "test-recent-left-" + crypto.randomBytes(4).toString("hex");
    testRoomCodes.push(roomCode);

    // Room created 20 minutes ago, participant stepped out 5 minutes ago
    await query(
      `INSERT INTO live_classes (organization_id, room_code, title, is_active, started_at, created_at)
       VALUES ($1, $2, 'Recent Reconnect Room', TRUE, NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '20 minutes');`,
      [testOrgId, roomCode]
    );

    await query(
      `INSERT INTO room_participants (organization_id, room_code, display_name, role, joined_at, left_at)
       VALUES ($1, $2, 'Temporarily Away Tutor', 'tutor', NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '5 minutes');`,
      [testOrgId, roomCode]
    );

    const result = await reconcileAbandonedRooms({ idleMinutes: 30, maxDurationHours: 24 });
    assert.strictEqual(result.roomCodes.includes(roomCode), false, "Room with recent departure (<30m) must be preserved");

    const check = await query("SELECT is_active FROM live_classes WHERE room_code = $1;", [roomCode]);
    assert.strictEqual(check.rows[0].is_active, true, "Room must remain active for reconnection window");
  });

  it("RECON-05: Room exceeding max duration cap (> 24h) is automatically closed and metered", async () => {
    const roomCode = "test-over-24h-" + crypto.randomBytes(4).toString("hex");
    testRoomCodes.push(roomCode);

    // Meeting started 26 hours ago with an unclosed participant session
    await query(
      `INSERT INTO live_classes (organization_id, room_code, title, is_active, started_at, created_at)
       VALUES ($1, $2, 'Runaway 26h Room', TRUE, NOW() - INTERVAL '26 hours', NOW() - INTERVAL '26 hours');`,
      [testOrgId, roomCode]
    );

    await query(
      `INSERT INTO room_participants (organization_id, room_code, display_name, role, joined_at, left_at)
       VALUES ($1, $2, 'Ghost Student', 'student', NOW() - INTERVAL '26 hours', NULL);`,
      [testOrgId, roomCode]
    );

    const result = await reconcileAbandonedRooms({ idleMinutes: 30, maxDurationHours: 24 });
    assert.ok(result.roomCodes.includes(roomCode), "Runaway room exceeding 24h must be closed");

    // Verify room ended
    const check = await query("SELECT is_active FROM live_classes WHERE room_code = $1;", [roomCode]);
    assert.strictEqual(check.rows[0].is_active, false);

    // Verify participant was stamped
    const pCheck = await query("SELECT left_at FROM room_participants WHERE room_code = $1;", [roomCode]);
    assert.ok(pCheck.rows[0].left_at !== null, "Participant left_at must be stamped");

    // Verify usage ledger recorded capped duration
    const ledger = await query(
      "SELECT billed_minutes FROM organization_usage_ledger WHERE room_code = $1;",
      [roomCode]
    );
    assert.strictEqual(ledger.rows.length, 1, "Must be metered in ledger");
    assert.ok(ledger.rows[0].billed_minutes > 0, "Billed minutes must be positive");
  });

  it("RECON-06: Repeated cleanup execution is completely idempotent with zero side effects", async () => {
    // Run reconciliation again immediately
    const repeatResult = await reconcileAbandonedRooms({ idleMinutes: 30, maxDurationHours: 24 });

    // None of the already-reconciled test rooms should be processed again
    for (const code of testRoomCodes) {
      assert.strictEqual(
        repeatResult.roomCodes.includes(code),
        false,
        `Room ${code} must not be re-swept on repeated call`
      );
    }

    // Verify ledger row counts did not duplicate
    const ledgerCount = await query(
      "SELECT COUNT(*)::int as count FROM organization_usage_ledger WHERE organization_id = $1;",
      [testOrgId]
    );
    // Only 2 rooms had participants (RECON-03 and RECON-05)
    assert.strictEqual(ledgerCount.rows[0].count, 2, "Ledger records must remain exactly 2 with no duplicates");
  });

  it("RECON-07: Concurrent cleanup runs execute safely without race conditions or deadlocks", async () => {
    // Create 3 stale rooms simultaneously
    const concRooms: string[] = [];
    for (let i = 0; i < 3; i++) {
      const code = "test-conc-room-" + i + "-" + crypto.randomBytes(3).toString("hex");
      concRooms.push(code);
      testRoomCodes.push(code);
      await query(
        `INSERT INTO live_classes (organization_id, room_code, title, is_active, started_at, created_at)
         VALUES ($1, $2, 'Concurrent Test Room', TRUE, NOW() - INTERVAL '50 minutes', NOW() - INTERVAL '50 minutes');`,
        [testOrgId, code]
      );
    }

    // Launch 3 simultaneous reconciliation calls in parallel
    const [res1, res2, res3] = await Promise.all([
      reconcileAbandonedRooms({ idleMinutes: 30, maxDurationHours: 24 }),
      reconcileAbandonedRooms({ idleMinutes: 30, maxDurationHours: 24 }),
      reconcileAbandonedRooms({ idleMinutes: 30, maxDurationHours: 24 }),
    ]);

    // Sum of times each room was swept across all 3 workers must be EXACTLY 1!
    const allSweptCodes = [...res1.roomCodes, ...res2.roomCodes, ...res3.roomCodes];
    for (const code of concRooms) {
      const occurrences = allSweptCodes.filter((c) => c === code).length;
      assert.strictEqual(occurrences, 1, `Room ${code} must be swept exactly once across concurrent workers`);
    }

    // Verify all 3 rooms are now inactive
    const check = await query(
      "SELECT COUNT(*)::int as count FROM live_classes WHERE room_code = ANY($1) AND is_active = FALSE;",
      [concRooms]
    );
    assert.strictEqual(check.rows[0].count, 3, "All concurrent test rooms must be successfully marked inactive");
  });
});
