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
 * GET /api/rooms/:roomCode
 * Retrieves room status and metadata.
 * Returns 404 if the room does not exist or is inactive.
 */
roomsRouter.get("/:roomCode", async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const sanitizedCode = sanitizeCode(roomCode);

    const result = await query(
      `SELECT id, room_code, title, tutor_id, tutor_name, is_active, is_live_streaming, metadata, started_at, ended_at, created_at 
       FROM live_classes 
       WHERE room_code = $1`,
      [sanitizedCode]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Room not found", room: null });
    }

    const room = result.rows[0];
    if (!room.is_active) {
      return res.status(404).json({
        error: "Class has ended",
        room: {
          id: room.id,
          room_code: room.room_code,
          title: room.title,
          tutor_id: room.tutor_id,
          tutor_name: room.tutor_name,
          is_active: false,
        },
        isEnded: true,
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
    const roomRes = await query(
      "SELECT id, room_code, title, tutor_id, metadata, is_active FROM live_classes WHERE room_code = $1",
      [sanitizedCode]
    );

    if (roomRes.rows.length === 0 || !roomRes.rows[0].is_active) {
      return res.status(404).json({ error: "Room not found or class has ended" });
    }

    const room = roomRes.rows[0];

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

    const isHost = Boolean(
      (user.isParticipantToken && user.role === "tutor" && user.permissions?.isHost) ||
      (room.tutor_id && String(room.tutor_id) === String(userId)) ||
      (room.metadata?.tutor_id && String(room.metadata?.tutor_id) === String(userId))
    );
    const role: "tutor" | "student" = isHost ? "tutor" : "student";

    const isUserUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(userId));
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
