import { Router, Request, Response } from "express";
import crypto from "node:crypto";
import { requireAuth } from "./auth";
import { requirePlatformSuperadmin, isPlatformSuperadmin } from "../middleware/superadminAuth";
import { query } from "../db";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  ApiKeyEnvironment,
} from "../services/apiKeyService";
import { logger } from "../services/logger";

export const adminRouter = Router();

/**
 * GET /api/admin/check
 * Lightweight check returning whether the current session is a platform superadmin
 */
adminRouter.get("/check", requireAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const isSuper = await isPlatformSuperadmin(user.id);
  return res.json({ isSuperadmin: isSuper });
});

/**
 * GET /api/admin/organizations
 * Lists all customer organizations across the platform with owner details, key counts, and search
 */
adminRouter.get("/organizations", requireAuth, requirePlatformSuperadmin, async (req: Request, res: Response) => {
  try {
    const { q, limit = "50", offset = "0", status } = req.query;
    const searchFilter = typeof q === "string" && q.trim().length > 0 ? q.trim().toLowerCase() : null;
    const statusFilter = typeof status === "string" && status.trim().length > 0 ? status.trim().toLowerCase() : null;
    const parsedLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 100);
    const parsedOffset = Math.max(parseInt(String(offset), 10) || 0, 0);

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (searchFilter) {
      conditions.push(`(LOWER(o.name) LIKE $${paramIndex} OR LOWER(o.slug) LIKE $${paramIndex} OR LOWER(COALESCE(owner_user.email, '')) LIKE $${paramIndex})`);
      params.push(`%${searchFilter}%`);
      paramIndex++;
    }

    if (statusFilter) {
      conditions.push(`o.status = $${paramIndex}`);
      params.push(statusFilter);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sql = `
      SELECT 
        o.id, 
        o.name, 
        o.slug, 
        o.status, 
        o.plan_tier,
        o.monthly_minute_limit,
        o.max_concurrent_rooms,
        o.settings, 
        o.created_at, 
        o.updated_at,
        owner_user.id as owner_id,
        owner_user.email as owner_email,
        owner_user.full_name as owner_name,
        (SELECT COUNT(*)::int FROM organization_members WHERE organization_id = o.id) as member_count,
        (SELECT COUNT(*)::int FROM api_keys WHERE organization_id = o.id AND is_active = TRUE) as active_keys_count,
        (SELECT COUNT(*)::int FROM customer_apps WHERE organization_id = o.id) as apps_count
      FROM organizations o
      LEFT JOIN organization_members owner_member ON o.id = owner_member.organization_id AND owner_member.role = 'owner'
      LEFT JOIN users owner_user ON owner_member.user_id = owner_user.id
      ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
    `;

    params.push(parsedLimit, parsedOffset);
    const result = await query(sql, params);

    // Get total count
    const countSql = `
      SELECT COUNT(*)::int as total
      FROM organizations o
      LEFT JOIN organization_members owner_member ON o.id = owner_member.organization_id AND owner_member.role = 'owner'
      LEFT JOIN users owner_user ON owner_member.user_id = owner_user.id
      ${whereClause};
    `;
    const countResult = await query(countSql, params.slice(0, paramIndex - 1));
    const total = countResult.rows[0]?.total || 0;

    return res.json({
      organizations: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        status: row.status,
        planTier: row.plan_tier || "free",
        monthlyMinuteLimit: row.monthly_minute_limit || 10000,
        maxConcurrentRooms: row.max_concurrent_rooms || 10,
        settings: row.settings || {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        owner: row.owner_id ? {
          id: row.owner_id,
          email: row.owner_email,
          name: row.owner_name,
        } : null,
        memberCount: row.member_count,
        activeKeysCount: row.active_keys_count,
        appsCount: row.apps_count,
      })),
      total,
      limit: parsedLimit,
      offset: parsedOffset,
    });
  } catch (err: any) {
    logger.error("[Admin Organizations GET Error]", { error: err.message });
    return res.status(500).json({ error: "Failed to list platform organizations", details: err.message });
  }
});

/**
 * POST /api/admin/organizations
 * Superadmin-driven onboarding: creates a customer organization and attaches designated owner
 */
adminRouter.post("/organizations", requireAuth, requirePlatformSuperadmin, async (req: Request, res: Response) => {
  try {
    const superadmin = (req as any).user;
    const { name, slug, ownerEmail, planTier = "free", settings } = req.body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Organization name is required" });
    }

    const trimmedName = name.trim();
    let baseSlug = (slug && typeof slug === "string" ? slug : trimmedName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (!baseSlug) baseSlug = "org";

    const uniqueSuffix = crypto.randomBytes(3).toString("hex");
    const finalSlug = `${baseSlug}-${uniqueSuffix}`;

    const defaultSettings = {
      max_room_duration_min: 240,
      default_camera_locked: true,
      onboarded_by_superadmin: true,
      superadmin_id: superadmin.id,
      ...(settings && typeof settings === "object" ? settings : {}),
    };

    // Insert organization
    const insertSql = `
      INSERT INTO organizations (name, slug, status, plan_tier, settings)
      VALUES ($1, $2, 'active', $3, $4::jsonb)
      RETURNING id, name, slug, status, plan_tier, settings, created_at, updated_at;
    `;
    const orgRes = await query(insertSql, [trimmedName, finalSlug, planTier, JSON.stringify(defaultSettings)]);
    const org = orgRes.rows[0];

    // Determine owner: If ownerEmail is provided and matches an existing user, make them owner
    let designatedOwnerId = superadmin.id;
    let designatedOwnerEmail = superadmin.email;
    let ownerLinked = false;

    if (ownerEmail && typeof ownerEmail === "string" && ownerEmail.trim().length > 0) {
      const trimmedEmail = ownerEmail.trim().toLowerCase();
      const userRes = await query("SELECT id, email, full_name FROM users WHERE LOWER(email) = $1;", [trimmedEmail]);
      if (userRes.rows.length > 0) {
        designatedOwnerId = userRes.rows[0].id;
        designatedOwnerEmail = userRes.rows[0].email;
        ownerLinked = true;
      }
    }

    // Insert owner into organization_members
    await query(
      `INSERT INTO organization_members (organization_id, user_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (organization_id, user_id) DO NOTHING;`,
      [org.id, designatedOwnerId]
    );

    // Record superadmin audit event
    await query(
      `INSERT INTO api_key_audit_logs (organization_id, action, actor_id, metadata, ip_address)
       VALUES ($1, 'created', $2, $3::jsonb, $4);`,
      [
        org.id,
        superadmin.id,
        JSON.stringify({
          entity: "organization",
          superadmin_action: true,
          superadmin_email: superadmin.email,
          owner_email: designatedOwnerEmail,
          owner_linked: ownerLinked,
        }),
        req.ip,
      ]
    );

    logger.info("[Superadmin] Created customer organization", {
      orgId: org.id,
      name: org.name,
      superadminId: superadmin.id,
      ownerEmail: designatedOwnerEmail,
    });

    return res.status(201).json({
      message: "Customer organization created successfully",
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        status: org.status,
        planTier: org.plan_tier,
        settings: org.settings,
        createdAt: org.created_at,
        updatedAt: org.updated_at,
        owner: {
          id: designatedOwnerId,
          email: designatedOwnerEmail,
          linked: ownerLinked,
        },
      },
    });
  } catch (err: any) {
    logger.error("[Admin Organizations POST Error]", { error: err.message });
    return res.status(500).json({ error: "Failed to create customer organization", details: err.message });
  }
});

/**
 * GET /api/admin/organizations/:orgId
 * Detailed cross-tenant customer profile, including members, apps, and masked API keys
 */
adminRouter.get("/organizations/:orgId", requireAuth, requirePlatformSuperadmin, async (req: Request, res: Response) => {
  try {
    const orgId = String(req.params.orgId);

    const orgRes = await query(
      `SELECT id, name, slug, status, plan_tier, monthly_minute_limit, max_concurrent_rooms, settings, created_at, updated_at
       FROM organizations
       WHERE id = $1;`,
      [orgId]
    );

    if (orgRes.rows.length === 0) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const org = orgRes.rows[0];

    // Members
    const membersRes = await query(
      `SELECT om.id, om.role, om.created_at, u.id as user_id, u.email, u.full_name, u.avatar_url
       FROM organization_members om
       JOIN users u ON u.id = om.user_id
       WHERE om.organization_id = $1
       ORDER BY om.created_at ASC;`,
      [orgId]
    );

    // Apps (Allowed domains)
    const appsRes = await query(
      `SELECT id, app_name, allowed_domains, branding, created_at, updated_at
       FROM customer_apps
       WHERE organization_id = $1
       ORDER BY created_at DESC;`,
      [orgId]
    );

    // Masked API keys (Reuses listApiKeys service to guarantee no raw secrets)
    const keys = await listApiKeys(orgId);

    // Recent audit logs
    const auditRes = await query(
      `SELECT id, action, actor_id, key_prefix, metadata, ip_address, created_at
       FROM api_key_audit_logs
       WHERE organization_id = $1
       ORDER BY created_at DESC
       LIMIT 20;`,
      [orgId]
    );

    return res.json({
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        status: org.status,
        planTier: org.plan_tier || "free",
        monthlyMinuteLimit: org.monthly_minute_limit || 10000,
        maxConcurrentRooms: org.max_concurrent_rooms || 10,
        settings: org.settings || {},
        createdAt: org.created_at,
        updatedAt: org.updated_at,
      },
      members: membersRes.rows.map((m) => ({
        id: m.id,
        userId: m.user_id,
        name: m.full_name,
        email: m.email,
        avatarUrl: m.avatar_url,
        role: m.role,
        createdAt: m.created_at,
      })),
      apps: appsRes.rows.map((a) => ({
        id: a.id,
        appName: a.app_name,
        allowedDomains: a.allowed_domains || [],
        branding: a.branding || {},
        createdAt: a.created_at,
      })),
      keys,
      recentAuditLogs: auditRes.rows,
    });
  } catch (err: any) {
    logger.error("[Admin Organization GET Error]", { error: err.message, orgId: req.params.orgId });
    return res.status(500).json({ error: "Failed to load organization details" });
  }
});

/**
 * POST /api/admin/organizations/:orgId/keys
 * Issues a new API key for the customer organization on behalf of platform owner.
 * Returns raw secret ONCE.
 */
adminRouter.post("/organizations/:orgId/keys", requireAuth, requirePlatformSuperadmin, async (req: Request, res: Response) => {
  try {
    const orgId = String(req.params.orgId);
    const superadmin = (req as any).user;
    const { name, environment = "live", permissions, expires_at } = req.body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "API key name is required" });
    }

    // Verify organization exists
    const orgCheck = await query("SELECT id, name FROM organizations WHERE id = $1;", [orgId]);
    if (orgCheck.rows.length === 0) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const env: ApiKeyEnvironment = environment === "test" ? "test" : "live";
    const expiresAt = expires_at ? new Date(expires_at) : null;

    const result = await createApiKey({
      organizationId: orgId,
      name: name.trim(),
      environment: env,
      permissions: Array.isArray(permissions) ? permissions : ["rooms:read", "rooms:write", "tokens:write"],
      expiresAt,
      actorId: superadmin.id,
      ipAddress: req.ip,
    });

    // Augment audit log to tag superadmin issuance
    await query(
      `UPDATE api_key_audit_logs
       SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{issued_by_superadmin}', 'true'::jsonb)
       WHERE api_key_id = $1 AND action = 'created';`,
      [result.apiKey.id]
    );

    logger.info("[Superadmin] Issued API key for customer organization", {
      orgId,
      keyId: result.apiKey.id,
      keyName: name.trim(),
      environment: env,
      superadminId: superadmin.id,
    });

    return res.status(201).json({
      message: "API key generated successfully. Reveal raw key now — it cannot be recovered again.",
      rawKey: result.rawKey,
      apiKey: result.apiKey,
    });
  } catch (err: any) {
    if (err.code === "KEY_NAME_EXISTS" || err.statusCode === 409) {
      return res.status(409).json({ error: err.message, code: "KEY_NAME_EXISTS" });
    }
    logger.error("[Admin API Key POST Error]", { error: err.message, orgId: req.params.orgId });
    return res.status(500).json({ error: "Failed to issue API key", details: err.message });
  }
});

/**
 * POST /api/admin/organizations/:orgId/keys/:keyId/rotate
 * Superadmin rotates a customer API key. Revokes previous key and returns new raw secret ONCE.
 */
adminRouter.post("/organizations/:orgId/keys/:keyId/rotate", requireAuth, requirePlatformSuperadmin, async (req: Request, res: Response) => {
  try {
    const orgId = String(req.params.orgId);
    const keyId = String(req.params.keyId);
    const superadmin = (req as any).user;

    const result = await rotateApiKey({
      organizationId: orgId,
      keyId,
      actorId: superadmin.id,
      ipAddress: req.ip,
    });

    logger.info("[Superadmin] Rotated customer API key", {
      orgId,
      oldKeyId: keyId,
      newKeyId: result.apiKey.id,
      superadminId: superadmin.id,
    });

    return res.json({
      message: "API key rotated successfully. Store the new secret key securely.",
      rawKey: result.rawKey,
      apiKey: result.apiKey,
    });
  } catch (err: any) {
    logger.error("[Admin API Key ROTATE Error]", { error: err.message, orgId: req.params.orgId, keyId: req.params.keyId });
    return res.status(500).json({ error: "Failed to rotate API key", details: err.message });
  }
});

/**
 * DELETE /api/admin/organizations/:orgId/keys/:keyId
 * Superadmin revokes a customer API key
 */
adminRouter.delete("/organizations/:orgId/keys/:keyId", requireAuth, requirePlatformSuperadmin, async (req: Request, res: Response) => {
  try {
    const orgId = String(req.params.orgId);
    const keyId = String(req.params.keyId);
    const superadmin = (req as any).user;

    const success = await revokeApiKey({
      organizationId: orgId,
      keyId,
      actorId: superadmin.id,
      ipAddress: req.ip,
    });

    if (!success) {
      return res.status(404).json({ error: "API key not found or already deleted" });
    }

    logger.info("[Superadmin] Revoked customer API key", {
      orgId,
      keyId,
      superadminId: superadmin.id,
    });

    return res.json({ success: true, message: "API key revoked successfully" });
  } catch (err: any) {
    logger.error("[Admin API Key DELETE Error]", { error: err.message, orgId: req.params.orgId, keyId: req.params.keyId });
    return res.status(500).json({ error: "Failed to revoke API key" });
  }
});
