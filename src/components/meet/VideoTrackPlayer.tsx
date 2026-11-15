import React, { useRef, useEffect } from "react";

interface VideoTrackPlayerProps {
  track: MediaStreamTrack | null;
  audioTrack?: MediaStreamTrack | null;
  className?: string;
  style?: React.CSSProperties;
  mirror?: boolean;
  objectFit?: "contain" | "cover" | "fill" | "none" | "scale-down";
}

export const VideoTrackPlayer: React.FC<VideoTrackPlayerProps> = ({
  track,
  audioTrack,
  className = "",
  style,
  mirror = false,
  objectFit,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !track) {
      if (el) el.srcObject = null;
      streamRef.current = null;
      return;
    }

    el.playsInline = true;
    el.setAttribute("playsinline", "true");
    el.setAttribute("webkit-playsinline", "true");

    // Unified A/V sync: If an audioTrack is present, play it synchronously via this video element's media clock
    if (audioTrack) {
      el.muted = false;
      el.defaultMuted = false;
      el.volume = 1.0;
      el.removeAttribute("muted");
    } else {
      el.muted = true;
      el.defaultMuted = true;
      el.setAttribute("muted", "true");
    }

    // Bind video and audio tracks together into the same MediaStream for hardware A/V clock synchronization
    const currentVideo = streamRef.current?.getVideoTracks()[0];
    const currentAudio = streamRef.current?.getAudioTracks()[0];
    if (!streamRef.current || currentVideo !== track || currentAudio !== (audioTrack || undefined)) {
      const tracksToAttach: MediaStreamTrack[] = [track];
      if (audioTrack) {
        tracksToAttach.push(audioTrack);
      }
      const stream = new MediaStream(tracksToAttach);
      streamRef.current = stream;
      el.srcObject = stream;
    }

    const playVideo = () => {
      if (el) {
        const promise = el.play();
        if (promise !== undefined) {
          promise.catch((err) => {
            // Autoplay policy fallback: if unmuted playback is blocked, play muted first then unlock on user gesture
            if (!el.muted && err?.name === "NotAllowedError") {
              el.muted = true;
              el.play().catch(() => {});
              const unlockAudio = () => {
                if (el) {
                  el.muted = false;
                  el.play().catch(() => {});
                }
              };
              window.addEventListener("click", unlockAudio, { once: true });
              window.addEventListener("touchstart", unlockAudio, { once: true });
            } else {
              // Safari autoplay retry
              setTimeout(() => {
                if (el && el.paused) el.play().catch(() => {});
              }, 300);
            }
          });
        }
      }
    };

    playVideo();

    const handleUnmute = () => {
      playVideo();
    };

    const handleCanPlay = () => {
      playVideo();
    };

    track.addEventListener("unmute", handleUnmute);
    if (audioTrack) {
      audioTrack.addEventListener("unmute", handleUnmute);
    }
    el.addEventListener("canplay", handleCanPlay);
    el.addEventListener("loadedmetadata", handleCanPlay);

    return () => {
      track.removeEventListener("unmute", handleUnmute);
      if (audioTrack) {
        audioTrack.removeEventListener("unmute", handleUnmute);
      }
      el.removeEventListener("canplay", handleCanPlay);
      el.removeEventListener("loadedmetadata", handleCanPlay);
    };
  }, [track, audioTrack]);

  if (!track) return null;

  // Determine intended object-fit: explicit prop > className scan > default to "cover"
  const isContain = objectFit === "contain" || className.includes("object-contain");
  const fitMode: "contain" | "cover" | "fill" | "none" | "scale-down" = objectFit
    ? objectFit
    : isContain
    ? "contain"
    : className.includes("object-cover")
    ? "cover"
    : "cover";

  const baseFitClass = isContain ? "object-contain" : "object-cover";
  // Remove conflicting object-fit classes from className to avoid Tailwind stylesheet ordering collisions
  const cleanedClassName = className.replace(/\bobject-(contain|cover|fill|none|scale-down)\b/g, "").trim();

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className={`w-full h-full ${baseFitClass} ${mirror ? "scale-x-[-1]" : ""} ${cleanedClassName}`}
      style={{ objectFit: fitMode, ...style }}
    />
  );
};
