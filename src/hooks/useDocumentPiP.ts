import { useState, useEffect, useCallback, useRef } from "react";

/**
 * Copies all <style> rules and <link rel="stylesheet"> elements from the host
 * window document into the Picture-in-Picture window document head.
 * Ensures that Tailwind CSS, custom fonts, animations, and variables render identically.
 */
export function copyStylesToPiP(pipWindow: Window) {
  if (!pipWindow || !pipWindow.document) return;
  const pipDoc = pipWindow.document;

  // Set document title
  pipDoc.title = "Mathsy Meet — Floating Mini-View";

  // Transfer all CSS stylesheets from parent document
  try {
    const parentStyleSheets = Array.from(document.styleSheets);
    for (const sheet of parentStyleSheets) {
      try {
        if (sheet.href) {
          // External or CDN stylesheet (e.g., Google Fonts, CDN icons)
          const link = pipDoc.createElement("link");
          link.rel = "stylesheet";
          link.href = sheet.href;
          pipDoc.head.appendChild(link);
        } else if (sheet.cssRules) {
          // Inline or Vite/Tailwind style rules
          const style = pipDoc.createElement("style");
          for (const rule of Array.from(sheet.cssRules)) {
            style.appendChild(pipDoc.createTextNode(rule.cssText));
          }
          pipDoc.head.appendChild(style);
        }
      } catch {
        // If sheet.cssRules throws SecurityError due to CORS on external origins, fallback to node clone
        if (sheet.ownerNode) {
          pipDoc.head.appendChild(sheet.ownerNode.cloneNode(true));
        }
      }
    }
  } catch (err) {
    console.warn("[DocumentPiP] Error copying document styleSheets:", err);
  }

  // Also clone any link tags and style tags in document.head
  document.head.querySelectorAll("link[rel='stylesheet'], link[rel='preconnect'], style").forEach((node) => {
    if (node.tagName.toLowerCase() === "link") {
      const href = (node as HTMLLinkElement).href;
      if (href && pipDoc.head.querySelector(`link[href="${href}"]`)) return;
    }
    pipDoc.head.appendChild(node.cloneNode(true));
  });

  // Synchronize base dark theme classes and layout styling
  pipDoc.documentElement.className = document.documentElement.className || "dark";
  pipDoc.documentElement.style.cssText = document.documentElement.style.cssText;
  pipDoc.body.className = `${document.body.className} bg-[#0e0d0b] text-[#f3eee6] m-0 p-0 overflow-hidden font-sans antialiased select-none`;
  pipDoc.body.style.cssText = "margin: 0; padding: 0; overflow: hidden; background-color: #0e0d0b; color: #f3eee6; height: 100vh; width: 100vw;";
}

export interface UseDocumentPiPOptions {
  width?: number;
  height?: number;
  onClose?: () => void;
  videoElementFallback?: HTMLVideoElement | null;
}

export function useDocumentPiP(options: UseDocumentPiPOptions = {}) {
  const { width = 340, height = 480, onClose } = options;

  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const pipWindowRef = useRef<Window | null>(null);
  pipWindowRef.current = pipWindow;

  const isSupported = typeof window !== "undefined" && "documentPictureInPicture" in window;

  const closePiP = useCallback(() => {
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      try {
        pipWindowRef.current.close();
      } catch (err) {
        console.warn("[DocumentPiP] close error:", err);
      }
    }
    pipWindowRef.current = null;
    setPipWindow(null);
    onClose?.();
  }, [onClose]);

  /**
   * Opens the floating mini-view. allowPopupFallback (default true) lets browsers without Document PiP
   * fall back to a small popup window; automatic opens (tab switch, after screen-share selection) pass
   * false, because a window.open() outside a click is either blocked or appears as a stray window.
   */
  const openPiP = useCallback(async (customOpts?: { width?: number; height?: number; allowPopupFallback?: boolean }): Promise<Window | null> => {
    const targetWidth = customOpts?.width || width;
    const targetHeight = customOpts?.height || height;

    // Close any previous PiP window
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      try {
        pipWindowRef.current.close();
      } catch {}
    }

    if (isSupported && (window as any).documentPictureInPicture) {
      try {
        const newWin: Window = await (window as any).documentPictureInPicture.requestWindow({
          width: targetWidth,
          height: targetHeight,
        });

        copyStylesToPiP(newWin);

        // Listen for close/pagehide to clean up React state
        const handlePageHide = () => {
          pipWindowRef.current = null;
          setPipWindow(null);
          onClose?.();
        };

        newWin.addEventListener("pagehide", handlePageHide);
        newWin.addEventListener("unload", handlePageHide);

        pipWindowRef.current = newWin;
        setPipWindow(newWin);
        return newWin;
      } catch (err: any) {
        console.warn("[DocumentPiP] requestWindow failed:", err?.message || err);
      }
    }

    if (customOpts?.allowPopupFallback === false) {
      return null;
    }

    // Fallback for non-Chromium browsers (Firefox, Safari): open compact popup window
    try {
      const left = Math.max(0, (window.screen.availWidth || 1200) - targetWidth - 24);
      const top = Math.max(0, (window.screen.availHeight || 800) - targetHeight - 48);
      const popup = window.open(
        "",
        "MathsyMeetFloatingOverlay",
        `width=${targetWidth},height=${targetHeight},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes`
      );

      if (popup) {
        copyStylesToPiP(popup);
        const handleUnload = () => {
          pipWindowRef.current = null;
          setPipWindow(null);
          onClose?.();
        };
        popup.addEventListener("beforeunload", handleUnload);
        popup.addEventListener("pagehide", handleUnload);

        pipWindowRef.current = popup;
        setPipWindow(popup);
        return popup;
      }
    } catch (popupErr) {
      console.warn("[DocumentPiP] Fallback popup window failed:", popupErr);
    }

    // Secondary fallback: Video Picture-in-Picture on active video element if available
    if (options.videoElementFallback && typeof options.videoElementFallback.requestPictureInPicture === "function") {
      try {
        await options.videoElementFallback.requestPictureInPicture();
      } catch (vidErr) {
        console.warn("[DocumentPiP] Video PiP fallback failed:", vidErr);
      }
    }

    return null;
  }, [width, height, isSupported, onClose, options.videoElementFallback]);

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      if (pipWindowRef.current && !pipWindowRef.current.closed) {
        try {
          pipWindowRef.current.close();
        } catch {}
      }
    };
  }, []);

  return {
    isPiPSupported: isSupported,
    pipWindow,
    isPiPActive: Boolean(pipWindow && !pipWindow.closed),
    openPiP,
    closePiP,
  };
}

