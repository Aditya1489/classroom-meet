/**
 * Mathsy Meet SaaS Hosted Embed & postMessage Protocol
 *
 * Defines the strict, typed contract for iframe embedding, parent-to-iframe commands,
 * iframe-to-parent events, and origin validation.
 */

// Documented inbound commands from parent frame
export type EmbedCommandType =
  | "MUTE_AUDIO"
  | "UNMUTE_AUDIO"
  | "ENABLE_VIDEO"
  | "DISABLE_VIDEO"
  | "LEAVE_MEETING"
  | "GET_STATUS";

export const ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  "MUTE_AUDIO",
  "UNMUTE_AUDIO",
  "ENABLE_VIDEO",
  "DISABLE_VIDEO",
  "LEAVE_MEETING",
  "GET_STATUS",
]);

export interface EmbedCommandMessage {
  type: EmbedCommandType;
  payload?: any;
  requestId?: string;
}

// Outbound events sent to parent frame
export type EmbedEventType =
  | "meeting.ready"
  | "meeting.joined"
  | "meeting.left"
  | "participant.joined"
  | "participant.left"
  | "media.state_changed"
  | "meeting.error";

export interface EmbedEventMessage {
  type: EmbedEventType;
  payload: any;
  timestamp: number;
}

/**
 * Validates that an incoming postMessage origin exactly matches one of the
 * tenant-approved origins. Rejects wildcards, empty strings, and unauthorized origins.
 */
export function validatePostMessageOrigin(
  incomingOrigin: string,
  allowedOrigins: string[]
): boolean {
  if (!incomingOrigin || typeof incomingOrigin !== "string") return false;
  if (incomingOrigin === "*" || incomingOrigin === "null") return false;

  const normalizedIncoming = incomingOrigin.trim().toLowerCase();

  for (const allowed of allowedOrigins) {
    if (!allowed || typeof allowed !== "string") continue;
    const normalizedAllowed = allowed.trim().toLowerCase();

    // Exact origin match (e.g. "https://customer.com")
    if (normalizedIncoming === normalizedAllowed) {
      return true;
    }

    // Origin without trailing slash match
    if (normalizedIncoming === normalizedAllowed.replace(/\/$/, "")) {
      return true;
    }
  }

  return false;
}

/**
 * Validates and safely parses an inbound command payload.
 * Returns null if the payload is malformed or requests an undocumented command.
 */
export function parseAndValidateEmbedCommand(data: any): EmbedCommandMessage | null {
  if (!data || typeof data !== "object") return null;
  if (!data.type || typeof data.type !== "string") return null;

  const type = data.type.trim();
  if (!ALLOWED_COMMANDS.has(type)) {
    return null;
  }

  return {
    type: type as EmbedCommandType,
    payload: data.payload,
    requestId: typeof data.requestId === "string" ? data.requestId : undefined,
  };
}

/**
 * Constructs a structured outbound event message for the parent window.
 */
export function createEmbedEventMessage(type: EmbedEventType, payload: any): EmbedEventMessage {
  return {
    type,
    payload: payload || {},
    timestamp: Date.now(),
  };
}

/**
 * Safely extracts a participant token from either query parameter or URL hash,
 * and returns both the extracted token and a scrubbed URL without token secrets.
 *
 * This prevents token leakage via:
 * 1. HTTP Referer headers on downstream resource fetches
 * 2. Browser history / autocomplete
 * 3. Shoulder surfing / screen sharing
 */
export function sanitizeUrlToken(urlOrString: string): {
  token: string | null;
  cleanUrl: string;
  parentOrigin: string | null;
} {
  let token: string | null = null;
  let parentOrigin: string | null = null;

  try {
    // Handle relative or full URLs
    const dummyBase = "https://meet.mathsy.in";
    const parsed = new URL(urlOrString, dummyBase);

    // 1. Check query parameter `token`
    if (parsed.searchParams.has("token")) {
      token = parsed.searchParams.get("token");
      parsed.searchParams.delete("token");
    }

    if (parsed.searchParams.has("parentOrigin")) {
      parentOrigin = parsed.searchParams.get("parentOrigin");
    }

    // 2. Check hash `#token=...` or `#...&token=...`
    if (parsed.hash) {
      const hashContent = parsed.hash.replace(/^#/, "");
      if (hashContent.startsWith("token=")) {
        token = hashContent.substring(6);
        parsed.hash = "";
      } else if (hashContent.includes("token=")) {
        const hashParams = new URLSearchParams(hashContent);
        if (hashParams.has("token")) {
          token = hashParams.get("token");
          hashParams.delete("token");
          const remainingHash = hashParams.toString();
          parsed.hash = remainingHash ? `#${remainingHash}` : "";
        }
      }
    }

    // Determine output clean URL format
    const isRelative = !urlOrString.startsWith("http://") && !urlOrString.startsWith("https://");
    const cleanUrl = isRelative
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : `${parsed.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;

    return { token, cleanUrl, parentOrigin };
  } catch {
    return { token: null, cleanUrl: urlOrString, parentOrigin: null };
  }
}
