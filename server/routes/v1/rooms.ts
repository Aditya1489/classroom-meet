import { Router, Request, Response } from "express";
import crypto from "node:crypto";
import { query } from "../../db";
import { apiKeyAuth, requirePermission } from "../../middleware/apiKeyAuth";
import { issueParticipantToken, ParticipantRole } from "../../services/participantTokenService";
import { getChatCollection, getSessionsCollection } from "../../db/mongo";

export const v1RoomsRouter = Router();

// Apply API Key Authentication to all versioned B2B room routes
v1RoomsRouter.use(apiKeyAuth());

/**
 * Generate a cryptographically secure random room code (ptq-rtvq-rox format)
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

/**
 * POST /api/v1/rooms
 * Create a new tenant-scoped meeting room.
 * Required permission: rooms:write
 */
v1RoomsRouter.post("/", requirePermission("rooms:write"), async (req: Request, res: Response) => {
  try {
    const organization = (req as any).organization;
    const environment = (req as any).environment;
    const { title, roomCode, settings = {}, metadata = {} } = req.body;

    let finalRoomCode: string;
    if (roomCode && typeof roomCode === "string" && roomCode.trim().length > 0) {
      finalRoomCode = roomCode.trim().toLowerCase();
      // Validate custom room code format (alphanumeric with hyphens/underscores, 4-50 chars)
      if (!/^[a-z0-9-_]{4,50}$/.test(finalRoomCode)) {
        return res.status(400).json({
          error: "Invalid roomCode format. Must be 4-50 characters of lowercase letters, numbers, hyphens, or underscores.",
          code: "INVALID_ROOM_CODE_FORMAT",
        });
      }
    } else {
      finalRoomCode = generateSecureRoomCode();
    }

    // Verify global room_code uniqueness
    const existing = await query("SELECT id FROM live_classes WHERE room_code = $1;", [finalRoomCode]);
    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: "A room with this room code already exists. Room codes must be globally unique.",
        code: "ROOM_CODE_ALREADY_EXISTS",
      });
    }

    const roomTitle = (title && typeof title === "string" && title.trim().length > 0)
      ? title.trim()
      : `Room ${finalRoomCode}`;

    const sessionId = crypto.randomUUID();
    const metaPayload = {
      ...(typeof metadata === "object" && metadata !== null ? metadata : {}),
      session_id: sessionId,
      settings: typeof settings === "object" && settings !== null ? settings : {},
      environment,
      created_via: "api_key",
    };

    const insertSql = `
      INSERT INTO live_classes (
        organization_id, room_code, title, tutor_name, is_active, metadata, started_at
      )
      VALUES ($1, $2, $3, $4, TRUE, $5::jsonb, NOW())
      RETURNING id, organization_id, room_code, title, is_active, metadata, started_at, created_at;
    `;

    const result = await query(insertSql, [
      organization.id,
      finalRoomCode,
      roomTitle,
      `API Host (${organization.name})`,
      JSON.stringify(metaPayload),
    ]);

    const row = result.rows[0];

    // Initialize MongoDB session if available
    const sessionsCol = getSessionsCollection();
    if (sessionsCol) {
      const now = new Date();
      await sessionsCol.updateOne(
        { sessionId },
        {
          $set: {
            sessionId,
            roomCode: finalRoomCode,
            tenantId: organization.id,
            status: "active",
            isChatLocked: false,
            pinnedMessage: null,
            startedAt: now,
            lastActivityAt: now,
            expireAt: new Date(now.getTime() + 24 * 3600 * 1000),
          },
        },
        { upsert: true }
      );
    }

    return res.status(201).json({
      room: {
        id: row.id,
        roomCode: row.room_code,
        title: row.title,
        isActive: row.is_active,
        organizationId: row.organization_id,
        environment,
        settings: row.metadata?.settings || {},
        createdAt: row.created_at,
        startedAt: row.started_at,
      },
    });
  } catch (err: any) {
    console.error("[V1 Rooms Create Error]:", err.message);
    return res.status(500).json({ error: "Failed to create room", details: err.message });
  }
});

/**
 * GET /api/v1/rooms/:roomId
 * Retrieve room metadata. Enforces tenant ownership.
 * Required permission: rooms:read
 */
v1RoomsRouter.get("/:roomId", requirePermission("rooms:read"), async (req: Request, res: Response) => {
  try {
    const organization = (req as any).organization;
    const { roomId } = req.params;

    if (!roomId) {
      return res.status(400).json({ error: "Missing roomId parameter" });
    }

    const roomRes = await query(
      `SELECT id, organization_id, room_code, title, tutor_name, is_active, metadata, started_at, ended_at, created_at
       FROM live_classes
       WHERE (id::text = $1 OR room_code = $1) AND organization_id = $2;`,
      [String(roomId).trim().toLowerCase(), organization.id]
    );

    if (roomRes.rows.length === 0) {
      return res.status(404).json({
        error: "Room not found or does not belong to this organization",
        code: "ROOM_NOT_FOUND",
      });
    }

    const row = roomRes.rows[0];

    // Fetch active participants count
    const countRes = await query(
      "SELECT COUNT(*)::int as count FROM room_participants WHERE room_code = $1 AND left_at IS NULL;",
      [row.room_code]
    );
    const activeParticipantsCount = countRes.rows[0]?.count || 0;

    return res.json({
      room: {
        id: row.id,
        roomCode: row.room_code,
        title: row.title,
        isActive: row.is_active,
        organizationId: row.organization_id,
        environment: row.metadata?.environment || "live",
        settings: row.metadata?.settings || {},
        activeParticipantsCount,
        createdAt: row.created_at,
        startedAt: row.started_at,
        endedAt: row.ended_at,
      },
    });
  } catch (err: any) {
    console.error("[V1 Rooms GET Error]:", err.message);
    return res.status(500).json({ error: "Failed to retrieve room", details: err.message });
  }
});

/**
 * POST /api/v1/rooms/:roomId/end
 * End an active meeting room and clean up active participants.
 * Required permission: rooms:write
 */
v1RoomsRouter.post("/:roomId/end", requirePermission("rooms:write"), async (req: Request, res: Response) => {
  try {
    const organization = (req as any).organization;
    const { roomId } = req.params;

    const roomRes = await query(
      `SELECT id, organization_id, room_code, is_active, metadata
       FROM live_classes
       WHERE (id::text = $1 OR room_code = $1) AND organization_id = $2;`,
      [String(roomId).trim().toLowerCase(), organization.id]
    );

    if (roomRes.rows.length === 0) {
      return res.status(404).json({
        error: "Room not found or does not belong to this organization",
        code: "ROOM_NOT_FOUND",
      });
    }

    const room = roomRes.rows[0];

    if (!room.is_active) {
      return res.json({
        success: true,
        message: "Room is already ended",
        room: {
          id: room.id,
          roomCode: room.room_code,
          isActive: false,
        },
      });
    }

    // End room in database
    await query(
      "UPDATE live_classes SET is_active = FALSE, ended_at = NOW() WHERE id = $1;",
      [room.id]
    );

    // Mark remaining participants as left
    await query(
      "UPDATE room_participants SET left_at = NOW() WHERE room_code = $1 AND left_at IS NULL;",
      [room.room_code]
    );

    // Clean up temporary in-session chat
    const sessionId = String(room.metadata?.session_id || room.id);
    const chatCol = getChatCollection();
    if (chatCol) {
      await chatCol.deleteMany({ sessionId });
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
      message: "Room ended successfully",
      room: {
        id: room.id,
        roomCode: room.room_code,
        isActive: false,
        endedAt: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    console.error("[V1 Rooms End Error]:", err.message);
    return res.status(500).json({ error: "Failed to end room", details: err.message });
  }
});

/**
 * GET /api/v1/rooms/:roomId/participants
 * List participants for a tenant room.
 * Required permission: rooms:read
 */
v1RoomsRouter.get("/:roomId/participants", requirePermission("rooms:read"), async (req: Request, res: Response) => {
  try {
    const organization = (req as any).organization;
    const { roomId } = req.params;
    const status = req.query.status === "all" ? "all" : "active";

    const roomRes = await query(
      `SELECT id, room_code FROM live_classes 
       WHERE (id::text = $1 OR room_code = $1) AND organization_id = $2;`,
      [String(roomId).trim().toLowerCase(), organization.id]
    );

    if (roomRes.rows.length === 0) {
      return res.status(404).json({
        error: "Room not found or does not belong to this organization",
        code: "ROOM_NOT_FOUND",
      });
    }

    const room = roomRes.rows[0];

    const filterClause = status === "active" ? "AND left_at IS NULL" : "";
    const participantsRes = await query(
      `SELECT id, room_code, display_name, role, camera_allowed, joined_at, left_at
       FROM room_participants
       WHERE room_code = $1 ${filterClause}
       ORDER BY joined_at DESC;`,
      [room.room_code]
    );

    return res.json({
      roomCode: room.room_code,
      participants: participantsRes.rows.map((p) => ({
        id: p.id,
        displayName: p.display_name,
        role: p.role,
        cameraAllowed: p.camera_allowed,
        joinedAt: p.joined_at,
        leftAt: p.left_at,
      })),
    });
  } catch (err: any) {
    console.error("[V1 Rooms Participants Error]:", err.message);
    return res.status(500).json({ error: "Failed to list participants", details: err.message });
  }
});

/**
 * POST /api/v1/rooms/:roomId/tokens
 * Mint a short-lived participant JWT for a verified room.
 * Required permission: tokens:write
 */
v1RoomsRouter.post("/:roomId/tokens", requirePermission("tokens:write"), async (req: Request, res: Response) => {
  try {
    const organization = (req as any).organization;
    const { roomId } = req.params;
    const { participantId, name, role, expiresInSeconds, permissions } = req.body;

    if (!participantId || typeof participantId !== "string" || participantId.trim().length === 0) {
      return res.status(400).json({
        error: "participantId is required and must be a non-empty string",
        code: "MISSING_PARTICIPANT_ID",
      });
    }

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({
        error: "name is required and must be a non-empty string",
        code: "MISSING_PARTICIPANT_NAME",
      });
    }

    if (!role || (role !== "tutor" && role !== "student")) {
      return res.status(400).json({
        error: "Invalid role. Supported roles are 'tutor' and 'student'",
        code: "INVALID_ROLE",
      });
    }

    // Verify room exists and belongs to the authenticated organization
    const roomRes = await query(
      `SELECT id, room_code, is_active 
       FROM live_classes 
       WHERE (id::text = $1 OR room_code = $1) AND organization_id = $2;`,
      [String(roomId).trim().toLowerCase(), organization.id]
    );

    if (roomRes.rows.length === 0) {
      return res.status(404).json({
        error: "Room not found or does not belong to this organization",
        code: "ROOM_NOT_FOUND",
      });
    }

    const room = roomRes.rows[0];

    if (!room.is_active) {
      return res.status(400).json({
        error: "Cannot issue token for an ended or inactive room",
        code: "ROOM_ENDED",
      });
    }

    const tokenResult = issueParticipantToken({
      organizationId: organization.id,
      room: {
        id: room.id,
        room_code: room.room_code,
        is_active: room.is_active,
      },
      participantId,
      name,
      role: role as ParticipantRole,
      expiresInSeconds: typeof expiresInSeconds === "number" ? expiresInSeconds : undefined,
      permissions: typeof permissions === "object" ? permissions : undefined,
    });

    return res.status(201).json({
      token: tokenResult.token,
      expiresAt: tokenResult.expiresAt,
      room: {
        id: room.id,
        roomCode: room.room_code,
      },
      participant: {
        id: tokenResult.claims.sub,
        name: tokenResult.claims.name,
        role: tokenResult.claims.role,
        permissions: tokenResult.claims.permissions,
      },
    });
  } catch (err: any) {
    console.error("[V1 Rooms Token Mint Error]:", err.message);
    return res.status(500).json({ error: "Failed to issue participant token", details: err.message });
  }
});
