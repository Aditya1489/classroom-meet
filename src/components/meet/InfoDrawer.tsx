import React from "react";
import { Info, Copy, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";

interface InfoDrawerProps {
  meetingCode: string;
  onClose: () => void;
}

export const InfoDrawer: React.FC<InfoDrawerProps> = ({ meetingCode, onClose }) => {
  const meetingUrl = `${window.location.origin}/meet/${meetingCode}`;

  const copyUrl = () => {
    navigator.clipboard.writeText(meetingUrl);
    toast.success("Joining info copied to clipboard!");
  };

  return (
    <div className="flex flex-col h-full bg-[#1a1814] text-[#f3eee6] border-l border-[#f3eee6]/[0.08] w-80 md:w-96 shrink-0 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#f3eee6]/[0.08] bg-[#16130f]">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[#f59e0b]/10 text-[#f59e0b]">
            <Info className="w-4 h-4" />
          </div>
          <h2 className="font-serif text-lg font-normal text-[#f3eee6]">Meeting Details</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-[#a39e94] hover:text-[#f3eee6] rounded-full hover:bg-white/5 transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-6 space-y-6 flex-1 overflow-y-auto">
        <div>
          <h3 className="text-[11px] font-mono font-semibold text-[#a39e94] uppercase tracking-wider mb-2">
            Joining Link
          </h3>
          <p className="text-xs text-[#f3eee6] break-all select-all font-mono bg-[#0e0d0b] p-3 rounded-xl border border-[#f3eee6]/10 mb-3">
            {meetingUrl}
          </p>
          <button
            onClick={copyUrl}
            className="w-full flex items-center justify-center gap-2 bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] text-xs font-bold py-2.5 rounded-xl transition shadow-lg shadow-[#f59e0b]/20"
          >
            <Copy className="w-3.5 h-3.5" />
            Copy Joining Info
          </button>
        </div>

        <div className="space-y-3 pt-3 border-t border-[#f3eee6]/[0.08]">
          <h3 className="text-[11px] font-mono font-semibold text-[#a39e94] uppercase tracking-wider">
            Media Security
          </h3>
          <div className="flex items-start gap-3 p-3 bg-[#221f1a] rounded-xl border border-[#f3eee6]/10 text-xs text-[#a39e94]">
            <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-[#f3eee6] mb-0.5">Encrypted WebRTC Media</p>
              <p className="text-[#a39e94] leading-relaxed">
                Streamed via private Mediasoup SFU with hardware-accelerated DTLS/SRTP audio-video encryption.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
