import { Router, Request, Response } from "express";
import { query } from "../db";
import { requireAuth } from "./auth";
import { authorizeRoomAccess } from "../middleware/roomAuth";

export const tabletRouter = Router();

/**
 * POST /api/tablet/generate
 * Creates or refreshes a 9-digit pairing code for a meeting room.
 * Strictly requires authentication and tutor/host authorization for the room.
 */
tabletRouter.post("/generate", requireAuth, authorizeRoomAccess({ requireTutor: true }), async (req: Request, res: Response) => {
  try {
    const { pairing_code } = req.body;
    const room = (req as any).room;
    const user = (req as any).user;
    const room_code = room.room_code;

    const cleanPairingCode = String(pairing_code || "").trim().replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    if (cleanPairingCode.length < 6 || cleanPairingCode.length > 12) {
      return res.status(400).json({ error: "Invalid pairing code format" });
    }


    // Determine host_user_id from authenticated user session or room record
    const candidateId = user?.id || room.tutor_id;
    const validHostId = candidateId && candidateId.includes("-") && candidateId.length === 36 ? candidateId : null;

    if (!validHostId) {
      return res.status(400).json({ error: "Cannot generate pairing code without an authenticated host UUID" });
    }

    const upsertSql = `
      INSERT INTO tablet_pairings (room_code, host_user_id, pairing_code, is_paired, expires_at)
      VALUES ($1, $2, $3, FALSE, NOW() + INTERVAL '12 hours')
      ON CONFLICT (pairing_code) DO UPDATE SET
        room_code = EXCLUDED.room_code,
        host_user_id = EXCLUDED.host_user_id,
        is_paired = FALSE,
        paired_at = NULL,
        expires_at = NOW() + INTERVAL '12 hours'
      RETURNING *;
    `;

    const result = await query(upsertSql, [room_code, validHostId, cleanPairingCode]);

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

/**
 * POST /api/tablet/:code/claim
 * Atomically claims a companion tablet pairing code to prevent replay attacks
 */
tabletRouter.post("/:code/claim", async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const rawCode = Array.isArray(code) ? code[0] : code;
    const cleanCode = (rawCode || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

    const result = await query(
      `UPDATE tablet_pairings
       SET is_paired = TRUE, paired_at = NOW()
       WHERE pairing_code = $1 AND is_paired = FALSE AND expires_at > NOW()
       RETURNING id, room_code, host_user_id, pairing_code, is_paired, paired_at, expires_at;`,
      [cleanCode]
    );

    if (result.rows.length === 0) {
      const checkRes = await query(
        `SELECT is_paired, expires_at FROM tablet_pairings WHERE pairing_code = $1;`,
        [cleanCode]
      );
      if (checkRes.rows.length === 0) {
        return res.status(404).json({ error: "Invalid pairing code" });
      }
      if (checkRes.rows[0].is_paired) {
        return res.status(409).json({ error: "Pairing code has already been claimed", code: "CODE_ALREADY_CLAIMED" });
      }
      return res.status(410).json({ error: "Pairing code has expired", code: "CODE_EXPIRED" });
    }

    return res.json({ tabletPairing: result.rows[0], message: "Tablet paired successfully" });
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to claim pairing code", details: err.message });
  }
});

