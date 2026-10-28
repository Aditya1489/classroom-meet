import crypto from "node:crypto";
import { logger } from "./logger";

// ============================================================================
// ENVIRONMENT & SECRET VALIDATOR — PRODUCTION SAFETY ENFORCEMENT
// ============================================================================
// Guarantees:
// 1. In production (NODE_ENV=production), startup aborts immediately if any
//    cryptographic secret is missing, weak, or equals the known development default.
// 2. Secret values are NEVER printed to stdout/stderr in error messages.
// 3. In development/testing, secure fallbacks are permitted with a prominent warning.
// ============================================================================

export const DEV_JWT_SECRET = "mathsy_meet_jwt_secret_dev_key_2026";
export const DEV_PARTICIPANT_JWT_SECRET = "mathsy_participant_token_signing_secret_dev_2026_at_least_32_chars";
export const DEV_WEBHOOK_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; // 32-byte hex

export interface EnvironmentValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates all required environment variables and cryptographic secrets.
 * Throws or exits if validation fails in production mode.
 */
export function validateStartupEnvironment(options: {
  nodeEnv?: string;
  exitOnError?: boolean;
} = {}): EnvironmentValidationResult {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "development";
  const isProduction = nodeEnv === "production";
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. JWT_SECRET
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.trim().length === 0) {
    if (isProduction) {
      errors.push("Missing required environment variable: JWT_SECRET");
    } else {
      warnings.push("JWT_SECRET is unset; using development fallback. NEVER use this in production.");
    }
  } else if (isProduction) {
    if (jwtSecret === DEV_JWT_SECRET) {
      errors.push("JWT_SECRET matches known development default key. A unique, high-entropy secret is required.");
    } else if (jwtSecret.length < 32) {
      errors.push("JWT_SECRET is insufficiently strong (must be at least 32 characters in production).");
    }
  }

  // 2. PARTICIPANT_JWT_SECRET
  const participantSecret = process.env.PARTICIPANT_JWT_SECRET;
  if (!participantSecret || participantSecret.trim().length === 0) {
    if (isProduction) {
      errors.push("Missing required environment variable: PARTICIPANT_JWT_SECRET");
    } else {
      warnings.push("PARTICIPANT_JWT_SECRET is unset; using development fallback. SFU signaling must match this key.");
    }
  } else if (isProduction) {
    if (participantSecret === DEV_PARTICIPANT_JWT_SECRET) {
      errors.push("PARTICIPANT_JWT_SECRET matches known development default key. A unique, high-entropy secret is required.");
    } else if (participantSecret.length < 32) {
      errors.push("PARTICIPANT_JWT_SECRET is insufficiently strong (must be at least 32 characters in production).");
    }
  }

  // 3. WEBHOOK_ENCRYPTION_KEY
  const webhookKey = process.env.WEBHOOK_ENCRYPTION_KEY;
  if (!webhookKey || webhookKey.trim().length === 0) {
    if (isProduction) {
      errors.push("Missing required environment variable: WEBHOOK_ENCRYPTION_KEY (AES-256-GCM webhook secret encryption key)");
    } else {
      warnings.push("WEBHOOK_ENCRYPTION_KEY is unset; using development fallback encryption key.");
    }
  } else if (isProduction) {
    if (webhookKey === DEV_WEBHOOK_ENCRYPTION_KEY) {
      errors.push("WEBHOOK_ENCRYPTION_KEY matches known development default key. A unique 32-byte key is required.");
    } else {
      const keyBuffer = parseEncryptionKey(webhookKey);
      if (!keyBuffer || keyBuffer.length !== 32) {
        errors.push("WEBHOOK_ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters or 32 raw bytes).");
      }
    }
  }

  // 4. DATABASE_URL
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || dbUrl.trim().length === 0) {
    if (isProduction) {
      errors.push("Missing required environment variable: DATABASE_URL");
    }
  } else if (isProduction && (dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1"))) {
    if (process.env.ALLOW_LOCAL_DATABASE !== "true") {
      errors.push("DATABASE_URL points to localhost in production. Set ALLOW_LOCAL_DATABASE=true if this is intentional.");
    }
  }

  // 5. MONGODB_URI (In-class temporary chat persistence)
  const mongoUri = process.env.MONGODB_URI;
  if (process.env.DISABLE_MONGODB === "true") {
    warnings.push("MongoDB is explicitly disabled via DISABLE_MONGODB=true. In-class chat persistence will be unavailable.");
  } else if (!mongoUri || mongoUri.trim().length === 0) {
    if (isProduction) {
      errors.push(
        "Missing required environment variable: MONGODB_URI (required for in-session chat persistence in production; set DISABLE_MONGODB=true if intentionally operating without chat)"
      );
    } else {
      warnings.push("MONGODB_URI is unset; defaulting to mongodb://localhost:27017 for local development.");
    }
  } else if (isProduction) {
    if (!mongoUri.startsWith("mongodb://") && !mongoUri.startsWith("mongodb+srv://")) {
      errors.push("MONGODB_URI must begin with 'mongodb://' or 'mongodb+srv://'.");
    } else if (
      (mongoUri.includes("localhost") || mongoUri.includes("127.0.0.1")) &&
      process.env.ALLOW_LOCAL_DATABASE !== "true"
    ) {
      errors.push("MONGODB_URI points to localhost in production. Set ALLOW_LOCAL_DATABASE=true if this is intentional.");
    }
  }

  const valid = errors.length === 0;

  if (warnings.length > 0 && !isProduction) {
    for (const w of warnings) {
      console.warn(`[Config Warning] ⚠️  ${w}`);
    }
  }

  if (!valid) {
    console.error("\n=======================================================");
    console.error("🚨 FATAL CONFIGURATION ERROR: STARTUP VALIDATION FAILED");
    console.error("=======================================================");
    for (const err of errors) {
      console.error(` ❌ ${err}`);
    }
    console.error("=======================================================\n");

    if (options.exitOnError) {
      process.exit(1);
    }

    if (isProduction) {
      throw new Error(`Startup validation failed: ${errors.join("; ")}`);
    }
  }

  return { valid, errors, warnings };
}


/**
 * Parses a 32-byte encryption key from hex or raw string
 */
export function parseEncryptionKey(keyString?: string): Buffer | null {
  if (!keyString) return null;
  const trimmed = keyString.trim();
  // If 64 hex chars -> hex buffer
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  // If 32 raw chars -> utf8 buffer
  if (Buffer.byteLength(trimmed, "utf8") === 32) {
    return Buffer.from(trimmed, "utf8");
  }
  // Try base64
  try {
    const b64 = Buffer.from(trimmed, "base64");
    if (b64.length === 32) return b64;
  } catch {}
  return null;
}

/**
 * Retrieves the effective Webhook Encryption Key Buffer
 */
export function getWebhookEncryptionKey(): Buffer {
  const custom = parseEncryptionKey(process.env.WEBHOOK_ENCRYPTION_KEY);
  if (custom && custom.length === 32) {
    return custom;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Missing or invalid WEBHOOK_ENCRYPTION_KEY in production");
  }
  return Buffer.from(DEV_WEBHOOK_ENCRYPTION_KEY, "hex");
}

/**
 * Retrieves the effective JWT Secret string
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.trim().length > 0) {
    if (process.env.NODE_ENV === "production" && (secret === DEV_JWT_SECRET || secret.length < 32)) {
      throw new Error("Invalid JWT_SECRET in production: Must be at least 32 characters and not the development default.");
    }
    return secret.trim();
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Missing required JWT_SECRET in production");
  }
  return DEV_JWT_SECRET;
}

/**
 * Retrieves the effective Participant JWT Secret string.
 *
 * Development fallback note:
 * In development/testing (NODE_ENV !== "production"), if PARTICIPANT_JWT_SECRET is unset,
 * this falls back to process.env.JWT_SECRET or DEV_PARTICIPANT_JWT_SECRET for developer convenience.
 * RISK NOTE: If PARTICIPANT_JWT_SECRET is unset in development and falls back to JWT_SECRET,
 * tokens minted by control-plane will fail to verify against SFU unless the SFU has the same secret.
 * In production (NODE_ENV === "production"), fallback to JWT_SECRET is strictly disabled.
 * PARTICIPANT_JWT_SECRET must be explicitly configured (≥ 32 chars, not matching default dev keys).
 */
export function getParticipantJwtSecret(): string {
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction) {
    const secret = process.env.PARTICIPANT_JWT_SECRET;
    if (!secret || secret.trim().length === 0) {
      throw new Error(
        "Missing required PARTICIPANT_JWT_SECRET in production. Development fallback to JWT_SECRET is disabled in production."
      );
    }
    if (secret === DEV_PARTICIPANT_JWT_SECRET || secret.length < 32) {
      throw new Error(
        "Invalid PARTICIPANT_JWT_SECRET in production: Must be at least 32 characters and not the development default."
      );
    }
    return secret.trim();
  }

  // Development/testing fallback chain
  const secret = process.env.PARTICIPANT_JWT_SECRET || process.env.JWT_SECRET;
  if (secret && secret.trim().length > 0) {
    return secret.trim();
  }
  return DEV_PARTICIPANT_JWT_SECRET;
}
