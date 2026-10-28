import { Request, Response, NextFunction } from "express";
import { query } from "../db";
import { requireAuth } from "../routes/auth";

export interface RoomAuthOptions {
  requireTutor?: boolean;
  requireParticipant?: boolean;
}

/**
 * Normalizes a room code for database queries.
 */
export function sanitizeRoomCode(code: any): string {
  if (!code) return "";
  const raw = Array.isArray(code) ? code[0] : code;
  return String(raw).trim().toLowerCase();
}

/**
 * Room authorization is strictly authoritative and queries PostgreSQL directly on every
 * request to eliminate security risks with stale active/ended status, revoked access,
 * or cross-instance cache drift in clustered deployments.
 * 
 * invalidateRoomCache is retained as a safe no-op for backward compatibility.
 */
export function invalidateRoomCache(_roomCode?: string): void {
  // No-op: Room authorization is strictly stateless and authoritative
}

/**
 * Authoritative Room Authorization Middleware.
 * 
 * Verifies that the authenticated caller (user JWT or participant token) has
 * legitimate access to the room specified in params/body, strictly enforcing:
 * 1. Room existence and active status.
 * 2. Cross-tenant isolation (participant token tenant matching room tenant).
 * 3. Room binding (token room code matching requested room code).
 * 4. Tutor-only restrictions for administrative/destructive actions.
 * 5. Participant membership for in-meeting actions (whiteboard, polls, chat).
 */
export function authorizeRoomAccess(options: RoomAuthOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // 1. Ensure user is authenticated via Bearer token
    await requireAuth(req, res, async () => {
      try {
        const user = (req as any).user;
        if (!user) {
          return res.status(401).json({ error: "Authentication required", code: "UNAUTHORIZED" });
        }

        const rawCode =
          req.params.roomCode ||
          req.body.room_code ||
          req.body.roomCode ||
          req.query.roomCode ||
          req.query.room_code;

        const roomCode = sanitizeRoomCode(rawCode);
        if (!roomCode) {
          return res.status(400).json({ error: "Missing roomCode parameter", code: "MISSING_ROOM_CODE" });
        }

        // 2. Fetch room record
        const roomRes = await query(
          `SELECT id, room_code, title, tutor_id, tutor_name, organization_id, is_active, metadata
           FROM live_classes
           WHERE room_code = $1;`,
          [roomCode]
        );

        if (roomRes.rows.length === 0 || !roomRes.rows[0].is_active) {
          return res.status(404).json({
            error: "Room not found or class has ended",
            code: "ROOM_NOT_FOUND",
          });
        }

        const room = roomRes.rows[0];

        // 3. Handle Participant Tokens (SaaS Tokens)
        if (user.isParticipantToken) {
          // Verify room binding
          if (user.room_code && user.room_code.toLowerCase() !== roomCode) {
            return res.status(403).json({
              error: "Participant token is not valid for this room",
              code: "ROOM_MISMATCH",
            });
          }

          // Verify tenant binding
          if (user.tenant_id && room.organization_id && user.tenant_id !== room.organization_id) {
            return res.status(403).json({
              error: "Participant token tenant does not match room tenant",
              code: "TENANT_MISMATCH",
            });
          }

          const isTutorToken = user.role === "tutor" && Boolean(user.permissions?.isHost);

          if (options.requireTutor && !isTutorToken) {
            return res.status(403).json({
              error: "Only the meeting host is authorized to perform this operation",
              code: "FORBIDDEN_TUTOR_REQUIRED",
            });
          }

          (req as any).room = room;
          (req as any).isHost = isTutorToken;
          return next();
        }

        // 4. Handle Standard User Accounts (Google OAuth / DB Users)
        const isOwner = Boolean(
          (room.tutor_id && String(room.tutor_id) === String(user.id)) ||
          (room.metadata?.tutor_id && String(room.metadata?.tutor_id) === String(user.id))
        );

        if (options.requireTutor && !isOwner) {
          return res.status(403).json({
            error: "Only the meeting tutor/host is authorized to perform this operation",
            code: "FORBIDDEN_TUTOR_REQUIRED",
          });
        }

        // 5. Verify Participant Membership if required
        if (options.requireParticipant && !isOwner) {
          const participantRes = await query(
            `SELECT 1 FROM room_participants
             WHERE room_code = $1 AND (user_id = $2 OR display_name = $3)
             LIMIT 1;`,
            [roomCode, user.id, user.full_name || ""]
          );

          if (participantRes.rows.length === 0) {
            return res.status(403).json({
              error: "You must be a registered participant in this room to perform this action",
              code: "FORBIDDEN_NOT_IN_ROOM",
            });
          }
        }

        (req as any).room = room;
        (req as any).isHost = isOwner;
        return next();
      } catch (err: any) {
        return res.status(500).json({ error: "Error verifying room access", details: err.message });
      }
    });
  };
}
