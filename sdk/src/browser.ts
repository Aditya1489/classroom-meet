import {
  EmbedMeetingOptions,
  MathsyMeetEmbedController,
  EmbedEventType,
  SecurityError,
} from "./types";

/**
 * Normalizes an origin string (protocol + host, lowercase, no trailing slash).
 */
function normalizeOrigin(urlOrOrigin: string): string {
  try {
    const parsed = new URL(urlOrOrigin);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return urlOrOrigin.trim().toLowerCase().replace(/\/$/, "");
  }
}

/**
 * Embeds a Mathsy Meet video meeting session into a web page container.
 *
 * Implements:
 * 1. Secure iframe creation with required WebRTC device permissions (camera, microphone, screen capture).
 * 2. Origin-validated typed postMessage command and event protocol.
 * 3. Prevention of token leaks by passing token in hash and immediately removing it.
 * 4. Strict target-origin enforcement (Zero wildcard '*' origins).
 */
export function embedMeeting(options: EmbedMeetingOptions): MathsyMeetEmbedController {
  if (!options) {
    throw new SecurityError("Options object is required for embedMeeting.");
  }

  const { roomCode, token } = options;

  if (!roomCode || typeof roomCode !== "string" || roomCode.trim().length === 0) {
    throw new SecurityError("roomCode is required to embed a meeting.");
  }

  if (!token || typeof token !== "string" || token.trim().length === 0) {
    throw new SecurityError("A valid participant token is required to embed a meeting.");
  }

  // 1. Resolve DOM container element
  let containerEl: HTMLElement | null = null;
  if (typeof options.container === "string") {
    if (typeof document !== "undefined") {
      containerEl = document.querySelector(options.container);
    }
  } else if (options.container && typeof (options.container as any).appendChild === "function") {
    containerEl = options.container as HTMLElement;
  }

  if (!containerEl) {
    throw new SecurityError(
      `Container element '${options.container}' could not be found or resolved.`
    );
  }

  // 2. Resolve target and parent origins
  const defaultBase = typeof window !== "undefined" ? window.location.origin : "http://localhost:5001";
  const embedBase = (options.embedBaseUrl || defaultBase).replace(/\/$/, "");
  const targetOrigin = normalizeOrigin(embedBase);

  const parentOrigin =
    options.parentOrigin ||
    (typeof window !== "undefined" && window.location ? window.location.origin : "");

  // 3. Construct secure embed URL
  // We pass token in URL hash to prevent leakage in HTTP Referer headers
  const sanitizedRoom = encodeURIComponent(roomCode.trim().toLowerCase());
  const originParam = parentOrigin ? `?parentOrigin=${encodeURIComponent(parentOrigin)}` : "";
  const embedUrl = `${embedBase}/embed/${sanitizedRoom}${originParam}#token=${encodeURIComponent(token.trim())}`;

  // 4. Create and configure iframe
  let iframe: HTMLIFrameElement;
  if (options._mockIframe) {
    iframe = options._mockIframe;
    iframe.src = embedUrl;
    iframe.allow = "camera; microphone; display-capture; autoplay; clipboard-write;";
  } else if (typeof document !== "undefined") {
    iframe = document.createElement("iframe");
    iframe.src = embedUrl;
    iframe.allow = "camera; microphone; display-capture; autoplay; clipboard-write;";
    iframe.style.border = "none";
    iframe.style.width = options.width || "100%";
    iframe.style.height = options.height || "100%";
    if (options.className) {
      iframe.className = options.className;
    }
  } else {
    // In Node / SSR testing environments without DOM
    iframe = {
      src: embedUrl,
      allow: "camera; microphone; display-capture; autoplay; clipboard-write;",
      style: { border: "none", width: options.width || "100%", height: options.height || "100%" },
      className: options.className || "",
      contentWindow: null,
      parentNode: null,
    } as any;
  }

  containerEl.appendChild(iframe);

  // 5. Setup postMessage Event Routing
  const listeners = new Map<EmbedEventType, Set<(payload: any) => void>>();

  const dispatchEvent = (event: EmbedEventType, payload: any) => {
    const handlers = listeners.get(event);
    if (handlers) {
      handlers.forEach((h) => {
        try {
          h(payload);
        } catch (err) {
          console.error(`[MathsyMeet EmbedSDK] Error in '${event}' event listener:`, err);
        }
      });
    }
  };

  const handleMessage = (event: MessageEvent | { origin: string; data: any }) => {
    // Strict Origin Verification: Only accept messages from the trusted embed server
    const messageOrigin = normalizeOrigin(event.origin);
    if (messageOrigin !== targetOrigin) {
      return;
    }

    const data = event.data;
    if (!data || typeof data !== "object") return;

    switch (data.type) {
      case "meeting.ready":
        dispatchEvent("ready", data.payload);
        break;
      case "meeting.joined":
        dispatchEvent("joined", data.payload);
        break;
      case "meeting.left":
        dispatchEvent("left", data.payload);
        break;
      case "media.state_changed":
        dispatchEvent("mediaStateChanged", data.payload);
        break;
      case "meeting.error":
        dispatchEvent("error", data.payload);
        break;
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("message", handleMessage as EventListener);
  }

  // 6. Outbound Command Dispatcher
  const postCommand = (type: string, payload?: any) => {
    try {
      const win = iframe.contentWindow;
      if (!win) {
        console.warn("[MathsyMeet EmbedSDK] Iframe contentWindow not ready.");
        return;
      }

      // CRITICAL SECURITY RULE: Target origin must NEVER be wildcard '*'
      if (!targetOrigin || targetOrigin === "*") {
        console.error("[MathsyMeet EmbedSDK] Refusing to postMessage: target origin is invalid or wildcard.");
        return;
      }

      win.postMessage({ type, payload }, targetOrigin);
    } catch (err) {
      console.warn("[MathsyMeet EmbedSDK] Error posting command to iframe:", err);
    }
  };

  // 7. Controller Interface
  const controller: MathsyMeetEmbedController = {
    iframe,

    muteAudio() {
      postCommand("MUTE_AUDIO");
    },

    unmuteAudio() {
      postCommand("UNMUTE_AUDIO");
    },

    enableVideo() {
      postCommand("ENABLE_VIDEO");
    },

    disableVideo() {
      postCommand("DISABLE_VIDEO");
    },

    leaveMeeting() {
      postCommand("LEAVE_MEETING");
    },

    getStatus() {
      postCommand("GET_STATUS");
    },

    on(event: EmbedEventType, handler: (payload: any) => void) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(handler);

      // Return unsubscribe function
      return () => {
        listeners.get(event)?.delete(handler);
      };
    },

    destroy() {
      if (typeof window !== "undefined") {
        window.removeEventListener("message", handleMessage as EventListener);
      }
      listeners.clear();
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      } else if (containerEl && typeof (containerEl as any).removeChild === "function") {
        (containerEl as any).removeChild(iframe);
      }
    },

    _handleIncomingMessage: handleMessage,
  };

  // Register optional event callbacks supplied in options
  if (options.onReady) controller.on("ready", options.onReady);
  if (options.onJoined) controller.on("joined", options.onJoined);
  if (options.onLeft) controller.on("left", options.onLeft);
  if (options.onMediaStateChanged) controller.on("mediaStateChanged", options.onMediaStateChanged);
  if (options.onError) controller.on("error", options.onError);

  return controller;
}
