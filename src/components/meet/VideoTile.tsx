import React, { useState, useRef, useEffect } from "react";
import { Mic, MicOff, Pin, PinOff, Hand, Shield, LogOut, VideoOff, MoreVertical } from "lucide-react";
import { GoogleMeetAudioVisualizer } from "./GoogleMeetAudioVisualizer";
import { VideoTrackPlayer } from "./VideoTrackPlayer";

interface VideoTileProps {
  id: string;
  name: string;
  avatarUrl?: string;
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
  isMicRequested?: boolean;
  onApproveMic?: () => void;
  onDenyMic?: () => void;
  onTogglePin?: () => void;
  onLowerHand?: () => void;
  onForceMute?: () => void;
  onExpel?: () => void;
  className?: string;
}

export const VideoTile: React.FC<VideoTileProps> = ({
  id,
  name,
  avatarUrl,
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
  isMicRequested = false,
  onApproveMic,
  onDenyMic,
  onTogglePin,
  onLowerHand,
  onForceMute,
  onExpel,
  className = "",
}) => {
  const [showTouchMenu, setShowTouchMenu] = useState(false);
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
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={name}
              className="w-20 h-20 md:w-24 md:h-24 rounded-full object-cover shadow-xl border-2 border-[#f59e0b]/40"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-gradient-to-tr from-[#f59e0b] to-[#d97706] text-[#0e0d0b] flex items-center justify-center text-2xl md:text-3xl font-bold shadow-xl border border-white/20">
              {name.charAt(0).toUpperCase()}
            </div>
          )}
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

      {/* Top right badges: Speaking Request, Raised Hand & Pin */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5 z-20">
        {isMicRequested && isViewerHost && (
          <div className="flex items-center gap-1.5 bg-amber-500 text-zinc-950 px-2 py-0.5 rounded-full text-[10px] font-bold shadow-lg animate-pulse border border-amber-300">
            <Mic className="w-3 h-3" />
            <span>Wants to speak</span>
            {onApproveMic && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onApproveMic();
                }}
                className="bg-emerald-700 hover:bg-emerald-600 text-white text-[9px] px-1.5 py-0.5 rounded font-semibold transition cursor-pointer"
                title="Allow Speaking"
              >
                Allow
              </button>
            )}
            {onDenyMic && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDenyMic();
                }}
                className="bg-zinc-900 hover:bg-zinc-800 text-white text-[9px] px-1.5 py-0.5 rounded font-semibold transition cursor-pointer"
                title="Decline"
              >
                ✕
              </button>
            )}
          </div>
        )}

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
            className={`p-1.5 rounded-full transition cursor-pointer ${
              isPinned
                ? "bg-[#f59e0b] text-[#0e0d0b]"
                : "opacity-80 md:opacity-0 md:group-hover:opacity-100 bg-black/60 hover:bg-black/90 text-white border border-white/10 backdrop-blur-sm"
            }`}
          >
            {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
          </button>
        )}

        {/* Mobile / Touch 3-Dot Moderation Menu for Tutors */}
        {isViewerHost && !isHost && !isLocal && (
          <div className="relative md:hidden">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowTouchMenu(!showTouchMenu);
              }}
              title="Student options"
              className="p-1.5 rounded-full bg-black/60 hover:bg-black/90 text-white border border-white/10 backdrop-blur-sm transition cursor-pointer"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>

            {showTouchMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowTouchMenu(false);
                  }}
                />
                <div className="absolute right-0 top-8 w-36 bg-[#1a1814] border border-[#f3eee6]/15 rounded-xl shadow-2xl p-1 z-50 space-y-0.5 text-left backdrop-blur-xl">
                  {onTogglePin && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePin();
                        setShowTouchMenu(false);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#f3eee6] hover:bg-white/10 cursor-pointer"
                    >
                      <Pin className="w-3.5 h-3.5 text-[#f59e0b]" />
                      {isPinned ? "Unpin" : "Pin Tile"}
                    </button>
                  )}
                  {onForceMute && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onForceMute();
                        setShowTouchMenu(false);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-300 hover:bg-rose-500/20 cursor-pointer"
                    >
                      <MicOff className="w-3.5 h-3.5" />
                      Mute Audio
                    </button>
                  )}
                  {onExpel && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onExpel();
                        setShowTouchMenu(false);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-red-400 hover:bg-red-500/20 cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Expel Student
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Host Hover Action Overlay for Desktop Mouse Users */}
      {isViewerHost && !isHost && !isLocal && (
        <div className="hidden md:flex absolute inset-0 z-30 bg-zinc-950/60 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200 items-center justify-center gap-3 pointer-events-none group-hover:pointer-events-auto">
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
