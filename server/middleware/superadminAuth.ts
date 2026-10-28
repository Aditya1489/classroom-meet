import { Request, Response, NextFunction } from "express";
import { query } from "../db";
import { logger } from "../services/logger";

export const SYSTEM_TENANT_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Checks whether a given user ID possesses active, verified platform superadmin privileges.
 * 
 * Strict Dual-Guard Authorization:
 * 1. Database user record must have role === 'admin' AND is_platform_superadmin === true
 * 2. User must be an active 'owner' or 'admin' in the first-party system organization (00000000-0000-0000-0000-000000000001)
 * 
 * Never treats generic users with role === 'admin' or tenant organization admins as platform superadmins.
 */
export async function isPlatformSuperadmin(userId: string): Promise<boolean> {
  if (!userId) return false;

  try {
    const res = await query(
      `SELECT u.id, u.email, u.role, u.is_platform_superadmin, u.is_active, om.role as system_role
       FROM users u
       LEFT JOIN organization_members om 
         ON om.user_id = u.id AND om.organization_id = $1
       WHERE u.id = $2;`,
      [SYSTEM_TENANT_ID, userId]
    );

    if (res.rows.length === 0) return false;

    const row = res.rows[0];
    if (!row.is_active) return false;

    // Both flags must be true, plus membership in system tenant
    const hasSuperadminFlag = row.role === "admin" && Boolean(row.is_platform_superadmin);
    const hasSystemOrgRole = row.system_role === "owner" || row.system_role === "admin";

    return hasSuperadminFlag && hasSystemOrgRole;
  } catch (err: any) {
    logger.error("[SuperadminAuth] Failed to verify superadmin status", { error: err.message, userId });
    return false;
  }
}

/**
 * Express middleware enforcing platform superadmin privileges.
 * Rejects regular users, tutors, students, generic admins, and tenant organization admins with HTTP 403.
 */
export async function requirePlatformSuperadmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;

  if (!user || !user.id) {
    return res.status(401).json({
      error: "Authentication required",
      code: "AUTH_REQUIRED",
    });
  }

  const authorized = await isPlatformSuperadmin(user.id);

  if (!authorized) {
    logger.warn("[SuperadminAuth] Unauthorized cross-tenant access attempt rejected", {
      userId: user.id,
      email: user.email,
      role: user.role,
      path: req.originalUrl,
      ip: req.ip,
    });

    return res.status(403).json({
      error: "Forbidden: Platform superadmin privileges required",
      code: "SUPERADMIN_ACCESS_REQUIRED",
    });
  }

  return next();
}
