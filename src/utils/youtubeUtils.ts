/**
 * Utility functions for YouTube URL normalization, channel connection management, and helpers.
 */

export interface ConnectedChannelInfo {
  channelHandle: string;
  channelTitle: string;
  streamKey: string;
  defaultVisibility: "public" | "unlisted";
  liveUrl: string;
  videoUrl?: string;
  connectedAt: number;
}

export const DEFAULT_MATHSY_CHANNEL_LIVE_URL = "https://www.youtube.com/@Mathsy-Institute/live";

/**
 * Normalizes any YouTube URL (live short-link, channel link, short URL, embed, watch, or 11-char ID)
 * into a standard watch URL if a video ID is detected.
 */
export function normalizeYouTubeUrl(url: string | null | undefined): string {
  if (!url || !url.trim()) return "";
  const trimmed = url.trim();

  // Match 11-character YouTube video ID from various YouTube URLs
  const match = trimmed.match(/(?:v=|\/embed\/|\/watch\?v=|\/live\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (match && match[1]) {
    return `https://www.youtube.com/watch?v=${match[1]}`;
  }

  // If the user entered just the 11-character video ID directly
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return `https://www.youtube.com/watch?v=${trimmed}`;
  }

  return trimmed;
}

/**
 * Normalizes a channel handle or channel URL into the permanent live URL.
 * e.g.:
 * - "@Mathsy" -> "https://www.youtube.com/@Mathsy/live"
 * - "https://www.youtube.com/@Mathsy" -> "https://www.youtube.com/@Mathsy/live"
 * - "https://www.youtube.com/@Mathsy/live" -> "https://www.youtube.com/@Mathsy/live"
 */
export function normalizeYouTubeChannelLiveUrl(input: string | null | undefined): string {
  if (!input || !input.trim()) return "";
  let trimmed = input.trim();

  // If handle like "@mychannel"
  if (trimmed.startsWith("@")) {
    return `https://www.youtube.com/${trimmed}/live`;
  }

  // If youtube.com/@mychannel without https://
  if (trimmed.startsWith("youtube.com/@") || trimmed.startsWith("www.youtube.com/@")) {
    trimmed = `https://${trimmed}`;
  }

  // If contains @channel, ensure it ends with /live
  if (trimmed.includes("youtube.com/@")) {
    const clean = trimmed.split("?")[0].replace(/\/+$/, "");
    if (!clean.endsWith("/live")) {
      return `${clean}/live`;
    }
    return clean;
  }

  return normalizeYouTubeUrl(trimmed);
}

/**
 * Get the currently connected YouTube channel from persistent storage.
 */
export function getConnectedYouTubeChannel(): ConnectedChannelInfo | null {
  try {
    const raw = localStorage.getItem("mathsy_connected_youtube_channel");
    if (raw) {
      const parsed: ConnectedChannelInfo = JSON.parse(raw);
      // Clean up stale/ended static video IDs (e.g. cNyhzfzQD4E) so user never gets redirected to old recordings
      if (parsed.videoUrl?.includes("cNyhzfzQD4E") || parsed.liveUrl?.includes("cNyhzfzQD4E")) {
        delete parsed.videoUrl;
        parsed.liveUrl = parsed.channelHandle ? normalizeYouTubeChannelLiveUrl(parsed.channelHandle) : "https://studio.youtube.com/channel/live";
        localStorage.setItem("mathsy_connected_youtube_channel", JSON.stringify(parsed));
      }
      if (parsed.channelTitle === "Mathsy Official Channel" || !parsed.channelTitle) {
        parsed.channelTitle = "Personal YouTube Channel";
        localStorage.setItem("mathsy_connected_youtube_channel", JSON.stringify(parsed));
      }
      if (parsed.channelHandle && parsed.channelHandle.includes("youtube.com/@")) {
        const match = parsed.channelHandle.match(/@([a-zA-Z0-9_.-]+)/);
        if (match) {
          parsed.channelHandle = `@${match[1]}`;
          localStorage.setItem("mathsy_connected_youtube_channel", JSON.stringify(parsed));
        }
      }
      return parsed;
    }

    // Fallback: Check if individual legacy keys exist
    const savedKey = localStorage.getItem("mathsy_saved_rtmp_key");
    const savedUrl = localStorage.getItem("mathsy_permanent_channel_live_url");
    if (savedKey) {
      return {
        channelHandle: "@MyChannel",
        channelTitle: "Connected YouTube Channel",
        streamKey: savedKey,
        defaultVisibility: "public",
        liveUrl: savedUrl || "https://studio.youtube.com/channel/live",
        connectedAt: Date.now(),
      };
    }
  } catch (e) {
    console.warn("[youtubeUtils] Error reading connected channel:", e);
  }
  return null;
}

/**
 * Save connected YouTube channel info persistently.
 */
export function saveConnectedYouTubeChannel(channel: ConnectedChannelInfo): void {
  try {
    localStorage.setItem("mathsy_connected_youtube_channel", JSON.stringify(channel));
    if (channel.streamKey) {
      localStorage.setItem("mathsy_saved_rtmp_key", channel.streamKey);
    }
    if (channel.liveUrl) {
      localStorage.setItem("mathsy_permanent_channel_live_url", channel.liveUrl);
    }
  } catch (e) {
    console.error("[youtubeUtils] Error saving connected channel:", e);
  }
}

/**
 * Disconnect and remove saved YouTube channel info.
 */
export function disconnectYouTubeChannel(): void {
  try {
    localStorage.removeItem("mathsy_connected_youtube_channel");
    localStorage.removeItem("mathsy_saved_rtmp_key");
    localStorage.removeItem("mathsy_permanent_channel_live_url");
  } catch (e) {
    console.error("[youtubeUtils] Error disconnecting channel:", e);
  }
}
