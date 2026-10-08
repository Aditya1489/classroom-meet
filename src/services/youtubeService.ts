import {
  normalizeYouTubeChannelLiveUrl,
  getConnectedYouTubeChannel,
  ConnectedChannelInfo,
} from "../utils/youtubeUtils";
import { toast } from "sonner";

export interface LiveStreamSession {
  broadcastId: string;
  youtubeUrl: string;
  liveStudioUrl: string;
  startTime: number;
}

export interface StreamStats {
  fps: number;
  speed: number;
  bitrateKbps: number;
}

// ── B6. Dynamic Audio Mixer that survives track muting and dynamic changes ──
export class LiveAudioMixer {
  private ctx: AudioContext | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private sources: Map<MediaStreamTrack, { source: MediaStreamAudioSourceNode; gain: GainNode }> = new Map();

  constructor() {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      try {
        this.ctx = new AudioCtx();
        this.dest = this.ctx.createMediaStreamDestination();
      } catch (e) {
        console.warn("[LiveAudioMixer] Failed to initialize AudioContext:", e);
      }
    }
  }

  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch {}
    }
  }

  updateSources(localTrack: MediaStreamTrack | null, remoteTracks: MediaStreamTrack[] = []): MediaStreamTrack | null {
    if (!this.ctx || !this.dest) return localTrack;

    const currentTracks = new Set<MediaStreamTrack>();
    if (localTrack && localTrack.readyState === "live") currentTracks.add(localTrack);
    for (const t of remoteTracks) {
      if (t && t.readyState === "live") currentTracks.add(t);
    }

    // Disconnect stale or ended tracks
    for (const [track, node] of this.sources.entries()) {
      if (!currentTracks.has(track) || track.readyState !== "live") {
        try {
          node.gain.disconnect();
          node.source.disconnect();
        } catch {}
        this.sources.delete(track);
      }
    }

    // Connect new tracks
    for (const track of currentTracks) {
      if (!this.sources.has(track)) {
        try {
          const stream = new MediaStream([track]);
          const source = this.ctx.createMediaStreamSource(stream);
          const gain = this.ctx.createGain();
          gain.gain.value = 1.0;
          source.connect(gain);
          gain.connect(this.dest);
          this.sources.set(track, { source, gain });
        } catch (err) {
          console.warn("[LiveAudioMixer] Failed to connect track to mixer:", err);
        }
      }
    }

    const mixed = this.dest.stream.getAudioTracks();
    return mixed[0] || localTrack;
  }

  getTrack(): MediaStreamTrack | null {
    return this.dest ? this.dest.stream.getAudioTracks()[0] || null : null;
  }

  close(): void {
    for (const [, node] of this.sources.entries()) {
      try {
        node.gain.disconnect();
        node.source.disconnect();
      } catch {}
    }
    this.sources.clear();
    if (this.ctx) {
      try {
        this.ctx.close();
      } catch {}
      this.ctx = null;
      this.dest = null;
    }
  }
}

// ── Active Singleton Session State ──
let activeRecorder: MediaRecorder | null = null;
let activeDisplayStream: MediaStream | null = null;
let activeMixer: LiveAudioMixer | null = null;
let activeSession: LiveStreamSession | null = null;
let activeMeetingCode = "";
let activeEmitSignal: ((event: string, payload: any) => void) | null = null;
let unsubscribeStatusSignal: (() => void) | null = null;
let hasReachedActiveState = false;
let isStopping = false;

// Auto-recovery attempt tracking (B5: max 3 attempts within 2 minutes)
const recoveryAttempts: number[] = [];

// Chunk transmission queue (B2)
const chunkQueue: Uint8Array[] = [];
let isTransmitting = false;
let finalChunkDrainResolve: (() => void) | null = null;

function getHttpServerUrl(wsUrl?: string): string {
  const url = wsUrl || (import.meta as any).env?.VITE_MEDIASOUP_SERVER_URL || "";
  if (!url) {
    throw new Error("Server not configured: VITE_MEDIASOUP_SERVER_URL is missing.");
  }
  return url.replace(/^ws(s)?:\/\//i, "http$1://");
}

export interface StartYouTubeLiveOptions {
  meetingCode: string;
  title: string;
  localAudioTrack: MediaStreamTrack | null;
  remoteAudioTracks?: MediaStreamTrack[];
  emitSignal?: (event: string, payload: any) => void;
  onSignal?: (event: string, callback: (payload: any) => void) => () => void;
  onStatusChange?: (status: "idle" | "connecting" | "live" | "ended" | "error") => void;
  onStatsUpdate?: (stats: StreamStats) => void;
  onError?: (message: string) => void;
}

// Active options reference for auto-recovery
let currentOptions: StartYouTubeLiveOptions | null = null;

/**
 * Transmits queued chunks sequentially with backoff retries (B2).
 */
async function processChunkQueue(): Promise<void> {
  if (isTransmitting) return;
  isTransmitting = true;

  const rawUrl = (import.meta as any).env?.VITE_MEDIASOUP_SERVER_URL;
  if (!rawUrl) {
    console.error("[YouTubeService] Server not configured: VITE_MEDIASOUP_SERVER_URL is missing.");
    currentOptions?.onError?.("Server not configured: VITE_MEDIASOUP_SERVER_URL is missing.");
    isTransmitting = false;
    return;
  }

  const rtmpServerUrl = getHttpServerUrl(rawUrl);

  try {
    while (chunkQueue.length > 0 && !isStopping) {
      const chunk = chunkQueue[0];
      const chunkPayload =
        chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength
          ? chunk
          : chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);

      let success = false;
      let attempt = 0;
      let isNoSession = false;

      while (attempt < 3 && !success && !isStopping) {
        attempt++;
        try {
          // B2: HTTP POST /rtmp-chunk ONLY, no x-class-id header
          const res = await fetch(`${rtmpServerUrl}/rtmp-chunk?classId=${encodeURIComponent(activeMeetingCode)}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream",
            },
            body: chunkPayload as BodyInit,
          });

          if (res.ok) {
            success = true;
          } else if (res.status === 409) {
            // A4/B5: NO_SESSION 409 response
            isNoSession = true;
            break;
          } else {
            console.warn(`[YouTubeService] Chunk send returned HTTP ${res.status}. Attempt ${attempt}/3`);
            if (attempt < 3) await new Promise((r) => setTimeout(r, 500));
          }
        } catch (netErr) {
          console.warn(`[YouTubeService] Network error sending chunk. Attempt ${attempt}/3:`, netErr);
          if (attempt < 3) await new Promise((r) => setTimeout(r, 500));
        }
      }

      if (isNoSession) {
        console.warn("[YouTubeService] Received 409 NO_SESSION from server. Triggering auto-recovery (B5)...");
        triggerAutoRecovery();
        return;
      }

      if (success) {
        chunkQueue.shift();
      } else {
        console.error("[YouTubeService] Failed to send chunk after 3 attempts. Stopping stream to prevent corruption.");
        handleFatalError("Network transmission error: Failed to send media chunk to server after 3 attempts.");
        return;
      }
    }
  } finally {
    isTransmitting = false;
    if (chunkQueue.length === 0 && finalChunkDrainResolve) {
      finalChunkDrainResolve();
      finalChunkDrainResolve = null;
    }
  }
}

/**
 * Triggers stream auto-recovery (B5).
 */
async function triggerAutoRecovery(): Promise<void> {
  const now = Date.now();
  // Filter attempts in last 2 minutes
  while (recoveryAttempts.length > 0 && now - recoveryAttempts[0] > 120_000) {
    recoveryAttempts.shift();
  }

  if (recoveryAttempts.length >= 3) {
    console.error("[YouTubeService] Exceeded 3 recovery attempts within 2 minutes. Aborting.");
    handleFatalError("Live stream connection lost. Auto-recovery failed after 3 attempts.");
    return;
  }

  recoveryAttempts.push(now);
  toast.loading("Reconnecting live stream to YouTube…", { id: "yt-stream-reconnect" });

  try {
    // 1. Stop current MediaRecorder
    if (activeRecorder && activeRecorder.state !== "inactive") {
      try { activeRecorder.stop(); } catch {}
      activeRecorder = null;
    }

    // 2. Clear pending queue
    chunkQueue.length = 0;

    // 3. Re-emit startRtmpStream
    const connected = getConnectedYouTubeChannel();
    if (!connected?.streamKey || !activeEmitSignal) {
      handleFatalError("Channel credentials unavailable during stream recovery.");
      return;
    }

    let key = connected.streamKey.trim();
    if (key.startsWith("rtmp://a.rtmp.youtube.com/live2/")) key = key.replace("rtmp://a.rtmp.youtube.com/live2/", "");
    if (key.startsWith("rtmps://a.rtmp.youtube.com:443/live2/")) key = key.replace("rtmps://a.rtmp.youtube.com:443/live2/", "");
    const rtmpUrl = key.startsWith("rtmp://") || key.startsWith("rtmps://") ? key : `rtmps://a.rtmp.youtube.com:443/live2/${key}`;

    activeEmitSignal("startRtmpStream", { classId: activeMeetingCode, rtmpUrl });

    // 4. Wait for "ready" signal (up to 15s)
    let readyReceived = false;
    const readyPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout waiting for server encoder ready")), 15000);
      const unsub = currentOptions?.onSignal?.("rtmpStatus", (p: any) => {
        if (p?.status === "ready" || p?.status === "active") {
          readyReceived = true;
          clearTimeout(timeout);
          unsub?.();
          resolve();
        }
      });
    });

    await readyPromise;

    // 5. Start a NEW MediaRecorder with fresh WebM header
    if (!activeDisplayStream) {
      handleFatalError("Screen capture track lost during reconnection.");
      return;
    }

    const videoTrack = activeDisplayStream.getVideoTracks()[0];
    const audioTrack = activeMixer?.getTrack() || null;
    const tracks: MediaStreamTrack[] = [videoTrack];
    if (audioTrack) tracks.push(audioTrack);
    const stream = new MediaStream(tracks);

    const recorder = new MediaRecorder(stream, {
      mimeType: "video/webm;codecs=vp8,opus",
      videoBitsPerSecond: 2_500_000,
      audioBitsPerSecond: 128_000,
    });

    recorder.ondataavailable = async (e: BlobEvent) => {
      if (e.data && e.data.size > 0 && !isStopping) {
        try {
          const buf = await e.data.arrayBuffer();
          chunkQueue.push(new Uint8Array(buf));
          processChunkQueue();
        } catch (err) {
          console.error("[YouTubeService] Recorder chunk error:", err);
        }
      }
    };

    activeRecorder = recorder;
    recorder.start(1000);

    toast.dismiss("yt-stream-reconnect");
    toast.success("Stream reconnected successfully! 🔴");
  } catch (err: any) {
    toast.dismiss("yt-stream-reconnect");
    handleFatalError(`Stream reconnection failed: ${err.message}`);
  }
}

/**
 * Handles fatal error and stops stream cleanly (B4).
 */
function handleFatalError(message: string): void {
  toast.error(message);
  currentOptions?.onError?.(message);
  currentOptions?.onStatusChange?.("error");
  stopYouTubeLiveStreaming(false);
}

/**
 * Initiates the live broadcast and starts streaming screen + mixed audio to YouTube RTMP.
 */
export async function startYouTubeLiveStreaming(
  options: StartYouTubeLiveOptions
): Promise<LiveStreamSession | null> {
  currentOptions = options;
  const {
    meetingCode,
    localAudioTrack,
    remoteAudioTracks = [],
    emitSignal,
    onSignal,
    onStatusChange,
    onStatsUpdate,
    onError,
  } = options;

  // B3: Preflight MediaRecorder VP8/Opus support check
  if (!MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")) {
    toast.error("Live streaming needs desktop Chrome or Edge (VP8/Opus MediaRecorder support required).");
    onStatusChange?.("idle");
    return null;
  }

  // Clean up any existing stream first
  if (activeSession || activeRecorder || activeDisplayStream) {
    await stopYouTubeLiveStreaming(false);
    await new Promise((r) => setTimeout(r, 400));
  }

  const connectedChannel = getConnectedYouTubeChannel();
  if (!connectedChannel?.streamKey || !connectedChannel.streamKey.trim()) {
    toast.error("Please connect your YouTube channel with your RTMP Stream Key first!");
    onStatusChange?.("idle");
    return null;
  }

  // B3: Constrain getDisplayMedia video capture
  let displayStream: MediaStream;
  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
        frameRate: { ideal: 30, max: 30 },
        displaySurface: "browser",
      },
      audio: true,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
    } as any);
    activeDisplayStream = displayStream;
  } catch (err: any) {
    onStatusChange?.("idle");
    toast.info("Screen selection cancelled");
    return null;
  }

  isStopping = false;
  hasReachedActiveState = false;
  activeMeetingCode = meetingCode;
  activeEmitSignal = emitSignal || null;
  chunkQueue.length = 0;

  // Handle when tutor clicks browser native "Stop sharing" bar (B7)
  const displayVideoTrack = displayStream.getVideoTracks()[0];
  displayVideoTrack.onended = () => {
    toast.info("Screen capture ended. Live stream stopped.");
    stopYouTubeLiveStreaming(true);
  };

  onStatusChange?.("connecting");
  toast.info("Connecting to YouTube…", { id: "yt-stream-init" });

  // Format RTMP URL securely without logging secret key (B1)
  let key = connectedChannel.streamKey.trim();
  if (key.startsWith("rtmp://a.rtmp.youtube.com/live2/")) key = key.replace("rtmp://a.rtmp.youtube.com/live2/", "");
  if (key.startsWith("rtmps://a.rtmp.youtube.com:443/live2/")) key = key.replace("rtmps://a.rtmp.youtube.com:443/live2/", "");
  const rtmpUrl = key.startsWith("rtmp://") || key.startsWith("rtmps://")
    ? key
    : `rtmps://a.rtmp.youtube.com:443/live2/${key}`;

  const cleanHandle = connectedChannel.channelHandle || "@MyChannel";
  const youtubeUrl = normalizeYouTubeChannelLiveUrl(cleanHandle);
  const liveStudioUrl = "https://studio.youtube.com/channel/live";
  const broadcastId = `user_${Date.now()}`;

  // B6: Initialize dynamic audio mixer
  const mixer = new LiveAudioMixer();
  await mixer.resume();
  activeMixer = mixer;
  const mixedAudioTrack = mixer.updateSources(localAudioTrack, remoteAudioTracks);

  // Combine display video with mixed audio track
  const combinedTracks: MediaStreamTrack[] = [displayVideoTrack];
  if (mixedAudioTrack) combinedTracks.push(mixedAudioTrack);
  const compositeStream = new MediaStream(combinedTracks);

  // Initialize MediaRecorder (B2, B3)
  const recorder = new MediaRecorder(compositeStream, {
    mimeType: "video/webm;codecs=vp8,opus",
    videoBitsPerSecond: 2_500_000,
    audioBitsPerSecond: 128_000,
  });
  activeRecorder = recorder;

  recorder.ondataavailable = async (e: BlobEvent) => {
    if (e.data && e.data.size > 0 && !isStopping) {
      try {
        const buf = await e.data.arrayBuffer();
        chunkQueue.push(new Uint8Array(buf));
        processChunkQueue();
      } catch (err) {
        console.error("[YouTubeService] Error processing recorded slice:", err);
      }
    }
  };

  // Promise waiting for server "ready" signal before starting recorder (B3)
  const readyPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Server encoder timed out after 15s waiting for ready state"));
    }, 15000);

    if (onSignal) {
      unsubscribeStatusSignal = onSignal("rtmpStatus", (payload: any) => {
        // Honest status handling (B4)
        if (payload?.status === "ready") {
          clearTimeout(timeout);
          resolve();
        } else if (payload?.status === "active") {
          clearTimeout(timeout);
          resolve();
          if (!hasReachedActiveState) {
            hasReachedActiveState = true;
            onStatusChange?.("live");
            toast.dismiss("yt-stream-init");
            toast.success("🔴 You are LIVE on YouTube!", {
              description: "Streaming high-definition video to your YouTube channel.",
              action: {
                label: "Watch Live",
                onClick: () => window.open(youtubeUrl, "_blank"),
              },
              duration: 10000,
            });
          }
        } else if (payload?.status === "stats") {
          onStatsUpdate?.({
            fps: payload.fps || 0,
            speed: payload.speed || 0,
            bitrateKbps: payload.bitrateKbps || 0,
          });
        } else if (payload?.status === "error") {
          if (payload?.code === "NO_SESSION") {
            triggerAutoRecovery();
          } else {
            clearTimeout(timeout);
            handleFatalError(payload.message || `YouTube Stream Error: ${payload.code || "unknown"}`);
          }
        } else if (payload?.status === "ended") {
          stopYouTubeLiveStreaming(hasReachedActiveState);
        }
      });
    } else {
      clearTimeout(timeout);
      resolve();
    }
  });

  // Emit startRtmpStream signal to server (B1: redact URL)
  if (emitSignal) {
    emitSignal("startRtmpStream", { classId: meetingCode, rtmpUrl });
  }

  try {
    // Wait for server ready handshake
    await readyPromise;
    // Start recorder producing 1-second timeslices
    recorder.start(1000);
  } catch (err: any) {
    toast.dismiss("yt-stream-init");
    handleFatalError(`Failed to connect encoder: ${err.message}`);
    return null;
  }

  const sessionObj: LiveStreamSession = {
    broadcastId,
    youtubeUrl,
    liveStudioUrl,
    startTime: Date.now(),
  };

  activeSession = sessionObj;
  return sessionObj;
}

/**
 * Updates dynamic audio sources while live without restarting recorder (B6).
 */
export function updateYouTubeLiveAudioSources(
  localAudioTrack: MediaStreamTrack | null,
  remoteAudioTracks: MediaStreamTrack[] = []
): void {
  if (activeMixer) {
    activeMixer.updateSources(localAudioTrack, remoteAudioTracks);
  }
}

/**
 * Stops ongoing live stream following strict sequence (B7).
 */
export async function stopYouTubeLiveStreaming(showEndedToast: boolean = true): Promise<void> {
  if (isStopping) return;
  isStopping = true;

  const reachedActive = hasReachedActiveState;
  hasReachedActiveState = false;

  // 1. Stop MediaRecorder
  if (activeRecorder && activeRecorder.state !== "inactive") {
    try {
      activeRecorder.stop();
    } catch {}
    activeRecorder = null;
  }

  // 2. Wait up to 3s for final chunk POST to complete
  if (chunkQueue.length > 0) {
    await new Promise<void>((resolve) => {
      finalChunkDrainResolve = resolve;
      processChunkQueue();
      setTimeout(() => {
        if (finalChunkDrainResolve) {
          finalChunkDrainResolve();
          finalChunkDrainResolve = null;
        }
      }, 3000);
    });
  }
  chunkQueue.length = 0;

  // 3. Emit stopRtmpStream signal to server
  if (activeEmitSignal && activeMeetingCode) {
    try {
      activeEmitSignal("stopRtmpStream", { classId: activeMeetingCode });
    } catch {}
    activeEmitSignal = null;
  }

  // 4. Release display tracks, close audio mixer, clear listeners (B7)
  if (activeDisplayStream) {
    activeDisplayStream.getTracks().forEach((t) => t.stop());
    activeDisplayStream = null;
  }

  if (activeMixer) {
    activeMixer.close();
    activeMixer = null;
  }

  if (unsubscribeStatusSignal) {
    unsubscribeStatusSignal();
    unsubscribeStatusSignal = null;
  }

  activeSession = null;
  activeMeetingCode = "";
  isStopping = false;

  currentOptions?.onStatusChange?.("ended");

  // B4: Show "Live stream ended" only if the stream had reached active
  if (showEndedToast && reachedActive) {
    toast.info("Live stream ended");
  }
}

/**
 * Returns current live stream session if active.
 */
export function getActiveYouTubeLiveSession(): LiveStreamSession | null {
  return activeSession;
}
