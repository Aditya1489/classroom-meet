import { Router, Request, Response } from "express";
import { query } from "../db";

export const chatRouter = Router();

/**
 * GET /api/rooms/:roomCode/chat
 */
chatRouter.get("/:roomCode/chat", async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const limit = parseInt(req.query.limit as string) || 100;

    const result = await query(
      `SELECT id, room_code, sender_id, sender_name, sender_role, content, is_pinned, timestamp_ms, created_at
       FROM chat_messages
       WHERE room_code = $1
       ORDER BY timestamp_ms ASC
       LIMIT $2;`,
      [roomCode, limit]
    );

    // Map to client format
    const messages = result.rows.map((row) => ({
      id: row.id,
      room_code: row.room_code,
      sender_id: row.sender_id,
      sender_name: row.sender_name,
      sender_role: row.sender_role,
      content: row.content,
      is_pinned: row.is_pinned,
      timestamp: Number(row.timestamp_ms),
      created_at: row.created_at,
    }));

    return res.json({ messages });
  } catch (err: any) {
    console.error("[Chat GET Error]:", err.message);
    return res.status(500).json({ error: "Failed to fetch chat history", details: err.message });
  }
});

/**
 * POST /api/rooms/:roomCode/chat
 */
chatRouter.post("/:roomCode/chat", async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const { sender_id, sender_name, sender_role = "student", content, timestamp, is_pinned = false } = req.body;

    if (!content) {
      return res.status(400).json({ error: "content is required" });
    }

    // Ensure room exists
    await query(
      `INSERT INTO live_classes (room_code, title)
       VALUES ($1, $2)
       ON CONFLICT (room_code) DO NOTHING;`,
      [roomCode, `Class ${roomCode}`]
    );

    const validSenderId = sender_id && sender_id.includes("-") && sender_id.length === 36 ? sender_id : null;
    const ts = timestamp || Date.now();

    const insertSql = `
      INSERT INTO chat_messages (room_code, sender_id, sender_name, sender_role, content, is_pinned, timestamp_ms, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING *;
    `;

    const result = await query(insertSql, [
      roomCode,
      validSenderId,
      sender_name || "User",
      sender_role,
      content,
      is_pinned,
      ts,
    ]);

    const row = result.rows[0];
    return res.json({
      message: {
        id: row.id,
        room_code: row.room_code,
        sender_id: row.sender_id,
        sender_name: row.sender_name,
        sender_role: row.sender_role,
        content: row.content,
        is_pinned: row.is_pinned,
        timestamp: Number(row.timestamp_ms),
        created_at: row.created_at,
      },
    });
  } catch (err: any) {
    console.error("[Chat POST Error]:", err.message);
    return res.status(500).json({ error: "Failed to save message", details: err.message });
  }
});
