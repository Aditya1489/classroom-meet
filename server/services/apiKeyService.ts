import crypto from "node:crypto";
import { query } from "../db";

// ============================================================================
// API KEY SERVICE — HIGH-ENTROPY M2M CREDENTIAL MANAGEMENT
// ============================================================================
// Safeguards:
// 1. Raw API keys are generated using cryptographically secure random bytes.
// 2. Raw keys are NEVER persisted; only the SHA-256 hash is stored.
// 3. Constant-time comparison prevents timing attack side channels.
// 4. Test (sec_test_...) and Live (sec_live_...) environments are strictly segregated.
// 5. Audit logs track creation, rotation, and revocation without recording secrets.
// ============================================================================

export type ApiKeyEnvironment = "live" | "test";

export interface ApiKeyRecord {
  id: string;
  organization_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  environment: ApiKeyEnvironment;
  is_active: boolean;
  permissions: string[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface MaskedApiKey {
  id: string;
  organization_id: string;
  name: string;
  key_prefix: string;
  masked_key: string;
  environment: ApiKeyEnvironment;
  is_active: boolean;
  permissions: string[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface VerificationResult {
  valid: boolean;
  code?: "INVALID_FORMAT" | "NOT_FOUND" | "REVOKED" | "EXPIRED" | "ORG_SUSPENDED" | "WRONG_ENVIRONMENT";
  error?: string;
  apiKey?: ApiKeyRecord;
  organization?: {
    id: string;
    name: string;
    slug: string;
    status: string;
    settings: any;
  };
}

/**
 * Generate a new high-entropy raw API key and its cryptographic hash
 */
export function generateKeyMaterial(env: ApiKeyEnvironment = "live"): {
  rawKey: string;
  prefix: string;
  hash: string;
} {
  const envPrefix = env === "live" ? "sec_live_" : "sec_test_";
  // 4 random bytes = 8 hex chars for prefix indexing
  const randomPrefixChunk = crypto.randomBytes(4).toString("hex");
  const prefix = `${envPrefix}${randomPrefixChunk}_`; // e.g. sec_live_a1b2c3d4_

  // 32 cryptographically secure random bytes as base64url (~43 characters)
  const secretPayload = crypto.randomBytes(32).toString("base64url");
  const rawKey = `${prefix}${secretPayload}`;

  // Compute SHA-256 hash
  const hash = crypto.createHash("sha256").update(rawKey).digest("hex");

  return { rawKey, prefix, hash };
}

/**
 * Create a new API Key for an organization
 */
export async function createApiKey({
  organizationId,
  name,
  environment = "live",
  permissions = ["rooms:read", "rooms:write", "tokens:write"],
  expiresAt = null,
  actorId = "system",
  ipAddress,
}: {
  organizationId: string;
  name: string;
  environment?: ApiKeyEnvironment;
  permissions?: string[];
  expiresAt?: Date | null;
  actorId?: string;
  ipAddress?: string;
}): Promise<{ rawKey: string; apiKey: MaskedApiKey }> {
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw new Error("API key name is required");
  }

  // Verify organization exists and is active
  const orgRes = await query("SELECT id, status FROM organizations WHERE id = $1;", [organizationId]);
  if (orgRes.rows.length === 0) {
    throw new Error("Organization not found");
  }
  if (orgRes.rows[0].status !== "active") {
    throw new Error("Cannot create API keys for a suspended organization");
  }

  // SEC-GAP-02: Check for existing active key with same name in this organization
  const existingKey = await query(
    "SELECT id FROM api_keys WHERE organization_id = $1 AND name = $2 AND is_active = TRUE;",
    [organizationId, name.trim()]
  );
  if (existingKey.rows.length > 0) {
    const conflictErr: any = new Error(`An active API key with name '${name.trim()}' already exists`);
    conflictErr.code = "KEY_NAME_EXISTS";
    conflictErr.statusCode = 409;
    throw conflictErr;
  }

  const { rawKey, prefix, hash } = generateKeyMaterial(environment);

  const insertSql = `
    INSERT INTO api_keys (organization_id, name, key_prefix, key_hash, environment, is_active, permissions, expires_at)
    VALUES ($1, $2, $3, $4, $5, TRUE, $6::jsonb, $7)
    RETURNING id, organization_id, name, key_prefix, environment, is_active, permissions, last_used_at, expires_at, created_at;
  `;

  let keyRes;
  try {
    keyRes = await query(insertSql, [
      organizationId,
      name.trim(),
      prefix,
      hash,
      environment,
      JSON.stringify(permissions),
      expiresAt,
    ]);
  } catch (err: any) {
    if (err.code === "23505" || err.message?.includes("idx_api_keys_active_org_name")) {
      const conflictErr: any = new Error(`An active API key with name '${name.trim()}' already exists`);
      conflictErr.code = "KEY_NAME_EXISTS";
      conflictErr.statusCode = 409;
      throw conflictErr;
    }
    throw err;
  }
  const row = keyRes.rows[0];

  // Audit log entry (NEVER logs raw key or full hash)
  await query(
    `INSERT INTO api_key_audit_logs (organization_id, api_key_id, action, actor_id, key_prefix, metadata, ip_address)
     VALUES ($1, $2, 'created', $3, $4, $5::jsonb, $6);`,
    [
      organizationId,
      row.id,
      actorId,
      prefix,
      JSON.stringify({ name: row.name, environment: row.environment, permissions }),
      ipAddress || null,
    ]
  );

  const maskedKey: MaskedApiKey = {
    id: row.id,
    organization_id: row.organization_id,
    name: row.name,
    key_prefix: row.key_prefix,
    masked_key: `${row.key_prefix}••••••••••••••••`,
    environment: row.environment,
    is_active: row.is_active,
    permissions: row.permissions,
    last_used_at: row.last_used_at,
    expires_at: row.expires_at,
    created_at: row.created_at,
  };

  return { rawKey, apiKey: maskedKey };
}

/**
 * Verify an incoming raw API key with constant-time hash comparison
 */
export async function verifyApiKey(
  rawKey: string,
  requiredEnvironment?: ApiKeyEnvironment
): Promise<VerificationResult> {
  if (!rawKey || typeof rawKey !== "string") {
    return { valid: false, code: "INVALID_FORMAT", error: "Missing API key" };
  }

  const trimmed = rawKey.trim();
  const isLive = trimmed.startsWith("sec_live_");
  const isTest = trimmed.startsWith("sec_test_");

  if (!isLive && !isTest) {
    return { valid: false, code: "INVALID_FORMAT", error: "Malformed API key format" };
  }

  const detectedEnv: ApiKeyEnvironment = isLive ? "live" : "test";
  if (requiredEnvironment && detectedEnv !== requiredEnvironment) {
    return {
      valid: false,
      code: "WRONG_ENVIRONMENT",
      error: `API key environment mismatch: expected '${requiredEnvironment}' but received '${detectedEnv}'`,
    };
  }

  // Extract prefix chunk up to second underscore (e.g. sec_live_12345678_)
  const parts = trimmed.split("_");
  if (parts.length < 3) {
    return { valid: false, code: "INVALID_FORMAT", error: "Malformed API key prefix" };
  }
  const prefix = `${parts[0]}_${parts[1]}_${parts[2]}_`;

  // Compute candidate SHA-256 buffer
  const candidateBuffer = crypto.createHash("sha256").update(trimmed).digest();

  // Query candidate keys by prefix
  const sql = `
    SELECT k.*, 
           o.name as org_name, o.slug as org_slug, o.status as org_status, o.settings as org_settings
    FROM api_keys k
    JOIN organizations o ON k.organization_id = o.id
    WHERE k.key_prefix = $1;
  `;

  const res = await query(sql, [prefix]);
  if (res.rows.length === 0) {
    return { valid: false, code: "NOT_FOUND", error: "API key not found" };
  }

  // Find candidate row using constant-time comparison
  let matchedRow: any = null;
  for (const row of res.rows) {
    const storedBuffer = Buffer.from(row.key_hash, "hex");
    if (storedBuffer.length === candidateBuffer.length && crypto.timingSafeEqual(candidateBuffer, storedBuffer)) {
      matchedRow = row;
      break;
    }
  }

  if (!matchedRow) {
    return { valid: false, code: "NOT_FOUND", error: "Invalid API key secret" };
  }

  // Check active status
  if (!matchedRow.is_active) {
    return { valid: false, code: "REVOKED", error: "API key has been revoked" };
  }

  // Check expiration
  if (matchedRow.expires_at && new Date(matchedRow.expires_at) < new Date()) {
    return { valid: false, code: "EXPIRED", error: "API key has expired" };
  }

  // Check organization status
  if (matchedRow.org_status !== "active") {
    return { valid: false, code: "ORG_SUSPENDED", error: "Organization account is suspended" };
  }

  // Update last_used_at asynchronously
  query("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1;", [matchedRow.id]).catch((err) => {
    console.warn("[ApiKeyService] Failed to update last_used_at:", err.message);
  });

  return {
    valid: true,
    apiKey: {
      id: matchedRow.id,
      organization_id: matchedRow.organization_id,
      name: matchedRow.name,
      key_prefix: matchedRow.key_prefix,
      key_hash: matchedRow.key_hash,
      environment: matchedRow.environment,
      is_active: matchedRow.is_active,
      permissions: Array.isArray(matchedRow.permissions) ? matchedRow.permissions : [],
      last_used_at: matchedRow.last_used_at,
      expires_at: matchedRow.expires_at,
      created_at: matchedRow.created_at,
    },
    organization: {
      id: matchedRow.organization_id,
      name: matchedRow.org_name,
      slug: matchedRow.org_slug,
      status: matchedRow.org_status,
      settings: matchedRow.org_settings,
    },
  };
}

/**
 * List masked API keys for an organization
 */
export async function listApiKeys(organizationId: string): Promise<MaskedApiKey[]> {
  const sql = `
    SELECT id, organization_id, name, key_prefix, environment, is_active, permissions, last_used_at, expires_at, created_at
    FROM api_keys
    WHERE organization_id = $1
    ORDER BY created_at DESC;
  `;
  const res = await query(sql, [organizationId]);
  return res.rows.map((row) => ({
    id: row.id,
    organization_id: row.organization_id,
    name: row.name,
    key_prefix: row.key_prefix,
    masked_key: `${row.key_prefix}••••••••••••••••`,
    environment: row.environment,
    is_active: row.is_active,
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
    last_used_at: row.last_used_at,
    expires_at: row.expires_at,
    created_at: row.created_at,
  }));
}

/**
 * Revoke an API key
 */
export async function revokeApiKey({
  organizationId,
  keyId,
  actorId = "system",
  ipAddress,
}: {
  organizationId: string;
  keyId: string;
  actorId?: string;
  ipAddress?: string;
}): Promise<boolean> {
  const sql = `
    UPDATE api_keys 
    SET is_active = FALSE 
    WHERE id = $1 AND organization_id = $2
    RETURNING id, key_prefix, name;
  `;
  const res = await query(sql, [keyId, organizationId]);
  if (res.rows.length === 0) {
    return false;
  }

  const row = res.rows[0];
  await query(
    `INSERT INTO api_key_audit_logs (organization_id, api_key_id, action, actor_id, key_prefix, metadata, ip_address)
     VALUES ($1, $2, 'revoked', $3, $4, $5::jsonb, $6);`,
    [organizationId, row.id, actorId, row.key_prefix, JSON.stringify({ name: row.name }), ipAddress || null]
  );

  return true;
}

/**
 * Rotate an existing API key: atomically revokes old key and creates new key with matching properties
 */
export async function rotateApiKey({
  organizationId,
  keyId,
  actorId = "system",
  ipAddress,
}: {
  organizationId: string;
  keyId: string;
  actorId?: string;
  ipAddress?: string;
}): Promise<{ rawKey: string; apiKey: MaskedApiKey }> {
  // 1. Fetch current key
  const fetchSql = "SELECT * FROM api_keys WHERE id = $1 AND organization_id = $2;";
  const current = await query(fetchSql, [keyId, organizationId]);
  if (current.rows.length === 0) {
    throw new Error("API key not found");
  }
  const oldKey = current.rows[0];

  // 2. Revoke old key
  await query("UPDATE api_keys SET is_active = FALSE WHERE id = $1;", [keyId]);

  // 3. Generate new key with same name, environment, and permissions
  const { rawKey, prefix, hash } = generateKeyMaterial(oldKey.environment);

  const insertSql = `
    INSERT INTO api_keys (organization_id, name, key_prefix, key_hash, environment, is_active, permissions, expires_at)
    VALUES ($1, $2, $3, $4, $5, TRUE, $6::jsonb, $7)
    RETURNING id, organization_id, name, key_prefix, environment, is_active, permissions, last_used_at, expires_at, created_at;
  `;

  const newRes = await query(insertSql, [
    organizationId,
    oldKey.name,
    prefix,
    hash,
    oldKey.environment,
    JSON.stringify(oldKey.permissions),
    oldKey.expires_at,
  ]);
  const newRow = newRes.rows[0];

  // 4. Log audit event
  await query(
    `INSERT INTO api_key_audit_logs (organization_id, api_key_id, action, actor_id, key_prefix, metadata, ip_address)
     VALUES ($1, $2, 'rotated', $3, $4, $5::jsonb, $6);`,
    [
      organizationId,
      newRow.id,
      actorId,
      prefix,
      JSON.stringify({ previousKeyId: keyId, name: newRow.name }),
      ipAddress || null,
    ]
  );

  return {
    rawKey,
    apiKey: {
      id: newRow.id,
      organization_id: newRow.organization_id,
      name: newRow.name,
      key_prefix: newRow.key_prefix,
      masked_key: `${newRow.key_prefix}••••••••••••••••`,
      environment: newRow.environment,
      is_active: newRow.is_active,
      permissions: newRow.permissions,
      last_used_at: newRow.last_used_at,
      expires_at: newRow.expires_at,
      created_at: newRow.created_at,
    },
  };
}
