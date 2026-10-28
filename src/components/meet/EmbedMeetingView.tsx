import React, { useState, useEffect, useRef } from "react";
import { MeetingRoom } from "./MeetingRoom";
import {
  sanitizeUrlToken,
  validatePostMessageOrigin,
  parseAndValidateEmbedCommand,
  createEmbedEventMessage,
  EmbedEventType,
  EmbedCommandMessage,
} from "../../types/embedProtocol";
import { Shield, ShieldAlert, Lock, AlertTriangle, Clock, RefreshCw } from "lucide-react";

interface EmbedMeetingViewProps {
  roomCode: string;
  onBackToHome?: () => void;
}

export const EmbedMeetingView: React.FC<EmbedMeetingViewProps> = ({
  roomCode,
  onBackToHome,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<{ title: string; message: string; code?: string } | null>(null);
  const [verifiedClaims, setVerifiedClaims] = useState<any | null>(null);
  const [allowedOrigins, setAllowedOrigins] = useState<string[]>([]);
  const [branding, setBranding] = useState<{ logo_url?: string; primary_color?: string }>({});
  const [hasLeft, setHasLeft] = useState<boolean>(false);

  const tokenRef = useRef<string>("");
  const parentOriginRef = useRef<string>("");
  const allowedOriginsRef = useRef<string[]>([]);
  const engineCommandListenerRef = useRef<((cmd: EmbedCommandMessage) => void) | null>(null);

  // Helper to post verified events to the parent iframe container
  const postEventToParent = (type: EmbedEventType, payload: any = {}) => {
    try {
      if (typeof window === "undefined" || window.parent === window) return;

      const target = parentOriginRef.current;
      // Strict security requirement: Never use wildcard target origin when expected origin is known
      if (!target || target === "*") {
        console.warn("[MathsyMeet Embed] Target parent origin unknown. Suppressing outbound postMessage.");
        return;
      }

      const message = createEmbedEventMessage(type, payload);
      window.parent.postMessage(message, target);
    } catch (err) {
      console.warn("[MathsyMeet Embed] Error posting event to parent frame:", err);
    }
  };

  useEffect(() => {
    allowedOriginsRef.current = allowedOrigins;
  }, [allowedOrigins]);

  // Main Initialization: Extract token, scrub URL, and verify server config & claims
  useEffect(() => {
    let isCancelled = false;

    const initializeEmbed = async () => {
      setLoading(true);
      setError(null);

      // 1. Extract token & parentOrigin, then IMMEDIATELY scrub token from address bar
      const currentUrl = window.location.href;
      const { token, cleanUrl, parentOrigin } = sanitizeUrlToken(currentUrl);

      if (cleanUrl !== currentUrl) {
        window.history.replaceState({}, document.title, cleanUrl);
      }

      if (parentOrigin) {
        parentOriginRef.current = parentOrigin;
      }

      if (!token) {
        // Check session storage as fallback (e.g. on iframe refresh)
        const savedToken = window.sessionStorage.getItem(`mathsy_meet_embed_token_${roomCode}`);
        if (savedToken) {
          tokenRef.current = savedToken;
        } else {
          setError({
            title: "Meeting Access Token Required",
            message: "This hosted meeting route requires a secure, short-lived participant token.",
            code: "MISSING_TOKEN",
          });
          setLoading(false);
          return;
        }
      } else {
        tokenRef.current = token;
        window.sessionStorage.setItem("mathsy_meet_embed_token", token);
        window.sessionStorage.setItem(`mathsy_meet_embed_token_${roomCode}`, token);
      }

      try {
        const rawApiBase = import.meta.env.VITE_API_BASE_URL || "http://localhost:5001/api";
        const apiBase = rawApiBase.replace(/\/api$/, "/api/v1");

        // 2. Fetch authoritative embed configuration and verify domain restrictions
        const referrerOrigin = document.referrer ? new URL(document.referrer).origin : "";
        const effectiveParentOrigin = parentOriginRef.current || referrerOrigin;

        const configUrl = `${apiBase}/embed/config/${encodeURIComponent(roomCode)}${
          effectiveParentOrigin ? `?parentOrigin=${encodeURIComponent(effectiveParentOrigin)}` : ""
        }`;

        const configRes = await fetch(configUrl, {
          headers: effectiveParentOrigin ? { Origin: effectiveParentOrigin } : {},
        });

        if (isCancelled) return;

        if (!configRes.ok) {
          if (configRes.status === 404) {
            setError({
              title: "Meeting Not Found or Ended",
              message: "The requested meeting room does not exist or has already completed.",
              code: "ROOM_NOT_FOUND",
            });
          } else if (configRes.status === 403) {
            setError({
              title: "Organization Suspended",
              message: "The host organization account is currently inactive.",
              code: "ORGANIZATION_SUSPENDED",
            });
          } else {
            setError({
              title: "Configuration Error",
              message: "Could not retrieve embedding policy for this meeting.",
              code: "CONFIG_ERROR",
            });
          }
          setLoading(false);
          return;
        }

        const configData = await configRes.json();
        const serverAllowedOrigins: string[] = configData.allowedOrigins || [];
        setAllowedOrigins(serverAllowedOrigins);
        allowedOriginsRef.current = serverAllowedOrigins;

        if (configData.branding) {
          setBranding(configData.branding);
        }

        // Domain restriction verification
        if (effectiveParentOrigin) {
          if (!configData.isOriginAllowed) {
            setError({
              title: "Unauthorized Embedding Domain",
              message: `Embedding is restricted. Origin '${effectiveParentOrigin}' is not authorized.`,
              code: "UNAUTHORIZED_DOMAIN",
            });
            // Safe, typed ORIGIN_NOT_ALLOWED error communication to the parent window
            if (typeof window !== "undefined" && window.parent && window.parent !== window) {
              try {
                const errMessage = createEmbedEventMessage("meeting.error", {
                  code: "ORIGIN_NOT_ALLOWED",
                  message: `Origin '${effectiveParentOrigin}' is not whitelisted by the organization.`,
                });
                window.parent.postMessage(errMessage, effectiveParentOrigin);
              } catch (e) {
                console.warn("[MathsyMeet Embed] Failed to post ORIGIN_NOT_ALLOWED to parent:", e);
              }
            }
            setLoading(false);
            return;
          }
          parentOriginRef.current = effectiveParentOrigin;
        } else if (serverAllowedOrigins.length > 0) {
          parentOriginRef.current = serverAllowedOrigins[0];
        }

        // 3. Authoritatively verify participant token with server
        const verifyRes = await fetch(`${apiBase}/embed/verify-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: tokenRef.current,
            roomCode,
          }),
        });

        if (isCancelled) return;

        const verifyData = await verifyRes.json();

        if (!verifyRes.ok || !verifyData.valid) {
          const code = verifyData.code || "INVALID_TOKEN";
          let message = "The participant token provided is invalid or has expired.";
          if (code === "TOKEN_EXPIRED") {
            message = "Your meeting token has expired. Please request a new link.";
          } else if (code === "ROOM_MISMATCH") {
            message = "This token was issued for a different meeting room.";
          } else if (code === "TENANT_MISMATCH") {
            message = "Cross-tenant access violation: Token does not match this room.";
          }

          setError({
            title: "Access Denied",
            message,
            code,
          });
          setLoading(false);
          postEventToParent("meeting.error", { code, message });
          return;
        }

        // 4. Token & Configuration Verified
        setVerifiedClaims(verifyData.claims);
        setLoading(false);

        // Notify parent that embed is ready
        postEventToParent("meeting.ready", {
          roomCode,
          participantId: verifyData.claims.participantId,
          role: verifyData.claims.role,
        });
      } catch (err: any) {
        if (isCancelled) return;
        setError({
          title: "Connection Error",
          message: err.message || "Failed to initialize secure meeting embed.",
          code: "NETWORK_ERROR",
        });
        setLoading(false);
      }
    };

    initializeEmbed();

    return () => {
      isCancelled = true;
    };
  }, [roomCode]);

  // Setup Inbound postMessage Listener
  useEffect(() => {
    const handleWindowMessage = (event: MessageEvent) => {
      // 1. Origin verification: reject messages from untrusted origins
      const isAllowed = validatePostMessageOrigin(event.origin, allowedOriginsRef.current);
      if (!isAllowed) {
        // If not in allowed list, ignore silently without throwing
        return;
      }

      // If parent origin was unset, anchor it to the first verified sender origin
      if (!parentOriginRef.current) {
        parentOriginRef.current = event.origin;
      }

      // 2. Parse and validate command structure
      const command = parseAndValidateEmbedCommand(event.data);
      if (!command) {
        return;
      }

      // 3. Dispatch validated command
      if (command.type === "LEAVE_MEETING") {
        setHasLeft(true);
        postEventToParent("meeting.left", { reason: "host_command" });
      } else if (engineCommandListenerRef.current) {
        engineCommandListenerRef.current(command);
      }
    };

    window.addEventListener("message", handleWindowMessage);
    return () => {
      window.removeEventListener("message", handleWindowMessage);
    };
  }, []);

  const handleLeaveMeeting = () => {
    setHasLeft(true);
    postEventToParent("meeting.left", { reason: "participant_left" });
    if (onBackToHome) {
      onBackToHome();
    }
  };

  const handleRejoin = () => {
    setHasLeft(false);
  };

  // 1. Loading State
  if (loading) {
    return (
      <div className="w-full h-screen bg-[#0e0d0b] text-[#f3eee6] flex flex-col items-center justify-center p-6 text-center select-none">
        <div className="w-12 h-12 rounded-2xl bg-[#1a1814] border border-[#f3eee6]/10 flex items-center justify-center mb-4 animate-pulse">
          <Shield className="w-6 h-6 text-[#f59e0b]" />
        </div>
        <h2 className="text-sm font-semibold tracking-wider uppercase text-[#a39e94] mb-1">
          Securing Connection
        </h2>
        <p className="text-xs text-[#a39e94]/70">Verifying participant token and room permissions...</p>
      </div>
    );
  }

  // 2. Error State (Graceful, secure, non-leaking)
  if (error) {
    return (
      <div className="w-full h-screen bg-[#0e0d0b] text-[#f3eee6] flex flex-col items-center justify-center p-6 text-center select-none">
        <div className="w-14 h-14 rounded-2xl bg-red-950/40 border border-red-500/20 flex items-center justify-center mb-4 shadow-xl">
          {error.code === "TOKEN_EXPIRED" ? (
            <Clock className="w-7 h-7 text-red-400" />
          ) : error.code === "UNAUTHORIZED_DOMAIN" ? (
            <Lock className="w-7 h-7 text-red-400" />
          ) : (
            <ShieldAlert className="w-7 h-7 text-red-400" />
          )}
        </div>
        <h1 className="text-xl font-medium text-[#f3eee6] mb-2">{error.title}</h1>
        <p className="text-xs text-[#a39e94] max-w-md leading-relaxed mb-6">
          {error.message}
        </p>
        <div className="text-[11px] font-mono text-[#a39e94]/50 border border-[#f3eee6]/10 px-3 py-1.5 rounded-lg bg-[#14120e]">
          ROOM: {roomCode.toUpperCase()} {error.code ? `• ${error.code}` : ""}
        </div>
      </div>
    );
  }

  // 3. Meeting Left State
  if (hasLeft) {
    return (
      <div className="w-full h-screen bg-[#0e0d0b] text-[#f3eee6] flex flex-col items-center justify-center p-6 text-center select-none">
        <div className="w-12 h-12 rounded-2xl bg-[#1a1814] border border-[#f3eee6]/10 flex items-center justify-center mb-4">
          <Shield className="w-6 h-6 text-[#10b981]" />
        </div>
        <h1 className="text-lg font-medium text-[#f3eee6] mb-2">Session Ended</h1>
        <p className="text-xs text-[#a39e94] max-w-sm mb-6">
          You have left the meeting. Your microphone and camera have been completely disconnected.
        </p>
        <button
          onClick={handleRejoin}
          className="px-5 py-2.5 rounded-lg bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold text-xs transition flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Rejoin Meeting
        </button>
      </div>
    );
  }

  // 4. Active Meeting: Mount MeetingRoom with verified token claims & permissions
  const claims = verifiedClaims;
  const isTutorRole = claims.role === "tutor";
  const permissions = claims.permissions || {};

  const initialOptions = {
    displayName: claims.name || (isTutorRole ? "Tutor" : "Student"),
    role: (isTutorRole ? "tutor" : "student") as "tutor" | "student",
    // Authoritatively constrained: cannot auto-unmute if server permissions forbid it
    micMuted: isTutorRole ? false : !permissions.canPublishAudio,
    camOff: !permissions.canPublishVideo,
    presentImmediately: false,
    userId: claims.participantId,
    token: tokenRef.current,
  };

  return (
    <div className="w-full h-screen relative bg-[#0e0d0b] overflow-hidden">
      <MeetingRoom
        meetingCode={roomCode}
        initialOptions={initialOptions}
        onLeaveMeeting={handleLeaveMeeting}
      />
    </div>
  );
};
