import { useState } from "react";
import { Download } from "lucide-react";
import { useInstallApp } from "./pwa";

/** "Install Mathsy Meet" button (Android/desktop), or Add-to-Home-Screen steps on iPhone/iPad. */
export function InstallAppButton({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const { canPrompt, hint, install } = useInstallApp();
  const [showSteps, setShowSteps] = useState(false);
  if (!canPrompt && !hint) return null;
  const copyLink = () => {
    void navigator.clipboard?.writeText(window.location.href).catch(() => {});
  };
  // Hand-install steps, or why this browser can't install (with a link copy to open it elsewhere).
  const steps = hint && (
    <>
      <span className="block">{hint.text}</span>
      {hint.kind === "unsupported" && (
        <button type="button" onClick={copyLink} className="mt-1.5 font-semibold text-[#f59e0b] underline">
          Copy link
        </button>
      )}
    </>
  );
  if (compact) {
    // Header pill (home page, next to Start Class); iPhone steps open just below it.
    return (
      <div className={`relative shrink-0 ${className}`}>
        <button
          type="button"
          onClick={() => (canPrompt ? void install() : setShowSteps((v) => !v))}
          title="Install Mathsy Meet as an app"
          aria-label="Install Mathsy Meet app"
          className="flex min-h-8 items-center gap-1.5 rounded-full border border-[#f3eee6]/15 bg-[#1a1814] px-3.5 py-1.5 text-xs font-semibold text-[#f3eee6] shadow-sm transition hover:border-[#f59e0b]/50 hover:bg-[#221f1a]"
        >
          <Download className="h-3.5 w-3.5 text-[#f59e0b]" />
          <span className="hidden sm:inline">Install app</span>
        </button>
        {showSteps && (
          <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-[#f3eee6]/15 bg-[#16130f] p-3 text-[11px] leading-relaxed text-[#a39e94] shadow-2xl">
            {steps}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={`text-center ${className}`}>
      <button
        type="button"
        onClick={() => (canPrompt ? void install() : setShowSteps((v) => !v))}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#f59e0b]/40 bg-[#1a1814] px-4 text-xs font-bold text-[#f59e0b] hover:bg-white/5"
      >
        <Download className="h-4 w-4" />
        Install Mathsy Meet app
      </button>
      {showSteps && (
        <div className="mx-auto mt-2 max-w-xs text-[11px] leading-relaxed text-[#a39e94]">{steps}</div>
      )}
    </div>
  );
}
