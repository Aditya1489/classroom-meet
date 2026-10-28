import React, { useState } from "react";
import { Key, Copy, Check, AlertTriangle, ShieldCheck } from "lucide-react";

interface ApiKeyRevealModalProps {
  rawKey: string;
  name: string;
  environment: "live" | "test";
  onClose: () => void;
}

export const ApiKeyRevealModal: React.FC<ApiKeyRevealModalProps> = ({
  rawKey,
  name,
  environment,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      console.warn("Failed to copy to clipboard", e);
    }
  };

  const isLive = environment === "live";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#14120e] border border-[#f3eee6]/15 rounded-2xl w-full max-w-lg p-6 shadow-2xl shadow-black/60 relative">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isLive ? "bg-[#f59e0b]/20 text-[#f59e0b]" : "bg-[#3b82f6]/20 text-[#3b82f6]"}`}>
            <Key className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#f3eee6]">API Key Generated</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-[#a39e94]">{name}</span>
              <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full font-semibold ${isLive ? "bg-[#f59e0b]/20 text-[#f59e0b] border border-[#f59e0b]/30" : "bg-[#3b82f6]/20 text-[#3b82f6] border border-[#3b82f6]/30"}`}>
                {environment} key
              </span>
            </div>
          </div>
        </div>

        {/* Warning Callout */}
        <div className="bg-[#f59e0b]/10 border border-[#f59e0b]/30 rounded-xl p-3.5 mb-5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-[#f59e0b] shrink-0 mt-0.5" />
          <div className="text-xs text-[#f3eee6] leading-relaxed">
            <span className="font-semibold text-[#f59e0b]">Save this secret key immediately.</span> For security reasons, this key will <span className="underline font-bold">never be displayed again</span>. If you lose it, you will need to rotate or generate a new key.
          </div>
        </div>

        {/* Secret Key Container */}
        <div className="mb-6">
          <label className="text-[11px] font-medium text-[#a39e94] mb-1.5 block">Your Secret API Key</label>
          <div className="flex items-center gap-2 bg-[#0a0907] border border-[#f3eee6]/15 rounded-xl p-3 font-mono text-xs text-[#f3eee6] break-all select-all">
            <span className="flex-1 font-semibold tracking-wide text-[#34d399]">{rawKey}</span>
            <button
              onClick={handleCopy}
              className="p-2 rounded-lg bg-[#1a1814] hover:bg-[#26221c] text-[#f3eee6] border border-[#f3eee6]/15 transition shrink-0 cursor-pointer flex items-center gap-1.5 text-xs font-sans font-medium"
              title="Copy to clipboard"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#34d399]" />
                  <span className="text-[#34d399]">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-[#a39e94]" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Action Button */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#f3eee6]/10">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold text-xs transition cursor-pointer flex items-center gap-2 shadow-lg shadow-[#f59e0b]/20"
          >
            <ShieldCheck className="w-4 h-4" />
            I have saved my secret key
          </button>
        </div>
      </div>
    </div>
  );
};
