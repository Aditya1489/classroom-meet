import { Router, Request, Response } from "express";
import { query } from "../db";
import { authorizeRoomAccess } from "../middleware/roomAuth";

export const whiteboardRouter = Router();

/**
 * GET /api/rooms/:roomCode/whiteboard
 * Returns the current whiteboard snapshot and active view state (isOpen).
 * Strictly requires authentication and verified room participant membership.
 */
whiteboardRouter.get(
  "/:roomCode/whiteboard",
  authorizeRoomAccess({ requireParticipant: true }),
  async (req: Request, res: Response) => {
    try {
      const room = (req as any).room;
      const sanitizedCode = room.room_code;

      const snapshotResult = await query(
        "SELECT snapshot_json, shape_count, updated_at FROM whiteboard_snapshots WHERE room_code = $1;",
        [sanitizedCode]
      );

      const isWhiteboardOpen = Boolean(room.metadata?.is_whiteboard_open);

      if (snapshotResult.rows.length === 0) {
        return res.json({
          snapshot: null,
          isOpen: isWhiteboardOpen,
          isActive: room.is_active,
        });
      }

      return res.json({
        snapshot: snapshotResult.rows[0].snapshot_json,
        updated_at: snapshotResult.rows[0].updated_at,
        isOpen: isWhiteboardOpen,
        isActive: room.is_active,
      });
    } catch (err: any) {
      console.error("[Whiteboard GET Error]:", err.message);
      return res.status(500).json({ error: "Failed to load whiteboard", details: err.message });
    }
  }
);

/**
 * POST /api/rooms/:roomCode/whiteboard/state
 * Updates the shared view state (isOpen: boolean) in room metadata.
 * Strictly requires tutor/host authorization.
 */
whiteboardRouter.post(
  "/:roomCode/whiteboard/state",
  authorizeRoomAccess({ requireTutor: true }),
  async (req: Request, res: Response) => {
    try {
      const room = (req as any).room;
      const sanitizedCode = room.room_code;
      const { isOpen } = req.body;

      const boolState = Boolean(isOpen);

      await query(
        `UPDATE live_classes 
         SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{is_whiteboard_open}', $2::jsonb) 
         WHERE room_code = $1;`,
        [sanitizedCode, JSON.stringify(boolState)]
      );

      return res.json({ success: true, isOpen: boolState });
    } catch (err: any) {
      console.error("[Whiteboard State POST Error]:", err.message);
      return res.status(500).json({ error: "Failed to persist whiteboard state", details: err.message });
    }
  }
);

/**
 * POST /api/rooms/:roomCode/whiteboard
 * Persists updated whiteboard snapshot.
 * Requires host authorization, or student drawing permission if let_students_draw is enabled.
 */
whiteboardRouter.post(
  "/:roomCode/whiteboard",
  authorizeRoomAccess(),
  async (req: Request, res: Response) => {
    try {
      const room = (req as any).room;
      const isHost = (req as any).isHost;
      const sanitizedCode = room.room_code;
      const { snapshot } = req.body;

      if (!snapshot) {
        return res.status(400).json({ error: "snapshot is required" });
      }

      // If user is not the host, ensure let_students_draw is permitted
      if (!isHost && !room.metadata?.let_students_draw) {
        return res.status(403).json({
          error: "Forbidden: Drawing permission is currently locked by the meeting host",
          code: "FORBIDDEN_DRAWING_LOCKED",
        });
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
  }
);
