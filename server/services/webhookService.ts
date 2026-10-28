import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { query } from "../db";
import { logger } from "./logger";
import { getWebhookEncryptionKey } from "./envValidator";

// ============================================================================
// WEBHOOK SERVICE — SECURE OUTBOUND LIFECYCLE EVENT DISPATCHER
// ============================================================================

export interface WebhookEndpointRecord {
  id: string;
  organization_id: string;
  url: string;
  secret_hash: string;
  secret_prefix: string;
  events: string[];
  is_active: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface MaskedWebhookEndpoint {
  id: string;
  organizationId: string;
  url: string;
  secretPrefix: string;
  events: string[];
  isActive: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookPayload<T = any> {
  event: string;
  eventId: string;
  timestamp: number;
  organizationId: string;
  data: T;
}

// In-flight concurrency tracker per organization (max 5 simultaneous requests per tenant)
const activeDispatchesPerOrg = new Map<string, number>();
const MAX_CONCURRENT_DISPATCHES = 5;

/**
 * Validates target URL against SSRF (Server-Side Request Forgery) attacks.
 * Blocks loopback, link-local, cloud-metadata (169.254.169.254), and RFC1918 private IPs.
 * Allows override in test environments if ALLOW_LOCAL_WEBHOOKS="true".
 */
export async function validateWebhookUrl(targetUrl: string): Promise<{ valid: boolean; reason?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { valid: false, reason: "Invalid URL format" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, reason: "Only http and https protocols are supported" };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Allow localhost only if explicitly enabled for local testing
  if (process.env.ALLOW_LOCAL_WEBHOOKS === "true") {
    return { valid: true };
  }

  const hostClean = hostname.replace(/^\[|\]$/g, "");

  // Block localhost and standard loopback names
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostClean === "127.0.0.1" ||
    hostClean === "::1" ||
    hostClean === "0.0.0.0"
  ) {
    return { valid: false, reason: "Loopback and localhost destinations are prohibited" };
  }

  // If the host is already an IP literal (IPv4 or IPv6), validate directly without DNS lookup
  if (net.isIP(hostClean)) {
    if (isPrivateOrRestrictedIp(hostClean)) {
      return { valid: false, reason: `Target IP address '${hostClean}' is in a restricted or private subnet` };
    }
    return { valid: true };
  }

  // Resolve hostname to IP address to prevent DNS rebinding
  try {
    const addresses = await dns.lookup(hostClean, { all: true });
    for (const addr of addresses) {
      const ip = addr.address;
      if (isPrivateOrRestrictedIp(ip)) {
        return { valid: false, reason: `Resolved IP address '${ip}' is in a restricted or private subnet` };
      }
    }
  } catch (err: any) {
    return { valid: false, reason: `DNS resolution failed for host '${hostClean}': ${err.message}` };
  }

  return { valid: true };
}

/**
 * Parses any valid IPv6 address into an array of 8 16-bit words.
 * Returns null if the address is not valid IPv6.
 */
export function parseIPv6ToWords(ip: string): number[] | null {
  if (!net.isIPv6(ip)) return null;
  let lower = ip.toLowerCase();

  // Handle embedded IPv4 at the end (e.g. ::ffff:192.168.1.1 or ::192.168.1.1)
  const lastColon = lower.lastIndexOf(":");
  if (lastColon !== -1) {
    const afterColon = lower.slice(lastColon + 1);
    if (net.isIPv4(afterColon)) {
      const p = afterColon.split(".").map(Number);
      const w1 = ((p[0] << 8) | p[1]).toString(16);
      const w2 = ((p[2] << 8) | p[3]).toString(16);
      lower = lower.slice(0, lastColon + 1) + w1 + ":" + w2;
    }
  }

  const doubleColonIdx = lower.indexOf("::");
  let leftParts: string[] = [];
  let rightParts: string[] = [];

  if (doubleColonIdx !== -1) {
    const leftStr = lower.slice(0, doubleColonIdx);
    const rightStr = lower.slice(doubleColonIdx + 2);
    leftParts = leftStr ? leftStr.split(":") : [];
    rightParts = rightStr ? rightStr.split(":") : [];
    const missing = 8 - (leftParts.length + rightParts.length);
    if (missing < 0) return null;
    const mid = new Array(missing).fill("0");
    const allParts = [...leftParts, ...mid, ...rightParts];
    return allParts.map((p) => parseInt(p, 16));
  } else {
    const allParts = lower.split(":");
    if (allParts.length !== 8) return null;
    return allParts.map((p) => parseInt(p, 16));
  }
}

/**
 * Checks if an IPv4 or IPv6 address belongs to private, loopback, metadata, multicast, or reserved ranges.
 */
export function isPrivateOrRestrictedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    // Loopback 127.0.0.0/8
    if (parts[0] === 127) return true;
    // Current network / default route 0.0.0.0/8
    if (parts[0] === 0) return true;
    // Cloud metadata & Link-local 169.254.0.0/16
    if (parts[0] === 169 && parts[1] === 254) return true;
    // Private RFC1918 10.0.0.0/8
    if (parts[0] === 10) return true;
    // Private RFC1918 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // Private RFC1918 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // Carrier-grade NAT 100.64.0.0/10
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    // IETF Protocol Assignments 192.0.0.0/24 & TEST-NET-1 192.0.2.0/24
    if (parts[0] === 192 && parts[1] === 0 && (parts[2] === 0 || parts[2] === 2)) return true;
    // TEST-NET-2 198.51.100.0/24
    if (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) return true;
    // TEST-NET-3 203.0.113.0/24
    if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) return true;
    // Network Benchmark Tests 198.18.0.0/15
    if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;
    // Multicast (224.0.0.0/4) & Reserved (240.0.0.0/4) & Broadcast (255.255.255.255)
    if (parts[0] >= 224) return true;
  } else if (net.isIPv6(ip)) {
    const words = parseIPv6ToWords(ip);
    if (!words) return true; // Malformed IPv6, reject defensively

    // Unspecified address ::/128
    if (words.every((w) => w === 0)) return true;
    // Loopback address ::1/128
    if (words.slice(0, 7).every((w) => w === 0) && words[7] === 1) return true;

    // IPv4-mapped IPv6 address ::ffff:0:0/96 (e.g. ::ffff:127.0.0.1 or ::ffff:169.254.169.254)
    if (words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0 && words[4] === 0 && words[5] === 0xffff) {
      const ipv4 = `${(words[6] >> 8) & 0xff}.${words[6] & 0xff}.${(words[7] >> 8) & 0xff}.${words[7] & 0xff}`;
      return isPrivateOrRestrictedIp(ipv4);
    }

    // IPv4-compatible IPv6 address ::0:0/96 (e.g. ::127.0.0.1, ::169.254.169.254, ::7f00:1)
    if (words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0 && words[4] === 0 && words[5] === 0) {
      const ipv4 = `${(words[6] >> 8) & 0xff}.${words[6] & 0xff}.${(words[7] >> 8) & 0xff}.${words[7] & 0xff}`;
      return isPrivateOrRestrictedIp(ipv4);
    }

    // NAT64 prefix 64:ff9b::/96 (translates to embedded IPv4)
    if (words[0] === 0x0064 && words[1] === 0xff9b && words[2] === 0 && words[3] === 0 && words[4] === 0 && words[5] === 0) {
      const ipv4 = `${(words[6] >> 8) & 0xff}.${words[6] & 0xff}.${(words[7] >> 8) & 0xff}.${words[7] & 0xff}`;
      return isPrivateOrRestrictedIp(ipv4);
    }

    // 6to4 encapsulation 2002::/16 (embeds IPv4 in words 1 and 2)
    if (words[0] === 0x2002) {
      const ipv4 = `${(words[1] >> 8) & 0xff}.${words[1] & 0xff}.${(words[2] >> 8) & 0xff}.${words[2] & 0xff}`;
      return isPrivateOrRestrictedIp(ipv4);
    }

    // Link-local fe80::/10
    if ((words[0] & 0xffc0) === 0xfe80) return true;
    // Unique local fc00::/7 (private IPv6)
    if ((words[0] & 0xfe00) === 0xfc00) return true;
    // Multicast ff00::/8
    if ((words[0] & 0xff00) === 0xff00) return true;
    // Discard prefix 100::/64
    if (words[0] === 0x0100 && words[1] === 0 && words[2] === 0 && words[3] === 0) return true;
    // Documentation 2001:db8::/32
    if (words[0] === 0x2001 && words[1] === 0x0db8) return true;
  }
  return false;
}

/**
 * Encrypts a webhook secret at rest using AES-256-GCM
 */
export function encryptWebhookSecret(secret: string, keyBuffer: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts an AES-256-GCM encrypted webhook secret
 */
export function decryptWebhookSecret(encryptedPayload: string, keyBuffer: Buffer): string {
  const parts = encryptedPayload.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted webhook secret format");
  }
  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const data = Buffer.from(dataHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuffer, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Generates an HMAC-SHA256 signature for an outbound webhook payload
 */
export function computeWebhookSignature(secret: string, timestamp: number, payloadJson: string): string {
  const signaturePayload = `${timestamp}.${payloadJson}`;
  return crypto.createHmac("sha256", secret).update(signaturePayload).digest("hex");
}

/**
 * Generates a high-entropy webhook secret (whsec_...) and its SHA-256 hash
 */
export function generateWebhookSecret(): { rawSecret: string; secretHash: string; secretPrefix: string } {
  const rawBytes = crypto.randomBytes(24).toString("hex");
  const rawSecret = `whsec_${rawBytes}`;
  const secretHash = crypto.createHash("sha256").update(rawSecret).digest("hex");
  const secretPrefix = rawSecret.slice(0, 12);
  return { rawSecret, secretHash, secretPrefix };
}

/**
 * Canonical single source of truth for webhook events currently emitted by the Mathsy Meet backend.
 * Unimplemented events (participant.joined, participant.left, recording.ready) must NOT be added here
 * until their corresponding signaling / worker event emission hooks are implemented.
 */
export const SUPPORTED_WEBHOOK_EVENTS = ["room.created", "room.ended"] as const;
export type SupportedWebhookEvent = (typeof SUPPORTED_WEBHOOK_EVENTS)[number];

/**
 * Validates an array of webhook event strings against SUPPORTED_WEBHOOK_EVENTS.
 * Rejects malformed values, non-string items, unknown event names, and currently unimplemented events.
 */
export function validateWebhookEvents(events: unknown): {
  valid: boolean;
  events?: SupportedWebhookEvent[];
  error?: string;
} {
  if (events === undefined) {
    return { valid: true, events: [...SUPPORTED_WEBHOOK_EVENTS] };
  }

  if (!Array.isArray(events)) {
    return {
      valid: false,
      error: `events must be an array of supported event strings: ${SUPPORTED_WEBHOOK_EVENTS.join(", ")}`,
    };
  }

  if (events.length === 0) {
    return {
      valid: false,
      error: `events array must not be empty. Supported events are: ${SUPPORTED_WEBHOOK_EVENTS.join(", ")}`,
    };
  }

  const supportedSet = new Set<string>(SUPPORTED_WEBHOOK_EVENTS);
  const validatedEvents: SupportedWebhookEvent[] = [];

  for (const item of events) {
    if (typeof item !== "string" || item.trim().length === 0) {
      return {
        valid: false,
        error: `Invalid event type. Each event must be a non-empty string. Supported events are: ${SUPPORTED_WEBHOOK_EVENTS.join(", ")}`,
      };
    }

    const trimmed = item.trim();
    if (!supportedSet.has(trimmed)) {
      return {
        valid: false,
        error: `Unsupported webhook event '${trimmed}'. Currently supported events are: ${SUPPORTED_WEBHOOK_EVENTS.join(", ")}`,
      };
    }

    if (!validatedEvents.includes(trimmed as SupportedWebhookEvent)) {
      validatedEvents.push(trimmed as SupportedWebhookEvent);
    }
  }

  return { valid: true, events: validatedEvents };
}

/**
 * Registers a new organization-scoped webhook endpoint
 */
export async function createWebhookEndpoint(options: {
  organizationId: string;
  url: string;
  events?: string[];
  description?: string;
}): Promise<{ endpoint: MaskedWebhookEndpoint; rawSecret: string }> {
  const validation = await validateWebhookUrl(options.url);
  if (!validation.valid) {
    throw new Error(`Invalid webhook URL: ${validation.reason}`);
  }

  const eventsValidation = validateWebhookEvents(options.events);
  if (!eventsValidation.valid) {
    throw new Error(eventsValidation.error);
  }
  const allowedEvents = eventsValidation.events!;

  const { rawSecret, secretHash, secretPrefix } = generateWebhookSecret();

  // Encrypt rawSecret at rest using authenticated AES-256-GCM
  const encryptionKey = getWebhookEncryptionKey();
  const encryptedSecret = encryptWebhookSecret(rawSecret, encryptionKey);

  const sql = `
    INSERT INTO webhook_endpoints (
      organization_id, url, secret_hash, secret_prefix, encrypted_secret, events, is_active, description
    )
    VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7)
    RETURNING id, organization_id, url, secret_prefix, events, is_active, description, created_at, updated_at;
  `;

  const res = await query(sql, [
    options.organizationId,
    options.url.trim(),
    secretHash,
    secretPrefix,
    encryptedSecret,
    allowedEvents,
    options.description?.trim() || null,
  ]);

  const row = res.rows[0];
  const endpoint: MaskedWebhookEndpoint = {
    id: row.id,
    organizationId: row.organization_id,
    url: row.url,
    secretPrefix: row.secret_prefix,
    events: row.events,
    isActive: row.is_active,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  // We return rawSecret strictly ONCE during creation; it is not persisted in plaintext
  return { endpoint, rawSecret };
}

/**
 * Lists webhook endpoints for an organization
 */
export async function listWebhookEndpoints(organizationId: string): Promise<MaskedWebhookEndpoint[]> {
  const sql = `
    SELECT id, organization_id, url, secret_prefix, events, is_active, description, created_at, updated_at
    FROM webhook_endpoints
    WHERE organization_id = $1
    ORDER BY created_at DESC;
  `;
  const res = await query(sql, [organizationId]);
  return res.rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    url: row.url,
    secretPrefix: row.secret_prefix,
    events: row.events,
    isActive: row.is_active,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Dispatches an event to all active endpoints registered for the organization and event type.
 * Completely asynchronous and resilient: errors or slow customer servers never throw to caller.
 */
export async function dispatchWebhookEvent(
  organizationId: string,
  eventType: string,
  eventData: any
): Promise<void> {
  try {
    // 1. Fetch active endpoints matching this organization and event
    const endpointsRes = await query(
      `SELECT id, organization_id, url, secret_hash, encrypted_secret, events
       FROM webhook_endpoints
       WHERE organization_id = $1 AND is_active = TRUE AND $2 = ANY(events);`,
      [organizationId, eventType]
    );

    if (endpointsRes.rows.length === 0) {
      return;
    }

    const eventId = `evt_${crypto.randomUUID().replace(/-/g, "")}`;
    const timestamp = Math.floor(Date.now() / 1000);

    const payload: WebhookPayload = {
      event: eventType,
      eventId,
      timestamp,
      organizationId,
      data: eventData,
    };

    const payloadJson = JSON.stringify(payload);

    // 2. Dispatch to each matching endpoint with concurrency control
    for (const row of endpointsRes.rows) {
      deliverToEndpointAsync({
        endpointId: row.id,
        organizationId,
        url: row.url,
        secretHash: row.secret_hash,
        encryptedSecret: row.encrypted_secret,
        payload,
        payloadJson,
        eventId,
        timestamp,
        attempt: 1,
      });
    }
  } catch (err: any) {
    logger.error("Failed to initiate webhook dispatch", { organizationId, eventType, error: err.message });
  }
}

/**
 * Dispatches a test event directly to a specific webhook endpoint.
 * Bypasses room-lifecycle event filtering so test pings succeed even if
 * 'webhook.test' is not among the endpoint's regular subscriptions.
 */
export async function dispatchTestWebhook(
  organizationId: string,
  endpointId: string,
  eventData?: any
): Promise<{ dispatched: boolean; eventId?: string; reason?: string }> {
  try {
    const endpointsRes = await query(
      `SELECT id, organization_id, url, secret_hash, encrypted_secret, is_active
       FROM webhook_endpoints
       WHERE id = $1 AND organization_id = $2;`,
      [endpointId, organizationId]
    );

    if (endpointsRes.rows.length === 0) {
      return { dispatched: false, reason: "Webhook endpoint not found" };
    }

    const row = endpointsRes.rows[0];
    const eventId = `evt_${crypto.randomUUID().replace(/-/g, "")}`;
    const timestamp = Math.floor(Date.now() / 1000);

    const payload: WebhookPayload = {
      event: "webhook.test",
      eventId,
      timestamp,
      organizationId,
      data: eventData || {
        message: "This is a test notification from Mathsy Meet Webhook Engine",
        testedAt: new Date().toISOString(),
      },
    };

    const payloadJson = JSON.stringify(payload);

    deliverToEndpointAsync({
      endpointId: row.id,
      organizationId,
      url: row.url,
      secretHash: row.secret_hash,
      encryptedSecret: row.encrypted_secret,
      payload,
      payloadJson,
      eventId,
      timestamp,
      attempt: 1,
    });

    return { dispatched: true, eventId };
  } catch (err: any) {
    logger.error("Failed to initiate test webhook dispatch", { organizationId, endpointId, error: err.message });
    return { dispatched: false, reason: err.message };
  }
}

interface DeliveryOptions {
  endpointId: string;
  organizationId: string;
  url: string;
  secretHash: string;
  encryptedSecret?: string | null;
  payload: WebhookPayload;
  payloadJson: string;
  eventId: string;
  timestamp: number;
  attempt: number;
}

/**
 * Internal async dispatcher with timeout, SSRF check, signature generation, and delivery logging.
 */
async function deliverToEndpointAsync(options: DeliveryOptions): Promise<void> {
  const { endpointId, organizationId, url, secretHash, encryptedSecret, payload, payloadJson, eventId, timestamp, attempt } = options;

  // Concurrency throttling per organization
  const currentActive = activeDispatchesPerOrg.get(organizationId) || 0;
  if (currentActive >= MAX_CONCURRENT_DISPATCHES) {
    logger.warn("Webhook concurrency limit reached for organization; scheduling delayed delivery", { organizationId });
    setTimeout(() => deliverToEndpointAsync(options), 2000);
    return;
  }
  activeDispatchesPerOrg.set(organizationId, currentActive + 1);

  try {
    // Re-verify URL immediately before request to prevent dynamic DNS rebinding
    const validation = await validateWebhookUrl(url);
    if (!validation.valid) {
      await recordDelivery({
        endpointId,
        organizationId,
        eventId,
        eventType: payload.event,
        payload: payloadJson,
        attemptCount: attempt,
        status: "failed",
        errorMessage: `SSRF Block: ${validation.reason}`,
      });
      return;
    }

    // Decrypt the raw webhook secret for HMAC signing
    let signingSecret = "";
    if (encryptedSecret) {
      try {
        signingSecret = decryptWebhookSecret(encryptedSecret, getWebhookEncryptionKey());
      } catch (decErr: any) {
        logger.error("Failed to decrypt webhook secret for delivery", { endpointId, error: decErr.message });
        await recordDelivery({
          endpointId,
          organizationId,
          eventId,
          eventType: payload.event,
          payload: payloadJson,
          attemptCount: attempt,
          status: "failed",
          errorMessage: `Decryption failure: ${decErr.message}`,
        });
        return;
      }
    } else {
      // Legacy endpoint created prior to encryption: cannot compute valid HMAC without secret
      logger.warn("Webhook endpoint has legacy hash-only secret; secret rotation required", { endpointId });
      await recordDelivery({
        endpointId,
        organizationId,
        eventId,
        eventType: payload.event,
        payload: payloadJson,
        attemptCount: attempt,
        status: "failed",
        errorMessage: "Legacy webhook secret requires rotation to enable verified HMAC delivery.",
      });
      return;
    }

    // Generate authoritative HMAC signature using original raw secret matching SDK verifier
    const signature = computeWebhookSignature(signingSecret, timestamp, payloadJson);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    let responseStatus: number | null = null;
    let responseBodyText = "";
    let isSuccess = false;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "MathsyMeet-Webhooks/1.0",
          "X-Mathsy-Signature": `t=${timestamp},v1=${signature}`,
          "X-Mathsy-Event-Id": eventId,
          "X-Mathsy-Timestamp": String(timestamp),
        },
        body: payloadJson,
        signal: controller.signal,
        redirect: "error", // CRITICAL (HIGH-01): Disallow HTTP redirects to prevent SSRF bypass
      });

      clearTimeout(timeout);
      responseStatus = response.status;
      isSuccess = response.ok;
      try {
        const bodySnippet = await response.text();
        responseBodyText = bodySnippet.slice(0, 500); // Cap response log
      } catch {}
    } catch (reqErr: any) {
      clearTimeout(timeout);
      const isTimeout = reqErr.name === "AbortError";
      const isRedirect = reqErr.name === "TypeError" && reqErr.message?.includes("redirect");
      if (isRedirect) {
        responseBodyText = "SSRF Block: HTTP redirects are strictly prohibited for outbound webhooks";
      } else {
        responseBodyText = isTimeout ? "Delivery timed out after 5000ms" : reqErr.message;
      }
    }

    if (isSuccess) {
      await recordDelivery({
        endpointId,
        organizationId,
        eventId,
        eventType: payload.event,
        payload: payloadJson,
        responseStatus,
        responseBody: responseBodyText,
        attemptCount: attempt,
        status: "delivered",
      });
    } else {
      // If delivery failed and attempts < 3, retry with backoff
      if (attempt < 3) {
        await recordDelivery({
          endpointId,
          organizationId,
          eventId,
          eventType: payload.event,
          payload: payloadJson,
          responseStatus,
          responseBody: responseBodyText,
          attemptCount: attempt,
          status: "retrying",
          errorMessage: `HTTP ${responseStatus || "Error"}: ${responseBodyText}`,
        });

        const backoffMs = attempt === 1 ? 1500 : 5000;
        setTimeout(() => {
          deliverToEndpointAsync({ ...options, attempt: attempt + 1 });
        }, backoffMs);
      } else {
        await recordDelivery({
          endpointId,
          organizationId,
          eventId,
          eventType: payload.event,
          payload: payloadJson,
          responseStatus,
          responseBody: responseBodyText,
          attemptCount: attempt,
          status: "failed",
          errorMessage: `Final failure after ${attempt} attempts: ${responseBodyText}`,
        });
      }
    }
  } catch (err: any) {
    logger.error("Unhandled error during webhook delivery", { endpointId, error: err.message });
  } finally {
    const remaining = (activeDispatchesPerOrg.get(organizationId) || 1) - 1;
    activeDispatchesPerOrg.set(organizationId, Math.max(0, remaining));
  }
}

/**
 * Records a delivery attempt in the webhook_deliveries table
 */
async function recordDelivery(data: {
  endpointId: string;
  organizationId: string;
  eventId: string;
  eventType: string;
  payload: string;
  responseStatus?: number | null;
  responseBody?: string;
  attemptCount: number;
  status: "delivered" | "failed" | "retrying";
  errorMessage?: string;
}): Promise<void> {
  try {
    const sql = `
      INSERT INTO webhook_deliveries (
        endpoint_id, organization_id, event_id, event_type, payload,
        response_status, response_body, attempt_count, status, error_message, delivered_at
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::varchar, $10, CASE WHEN $9::varchar = 'delivered' THEN NOW() ELSE NULL END);
    `;
    await query(sql, [
      data.endpointId,
      data.organizationId,
      data.eventId,
      data.eventType,
      data.payload,
      data.responseStatus || null,
      data.responseBody || null,
      data.attemptCount,
      data.status,
      data.errorMessage || null,
    ]);
  } catch (err: any) {
    logger.error("Failed to write webhook delivery log", { eventId: data.eventId, error: err.message });
  }
}
