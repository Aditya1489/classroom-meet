import React, { useState } from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  MonitorOff,
  Smile,
  Hand,
  Disc,
  PhoneOff,
  MessageSquare,
  Users,
  BarChart3,
  Info,
  Sparkles,
  MoreVertical,
  Radio
} from "lucide-react";

interface MeetingControlsProps {
  isMicMuted: boolean;
  onToggleMic: () => void;
  isCamOff: boolean;
  onToggleCam: () => void;
  isScreenSharing: boolean;
  onToggleScreenShare: () => void;
  isWhiteboardOpen: boolean;
  onToggleWhiteboard: () => void;
  isHandRaised: boolean;
  onToggleHandRaise: () => void;
  onSendReaction: (emoji: string) => void;
  onOpenRecording: () => void;
  isRecording: boolean;
  isYouTubeLive?: boolean;
  isHost?: boolean;
  onLeaveCall: () => void;

  // Drawer states
  activeDrawer: "chat" | "people" | "polls" | "info" | null;
  onToggleDrawer: (drawer: "chat" | "people" | "polls" | "info") => void;
  unreadCount: number;
  participantsCount: number;
  activePollsCount: number;
}

export const MeetingControls: React.FC<MeetingControlsProps> = ({
  isMicMuted,
  onToggleMic,
  isCamOff,
  onToggleCam,
  isScreenSharing,
  onToggleScreenShare,
  isWhiteboardOpen,
  onToggleWhiteboard,
  isHandRaised,
  onToggleHandRaise,
  onSendReaction,
  onOpenRecording,
  isRecording,
  isYouTubeLive = false,
  isHost = false,
  onLeaveCall,
  activeDrawer,
  onToggleDrawer,
  unreadCount,
  participantsCount,
  activePollsCount,
}) => {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const emojis = ["❤️", "👍", "👏", "🎉", "🚀", "😂"];

  return (
    <div className="relative flex items-center justify-between px-4 py-3 bg-[#1a1814] border-t border-[#f3eee6]/[0.08] shrink-0 select-none z-30">
      {/* Left Meeting Info Pill */}
      <div className="hidden sm:flex items-center gap-2">
        <button
          onClick={() => onToggleDrawer("info")}
          className={`p-2.5 rounded-lg hover:bg-[#221f1a] text-[#a39e94] hover:text-[#f3eee6] transition ${
            activeDrawer === "info" ? "bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/30" : ""
          }`}
          title="Meeting details & link"
        >
          <Info className="w-4 h-4" />
        </button>

        {isYouTubeLive && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-600/20 text-red-400 border border-red-500/30 text-[10px] font-mono font-bold animate-pulse">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
            <span>LIVE 🔴</span>
          </div>
        )}

        {isRecording && !isYouTubeLive && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/15 text-red-400 border border-red-500/30 text-[10px] font-mono font-bold">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
            <span>REC</span>
          </div>
        )}
      </div>

      {/* Center Primary Meeting Control Buttons */}
      <div className="flex items-center gap-2 md:gap-3 mx-auto">
        {/* Mic toggle */}
        <button
          onClick={onToggleMic}
          className={`p-3 md:p-3.5 rounded-xl transition shadow-md ${
            isMicMuted
              ? "bg-[#dc2626] hover:bg-[#b91c1c] text-white"
              : "bg-[#221f1a] hover:bg-[#28251f] text-[#f3eee6] border border-[#f3eee6]/10"
          }`}
          title={isMicMuted ? "Turn on microphone" : "Turn off microphone"}
        >
          {isMicMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>

        {/* Cam toggle */}
        <button
          onClick={onToggleCam}
          className={`p-3 md:p-3.5 rounded-xl transition shadow-md ${
            isCamOff
              ? "bg-[#dc2626] hover:bg-[#b91c1c] text-white"
              : "bg-[#221f1a] hover:bg-[#28251f] text-[#f3eee6] border border-[#f3eee6]/10"
          }`}
          title={isCamOff ? "Turn on camera" : "Turn off camera"}
        >
          {isCamOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
        </button>

        {/* Reactions button */}
        <div className="relative">
          <button
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className={`p-3 md:p-3.5 rounded-xl transition ${
              showEmojiPicker
                ? "bg-[#f59e0b] text-[#0e0d0b]"
                : "bg-[#221f1a] hover:bg-[#28251f] text-[#f3eee6] border border-[#f3eee6]/10"
            }`}
            title="Send reaction"
          >
            <Smile className="w-4 h-4" />
          </button>

          {/* Quick Floating Emoji Picker Popover */}
          {showEmojiPicker && (
            <div className="absolute bottom-16 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-[#1a1814] p-2 rounded-2xl border border-[#f3eee6]/15 shadow-2xl z-50">
              {emojis.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => {
                    onSendReaction(emoji);
                    setShowEmojiPicker(false);
                  }}
                  className="p-1.5 text-2xl hover:scale-125 transition-transform"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Screen Share toggle */}
        <button
          onClick={onToggleScreenShare}
          className={`p-3 md:p-3.5 rounded-xl transition ${
            isScreenSharing
              ? "bg-[#f59e0b] text-[#0e0d0b] font-bold shadow-md shadow-[#f59e0b]/20"
              : "bg-[#221f1a] hover:bg-[#28251f] text-[#f3eee6] border border-[#f3eee6]/10"
          }`}
          title={isScreenSharing ? "Stop presenting" : "Present screen"}
        >
          {isScreenSharing ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
        </button>

        {/* Whiteboard toggle */}
        <button
          onClick={onToggleWhiteboard}
          className={`p-3 md:p-3.5 rounded-xl transition ${
            isWhiteboardOpen
              ? "bg-[#f59e0b] text-[#0e0d0b] font-bold shadow-md shadow-[#f59e0b]/20"
              : "bg-[#221f1a] hover:bg-[#28251f] text-[#f3eee6] border border-[#f3eee6]/10"
          }`}
          title={isWhiteboardOpen ? "Hide Whiteboard" : "Open Math Whiteboard"}
        >
          <Sparkles className={`w-4 h-4 ${isWhiteboardOpen ? "text-[#0e0d0b]" : "text-[#f59e0b]"}`} />
        </button>

        {/* Raise Hand */}
        <button
          onClick={onToggleHandRaise}
          className={`p-3 md:p-3.5 rounded-xl transition ${
            isHandRaised
              ? "bg-[#f59e0b] text-[#0e0d0b] font-bold shadow-md shadow-[#f59e0b]/20"
              : "bg-[#221f1a] hover:bg-[#28251f] text-[#f3eee6] border border-[#f3eee6]/10"
          }`}
          title={isHandRaised ? "Lower hand" : "Raise hand"}
        >
          <Hand className="w-4 h-4" />
        </button>

        {/* Recording & YouTube Live Modal Button (Tutors only - B9) */}
        {isHost && (
          <button
            onClick={onOpenRecording}
            className={`p-3 md:p-3.5 rounded-xl transition ${
              isYouTubeLive
                ? "bg-red-600/20 text-red-500 border border-red-500/40 animate-pulse shadow-lg shadow-red-500/10"
                : isRecording
                ? "bg-red-500/20 text-red-400 border border-red-500/40"
                : "bg-[#221f1a] hover:bg-[#28251f] text-[#f3eee6] border border-[#f3eee6]/10"
            }`}
            title={isYouTubeLive ? "Live on YouTube (Manage/Stop)" : "Recording & YouTube Live"}
          >
            <Disc className={`w-4 h-4 ${isRecording || isYouTubeLive ? "animate-spin text-red-500" : ""}`} />
          </button>
        )}

        {/* End / Leave call */}
        <button
          onClick={onLeaveCall}
          className="px-5 md:px-6 py-3 rounded-xl bg-[#dc2626] hover:bg-[#b91c1c] text-white font-semibold transition shadow-lg flex items-center justify-center gap-1.5"
          title="Leave call"
        >
          <PhoneOff className="w-4 h-4" />
        </button>
      </div>

      {/* Right Drawer Toggles (People, Chat, Activities) */}
      <div className="flex items-center gap-1.5 md:gap-2">
        {/* People Button */}
        <button
          onClick={() => onToggleDrawer("people")}
          className={`relative p-2.5 rounded-lg hover:bg-[#221f1a] text-[#a39e94] hover:text-[#f3eee6] transition ${
            activeDrawer === "people" ? "bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/30" : ""
          }`}
          title="Participants"
        >
          <Users className="w-4 h-4" />
          <span className="absolute -top-1 -right-1 bg-[#f59e0b] text-[#0e0d0b] text-[10px] font-bold px-1.5 py-0.2 rounded-full font-mono">
            {participantsCount}
          </span>
        </button>

        {/* Chat Button */}
        <button
          onClick={() => onToggleDrawer("chat")}
          className={`relative p-2.5 rounded-lg hover:bg-[#221f1a] text-[#a39e94] hover:text-[#f3eee6] transition ${
            activeDrawer === "chat" ? "bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/30" : ""
          }`}
          title="Chat"
        >
          <MessageSquare className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-[#dc2626] text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full animate-pulse font-mono">
              {unreadCount}
            </span>
          )}
        </button>

        {/* Polls & Activities Button */}
        <button
          onClick={() => onToggleDrawer("polls")}
          className={`relative p-2.5 rounded-lg hover:bg-[#221f1a] text-[#a39e94] hover:text-[#f3eee6] transition ${
            activeDrawer === "polls" ? "bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/30" : ""
          }`}
          title="Quizzes & Polls"
        >
          <BarChart3 className="w-4 h-4" />
          {activePollsCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-emerald-500 text-[#0e0d0b] text-[10px] font-bold px-1.5 py-0.2 rounded-full font-mono">
              {activePollsCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );
};
