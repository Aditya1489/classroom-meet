import fs from "fs";
import path from "path";
import { Router, Request, Response } from "express";
import { query } from "../../db";
import {
  verifyParticipantToken,
  ParticipantTokenClaims,
} from "../../services/participantTokenService";

export const embedRouter = Router();

/**
 * GET /embed/:roomCode
 * Serves the embed HTML document with dynamic room/tenant-specific Content-Security-Policy: frame-ancestors.
 */
export async function handleEmbedHtmlDocument(req: Request, res: Response) {
  try {
    const rawCode = req.params.roomCode;
    const roomCode = String(Array.isArray(rawCode) ? rawCode[0] : rawCode || "").trim().toLowerCase();

    if (!roomCode) {
      res.setHeader("Content-Security-Policy", "frame-ancestors 'none';");
      return res.status(400).type("html").send("<!DOCTYPE html><html><body><h3>Missing room code</h3></body></html>");
    }

    // 1. Query room, tenant status, and customer app allowed domains
    const roomRes = await query(
      `SELECT lc.id, lc.room_code, lc.organization_id, lc.is_active, org.status as org_status,
              ca.allowed_domains
       FROM live_classes lc
       JOIN organizations org ON org.id = lc.organization_id
       LEFT JOIN customer_apps ca ON ca.organization_id = lc.organization_id
       WHERE lc.room_code = $1;`,
      [roomCode]
    );

    if (roomRes.rows.length === 0 || !roomRes.rows[0].is_active) {
      res.setHeader("Content-Security-Policy", "frame-ancestors 'none';");
      return res.status(404).type("html").send("<!DOCTYPE html><html><body><h3>Room not found or class has ended</h3></body></html>");
    }

    const firstRow = roomRes.rows[0];
    if (firstRow.org_status !== "active") {
      res.setHeader("Content-Security-Policy", "frame-ancestors 'none';");
      return res.status(403).type("html").send("<!DOCTYPE html><html><body><h3>Organization account suspended</h3></body></html>");
    }

    // Collect all unique allowed domains across registered apps for this organization
    const allowedDomainsSet = new Set<string>();
    for (const r of roomRes.rows) {
      if (Array.isArray(r.allowed_domains)) {
        for (const d of r.allowed_domains) {
          if (typeof d === "string" && d.trim().length > 0) {
            allowedDomainsSet.add(d.trim());
          }
        }
      }
    }

    const allowedOrigins = Array.from(allowedDomainsSet);
    const frameAncestorsSources =
      allowedOrigins.length > 0
        ? `'self' ${allowedOrigins.join(" ")}`
        : "'self'";
    const cspDirective = `frame-ancestors ${frameAncestorsSources};`;

    // Set secure response headers
    res.setHeader("Content-Security-Policy", cspDirective);
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");

    // Deliver HTML document
    const distHtmlPath = path.resolve(process.cwd(), "dist/index.html");
    const rootHtmlPath = path.resolve(process.cwd(), "index.html");

    if (fs.existsSync(distHtmlPath)) {
      const html = fs.readFileSync(distHtmlPath, "utf8");
      return res.type("html").send(html);
    } else if (fs.existsSync(rootHtmlPath)) {
      const html = fs.readFileSync(rootHtmlPath, "utf8");
      return res.type("html").send(html);
    } else {
      return res.type("html").send("<!DOCTYPE html><html><head><title>Mathsy Meet Embed</title></head><body><div id=\"root\"></div></body></html>");
    }
  } catch (err: any) {
    console.error("[Embed Document Error]:", err.message);
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none';");
    return res.status(500).type("html").send("<!DOCTYPE html><html><body><h3>Failed to load embed document</h3></body></html>");
  }
}

embedRouter.get("/embed/:roomCode", handleEmbedHtmlDocument);


/**
 * Normalizes an origin string for comparison (lowercased, protocol + host + port, no trailing slash).
 */
function normalizeOrigin(origin: string): string {
  try {
    const parsed = new URL(origin);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return origin.trim().toLowerCase().replace(/\/$/, "");
  }
}

/**
 * Checks if a given parent origin matches any allowed domain.
 * Supports exact origin matches, domain-only matches, and wildcard subdomains (*.example.com).
 */
function isDomainAllowed(parentOrigin: string, allowedDomains: string[]): boolean {
  if (!parentOrigin) return false;
  const normalizedParent = normalizeOrigin(parentOrigin);

  for (const domain of allowedDomains) {
    if (!domain) continue;
    const normalizedAllowed = normalizeOrigin(domain);

    // Exact origin match (https://portal.com === https://portal.com)
    if (normalizedParent === normalizedAllowed) {
      return true;
    }

    // Wildcard subdomain matching (*.portal.com)
    if (domain.includes("*.")) {
      const baseDomain = domain.replace(/^https?:\/\//, "").replace(/^\*\./, "").toLowerCase();
      try {
        const parentHost = new URL(normalizedParent).hostname;
        if (parentHost.endsWith("." + baseDomain) || parentHost === baseDomain) {
          return true;
        }
      } catch {
        // invalid URL format
      }
    }
  }

  return false;
}

/**
 * GET /api/v1/embed/config/:roomCode
 * Returns embed policy, allowed parent origins, branding, and CSP frame-ancestors.
 * Authoritative: Derives allowed domains strictly from the room's server-side tenant record.
 */
embedRouter.get("/config/:roomCode", async (req: Request, res: Response) => {
  try {
    const roomCode = String(req.params.roomCode || "").trim().toLowerCase();
    if (!roomCode) {
      return res.status(400).json({ valid: false, error: "MISSING_ROOM_CODE" });
    }

    // 1. Query room, tenant status, and customer app allowed domains
    const roomRes = await query(
      `SELECT lc.id, lc.room_code, lc.organization_id, lc.is_active, org.status as org_status,
              ca.allowed_domains, ca.branding
       FROM live_classes lc
       JOIN organizations org ON org.id = lc.organization_id
       LEFT JOIN customer_apps ca ON ca.organization_id = lc.organization_id
       WHERE lc.room_code = $1;`,
      [roomCode]
    );

    if (roomRes.rows.length === 0 || !roomRes.rows[0].is_active) {
      return res.status(404).json({
        valid: false,
        error: "ROOM_NOT_FOUND",
        message: "Room not found or has ended",
      });
    }

    const firstRow = roomRes.rows[0];
    if (firstRow.org_status !== "active") {
      return res.status(403).json({
        valid: false,
        error: "ORGANIZATION_SUSPENDED",
        message: "Organization account is suspended",
      });
    }

    // Collect all unique allowed domains across registered apps for this organization
    const allowedDomainsSet = new Set<string>();
    let brandingObj: any = {};

    for (const r of roomRes.rows) {
      if (Array.isArray(r.allowed_domains)) {
        for (const d of r.allowed_domains) {
          if (typeof d === "string" && d.trim().length > 0) {
            allowedDomainsSet.add(d.trim());
          }
        }
      }
      if (r.branding && typeof r.branding === "object") {
        brandingObj = { ...brandingObj, ...r.branding };
      }
    }

    const allowedOrigins = Array.from(allowedDomainsSet);

    // 2. Validate requesting parent origin if supplied
    const rawOrigin =
      (req.query.parentOrigin as string) ||
      (req.headers.origin as string) ||
      (req.headers.referer as string) ||
      "";

    let isOriginAllowed = true;
    if (rawOrigin) {
      isOriginAllowed = isDomainAllowed(rawOrigin, allowedOrigins);
    } else if (allowedOrigins.length > 0) {
      // If allowed origins are configured but caller provided none, frame-ancestors will still restrict it
      isOriginAllowed = true;
    }

    // 3. Build CSP frame-ancestors directive
    const frameAncestorsSources =
      allowedOrigins.length > 0
        ? `'self' ${allowedOrigins.join(" ")}`
        : "'self'";
    const cspDirective = `frame-ancestors ${frameAncestorsSources};`;

    // Set secure response headers
    res.setHeader("Content-Security-Policy", cspDirective);
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");

    return res.json({
      valid: true,
      roomCode: firstRow.room_code,
      organizationId: firstRow.organization_id,
      isOriginAllowed,
      allowedOrigins,
      branding: brandingObj,
      frameAncestorsPolicy: cspDirective,
    });
  } catch (err: any) {
    console.error("[Embed Config Error]:", err.message);
    return res.status(500).json({ valid: false, error: "SERVER_ERROR", message: err.message });
  }
});

/**
 * POST /api/v1/embed/verify-token
 * Validates participant token signature, expiry, room binding, and tenant status.
 * Rejects expired, forged, mismatched, or cross-tenant tokens.
 */
embedRouter.post("/verify-token", async (req: Request, res: Response) => {
  try {
    const { token, roomCode } = req.body;

    if (!token || typeof token !== "string" || token.trim().length === 0) {
      return res.status(400).json({
        valid: false,
        code: "MISSING_TOKEN",
        error: "Missing participant token",
      });
    }

    if (!roomCode || typeof roomCode !== "string" || roomCode.trim().length === 0) {
      return res.status(400).json({
        valid: false,
        code: "MISSING_ROOM_CODE",
        error: "Missing room code",
      });
    }

    const normalizedRoomCode = roomCode.trim().toLowerCase();

    // 1. Verify cryptographic signature, issuer, and audience
    let claims: ParticipantTokenClaims;
    try {
      claims = verifyParticipantToken(token);
    } catch (jwtErr: any) {
      if (jwtErr.name === "TokenExpiredError") {
        return res.status(401).json({
          valid: false,
          code: "TOKEN_EXPIRED",
          error: "Participant token has expired",
        });
      }
      return res.status(401).json({
        valid: false,
        code: "INVALID_TOKEN",
        error: "Invalid token signature or payload",
      });
    }

    // 2. Enforce strict room binding
    if (claims.room_code.toLowerCase() !== normalizedRoomCode) {
      return res.status(403).json({
        valid: false,
        code: "ROOM_MISMATCH",
        error: "Participant token was issued for a different room",
      });
    }

    // 3. Verify room exists, is active, and matches tenant
    const roomRes = await query(
      `SELECT lc.id, lc.room_code, lc.organization_id, lc.is_active, org.status as org_status
       FROM live_classes lc
       JOIN organizations org ON org.id = lc.organization_id
       WHERE lc.room_code = $1;`,
      [normalizedRoomCode]
    );

    if (roomRes.rows.length === 0 || !roomRes.rows[0].is_active) {
      return res.status(404).json({
        valid: false,
        code: "ROOM_NOT_FOUND",
        error: "Room not found or has ended",
      });
    }

    const room = roomRes.rows[0];

    // 4. Enforce tenant isolation: Token tenant MUST match Room tenant
    if (room.organization_id !== claims.tenant_id) {
      return res.status(403).json({
        valid: false,
        code: "TENANT_MISMATCH",
        error: "Participant token tenant does not match room tenant",
      });
    }

    // 5. Verify tenant account status
    if (room.org_status !== "active") {
      return res.status(403).json({
        valid: false,
        code: "ORGANIZATION_SUSPENDED",
        error: "Organization account is suspended",
      });
    }

    // Return authoritative claims to client
    return res.json({
      valid: true,
      claims: {
        participantId: claims.sub,
        name: claims.name,
        role: claims.role,
        permissions: claims.permissions,
        tenantId: claims.tenant_id,
        roomCode: claims.room_code,
        roomId: claims.room_id,
        expiresAt: new Date(claims.exp * 1000).toISOString(),
      },
    });
  } catch (err: any) {
    console.error("[Embed Token Verify Error]:", err.message);
    return res.status(500).json({ valid: false, error: "SERVER_ERROR", message: err.message });
  }
});
