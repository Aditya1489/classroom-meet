import crypto from "node:crypto";
import {
  ServerClientConfig,
  MeetingRoom,
  CreateMeetingOptions,
  CreateParticipantTokenOptions,
  ParticipantTokenResult,
  ParticipantList,
  ApiKeyVerification,
  MathsyMeetError,
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  SecurityError,
} from "./types";

/**
 * Mathsy Meet Server-Side SDK Client
 *
 * For secure backend integration. Handles API-key authenticated room creation,
 * participant token minting, meeting termination, and attendance queries.
 *
 * CRITICAL SECURITY RULE:
 * This client must NEVER be instantiated in client-side / browser code.
 * Exposing customer API keys to the browser compromises tenant isolation.
 */
export class MathsyMeetServerClient {
  private readonly apiKey: string;
  private readonly apiBaseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: ServerClientConfig) {
    // 1. Enforce Server-Only Execution Safeguard
    if (typeof window !== "undefined" || typeof (globalThis as any).window !== "undefined") {
      throw new SecurityError(
        "MathsyMeetServerClient must only be used in secure server-side environments. Never expose your API key to client browsers!"
      );
    }

    if (!config || !config.apiKey || typeof config.apiKey !== "string" || config.apiKey.trim().length === 0) {
      throw new SecurityError("API key is required to initialize MathsyMeetServerClient.");
    }

    const trimmedKey = config.apiKey.trim();
    const isValidPrefix =
      trimmedKey.startsWith("sec_live_") ||
      trimmedKey.startsWith("sec_test_") ||
      trimmedKey.startsWith("sk_live_") ||
      trimmedKey.startsWith("sk_test_");

    if (!isValidPrefix) {
      throw new SecurityError(
        "Invalid API key format. Expected secret key starting with 'sec_live_', 'sec_test_', 'sk_live_', or 'sk_test_'."
      );
    }

    this.apiKey = trimmedKey;
    this.apiBaseUrl = (config.apiBaseUrl || "https://api.mathsy.in/api/v1").replace(/\/$/, "");
    this.timeoutMs = config.timeoutMs || 10000;
  }

  /**
   * Internal HTTP request helper with unified error serialization
   */
  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "User-Agent": "MathsyMeet-NodeSDK/1.0.0",
      ...(options.headers as Record<string, string> || {}),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const contentType = response.headers.get("content-type") || "";
      const isJson = contentType.includes("application/json");
      const data = isJson ? await response.json() : await response.text();

      if (!response.ok) {
        const errorMsg = data?.error || data?.message || `HTTP ${response.status} Error`;
        const errorCode = data?.code || "API_ERROR";

        switch (response.status) {
          case 401:
            throw new AuthenticationError(errorMsg, errorCode, data);
          case 403:
            throw new ForbiddenError(errorMsg, errorCode, data);
          case 404:
            throw new NotFoundError(errorMsg, errorCode, data);
          default:
            throw new MathsyMeetError(errorMsg, errorCode, response.status, data);
        }
      }

      return data as T;
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === "AbortError") {
        throw new MathsyMeetError(`Request timed out after ${this.timeoutMs}ms`, "TIMEOUT", 408);
      }
      if (err instanceof MathsyMeetError) {
        throw err;
      }
      throw new MathsyMeetError(`Network error: ${err.message}`, "NETWORK_ERROR", 500, err);
    }
  }

  /**
   * Verifies the authenticity and permissions of the configured API key.
   */
  public async verifyApiKey(): Promise<ApiKeyVerification> {
    return this.request<ApiKeyVerification>("/auth/verify");
  }

  /**
   * Creates a new tenant-scoped meeting room.
   * Required API key scope: rooms:write
   */
  public async createMeeting(options: CreateMeetingOptions = {}): Promise<MeetingRoom> {
    const response = await this.request<{ room: any }>("/rooms", {
      method: "POST",
      body: JSON.stringify({
        title: options.title,
        roomCode: options.roomCode,
        settings: options.settings || {},
        metadata: options.metadata || {},
      }),
    });

    const r = response.room;
    return {
      id: r.id,
      roomCode: r.roomCode,
      title: r.title,
      isActive: r.isActive,
      organizationId: r.organizationId,
      environment: r.environment || "live",
      settings: r.settings || {},
      metadata: r.metadata,
      createdAt: r.createdAt,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
    };
  }

  /**
   * Retrieves room metadata and active participant count.
   * Required API key scope: rooms:read
   */
  public async getMeeting(roomIdOrCode: string): Promise<MeetingRoom> {
    if (!roomIdOrCode || typeof roomIdOrCode !== "string") {
      throw new MathsyMeetError("roomIdOrCode is required", "INVALID_ARGUMENT", 400);
    }

    const response = await this.request<{ room: any }>(
      `/rooms/${encodeURIComponent(roomIdOrCode.trim())}`
    );

    const r = response.room;
    return {
      id: r.id,
      roomCode: r.roomCode,
      title: r.title,
      isActive: r.isActive,
      organizationId: r.organizationId,
      environment: r.environment || "live",
      settings: r.settings || {},
      metadata: r.metadata,
      activeParticipantsCount: r.activeParticipantsCount,
      createdAt: r.createdAt,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
    };
  }

  /**
   * Ends an active meeting room, ejecting remaining participants.
   * Required API key scope: rooms:write
   */
  public async endMeeting(
    roomIdOrCode: string
  ): Promise<{ success: boolean; message: string; room: Partial<MeetingRoom> }> {
    if (!roomIdOrCode || typeof roomIdOrCode !== "string") {
      throw new MathsyMeetError("roomIdOrCode is required", "INVALID_ARGUMENT", 400);
    }

    return this.request<{ success: boolean; message: string; room: any }>(
      `/rooms/${encodeURIComponent(roomIdOrCode.trim())}/end`,
      { method: "POST" }
    );
  }

  /**
   * Lists active or all participants for a tenant's room.
   * Required API key scope: rooms:read
   */
  public async listParticipants(
    roomIdOrCode: string,
    status: "active" | "all" = "active"
  ): Promise<ParticipantList> {
    if (!roomIdOrCode || typeof roomIdOrCode !== "string") {
      throw new MathsyMeetError("roomIdOrCode is required", "INVALID_ARGUMENT", 400);
    }

    return this.request<ParticipantList>(
      `/rooms/${encodeURIComponent(roomIdOrCode.trim())}/participants?status=${encodeURIComponent(status)}`
    );
  }

  /**
   * Mints an authoritative, short-lived participant JWT for a verified room.
   * Required API key scope: tokens:write
   */
  public async createParticipantToken(
    roomIdOrCode: string,
    options: CreateParticipantTokenOptions
  ): Promise<ParticipantTokenResult> {
    if (!roomIdOrCode || typeof roomIdOrCode !== "string") {
      throw new MathsyMeetError("roomIdOrCode is required", "INVALID_ARGUMENT", 400);
    }

    if (!options || !options.participantId || !options.name || !options.role) {
      throw new MathsyMeetError(
        "participantId, name, and role ('tutor' | 'student') are required",
        "INVALID_ARGUMENT",
        400
      );
    }

    return this.request<ParticipantTokenResult>(
      `/rooms/${encodeURIComponent(roomIdOrCode.trim())}/tokens`,
      {
        method: "POST",
        body: JSON.stringify({
          participantId: options.participantId,
          name: options.name,
          role: options.role,
          expiresInSeconds: options.expiresInSeconds,
          permissions: options.permissions,
        }),
      }
    );
  }

  /**
   * Verifies an inbound webhook event signature against the customer's webhook secret.
   * Enforces replay attack protection using timestamp tolerance (default 300 seconds).
   */
  public static verifyWebhookSignature(options: {
    payload: string | Buffer;
    signatureHeader: string;
    secret: string;
    toleranceSeconds?: number;
  }): { valid: boolean; error?: string } {
    try {
      const { payload, signatureHeader, secret, toleranceSeconds = 300 } = options;
      if (!signatureHeader || !secret) {
        return { valid: false, error: "Missing signature header or secret" };
      }

      const parts = signatureHeader.split(",");
      let timestamp: number | null = null;
      let signature: string | null = null;

      for (const part of parts) {
        const [k, v] = part.trim().split("=");
        if (k === "t") timestamp = parseInt(v, 10);
        if (k === "v1") signature = v;
      }

      if (!timestamp || !signature) {
        return { valid: false, error: "Malformed signature header. Expected 't=...,v1=...'" };
      }

      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - timestamp) > toleranceSeconds) {
        return { valid: false, error: "Webhook timestamp outside tolerance window" };
      }

      const rawPayload = typeof payload === "string" ? payload : payload.toString("utf-8");
      const expectedPayload = `${timestamp}.${rawPayload}`;
      const expectedSig = crypto.createHmac("sha256", secret).update(expectedPayload).digest("hex");

      const sigBuf = Buffer.from(signature, "hex");
      const expBuf = Buffer.from(expectedSig, "hex");
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return { valid: false, error: "Invalid signature" };
      }

      return { valid: true };
    } catch (err: any) {
      return { valid: false, error: err.message };
    }
  }
}
