import {
  normalizeYouTubeUrl,
  normalizeYouTubeChannelLiveUrl,
  getConnectedYouTubeChannel,
  saveConnectedYouTubeChannel,
  ConnectedChannelInfo,
  DEFAULT_MATHSY_CHANNEL_LIVE_URL,
} from "../utils/youtubeUtils";
import { toast } from "sonner";

export interface LiveStreamSession {
  broadcastId: string;
  youtubeUrl: string;
  liveStudioUrl: string;
  rtmpUrl: string;
  startTime: number;
}

// Active stream references
let activeRecorder: MediaRecorder | null = null;
let activeDisplayStream: MediaStream | null = null;
let activeAudioCtx: AudioContext | null = null;
let activeSession: LiveStreamSession | null = null;
let activeEmitSignal: ((event: string, payload: any) => void) | null = null;
let activeClassId: string = "";
let activePoller: any = null;

function getHttpServerUrl(wsUrl: string): string {
  if (!wsUrl) return "https://rtc.mathsy.in";
  return wsUrl.replace(/^ws(s)?:\/\//i, "http$1://");
}

/**
 * Get Google OAuth access token using configured backend credentials.
 */
export async function getGoogleAccessToken(): Promise<string | null> {
  try {
    const refreshToken =
      (import.meta as any).env?.VITE_YOUTUBE_REFRESH_TOKEN ||
      "1//04EUIyzDUSRUsCgYIARAAGAQSNwF-L9Ir5XnQUPv7DlEP53XXSZcdPr2soYrt695pbfbaKBAJnLrMnn1hlevfCG5VaD4TjHv7_Dw";
    const clientId =
      (import.meta as any).env?.VITE_YOUTUBE_CLIENT_ID ||
      "65166613028-i5bb5pai6ob6qjploqtr7r47m2bmha46.apps.googleusercontent.com";
    const clientSecret =
      (import.meta as any).env?.VITE_YOUTUBE_CLIENT_SECRET ||
      "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";

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.warn("[YouTubeService] Token refresh failed:", tokenData);
      return null;
    }
    return tokenData.access_token;
  } catch (err) {
    console.warn("[YouTubeService] Token refresh error:", err);
    return null;
  }
}

/**
 * Automatically resolves the direct YouTube video watch URL (https://www.youtube.com/watch?v=...)
 * for any given YouTube channel handle or URL.
 */
export async function resolveChannelLiveVideoUrl(channelHandleOrUrl: string): Promise<string | null> {
  if (!channelHandleOrUrl) return null;
  const cleanHandle = channelHandleOrUrl
    .replace(/https?:\/\/(www\.)?youtube\.com\//i, "")
    .replace(/^@/, "")
    .replace(/\/live.*$/i, "")
    .split("/")[0]
    .split("?")[0]
    .trim();

  if (!cleanHandle) return null;

  try {
    const accessToken = await getGoogleAccessToken();
    if (!accessToken) return null;

    // 1. Fetch channel by handle
    const chanRes = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&forHandle=${encodeURIComponent(cleanHandle)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!chanRes.ok) return null;
    const chanData = await chanRes.json();
    const item = chanData.items?.[0];
    if (!item?.id) return null;

    // 2. Query YouTube search specifically for CURRENTLY LIVE videos (eventType=live)
    const searchRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${item.id}&eventType=live&type=video`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      const liveItem = searchData.items?.[0];
      const videoId = liveItem?.id?.videoId;
      if (videoId) {
        // Verify with liveStreamingDetails that the stream has NOT ended
        const vRes = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (vRes.ok) {
          const vData = await vRes.json();
          const details = vData.items?.[0]?.liveStreamingDetails;
          // If actualEndTime exists, the stream has already ended and is recorded VOD. Do not use!
          if (details && !details.actualEndTime) {
            console.log(`[YouTubeService] Found active live stream for @${cleanHandle}: ${videoId}`);
            return `https://www.youtube.com/watch?v=${videoId}`;
          }
        }
      }
    }
  } catch (err) {
    console.warn("[YouTubeService] Auto-resolve live video failed:", err);
  }
  return null;
}

/**
 * Creates a YouTube Live Broadcast directly using the YouTube Data API v3.
 */
export async function createYouTubeBroadcastDirectly(
  title: string,
  description: string,
  visibility: "public" | "unlisted"
): Promise<{ broadcastId: string; rtmpUrl: string; youtubeUrl: string; liveStudioUrl: string } | null> {
  try {
    const accessToken = await getGoogleAccessToken();
    if (!accessToken) return null;

    // 1. Create Broadcast
    const broadcastRes = await fetch(
      "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status,contentDetails",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          snippet: {
            title: title || "Mathsy Live Class",
            description: description || "Live Streamed from Mathsy Meet",
            scheduledStartTime: new Date().toISOString(),
          },
          status: {
            privacyStatus: visibility === "public" ? "public" : "unlisted",
            selfDeclaredMadeForKids: false,
          },
          contentDetails: {
            enableAutoStart: true,
            enableAutoStop: false,
          },
        }),
      }
    );

    const broadcastData = await broadcastRes.json();
    if (!broadcastData.id) {
      console.warn("[YouTubeService] Broadcast creation failed:", broadcastData);
      return null;
    }
    const broadcastId = broadcastData.id;

    // 2. Create Stream
    const streamRes = await fetch(
      "https://www.googleapis.com/youtube/v3/liveStreams?part=snippet,cdn",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          snippet: { title: `Stream for ${broadcastId}` },
          cdn: {
            frameRate: "variable",
            ingestionType: "rtmp",
            resolution: "variable",
          },
        }),
      }
    );

    const streamData = await streamRes.json();
    if (!streamData.cdn?.ingestionInfo) {
      console.warn("[YouTubeService] Stream creation failed:", streamData);
      return null;
    }

    const ingestionInfo = streamData.cdn.ingestionInfo;
    const rtmpUrl = `${ingestionInfo.ingestionAddress}/${ingestionInfo.streamName}`;

    // 3. Bind Broadcast to Stream
    await fetch(
      `https://www.googleapis.com/youtube/v3/liveBroadcasts/bind?id=${broadcastId}&part=id,contentDetails&streamId=${streamData.id}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    return {
      broadcastId,
      rtmpUrl,
      youtubeUrl: `https://www.youtube.com/watch?v=${broadcastId}`,
      liveStudioUrl: `https://studio.youtube.com/video/${broadcastId}/livestreaming`,
    };
  } catch (err) {
    console.error("[YouTubeService] Direct YouTube API stream creation error:", err);
    return null;
  }
}

/**
 * Automatically transitions a YouTube Live Broadcast to "live" status
 * so viewers can watch the broadcast immediately without needing to open YouTube Studio.
 */
export async function transitionYouTubeBroadcastToLive(broadcastId: string): Promise<boolean> {
  if (!broadcastId || broadcastId.startsWith("personal_")) return false;
  try {
    const accessToken = await getGoogleAccessToken();
    if (!accessToken) return false;

    console.log(`[YouTubeService] Transitioning broadcast ${broadcastId} to live...`);
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/liveBroadcasts/transition?broadcastStatus=live&id=${broadcastId}&part=id,status`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    const data = await res.json();
    console.log("[YouTubeService] transition-live direct result:", data);
    return res.ok;
  } catch (err) {
    console.warn("[YouTubeService] transition-live direct failed:", err);
    return false;
  }
}

/**
 * Completes a YouTube Live Broadcast when the tutor ends the stream,
 * converting it to a saved YouTube replay video.
 */
export async function completeYouTubeLiveBroadcast(broadcastId: string): Promise<boolean> {
  if (!broadcastId || broadcastId.startsWith("personal_")) return false;
  try {
    const accessToken = await getGoogleAccessToken();
    if (!accessToken) return false;

    console.log(`[YouTubeService] Completing broadcast ${broadcastId}...`);
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/liveBroadcasts/transition?broadcastStatus=complete&id=${broadcastId}&part=id,status`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    const data = await res.json();
    console.log("[YouTubeService] complete-live direct result:", data);
    return res.ok;
  } catch (err) {
    console.warn("[YouTubeService] complete-live direct failed:", err);
    return false;
  }
}

/**
 * Mixes local audio track and remote participant audio tracks into a single stream.
 */
async function setupAudioMixer(
  localAudioTrack: MediaStreamTrack | null,
  remoteAudioTracks: MediaStreamTrack[] = []
): Promise<MediaStreamTrack | null> {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return localAudioTrack;

    const audioCtx = new AudioContextClass();
    activeAudioCtx = audioCtx;

    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }

    const dest = audioCtx.createMediaStreamDestination();

    // Connect local microphone
    if (localAudioTrack) {
      const localStream = new MediaStream([localAudioTrack]);
      const localSource = audioCtx.createMediaStreamSource(localStream);
      localSource.connect(dest);
    }

    // Connect remote participant audios
    for (const rTrack of remoteAudioTracks) {
      if (rTrack && rTrack.readyState === "live") {
        const rStream = new MediaStream([rTrack]);
        const rSource = audioCtx.createMediaStreamSource(rStream);
        rSource.connect(dest);
      }
    }

    const mixedTracks = dest.stream.getAudioTracks();
    return mixedTracks[0] || localAudioTrack;
  } catch (err) {
    console.warn("[YouTubeService] Audio mixer fallback to local track:", err);
    return localAudioTrack;
  }
}

/**
 * Initiates the live broadcast and starts streaming screen + mixed audio to YouTube RTMP.
 */
export interface StartYouTubeLiveOptions {
  meetingCode: string;
  title: string;
  description?: string;
  visibility?: "public" | "unlisted";
  broadcastMode?: "mathsy" | "personal";
  localAudioTrack: MediaStreamTrack | null;
  remoteAudioTracks?: MediaStreamTrack[];
  emitSignal?: (event: string, payload: any) => void;
  onSignal?: (event: string, callback: (payload: any) => void) => () => void;
  onStatusChange?: (status: "connecting" | "live" | "ended" | "error") => void;
}

/**
 * Initiates the live broadcast and starts streaming screen + mixed audio to YouTube RTMP.
 */
export async function startYouTubeLiveStreaming(
  options: StartYouTubeLiveOptions
): Promise<LiveStreamSession | null> {
  const {
    meetingCode,
    title,
    description = "Live Classroom via Mathsy Meet",
    visibility = "public",
    broadcastMode = "mathsy",
    localAudioTrack,
    remoteAudioTracks = [],
    emitSignal,
    onSignal,
    onStatusChange,
  } = options;

  // Clean up any stale streaming session first before launching a new stream
  if (activeSession || activeRecorder || activeDisplayStream) {
    stopYouTubeLiveStreaming();
    await new Promise((r) => setTimeout(r, 400));
  }

  // 1. Capture Display Screen / Classroom Canvas FIRST
  let displayStream: MediaStream;
  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "browser" },
      audio: true,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
    } as any);
    activeDisplayStream = displayStream;
  } catch (err: any) {
    toast.dismiss("yt-stream-init");
    toast.error("Screen selection cancelled");
    onStatusChange?.("ended");
    return null;
  }

  // Handle when tutor stops sharing screen via browser UI
  displayStream.getVideoTracks()[0].onended = () => {
    stopYouTubeLiveStreaming();
    toast.info("Screen capture ended. Live stream stopped.");
  };

  onStatusChange?.("connecting");
  toast.info("Connecting to YouTube Live... 🔴", { id: "yt-stream-init" });

  activeClassId = meetingCode;
  activeEmitSignal = emitSignal || null;

  let broadcastId = "";
  let rtmpUrl = "";
  let youtubeUrl = "";
  let liveStudioUrl = "https://studio.youtube.com";

  const connectedChannel = getConnectedYouTubeChannel();

  if (!connectedChannel?.streamKey || !connectedChannel.streamKey.trim()) {
    toast.dismiss("yt-stream-init");
    toast.error("Please connect your YouTube channel with your RTMP Stream Key first!");
    displayStream.getTracks().forEach((t) => t.stop());
    activeDisplayStream = null;
    onStatusChange?.("ended");
    return null;
  }

  // ── Stream to User's Connected YouTube Channel (100% User Owned) ──
  let key = connectedChannel.streamKey.trim();
  if (key.startsWith("rtmp://a.rtmp.youtube.com/live2/")) {
    key = key.replace("rtmp://a.rtmp.youtube.com/live2/", "");
  } else if (key.startsWith("rtmps://a.rtmp.youtube.com:443/live2/")) {
    key = key.replace("rtmps://a.rtmp.youtube.com:443/live2/", "");
  }
  rtmpUrl = key.startsWith("rtmp://") || key.startsWith("rtmps://")
    ? key
    : `rtmp://a.rtmp.youtube.com/live2/${key}`;

  const cleanHandle = connectedChannel.channelHandle || "@MyChannel";
  youtubeUrl = connectedChannel.videoUrl || normalizeYouTubeChannelLiveUrl(cleanHandle);
  liveStudioUrl = "https://studio.youtube.com/channel/live";
  broadcastId = `user_${Date.now()}`;

  console.log("[YouTubeService] Streaming exclusively to user's connected channel:", { cleanHandle, youtubeUrl, rtmpUrl });

  // Background poller: Detect live video ID so watch link updates to direct video player
  if (activePoller) clearInterval(activePoller);
  let pollCount = 0;
  activePoller = setInterval(async () => {
    pollCount++;
    if (pollCount > 20 || !activeSession) {
      clearInterval(activePoller);
      activePoller = null;
      return;
    }
    try {
      const detectedUrl = await resolveChannelLiveVideoUrl(cleanHandle);
      if (detectedUrl && (!activeSession.youtubeUrl.includes("/watch?v=") || activeSession.youtubeUrl !== detectedUrl)) {
        console.log("[YouTubeService] Auto-detected live video watch URL for user channel:", detectedUrl);
        activeSession.youtubeUrl = detectedUrl;
        window.dispatchEvent(new CustomEvent("mathsy-update-live-url", { detail: detectedUrl }));
        clearInterval(activePoller);
        activePoller = null;
      }
    } catch (err) {
      console.warn("[YouTubeService] Auto-detect live poll error:", err);
    }
  }, 3000);

  if (!rtmpUrl) {
    toast.dismiss("yt-stream-init");
    toast.error("Could not initialize live stream. Please check stream settings.");
    displayStream.getTracks().forEach((t) => t.stop());
    activeDisplayStream = null;
    onStatusChange?.("ended");
    return null;
  }

  // Guard flag so transition-live is only called once per stream session
  let transitionCalled = false;
  const triggerTransitionToLive = (reason: string) => {
    if (
      transitionCalled ||
      !broadcastId ||
      broadcastId.startsWith("personal_") ||
      broadcastId.startsWith("user_")
    ) {
      return;
    }
    transitionCalled = true;
    console.log(`[YouTubeService] Triggering transition-live (reason: ${reason}) for broadcast: ${broadcastId}`);
    transitionYouTubeBroadcastToLive(broadcastId);
  };

  // Register the rtmpStatus listener BEFORE emitting startRtmpStream
  if (onSignal) {
    onSignal("rtmpStatus", (payload: any) => {
      console.log("[YouTubeService] Server rtmpStatus:", payload);
      if (payload?.status === "active") {
        toast.success("YouTube RTMP Encoder active on server! Streaming LIVE 🔴");
        triggerTransitionToLive("rtmpStatus:active");
      } else if (payload?.status === "log") {
        triggerTransitionToLive("rtmpStatus:log");
      } else if (payload?.status === "error") {
        toast.error(`YouTube stream error: ${payload.error || "FFmpeg spawn failed"}`);
      }
    });
  }

  // Safety fallback: if rtmpStatus was swallowed or delayed, still transition after 10s
  if (broadcastId && !broadcastId.startsWith("personal_")) {
    setTimeout(() => {
      triggerTransitionToLive("safety-fallback-10s");
    }, 10000);
  }

  // Tell SFU media server to spawn FFmpeg process targeting YouTube RTMP endpoint
  if (emitSignal) {
    console.log("[YouTubeService] Emitting startRtmpStream:", { classId: meetingCode, rtmpUrl });
    emitSignal("startRtmpStream", { classId: meetingCode, rtmpUrl });
  }

  // 5. Combine Video Track and Mixed Audio Track
  const videoTrack = displayStream.getVideoTracks()[0];
  const mixedAudioTrack = await setupAudioMixer(localAudioTrack, remoteAudioTracks);

  const combinedTracks: MediaStreamTrack[] = [videoTrack];
  if (mixedAudioTrack) combinedTracks.push(mixedAudioTrack);

  const streamToStream = new MediaStream(combinedTracks);

  // 6. Start MediaRecorder for live ingestion
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
    ? "video/webm;codecs=vp8,opus"
    : "video/webm";

  const recorder = new MediaRecorder(streamToStream, {
    mimeType,
    videoBitsPerSecond: 2_500_000,
    audioBitsPerSecond: 128_000,
  });
  activeRecorder = recorder;

  const rtmpServerUrl = getHttpServerUrl(
    (import.meta as any).env?.VITE_MEDIASOUP_SERVER_URL || "https://rtc.mathsy.in"
  );

  const pendingRtmpQueue: Uint8Array[] = [];
  let isFlushingRtmp = false;

  const flushRtmpQueue = async () => {
    if (isFlushingRtmp) return;
    isFlushingRtmp = true;

    try {
      while (pendingRtmpQueue.length > 0) {
        const chunk = pendingRtmpQueue[0];
        let sent = false;

        const chunkPayload =
          chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength
            ? chunk
            : chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);

        // 1. Direct HTTP Relay endpoint without illegal CORS headers
        try {
          const resp = await fetch(`${rtmpServerUrl}/rtmp-chunk?classId=${encodeURIComponent(meetingCode)}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream",
              "x-class-id": meetingCode,
            },
            body: chunkPayload as BodyInit,
          });
          if (resp.ok) sent = true;
        } catch {
          // Direct HTTP offline or blocked
        }

        // 2. Fallback to Mediasoup socket relay if HTTP was unacknowledged
        if (!sent && emitSignal) {
          try {
            emitSignal("rtmpChunk", { classId: meetingCode, chunk });
            sent = true;
          } catch (sockErr) {
            console.warn("[YouTubeService] Socket chunk relay failed:", sockErr);
          }
        }

        if (sent) {
          pendingRtmpQueue.shift();
        } else {
          console.warn(`[YouTubeService] Buffering chunk locally (${pendingRtmpQueue.length} queued)`);
          break;
        }
      }
    } finally {
      isFlushingRtmp = false;
    }
  };

  recorder.ondataavailable = async (e: BlobEvent) => {
    if (e.data && e.data.size > 0) {
      try {
        const buffer = await e.data.arrayBuffer();
        const uint8 = new Uint8Array(buffer);
        pendingRtmpQueue.push(uint8);

        // Keep max 60 seconds buffer to prevent memory exhaustion
        if (pendingRtmpQueue.length > 60) {
          pendingRtmpQueue.shift();
        }

        await flushRtmpQueue();
      } catch (err) {
        console.error("[YouTubeService] Error processing recorded chunk:", err);
      }
    }
  };

  // Allow media server FFmpeg process 1.2 seconds to initialize before streaming slices
  await new Promise((r) => setTimeout(r, 1200));

  recorder.start(1000); // 1-second timeslices for low-latency live streaming

  const sessionObj: LiveStreamSession = {
    broadcastId,
    youtubeUrl,
    liveStudioUrl,
    rtmpUrl,
    startTime: Date.now(),
  };

  activeSession = sessionObj;
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

  return sessionObj;
}

/**
 * Stops any ongoing YouTube live stream and releases all captured tracks.
 */
export function stopYouTubeLiveStreaming(): void {
  if (activeEmitSignal && activeClassId) {
    try {
      activeEmitSignal("stopRtmpStream", { classId: activeClassId });
    } catch {}
    activeEmitSignal = null;
    activeClassId = "";
  }

  if (activeRecorder && activeRecorder.state === "recording") {
    try {
      activeRecorder.stop();
    } catch {}
    activeRecorder = null;
  }

  if (activeDisplayStream) {
    activeDisplayStream.getTracks().forEach((track) => track.stop());
    activeDisplayStream = null;
  }

  if (activePoller) {
    clearInterval(activePoller);
    activePoller = null;
  }

  if (activeSession?.broadcastId && !activeSession.broadcastId.startsWith("personal_")) {
    completeYouTubeLiveBroadcast(activeSession.broadcastId);
  }

  activeSession = null;
  toast.info("YouTube Live Stream Ended");
}

/**
 * Returns current live stream session if active.
 */
export function getActiveYouTubeLiveSession(): LiveStreamSession | null {
  return activeSession;
}
