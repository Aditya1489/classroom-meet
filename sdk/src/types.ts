/**
 * Mathsy Meet SDK Type Definitions & Error Classes
 */

// ============================================================================
// Error Classes
// ============================================================================

export class MathsyMeetError extends Error {
  public code?: string;
  public statusCode?: number;
  public details?: any;

  constructor(message: string, code?: string, statusCode?: number, details?: any) {
    super(message);
    this.name = "MathsyMeetError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class AuthenticationError extends MathsyMeetError {
  constructor(message: string, code = "AUTHENTICATION_FAILED", details?: any) {
    super(message, code, 401, details);
    this.name = "AuthenticationError";
  }
}

export class ForbiddenError extends MathsyMeetError {
  constructor(message: string, code = "FORBIDDEN", details?: any) {
    super(message, code, 403, details);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends MathsyMeetError {
  constructor(message: string, code = "NOT_FOUND", details?: any) {
    super(message, code, 404, details);
    this.name = "NotFoundError";
  }
}

export class SecurityError extends MathsyMeetError {
  constructor(message: string, code = "SECURITY_VIOLATION", details?: any) {
    super(message, code, 400, details);
    this.name = "SecurityError";
  }
}

// ============================================================================
// Server SDK Models
// ============================================================================

export interface ServerClientConfig {
  apiKey: string;
  apiBaseUrl?: string;
  timeoutMs?: number;
}

export interface MeetingRoom {
  id: string;
  roomCode: string;
  title: string;
  isActive: boolean;
  organizationId: string;
  environment: string;
  settings: Record<string, any>;
  metadata?: Record<string, any>;
  activeParticipantsCount?: number;
  createdAt: string;
  startedAt: string;
  endedAt?: string;
}

export interface CreateMeetingOptions {
  title?: string;
  roomCode?: string;
  settings?: Record<string, any>;
  metadata?: Record<string, any>;
}

export type ParticipantRole = "tutor" | "student";

export interface ParticipantPermissions {
  canPublishAudio: boolean;
  canPublishVideo: boolean;
  canPublishScreen: boolean;
  canChat: boolean;
  isHost: boolean;
}

export interface CreateParticipantTokenOptions {
  participantId: string;
  name: string;
  role: ParticipantRole;
  expiresInSeconds?: number;
  permissions?: Partial<ParticipantPermissions>;
}

export interface ParticipantTokenResult {
  token: string;
  expiresAt: string;
  room: {
    id: string;
    roomCode: string;
  };
  participant: {
    id: string;
    name: string;
    role: ParticipantRole;
    permissions: ParticipantPermissions;
  };
}

export interface ParticipantList {
  roomCode: string;
  participants: Array<{
    id: string;
    displayName: string;
    role: string;
    cameraAllowed: boolean;
    joinedAt: string;
    leftAt: string | null;
  }>;
}

export interface ApiKeyVerification {
  authenticated: boolean;
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  environment: string;
  permissions: string[];
}

// ============================================================================
// Browser SDK & Embed Models
// ============================================================================

export type EmbedEventType =
  | "ready"
  | "joined"
  | "left"
  | "mediaStateChanged"
  | "error";

export interface EmbedMeetingOptions {
  container: HTMLElement | string;
  roomCode: string;
  token: string;
  embedBaseUrl?: string;
  parentOrigin?: string;
  width?: string;
  height?: string;
  className?: string;
  onReady?: (payload?: any) => void;
  onJoined?: (participant: any) => void;
  onLeft?: (event: { reason: string }) => void;
  onMediaStateChanged?: (media: any) => void;
  onError?: (error: { code: string; message: string; details?: any }) => void;
  _mockIframe?: any; // Internal testing hook
}

export interface MathsyMeetEmbedController {
  iframe: HTMLIFrameElement;
  muteAudio(): void;
  unmuteAudio(): void;
  enableVideo(): void;
  disableVideo(): void;
  leaveMeeting(): void;
  getStatus(): void;
  on(event: EmbedEventType, handler: (payload: any) => void): () => void;
  destroy(): void;
  _handleIncomingMessage?(event: { origin: string; data: any }): void;
}
