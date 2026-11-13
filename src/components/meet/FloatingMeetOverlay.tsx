import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Mic,
  MicOff,
  Video as VideoIcon,
  VideoOff,
  MessageSquare,
  StopCircle,
  X,
  Send,
  Users,
  ScreenShare,
} from "lucide-react";
import { RemoteParticipant } from "../../engine/mediasoupClient";
import { ChatMsg } from "./ClassFeedSidepanel";

interface FloatingMeetOverlayProps {
  pipWindow: Window;
  remoteParticipants: RemoteParticipant[];
  localVideoTrack: MediaStreamTrack | null;
  localAudioTrack: MediaStreamTrack | null;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  activeSpeakerId: string | null;
  myUserId: string;
  myName: string;
  chatMessages: ChatMsg[];
  onSendMessage: (text: string) => void;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onStopScreenShare: () => void;
  onClosePiP: () => void;
}

/**
 * Dedicated video tile for Document Picture-in-Picture window.
 * Ensures MediaStream track attachment, inline playback, and muted audio in PiP context.
 */
const PipVideoTile: React.FC<{
  track: MediaStreamTrack | null;
  name: string;
  isAudioMuted?: boolean;
  isVideoMuted?: boolean;
  isSpeaking?: boolean;
  isLocal?: boolean;
}> = ({ track, name, isAudioMuted = false, isVideoMuted = false, isSpeaking = false, isLocal = false }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasVideo = Boolean(track) && !isVideoMuted && track?.readyState === "live";

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !track) {
      if (el) el.srcObject = null;
      return;
    }

    el.muted = true;
    el.defaultMuted = true;
    el.playsInline = true;
    el.setAttribute("playsinline", "true");
    el.setAttribute("muted", "true");

    const stream = new MediaStream([track]);
    el.srcObject = stream;

    const playPromise = el.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        setTimeout(() => {
          if (el && el.paused) el.play().catch(() => {});
        }, 200);
      });
    }

    return () => {
      if (el) el.srcObject = null;
    };
  }, [track, hasVideo]);

  const initial = (name || "User").charAt(0).toUpperCase();

  return (
    <div
      className={`relative w-full h-full min-h-[110px] rounded-xl overflow-hidden bg-[#16130f] border transition-all duration-200 flex items-center justify-center select-none ${
        isSpeaking
          ? "border-[#f59e0b] ring-2 ring-[#f59e0b]/40 shadow-md shadow-[#f59e0b]/20"
          : "border-[#f3eee6]/10"
      }`}
    >
      {hasVideo && track ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover ${isLocal ? "-scale-x-100" : ""}`}
        />
      ) : (
        <div className="flex flex-col items-center justify-center gap-1.5 p-2">
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-amber-600 to-amber-400 text-zinc-950 font-bold flex items-center justify-center text-sm shadow-md">
            {initial}
          </div>
          {isSpeaking && (
            <div className="flex items-center gap-0.5">
              <span className="w-1 h-3 bg-amber-400 rounded-full animate-bounce" />
              <span className="w-1 h-4 bg-amber-400 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1 h-2 bg-amber-400 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          )}
        </div>
      )}

      {/* Top Right: Audio Mute status badge */}
      <div className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/60 backdrop-blur-sm">
        {isAudioMuted ? (
          <MicOff className="w-3 h-3 text-rose-400" />
        ) : isSpeaking ? (
          <Mic className="w-3 h-3 text-emerald-400 animate-pulse" />
        ) : (
          <Mic className="w-3 h-3 text-zinc-300" />
        )}
      </div>

      {/* Bottom Left: Participant Name badge */}
      <div className="absolute bottom-1.5 left-1.5 max-w-[80%] truncate px-2 py-0.5 rounded bg-black/70 backdrop-blur-sm text-[11px] font-medium text-zinc-200">
        {name} {isLocal && "(You)"}
      </div>
    </div>
  );
};

export const FloatingMeetOverlay: React.FC<FloatingMeetOverlayProps> = ({
  pipWindow,
  remoteParticipants,
  localVideoTrack,
  isAudioMuted,
  isVideoMuted,
  activeSpeakerId,
  myName,
  chatMessages,
  onSendMessage,
  onToggleMute,
  onToggleVideo,
  onStopScreenShare,
  onClosePiP,
}) => {
  const [activeTab, setActiveTab] = useState<"video" | "chat">("video");
  const [chatInput, setChatInput] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const lastSeenMsgCountRef = useRef(chatMessages.length);

  // Track unread messages when user is on the video tab
  useEffect(() => {
    if (activeTab === "chat") {
      setUnreadCount(0);
      lastSeenMsgCountRef.current = chatMessages.length;
    } else {
      const diff = chatMessages.length - lastSeenMsgCountRef.current;
      if (diff > 0) {
        setUnreadCount((prev) => prev + diff);
        lastSeenMsgCountRef.current = chatMessages.length;
      }
    }
  }, [chatMessages.length, activeTab]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (activeTab === "chat") {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages, activeTab]);

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!chatInput.trim()) return;
    onSendMessage(chatInput.trim());
    setChatInput("");
  };

  // Select top 2-3 active speakers for the mini video grid
  // Prioritize active speaker, then participants with active video, then rest
  const sortedParticipants = [...remoteParticipants].sort((a, b) => {
    if (a.id === activeSpeakerId) return -1;
    if (b.id === activeSpeakerId) return 1;
    if (a.isSpeaking && !b.isSpeaking) return -1;
    if (!a.isSpeaking && b.isSpeaking) return 1;
    if (a.videoTrack && !b.videoTrack) return -1;
    if (!a.videoTrack && b.videoTrack) return 1;
    return 0;
  });

  const displayRemote = sortedParticipants.slice(0, 2);

  const content = (
    <div
      data-testid="floating-meet-overlay"
      className="flex flex-col h-screen w-screen bg-[#0e0d0b] text-[#f3eee6] overflow-hidden font-sans select-none border border-[#f59e0b]/30"
    >
      {/* 1. TOP HEADER & TAB SWITCHER */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#16130f] border-b border-[#f3eee6]/10 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-[#f59e0b] text-[11px] font-bold font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <ScreenShare className="w-3 h-3 text-[#f59e0b]" />
            <span>SHARING</span>
          </div>
        </div>

        {/* Tab Buttons */}
        <div className="flex items-center gap-1 bg-black/40 p-0.5 rounded-lg border border-white/5">
          <button
            type="button"
            onClick={() => setActiveTab("video")}
            title="Video Grid"
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
              activeTab === "video"
                ? "bg-[#221f1a] text-[#f59e0b] shadow-xs"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Video</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("chat")}
            title="Live Chat"
            className={`relative flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
              activeTab === "chat"
                ? "bg-[#221f1a] text-[#f59e0b] shadow-xs"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Chat</span>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full bg-[#f59e0b] text-[#0e0d0b] text-[10px] font-bold font-mono shadow-xs">
                {unreadCount}
              </span>
            )}
          </button>
        </div>

        {/* Close PiP Button */}
        <button
          type="button"
          onClick={onClosePiP}
          title="Minimize floating overlay back to meeting"
          className="p-1 text-zinc-400 hover:text-white hover:bg-white/10 rounded-lg transition cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 2. MAIN CONTENT AREA */}
      <div className="flex-1 overflow-hidden relative flex flex-col">
        {activeTab === "video" ? (
          /* SECTION A: MINI VIDEO GRID */
          <div className="flex-1 p-2 grid grid-cols-1 sm:grid-cols-2 gap-2 overflow-y-auto no-scrollbar auto-rows-fr">
            {/* Local Presenter Tile */}
            <PipVideoTile
              track={localVideoTrack}
              name={myName || "Host"}
              isAudioMuted={isAudioMuted}
              isVideoMuted={isVideoMuted}
              isSpeaking={!isAudioMuted}
              isLocal={true}
            />

            {/* Remote Participant Tiles (Up to 2 active speakers) */}
            {displayRemote.length > 0 ? (
              displayRemote.map((p) => (
                <PipVideoTile
                  key={p.id}
                  track={p.videoTrack || null}
                  name={p.name}
                  isAudioMuted={p.isAudioMuted}
                  isVideoMuted={p.isVideoMuted}
                  isSpeaking={p.isSpeaking || p.id === activeSpeakerId}
                />
              ))
            ) : (
              <div className="flex flex-col items-center justify-center p-4 rounded-xl border border-dashed border-white/10 text-center">
                <Users className="w-6 h-6 text-zinc-600 mb-1" />
                <span className="text-xs text-zinc-400 font-medium">Listening for students...</span>
                <span className="text-[10px] text-zinc-500 mt-0.5">Participants will appear here when speaking</span>
              </div>
            )}
          </div>
        ) : (
          /* SECTION B: LIVE CHAT DRAWER */
          <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#12100d]">
            {/* Chat Messages Stream */}
            <div className="flex-1 overflow-y-auto p-2.5 space-y-2 no-scrollbar text-xs">
              {chatMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-zinc-500 text-center py-6">
                  <MessageSquare className="w-8 h-8 text-zinc-700 mb-2" />
                  <p className="font-medium text-xs text-zinc-400">No chat messages yet</p>
                  <p className="text-[11px] text-zinc-600">Send a quick update to your class</p>
                </div>
              ) : (
                chatMessages.map((msg) => (
                  <div
                    key={msg.id || msg.clientMessageId}
                    className="flex flex-col gap-0.5 bg-[#1a1814] p-2 rounded-xl border border-white/5"
                  >
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-semibold text-amber-400 flex items-center gap-1">
                        {msg.senderName}
                        {msg.isHost && (
                          <span className="text-[9px] px-1 rounded bg-amber-400/20 text-amber-300 font-mono font-bold">
                            Tutor
                          </span>
                        )}
                      </span>
                      <span className="text-zinc-500 font-mono text-[9px]">{msg.timestamp}</span>
                    </div>
                    <div className="text-zinc-200 leading-snug break-words mt-0.5">{msg.message}</div>
                  </div>
                ))
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Chat Input Bar */}
            <form onSubmit={handleSend} className="p-2 border-t border-white/10 bg-[#16130f] flex items-center gap-1.5 shrink-0">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Reply to class..."
                className="flex-1 bg-[#221f1a] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-400 transition"
              />
              <button
                type="submit"
                disabled={!chatInput.trim()}
                title="Send reply"
                className="p-1.5 rounded-lg bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer shrink-0 font-bold"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        )}
      </div>

      {/* 3. STICKY BOTTOM QUICK ACTION BAR */}
      <div className="px-3 py-2 bg-[#16130f] border-t border-[#f3eee6]/10 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5">
          {/* Mic Toggle */}
          <button
            type="button"
            onClick={onToggleMute}
            title={isAudioMuted ? "Unmute Mic" : "Mute Mic"}
            className={`p-2 rounded-xl border transition cursor-pointer active:scale-95 ${
              isAudioMuted
                ? "bg-rose-500/20 border-rose-500/40 text-rose-400 hover:bg-rose-500/30"
                : "bg-[#221f1a] border-white/10 text-zinc-200 hover:text-white hover:bg-white/10"
            }`}
          >
            {isAudioMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          {/* Camera Toggle */}
          <button
            type="button"
            onClick={onToggleVideo}
            title={isVideoMuted ? "Turn Camera On" : "Turn Camera Off"}
            className={`p-2 rounded-xl border transition cursor-pointer active:scale-95 ${
              isVideoMuted
                ? "bg-rose-500/20 border-rose-500/40 text-rose-400 hover:bg-rose-500/30"
                : "bg-[#221f1a] border-white/10 text-zinc-200 hover:text-white hover:bg-white/10"
            }`}
          >
            {isVideoMuted ? <VideoOff className="w-4 h-4" /> : <VideoIcon className="w-4 h-4" />}
          </button>

          {/* Chat Peek Button */}
          <button
            type="button"
            onClick={() => setActiveTab((prev) => (prev === "chat" ? "video" : "chat"))}
            title={activeTab === "chat" ? "Show Video Grid" : "Show Chat"}
            className={`relative p-2 rounded-xl border transition cursor-pointer active:scale-95 ${
              activeTab === "chat"
                ? "bg-amber-400/20 border-amber-400/40 text-amber-300"
                : "bg-[#221f1a] border-white/10 text-zinc-200 hover:text-white hover:bg-white/10"
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            {unreadCount > 0 && activeTab !== "chat" && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#f59e0b] ring-2 ring-[#16130f]" />
            )}
          </button>
        </div>

        {/* Stop Sharing Button (Red) */}
        <button
          type="button"
          onClick={() => {
            onStopScreenShare();
            onClosePiP();
          }}
          title="Stop Screen Sharing"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-500 active:scale-95 text-white text-xs font-bold rounded-xl shadow-lg shadow-rose-900/30 transition cursor-pointer"
        >
          <StopCircle className="w-3.5 h-3.5 fill-current" />
          <span>Stop Sharing</span>
        </button>
      </div>
    </div>
  );

  return createPortal(content, pipWindow.document.body);
};

