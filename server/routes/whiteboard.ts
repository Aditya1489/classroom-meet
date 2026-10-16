import { Router, Request, Response } from "express";
import { query } from "../db";

export const whiteboardRouter = Router();

/**
 * GET /api/rooms/:roomCode/whiteboard
 */
whiteboardRouter.get("/:roomCode/whiteboard", async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const result = await query(
      "SELECT snapshot_json, shape_count, updated_at FROM whiteboard_snapshots WHERE room_code = $1",
      [roomCode]
    );

    if (result.rows.length === 0) {
      return res.json({ snapshot: null });
    }

    return res.json({
      snapshot: result.rows[0].snapshot_json,
      updated_at: result.rows[0].updated_at,
    });
  } catch (err: any) {
    console.error("[Whiteboard GET Error]:", err.message);
    return res.status(500).json({ error: "Failed to load whiteboard", details: err.message });
  }
});

/**
 * POST /api/rooms/:roomCode/whiteboard
 */
whiteboardRouter.post("/:roomCode/whiteboard", async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const { snapshot } = req.body;

    if (!snapshot) {
      return res.status(400).json({ error: "snapshot is required" });
    }

    // Ensure room exists
    await query(
      `INSERT INTO live_classes (room_code, title)
       VALUES ($1, $2)
       ON CONFLICT (room_code) DO NOTHING;`,
      [roomCode, `Class ${roomCode}`]
    );

    let count = 0;
    try {
      if (typeof snapshot === "object" && snapshot?.shapes) {
        count = Object.keys(snapshot.shapes).length;
      }
    } catch {}

    const upsertSql = `
      INSERT INTO whiteboard_snapshots (room_code, snapshot_json, shape_count, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (room_code) DO UPDATE SET
        snapshot_json = EXCLUDED.snapshot_json,
        shape_count = EXCLUDED.shape_count,
        updated_at = NOW()
      RETURNING *;
    `;

    const result = await query(upsertSql, [roomCode, JSON.stringify(snapshot), count]);

    return res.json({
      success: true,
      updated_at: result.rows[0].updated_at,
    });
  } catch (err: any) {
    console.error("[Whiteboard POST Error]:", err.message);
    return res.status(500).json({ error: "Failed to persist whiteboard", details: err.message });
  }
});
