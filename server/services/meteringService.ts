import crypto from "node:crypto";
import { query } from "../db";
import { logger } from "./logger";
import { getSessionsCollection } from "../db/mongo";
import { dispatchWebhookEvent } from "./webhookService";

// ============================================================================
// USAGE METERING SERVICE — AUDITABLE PARTICIPANT-MINUTE ACCOUNTING
// ============================================================================
// Rule:
// 1. Participant duration = max(0, left_at - joined_at) in seconds.
// 2. Whole billed minutes = ceil(duration_seconds / 60). Sessions with duration > 0
//    have minimum 1 billed minute; 0s has 0 billed minutes.
// 3. Idempotent ledger insertion ensures duplicate reconciliation calls never double-count.
// ============================================================================

export const DEFAULT_ABANDONED_IDLE_MINUTES = 30;
export const DEFAULT_UNSTARTED_EMPTY_ROOM_HOURS = 24;
export const DEFAULT_MAX_ROOM_DURATION_HOURS = 24;
export const FIRST_PARTY_ORG_ID = "00000000-0000-0000-0000-000000000001";

export interface ReconcileAbandonedRoomsOptions {
  idleMinutes?: number;
  maxDurationHours?: number;
  unstartedGraceHours?: number;
}

export interface ReconcileAbandonedRoomsResult {
  sweptRooms: number;
  reconciledSessions: number;
  roomCodes: string[];
}

export interface UsageLedgerEntry {
  organizationId: string;
  roomId?: string | null;
  roomCode: string;
  participantId: string;
  participantName?: string | null;
  role: string;
  joinedAt: Date;
  leftAt: Date;
}

export interface UsageSummary {
  organizationId: string;
  totalBilledMinutes: number;
  totalParticipantSessions: number;
  totalDistinctRooms: number;
  breakdownByRole: Record<string, number>;
  timeWindow: {
    startDate: string;
    endDate: string;
  };
}

/**
 * Calculates whole billed minutes from duration in seconds using ceiling rule.
 */
export function calculateBilledMinutes(durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  return Math.ceil(durationSeconds / 60);
}

/**
 * Generates an idempotent hash key for a specific participant session.
 */
export function generateIdempotencyKey(
  organizationId: string,
  roomCode: string,
  participantId: string,
  joinedAt: Date
): string {
  const raw = `${organizationId}:${roomCode.toLowerCase()}:${participantId}:${joinedAt.toISOString()}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 64);
}

/**
 * Records a completed participant session into the auditable organization usage ledger.
 * Completely idempotent: if the record was already committed, ON CONFLICT DO NOTHING takes effect.
 */
export async function recordSessionUsage(entry: UsageLedgerEntry): Promise<{ recorded: boolean; billedMinutes: number }> {
  try {
    const durationSeconds = Math.max(0, Math.floor((entry.leftAt.getTime() - entry.joinedAt.getTime()) / 1000));
    const billedMinutes = calculateBilledMinutes(durationSeconds);
    const idempotencyKey = generateIdempotencyKey(
      entry.organizationId,
      entry.roomCode,
      entry.participantId,
      entry.joinedAt
    );

    const insertSql = `
      INSERT INTO organization_usage_ledger (
        organization_id, room_id, room_code, participant_id, participant_name,
        role, joined_at, left_at, duration_seconds, billed_minutes, idempotency_key
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id;
    `;

    const res = await query(insertSql, [
      entry.organizationId,
      entry.roomId || null,
      entry.roomCode.toLowerCase(),
      entry.participantId,
      entry.participantName || null,
      entry.role,
      entry.joinedAt.toISOString(),
      entry.leftAt.toISOString(),
      durationSeconds,
      billedMinutes,
      idempotencyKey,
    ]);

    const wasInserted = res.rows.length > 0;
    return { recorded: wasInserted, billedMinutes };
  } catch (err: any) {
    logger.error("Failed to record session usage into ledger", {
      organizationId: entry.organizationId,
      roomCode: entry.roomCode,
      error: err.message,
    });
    return { recorded: false, billedMinutes: 0 };
  }
}

/**
 * Reconciles participant sessions when a room ends or participants leave.
 * Marks unclosed room_participants as left and commits ledger records idempotently.
 */
export async function reconcileRoomSessions(
  organizationId: string,
  roomCode: string,
  endedAt: Date = new Date(),
  roomId?: string
): Promise<{ reconciledCount: number }> {
  try {
    // 1. Fetch all participants in this room who have not been marked as left or need metering
    const participantsRes = await query(
      `SELECT id, room_code, display_name, role, joined_at, left_at
       FROM room_participants
       WHERE room_code = $1;`,
      [roomCode.toLowerCase()]
    );

    let reconciledCount = 0;

    for (const p of participantsRes.rows) {
      const joinedAt = new Date(p.joined_at);
      const effectiveLeftAt = p.left_at ? new Date(p.left_at) : endedAt;

      // If left_at was null, stamp it now
      if (!p.left_at) {
        await query(
          "UPDATE room_participants SET left_at = $1 WHERE id = $2;",
          [effectiveLeftAt.toISOString(), p.id]
        );
      }

      // Record to immutable usage ledger idempotently
      const result = await recordSessionUsage({
        organizationId,
        roomId: roomId || null,
        roomCode,
        participantId: p.id,
        participantName: p.display_name,
        role: p.role,
        joinedAt,
        leftAt: effectiveLeftAt,
      });

      if (result.recorded) {
        reconciledCount++;
      }
    }

    return { reconciledCount };
  } catch (err: any) {
    logger.error("Failed to reconcile room sessions", { organizationId, roomCode, error: err.message });
    return { reconciledCount: 0 };
  }
}

/**
 * Reconciles stale participant sessions for ended or expired rooms.
 * Designed for background periodic reaper: ensures no active call is prematurely killed.
 */
export async function sweepStaleSessions(): Promise<{ sweptRooms: number; reconciledSessions: number }> {
  try {
    // Identify rooms marked inactive where participants still have left_at IS NULL
    const staleRoomsRes = await query(
      `SELECT DISTINCT lc.id, lc.organization_id, lc.room_code, lc.ended_at
       FROM live_classes lc
       JOIN room_participants rp ON lc.room_code = rp.room_code
       WHERE lc.is_active = FALSE AND rp.left_at IS NULL AND lc.organization_id IS NOT NULL;`
    );

    let sweptRooms = 0;
    let reconciledSessions = 0;

    for (const r of staleRoomsRes.rows) {
      const endedAt = r.ended_at ? new Date(r.ended_at) : new Date();
      const res = await reconcileRoomSessions(r.organization_id, r.room_code, endedAt, r.id);
      sweptRooms++;
      reconciledSessions += res.reconciledCount;
    }

    if (sweptRooms > 0) {
      logger.info("Session reaper completed sweep", { sweptRooms, reconciledSessions });
    }

    return { sweptRooms, reconciledSessions };
  } catch (err: any) {
    logger.error("Error running session reaper sweep", { error: err.message });
    return { sweptRooms: 0, reconciledSessions: 0 };
  }
}

/**
 * Policy & Reconciliation for Abandoned Rooms:
 * A room with is_active = TRUE is considered abandoned and eligible for safe automated cleanup if:
 * 1. Criterion A (Idle Empty Room): Total participants = 0 AND created_at < NOW() - idleMinutes (default 30m)
 * 2. Criterion B (All Participants Left): Total participants > 0 AND active participants = 0 AND latest left_at < NOW() - idleMinutes (default 30m)
 * 3. Criterion C (Exceeded Max Duration): started_at < NOW() - maxDurationHours (default 24h)
 *
 * Guarantees:
 * - Genuinely active meetings (with at least one participant whose left_at is NULL and started within max duration) are strictly preserved.
 * - Recently created meetings (< idleMinutes) are preserved.
 * - Meetings with recent departures (< idleMinutes) are preserved to allow reconnection.
 * - Concurrency-safe: Uses atomic UPDATE ... WHERE id = $1 AND is_active = TRUE so concurrent reaper workers do not collide or double-reconcile.
 * - Metering records committed to organization_usage_ledger idempotently.
 * - Outbound room.ended webhook dispatched if organization configured.
 */
export async function reconcileAbandonedRooms(
  options: ReconcileAbandonedRoomsOptions = {}
): Promise<ReconcileAbandonedRoomsResult> {
  const idleMinutes = options.idleMinutes ?? DEFAULT_ABANDONED_IDLE_MINUTES;
  const maxDurationHours = options.maxDurationHours ?? DEFAULT_MAX_ROOM_DURATION_HOURS;
  const unstartedGraceHours =
    options.unstartedGraceHours !== undefined
      ? options.unstartedGraceHours
      : options.idleMinutes !== undefined
      ? options.idleMinutes / 60
      : DEFAULT_UNSTARTED_EMPTY_ROOM_HOURS;

  try {
    const candidateQuery = `
      WITH room_stats AS (
        SELECT 
          lc.id,
          lc.organization_id,
          lc.room_code,
          lc.started_at,
          lc.created_at,
          lc.metadata,
          COUNT(rp.id)::int as total_participants,
          COUNT(CASE WHEN rp.id IS NOT NULL AND rp.left_at IS NULL THEN 1 END)::int as active_participants,
          MAX(rp.left_at) as latest_left_at
        FROM live_classes lc
        LEFT JOIN room_participants rp ON lc.room_code = rp.room_code
        WHERE lc.is_active = TRUE
        GROUP BY lc.id, lc.organization_id, lc.room_code, lc.started_at, lc.created_at, lc.metadata
      )
      SELECT 
        id, organization_id, room_code, started_at, created_at, metadata,
        total_participants, active_participants, latest_left_at,
        CASE 
          WHEN started_at < NOW() - ($2 || ' hours')::interval THEN 'max_duration_exceeded'
          WHEN total_participants = 0 AND created_at < NOW() - ($3 || ' hours')::interval THEN 'idle_no_participants'
          WHEN total_participants > 0 AND active_participants = 0 AND latest_left_at < NOW() - ($1 || ' minutes')::interval THEN 'idle_all_left'
          ELSE NULL
        END as abandonment_reason
      FROM room_stats
      WHERE 
        (started_at < NOW() - ($2 || ' hours')::interval)
        OR (total_participants = 0 AND created_at < NOW() - ($3 || ' hours')::interval)
        OR (total_participants > 0 AND active_participants = 0 AND latest_left_at < NOW() - ($1 || ' minutes')::interval);
    `;

    const res = await query(candidateQuery, [idleMinutes, maxDurationHours, unstartedGraceHours]);
    let sweptRooms = 0;
    let reconciledSessions = 0;
    const roomCodes: string[] = [];

    for (const room of res.rows) {
      // Determine effective ended_at
      let effectiveEndedAt = new Date();
      if (room.abandonment_reason === "idle_all_left" && room.latest_left_at) {
        effectiveEndedAt = new Date(room.latest_left_at);
      } else if (room.abandonment_reason === "max_duration_exceeded" && room.started_at) {
        effectiveEndedAt = new Date(new Date(room.started_at).getTime() + maxDurationHours * 3600 * 1000);
      }

      // Concurrency-safe atomic transition: only update if still active
      const updateRes = await query(
        `UPDATE live_classes 
         SET is_active = FALSE, ended_at = $1 
         WHERE id = $2 AND is_active = TRUE 
         RETURNING id;`,
        [effectiveEndedAt.toISOString(), room.id]
      );

      // If another process or user action already marked it inactive, skip
      if (updateRes.rows.length === 0) {
        continue;
      }

      sweptRooms++;
      roomCodes.push(room.room_code);

      // Stamp any dangling unclosed participants
      await query(
        `UPDATE room_participants 
         SET left_at = $1 
         WHERE room_code = $2 AND left_at IS NULL;`,
        [effectiveEndedAt.toISOString(), room.room_code]
      );

      // Reconcile into immutable organization_usage_ledger idempotently
      const orgId = room.organization_id || FIRST_PARTY_ORG_ID;
      const sessionResult = await reconcileRoomSessions(orgId, room.room_code, effectiveEndedAt, room.id);
      reconciledSessions += sessionResult.reconciledCount;

      // Update MongoDB session status if configured
      try {
        const sessionsCol = getSessionsCollection();
        if (sessionsCol) {
          const sessionId = String(room.metadata?.session_id || room.id);
          await sessionsCol.updateOne(
            { sessionId },
            { $set: { status: "ended", endedAt: effectiveEndedAt, abandonmentReason: room.abandonment_reason } }
          );
        }
      } catch (mongoErr: any) {
        // Non-blocking log
        logger.warn("Failed to mark MongoDB session as ended during abandoned room reconciliation", {
          roomCode: room.room_code,
          error: mongoErr.message,
        });
      }

      // Dispatch outbound webhook if organization is set
      if (room.organization_id) {
        try {
          dispatchWebhookEvent(room.organization_id, "room.ended", {
            roomId: room.id,
            roomCode: room.room_code,
            endedAt: effectiveEndedAt.toISOString(),
            reason: room.abandonment_reason,
          }).catch(() => {});
        } catch (_) {}
      }
    }

    if (sweptRooms > 0) {
      logger.info("Abandoned room reconciliation completed", { sweptRooms, reconciledSessions, roomCodes });
    }

    return { sweptRooms, reconciledSessions, roomCodes };
  } catch (err: any) {
    logger.error("Error during abandoned room reconciliation", { error: err.message });
    return { sweptRooms: 0, reconciledSessions: 0, roomCodes: [] };
  }
}


/**
 * Queries aggregated organization usage within a specified time window.
 */
export async function getOrganizationUsageSummary(
  organizationId: string,
  startDate?: string,
  endDate?: string
): Promise<UsageSummary> {
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 3600 * 1000); // Default: past 30 days
  const end = endDate ? new Date(endDate) : new Date();

  const aggSql = `
    SELECT 
      COALESCE(SUM(billed_minutes), 0)::int as total_billed_minutes,
      COUNT(*)::int as total_sessions,
      COUNT(DISTINCT room_code)::int as total_distinct_rooms
    FROM organization_usage_ledger
    WHERE organization_id = $1 AND joined_at >= $2 AND joined_at <= $3;
  `;

  const roleSql = `
    SELECT role, COALESCE(SUM(billed_minutes), 0)::int as minutes
    FROM organization_usage_ledger
    WHERE organization_id = $1 AND joined_at >= $2 AND joined_at <= $3
    GROUP BY role;
  `;

  const [aggRes, roleRes] = await Promise.all([
    query(aggSql, [organizationId, start.toISOString(), end.toISOString()]),
    query(roleSql, [organizationId, start.toISOString(), end.toISOString()]),
  ]);

  const aggRow = aggRes.rows[0];
  const breakdownByRole: Record<string, number> = {};
  for (const r of roleRes.rows) {
    breakdownByRole[r.role] = r.minutes;
  }

  return {
    organizationId,
    totalBilledMinutes: aggRow?.total_billed_minutes || 0,
    totalParticipantSessions: aggRow?.total_sessions || 0,
    totalDistinctRooms: aggRow?.total_distinct_rooms || 0,
    breakdownByRole,
    timeWindow: {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    },
  };
}
