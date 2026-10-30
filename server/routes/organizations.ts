import { Router, Request, Response } from "express";
import crypto from "node:crypto";
import { requireAuth } from "./auth";
import { query } from "../db";
import { requireOrgRole } from "./apiKeys";
import { getOrganizationUsageSummary } from "../services/meteringService";
import { logger } from "../services/logger";
import { invalidateOriginCache } from "../services/originValidationService";

export const organizationsRouter = Router();

/**
 * Normalizes an origin string for allowed domains
 */
function normalizeDomain(d: string): string {
  return d.trim().toLowerCase().replace(/\/$/, "");
}

/**
 * GET /api/organizations
 * List all organizations where the authenticated user is a member
 */
organizationsRouter.get("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;

    const sql = `
      SELECT o.id, o.name, o.slug, o.status, o.settings, o.created_at, o.updated_at, om.role
      FROM organizations o
      JOIN organization_members om ON o.id = om.organization_id
      WHERE om.user_id = $1
      ORDER BY o.created_at DESC;
    `;
    const result = await query(sql, [user.id]);

    return res.json({
      organizations: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        status: row.status,
        role: row.role,
        settings: row.settings || {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (err: any) {
    console.error("[Organizations GET Error]:", err.message);
    return res.status(500).json({ error: "Failed to list organizations" });
  }
});

/**
 * POST /api/organizations
 * Create a new customer organization and assign creator as 'owner'
 */
organizationsRouter.post("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { name, slug, settings } = req.body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Organization name is required" });
    }

    const trimmedName = name.trim();
    // Generate slug from name or custom slug
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
      ...(settings && typeof settings === "object" ? settings : {}),
    };

    // Insert organization
    const insertOrgSql = `
      INSERT INTO organizations (name, slug, status, settings)
      VALUES ($1, $2, 'active', $3::jsonb)
      RETURNING id, name, slug, status, settings, created_at, updated_at;
    `;
    const orgRes = await query(insertOrgSql, [trimmedName, finalSlug, JSON.stringify(defaultSettings)]);
    const org = orgRes.rows[0];

    // Add creator to organization_members as 'owner'
    await query(
      `INSERT INTO organization_members (organization_id, user_id, role)
       VALUES ($1, $2, 'owner');`,
      [org.id, user.id]
    );

    return res.status(201).json({
      message: "Organization created successfully",
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        status: org.status,
        settings: org.settings,
        createdAt: org.created_at,
        updatedAt: org.updated_at,
      },
      role: "owner",
    });
  } catch (err: any) {
    console.error("[Organizations POST Error]:", err.message);
    return res.status(500).json({ error: "Failed to create organization", details: err.message });
  }
});

/**
 * GET /api/organizations/:orgId
 * Fetch single organization details
 */
organizationsRouter.get("/:orgId", requireAuth, async (req: Request, res: Response) => {
  try {
    const authorized = await requireOrgRole(req, res, ["owner", "admin", "developer", "member", "viewer"]);
    if (!authorized) return;

    const orgId = String(req.params.orgId);
    const user = (req as any).user;

    const orgRes = await query(
      `SELECT o.id, o.name, o.slug, o.status, o.settings, o.created_at, o.updated_at, om.role
       FROM organizations o
       LEFT JOIN organization_members om ON o.id = om.organization_id AND om.user_id = $2
       WHERE o.id = $1;`,
      [orgId, user.id]
    );

    if (orgRes.rows.length === 0) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const row = orgRes.rows[0];
    return res.json({
      organization: {
        id: row.id,
        name: row.name,
        slug: row.slug,
        status: row.status,
        role: row.role || (user.role === "admin" ? "admin" : "member"),
        settings: row.settings || {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (err: any) {
    console.error("[Organizations GET by ID Error]:", err.message);
    return res.status(500).json({ error: "Failed to retrieve organization" });
  }
});

/**
 * PATCH /api/organizations/:orgId
 * Update organization name and settings (owner/admin only)
 */
organizationsRouter.patch("/:orgId", requireAuth, async (req: Request, res: Response) => {
  try {
    const authorized = await requireOrgRole(req, res, ["owner", "admin"]);
    if (!authorized) return;

    const orgId = String(req.params.orgId);
    const { name, settings } = req.body;

    const currentRes = await query("SELECT id, name, settings FROM organizations WHERE id = $1;", [orgId]);
    if (currentRes.rows.length === 0) {
      return res.status(404).json({ error: "Organization not found" });
    }
    const current = currentRes.rows[0];

    const updatedName = typeof name === "string" && name.trim().length > 0 ? name.trim() : current.name;
    const updatedSettings = settings && typeof settings === "object" ? { ...current.settings, ...settings } : current.settings;

    const updateRes = await query(
      `UPDATE organizations 
       SET name = $1, settings = $2::jsonb, updated_at = NOW() 
       WHERE id = $3 
       RETURNING id, name, slug, status, settings, created_at, updated_at;`,
      [updatedName, JSON.stringify(updatedSettings), orgId]
    );

    const row = updateRes.rows[0];
    return res.json({
      message: "Organization updated successfully",
      organization: {
        id: row.id,
        name: row.name,
        slug: row.slug,
        status: row.status,
        settings: row.settings,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (err: any) {
    console.error("[Organizations PATCH Error]:", err.message);
    return res.status(500).json({ error: "Failed to update organization", details: err.message });
  }
});

/**
 * GET /api/organizations/:orgId/usage
 * Aggregated auditable usage metrics for the organization
 */
organizationsRouter.get("/:orgId/usage", requireAuth, async (req: Request, res: Response) => {
  try {
    const authorized = await requireOrgRole(req, res, ["owner", "admin", "developer", "viewer"]);
    if (!authorized) return;

    const orgId = String(req.params.orgId);
    const { startDate, endDate } = req.query;

    let parsedStart: Date | undefined;
    if (startDate !== undefined) {
      if (typeof startDate !== "string" || startDate.trim().length === 0) {
        return res.status(400).json({ error: "Invalid startDate format. Expected a valid date string." });
      }
      parsedStart = new Date(startDate.trim());
      if (isNaN(parsedStart.getTime())) {
        return res.status(400).json({ error: "Invalid startDate format. Expected a valid date string." });
      }
    }

    let parsedEnd: Date | undefined;
    if (endDate !== undefined) {
      if (typeof endDate !== "string" || endDate.trim().length === 0) {
        return res.status(400).json({ error: "Invalid endDate format. Expected a valid date string." });
      }
      parsedEnd = new Date(endDate.trim());
      if (isNaN(parsedEnd.getTime())) {
        return res.status(400).json({ error: "Invalid endDate format. Expected a valid date string." });
      }
    }

    if (parsedStart && parsedEnd && parsedStart.getTime() > parsedEnd.getTime()) {
      return res.status(400).json({ error: "startDate must not be after endDate." });
    }

    const summary = await getOrganizationUsageSummary(
      orgId,
      parsedStart ? parsedStart.toISOString() : undefined,
      parsedEnd ? parsedEnd.toISOString() : undefined
    );

    return res.json({ usage: summary });
  } catch (err: any) {
    logger.error("Failed to retrieve organization usage summary", { error: err.message });
    return res.status(500).json({ error: "Failed to retrieve usage summary" });
  }
});

// ============================================================================
// CUSTOMER APPS (ALLOWED DOMAINS & BRANDING) CRUD ROUTES
// ============================================================================

/**
 * GET /api/organizations/:orgId/apps
 * List customer apps for the organization
 */
organizationsRouter.get("/:orgId/apps", requireAuth, async (req: Request, res: Response) => {
  try {
    const authorized = await requireOrgRole(req, res, ["owner", "admin", "developer", "viewer"]);
    if (!authorized) return;

    const orgId = String(req.params.orgId);
    const resApps = await query(
      `SELECT id, organization_id, app_name, allowed_domains, branding, created_at, updated_at
       FROM customer_apps
       WHERE organization_id = $1
       ORDER BY created_at DESC;`,
      [orgId]
    );

    return res.json({
      apps: resApps.rows.map((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        appName: row.app_name,
        allowedDomains: Array.isArray(row.allowed_domains) ? row.allowed_domains : [],
        branding: row.branding || {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (err: any) {
    console.error("[CustomerApps GET Error]:", err.message);
    return res.status(500).json({ error: "Failed to list customer apps" });
  }
});

/**
 * POST /api/organizations/:orgId/apps
 * Create a new customer app with allowed domains and branding
 */
organizationsRouter.post("/:orgId/apps", requireAuth, async (req: Request, res: Response) => {
  try {
    const authorized = await requireOrgRole(req, res, ["owner", "admin", "developer"]);
    if (!authorized) return;

    const orgId = String(req.params.orgId);
    const { appName, allowedDomains, branding } = req.body;

    if (!appName || typeof appName !== "string" || appName.trim().length === 0) {
      return res.status(400).json({ error: "appName is required" });
    }

    const trimmedAppName = appName.trim();

    // Check duplicate app name in this organization
    const existing = await query(
      "SELECT id FROM customer_apps WHERE organization_id = $1 AND app_name = $2;",
      [orgId, trimmedAppName]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: `An application with name '${trimmedAppName}' already exists in this organization`,
        code: "APP_NAME_EXISTS",
      });
    }

    const domains: string[] = Array.isArray(allowedDomains)
      ? allowedDomains.filter((d) => typeof d === "string" && d.trim().length > 0).map(normalizeDomain)
      : [];

    const brandingObj = {
      logoUrl: branding?.logoUrl || null,
      primaryColor: branding?.primaryColor || "#4f46e5",
      ...(branding && typeof branding === "object" ? branding : {}),
    };

    const insertSql = `
      INSERT INTO customer_apps (organization_id, app_name, allowed_domains, branding)
      VALUES ($1, $2, $3::text[], $4::jsonb)
      RETURNING id, organization_id, app_name, allowed_domains, branding, created_at, updated_at;
    `;

    const insertRes = await query(insertSql, [
      orgId,
      trimmedAppName,
      domains,
      JSON.stringify(brandingObj),
    ]);
    invalidateOriginCache();
    const row = insertRes.rows[0];

    return res.status(201).json({
      message: "Customer app created successfully",
      app: {
        id: row.id,
        organizationId: row.organization_id,
        appName: row.app_name,
        allowedDomains: row.allowed_domains,
        branding: row.branding,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (err: any) {
    if (err.code === "23505") {
      return res.status(409).json({
        error: "An application with this name already exists",
        code: "APP_NAME_EXISTS",
      });
    }
    console.error("[CustomerApps POST Error]:", err.message);
    return res.status(500).json({ error: "Failed to create customer app", details: err.message });
  }
});

/**
 * PATCH /api/organizations/:orgId/apps/:appId
 * Update customer app allowed domains, branding, or app name
 */
organizationsRouter.patch("/:orgId/apps/:appId", requireAuth, async (req: Request, res: Response) => {
  try {
    const authorized = await requireOrgRole(req, res, ["owner", "admin", "developer"]);
    if (!authorized) return;

    const orgId = String(req.params.orgId);
    const appId = String(req.params.appId);
    const { appName, allowedDomains, branding } = req.body;

    const currentRes = await query(
      "SELECT * FROM customer_apps WHERE id = $1 AND organization_id = $2;",
      [appId, orgId]
    );
    if (currentRes.rows.length === 0) {
      return res.status(404).json({ error: "Customer app not found" });
    }
    const current = currentRes.rows[0];

    const updatedName = typeof appName === "string" && appName.trim().length > 0 ? appName.trim() : current.app_name;
    const updatedDomains = Array.isArray(allowedDomains)
      ? allowedDomains.filter((d) => typeof d === "string" && d.trim().length > 0).map(normalizeDomain)
      : current.allowed_domains;
    const updatedBranding = branding && typeof branding === "object" ? { ...current.branding, ...branding } : current.branding;

    const updateRes = await query(
      `UPDATE customer_apps 
       SET app_name = $1, allowed_domains = $2::text[], branding = $3::jsonb, updated_at = NOW()
       WHERE id = $4 AND organization_id = $5
       RETURNING id, organization_id, app_name, allowed_domains, branding, created_at, updated_at;`,
      [updatedName, updatedDomains, JSON.stringify(updatedBranding), appId, orgId]
    );
    invalidateOriginCache();
    const row = updateRes.rows[0];

    return res.json({
      message: "Customer app updated successfully",
      app: {
        id: row.id,
        organizationId: row.organization_id,
        appName: row.app_name,
        allowedDomains: row.allowed_domains,
        branding: row.branding,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (err: any) {
    console.error("[CustomerApps PATCH Error]:", err.message);
    return res.status(500).json({ error: "Failed to update customer app", details: err.message });
  }
});

/**
 * DELETE /api/organizations/:orgId/apps/:appId
 * Delete a customer app
 */
organizationsRouter.delete("/:orgId/apps/:appId", requireAuth, async (req: Request, res: Response) => {
  try {
    const authorized = await requireOrgRole(req, res, ["owner", "admin"]);
    if (!authorized) return;

    const orgId = String(req.params.orgId);
    const appId = String(req.params.appId);

    const deleteRes = await query(
      "DELETE FROM customer_apps WHERE id = $1 AND organization_id = $2 RETURNING id;",
      [appId, orgId]
    );

    if (deleteRes.rows.length === 0) {
      return res.status(404).json({ error: "Customer app not found" });
    }

    invalidateOriginCache();

    return res.json({ success: true, message: "Customer app deleted successfully" });
  } catch (err: any) {
    console.error("[CustomerApps DELETE Error]:", err.message);
    return res.status(500).json({ error: "Failed to delete customer app" });
  }
});
