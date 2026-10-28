import React, { useState } from "react";
import { Webhook, Copy, Check, AlertTriangle, ShieldCheck } from "lucide-react";

interface WebhookSecretRevealModalProps {
  secret: string;
  url: string;
  onClose: () => void;
}

export const WebhookSecretRevealModal: React.FC<WebhookSecretRevealModalProps> = ({
  secret,
  url,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      console.warn("Failed to copy webhook secret", e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#14120e] border border-[#f3eee6]/15 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-[#f59e0b]/20 text-[#f59e0b] flex items-center justify-center">
            <Webhook className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#f3eee6]">Webhook Endpoint Registered</h2>
            <p className="text-xs text-[#a39e94] truncate max-w-xs">{url}</p>
          </div>
        </div>

        {/* Warning Callout */}
        <div className="bg-[#f59e0b]/10 border border-[#f59e0b]/30 rounded-xl p-3.5 mb-5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-[#f59e0b] shrink-0 mt-0.5" />
          <div className="text-xs text-[#f3eee6] leading-relaxed">
            <span className="font-semibold text-[#f59e0b]">Save this signing secret immediately.</span> For security, this secret will <span className="underline font-bold">never be displayed again</span>. Use it in your backend server to verify the <code className="text-[#34d399] font-mono">X-Mathsy-Signature</code> header via HMAC-SHA256.
          </div>
        </div>

        {/* Secret Container */}
        <div className="mb-6">
          <label className="text-[11px] font-medium text-[#a39e94] mb-1.5 block">Webhook Signing Secret</label>
          <div className="flex items-center gap-2 bg-[#0a0907] border border-[#f3eee6]/15 rounded-xl p-3 font-mono text-xs text-[#f3eee6] break-all select-all">
            <span className="flex-1 font-semibold tracking-wide text-[#34d399]">{secret}</span>
            <button
              onClick={handleCopy}
              className="p-2 rounded-lg bg-[#1a1814] hover:bg-[#26221c] text-[#f3eee6] border border-[#f3eee6]/15 transition shrink-0 cursor-pointer flex items-center gap-1.5 text-xs font-sans font-medium"
              title="Copy secret"
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

        {/* Verification sample note */}
        <div className="bg-[#0a0907] border border-[#f3eee6]/10 rounded-xl p-3 mb-5 text-[11px] text-[#a39e94] font-mono">
          <span className="text-[#f59e0b]">Signature header:</span> X-Mathsy-Signature: t=...,v1=hmac_sha256
        </div>

        {/* Action Button */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#f3eee6]/10">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold text-xs transition cursor-pointer flex items-center gap-2 shadow-lg shadow-[#f59e0b]/20"
          >
            <ShieldCheck className="w-4 h-4" />
            I have saved my signing secret
          </button>
        </div>
      </div>
    </div>
  );
};
