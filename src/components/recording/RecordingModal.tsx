import React, { useState, useEffect } from "react";
import {
  Disc,
  Square,
  Download,
  Youtube,
  Radio,
  X,
  ExternalLink,
  Copy,
  Settings,
  CheckCircle2,
  Clock,
  Sparkles,
  ShieldAlert,
  Edit3,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import {
  getConnectedYouTubeChannel,
  saveConnectedYouTubeChannel,
  normalizeYouTubeUrl,
  ConnectedChannelInfo,
  DEFAULT_MATHSY_CHANNEL_LIVE_URL,
} from "../../utils/youtubeUtils";
import { resolveChannelLiveVideoUrl } from "../../services/youtubeService";
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
  onStartYouTubeLive: (mode?: "mathsy" | "personal") => void;
  onStopYouTubeLive: () => void;
  liveStreamSeconds: number;
  liveStreamUrl?: string;
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
  onStartYouTubeLive,
  onStopYouTubeLive,
  liveStreamSeconds,
  liveStreamUrl,
}) => {
  const [activeTab, setActiveTab] = useState<"youtube" | "local">("youtube");
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [connectedChannel, setConnectedChannel] = useState<ConnectedChannelInfo | null>(null);

  useEffect(() => {
    if (isOpen) {
      const channel = getConnectedYouTubeChannel();
      setConnectedChannel(channel);

      // If channel is connected but link is a channel /live link instead of /watch?v=, auto-resolve in background
      if (
        channel?.channelHandle &&
        channel.channelHandle !== "@Mathsy" &&
        (!channel.videoUrl || !channel.liveUrl?.includes("/watch?v="))
      ) {
        resolveChannelLiveVideoUrl(channel.channelHandle).then((directWatchUrl) => {
          if (directWatchUrl) {
            const updated: ConnectedChannelInfo = {
              ...channel,
              liveUrl: directWatchUrl,
              videoUrl: directWatchUrl,
            };
            saveConnectedYouTubeChannel(updated);
            setConnectedChannel(updated);
            window.dispatchEvent(
              new CustomEvent("mathsy-update-live-url", { detail: directWatchUrl })
            );
          }
        });
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const copyLiveLink = () => {
    const targetUrl = liveStreamUrl || connectedChannel?.liveUrl || `${window.location.origin}/meet/${meetingCode}`;
    navigator.clipboard.writeText(targetUrl);
    toast.success("YouTube Live Link copied to clipboard!");
  };

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
                      <Radio className="w-4 h-4 animate-pulse" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-semibold text-[#f3eee6] block truncate">
                        {connectedChannel ? (connectedChannel.channelTitle || "Personal YouTube Channel") : "No Channel Connected"}
                      </span>
                      <span className="text-[11px] font-mono text-[#f59e0b] block truncate">
                        {connectedChannel ? connectedChannel.channelHandle : "Connect your YouTube channel to go live"}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => setShowConnectModal(true)}
                    className="flex items-center gap-1 text-[11px] font-mono text-[#f59e0b] hover:underline px-2.5 py-1.5 rounded bg-[#f59e0b]/10 border border-[#f59e0b]/20 shrink-0"
                  >
                    <Settings className="w-3 h-3" />
                    {connectedChannel ? "Settings" : "Connect Channel"}
                  </button>
                </div>

                {isLiveStreaming ? (
                  /* Active Live Broadcast Card */
                  <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-5 space-y-3.5 text-center">
                    <div className="flex items-center justify-center gap-2 text-red-400 font-mono text-xl font-bold">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                      <span>LIVE 🔴 {formatTimer(liveStreamSeconds)}</span>
                    </div>

                    <p className="text-xs text-[#f3eee6]">
                      Streaming classroom screen, whiteboard, and audio live to your YouTube channel!
                    </p>

                    <div className="flex items-center gap-2 bg-[#0e0d0b] p-2 rounded-xl border border-white/10 text-xs">
                      <span className="flex-1 font-mono text-[11px] text-[#f59e0b] truncate select-all">
                        {liveStreamUrl || connectedChannel?.liveUrl || "https://youtube.com/live"}
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
                          const input = window.prompt(
                            "Enter your direct YouTube Live Video Watch Link or Video ID:\n\n(Find in YouTube Studio -> Share ↗)\n\nExample: https://youtu.be/cNyhzfzQD4E or cNyhzfzQD4E",
                            liveStreamUrl || connectedChannel?.videoUrl || ""
                          );
                          if (input && input.trim()) {
                            const normalized = normalizeYouTubeUrl(input.trim());
                            if (connectedChannel) {
                              const updated: ConnectedChannelInfo = {
                                ...connectedChannel,
                                liveUrl: normalized,
                                videoUrl: normalized,
                              };
                              saveConnectedYouTubeChannel(updated);
                              setConnectedChannel(updated);
                            }
                            window.dispatchEvent(
                              new CustomEvent("mathsy-update-live-url", { detail: normalized })
                            );
                            toast.success("Live Video Watch link updated to direct player! 🎯");
                          }
                        }}
                        className="p-1.5 text-[#a39e94] hover:text-[#f59e0b] rounded transition"
                        title="Set Direct Video Player URL (/watch?v=...)"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={async () => {
                          if (!connectedChannel?.channelHandle) {
                            toast.error("No channel connected");
                            return;
                          }
                          toast.loading("Detecting latest live video link...", { id: "detect-yt" });
                          const directUrl = await resolveChannelLiveVideoUrl(connectedChannel.channelHandle);
                          if (directUrl) {
                            const updated = {
                              ...connectedChannel,
                              liveUrl: directUrl,
                              videoUrl: directUrl,
                            };
                            saveConnectedYouTubeChannel(updated);
                            setConnectedChannel(updated);
                            window.dispatchEvent(
                              new CustomEvent("mathsy-update-live-url", { detail: directUrl })
                            );
                            toast.success("Live Video Link auto-detected! 🎯", { id: "detect-yt" });
                          } else {
                            toast.info("No active broadcast detected yet. Please ensure you are live in YouTube Studio.", { id: "detect-yt" });
                          }
                        }}
                        className="p-1.5 text-[#a39e94] hover:text-[#f59e0b] rounded transition"
                        title="Auto-detect Live Video Link from YouTube (Refresh 🔄)"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* YouTube Studio Live Status Tip */}
                    <div className="p-3 rounded-xl bg-[#0e0d0b] border border-[#f59e0b]/25 text-left text-[11px] space-y-1">
                      <div className="flex items-center gap-1.5 font-semibold text-[#f59e0b]">
                        <Sparkles className="w-3.5 h-3.5 shrink-0" />
                        <span>Publish to Viewers:</span>
                      </div>
                      <p className="text-[#a39e94] leading-relaxed">
                        In <a href="https://studio.youtube.com/channel/live" target="_blank" rel="noopener noreferrer" className="text-[#f59e0b] underline font-semibold">YouTube Studio</a>, click <strong className="text-white">Go Live</strong> (or enable <strong className="text-white">Auto-start</strong>) so YouTube shows your stream to viewers!
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <a
                        href="https://studio.youtube.com/channel/live"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-1.5 py-2.5 bg-[#221f1a] hover:bg-[#28251f] border border-[#f3eee6]/15 rounded-xl text-xs font-semibold text-[#f3eee6] transition"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-[#f59e0b]" />
                        Open Studio ↗
                      </a>
                      <a
                        href={liveStreamUrl || connectedChannel?.liveUrl || "https://studio.youtube.com"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-1.5 py-2.5 bg-[#221f1a] hover:bg-[#28251f] border border-[#f3eee6]/15 rounded-xl text-xs font-semibold text-[#f3eee6] transition"
                      >
                        <Radio className="w-3.5 h-3.5 text-red-500" />
                        Watch Live ↗
                      </a>
                    </div>

                    <button
                      onClick={onStopYouTubeLive}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 bg-[#dc2626] hover:bg-[#b91c1c] rounded-xl text-xs font-bold text-white transition shadow-lg mt-1"
                    >
                      <Square className="w-3.5 h-3.5 fill-white" />
                      End Stream
                    </button>
                  </div>
                ) : (
                  /* Idle Ready State */
                  <div className="space-y-4">
                    <div className="p-3.5 rounded-xl bg-[#0e0d0b] border border-[#f3eee6]/10 text-xs text-[#a39e94] space-y-1.5">
                      <p className="font-semibold text-[#f3eee6]">YouTube Live Classroom Broadcasting:</p>
                      <p>• Streams whiteboard, screen share, and crystal-clear microphone audio.</p>
                      <p>• Ultra-low latency RTMP delivery straight to your YouTube audience.</p>
                    </div>

                    {connectedChannel?.streamKey ? (
                      <div className="space-y-3">
                        <button
                          onClick={() => onStartYouTubeLive("personal")}
                          className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-500 hover:to-amber-500 text-white font-bold py-3.5 rounded-xl transition shadow-lg shadow-red-600/25 text-xs group cursor-pointer"
                        >
                          <Radio className="w-4 h-4 animate-pulse text-white" />
                          <span>Go Live to {connectedChannel.channelTitle && connectedChannel.channelTitle !== "Personal YouTube Channel" ? connectedChannel.channelTitle : (connectedChannel.channelHandle || "Your Channel")} 🔴</span>
                        </button>

                        <div className="p-3 bg-[#0e0d0b] border border-amber-500/20 rounded-xl text-left space-y-1">
                          <div className="flex items-center gap-1.5 text-[#f59e0b] font-medium text-[11px]">
                            <span>💡 Auto-Publish Setting:</span>
                          </div>
                          <p className="text-[10px] text-[#a39e94] leading-relaxed">
                            In <a href="https://studio.youtube.com/channel/live" target="_blank" rel="noopener noreferrer" className="text-[#f59e0b] underline">YouTube Studio</a>, toggle <strong>"Enable Auto-start"</strong> to <strong>ON</strong>. YouTube will then automatically show your live stream to viewers without any preview delay!
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <button
                          onClick={() => setShowConnectModal(true)}
                          className="w-full flex items-center justify-center gap-2 bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold py-3.5 rounded-xl transition shadow-lg text-xs cursor-pointer"
                        >
                          <Radio className="w-4 h-4" />
                          Connect Your YouTube Channel to Go Live
                        </button>
                        <p className="text-[11px] text-[#a39e94] text-center">
                          Add your channel handle and stream key to broadcast directly to your YouTube audience.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              /* Tab 2: Local HD Recording */
              <div className="space-y-4 text-center">
                {isRecording ? (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 space-y-3">
                    <div className="flex items-center justify-center gap-2 text-red-400 font-mono text-2xl font-bold">
                      <span className="w-3 h-3 rounded-full bg-red-500 animate-ping" />
                      <span>{formatTimer(recordingSeconds)}</span>
                    </div>
                    <p className="text-xs text-[#a39e94]">
                      Recording audio and shared screen/video in high definition.
                    </p>
                    <button
                      onClick={onStopLocalRecording}
                      className="w-full flex items-center justify-center gap-2 bg-[#dc2626] hover:bg-[#b91c1c] text-white font-semibold py-2.5 rounded-xl transition shadow-lg text-xs"
                    >
                      <Square className="w-4 h-4 fill-white" />
                      Stop & Download Video
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-[#0e0d0b] border border-[#f3eee6]/10 text-left text-xs text-[#a39e94] space-y-1.5">
                      <p className="font-semibold text-[#f3eee6]">How local recording works:</p>
                      <p>• Captures high-framerate video with crisp synchronized audio.</p>
                      <p>• Directly downloads to your computer when finished.</p>
                      <p>• Zero server lag and 100% private to your device.</p>
                    </div>

                    <button
                      onClick={onStartLocalRecording}
                      className="w-full flex items-center justify-center gap-2 bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold py-3 rounded-xl transition shadow-lg shadow-[#f59e0b]/20 text-xs"
                    >
                      <Disc className="w-4 h-4" />
                      Start Local Recording
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Connected Channel Modal */}
      <YouTubeConnectModal
        open={showConnectModal}
        onOpenChange={setShowConnectModal}
        onChannelUpdated={(ch) => setConnectedChannel(ch)}
      />
    </>
  );
};
