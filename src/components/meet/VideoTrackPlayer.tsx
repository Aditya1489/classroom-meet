import React, { useRef, useEffect } from "react";

interface VideoTrackPlayerProps {
  track: MediaStreamTrack | null;
  className?: string;
  style?: React.CSSProperties;
  mirror?: boolean;
}

export const VideoTrackPlayer: React.FC<VideoTrackPlayerProps> = ({
  track,
  className = "",
  style,
  mirror = false,
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

    // Only create and assign a new MediaStream if the track actually changed
    if (!streamRef.current || streamRef.current.getVideoTracks()[0] !== track) {
      const stream = new MediaStream([track]);
      streamRef.current = stream;
      el.srcObject = stream;
    }

    el.muted = true;
    el.playsInline = true;

    const playVideo = () => {
      if (el && el.paused) {
        el.play().catch((err) => {
          // Play interruption can happen during rapid mounting, safely ignore
        });
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

    return () => {
      track.removeEventListener("unmute", handleUnmute);
      el.removeEventListener("canplay", handleCanPlay);
    };
  }, [track]);

  if (!track) return null;

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className={`w-full h-full object-cover ${mirror ? "scale-x-[-1]" : ""} ${className}`}
      style={style}
    />
  );
};
