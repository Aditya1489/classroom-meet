import { useEffect, useState } from "react";

/** Chrome/Edge/Android's install prompt event (not in TypeScript's DOM types). */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

const isEmbedded = () => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

/** True when already opened as the installed app. */
export const isInstalledApp = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

/** Install steps for browsers that have no install prompt (we can only show how to do it by hand). */
export interface InstallHint {
  /** "steps": the browser can install, by hand. "unsupported": it can't; suggest another browser. */
  kind: "steps" | "unsupported";
  text: string;
}

export function getInstallHint(): InstallHint | null {
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIos) {
    // Every iPhone/iPad browser uses Safari's engine; all of them add apps from the Share menu.
    const inSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    return {
      kind: "steps",
      text: inSafari
        ? "Tap Share at the bottom of Safari, then Add to Home Screen."
        : "Tap Share (in the address bar or the menu), then Add to Home Screen. Needs iOS 16.4 or later; on older iPhones open this page in Safari.",
    };
  }
  const isFirefox = /Firefox\//.test(ua);
  if (isFirefox) {
    return /Android/.test(ua)
      ? { kind: "steps", text: "Tap the ⋮ menu, then Install (or Add to Home screen)." }
      : { kind: "unsupported", text: "Firefox can't install apps. Open this page in Chrome or Edge to install it, or keep using it here in a tab." };
  }
  const isMacSafari = /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua);
  if (isMacSafari) {
    const version = Number(ua.match(/Version\/(\d+)/)?.[1] || 0);
    return version >= 17
      ? { kind: "steps", text: "In the menu bar choose File, then Add to Dock." }
      : { kind: "unsupported", text: "Update Safari (macOS 14 or later) to add it to the Dock, or open this page in Chrome or Edge to install it." };
  }
  return null; // Chrome, Edge, Samsung etc. show their own prompt through our button.
}

/** Kept for older callers: true on iPhone/iPad Safari. */
export const isIosSafari = () => {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
};

/** Call once at start-up: catches the install prompt (it can fire before React renders) and registers the worker. */
export function initPwa() {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // show our own button instead of the browser's mini-bar
    deferredPrompt = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });
  // Only for the real site (not dev, not inside the CRM frame).
  if ("serviceWorker" in navigator && import.meta.env.PROD && !isEmbedded()) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("[PWA] Service worker not registered:", err));
    });
  }
}

/** Whether the "Install app" button should show, and the action for it. */
export function useInstallApp() {
  const [, rerender] = useState(0);
  useEffect(() => {
    const l = () => rerender((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  const hidden = typeof window === "undefined" || isEmbedded() || isInstalledApp();
  const hint = hidden || deferredPrompt ? null : getInstallHint();
  return {
    canPrompt: !hidden && Boolean(deferredPrompt),
    hint,
    install: async () => {
      if (!deferredPrompt) return false;
      const p = deferredPrompt;
      deferredPrompt = null;
      await p.prompt();
      const { outcome } = await p.userChoice;
      notify();
      return outcome === "accepted";
    },
  };
}

/** Keeps the screen on while `active` (phones otherwise sleep mid-class). Re-applied when the tab is shown again. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    const wl = (navigator as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    if (!active || !wl) return;
    let lock: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        lock = await wl.request("screen");
      } catch {
        // Not allowed right now (battery saver, not visible); try again next time the tab is shown.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
