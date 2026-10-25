import React, { useState } from "react";
import {
  Info,
  Copy,
  Check,
  ShieldCheck,
  X,
  Share2,
  ExternalLink,
  GraduationCap,
  Sparkles,
  MessageCircle,
  Mail,
  Lock
} from "lucide-react";
import { toast } from "sonner";

interface InfoDrawerProps {
  isOpen: boolean;
  meetingCode: string;
  onClose: () => void;
  hostName?: string;
  isHost?: boolean;
}

export const InfoDrawer: React.FC<InfoDrawerProps> = ({
  isOpen,
  meetingCode,
  onClose,
  hostName = "Host",
  isHost = false,
}) => {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  if (!isOpen) return null;

  const meetingUrl = `${window.location.origin}/meet/${meetingCode}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(meetingUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(meetingCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyJoiningInfo = () => {
    const infoText = `Join Mathsy Meet Classroom\nMeeting link: ${meetingUrl}\nMeeting code: ${meetingCode}`;
    navigator.clipboard.writeText(infoText);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const shareToWhatsApp = () => {
    const text = encodeURIComponent(
      `Join our live class on Mathsy Meet!\nLink: ${meetingUrl}\nCode: ${meetingCode}`
    );
    window.open(`https://api.whatsapp.com/send?text=${text}`, "_blank");
  };

  const shareViaEmail = () => {
    const subject = encodeURIComponent(`Invitation to Mathsy Meet Class: ${meetingCode}`);
    const body = encodeURIComponent(
      `Hi,\n\nYou are invited to join a live classroom session on Mathsy Meet.\n\nMeeting Link: ${meetingUrl}\nMeeting Code: ${meetingCode}\n\nClick the link above to join directly from any browser on desktop, mobile, iPad, or tablet.`
    );
    window.open(`mailto:?subject=${subject}&body=${body}`);
  };

  return (
    <aside className="w-80 md:w-96 h-full bg-[#1a1814] border-l border-[#f3eee6]/[0.08] flex flex-col z-30 shadow-2xl shrink-0 overflow-hidden font-sans animate-in slide-in-from-right duration-200">
      {/* ── Top Header ── */}
      <div className="h-14 border-b border-[#f3eee6]/[0.08] flex items-center justify-between px-4 bg-[#16130f] shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#f59e0b]/15 text-[#f59e0b] flex items-center justify-center border border-[#f59e0b]/30">
            <Info className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-[#f3eee6]">Meeting details</h2>
            <p className="text-[10px] text-[#a39e94]">Joining info & class security</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-[#a39e94] hover:text-[#f3eee6] rounded-full hover:bg-white/5 transition cursor-pointer"
          title="Close details"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Drawer Body ── */}
      <div className="p-5 space-y-6 flex-1 overflow-y-auto">
        {/* Section 1: Joining Info */}
        <div className="space-y-4">
          <div className="space-y-1">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#f59e0b]">
              JOINING INFO
            </span>
            <p className="text-xs text-[#a39e94] leading-relaxed">
              Share this information with students, parents, or teachers you want in the classroom.
            </p>
          </div>

          {/* Meeting Link Card */}
          <div className="bg-[#0e0d0b] border border-[#f3eee6]/10 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-[#a39e94]">
              <span className="font-semibold text-[#f3eee6]">Meeting link</span>
              <button
                onClick={handleCopyLink}
                className="text-[#f59e0b] hover:text-[#fbbf24] font-medium flex items-center gap-1 transition cursor-pointer text-[11px]"
              >
                {copiedLink ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy link</span>
                  </>
                )}
              </button>
            </div>
            <p className="font-mono text-xs text-[#f3eee6] select-all break-all bg-[#1a1814] p-2.5 rounded-lg border border-[#f3eee6]/[0.06]">
              {meetingUrl}
            </p>
          </div>

          {/* Meeting Code Card */}
          <div className="bg-[#0e0d0b] border border-[#f3eee6]/10 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-[#a39e94]">
              <span className="font-semibold text-[#f3eee6]">Meeting code</span>
              <button
                onClick={handleCopyCode}
                className="text-[#f59e0b] hover:text-[#fbbf24] font-medium flex items-center gap-1 transition cursor-pointer text-[11px]"
              >
                {copiedCode ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy code</span>
                  </>
                )}
              </button>
            </div>
            <div className="flex items-center justify-between bg-[#1a1814] p-2.5 rounded-lg border border-[#f3eee6]/[0.06]">
              <span className="font-mono text-base font-bold text-[#f59e0b] tracking-wider select-all">
                {meetingCode}
              </span>
              <span className="text-[10px] text-[#a39e94] font-mono">Instant Join</span>
            </div>
          </div>

          {/* Copy All Joining Info Button */}
          <button
            onClick={handleCopyJoiningInfo}
            className="w-full py-3 px-4 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold text-xs transition shadow-lg shadow-[#f59e0b]/20 flex items-center justify-center gap-2 cursor-pointer hover:scale-[1.01] active:scale-[0.99]"
          >
            {copiedAll ? (
              <>
                <Check className="w-4 h-4 text-[#0e0d0b]" />
                <span>Copied All Joining Info!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 text-[#0e0d0b]" />
                <span>Copy Joining Info</span>
              </>
            )}
          </button>

          {/* Quick Sharing Options */}
          <div className="pt-2">
            <span className="text-[10px] font-mono text-[#a39e94] uppercase tracking-wider block mb-2">
              QUICK SHARE
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={shareToWhatsApp}
                className="py-2.5 px-3 rounded-xl bg-[#0e0d0b] hover:bg-[#221f1a] border border-[#f3eee6]/10 text-xs font-semibold text-[#f3eee6] transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <MessageCircle className="w-4 h-4 text-[#25D366]" />
                <span>WhatsApp</span>
              </button>
              <button
                onClick={shareViaEmail}
                className="py-2.5 px-3 rounded-xl bg-[#0e0d0b] hover:bg-[#221f1a] border border-[#f3eee6]/10 text-xs font-semibold text-[#f3eee6] transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <Mail className="w-4 h-4 text-[#f59e0b]" />
                <span>Email</span>
              </button>
            </div>
          </div>
        </div>

        {/* Section 2: Session Info & Security */}
        <div className="space-y-3 pt-4 border-t border-[#f3eee6]/[0.08]">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#a39e94]">
            CLASSROOM ARCHITECTURE
          </span>

          <div className="p-3 bg-[#0e0d0b] rounded-xl border border-[#f3eee6]/10 space-y-2.5 text-xs text-[#a39e94]">
            <div className="flex items-center justify-between pb-2 border-b border-[#f3eee6]/[0.06]">
              <span className="flex items-center gap-1.5 text-[#f3eee6] font-medium">
                <GraduationCap className="w-3.5 h-3.5 text-[#f59e0b]" />
                Host / Tutor
              </span>
              <span className="font-mono text-[#f59e0b] font-semibold">{hostName}</span>
            </div>

            <div className="flex items-start gap-2.5 pt-1">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-[#f3eee6] text-xs">Self-Hosted Mediasoup SFU</p>
                <p className="text-[11px] text-[#a39e94] leading-relaxed mt-0.5">
                  Ultra-low latency real-time video stream protected with DTLS-SRTP hardware encryption.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5 pt-1">
              <Lock className="w-4 h-4 text-[#f59e0b] shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-[#f3eee6] text-xs">Zero Install Browser Client</p>
                <p className="text-[11px] text-[#a39e94] leading-relaxed mt-0.5">
                  Students join seamlessly from any Chrome, Safari, Edge, or mobile browser without extensions or downloads.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};
