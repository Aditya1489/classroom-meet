import { Router, Request, Response } from "express";
import { requireAuth } from "./auth";
import { requireOrgRole } from "./apiKeys";
import {
  getOrCreateSsoConfig,
  updateSsoConfig,
  listSsoDomains,
  addSsoDomain,
  removeSsoDomain,
  listSsoUsers,
  addAllowlistUser,
  updateSsoUser,
  deleteSsoUser,
} from "../services/ssoService";

export const ssoManagementRouter = Router({ mergeParams: true });

// All routes require authentication
ssoManagementRouter.use(requireAuth);

/**
 * GET /api/organizations/:orgId/sso/config
 * Retrieve SSO configuration, verified domains, and summary stats.
 */
ssoManagementRouter.get(
  "/:orgId/sso/config",
  async (req: Request, res: Response) => {
    try {
      const authorized = await requireOrgRole(req, res, ["owner", "admin", "developer", "member"]);
      if (!authorized) return;

      const orgId = String(req.params.orgId);
      const config = await getOrCreateSsoConfig(orgId);
      const domains = await listSsoDomains(orgId);
      const { total: userCount } = await listSsoUsers(orgId, { limit: 1 });

      return res.json({
        config,
        domains,
        userCount,
      });
    } catch (err: any) {
      console.error("[SSO Config GET Error]:", err.message);
      return res.status(500).json({ error: "Failed to load SSO configuration", details: err.message });
    }
  }
);

/**
 * PATCH /api/organizations/:orgId/sso/config
 * Update SSO settings (enable/disable, default role, auto-provisioning toggle).
 */
ssoManagementRouter.patch(
  "/:orgId/sso/config",
  async (req: Request, res: Response) => {
    try {
      const authorized = await requireOrgRole(req, res, ["owner", "admin"]);
      if (!authorized) return;

      const orgId = String(req.params.orgId);
      const { ssoEnabled, defaultRole, allowAutoProvisioning } = req.body;

      const updated = await updateSsoConfig(orgId, {
        ssoEnabled,
        defaultRole,
        allowAutoProvisioning,
      });

      return res.json({
        message: "SSO configuration updated successfully",
        config: updated,
      });
    } catch (err: any) {
      console.error("[SSO Config PATCH Error]:", err.message);
      return res.status(500).json({ error: "Failed to update SSO configuration", details: err.message });
    }
  }
);

/**
 * GET /api/organizations/:orgId/sso/domains
 * List verified domains for this organization.
 */
ssoManagementRouter.get(
  "/:orgId/sso/domains",
  async (req: Request, res: Response) => {
    try {
      const authorized = await requireOrgRole(req, res, ["owner", "admin", "developer", "member"]);
      if (!authorized) return;

      const orgId = String(req.params.orgId);
      const domains = await listSsoDomains(orgId);
      return res.json({ domains });
    } catch (err: any) {
      return res.status(500).json({ error: "Failed to list SSO domains", details: err.message });
    }
  }
);

/**
 * POST /api/organizations/:orgId/sso/domains
 * Add a verified domain for automatic provisioning.
 */
ssoManagementRouter.post(
  "/:orgId/sso/domains",
  async (req: Request, res: Response) => {
    try {
      const authorized = await requireOrgRole(req, res, ["owner", "admin"]);
      if (!authorized) return;

      const orgId = String(req.params.orgId);
      const { domain } = req.body;

      if (!domain || typeof domain !== "string" || !domain.trim()) {
        return res.status(400).json({ error: "Domain name is required" });
      }

      const newDomain = await addSsoDomain(orgId, domain);
      return res.status(201).json({
        message: "Domain added successfully",
        domain: newDomain,
      });
    } catch (err: any) {
      console.error("[SSO Domain POST Error]:", err.message);
      return res.status(400).json({ error: err.message || "Failed to add domain" });
    }
  }
);

/**
 * DELETE /api/organizations/:orgId/sso/domains/:domainId
 * Delete a verified domain.
 */
ssoManagementRouter.delete(
  "/:orgId/sso/domains/:domainId",
  async (req: Request, res: Response) => {
    try {
      const authorized = await requireOrgRole(req, res, ["owner", "admin"]);
      if (!authorized) return;

      const orgId = String(req.params.orgId);
      const domainId = String(req.params.domainId);

      const deleted = await removeSsoDomain(orgId, domainId);
      if (!deleted) {
        return res.status(404).json({ error: "Domain not found" });
      }

      return res.json({ message: "Domain removed successfully" });
    } catch (err: any) {
      return res.status(500).json({ error: "Failed to remove domain", details: err.message });
    }
  }
);

/**
 * GET /api/organizations/:orgId/sso/users
 * List users in allowlist / provisioned users with pagination and search.
 */
ssoManagementRouter.get(
  "/:orgId/sso/users",
  async (req: Request, res: Response) => {
    try {
      const authorized = await requireOrgRole(req, res, ["owner", "admin", "developer", "member"]);
      if (!authorized) return;

      const orgId = String(req.params.orgId);
      const search = req.query.q ? String(req.query.q) : undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
      const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;

      const result = await listSsoUsers(orgId, { search, limit, offset });
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: "Failed to list SSO users", details: err.message });
    }
  }
);

/**
 * POST /api/organizations/:orgId/sso/users
 * Manually add an approved user to the allowlist.
 */
ssoManagementRouter.post(
  "/:orgId/sso/users",
  async (req: Request, res: Response) => {
    try {
      const authorized = await requireOrgRole(req, res, ["owner", "admin"]);
      if (!authorized) return;

      const orgId = String(req.params.orgId);
      const { email, name, role, externalIssuer, externalSubject } = req.body;

      if (!email || typeof email !== "string" || !email.includes("@")) {
        return res.status(400).json({ error: "Valid email address is required" });
      }

      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "User full name is required" });
      }

      const user = await addAllowlistUser(orgId, {
        email,
        name,
        role: role === "tutor" ? "tutor" : "student",
        externalIssuer,
        externalSubject,
      });

      return res.status(201).json({
        message: "User added to allowlist successfully",
        user,
      });
    } catch (err: any) {
      console.error("[SSO User POST Error]:", err.message);
      return res.status(400).json({ error: err.message || "Failed to add user to allowlist" });
    }
  }
);

/**
 * PATCH /api/organizations/:orgId/sso/users/:userId
 * Update role or toggle active/revoked status.
 */
ssoManagementRouter.patch(
  "/:orgId/sso/users/:userId",
  async (req: Request, res: Response) => {
    try {
      const authorized = await requireOrgRole(req, res, ["owner", "admin"]);
      if (!authorized) return;

      const orgId = String(req.params.orgId);
      const userId = String(req.params.userId);
      const { role, isActive } = req.body;

      const updated = await updateSsoUser(orgId, userId, { role, isActive });
      return res.json({
        message: "User updated successfully",
        user: updated,
      });
    } catch (err: any) {
      return res.status(400).json({ error: err.message || "Failed to update user" });
    }
  }
);

/**
 * DELETE /api/organizations/:orgId/sso/users/:userId
 * Remove a user from the organization's allowlist.
 */
ssoManagementRouter.delete(
  "/:orgId/sso/users/:userId",
  async (req: Request, res: Response) => {
    try {
      const authorized = await requireOrgRole(req, res, ["owner", "admin"]);
      if (!authorized) return;

      const orgId = String(req.params.orgId);
      const userId = String(req.params.userId);

      const deleted = await deleteSsoUser(orgId, userId);
      if (!deleted) {
        return res.status(404).json({ error: "User not found" });
      }

      return res.json({ message: "User removed from allowlist" });
    } catch (err: any) {
      return res.status(500).json({ error: "Failed to delete user", details: err.message });
    }
  }
);
