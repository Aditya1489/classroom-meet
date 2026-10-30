import { Router, Request, Response } from "express";
import { apiKeyAuth, requirePermission } from "../../middleware/apiKeyAuth";
import { createRateLimiter } from "../../middleware/rateLimiter";
import {
  createSsoLaunchToken,
  consumeSsoLaunchToken,
  getOrCreateSsoConfig,
  listSsoDomains,
} from "../../services/ssoService";

export const v1SsoRouter = Router();

const ssoLaunchLimiter = createRateLimiter({
  windowMs: 60000,
  max: 120,
  keyGenerator: (req) => `sso_launch:${(req as any).apiKey?.id || req.ip}`,
  errorCode: "SSO_LAUNCH_RATE_LIMIT",
  errorMessage: "SSO launch token rate limit exceeded. Max 120 tokens per minute.",
});

const ssoConsumeLimiter = createRateLimiter({
  windowMs: 60000,
  max: 200,
  keyGenerator: (req) => `sso_consume:${req.ip}`,
  errorCode: "SSO_CONSUME_RATE_LIMIT",
  errorMessage: "SSO consume rate limit exceeded.",
});

/**
 * POST /api/v1/sso/launch-token (and /v1/sso/launch-token)
 * Server-to-server endpoint for minting single-use SSO launch tokens.
 * Authenticated via private API Key (`sec_live_...` or `sec_test_...`).
 */
v1SsoRouter.post(
  "/launch-token",
  apiKeyAuth(),
  requirePermission("tokens:write"),
  ssoLaunchLimiter,
  async (req: Request, res: Response) => {
    try {
      const organization = (req as any).organization;
      const apiKey = (req as any).apiKey;

      const {
        roomCode,
        userId,
        externalSubject,
        email,
        name,
        role,
        externalIssuer,
        permissions,
        expiresInSeconds,
      } = req.body;

      const effectiveUserId = (typeof userId === "string" ? userId : typeof externalSubject === "string" ? externalSubject : "").trim();

      if (!roomCode || typeof roomCode !== "string") {
        return res.status(400).json({
          error: "roomCode is required and must be a valid string",
          code: "MISSING_ROOM_CODE",
        });
      }

      if (!effectiveUserId) {
        return res.status(400).json({
          error: "userId / externalSubject is required",
          code: "MISSING_USER_ID",
        });
      }

      if (!email || typeof email !== "string" || !email.includes("@")) {
        return res.status(400).json({
          error: "A valid user email address is required",
          code: "INVALID_EMAIL",
        });
      }

      if (!name || typeof name !== "string") {
        return res.status(400).json({
          error: "name is required",
          code: "MISSING_NAME",
        });
      }

      const result = await createSsoLaunchToken({
        organizationId: organization.id,
        apiKeyId: apiKey?.id,
        roomCode,
        userId: effectiveUserId,
        email,
        name,
        role,
        externalIssuer,
        permissions,
        expiresInSeconds,
      });

      return res.status(201).json(result);
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return res.status(statusCode).json({
        error: err.message || "Failed to generate SSO launch token",
        code: err.code || "SSO_LAUNCH_ERROR",
      });
    }
  }
);

/**
 * POST /api/v1/sso/consume-token (and /v1/sso/consume-token)
 * Public endpoint for browser/SDK clients to exchange a single-use launch token
 * for an authoritative participant JWT. Enforces replay protection and room-binding.
 */
v1SsoRouter.post("/consume-token", ssoConsumeLimiter, async (req: Request, res: Response) => {
  try {
    const { token, launchToken, roomCode } = req.body;
    const effectiveToken = String(token || launchToken || "").trim();

    if (!effectiveToken) {
      return res.status(400).json({
        error: "Launch token is required",
        code: "MISSING_TOKEN",
      });
    }

    const result = await consumeSsoLaunchToken({
      rawToken: effectiveToken,
      roomCode: roomCode ? String(roomCode).trim() : undefined,
    });

    return res.json(result);
  } catch (err: any) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      error: err.message || "Failed to consume SSO launch token",
      code: err.code || "SSO_CONSUME_ERROR",
    });
  }
});

/**
 * GET /api/v1/sso/config
 * M2M query for organization SSO configuration and verified domains.
 */
v1SsoRouter.get(
  "/config",
  apiKeyAuth(),
  requirePermission("rooms:read"),
  async (req: Request, res: Response) => {
    try {
      const organization = (req as any).organization;
      const config = await getOrCreateSsoConfig(organization.id);
      const domains = await listSsoDomains(organization.id);

      return res.json({
        organizationId: organization.id,
        ssoEnabled: config.ssoEnabled,
        defaultRole: config.defaultRole,
        allowAutoProvisioning: config.allowAutoProvisioning,
        domains: domains.map((d) => ({
          id: d.id,
          domain: d.domain,
          isVerified: d.isVerified,
        })),
      });
    } catch (err: any) {
      return res.status(500).json({
        error: "Failed to retrieve SSO configuration",
        code: "SERVER_ERROR",
      });
    }
  }
);
