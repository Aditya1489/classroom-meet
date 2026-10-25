import { Request, Response, NextFunction } from "express";
import { verifyApiKey, ApiKeyEnvironment } from "../services/apiKeyService";
import { query } from "../db";

// ============================================================================
// API KEY AUTHENTICATION & PERMISSION MIDDLEWARE
// ============================================================================
// Features:
// 1. Validates Bearer sec_live_... / sec_test_... headers
// 2. Sliding window in-memory rate limiting per API key
// 3. Organization isolation & environment checks
// 4. Granular scope/permission enforcement
// ============================================================================

// In-memory sliding window rate limiter per API key ID: Max 100 requests per 10 seconds
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 10000;
const RATE_LIMIT_MAX_REQUESTS = 100;

function isKeyRateLimited(keyId: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(keyId) || [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }
  recent.push(now);
  rateLimitMap.set(keyId, recent);
  return false;
}

// Prune stale rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [keyId, timestamps] of rateLimitMap.entries()) {
    const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS * 2);
    if (recent.length === 0) {
      rateLimitMap.delete(keyId);
    } else {
      rateLimitMap.set(keyId, recent);
    }
  }
}, 60000);

export function apiKeyAuth(options?: { environment?: ApiKeyEnvironment }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      let rawKey: string | null = null;

      // Extract from Authorization: Bearer <key>
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        if (token.startsWith("sec_live_") || token.startsWith("sec_test_")) {
          rawKey = token;
        }
      }

      // Fallback to x-api-key header
      if (!rawKey && typeof req.headers["x-api-key"] === "string") {
        rawKey = req.headers["x-api-key"];
      }

      if (!rawKey) {
        return res.status(401).json({
          error: "Unauthorized: Missing API key. Provide Bearer sec_live_... or x-api-key header.",
          code: "MISSING_API_KEY",
        });
      }

      // Verify key
      const result = await verifyApiKey(rawKey, options?.environment);
      if (!result.valid || !result.apiKey || !result.organization) {
        if (result.code === "WRONG_ENVIRONMENT") {
          return res.status(401).json({ error: result.error, code: "WRONG_ENVIRONMENT" });
        }
        if (result.code === "REVOKED") {
          return res.status(401).json({ error: "Unauthorized: API key has been revoked", code: "KEY_REVOKED" });
        }
        if (result.code === "EXPIRED") {
          return res.status(401).json({ error: "Unauthorized: API key has expired", code: "KEY_EXPIRED" });
        }
        if (result.code === "ORG_SUSPENDED") {
          return res.status(403).json({ error: "Forbidden: Organization account is suspended", code: "ORG_SUSPENDED" });
        }
        return res.status(401).json({ error: "Unauthorized: Invalid API key", code: "INVALID_KEY" });
      }

      // Rate limiting check
      if (isKeyRateLimited(result.apiKey.id)) {
        res.setHeader("Retry-After", "10");
        // Log rate limit audit asynchronously
        query(
          `INSERT INTO api_key_audit_logs (organization_id, api_key_id, action, actor_id, key_prefix, metadata, ip_address)
           VALUES ($1, $2, 'rate_limited', 'system', $3, '{"reason": "sliding_window_burst"}'::jsonb, $4);`,
          [result.organization.id, result.apiKey.id, result.apiKey.key_prefix, req.ip || null]
        ).catch(() => {});

        return res.status(429).json({
          error: "Too Many Requests: Rate limit exceeded for this API key. Please retry shortly.",
          code: "RATE_LIMIT_EXCEEDED",
        });
      }

      // Attach verified context
      (req as any).apiKey = result.apiKey;
      (req as any).organization = result.organization;
      (req as any).environment = result.apiKey.environment;

      return next();
    } catch (err: any) {
      console.error("[ApiKeyAuth Error]:", err.message);
      return res.status(500).json({ error: "Internal server error during authentication" });
    }
  };
}

/**
 * Middleware ensuring the authenticated API key possesses a specific scope/permission
 */
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const apiKey = (req as any).apiKey;
    if (!apiKey) {
      return res.status(401).json({ error: "Unauthorized", code: "MISSING_API_KEY" });
    }

    const permissions: string[] = Array.isArray(apiKey.permissions) ? apiKey.permissions : [];
    if (!permissions.includes(permission) && !permissions.includes("*") && !permissions.includes("admin")) {
      // Log permission denied event
      query(
        `INSERT INTO api_key_audit_logs (organization_id, api_key_id, action, actor_id, key_prefix, metadata, ip_address)
         VALUES ($1, $2, 'permission_denied', 'system', $3, $4::jsonb, $5);`,
        [
          apiKey.organization_id,
          apiKey.id,
          apiKey.key_prefix,
          JSON.stringify({ requiredPermission: permission, activePermissions: permissions }),
          req.ip || null,
        ]
      ).catch(() => {});

      return res.status(403).json({
        error: `Forbidden: API key lacks required permission '${permission}'`,
        code: "INSUFFICIENT_PERMISSIONS",
        required: permission,
      });
    }

    return next();
  };
}
