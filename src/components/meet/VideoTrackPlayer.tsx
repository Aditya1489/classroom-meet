import React, { useRef, useEffect } from "react";

interface VideoTrackPlayerProps {
  track: MediaStreamTrack | null;
  className?: string;
  style?: React.CSSProperties;
  mirror?: boolean;
  objectFit?: "contain" | "cover" | "fill" | "none" | "scale-down";
}

export const VideoTrackPlayer: React.FC<VideoTrackPlayerProps> = ({
  track,
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

    // Crucial for Safari / WebKit: set audio muting and inline playback attributes BEFORE attaching srcObject
    el.muted = true;
    el.defaultMuted = true;
    el.playsInline = true;
    el.setAttribute("playsinline", "true");
    el.setAttribute("webkit-playsinline", "true");
    el.setAttribute("muted", "true");

    // Only create and assign a new MediaStream if the track actually changed
    if (!streamRef.current || streamRef.current.getVideoTracks()[0] !== track) {
      const stream = new MediaStream([track]);
      streamRef.current = stream;
      el.srcObject = stream;
    }

    const playVideo = () => {
      if (el) {
        const promise = el.play();
        if (promise !== undefined) {
          promise.catch(() => {
            // Safari autoplay retry
            setTimeout(() => {
              if (el && el.paused) el.play().catch(() => {});
            }, 300);
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
    el.addEventListener("canplay", handleCanPlay);
    el.addEventListener("loadedmetadata", handleCanPlay);

    return () => {
      track.removeEventListener("unmute", handleUnmute);
      el.removeEventListener("canplay", handleCanPlay);
      el.removeEventListener("loadedmetadata", handleCanPlay);
    };
  }, [track]);

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
