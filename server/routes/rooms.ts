import { Router, Request, Response } from "express";
import crypto from "crypto";
import { query } from "../db";
import { requireAuth, authMiddleware } from "./auth";
import { getChatCollection, getSessionsCollection } from "../db/mongo";
import { invalidateRoomCache } from "../middleware/roomAuth";

export const roomsRouter = Router();

/**
 * Generate a cryptographically secure random room code (e.g. ptq-rtvq-rox)
 */
function generateSecureRoomCode(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  const getChunk = (len: number) => {
    const bytes = crypto.randomBytes(len);
    let str = "";
    for (let i = 0; i < len; i++) {
      str += chars[bytes[i] % chars.length];
    }
    return str;
  };
  return `${getChunk(3)}-${getChunk(4)}-${getChunk(3)}`;
}

function sanitizeCode(code: any): string {
  return String(Array.isArray(code) ? code[0] : (code || "")).trim().toLowerCase();
}

/**
 * Checks whether the given user is the authoritative host/owner of the room.
 */
export function isUserRoomHost(room: any, user: any): boolean {
  if (!room || !user) return false;
  const userId = user.id;
  if (user.role === "admin") {
    return true;
  }
  if (user.isParticipantToken && user.role === "tutor" && user.permissions?.isHost) {
    return true;
  }
  if (room.tutor_id && String(room.tutor_id) === String(userId)) {
    return true;
  }
  if (room.metadata?.tutor_id && String(room.metadata?.tutor_id) === String(userId)) {
    return true;
  }
  return false;
}

/**
 * GET /api/rooms/:roomCode/role
 * Returns { exists: boolean, isOwner: boolean, tutorId?: string, isActive?: boolean }
 */
roomsRouter.get("/:roomCode/role", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const sanitizedCode = sanitizeCode(roomCode);
    const user = (req as any).user;

    const roomRes = await query(
      "SELECT id, room_code, title, tutor_id, tutor_name, metadata, is_active FROM live_classes WHERE room_code = $1",
      [sanitizedCode]
    );

    const schedRes = await query(
      "SELECT id, room_code, title, tutor_id, status FROM class_schedules WHERE room_code = $1",
      [sanitizedCode]
    );

    if (roomRes.rows.length === 0 && schedRes.rows.length === 0) {
      return res.json({ exists: false, isOwner: false });
    }

    const room = roomRes.rows[0] || null;
    const sched = schedRes.rows[0] || null;

    let isOwner = false;
    if (user) {
      if (user.role === "admin") {
        isOwner = true;
      } else if (room && isUserRoomHost(room, user)) {
        isOwner = true;
      } else if (sched && String(sched.tutor_id) === String(user.id)) {
        isOwner = true;
      }
    }

    const tutorId = room?.tutor_id || sched?.tutor_id;
    const tutorName = room?.tutor_name || "Tutor";
    const isActive = Boolean(room?.is_active);

    return res.json({
      exists: true,
      isOwner,
      tutorId,
      tutorName,
      isActive,
      isScheduled: Boolean(sched),
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to get room role", details: err.message });
  }
});

/**
 * GET /api/rooms/:roomCode
 * Retrieves room status and metadata.
 * Returns 404 if the room does not exist or has ended.
 */
roomsRouter.get("/:roomCode", async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const sanitizedCode = sanitizeCode(roomCode);

    let result = await query(
      `SELECT id, room_code, title, tutor_id, tutor_name, is_active, is_live_streaming, metadata, started_at, ended_at, created_at 
       FROM live_classes 
       WHERE room_code = $1`,
      [sanitizedCode]
    );

    if (result.rows.length === 0) {
      const sched = await query(
        `SELECT id, room_code, title, tutor_id, scheduled_at, duration_minutes, status, created_at
         FROM class_schedules
         WHERE room_code = $1`,
        [sanitizedCode]
      );
      if (sched.rows.length === 0) {
        return res.status(404).json({ error: "Room not found", room: null });
      }
      const s = sched.rows[0];
      return res.json({
        room: {
          id: s.id,
          room_code: s.room_code,
          title: s.title,
          tutor_id: s.tutor_id,
          is_active: false,
          isScheduled: true,
          status: s.status,
          scheduled_at: s.scheduled_at,
          duration_minutes: s.duration_minutes,
        },
      });
    }

    const room = result.rows[0];
    if (!room.is_active) {
      if (room.ended_at) {
        return res.status(404).json({
          error: "Class has ended",
          room: {
            id: room.id,
            room_code: room.room_code,
            title: room.title,
            tutor_id: room.tutor_id,
            tutor_name: room.tutor_name,
            is_active: false,
            ended_at: room.ended_at,
          },
          isEnded: true,
        });
      }

      // Scheduled or unstarted room waiting for tutor
      return res.json({
        room: {
          ...room,
          is_active: false,
          isWaitingForHost: true,
        },
      });
    }

    return res.json({ room });
  } catch (err: any) {
    console.error("[Rooms GET Error]:", err.message);
    return res.status(500).json({ error: "Failed to get room", details: err.message });
  }
});

/**
 * POST /api/rooms/:roomCode/reactivate
 * Allows authenticated tutor/host to reopen an ended or reaped class they own.
 */
roomsRouter.post("/:roomCode/reactivate", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user || user.role !== "tutor") {
      return res.status(403).json({ error: "Only tutors are authorized to reactivate meetings", code: "FORBIDDEN" });
    }

    const { roomCode } = req.params;
    const sanitizedCode = sanitizeCode(roomCode);

    const roomRes = await query(
      "SELECT id, room_code, title, tutor_id, tutor_name, organization_id, metadata, is_active FROM live_classes WHERE room_code = $1;",
      [sanitizedCode]
    );

    if (roomRes.rows.length === 0) {
      return res.status(404).json({ error: "Room not found", code: "ROOM_NOT_FOUND" });
    }

    const room = roomRes.rows[0];
    const existingTutorId = room.tutor_id || room.metadata?.tutor_id;
    if (existingTutorId && String(existingTutorId) !== String(user.id)) {
      const userTenantId = user.tenant_id || user.organization_id;
      if (!room.organization_id || !userTenantId || String(room.organization_id) !== String(userTenantId)) {
        return res.status(403).json({ error: "Unauthorized: Only the room tutor or host organization can reactivate this meeting", code: "NOT_ROOM_OWNER" });
      }
    }

    const newSessionId = crypto.randomUUID();
    const updateRes = await query(
      `UPDATE live_classes
       SET is_active = TRUE, ended_at = NULL, started_at = NOW(),
           tutor_id = COALESCE(tutor_id, $3),
           tutor_name = COALESCE(tutor_name, $4),
           metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{session_id}', to_jsonb($2::text))
       WHERE id = $1
       RETURNING id, room_code, title, tutor_id, tutor_name, is_active, metadata;`,
      [room.id, newSessionId, user.id, user.full_name || user.name || "Tutor"]
    );

    // Initialize/sync active session in MongoDB
    const sessionsCol = getSessionsCollection();
    if (sessionsCol) {
      const now = new Date();
      await sessionsCol.updateOne(
        { sessionId: newSessionId },
        {
          $set: {
            sessionId: newSessionId,
            roomCode: sanitizedCode,
            tutorId: user.id,
            status: "active",
            isChatLocked: false,
            pinnedMessage: null,
            startedAt: now,
            endedAt: null,
          },
        },
        { upsert: true }
      );
    }

    return res.json({ success: true, room: updateRes.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to reactivate room", details: err.message });
  }
});

/**
 * POST /api/rooms
 * Creates or updates a room.
 * Strictly requires authentication and tutor role. Room ownership is strictly enforced.
 */
roomsRouter.post("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user || user.role !== "tutor") {
      return res.status(403).json({ error: "Only tutors are authorized to create or host meetings" });
    }

    const { title, is_active = true, is_live_streaming = false, metadata = {} } = req.body;
    const reqCode = req.body.room_code || req.body.roomCode;

    const finalRoomCode = (reqCode && typeof reqCode === "string" && reqCode.trim().length > 0)
      ? reqCode.trim().toLowerCase()
      : generateSecureRoomCode();

    if (!/^[a-z0-9-_]{3,50}$/.test(finalRoomCode)) {
      return res.status(400).json({
        error: "Invalid roomCode format. Must be 3-50 characters of lowercase letters, numbers, hyphens, or underscores.",
        code: "INVALID_ROOM_CODE_FORMAT",
      });
    }

    const roomTitle = (title && typeof title === "string" && title.trim().length > 0)
      ? title.trim()
      : `Class ${finalRoomCode}`;

    // Verify ownership if room already exists
    const existingRoomRes = await query(
      "SELECT id, tutor_id, organization_id, metadata, is_active FROM live_classes WHERE room_code = $1",
      [finalRoomCode]
    );

    if (existingRoomRes.rows.length > 0) {
      const existing = existingRoomRes.rows[0];
      const existingTutorId = existing.tutor_id || existing.metadata?.tutor_id;
      if (existingTutorId && String(existingTutorId) !== String(user.id)) {
        const userTenantId = user.tenant_id || user.organization_id;
        if (!existing.organization_id || !userTenantId || String(existing.organization_id) !== String(userTenantId)) {
          return res.status(403).json({ error: "Unauthorized: only the room owner can update this meeting" });
        }
      }
    }

    // Verify ownership if class schedule exists
    const schedRes = await query(
      "SELECT id, tutor_id FROM class_schedules WHERE room_code = $1",
      [finalRoomCode]
    );
    if (schedRes.rows.length > 0) {
      const sched = schedRes.rows[0];
      if (sched.tutor_id && String(sched.tutor_id) !== String(user.id) && user.role !== "admin") {
        return res.status(403).json({ error: "Unauthorized: only the host who scheduled this meeting can launch it" });
      }
    }

    const isTutorUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(user.id));
    let validTutorId: string | null = null;

    if (isTutorUUID) {
      // Ensure user exists in users table to satisfy foreign key constraint
      try {
        await query(
          `INSERT INTO users (id, email, full_name, role, auth_provider)
           VALUES ($1, $2, $3, 'tutor', 'google')
           ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;`,
          [user.id, user.email || `${user.id}@mathsy.in`, user.full_name || user.name || "Tutor"]
        );
        validTutorId = user.id;
      } catch (uErr) {
        // Fallback
      }
    }

    const sessionId = crypto.randomUUID();
    const metaObj = {
      ...(typeof metadata === "object" && metadata !== null ? metadata : {}),
      tutor_id: user.id,
      session_id: sessionId,
      is_chat_locked: false,
      pinned_message: null,
    };

    const upsertSql = `
      INSERT INTO live_classes (room_code, title, tutor_id, tutor_name, is_active, is_live_streaming, metadata, started_at, ended_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NULL)
      ON CONFLICT (room_code) DO UPDATE SET
        title = EXCLUDED.title,
        tutor_id = COALESCE(live_classes.tutor_id, EXCLUDED.tutor_id),
        tutor_name = COALESCE(live_classes.tutor_name, EXCLUDED.tutor_name),
        is_active = EXCLUDED.is_active,
        ended_at = CASE WHEN EXCLUDED.is_active THEN NULL ELSE live_classes.ended_at END,
        started_at = CASE WHEN EXCLUDED.is_active AND live_classes.is_active = FALSE THEN NOW() ELSE live_classes.started_at END,
        is_live_streaming = EXCLUDED.is_live_streaming,
        metadata = EXCLUDED.metadata
      RETURNING id, room_code, title, tutor_id, tutor_name, is_active, is_live_streaming, metadata, created_at;
    `;

    const result = await query(upsertSql, [
      finalRoomCode,
      roomTitle,
      validTutorId,
      user.full_name || user.name || "Tutor",
      is_active,
      is_live_streaming,
      JSON.stringify(metaObj),
    ]);

    // Initialize active session in MongoDB
    const sessionsCol = getSessionsCollection();
    if (sessionsCol) {
      const now = new Date();
      await sessionsCol.updateOne(
        { sessionId },
        {
          $set: {
            sessionId,
            roomCode: finalRoomCode,
            tutorId: user.id,
            status: "active",
            isChatLocked: false,
            pinnedMessage: null,
            startedAt: now,
            lastActivityAt: now,
            expireAt: new Date(now.getTime() + 24 * 3600 * 1000), // 24h fallback
          },
        },
        { upsert: true }
      );
    }

    return res.json({ room: { ...result.rows[0], sessionId } });
  } catch (err: any) {
    console.error("[Rooms Upsert Error]:", err.message);
    return res.status(500).json({ error: "Failed to upsert room", details: err.message });
  }
});

/**
 * POST /api/rooms/:roomCode/participants
 * Records participant entry into classroom.
 * Strictly requires authentication; derives user identity and role server-side.
 * Rejects nonexistent or inactive rooms with 404 (NEVER auto-creates room records).
 */
roomsRouter.post("/:roomCode/participants", requireAuth, async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const user = (req as any).user;
    const { camera_allowed = false } = req.body;

    const sanitizedCode = sanitizeCode(roomCode);

    // 1. Verify that the room exists and is active
    let roomRes = await query(
      "SELECT id, room_code, title, tutor_id, metadata, is_active, organization_id FROM live_classes WHERE room_code = $1",
      [sanitizedCode]
    );

    let room = roomRes.rows[0];

    // If not in live_classes, check class_schedules
    if (!room) {
      const sched = await query(
        "SELECT id, room_code, title, tutor_id, scheduled_at, duration_minutes, status FROM class_schedules WHERE room_code = $1",
        [sanitizedCode]
      );
      if (sched.rows.length > 0) {
        const s = sched.rows[0];
        await query(
          `INSERT INTO live_classes (room_code, title, tutor_id, tutor_name, is_active, metadata)
           VALUES ($1, $2, $3, 'Tutor', FALSE, $4)
           ON CONFLICT (room_code) DO NOTHING;`,
          [sanitizedCode, s.title, s.tutor_id, JSON.stringify({ isScheduled: true, scheduledAt: s.scheduled_at })]
        );
        roomRes = await query(
          "SELECT id, room_code, title, tutor_id, metadata, is_active, organization_id FROM live_classes WHERE room_code = $1",
          [sanitizedCode]
        );
        room = roomRes.rows[0];
      }
    }

    if (!room) {
      return res.status(404).json({ error: "Room not found or class has ended" });
    }

    // Determine host status
    let isHost = isUserRoomHost(room, user);
    if (!isHost && user) {
      const sched = await query("SELECT tutor_id FROM class_schedules WHERE room_code = $1", [sanitizedCode]);
      if (sched.rows.length > 0 && String(sched.rows[0].tutor_id) === String(user.id)) {
        isHost = true;
      }
    }

    // Auto-activate inactive room when host joins
    if (!room.is_active) {
      if (isHost) {
        await query(
          `UPDATE live_classes 
           SET is_active = TRUE, started_at = COALESCE(started_at, NOW()), ended_at = NULL 
           WHERE room_code = $1;`,
          [sanitizedCode]
        );
        await query(
          `UPDATE class_schedules 
           SET status = 'in_progress' 
           WHERE room_code = $1 AND status = 'scheduled';`,
          [sanitizedCode]
        );
        room.is_active = true;
      } else {
        return res.status(403).json({
          error: "Class has not started yet. Please wait for the host to start the call.",
          code: "CLASS_NOT_STARTED",
        });
      }
    }

    // 2. Identity and Role derivation:
    // Derives user_id and display_name strictly from the verified session, never trusting client parameters.
    const userId = user.id;
    const displayName = user.full_name || "Participant";

    // 3. Trustworthy Host check:
    // A user is ONLY a tutor/host if their verified user ID matches the room's tutor_id,
    // or if they present a verified participant token with role: tutor and isHost: true.
    // Client-supplied role and display names containing 'tutor' or 'host' confer ZERO privileges.
    if (user.isParticipantToken) {
      if (user.room_code && user.room_code.toLowerCase() !== sanitizedCode) {
        return res.status(403).json({ error: "Participant token is not valid for this room" });
      }
      if (user.tenant_id && room.organization_id && user.tenant_id !== room.organization_id) {
        return res.status(403).json({ error: "Participant token tenant does not match room tenant" });
      }
    }

    const role: "tutor" | "student" = isHost ? "tutor" : "student";
    const isUserUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(userId));

    // 3b. Google Meet Host Admission Gate:
    // Non-hosts cannot join until the room host has explicitly admitted them.
    if (!isHost) {
      const admissionRes = await query(
        `SELECT id, status FROM room_knocks 
         WHERE room_code = $1 
           AND (
             ($2::uuid IS NOT NULL AND user_id = $2::uuid) OR 
             ($3::text IS NOT NULL AND LOWER(email) = LOWER($3::text))
           )
           AND status = 'admitted'
         ORDER BY responded_at DESC LIMIT 1;`,
        [sanitizedCode, isUserUUID ? userId : null, user.email || null]
      );

      if (admissionRes.rows.length === 0) {
        return res.status(403).json({
          error: "Admission required: The meeting host must admit you before you can enter this call.",
          code: "ADMISSION_REQUIRED",
        });
      }
    }

    let validUserId: string | null = null;

    if (isUserUUID) {
      try {
        await query(
          `INSERT INTO users (id, email, full_name, role, auth_provider)
           VALUES ($1, $2, $3, $4, 'google')
           ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;`,
          [userId, user.email || `${userId}@mathsy.in`, displayName, role]
        );
        validUserId = userId;
      } catch (uErr) {
        // Fallback
      }
    }

    // 4. Mark prior active attendance for this user in this room as left to prevent ghost duplicates
    if (validUserId) {
      await query(
        `UPDATE room_participants 
         SET left_at = NOW() 
         WHERE room_code = $1 AND user_id = $2 AND left_at IS NULL;`,
        [sanitizedCode, validUserId]
      );
    } else {
      await query(
        `UPDATE room_participants 
         SET left_at = NOW() 
         WHERE room_code = $1 AND display_name = $2 AND left_at IS NULL;`,
        [sanitizedCode, displayName]
      );
    }

    // 5. Insert clean, verified participant record with organization_id
    const insertSql = `
      INSERT INTO room_participants (room_code, user_id, display_name, role, camera_allowed, organization_id, joined_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING id, room_code, user_id, display_name, role, camera_allowed, organization_id, joined_at;
    `;

    const result = await query(insertSql, [
      sanitizedCode,
      validUserId,
      displayName,
      role,
      isHost ? true : camera_allowed,
      room.organization_id || null,
    ]);

    const sessionId = String(room.metadata?.session_id || room.id);
    return res.json({
      participant: result.rows[0],
      isHost,
      sessionId,
      tutorId: room.tutor_id,
    });
  } catch (err: any) {
    console.error("[Participants Join Error]:", err.message);
    return res.status(500).json({ error: "Failed to record participant", details: err.message });
  }
});

/**
 * GET /api/rooms/:roomCode/participants
 * Fetches active participants currently in the room.
 */
roomsRouter.get("/:roomCode/participants", requireAuth, async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const sanitizedCode = sanitizeCode(roomCode);

    const result = await query(
      `SELECT DISTINCT ON (user_id) id, room_code, user_id, display_name, role, camera_allowed, joined_at, left_at
       FROM room_participants
       WHERE room_code = $1 AND left_at IS NULL
       ORDER BY user_id, joined_at DESC;`,
      [sanitizedCode]
    );

    return res.json({ participants: result.rows });
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to fetch participants", details: err.message });
  }
});

/**
 * POST /api/rooms/:roomCode/leave
 * Records participant departure.
 */
roomsRouter.post("/:roomCode/leave", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const sanitizedCode = sanitizeCode(roomCode);
    const user = (req as any).user;
    const userId = user?.id || req.body?.user_id;
    const displayName = req.body?.display_name;

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(userId));
    if (isUUID) {
      await query(
        `UPDATE room_participants
         SET left_at = NOW()
         WHERE room_code = $1 AND user_id = $2 AND left_at IS NULL;`,
        [sanitizedCode, userId]
      );
    } else if (displayName) {
      await query(
        `UPDATE room_participants
         SET left_at = NOW()
         WHERE room_code = $1 AND display_name = $2 AND left_at IS NULL;`,
        [sanitizedCode, displayName]
      );
    }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to record leave", details: err.message });
  }
});

/**
 * POST /api/rooms/:roomCode/knock
 * Non-host participant asks to join the room ("Knocking").
 */
roomsRouter.post("/:roomCode/knock", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const sanitizedCode = sanitizeCode(roomCode);
    const user = (req as any).user;

    let roomRes = await query(
      "SELECT id, room_code, title, tutor_id, tutor_name, metadata, is_active, ended_at FROM live_classes WHERE room_code = $1",
      [sanitizedCode]
    );

    let room = roomRes.rows[0];

    // If not in live_classes, check class_schedules
    if (!room) {
      const sched = await query(
        "SELECT id, room_code, title, tutor_id, scheduled_at, duration_minutes, status FROM class_schedules WHERE room_code = $1",
        [sanitizedCode]
      );
      if (sched.rows.length > 0) {
        const s = sched.rows[0];
        await query(
          `INSERT INTO live_classes (room_code, title, tutor_id, tutor_name, is_active, metadata)
           VALUES ($1, $2, $3, 'Tutor', FALSE, $4)
           ON CONFLICT (room_code) DO NOTHING;`,
          [sanitizedCode, s.title, s.tutor_id, JSON.stringify({ isScheduled: true, scheduledAt: s.scheduled_at })]
        );
        roomRes = await query(
          "SELECT id, room_code, title, tutor_id, tutor_name, metadata, is_active, ended_at FROM live_classes WHERE room_code = $1",
          [sanitizedCode]
        );
        room = roomRes.rows[0];
      }
    }

    if (!room) {
      return res.status(404).json({ error: "Class room does not exist", code: "ROOM_NOT_FOUND" });
    }

    let isHost = Boolean(user && isUserRoomHost(room, user));
    if (!isHost && user) {
      const sched = await query("SELECT tutor_id FROM class_schedules WHERE room_code = $1", [sanitizedCode]);
      if (sched.rows.length > 0 && String(sched.rows[0].tutor_id) === String(user.id)) {
        isHost = true;
      }
    }

    // If caller is host, no knock needed
    if (isHost) {
      return res.json({ status: "host", isHost: true, message: "Host joins directly without admission" });
    }

    // If room is inactive
    if (!room.is_active) {
      if (room.ended_at) {
        return res.status(404).json({ error: "This class session has ended", code: "ROOM_ENDED" });
      }
      // Room has not started yet -> keep student waiting inside lobby gracefully
      return res.json({
        status: "waiting_for_host",
        isWaitingForHost: true,
        message: "Class has not started yet. Waiting for tutor to start the class.",
        room_code: sanitizedCode,
      });
    }

    const userId = user?.id || req.body.user_id || null;
    const isUserUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(userId));
    let validUserId: string | null = null;

    const displayName = (user?.full_name || user?.name || req.body.display_name || "Guest").trim();
    const email = (user?.email || req.body.email || null)?.trim().toLowerCase() || null;
    const avatarUrl = user?.avatar_url || user?.avatarUrl || req.body.avatar_url || null;
    const role = (user?.role || req.body.role || "student") === "tutor" ? "tutor" : "student";

    if (isUserUUID) {
      try {
        await query(
          `INSERT INTO users (id, email, full_name, role, auth_provider)
           VALUES ($1, $2, $3, $4, 'google')
           ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;`,
          [userId, email || `${userId}@mathsy.in`, displayName, role]
        );
        validUserId = userId;
      } catch (uErr) {
        // Fallback
      }
    }

    // 1. Anti-spam check: If denied in the last 60 seconds, reject with cooldown
    const recentDenied = await query(
      `SELECT id, responded_at, EXTRACT(EPOCH FROM (NOW() - responded_at)) as seconds_ago
       FROM room_knocks
       WHERE room_code = $1
         AND (
           ($2::uuid IS NOT NULL AND user_id = $2::uuid) OR
           ($3::text IS NOT NULL AND LOWER(email) = LOWER($3::text))
         )
         AND status = 'denied'
         AND responded_at > NOW() - INTERVAL '60 seconds'
       ORDER BY responded_at DESC LIMIT 1;`,
      [sanitizedCode, validUserId, email]
    );

    if (recentDenied.rows.length > 0) {
      const secondsAgo = Math.floor(Number(recentDenied.rows[0].seconds_ago || 0));
      const cooldownRemaining = Math.max(1, 60 - secondsAgo);
      return res.status(429).json({
        error: `The meeting host declined your request. You can try again in ${cooldownRemaining} seconds.`,
        code: "KNOCK_COOLDOWN",
        cooldownRemaining,
      });
    }

    // 2. Check if already admitted
    const alreadyAdmitted = await query(
      `SELECT id, room_code, user_id, display_name, email, avatar_url, role, status, responded_at
       FROM room_knocks
       WHERE room_code = $1
         AND (
           ($2::uuid IS NOT NULL AND user_id = $2::uuid) OR
           ($3::text IS NOT NULL AND LOWER(email) = LOWER($3::text))
         )
         AND status = 'admitted'
       ORDER BY responded_at DESC LIMIT 1;`,
      [sanitizedCode, validUserId, email]
    );

    if (alreadyAdmitted.rows.length > 0) {
      return res.json({
        knock: alreadyAdmitted.rows[0],
        status: "admitted",
        isAdmitted: true,
      });
    }

    // 3. Check if there is already a pending knock
    const existingPending = await query(
      `SELECT id, room_code, user_id, display_name, email, avatar_url, role, status, created_at
       FROM room_knocks
       WHERE room_code = $1
         AND (
           ($2::uuid IS NOT NULL AND user_id = $2::uuid) OR
           ($3::text IS NOT NULL AND LOWER(email) = LOWER($3::text))
         )
         AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1;`,
      [sanitizedCode, validUserId, email]
    );

    if (existingPending.rows.length > 0) {
      return res.json({
        knock: existingPending.rows[0],
        status: "pending",
      });
    }

    // 4. Create new pending knock
    const insertRes = await query(
      `INSERT INTO room_knocks (room_code, user_id, display_name, email, avatar_url, role, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING id, room_code, user_id, display_name, email, avatar_url, role, status, created_at;`,
      [sanitizedCode, validUserId, displayName, email, avatarUrl, role]
    );

    return res.json({
      knock: insertRes.rows[0],
      status: "pending",
    });
  } catch (err: any) {
    console.error("[Knock Submit Error]:", err.message);
    return res.status(500).json({ error: "Failed to submit knock request", details: err.message });
  }
});

/**
 * GET /api/rooms/:roomCode/knock/:knockId
 * Checks status of participant's knock.
 */
roomsRouter.get("/:roomCode/knock/:knockId", async (req: Request, res: Response) => {
  try {
    const { roomCode, knockId } = req.params;
    const sanitizedCode = sanitizeCode(roomCode);

    const knockRes = await query(
      `SELECT id, room_code, user_id, display_name, email, avatar_url, role, status, responded_at, created_at
       FROM room_knocks
       WHERE id = $1 AND room_code = $2;`,
      [knockId, sanitizedCode]
    );

    if (knockRes.rows.length === 0) {
      return res.status(404).json({ error: "Knock request not found", code: "KNOCK_NOT_FOUND" });
    }

    return res.json({ knock: knockRes.rows[0], status: knockRes.rows[0].status });
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to check knock status", details: err.message });
  }
});

/**
 * POST /api/rooms/:roomCode/knock/:knockId/cancel
 * Participant cancels their pending knock request.
 */
roomsRouter.post("/:roomCode/knock/:knockId/cancel", async (req: Request, res: Response) => {
  try {
    const { roomCode, knockId } = req.params;
    const sanitizedCode = sanitizeCode(roomCode);

    await query(
      `UPDATE room_knocks
       SET status = 'cancelled'
       WHERE id = $1 AND room_code = $2 AND status = 'pending';`,
      [knockId, sanitizedCode]
    );

    return res.json({ success: true, message: "Knock request cancelled" });
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to cancel knock request", details: err.message });
  }
});

/**
 * GET /api/rooms/:roomCode/knocks
 * Host only: Lists active pending knocks for this room.
 */
roomsRouter.get("/:roomCode/knocks", requireAuth, async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const sanitizedCode = sanitizeCode(roomCode);
    const user = (req as any).user;

    const roomRes = await query(
      "SELECT id, room_code, title, tutor_id, tutor_name, metadata, is_active FROM live_classes WHERE room_code = $1",
      [sanitizedCode]
    );

    if (roomRes.rows.length === 0) {
      return res.status(404).json({ error: "Room not found" });
    }

    const room = roomRes.rows[0];
    if (!isUserRoomHost(room, user)) {
      return res.status(403).json({ error: "Only the meeting host can view waiting participants", code: "FORBIDDEN" });
    }

    const result = await query(
      `SELECT id, room_code, user_id, display_name, email, avatar_url, role, status, created_at
       FROM room_knocks
       WHERE room_code = $1 AND status = 'pending'
       ORDER BY created_at ASC;`,
      [sanitizedCode]
    );

    return res.json({ knocks: result.rows });
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to list knocks", details: err.message });
  }
});

/**
 * POST /api/rooms/:roomCode/knock/:knockId/respond
 * Host only: Admits or denies a knocking participant.
 */
roomsRouter.post("/:roomCode/knock/:knockId/respond", requireAuth, async (req: Request, res: Response) => {
  try {
    const { roomCode, knockId } = req.params;
    const sanitizedCode = sanitizeCode(roomCode);
    const user = (req as any).user;
    const { action } = req.body;

    if (action !== "admit" && action !== "deny") {
      return res.status(400).json({ error: "Action must be 'admit' or 'deny'" });
    }

    const roomRes = await query(
      "SELECT id, room_code, title, tutor_id, tutor_name, metadata, is_active FROM live_classes WHERE room_code = $1",
      [sanitizedCode]
    );

    if (roomRes.rows.length === 0) {
      return res.status(404).json({ error: "Room not found" });
    }

    const room = roomRes.rows[0];
    if (!isUserRoomHost(room, user)) {
      return res.status(403).json({ error: "Only the meeting host can admit or deny participants", code: "FORBIDDEN" });
    }

    const newStatus = action === "admit" ? "admitted" : "denied";
    const responderId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(user.id))
      ? user.id
      : null;

    const updateRes = await query(
      `UPDATE room_knocks
       SET status = $1, responded_by = $2, responded_at = NOW()
       WHERE id = $3 AND room_code = $4 AND status = 'pending'
       RETURNING id, room_code, user_id, display_name, email, role, status, responded_at;`,
      [newStatus, responderId, knockId, sanitizedCode]
    );

    if (updateRes.rows.length === 0) {
      return res.status(404).json({ error: "Pending knock request not found or already handled", code: "KNOCK_NOT_FOUND" });
    }

    return res.json({
      success: true,
      knock: updateRes.rows[0],
      status: newStatus,
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to respond to knock request", details: err.message });
  }
});

/**
 * POST /api/rooms/:roomCode/knocks/respond-all
 * Host only: Batch admits or denies all pending knocks.
 */
roomsRouter.post("/:roomCode/knocks/respond-all", requireAuth, async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const sanitizedCode = sanitizeCode(roomCode);
    const user = (req as any).user;
    const { action } = req.body;

    if (action !== "admit" && action !== "deny") {
      return res.status(400).json({ error: "Action must be 'admit' or 'deny'" });
    }

    const roomRes = await query(
      "SELECT id, room_code, title, tutor_id, tutor_name, metadata, is_active FROM live_classes WHERE room_code = $1",
      [sanitizedCode]
    );

    if (roomRes.rows.length === 0) {
      return res.status(404).json({ error: "Room not found" });
    }

    const room = roomRes.rows[0];
    if (!isUserRoomHost(room, user)) {
      return res.status(403).json({ error: "Only the meeting host can admit or deny participants", code: "FORBIDDEN" });
    }

    const newStatus = action === "admit" ? "admitted" : "denied";
    const responderId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(user.id))
      ? user.id
      : null;

    const updateRes = await query(
      `UPDATE room_knocks
       SET status = $1, responded_by = $2, responded_at = NOW()
       WHERE room_code = $3 AND status = 'pending'
       RETURNING id, room_code, user_id, display_name, status;`,
      [newStatus, responderId, sanitizedCode]
    );

    return res.json({
      success: true,
      action: newStatus,
      updatedCount: updateRes.rows.length,
      knocks: updateRes.rows,
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to respond to all knock requests", details: err.message });
  }
});

/**
 * POST /api/rooms/:roomCode/end
 * Allows authorized room owner (tutor) to end class.
 */
roomsRouter.post("/:roomCode/end", requireAuth, async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const sanitizedCode = sanitizeCode(roomCode);
    const user = (req as any).user;

    const roomRes = await query(
      "SELECT id, tutor_id, metadata FROM live_classes WHERE room_code = $1",
      [sanitizedCode]
    );

    if (roomRes.rows.length === 0) {
      return res.status(404).json({ error: "Room not found" });
    }

    if (roomRes.rows[0].tutor_id !== user.id) {
      return res.status(403).json({ error: "Only the meeting host can end the meeting" });
    }

    const room = roomRes.rows[0];
    const sessionId = String(room.metadata?.session_id || room.id);

    await query(
      "UPDATE live_classes SET is_active = false, ended_at = NOW() WHERE room_code = $1",
      [sanitizedCode]
    );
    invalidateRoomCache(sanitizedCode);

    // Mark all remaining participants as left
    await query(
      "UPDATE room_participants SET left_at = NOW() WHERE room_code = $1 AND left_at IS NULL",
      [sanitizedCode]
    );

    // Authoritative cleanup: Purge all temporary in-class chat messages from MongoDB
    let deletedCount = 0;
    const chatCol = getChatCollection();
    if (chatCol) {
      const delRes = await chatCol.deleteMany({ sessionId });
      deletedCount = delRes.deletedCount;
      console.log(`[Chat Cleanup] Class ended for room ${sanitizedCode} (session ${sessionId}). Purged ${deletedCount} temporary messages.`);
    }

    const sessionsCol = getSessionsCollection();
    if (sessionsCol) {
      await sessionsCol.updateOne(
        { sessionId },
        { $set: { status: "ended", endedAt: new Date() } }
      );
    }

    return res.json({
      success: true,
      message: "Class ended successfully and temporary chat purged",
      sessionId,
      deletedCount,
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to end room", details: err.message });
  }
});
