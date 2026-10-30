import { query } from "../db";

/**
 * Origin Validation & Dynamic CORS Service
 *
 * Implements high-performance, dynamic CORS and iframe CSP verification:
 * 1. Resolves allowed origins dynamically from active tenant records in PostgreSQL.
 * 2. Employs a low-latency in-memory cache with a 60-second TTL to avoid database overhead.
 * 3. Normalizes domains (strips protocols, www., and trailing slashes) so both apex and www match.
 * 4. Automatically filters out suspended organizations.
 * 5. Zero hardcoding: scales dynamically across all current and future tenants.
 */

// In-memory cache
let cachedTenantDomains: Set<string> | null = null;
let lastCacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

/**
 * Normalizes any domain or origin string into a clean lowercase domain name (e.g. "mathsy.in").
 * Strips protocols (http://, https://), leading www., trailing slashes, paths, and @ symbols.
 */
export function normalizeDomain(input: string): string {
  if (!input || typeof input !== "string") return "";

  let cleaned = input.trim().toLowerCase();

  // Strip @ (e.g. from email domain inputs)
  cleaned = cleaned.replace(/^@+/, "");

  // If full URL, extract hostname
  try {
    if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
      const parsed = new URL(cleaned);
      cleaned = parsed.hostname;
    }
  } catch {
    // If not a standard URL, continue with regex scrubbing
  }

  // Remove protocol prefix if still present
  cleaned = cleaned.replace(/^https?:\/\//, "");

  // Remove path or query
  cleaned = cleaned.split("/")[0].split("?")[0].split("#")[0];

  // Remove port if present (e.g. localhost:8080 or domain.com:443)
  const colonIndex = cleaned.indexOf(":");
  if (colonIndex !== -1 && !cleaned.startsWith("localhost") && !cleaned.startsWith("127.0.0.1")) {
    cleaned = cleaned.substring(0, colonIndex);
  }

  // Strip leading www.
  cleaned = cleaned.replace(/^www\./, "");

  return cleaned.trim();
}

/**
 * Invalidates the in-memory cache (called when tenant domains or apps change).
 */
export function invalidateOriginCache(): void {
  cachedTenantDomains = null;
  lastCacheTimestamp = 0;
}

/**
 * Loads and caches all allowed domains for all ACTIVE organizations.
 */
async function getCachedTenantDomains(): Promise<Set<string>> {
  const now = Date.now();
  if (cachedTenantDomains && now - lastCacheTimestamp < CACHE_TTL_MS) {
    return cachedTenantDomains;
  }

  try {
    const res = await query(
      `SELECT DISTINCT domain FROM (
        -- Allowed domains from customer_apps for active organizations
        SELECT unnest(ca.allowed_domains) as domain
        FROM customer_apps ca
        JOIN organizations o ON o.id = ca.organization_id
        WHERE o.status = 'active'

        UNION

        -- Verified domains from organization_sso_domains for active organizations
        SELECT sod.domain as domain
        FROM organization_sso_domains sod
        JOIN organizations o ON o.id = sod.organization_id
        WHERE o.status = 'active' AND sod.is_verified = TRUE
      ) domains_union
      WHERE domain IS NOT NULL AND length(trim(domain)) > 0;`
    );

    const domainSet = new Set<string>();

    for (const row of res.rows) {
      const raw = String(row.domain || "").trim();
      if (!raw) continue;

      const norm = normalizeDomain(raw);
      if (norm) {
        domainSet.add(norm);
      }
    }

    cachedTenantDomains = domainSet;
    lastCacheTimestamp = now;
    return domainSet;
  } catch (err: any) {
    console.error("[OriginValidation] Error refreshing tenant domains:", err.message);
    // If cache already exists, reuse even if stale
    return cachedTenantDomains || new Set<string>();
  }
}

/**
 * Checks if a given incoming request origin is authorized.
 */
export async function isOriginAllowed(origin: string): Promise<boolean> {
  if (!origin || typeof origin !== "string") {
    return false;
  }

  const trimmed = origin.trim().replace(/\/$/, "");

  // 1. Static configured origins from environment
  if (
    trimmed === "https://classroom-meet.vercel.app" ||
    /^https:\/\/classroom-meet(-[a-z0-9_-]+)?\.vercel\.app$/.test(trimmed)
  ) {
    return true;
  }
  if (process.env.FRONTEND_URL && trimmed === process.env.FRONTEND_URL.trim().replace(/\/$/, "")) {
    return true;
  }
  if (process.env.CUSTOMER_DEMO_URL && trimmed === process.env.CUSTOMER_DEMO_URL.trim().replace(/\/$/, "")) {
    return true;
  }
  if (process.env.CORS_ALLOWED_ORIGINS) {
    const list = process.env.CORS_ALLOWED_ORIGINS.split(",")
      .map((o) => o.trim().replace(/\/$/, ""))
      .filter(Boolean);
    if (list.includes(trimmed)) {
      return true;
    }
  }

  // 2. Localhost development environments in non-production
  if (process.env.NODE_ENV !== "production") {
    if (
      trimmed.startsWith("http://localhost:") ||
      trimmed.startsWith("http://127.0.0.1:") ||
      trimmed === "http://localhost" ||
      trimmed === "http://127.0.0.1"
    ) {
      return true;
    }
  }

  // 3. Dynamic tenant domain check
  const normalizedOriginDomain = normalizeDomain(trimmed);
  if (!normalizedOriginDomain) {
    return false;
  }

  const tenantDomains = await getCachedTenantDomains();
  return tenantDomains.has(normalizedOriginDomain);
}

/**
 * Retrieves all valid parent origins allowed to embed a meeting for a specific room.
 * Merges both customer_apps allowed_domains and verified organization_sso_domains.
 */
export async function getRoomAllowedEmbedOrigins(roomCode: string): Promise<string[]> {
  try {
    const res = await query(
      `SELECT lc.id, lc.organization_id, org.status as org_status,
              ca.allowed_domains,
              sod.domain as sso_domain
       FROM live_classes lc
       JOIN organizations org ON org.id = lc.organization_id
       LEFT JOIN customer_apps ca ON ca.organization_id = lc.organization_id
       LEFT JOIN organization_sso_domains sod ON sod.organization_id = lc.organization_id AND sod.is_verified = TRUE
       WHERE lc.room_code = $1 AND org.status = 'active';`,
      [roomCode.toLowerCase().trim()]
    );

    if (res.rows.length === 0) {
      return [];
    }

    const origins = new Set<string>();

    for (const row of res.rows) {
      // Customer app domains
      if (Array.isArray(row.allowed_domains)) {
        for (const raw of row.allowed_domains) {
          if (typeof raw === "string" && raw.trim()) {
            const trimmed = raw.trim().replace(/\/$/, "");
            if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
              origins.add(trimmed);
            } else {
              origins.add(`https://${trimmed}`);
            }
          }
        }
      }

      // SSO domains
      if (row.sso_domain && typeof row.sso_domain === "string") {
        const norm = normalizeDomain(row.sso_domain);
        if (norm) {
          origins.add(`https://${norm}`);
          origins.add(`https://www.${norm}`);
        }
      }
    }

    return Array.from(origins);
  } catch (err: any) {
    console.error("[OriginValidation] Error resolving room embed origins:", err.message);
    return [];
  }
}
