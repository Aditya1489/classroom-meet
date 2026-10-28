/**
 * Mathsy Meet Structured JSON Logger with Automated Secret Redaction
 *
 * Emits clean, standardized JSON log entries across the control plane.
 * Guarantees automated redaction of secret API keys, bearer tokens,
 * participant JWTs, webhook secrets, and sensitive object keys.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEY_REGEX = /^(password|token|secret|apiKey|api_key|authorization|rawKey|cookie|refreshToken|access_token|id_token|encrypted_secret|encryptedSecret|encryptionKey|secret_hash|secretHash)$/i;

// Regex patterns to match secret strings in text/URLs/headers
const SECRET_STRING_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-_.]+/gi,
  /(sec_live_|sec_test_|sk_live_|sk_test_)[A-Za-z0-9_]{16,64}/gi,
  /whsec_[A-Za-z0-9_]{16,64}/gi,
  /eyJ[A-Za-z0-9\-_=]+\.eyJ[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+/g, // JWTs
];

/**
 * Sanitizes a string by redacting known token and key patterns.
 */
export function redactString(str: string): string {
  if (!str || typeof str !== "string") return str;
  let sanitized = str;

  // Redact Bearer tokens
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9\-_.]+/gi, "Bearer [REDACTED]");
  // Redact API Keys
  sanitized = sanitized.replace(/(sec_live_|sec_test_|sk_live_|sk_test_)[A-Za-z0-9_]{16,64}/gi, "$1***[REDACTED]");
  // Redact Webhook Secrets
  sanitized = sanitized.replace(/whsec_[A-Za-z0-9_]{16,64}/gi, "whsec_***[REDACTED]");
  // Redact JWTs
  sanitized = sanitized.replace(/eyJ[A-Za-z0-9\-_=]+\.eyJ[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+/g, "[JWT_REDACTED]");

  return sanitized;
}

/**
 * Recursively deep-sanitizes an object, masking sensitive keys and string patterns.
 */
export function redactObject(obj: any, depth = 0): any {
  if (depth > 6) return "[MAX_DEPTH]";
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "string") {
    return redactString(obj);
  }

  if (typeof obj !== "object") {
    return obj;
  }

  if (obj instanceof Error) {
    return {
      name: obj.name,
      message: redactString(obj.message),
      stack: redactString(obj.stack || ""),
    };
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item, depth + 1));
  }

  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      cleaned[key] = "[REDACTED]";
    } else {
      cleaned[key] = redactObject(value, depth + 1);
    }
  }

  return cleaned;
}

export interface LogContext {
  requestId?: string;
  organizationId?: string;
  roomCode?: string;
  [key: string]: any;
}

class Logger {
  private formatLog(level: LogLevel, message: string, context?: LogContext): string {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message: redactString(message),
      ...(context ? redactObject(context) : {}),
    };
    return JSON.stringify(entry);
  }

  public info(message: string, context?: LogContext): void {
    const formatted = this.formatLog("info", message, context);
    console.log(formatted);
  }

  public warn(message: string, context?: LogContext): void {
    const formatted = this.formatLog("warn", message, context);
    console.warn(formatted);
  }

  public error(message: string, context?: LogContext): void {
    const formatted = this.formatLog("error", message, context);
    console.error(formatted);
  }

  public debug(message: string, context?: LogContext): void {
    if (process.env.NODE_ENV === "development" || process.env.DEBUG === "true") {
      const formatted = this.formatLog("debug", message, context);
      console.log(formatted);
    }
  }

  public redact(data: any): any {
    return typeof data === "string" ? redactString(data) : redactObject(data);
  }
}

export const logger = new Logger();
