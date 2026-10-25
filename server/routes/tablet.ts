import { Router, Request, Response } from "express";
import { query } from "../db";

export const tabletRouter = Router();

/**
 * POST /api/tablet/generate
 * Creates or refreshes a 9-digit pairing code for a meeting room
 */
tabletRouter.post("/generate", async (req: Request, res: Response) => {
  try {
    const { room_code, host_user_id, pairing_code } = req.body;

    if (!room_code || !pairing_code) {
      return res.status(400).json({ error: "room_code and pairing_code are required" });
    }

    // Ensure room exists and is active
    const roomRes = await query(
      "SELECT id, is_active FROM live_classes WHERE room_code = $1",
      [room_code]
    );
    if (roomRes.rows.length === 0 || !roomRes.rows[0].is_active) {
      return res.status(404).json({ error: "Room not found or class has ended" });
    }

    const validHostId = host_user_id && host_user_id.includes("-") && host_user_id.length === 36 ? host_user_id : null;

    const upsertSql = `
      INSERT INTO tablet_pairings (room_code, host_user_id, pairing_code, is_paired, expires_at)
      VALUES ($1, $2, $3, FALSE, NOW() + INTERVAL '12 hours')
      ON CONFLICT (pairing_code) DO UPDATE SET
        room_code = EXCLUDED.room_code,
        host_user_id = EXCLUDED.host_user_id,
        is_paired = FALSE,
        expires_at = NOW() + INTERVAL '12 hours'
      RETURNING *;
    `;

    const result = await query(upsertSql, [room_code, validHostId, pairing_code]);

    return res.json({ tabletPairing: result.rows[0] });
  } catch (err: any) {
    console.error("[Tablet Generate Error]:", err.message);
    return res.status(500).json({ error: "Failed to generate pairing", details: err.message });
  }
});

/**
 * GET /api/tablet/:code
 * Validates companion tablet pairing code
 */
tabletRouter.get("/:code", async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const rawCode = Array.isArray(code) ? code[0] : code;
    const cleanCode = (rawCode || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

    const result = await query(
      `SELECT id, room_code, host_user_id, pairing_code, is_paired, expires_at
       FROM tablet_pairings
       WHERE pairing_code = $1 AND expires_at > NOW();`,
      [cleanCode]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Invalid or expired pairing code" });
    }

    return res.json({ tabletPairing: result.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to verify pairing code", details: err.message });
  }
});
