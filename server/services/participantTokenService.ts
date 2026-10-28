import jwt from "jsonwebtoken";
import { getParticipantJwtSecret } from "./envValidator";

// Dedicated signing secret getter for participant tokens — NEVER use customer API keys or client secrets
export const getSigningSecret = () => getParticipantJwtSecret();
export const PARTICIPANT_JWT_SECRET = getParticipantJwtSecret();

export const TOKEN_ISSUER = "mathsy-meet-saas";
export const TOKEN_AUDIENCE = "mathsy-meet-sfu";

export type ParticipantRole = "tutor" | "student";

export interface ParticipantPermissions {
  canPublishAudio: boolean;
  canPublishVideo: boolean;
  canPublishScreen: boolean;
  canChat: boolean;
  isHost: boolean;
}

export interface ParticipantTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  tenant_id: string;
  room_code: string;
  room_id: string;
  name: string;
  role: ParticipantRole;
  permissions: ParticipantPermissions;
  iat: number;
  exp: number;
}

export interface IssueTokenOptions {
  organizationId: string;
  room: {
    id: string;
    room_code: string;
    is_active: boolean;
  };
  participantId: string;
  name: string;
  role: ParticipantRole;
  expiresInSeconds?: number;
  permissions?: Partial<ParticipantPermissions>;
}

/**
 * Mint an authoritative, short-lived participant JWT for a verified room
 */
export function issueParticipantToken({
  organizationId,
  room,
  participantId,
  name,
  role,
  expiresInSeconds = 14400, // 4 hours default
  permissions = {},
}: IssueTokenOptions): {
  token: string;
  expiresAt: string;
  claims: ParticipantTokenClaims;
} {
  if (!participantId || typeof participantId !== "string" || participantId.trim().length === 0) {
    throw new Error("participantId is required and must be a non-empty string");
  }

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw new Error("name is required and must be a non-empty string");
  }

  if (role !== "tutor" && role !== "student") {
    throw new Error(`Invalid role '${role}'. Only 'tutor' and 'student' roles are supported.`);
  }

  if (!room.is_active) {
    throw new Error("Cannot issue participant token for an inactive or ended room");
  }

  // Restrict expiresInSeconds to reasonable bounds (5 minutes to 24 hours)
  const boundedExpiry = Math.min(Math.max(expiresInSeconds, 300), 86400);

  // Derive authoritative permissions: students can NEVER be granted isHost: true
  const isTutor = role === "tutor";
  const authoritativePermissions: ParticipantPermissions = {
    canPublishAudio: permissions.canPublishAudio ?? (isTutor ? true : false),
    canPublishVideo: permissions.canPublishVideo ?? true,
    canPublishScreen: isTutor ? (permissions.canPublishScreen ?? true) : false,
    canChat: permissions.canChat ?? true,
    isHost: isTutor ? (permissions.isHost ?? true) : false,
  };

  const now = Math.floor(Date.now() / 1000);
  const exp = now + boundedExpiry;

  const payload: Omit<ParticipantTokenClaims, "iat" | "exp"> = {
    iss: TOKEN_ISSUER,
    aud: TOKEN_AUDIENCE,
    sub: participantId.trim(),
    tenant_id: organizationId,
    room_code: room.room_code,
    room_id: room.id,
    name: name.trim(),
    role,
    permissions: authoritativePermissions,
  };

  const signingSecret = getParticipantJwtSecret();
  const token = jwt.sign(payload, signingSecret, {
    algorithm: "HS256",
    expiresIn: boundedExpiry,
  });

  const decoded = jwt.decode(token) as ParticipantTokenClaims;

  return {
    token,
    expiresAt: new Date(exp * 1000).toISOString(),
    claims: decoded,
  };
}

/**
 * Verify and decode a participant token (used by server verification & tests)
 */
export function verifyParticipantToken(token: string): ParticipantTokenClaims {
  const signingSecret = getParticipantJwtSecret();
  const verified = jwt.verify(token, signingSecret, {
    algorithms: ["HS256"],
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
  }) as ParticipantTokenClaims;

  return verified;
}
