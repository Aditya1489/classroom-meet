import crypto from "node:crypto";
import { query } from "../db";
import { issueParticipantToken, ParticipantRole, ParticipantPermissions } from "./participantTokenService";

export interface SsoConfig {
  id: string;
  organizationId: string;
  ssoEnabled: boolean;
  defaultRole: ParticipantRole;
  allowAutoProvisioning: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SsoDomain {
  id: string;
  organizationId: string;
  domain: string;
  isVerified: boolean;
  createdAt: string;
}

export interface SsoUser {
  id: string;
  organizationId: string;
  externalIssuer: string;
  externalSubject: string;
  email: string;
  name: string;
  role: ParticipantRole;
  isActive: boolean;
  autoProvisioned: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLaunchTokenParams {
  organizationId: string;
  apiKeyId?: string;
  roomCode: string;
  userId: string;
  email: string;
  name: string;
  role?: ParticipantRole;
  externalIssuer?: string;
  permissions?: Partial<ParticipantPermissions>;
}

export interface SsoLaunchResult {
  launchToken: string;
  roomCode: string;
  launchUrl: string;
  embedUrl: string;
  expiresAt: string;
  user: {
    externalUserId: string;
    email: string;
    name: string;
    role: ParticipantRole;
    autoProvisioned: boolean;
  };
}

export interface ConsumeLaunchTokenResult {
  success: boolean;
  participantToken: string;
  roomCode: string;
  role: ParticipantRole;
  name: string;
  participantId: string;
  claims: any;
  expiresAt: string;
}

/**
 * Base62 alphabet for secure token generation
 */
const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function generateSecureBase62(byteCount = 32): string {
  const bytes = crypto.randomBytes(byteCount);
  let result = "";
  for (let i = 0; i < bytes.length; i++) {
    result += BASE62_ALPHABET[bytes[i] % BASE62_ALPHABET.length];
  }
  return result;
}

function normalizeDomain(rawDomain: string): string {
  if (!rawDomain || typeof rawDomain !== "string") {
    throw new Error("Invalid domain string");
  }
  return rawDomain.trim().toLowerCase().replace(/^@+/, "").replace(/\/$/, "");
}

/**
 * Retrieves or lazily creates default SSO configuration for an organization.
 */
export async function getOrCreateSsoConfig(organizationId: string): Promise<SsoConfig> {
  const existing = await query(
    `SELECT id, organization_id, sso_enabled, default_role, allow_auto_provisioning, created_at, updated_at
     FROM organization_sso_configs
     WHERE organization_id = $1;`,
    [organizationId]
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    return {
      id: row.id,
      organizationId: row.organization_id,
      ssoEnabled: Boolean(row.sso_enabled),
      defaultRole: row.default_role as ParticipantRole,
      allowAutoProvisioning: Boolean(row.allow_auto_provisioning),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // Create default configuration: disabled by default
  const insertRes = await query(
    `INSERT INTO organization_sso_configs (organization_id, sso_enabled, default_role, allow_auto_provisioning)
     VALUES ($1, FALSE, 'student', TRUE)
     ON CONFLICT (organization_id) DO UPDATE SET updated_at = NOW()
     RETURNING id, organization_id, sso_enabled, default_role, allow_auto_provisioning, created_at, updated_at;`,
    [organizationId]
  );

  const row = insertRes.rows[0];
  return {
    id: row.id,
    organizationId: row.organization_id,
    ssoEnabled: Boolean(row.sso_enabled),
    defaultRole: row.default_role as ParticipantRole,
    allowAutoProvisioning: Boolean(row.allow_auto_provisioning),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Updates organization SSO configuration.
 */
export async function updateSsoConfig(
  organizationId: string,
  updates: {
    ssoEnabled?: boolean;
    defaultRole?: ParticipantRole;
    allowAutoProvisioning?: boolean;
  }
): Promise<SsoConfig> {
  await getOrCreateSsoConfig(organizationId);

  const fields: string[] = [];
  const params: any[] = [organizationId];
  let paramIndex = 2;

  if (typeof updates.ssoEnabled === "boolean") {
    fields.push(`sso_enabled = $${paramIndex++}`);
    params.push(updates.ssoEnabled);
  }

  if (updates.defaultRole && (updates.defaultRole === "student" || updates.defaultRole === "tutor")) {
    fields.push(`default_role = $${paramIndex++}`);
    params.push(updates.defaultRole);
  }

  if (typeof updates.allowAutoProvisioning === "boolean") {
    fields.push(`allow_auto_provisioning = $${paramIndex++}`);
    params.push(updates.allowAutoProvisioning);
  }

  if (fields.length === 0) {
    return getOrCreateSsoConfig(organizationId);
  }

  fields.push("updated_at = NOW()");

  const updateSql = `
    UPDATE organization_sso_configs
    SET ${fields.join(", ")}
    WHERE organization_id = $1
    RETURNING id, organization_id, sso_enabled, default_role, allow_auto_provisioning, created_at, updated_at;
  `;

  const res = await query(updateSql, params);
  const row = res.rows[0];
  return {
    id: row.id,
    organizationId: row.organization_id,
    ssoEnabled: Boolean(row.sso_enabled),
    defaultRole: row.default_role as ParticipantRole,
    allowAutoProvisioning: Boolean(row.allow_auto_provisioning),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Lists verified domains configured for an organization.
 */
export async function listSsoDomains(organizationId: string): Promise<SsoDomain[]> {
  const res = await query(
    `SELECT id, organization_id, domain, is_verified, created_at
     FROM organization_sso_domains
     WHERE organization_id = $1
     ORDER BY domain ASC;`,
    [organizationId]
  );

  return res.rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    domain: row.domain,
    isVerified: Boolean(row.is_verified),
    createdAt: row.created_at,
  }));
}

/**
 * Adds an authorized domain for automatic user provisioning.
 */
export async function addSsoDomain(organizationId: string, rawDomain: string): Promise<SsoDomain> {
  const domain = normalizeDomain(rawDomain);

  // Validate domain pattern (e.g. mathsy.in, school.edu)
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    throw new Error("Invalid domain format. Must be a valid FQDN such as 'mathsy.in' or 'school.edu'.");
  }

  const res = await query(
    `INSERT INTO organization_sso_domains (organization_id, domain, is_verified)
     VALUES ($1, $2, TRUE)
     ON CONFLICT (organization_id, domain) DO UPDATE SET is_verified = TRUE
     RETURNING id, organization_id, domain, is_verified, created_at;`,
    [organizationId, domain]
  );

  const row = res.rows[0];
  return {
    id: row.id,
    organizationId: row.organization_id,
    domain: row.domain,
    isVerified: Boolean(row.is_verified),
    createdAt: row.created_at,
  };
}

/**
 * Removes a verified domain.
 */
export async function removeSsoDomain(organizationId: string, domainId: string): Promise<boolean> {
  const res = await query(
    `DELETE FROM organization_sso_domains
     WHERE id = $1 AND organization_id = $2;`,
    [domainId, organizationId]
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Lists users provisioned or manually allowlisted under an organization.
 */
export async function listSsoUsers(
  organizationId: string,
  options: { search?: string; limit?: number; offset?: number } = {}
): Promise<{ users: SsoUser[]; total: number }> {
  const limit = Math.min(Math.max(options.limit || 50, 1), 100);
  const offset = Math.max(options.offset || 0, 0);

  let searchClause = "";
  const params: any[] = [organizationId];

  if (options.search && options.search.trim().length > 0) {
    params.push(`%${options.search.trim().toLowerCase()}%`);
    searchClause = `AND (LOWER(email) LIKE $2 OR LOWER(name) LIKE $2 OR LOWER(external_subject) LIKE $2)`;
  }

  const countRes = await query(
    `SELECT COUNT(*)::int as total
     FROM organization_sso_users
     WHERE organization_id = $1 ${searchClause};`,
    params
  );
  const total = countRes.rows[0]?.total || 0;

  const dataParams = [...params, limit, offset];
  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;

  const usersRes = await query(
    `SELECT id, organization_id, external_issuer, external_subject, email, name, role,
            is_active, auto_provisioned, last_login_at, created_at, updated_at
     FROM organization_sso_users
     WHERE organization_id = $1 ${searchClause}
     ORDER BY created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx};`,
    dataParams
  );

  const users: SsoUser[] = usersRes.rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    externalIssuer: row.external_issuer,
    externalSubject: row.external_subject,
    email: row.email,
    name: row.name,
    role: row.role as ParticipantRole,
    isActive: Boolean(row.is_active),
    autoProvisioned: Boolean(row.auto_provisioned),
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return { users, total };
}

/**
 * Manually adds an approved user to the organization's allowlist.
 */
export async function addAllowlistUser(
  organizationId: string,
  params: {
    email: string;
    name: string;
    role?: ParticipantRole;
    externalIssuer?: string;
    externalSubject?: string;
  }
): Promise<SsoUser> {
  const email = params.email.trim().toLowerCase();
  const name = params.name.trim();
  const role: ParticipantRole = params.role === "tutor" ? "tutor" : "student";
  const externalIssuer = (params.externalIssuer || "manual").trim();
  const externalSubject = (params.externalSubject || email).trim();

  if (!email || !email.includes("@")) {
    throw new Error("A valid email address is required");
  }
  if (!name) {
    throw new Error("User full name is required");
  }

  const res = await query(
    `INSERT INTO organization_sso_users (
       organization_id, external_issuer, external_subject, email, name, role, is_active, auto_provisioned
     )
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, FALSE)
     ON CONFLICT (organization_id, external_issuer, external_subject)
     DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, role = EXCLUDED.role, is_active = TRUE, updated_at = NOW()
     RETURNING id, organization_id, external_issuer, external_subject, email, name, role,
               is_active, auto_provisioned, last_login_at, created_at, updated_at;`,
    [organizationId, externalIssuer, externalSubject, email, name, role]
  );

  const row = res.rows[0];
  return {
    id: row.id,
    organizationId: row.organization_id,
    externalIssuer: row.external_issuer,
    externalSubject: row.external_subject,
    email: row.email,
    name: row.name,
    role: row.role as ParticipantRole,
    isActive: Boolean(row.is_active),
    autoProvisioned: Boolean(row.auto_provisioned),
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Updates an SSO user's status (e.g. revoking or reactivating access) or role.
 */
export async function updateSsoUser(
  organizationId: string,
  userId: string,
  updates: {
    role?: ParticipantRole;
    isActive?: boolean;
  }
): Promise<SsoUser> {
  const fields: string[] = [];
  const params: any[] = [userId, organizationId];
  let paramIndex = 3;

  if (updates.role && (updates.role === "student" || updates.role === "tutor")) {
    fields.push(`role = $${paramIndex++}`);
    params.push(updates.role);
  }

  if (typeof updates.isActive === "boolean") {
    fields.push(`is_active = $${paramIndex++}`);
    params.push(updates.isActive);
  }

  if (fields.length === 0) {
    throw new Error("No update fields provided");
  }

  fields.push("updated_at = NOW()");

  const updateSql = `
    UPDATE organization_sso_users
    SET ${fields.join(", ")}
    WHERE id = $1 AND organization_id = $2
    RETURNING id, organization_id, external_issuer, external_subject, email, name, role,
              is_active, auto_provisioned, last_login_at, created_at, updated_at;
  `;

  const res = await query(updateSql, params);
  if (res.rows.length === 0) {
    throw new Error("User not found in organization");
  }

  const row = res.rows[0];
  return {
    id: row.id,
    organizationId: row.organization_id,
    externalIssuer: row.external_issuer,
    externalSubject: row.external_subject,
    email: row.email,
    name: row.name,
    role: row.role as ParticipantRole,
    isActive: Boolean(row.is_active),
    autoProvisioned: Boolean(row.auto_provisioned),
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Deletes an SSO user record.
 */
export async function deleteSsoUser(organizationId: string, userId: string): Promise<boolean> {
  const res = await query(
    `DELETE FROM organization_sso_users
     WHERE id = $1 AND organization_id = $2;`,
    [userId, organizationId]
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * M2M Server-Side: Issues a single-use SSO launch token.
 * Enforces organization SSO enablement, domain verification/allowlist, active status,
 * role escalation protection, and generates an audit log.
 */
export async function createSsoLaunchToken(params: CreateLaunchTokenParams): Promise<SsoLaunchResult> {
  const {
    organizationId,
    apiKeyId,
    roomCode,
    userId,
    email: rawEmail,
    name: rawName,
    role: requestedRole,
    externalIssuer = "external",
    permissions = {},
  } = params;

  if (!organizationId) {
    throw new Error("Organization ID is required");
  }
  if (!roomCode || typeof roomCode !== "string") {
    throw new Error("Valid roomCode is required");
  }
  if (!userId || typeof userId !== "string" || !userId.trim()) {
    throw new Error("userId / externalSubject is required");
  }
  if (!rawEmail || typeof rawEmail !== "string" || !rawEmail.includes("@")) {
    throw new Error("A valid user email address is required");
  }
  if (!rawName || typeof rawName !== "string" || !rawName.trim()) {
    throw new Error("User name is required");
  }

  const email = rawEmail.trim().toLowerCase();
  const name = rawName.trim();
  const normalizedRoomCode = roomCode.trim().toLowerCase();
  const externalSubject = userId.trim();

  // 1. Verify organization status
  const orgRes = await query("SELECT id, status, name FROM organizations WHERE id = $1;", [organizationId]);
  if (orgRes.rows.length === 0 || orgRes.rows[0].status !== "active") {
    const error: any = new Error("Organization is inactive or suspended");
    error.statusCode = 403;
    error.code = "ORGANIZATION_SUSPENDED";
    throw error;
  }

  // 2. Verify SSO is enabled
  const ssoConfig = await getOrCreateSsoConfig(organizationId);
  if (!ssoConfig.ssoEnabled) {
    const error: any = new Error("SSO is not enabled for this organization. Enable it in the Developer Console.");
    error.statusCode = 403;
    error.code = "SSO_DISABLED";
    throw error;
  }

  // 3. Verify room exists, is active, and belongs to this organization
  const roomRes = await query(
    `SELECT id, room_code, organization_id, is_active
     FROM live_classes
     WHERE (id::text = $1 OR room_code = $1) AND organization_id = $2;`,
    [normalizedRoomCode, organizationId]
  );

  if (roomRes.rows.length === 0 || !roomRes.rows[0].is_active) {
    const error: any = new Error("Room not found, has ended, or belongs to a different organization");
    error.statusCode = 404;
    error.code = "ROOM_NOT_FOUND";
    throw error;
  }
  const room = roomRes.rows[0];

  // 4. Verify Identity against Allowlist or Auto-Provision Domain
  const existingUserRes = await query(
    `SELECT id, role, is_active, auto_provisioned
     FROM organization_sso_users
     WHERE organization_id = $1 AND (
       (external_issuer = $2 AND external_subject = $3) OR LOWER(email) = $4
     )
     ORDER BY created_at ASC
     LIMIT 1;`,
    [organizationId, externalIssuer, externalSubject, email]
  );

  let effectiveRole: ParticipantRole = ssoConfig.defaultRole;
  let autoProvisioned = false;

  if (existingUserRes.rows.length > 0) {
    const userRow = existingUserRes.rows[0];
    if (!userRow.is_active) {
      const error: any = new Error("User access has been revoked by the organization administrator");
      error.statusCode = 403;
      error.code = "SSO_USER_REVOKED";
      throw error;
    }

    // Role Escalation Defense:
    // If the organization admin has explicitly restricted this user as a student,
    // prevent the external caller from overriding it to tutor.
    effectiveRole = userRow.role as ParticipantRole;
    autoProvisioned = Boolean(userRow.auto_provisioned);

    // If caller explicitly requested a role and user is tutor, allow requested role if valid
    if (requestedRole && (requestedRole === "student" || requestedRole === "tutor")) {
      if (userRow.role === "tutor") {
        effectiveRole = requestedRole;
      }
    }
  } else {
    // User is not yet in allowlist: Check verified domains for auto-provisioning
    if (!ssoConfig.allowAutoProvisioning) {
      const error: any = new Error("User is not in the organization allowlist and automatic provisioning is disabled");
      error.statusCode = 403;
      error.code = "SSO_ACCESS_DENIED";
      throw error;
    }

    const domain = email.split("@")[1]?.toLowerCase();
    const domainRes = await query(
      `SELECT id FROM organization_sso_domains
       WHERE organization_id = $1 AND domain = $2 AND is_verified = TRUE;`,
      [organizationId, domain]
    );

    if (domainRes.rows.length === 0) {
      const error: any = new Error(`Email domain '@${domain}' is not authorized for SSO under this organization`);
      error.statusCode = 403;
      error.code = "SSO_DOMAIN_UNAUTHORIZED";
      throw error;
    }

    // Auto-provision user record
    effectiveRole = requestedRole === "tutor" ? "tutor" : ssoConfig.defaultRole;
    autoProvisioned = true;

    await query(
      `INSERT INTO organization_sso_users (
         organization_id, external_issuer, external_subject, email, name, role, is_active, auto_provisioned
       )
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, TRUE)
       ON CONFLICT (organization_id, external_issuer, external_subject)
       DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, updated_at = NOW();`,
      [organizationId, externalIssuer, externalSubject, email, name, effectiveRole]
    );
  }

  // 5. Generate high-entropy single-use launch token
  const rawToken = `sso_launch_${generateSecureBase62(32)}`;
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  // Expires in 5 minutes (300 seconds)
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await query(
    `INSERT INTO sso_launch_tokens (
       organization_id, token_hash, room_code, external_user_id, email, name, role, permissions, expires_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9);`,
    [
      organizationId,
      tokenHash,
      room.room_code,
      externalSubject,
      email,
      name,
      effectiveRole,
      JSON.stringify(permissions),
      expiresAt.toISOString(),
    ]
  );

  // 6. Audit Trail
  if (apiKeyId) {
    await query(
      `INSERT INTO api_key_audit_logs (organization_id, api_key_id, action, actor_id, key_prefix, metadata)
       VALUES ($1, $2, 'sso_launch_created', 'system', 'sso', $3::jsonb);`,
      [
        organizationId,
        apiKeyId,
        JSON.stringify({
          email,
          name,
          role: effectiveRole,
          autoProvisioned,
          externalIssuer,
          roomCode: room.room_code,
        }),
      ]
    ).catch(() => {});
  }

  const frontendBase = process.env.FRONTEND_URL || "https://classroom-meet.vercel.app";
  const cleanFrontendBase = frontendBase.replace(/\/$/, "");

  return {
    launchToken: rawToken,
    roomCode: room.room_code,
    launchUrl: `${cleanFrontendBase}/meet/${room.room_code}#sso_token=${rawToken}`,
    embedUrl: `${cleanFrontendBase}/embed/${room.room_code}#sso_token=${rawToken}`,
    expiresAt: expiresAt.toISOString(),
    user: {
      externalUserId: externalSubject,
      email,
      name,
      role: effectiveRole,
      autoProvisioned,
    },
  };
}

/**
 * Consumes a single-use SSO launch token and mints an authoritative participant JWT.
 * Guarantees single-use replay protection and room-binding integrity.
 */
export async function consumeSsoLaunchToken(params: {
  rawToken: string;
  roomCode?: string;
}): Promise<ConsumeLaunchTokenResult> {
  const { rawToken, roomCode } = params;

  if (!rawToken || typeof rawToken !== "string" || !rawToken.trim()) {
    const error: any = new Error("Missing launch token");
    error.statusCode = 400;
    error.code = "MISSING_TOKEN";
    throw error;
  }

  const tokenHash = crypto.createHash("sha256").update(rawToken.trim()).digest("hex");

  // 1. Atomic Single-Use Token Consumption (Replay Attack Defense)
  const consumeRes = await query(
    `UPDATE sso_launch_tokens
     SET used_at = NOW()
     WHERE token_hash = $1
       AND used_at IS NULL
       AND expires_at > NOW()
     RETURNING id, organization_id, room_code, external_user_id, email, name, role, permissions, expires_at;`,
    [tokenHash]
  );

  if (consumeRes.rows.length === 0) {
    // Diagnose exact failure condition for auditable security logging
    const checkRes = await query(
      `SELECT used_at, expires_at FROM sso_launch_tokens WHERE token_hash = $1;`,
      [tokenHash]
    );

    if (checkRes.rows.length > 0) {
      const row = checkRes.rows[0];
      if (row.used_at) {
        const error: any = new Error("This SSO launch token has already been consumed (replay blocked)");
        error.statusCode = 401;
        error.code = "SSO_TOKEN_ALREADY_USED";
        throw error;
      }
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        const error: any = new Error("This SSO launch token has expired");
        error.statusCode = 401;
        error.code = "SSO_TOKEN_EXPIRED";
        throw error;
      }
    }

    const error: any = new Error("Invalid or unrecognized SSO launch token");
    error.statusCode = 401;
    error.code = "INVALID_SSO_TOKEN";
    throw error;
  }

  const tokenRecord = consumeRes.rows[0];

  // 2. Room Binding Check (if roomCode was provided by caller)
  if (roomCode && roomCode.trim().toLowerCase() !== tokenRecord.room_code.toLowerCase()) {
    const error: any = new Error("SSO launch token is not bound to this room");
    error.statusCode = 403;
    error.code = "ROOM_MISMATCH";
    throw error;
  }

  // 3. Verify user active status in organization
  const userCheckRes = await query(
    `SELECT is_active FROM organization_sso_users
     WHERE organization_id = $1 AND (LOWER(email) = LOWER($2) OR external_subject = $3);`,
    [tokenRecord.organization_id, tokenRecord.email, tokenRecord.external_user_id]
  );

  if (userCheckRes.rows.length > 0 && !userCheckRes.rows[0].is_active) {
    const error: any = new Error("User access has been revoked");
    error.statusCode = 403;
    error.code = "SSO_USER_REVOKED";
    throw error;
  }

  // Update last login
  await query(
    `UPDATE organization_sso_users
     SET last_login_at = NOW()
     WHERE organization_id = $1 AND (LOWER(email) = LOWER($2) OR external_subject = $3);`,
    [tokenRecord.organization_id, tokenRecord.email, tokenRecord.external_user_id]
  );

  // 4. Fetch Room Record
  const roomRes = await query(
    `SELECT id, room_code, is_active FROM live_classes WHERE room_code = $1;`,
    [tokenRecord.room_code]
  );

  if (roomRes.rows.length === 0 || !roomRes.rows[0].is_active) {
    const error: any = new Error("Room not found or meeting has ended");
    error.statusCode = 404;
    error.code = "ROOM_NOT_FOUND";
    throw error;
  }
  const room = roomRes.rows[0];

  // 5. Mint Authoritative Participant Token
  const issued = issueParticipantToken({
    organizationId: tokenRecord.organization_id,
    room: {
      id: room.id,
      room_code: room.room_code,
      is_active: true,
    },
    participantId: tokenRecord.external_user_id,
    name: tokenRecord.name,
    role: tokenRecord.role as ParticipantRole,
    expiresInSeconds: 14400, // 4 hours
    permissions: tokenRecord.permissions || {},
  });

  return {
    success: true,
    participantToken: issued.token,
    roomCode: room.room_code,
    role: tokenRecord.role as ParticipantRole,
    name: tokenRecord.name,
    participantId: tokenRecord.external_user_id,
    claims: issued.claims,
    expiresAt: issued.expiresAt,
  };
}
