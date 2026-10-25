import { Router, Request, Response } from "express";
import { requireAuth } from "./auth";
import { query } from "../db";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  ApiKeyEnvironment,
} from "../services/apiKeyService";

export const apiKeysRouter = Router({ mergeParams: true });

/**
 * Middleware ensuring user has admin/owner/developer role within the specified organization
 */
async function requireOrgRole(req: Request, res: Response, allowedRoles = ["owner", "admin", "developer"]) {
  const user = (req as any).user;
  const { orgId } = req.params;

  if (!orgId) {
    res.status(400).json({ error: "Missing organization identifier" });
    return false;
  }

  // First-party system organization check: allow first-party tutors or admins
  if (orgId === "00000000-0000-0000-0000-000000000001" && (user.role === "tutor" || user.role === "admin")) {
    return true;
  }

  const memberRes = await query(
    "SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2;",
    [orgId, user.id]
  );

  if (memberRes.rows.length === 0 || !allowedRoles.includes(memberRes.rows[0].role)) {
    res.status(403).json({
      error: "Forbidden: You do not have permission to manage API keys for this organization",
      code: "ORG_ACCESS_DENIED",
    });
    return false;
  }

  return true;
}

/**
 * POST /api/organizations/:orgId/keys
 * Create a new API Key (Raw secret returned ONCE)
 */
apiKeysRouter.post("/:orgId/keys", requireAuth, async (req: Request, res: Response) => {
  try {
    const authorized = await requireOrgRole(req, res, ["owner", "admin", "developer"]);
    if (!authorized) return;

    const orgId = String(req.params.orgId);
    const { name, environment = "live", permissions, expires_at } = req.body;
    const user = (req as any).user;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "API key name is required" });
    }

    const env: ApiKeyEnvironment = environment === "test" ? "test" : "live";
    const expiresAt = expires_at ? new Date(expires_at) : null;

    const result = await createApiKey({
      organizationId: orgId,
      name: name.trim(),
      environment: env,
      permissions: Array.isArray(permissions) ? permissions : ["rooms:read", "rooms:write", "tokens:write"],
      expiresAt,
      actorId: user.id,
      ipAddress: req.ip,
    });

    return res.status(201).json({
      message: "API key created successfully. Store the raw key securely — it will not be displayed again.",
      rawKey: result.rawKey,
      apiKey: result.apiKey,
    });
  } catch (err: any) {
    console.error("[ApiKeys POST Error]:", err.message);
    return res.status(500).json({ error: "Failed to create API key", details: err.message });
  }
});

/**
 * GET /api/organizations/:orgId/keys
 * List masked API keys for organization
 */
apiKeysRouter.get("/:orgId/keys", requireAuth, async (req: Request, res: Response) => {
  try {
    const authorized = await requireOrgRole(req, res, ["owner", "admin", "developer", "viewer"]);
    if (!authorized) return;

    const orgId = String(req.params.orgId);
    const keys = await listApiKeys(orgId);

    return res.json({ keys });
  } catch (err: any) {
    console.error("[ApiKeys GET Error]:", err.message);
    return res.status(500).json({ error: "Failed to list API keys" });
  }
});

/**
 * DELETE /api/organizations/:orgId/keys/:keyId
 * Revoke an API key
 */
apiKeysRouter.delete("/:orgId/keys/:keyId", requireAuth, async (req: Request, res: Response) => {
  try {
    const authorized = await requireOrgRole(req, res, ["owner", "admin"]);
    if (!authorized) return;

    const orgId = String(req.params.orgId);
    const keyId = String(req.params.keyId);
    const user = (req as any).user;

    const success = await revokeApiKey({
      organizationId: orgId,
      keyId,
      actorId: user.id,
      ipAddress: req.ip,
    });

    if (!success) {
      return res.status(404).json({ error: "API key not found or already deleted" });
    }

    return res.json({ success: true, message: "API key revoked successfully" });
  } catch (err: any) {
    console.error("[ApiKeys DELETE Error]:", err.message);
    return res.status(500).json({ error: "Failed to revoke API key" });
  }
});

/**
 * POST /api/organizations/:orgId/keys/:keyId/rotate
 * Rotate an existing API key
 */
apiKeysRouter.post("/:orgId/keys/:keyId/rotate", requireAuth, async (req: Request, res: Response) => {
  try {
    const authorized = await requireOrgRole(req, res, ["owner", "admin"]);
    if (!authorized) return;

    const orgId = String(req.params.orgId);
    const keyId = String(req.params.keyId);
    const user = (req as any).user;

    const result = await rotateApiKey({
      organizationId: orgId,
      keyId,
      actorId: user.id,
      ipAddress: req.ip,
    });

    return res.json({
      message: "API key rotated successfully. Store the new raw key securely.",
      rawKey: result.rawKey,
      apiKey: result.apiKey,
    });
  } catch (err: any) {
    console.error("[ApiKeys ROTATE Error]:", err.message);
    return res.status(500).json({ error: "Failed to rotate API key", details: err.message });
  }
});

/**
 * GET /api/organizations/:orgId/keys/audit
 * View audit log history for key lifecycle events
 */
apiKeysRouter.get("/:orgId/keys/audit", requireAuth, async (req: Request, res: Response) => {
  try {
    const authorized = await requireOrgRole(req, res, ["owner", "admin"]);
    if (!authorized) return;

    const orgId = String(req.params.orgId);
    const logsRes = await query(
      `SELECT id, organization_id, api_key_id, action, actor_id, key_prefix, metadata, ip_address, created_at
       FROM api_key_audit_logs
       WHERE organization_id = $1
       ORDER BY created_at DESC
       LIMIT 100;`,
      [orgId]
    );

    return res.json({ auditLogs: logsRes.rows });
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to retrieve audit logs" });
  }
});
