import { Router, Request, Response } from "express";
import { query } from "../db";

export const whiteboardRouter = Router();

/**
 * GET /api/rooms/:roomCode/whiteboard
 * Returns the current whiteboard snapshot and active view state (isOpen)
 */
whiteboardRouter.get("/:roomCode/whiteboard", async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const sanitizedCode = String(roomCode || "").trim().toLowerCase();

    // Query both snapshot and live_class metadata for view state
    const [snapshotResult, roomResult] = await Promise.all([
      query(
        "SELECT snapshot_json, shape_count, updated_at FROM whiteboard_snapshots WHERE room_code = $1",
        [sanitizedCode]
      ),
      query(
        "SELECT metadata, is_active FROM live_classes WHERE room_code = $1",
        [sanitizedCode]
      ),
    ]);

    const isClassActive = roomResult.rows.length > 0 && roomResult.rows[0].is_active;
    const isWhiteboardOpen = Boolean(roomResult.rows[0]?.metadata?.is_whiteboard_open);

    if (snapshotResult.rows.length === 0) {
      return res.json({
        snapshot: null,
        isOpen: isWhiteboardOpen,
        isActive: isClassActive,
      });
    }

    return res.json({
      snapshot: snapshotResult.rows[0].snapshot_json,
      updated_at: snapshotResult.rows[0].updated_at,
      isOpen: isWhiteboardOpen,
      isActive: isClassActive,
    });
  } catch (err: any) {
    console.error("[Whiteboard GET Error]:", err.message);
    return res.status(500).json({ error: "Failed to load whiteboard", details: err.message });
  }
});

/**
 * POST /api/rooms/:roomCode/whiteboard/state
 * Updates the shared view state (isOpen: boolean) in room metadata
 */
whiteboardRouter.post("/:roomCode/whiteboard/state", async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const sanitizedCode = String(roomCode || "").trim().toLowerCase();
    const { isOpen } = req.body;

    const boolState = Boolean(isOpen);

    await query(
      `UPDATE live_classes 
       SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{is_whiteboard_open}', $2::jsonb) 
       WHERE room_code = $1`,
      [sanitizedCode, JSON.stringify(boolState)]
    );

    return res.json({ success: true, isOpen: boolState });
  } catch (err: any) {
    console.error("[Whiteboard State POST Error]:", err.message);
    return res.status(500).json({ error: "Failed to persist whiteboard state", details: err.message });
  }
});

/**
 * POST /api/rooms/:roomCode/whiteboard
 */
whiteboardRouter.post("/:roomCode/whiteboard", async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const sanitizedCode = String(roomCode || "").trim().toLowerCase();
    const { snapshot } = req.body;

    if (!snapshot) {
      return res.status(400).json({ error: "snapshot is required" });
    }

    // Ensure room exists and is active
    const roomRes = await query(
      "SELECT id, is_active FROM live_classes WHERE room_code = $1",
      [sanitizedCode]
    );
    if (roomRes.rows.length === 0 || !roomRes.rows[0].is_active) {
      return res.status(404).json({ error: "Room not found or class has ended" });
    }

    let count = 0;
    try {
      if (typeof snapshot === "object" && snapshot?.store) {
        count = Object.keys(snapshot.store).length;
      } else if (typeof snapshot === "object" && snapshot?.shapes) {
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

    const result = await query(upsertSql, [sanitizedCode, JSON.stringify(snapshot), count]);

    return res.json({
      success: true,
      updated_at: result.rows[0].updated_at,
    });
  } catch (err: any) {
    console.error("[Whiteboard POST Error]:", err.message);
    return res.status(500).json({ error: "Failed to persist whiteboard", details: err.message });
  }
});
