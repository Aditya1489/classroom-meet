import React, { useState, useEffect } from "react";
import {
  Download,
  Youtube,
  Radio,
  X,
  ExternalLink,
  Copy,
  Settings,
  Sparkles,
  Edit3,
  Check,
  AlertTriangle,
  Activity,
} from "lucide-react";
import { toast } from "sonner";
import {
  getConnectedYouTubeChannel,
  isValidYouTubeWatchUrl,
  ConnectedChannelInfo,
} from "../../utils/youtubeUtils";
import { StreamStats } from "../../services/youtubeService";
import { YouTubeConnectModal } from "../youtube/YouTubeConnectModal";

interface RecordingModalProps {
  isOpen: boolean;
  onClose: () => void;
  isRecording: boolean;
  onStartLocalRecording: () => void;
  onStopLocalRecording: () => void;
  recordingSeconds: number;

  // YouTube Live props
  meetingCode: string;
  isLiveStreaming: boolean;
  isLiveConnecting?: boolean;
  onStartYouTubeLive: () => void;
  onStopYouTubeLive: () => void;
  liveStreamSeconds: number;
  liveStreamUrl?: string;
  streamStats?: StreamStats | null;
  onSessionWatchUrlChange?: (url: string) => void;
}

export const RecordingModal: React.FC<RecordingModalProps> = ({
  isOpen,
  onClose,
  isRecording,
  onStartLocalRecording,
  onStopLocalRecording,
  recordingSeconds,
  meetingCode,
  isLiveStreaming,
  isLiveConnecting = false,
  onStartYouTubeLive,
  onStopYouTubeLive,
  liveStreamSeconds,
  liveStreamUrl,
  streamStats,
  onSessionWatchUrlChange,
}) => {
  const [activeTab, setActiveTab] = useState<"youtube" | "local">("youtube");
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [connectedChannel, setConnectedChannel] = useState<ConnectedChannelInfo | null>(null);

  // Session-only custom watch URL (B8: in React state for this session only, never persisted)
  const [sessionWatchUrl, setSessionWatchUrl] = useState("");
  const [isEditingWatchUrl, setIsEditingWatchUrl] = useState(false);
  const [customWatchInput, setCustomWatchInput] = useState("");

  // 30-second delay timer for YouTube ingestion warmup (B8)
  const [secondsSinceActive, setSecondsSinceActive] = useState(0);

  useEffect(() => {
    if (isOpen) {
      const channel = getConnectedYouTubeChannel();
      setConnectedChannel(channel);
    }
  }, [isOpen]);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isLiveStreaming) {
      interval = setInterval(() => {
        setSecondsSinceActive((prev) => prev + 1);
      }, 1000);
    } else {
      setSecondsSinceActive(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isLiveStreaming]);

  if (!isOpen) return null;

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Determine effective watch URL: sessionWatchUrl takes precedence over default /live (B8)
  const effectiveWatchUrl =
    sessionWatchUrl ||
    liveStreamUrl ||
    connectedChannel?.liveUrl ||
    "https://studio.youtube.com/channel/live";

  const copyLiveLink = () => {
    navigator.clipboard.writeText(effectiveWatchUrl);
    toast.success("Watch link copied to clipboard!");
  };

  const handleSaveCustomWatchUrl = () => {
    const trimmed = customWatchInput.trim();
    if (!trimmed) {
      setSessionWatchUrl("");
      onSessionWatchUrlChange?.("");
      setIsEditingWatchUrl(false);
      return;
    }

    if (!isValidYouTubeWatchUrl(trimmed)) {
      toast.error("Invalid URL. Enter https://www.youtube.com/watch?v=... or https://youtu.be/...");
      return;
    }

    setSessionWatchUrl(trimmed);
    onSessionWatchUrlChange?.(trimmed);
    setIsEditingWatchUrl(false);
    toast.success("Custom watch link set for this live session!");
  };

  // Speed Badge (B4: green ≥ 0.95, amber 0.8–0.95, red < 0.8)
  const getSpeedBadge = () => {
    if (!streamStats || streamStats.speed === undefined || !isLiveStreaming) return null;
    const speed = streamStats.speed;
    let colorClass = "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    let label = `${speed.toFixed(2)}x (Real-time)`;

    if (speed < 0.8) {
      colorClass = "bg-red-500/15 text-red-400 border-red-500/30 animate-pulse";
      label = `${speed.toFixed(2)}x (Slow)`;
    } else if (speed < 0.95) {
      colorClass = "bg-amber-500/15 text-amber-400 border-amber-500/30";
      label = `${speed.toFixed(2)}x (Slight delay)`;
    }

    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono border ${colorClass}`}
        title="YouTube is receiving video slower than real time if speed < 1.0x"
      >
        <Activity className="w-3 h-3" />
        <span>Speed: {label}</span>
      </div>
    );
  };

  const isWarmupComplete = secondsSinceActive >= 30;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
        <div className="bg-[#1a1814] border border-[#f3eee6]/15 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl text-[#f3eee6]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#f3eee6]/[0.08]">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-red-500/15 text-red-500 border border-red-500/20">
                <Youtube className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-serif text-2xl font-normal text-[#f3eee6]">Broadcast & Recording</h2>
                <p className="text-[11px] text-[#a39e94]">Go Live to YouTube or capture local HD video</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-[#a39e94] hover:text-[#f3eee6] rounded-full hover:bg-white/5 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tab switcher */}
          <div className="flex border-b border-[#f3eee6]/[0.08] bg-[#16130f] px-6 pt-2 gap-4">
            <button
              onClick={() => setActiveTab("youtube")}
              className={`pb-2.5 text-xs font-semibold font-mono uppercase tracking-wider transition border-b-2 flex items-center gap-1.5 ${
                activeTab === "youtube"
                  ? "border-[#f59e0b] text-[#f59e0b]"
                  : "border-transparent text-[#a39e94] hover:text-[#f3eee6]"
              }`}
            >
              <Youtube className="w-4 h-4 text-red-500" />
              Go Live on YouTube
              {isLiveStreaming && (
                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping ml-1" />
              )}
            </button>
            <button
              onClick={() => setActiveTab("local")}
              className={`pb-2.5 text-xs font-semibold font-mono uppercase tracking-wider transition border-b-2 flex items-center gap-1.5 ${
                activeTab === "local"
                  ? "border-[#f59e0b] text-[#f59e0b]"
                  : "border-transparent text-[#a39e94] hover:text-[#f3eee6]"
              }`}
            >
              <Download className="w-4 h-4" />
              Local HD Recording
              {isRecording && (
                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping ml-1" />
              )}
            </button>
          </div>

          {/* Body */}
          <div className="p-6">
            {activeTab === "youtube" ? (
              <div className="space-y-4">
                {/* Personal Channel Info Card */}
                <div className="bg-[#0e0d0b] border border-[#f3eee6]/10 rounded-xl p-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-red-600/20 text-red-500 flex items-center justify-center shrink-0">
                      <Radio className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-semibold text-[#f3eee6] block truncate">
                        {connectedChannel ? (connectedChannel.channelTitle || "Personal YouTube Channel") : "No Channel Connected"}
                      </span>
                      <span className="text-[11px] font-mono text-[#f59e0b] block truncate">
                        {connectedChannel ? connectedChannel.channelHandle : "Connect channel to go live"}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => setShowConnectModal(true)}
                    className="flex items-center gap-1 text-[11px] font-mono text-[#f59e0b] hover:underline px-2.5 py-1.5 rounded bg-[#f59e0b]/10 border border-[#f59e0b]/20 shrink-0"
                  >
                    <Settings className="w-3 h-3" />
                    {connectedChannel ? "Settings" : "Connect"}
                  </button>
                </div>

                {isLiveConnecting ? (
                  /* Connecting State (B4) */
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-6 text-center space-y-3">
                    <div className="flex items-center justify-center gap-2 text-[#f59e0b] font-mono text-base font-bold animate-pulse">
                      <span className="w-3 h-3 rounded-full bg-[#f59e0b] animate-ping" />
                      <span>Connecting to YouTube…</span>
                    </div>
                    <p className="text-xs text-[#a39e94]">
                      Initializing media pipeline and contacting YouTube RTMP encoder on server...
                    </p>
                  </div>
                ) : isLiveStreaming ? (
                  /* Active Live Broadcast Card (B4, B8) */
                  <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-5 space-y-3.5 text-center">
                    <div className="flex items-center justify-center gap-2 text-red-400 font-mono text-xl font-bold">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                      <span>LIVE 🔴 {formatTimer(liveStreamSeconds)}</span>
                    </div>

                    {/* Speed Badge (B4) */}
                    {getSpeedBadge()}

                    <p className="text-xs text-[#f3eee6]">
                      Streaming classroom screen, whiteboard, and audio live to your YouTube channel!
                    </p>

                    {/* Effective Watch Link Bar */}
                    <div className="flex items-center gap-2 bg-[#0e0d0b] p-2 rounded-xl border border-white/10 text-xs">
                      <span className="flex-1 font-mono text-[11px] text-[#f59e0b] truncate select-all">
                        {effectiveWatchUrl}
                      </span>
                      <button
                        onClick={copyLiveLink}
                        className="p-1.5 text-[#f59e0b] hover:text-white rounded transition"
                        title="Copy Live Link"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          setCustomWatchInput(sessionWatchUrl);
                          setIsEditingWatchUrl(!isEditingWatchUrl);
                        }}
                        className="p-1.5 text-[#a39e94] hover:text-[#f59e0b] rounded transition"
                        title="Paste this stream's watch link"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Session-only custom watch URL input (B8) */}
                    {isEditingWatchUrl && (
                      <div className="bg-[#0e0d0b] p-3 rounded-xl border border-[#f59e0b]/30 text-left space-y-2">
                        <label className="text-[11px] font-mono text-[#f59e0b] block font-semibold">
                          Paste this stream's watch link (optional):
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={customWatchInput}
                            onChange={(e) => setCustomWatchInput(e.target.value)}
                            placeholder="https://www.youtube.com/watch?v=..."
                            className="flex-1 bg-[#16130f] border border-[#f3eee6]/15 rounded-lg px-2.5 py-1.5 text-xs text-[#f3eee6] font-mono focus:outline-none focus:border-[#f59e0b]"
                          />
                          <button
                            onClick={handleSaveCustomWatchUrl}
                            className="px-3 py-1.5 bg-[#f59e0b] text-[#0e0d0b] rounded-lg text-xs font-bold flex items-center gap-1"
                          >
                            <Check className="w-3 h-3" />
                            Set
                          </button>
                        </div>
                        <p className="text-[10px] text-[#a39e94]">
                          Saved for this session only. Replaces the default channel /live link.
                        </p>
                      </div>
                    )}

                    {/* YouTube Studio Live Status Tip (B8) */}
                    <div className="p-3 rounded-xl bg-[#0e0d0b] border border-[#f59e0b]/25 text-left text-[11px] space-y-1">
                      <div className="flex items-center gap-1.5 font-semibold text-[#f59e0b]">
                        <Sparkles className="w-3.5 h-3.5 shrink-0" />
                        <span>Channel Live Page Notice:</span>
                      </div>
                      <p className="text-[#a39e94] leading-relaxed">
                        Opens your channel's live page. If you see your channel instead of the video, wait a minute and make sure the stream is <strong>Public</strong> and <strong>Auto-start is on</strong> in YouTube Studio.
                      </p>
                    </div>

                    {/* Action buttons: Watch on YouTube & Studio (B8) */}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      {/* Open YouTube Studio button */}
                      <a
                        href="https://studio.youtube.com/channel/UC/livestreaming"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-1.5 py-2.5 bg-[#221f1a] hover:bg-[#28251f] border border-[#f3eee6]/15 rounded-xl text-xs font-semibold text-[#f3eee6] transition"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-[#f59e0b]" />
                        Open Studio ↗
                      </a>

                      {/* Watch on YouTube button (disabled until active + 30s warmup or open anyway) */}
                      <div className="flex flex-col gap-1">
                        <button
                          onClick={() => window.open(effectiveWatchUrl, "_blank")}
                          disabled={!isWarmupComplete}
                          className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold transition ${
                            isWarmupComplete
                              ? "bg-red-600 hover:bg-red-500 text-white"
                              : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                          }`}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          {isWarmupComplete
                            ? "Watch on YouTube ↗"
                            : `Starting… (${Math.max(0, 30 - secondsSinceActive)}s)`}
                        </button>
                        {!isWarmupComplete && (
                          <button
                            onClick={() => window.open(effectiveWatchUrl, "_blank")}
                            className="text-[10px] text-[#f59e0b] hover:underline"
                          >
                            Open anyway
                          </button>
                        )}
                      </div>
                    </div>

                    {/* End Stream button */}
                    <button
                      onClick={onStopYouTubeLive}
                      className="w-full py-2.5 bg-[#dc2626] hover:bg-[#b91c1c] text-white font-bold text-xs rounded-xl transition shadow-lg mt-2"
                    >
                      End YouTube Stream
                    </button>
                  </div>
                ) : (
                  /* Idle Start Card */
                  <div className="space-y-3">
                    <div className="p-4 rounded-xl bg-[#0e0d0b] border border-[#f3eee6]/10 text-xs text-[#a39e94] space-y-2">
                      <p className="font-semibold text-[#f3eee6]">Before you stream:</p>
                      <ul className="list-disc list-inside space-y-1 text-[11px]">
                        <li>Connect your YouTube Stream Key in <strong>Settings</strong></li>
                        <li>Turn on <strong>Auto-start</strong> in YouTube Studio</li>
                        <li>Ensure you share your entire screen or classroom tab with audio</li>
                      </ul>
                    </div>

                    <button
                      onClick={onStartYouTubeLive}
                      disabled={!connectedChannel?.streamKey}
                      className={`w-full py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition ${
                        connectedChannel?.streamKey
                          ? "bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20"
                          : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                      }`}
                    >
                      <Radio className="w-4 h-4" />
                      Start YouTube Live Stream
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* Local Recording Tab */
              <div className="space-y-4">
                <div className="bg-[#0e0d0b] border border-[#f3eee6]/10 rounded-xl p-4 text-center space-y-3">
                  <p className="text-xs text-[#a39e94]">
                    Record high-definition video and audio locally to your browser and download directly when finished.
                  </p>

                  {isRecording ? (
                    <div className="space-y-3">
                      <div className="text-xl font-mono font-bold text-red-500 flex items-center justify-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                        <span>REC {formatTimer(recordingSeconds)}</span>
                      </div>
                      <button
                        onClick={onStopLocalRecording}
                        className="w-full py-2.5 bg-[#dc2626] hover:bg-[#b91c1c] text-white font-bold text-xs rounded-xl transition"
                      >
                        Stop & Save Recording
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={onStartLocalRecording}
                      className="w-full py-3 bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold text-xs rounded-xl transition shadow-lg"
                    >
                      Start HD Recording
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <YouTubeConnectModal
        open={showConnectModal}
        onOpenChange={setShowConnectModal}
        onChannelUpdated={setConnectedChannel}
      />
    </>
  );
};
