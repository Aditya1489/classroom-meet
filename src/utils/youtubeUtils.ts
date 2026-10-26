/**
 * Utility functions for YouTube URL normalization, channel connection management, and helpers.
 */

export interface ConnectedChannelInfo {
  channelHandle: string;
  channelTitle: string;
  streamKey: string;
  defaultVisibility: "public" | "unlisted";
  liveUrl: string;
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
 * Validates whether an input is a valid direct YouTube video watch URL (11-char video ID).
 */
export function isValidYouTubeWatchUrl(input: string): boolean {
  if (!input || !input.trim()) return false;
  const trimmed = input.trim();
  return /^(https?:\/\/(www\.)?youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11}|https?:\/\/youtu\.be\/[a-zA-Z0-9_-]{11})$/.test(trimmed);
}

/**
 * Normalizes a channel handle or channel URL into the permanent live URL.
 * e.g. "@Mathsy" -> "https://www.youtube.com/@Mathsy/live"
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
 * B8: On app load, delete any saved videoUrl and any liveUrl containing /watch?v=.
 * Never persist watch links again.
 */
export function getConnectedYouTubeChannel(): ConnectedChannelInfo | null {
  try {
    const raw = localStorage.getItem("mathsy_connected_youtube_channel");
    if (raw) {
      const parsed: any = JSON.parse(raw);
      let modified = false;

      // Delete any saved videoUrl
      if (parsed.videoUrl) {
        delete parsed.videoUrl;
        modified = true;
      }

      // Scrub any temporary watch URL from saved liveUrl
      if (parsed.liveUrl && parsed.liveUrl.includes("/watch?v=")) {
        parsed.liveUrl = parsed.channelHandle ? normalizeYouTubeChannelLiveUrl(parsed.channelHandle) : "https://studio.youtube.com/channel/live";
        modified = true;
      }

      if (parsed.channelTitle === "Mathsy Official Channel" || !parsed.channelTitle) {
        parsed.channelTitle = "Personal YouTube Channel";
        modified = true;
      }

      if (parsed.channelHandle && parsed.channelHandle.includes("youtube.com/@")) {
        const match = parsed.channelHandle.match(/@([a-zA-Z0-9_.-]+)/);
        if (match) {
          parsed.channelHandle = `@${match[1]}`;
          modified = true;
        }
      }

      if (modified) {
        localStorage.setItem("mathsy_connected_youtube_channel", JSON.stringify(parsed));
      }
      return parsed as ConnectedChannelInfo;
    }

    // Fallback: Check if individual legacy stream key exists
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
 * Save connected YouTube channel info persistently without temporary watch links.
 */
export function saveConnectedYouTubeChannel(channel: ConnectedChannelInfo): void {
  try {
    const sanitized: ConnectedChannelInfo = {
      channelHandle: channel.channelHandle,
      channelTitle: channel.channelTitle,
      streamKey: channel.streamKey,
      defaultVisibility: channel.defaultVisibility,
      liveUrl: normalizeYouTubeChannelLiveUrl(channel.channelHandle) || "https://studio.youtube.com/channel/live",
      connectedAt: channel.connectedAt || Date.now(),
    };
    localStorage.setItem("mathsy_connected_youtube_channel", JSON.stringify(sanitized));
    if (channel.streamKey) {
      localStorage.setItem("mathsy_saved_rtmp_key", channel.streamKey);
    }
    if (sanitized.liveUrl) {
      localStorage.setItem("mathsy_permanent_channel_live_url", sanitized.liveUrl);
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
