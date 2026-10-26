import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { Button } from "../ui/button";
import {
  Youtube,
  Radio,
  CheckCircle2,
  Eye,
  EyeOff,
  Trash2,
  HelpCircle,
  Sparkles,
} from "lucide-react";
import {
  getConnectedYouTubeChannel,
  saveConnectedYouTubeChannel,
  disconnectYouTubeChannel,
  normalizeYouTubeChannelLiveUrl,
  ConnectedChannelInfo,
} from "../../utils/youtubeUtils";
import { toast } from "sonner";

interface YouTubeConnectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChannelUpdated?: (channel: ConnectedChannelInfo | null) => void;
}

export const YouTubeConnectModal: React.FC<YouTubeConnectModalProps> = ({
  open,
  onOpenChange,
  onChannelUpdated,
}) => {
  const [channel, setChannel] = useState<ConnectedChannelInfo | null>(null);
  const [channelHandle, setChannelHandle] = useState("");
  const [channelTitle, setChannelTitle] = useState("");
  const [streamKey, setStreamKey] = useState("");
  const [defaultVisibility, setDefaultVisibility] = useState<"public" | "unlisted">("public");
  const [showKey, setShowKey] = useState(false);
  const [showInstructions, setShowInstructions] = useState(true);

  useEffect(() => {
    if (open) {
      const existing = getConnectedYouTubeChannel();
      setChannel(existing);
      if (existing) {
        setChannelHandle(existing.channelHandle);
        setChannelTitle(existing.channelTitle);
        setStreamKey(existing.streamKey);
        setDefaultVisibility(existing.defaultVisibility);
      } else {
        setChannelHandle("");
        setChannelTitle("");
        setStreamKey("");
        setDefaultVisibility("public");
      }
    }
  }, [open]);

  const handleSave = () => {
    if (!streamKey.trim()) {
      toast.error("Please enter your YouTube RTMP Stream Key");
      return;
    }

    let cleanHandle = channelHandle.trim();
    if (cleanHandle.includes("youtube.com/@")) {
      const match = cleanHandle.match(/@([a-zA-Z0-9_.-]+)/);
      if (match) cleanHandle = `@${match[1]}`;
    }

    const liveUrl = normalizeYouTubeChannelLiveUrl(cleanHandle) || "https://studio.youtube.com/channel/live";

    const updated: ConnectedChannelInfo = {
      channelHandle: cleanHandle || "@MyChannel",
      channelTitle: channelTitle.trim() || cleanHandle || "My YouTube Channel",
      streamKey: streamKey.trim(),
      defaultVisibility,
      liveUrl,
      connectedAt: Date.now(),
    };

    saveConnectedYouTubeChannel(updated);
    setChannel(updated);
    onChannelUpdated?.(updated);
    toast.success("YouTube Channel successfully connected! 🔴");
    onOpenChange(false);
  };

  const handleDisconnect = () => {
    disconnectYouTubeChannel();
    setChannel(null);
    setStreamKey("");
    onChannelUpdated?.(null);
    toast.info("YouTube Channel disconnected");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-[#1a1814] text-[#f3eee6] border border-[#f3eee6]/15 rounded-2xl p-6 shadow-2xl z-[99999]">
        <DialogHeader className="space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-red-600/15 border border-red-500/30 flex items-center justify-center text-red-500">
              <Youtube className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="font-serif text-2xl font-normal text-[#f3eee6]">
                Connect YouTube Channel
              </DialogTitle>
              <DialogDescription className="text-[#a39e94] text-xs">
                Broadcast classroom sessions directly to your YouTube channel.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Connected Channel Badge */}
        {channel ? (
          <div className="bg-[#0e0d0b] border border-[#10b981]/30 rounded-xl p-3.5 flex items-center justify-between my-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center text-white font-bold text-xs shrink-0">
                <Radio className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-xs text-[#f3eee6] truncate">
                    {channel.channelTitle || channel.channelHandle || "Personal YouTube Channel"}
                  </span>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                </div>
                <p className="font-mono text-[11px] text-[#f59e0b] truncate">
                  {channel.channelHandle}
                </p>
              </div>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleDisconnect}
              className="text-[#a39e94] hover:text-red-400 text-xs gap-1 hover:bg-white/5 h-8 px-2"
              title="Disconnect channel"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="bg-[#f59e0b]/10 border border-[#f59e0b]/20 rounded-xl p-3 flex items-center gap-2 text-xs text-[#f59e0b] my-1">
            <Sparkles className="w-4 h-4 shrink-0" />
            <span>Connect your channel once and stream every class seamlessly!</span>
          </div>
        )}

        <div className="space-y-3.5 py-2">
          {/* Channel Name */}
          <div>
            <label className="block text-[11px] font-mono font-semibold text-[#a39e94] uppercase tracking-wider mb-1">
              Channel Display Name (Optional)
            </label>
            <input
              type="text"
              value={channelTitle}
              onChange={(e) => setChannelTitle(e.target.value)}
              placeholder="e.g. My Live Teaching Channel"
              className="w-full bg-[#0e0d0b] border border-[#f3eee6]/15 rounded-lg px-3 py-2 text-xs text-[#f3eee6] focus:outline-none focus:border-[#f59e0b]"
            />
          </div>

          {/* Channel Handle */}
          <div>
            <label className="block text-[11px] font-mono font-semibold text-[#a39e94] uppercase tracking-wider mb-1">
              YouTube Channel Handle or Link
            </label>
            <input
              type="text"
              value={channelHandle}
              onChange={(e) => setChannelHandle(e.target.value)}
              placeholder="e.g. @YourChannel or https://youtube.com/@YourChannel"
              className="w-full bg-[#0e0d0b] border border-[#f3eee6]/15 rounded-lg px-3 py-2 text-xs text-[#f3eee6] focus:outline-none focus:border-[#f59e0b] font-mono"
            />
          </div>

          {/* RTMP Stream Key */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-mono font-semibold text-[#a39e94] uppercase tracking-wider">
                RTMP Stream Key
              </label>
              <button
                type="button"
                onClick={() => setShowInstructions(!showInstructions)}
                className="text-[11px] text-[#f59e0b] hover:underline flex items-center gap-1 font-mono"
              >
                <HelpCircle className="w-3 h-3" />
                Where to get this?
              </button>
            </div>

            {showInstructions && (
              <div className="p-3 bg-[#0e0d0b] border border-[#f3eee6]/10 rounded-lg text-[11px] text-[#a39e94] space-y-1.5 mb-2">
                <p className="font-semibold text-[#f3eee6]">Steps to get your Stream Key:</p>
                <p>1. Open <a href="https://studio.youtube.com/channel/live" target="_blank" rel="noopener noreferrer" className="text-[#f59e0b] underline font-semibold">YouTube Studio Live Dashboard ↗</a></p>
                <p>2. Copy your <strong>Stream Key</strong> and paste it below.</p>
                <p>3. 💡 <em className="text-[#f3eee6]">Pro Tip:</em> In Stream Settings, toggle <strong className="text-[#f59e0b]">Enable Auto-start</strong> to ON so YouTube publishes your stream automatically when you go live in Mathsy Meet!</p>
              </div>
            )}

            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={streamKey}
                onChange={(e) => setStreamKey(e.target.value)}
                placeholder="xxxx-xxxx-xxxx-xxxx"
                className="w-full bg-[#0e0d0b] border border-[#f3eee6]/15 rounded-lg pl-3 pr-10 py-2 text-xs text-[#f3eee6] focus:outline-none focus:border-[#f59e0b] font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#a39e94] hover:text-[#f3eee6]"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Default Visibility */}
          <div>
            <label className="block text-[11px] font-mono font-semibold text-[#a39e94] uppercase tracking-wider mb-1">
              Default Stream Visibility
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDefaultVisibility("public")}
                className={`py-2 px-3 rounded-lg border text-xs font-semibold transition ${
                  defaultVisibility === "public"
                    ? "bg-[#f59e0b]/15 border-[#f59e0b] text-[#f59e0b]"
                    : "bg-[#0e0d0b] border-[#f3eee6]/10 text-[#a39e94] hover:text-[#f3eee6]"
                }`}
              >
                Public (Recommended)
              </button>
              <button
                type="button"
                onClick={() => setDefaultVisibility("unlisted")}
                className={`py-2 px-3 rounded-lg border text-xs font-semibold transition ${
                  defaultVisibility === "unlisted"
                    ? "bg-[#f59e0b]/15 border-[#f59e0b] text-[#f59e0b]"
                    : "bg-[#0e0d0b] border-[#f3eee6]/10 text-[#a39e94] hover:text-[#f3eee6]"
                }`}
              >
                Unlisted (Link Only)
              </button>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2 mt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="w-full sm:w-auto bg-transparent border-[#f3eee6]/15 hover:bg-[#221f1a] text-[#f3eee6] text-xs font-medium rounded-lg"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            className="w-full sm:w-auto bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold text-xs rounded-lg shadow-md shadow-[#f59e0b]/20"
          >
            {channel ? "Update Settings" : "Save & Connect Channel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
