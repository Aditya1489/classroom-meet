import React, { useRef, useEffect } from "react";
import { Mic, MicOff, Pin, PinOff, Hand, Shield, LogOut, VideoOff } from "lucide-react";
import { GoogleMeetAudioVisualizer } from "./GoogleMeetAudioVisualizer";
import { VideoTrackPlayer } from "./VideoTrackPlayer";

interface VideoTileProps {
  id: string;
  name: string;
  videoTrack?: MediaStreamTrack | null;
  audioTrack?: MediaStreamTrack | null;
  isAudioMuted?: boolean;
  isVideoMuted?: boolean;
  isLocal?: boolean;
  isHost?: boolean;
  isViewerHost?: boolean;
  isSpeaking?: boolean;
  isHandRaised?: boolean;
  isPinned?: boolean;
  onTogglePin?: () => void;
  onLowerHand?: () => void;
  onForceMute?: () => void;
  onExpel?: () => void;
  className?: string;
}

export const VideoTile: React.FC<VideoTileProps> = ({
  id,
  name,
  videoTrack,
  audioTrack,
  isAudioMuted = false,
  isVideoMuted = false,
  isLocal = false,
  isHost = false,
  isViewerHost = false,
  isSpeaking = false,
  isHandRaised = false,
  isPinned = false,
  onTogglePin,
  onLowerHand,
  onForceMute,
  onExpel,
  className = "",
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Attach Video Track
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    if (videoTrack) {
      const stream = new MediaStream([videoTrack]);
      videoEl.srcObject = stream;
      videoEl.play().catch((e) => console.warn("[VideoTile] play() error:", e));
    } else {
      videoEl.srcObject = null;
    }
  }, [videoTrack]);

  // Attach Remote Audio Track (Local audio should be muted to avoid feedback)
  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl || isLocal) return;

    if (audioTrack) {
      const stream = new MediaStream([audioTrack]);
      audioEl.srcObject = stream;
      audioEl.play().catch((e) => console.warn("[VideoTile] audio play() error:", e));
    } else {
      audioEl.srcObject = null;
    }
  }, [audioTrack, isLocal]);

  const hasVideo = Boolean(videoTrack) && !isVideoMuted;

  return (
    <div
      className={`group relative flex items-center justify-center bg-[#1a1814] rounded-2xl overflow-hidden border transition-all duration-200 select-none ${
        isHandRaised
          ? "border-amber-500/60 ring-2 ring-amber-500/30"
          : isSpeaking
          ? "border-[#f59e0b] ring-2 ring-[#f59e0b]/40 shadow-lg shadow-[#f59e0b]/20"
          : "border-[#f3eee6]/10 hover:border-[#f59e0b]/30"
      } ${isPinned ? "ring-2 ring-[#f59e0b]" : ""} ${className}`}
    >
      {/* Remote Audio Element */}
      {!isLocal && <audio ref={audioRef} autoPlay playsInline />}

      {/* Video stream */}
      {hasVideo && videoTrack ? (
        <VideoTrackPlayer
          track={videoTrack}
          mirror={isLocal}
          className="w-full h-full object-cover"
        />
      ) : null}

      {/* Avatar Fallback (when camera is off) */}
      {!hasVideo && (
        <div className="flex flex-col items-center justify-center gap-3">
          <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-gradient-to-tr from-[#f59e0b] to-[#d97706] text-[#0e0d0b] flex items-center justify-center text-2xl md:text-3xl font-bold shadow-xl border border-white/20">
            {name.charAt(0).toUpperCase()}
          </div>
          <span className="text-xs text-[#a39e94] font-medium">{name}</span>
          <div className="absolute bottom-3 right-3 bg-[#0e0d0b]/80 backdrop-blur-md p-1.5 rounded-full text-[#a39e94] border border-[#f3eee6]/10">
            <VideoOff className="w-3.5 h-3.5" />
          </div>
        </div>
      )}

      {/* Bottom Name & Google Meet 3-Bar Audio Visualizer */}
      <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-[#0e0d0b]/85 backdrop-blur-md px-3 py-1.5 rounded-full border border-[#f3eee6]/10 shadow-lg text-xs font-medium z-10">
        <span className="text-[#f3eee6] truncate max-w-[120px] md:max-w-[180px] font-mono">
          {name} {isLocal && "(You)"}
        </span>
        {isHost && (
          <span className="flex items-center gap-0.5 text-[10px] text-[#f59e0b]">
            <Shield className="w-3 h-3 fill-[#f59e0b]/20" />
          </span>
        )}
        <div className="flex items-center ml-1">
          <GoogleMeetAudioVisualizer
            track={audioTrack}
            isMuted={isAudioMuted}
          />
        </div>
      </div>

      {/* Top right badges: Raised Hand & Pin */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5 z-20">
        {isHandRaised && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onLowerHand?.();
            }}
            className="flex items-center gap-1 bg-amber-500 hover:bg-amber-400 text-zinc-950 px-2 py-0.5 rounded-full text-[10px] font-bold shadow-lg animate-bounce transition cursor-pointer border border-amber-300/50"
            title={isViewerHost ? "Click to lower student's hand" : "Hand Raised"}
          >
            <Hand className="w-3 h-3" />
            <span>Hand Raised</span>
          </button>
        )}

        {onTogglePin && (
          <button
            onClick={onTogglePin}
            title={isPinned ? "Unpin tile" : "Pin tile to spotlight"}
            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full bg-black/60 hover:bg-black/90 text-white border border-white/10 backdrop-blur-sm transition cursor-pointer"
          >
            {isPinned ? <PinOff className="w-3.5 h-3.5 text-[#8ab4f8]" /> : <Pin className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {/* Host Hover Action Overlay (Mute & Expel Student) */}
      {isViewerHost && !isHost && !isLocal && (
        <div className="absolute inset-0 z-30 bg-zinc-950/60 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-3 pointer-events-none group-hover:pointer-events-auto">
          {onForceMute && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onForceMute();
              }}
              className="p-2.5 rounded-full bg-rose-600/90 hover:bg-rose-500 text-white shadow-xl border border-rose-400/50 transition-all hover:scale-110 active:scale-95 cursor-pointer"
              title={`Mute ${name}`}
            >
              <MicOff className="w-4 h-4" />
            </button>
          )}

          {onExpel && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onExpel();
              }}
              className="p-2.5 rounded-full bg-red-700/90 hover:bg-red-600 text-white shadow-xl border border-red-500/50 transition-all hover:scale-110 active:scale-95 cursor-pointer"
              title={`Expel ${name}`}
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
