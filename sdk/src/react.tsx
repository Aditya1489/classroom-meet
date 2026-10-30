import React, { useEffect, useRef, useState, useCallback } from "react";
import { embedMeeting } from "./browser";
import {
  MathsyMeetEmbedController,
  EmbedEventType,
  SecurityError,
} from "./types";

export interface MathsyMeetingProps {
  roomCode: string;
  token?: string;
  ssoToken?: string;
  embedBaseUrl?: string;
  parentOrigin?: string;
  width?: string | number;
  height?: string | number;
  className?: string;
  style?: React.CSSProperties;
  loadingComponent?: React.ReactNode;
  errorComponent?:
    | ((error: { code: string; message: string; details?: any }) => React.ReactNode)
    | React.ReactNode;
  onReady?: (payload?: any) => void;
  onJoined?: (participant: any) => void;
  onLeft?: (event: { reason: string }) => void;
  onMediaStateChanged?: (media: any) => void;
  onError?: (error: { code: string; message: string; details?: any }) => void;
  onControllerReady?: (controller: MathsyMeetEmbedController) => void;
}

export interface UseMathsyMeetingOptions {
  containerRef: React.RefObject<HTMLElement | null>;
  roomCode: string;
  token?: string;
  ssoToken?: string;
  embedBaseUrl?: string;
  parentOrigin?: string;
  width?: string;
  height?: string;
  className?: string;
  onReady?: (payload?: any) => void;
  onJoined?: (participant: any) => void;
  onLeft?: (event: { reason: string }) => void;
  onMediaStateChanged?: (media: any) => void;
  onError?: (error: { code: string; message: string; details?: any }) => void;
}

export interface UseMathsyMeetingReturn {
  controller: MathsyMeetEmbedController | null;
  isReady: boolean;
  error: { code: string; message: string; details?: any } | null;
  muteAudio: () => void;
  unmuteAudio: () => void;
  enableVideo: () => void;
  disableVideo: () => void;
  leaveMeeting: () => void;
}

/**
 * useMathsyMeeting
 *
 * Custom React hook managing the lifecycle, event routing, and programmatic
 * control of an embedded Mathsy Meet video room.
 */
export function useMathsyMeeting({
  containerRef,
  roomCode,
  token,
  ssoToken,
  embedBaseUrl,
  parentOrigin,
  width = "100%",
  height = "100%",
  className,
  onReady,
  onJoined,
  onLeft,
  onMediaStateChanged,
  onError,
}: UseMathsyMeetingOptions): UseMathsyMeetingReturn {
  const [controller, setController] = useState<MathsyMeetEmbedController | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<{ code: string; message: string; details?: any } | null>(null);

  const controllerRef = useRef<MathsyMeetEmbedController | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const effectiveToken = (ssoToken || token || "").trim();
    if (!container || !roomCode || !effectiveToken) {
      return;
    }

    setIsReady(false);
    setError(null);

    let ctrl: MathsyMeetEmbedController;
    try {
      ctrl = embedMeeting({
        container,
        roomCode,
        token: token || undefined,
        ssoToken: ssoToken || undefined,
        embedBaseUrl,
        parentOrigin,
        width,
        height,
        className,
        onReady: (payload) => {
          setIsReady(true);
          onReady?.(payload);
        },
        onJoined: (participant) => {
          onJoined?.(participant);
        },
        onLeft: (event) => {
          setIsReady(false);
          onLeft?.(event);
        },
        onMediaStateChanged: (media) => {
          onMediaStateChanged?.(media);
        },
        onError: (err) => {
          setError(err);
          onError?.(err);
        },
      });

      controllerRef.current = ctrl;
      setController(ctrl);
    } catch (err: any) {
      const errPayload = {
        code: err.code || "EMBED_INITIALIZATION_ERROR",
        message: err.message || "Failed to initialize meeting embed",
        details: err,
      };
      setError(errPayload);
      onError?.(errPayload);
      return;
    }

    return () => {
      ctrl.destroy();
      controllerRef.current = null;
      setController(null);
      setIsReady(false);
    };
  }, [roomCode, token, ssoToken, embedBaseUrl, parentOrigin]);

  const muteAudio = useCallback(() => controllerRef.current?.muteAudio(), []);
  const unmuteAudio = useCallback(() => controllerRef.current?.unmuteAudio(), []);
  const enableVideo = useCallback(() => controllerRef.current?.enableVideo(), []);
  const disableVideo = useCallback(() => controllerRef.current?.disableVideo(), []);
  const leaveMeeting = useCallback(() => controllerRef.current?.leaveMeeting(), []);

  return {
    controller,
    isReady,
    error,
    muteAudio,
    unmuteAudio,
    enableVideo,
    disableVideo,
    leaveMeeting,
  };
}

/**
 * MathsyMeeting
 *
 * First-class React component for embedding Mathsy Meet video meetings.
 * Manages full container lifecycle, automatic postMessage bridge, and cleanup.
 */
export const MathsyMeeting: React.FC<MathsyMeetingProps> = ({
  roomCode,
  token,
  ssoToken,
  embedBaseUrl,
  parentOrigin,
  width = "100%",
  height = "100%",
  className,
  style,
  loadingComponent,
  errorComponent,
  onReady,
  onJoined,
  onLeft,
  onMediaStateChanged,
  onError,
  onControllerReady,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const { controller, isReady, error } = useMathsyMeeting({
    containerRef,
    roomCode,
    token,
    ssoToken,
    embedBaseUrl,
    parentOrigin,
    width: typeof width === "number" ? `${width}px` : width,
    height: typeof height === "number" ? `${height}px` : height,
    className,
    onReady,
    onJoined,
    onLeft,
    onMediaStateChanged,
    onError,
  });

  useEffect(() => {
    if (controller && onControllerReady) {
      onControllerReady(controller);
    }
  }, [controller, onControllerReady]);

  const resolvedWidth = typeof width === "number" ? `${width}px` : width;
  const resolvedHeight = typeof height === "number" ? `${height}px` : height;

  return (
    <div
      style={{
        position: "relative",
        width: resolvedWidth,
        height: resolvedHeight,
        overflow: "hidden",
        ...style,
      }}
      className={className}
    >
      {/* Target DOM Container for Iframe */}
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%" }}
      />

      {/* Loading Overlay */}
      {!isReady && !error && loadingComponent && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          {loadingComponent}
        </div>
      )}

      {/* Error Overlay */}
      {error && errorComponent && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {typeof errorComponent === "function"
            ? errorComponent(error)
            : errorComponent}
        </div>
      )}
    </div>
  );
};
