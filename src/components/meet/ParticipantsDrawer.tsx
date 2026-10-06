import React from "react";
import { RemoteParticipant } from "../../engine/mediasoupClient";
import { Users, X, Mic, MicOff, Hand, Copy, Shield, VolumeX } from "lucide-react";
import { toast } from "sonner";

interface ParticipantsDrawerProps {
  localUser: { name: string; isHost?: boolean; isAudioMuted?: boolean; isHandRaised?: boolean };
  participants: RemoteParticipant[];
  onClose: () => void;
  meetingCode: string;
  isHost: boolean;
}

export const ParticipantsDrawer: React.FC<ParticipantsDrawerProps> = ({
  localUser,
  participants,
  onClose,
  meetingCode,
  isHost,
}) => {
  const totalCount = participants.length + 1;

  const copyInviteLink = () => {
    const url = `${window.location.origin}/meet/${meetingCode}`;
    navigator.clipboard.writeText(url);
    toast.success("Meeting link copied to clipboard!");
  };

  return (
    <div className="flex flex-col h-full bg-[#202124] text-white border-l border-white/10 w-80 md:w-96 shrink-0 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[#1a73e8]/20 text-[#8ab4f8]">
            <Users className="w-4 h-4" />
          </div>
          <h2 className="font-semibold text-sm">People ({totalCount})</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-gray-400 hover:text-white rounded-full hover:bg-white/10 transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Quick Invite Button */}
      <div className="p-4 border-b border-white/10">
        <button
          onClick={copyInviteLink}
          className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-medium py-2 rounded-xl transition"
        >
          <Copy className="w-4 h-4 text-[#8ab4f8]" />
          <span>Copy Meeting Link</span>
        </button>
      </div>

      {/* Participants List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {/* Local User */}
        <div className="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#1a73e8] flex items-center justify-center font-semibold text-xs">
              {localUser.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium">{localUser.name} (You)</span>
                {localUser.isHost && (
                  <span className="text-[10px] bg-[#1a73e8]/20 text-[#8ab4f8] px-1.5 py-0.2 rounded font-medium">
                    Meeting Host
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {localUser.isHandRaised && (
              <span className="p-1 rounded-full bg-amber-500/20 text-amber-400">
                <Hand className="w-3.5 h-3.5" />
              </span>
            )}
            {localUser.isAudioMuted ? (
              <MicOff className="w-4 h-4 text-red-400" />
            ) : (
              <Mic className="w-4 h-4 text-emerald-400" />
            )}
          </div>
        </div>

        {/* Remote Participants */}
        {participants.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between p-2.5 rounded-xl hover:bg-white/5 transition border border-transparent hover:border-white/5"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center font-semibold text-xs text-gray-200">
                {p.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">{p.name}</span>
                  {p.role === "tutor" && (
                    <span className="text-[10px] bg-[#1a73e8]/20 text-[#8ab4f8] px-1.5 py-0.2 rounded">
                      Co-Host
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {p.isHandRaised && (
                <span className="p-1 rounded-full bg-amber-500/20 text-amber-400 animate-bounce">
                  <Hand className="w-3.5 h-3.5" />
                </span>
              )}
              {p.isAudioMuted ? (
                <MicOff className="w-4 h-4 text-red-400" />
              ) : (
                <Mic className="w-4 h-4 text-emerald-400" />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Host Controls */}
      {isHost && participants.length > 0 && (
        <div className="p-3 border-t border-white/10 bg-[#1c1d20]">
          <button
            onClick={() => toast.info("All participants muted by host")}
            className="w-full flex items-center justify-center gap-2 text-xs font-medium py-2 rounded-xl text-red-400 hover:bg-red-500/10 transition border border-red-500/20"
          >
            <VolumeX className="w-3.5 h-3.5" />
            Mute All Participants
          </button>
        </div>
      )}
    </div>
  );
};
