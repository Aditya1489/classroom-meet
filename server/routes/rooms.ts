import { Router, Request, Response } from "express";
import { query } from "../db";

export const roomsRouter = Router();

/**
 * GET /api/rooms/:roomCode
 */
roomsRouter.get("/:roomCode", async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const result = await query(
      "SELECT id, room_code, title, tutor_id, tutor_name, is_active, is_live_streaming, metadata, started_at, ended_at, created_at FROM live_classes WHERE room_code = $1",
      [roomCode]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ room: null });
    }

    return res.json({ room: result.rows[0] });
  } catch (err: any) {
    console.error("[Rooms GET Error]:", err.message);
    return res.status(500).json({ error: "Failed to get room", details: err.message });
  }
});

/**
 * POST /api/rooms
 * Upsert room by room_code
 */
roomsRouter.post("/", async (req: Request, res: Response) => {
  try {
    const { room_code, title, tutor_id, tutor_name, is_active = true, is_live_streaming = false, metadata = {} } = req.body;

    if (!room_code) {
      return res.status(400).json({ error: "room_code is required" });
    }

    const roomTitle = title || `Class ${room_code}`;

    const upsertSql = `
      INSERT INTO live_classes (room_code, title, tutor_id, tutor_name, is_active, is_live_streaming, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (room_code) DO UPDATE SET
        title = COALESCE(EXCLUDED.title, live_classes.title),
        tutor_id = COALESCE(EXCLUDED.tutor_id, live_classes.tutor_id),
        tutor_name = COALESCE(EXCLUDED.tutor_name, live_classes.tutor_name),
        is_active = COALESCE(EXCLUDED.is_active, live_classes.is_active),
        is_live_streaming = COALESCE(EXCLUDED.is_live_streaming, live_classes.is_live_streaming),
        metadata = COALESCE(EXCLUDED.metadata, live_classes.metadata)
      RETURNING *;
    `;

    const result = await query(upsertSql, [
      room_code,
      roomTitle,
      tutor_id || null,
      tutor_name || null,
      is_active,
      is_live_streaming,
      JSON.stringify(metadata),
    ]);

    return res.json({ room: result.rows[0] });
  } catch (err: any) {
    console.error("[Rooms Upsert Error]:", err.message);
    return res.status(500).json({ error: "Failed to upsert room", details: err.message });
  }
});

/**
 * POST /api/rooms/:roomCode/participants
 * Record participant join
 */
roomsRouter.post("/:roomCode/participants", async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const { user_id, display_name, role = "student", camera_allowed = false } = req.body;

    // First ensure room exists
    await query(
      `INSERT INTO live_classes (room_code, title)
       VALUES ($1, $2)
       ON CONFLICT (room_code) DO NOTHING;`,
      [roomCode, `Class ${roomCode}`]
    );

    const insertSql = `
      INSERT INTO room_participants (room_code, user_id, display_name, role, camera_allowed, joined_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *;
    `;

    // Only pass UUID or null for user_id to prevent invalid uuid error for guest_xxx
    const validUserId = user_id && user_id.includes("-") && user_id.length === 36 ? user_id : null;

    const result = await query(insertSql, [
      roomCode,
      validUserId,
      display_name || "Participant",
      role,
      camera_allowed,
    ]);

    return res.json({ participant: result.rows[0] });
  } catch (err: any) {
    console.error("[Participants Join Error]:", err.message);
    return res.status(500).json({ error: "Failed to record participant", details: err.message });
  }
});

/**
 * GET /api/rooms/:roomCode/participants
 */
roomsRouter.get("/:roomCode/participants", async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const result = await query(
      `SELECT id, room_code, user_id, display_name, role, camera_allowed, joined_at, left_at
       FROM room_participants
       WHERE room_code = $1 AND left_at IS NULL
       ORDER BY joined_at ASC;`,
      [roomCode]
    );

    return res.json({ participants: result.rows });
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to fetch participants", details: err.message });
  }
});

/**
 * POST /api/rooms/:roomCode/leave
 */
roomsRouter.post("/:roomCode/leave", async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const { user_id, display_name } = req.body;

    await query(
      `UPDATE room_participants
       SET left_at = NOW()
       WHERE room_code = $1 AND (user_id = $2 OR display_name = $3) AND left_at IS NULL;`,
      [roomCode, user_id || null, display_name || null]
    );

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to record leave", details: err.message });
  }
});
