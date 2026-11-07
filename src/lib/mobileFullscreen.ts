/**
 * Mobile Fullscreen & Landscape Orientation Utilities for Mathsy Meet
 * 
 * Safely manages fullscreen expansion and horizontal screen locking exclusively
 * for student attendees on mobile devices, adhering to strict browser sandbox
 * and user-gesture policies.
 */

export function isMobileDevice(customUA?: string, customWidth?: number, customHeight?: number): boolean {
  if (typeof window === "undefined" && !customUA) return false;

  const ua = customUA || (typeof navigator !== "undefined" ? navigator.userAgent || navigator.vendor || (window as any).opera || "" : "");
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i.test(ua);

  const width = customWidth !== undefined ? customWidth : (typeof window !== "undefined" ? window.innerWidth : 1024);
  const height = customHeight !== undefined ? customHeight : (typeof window !== "undefined" ? window.innerHeight : 768);
  const shortestSide = Math.min(width, height);

  const hasTouch = typeof navigator !== "undefined" && Boolean(navigator.maxTouchPoints && navigator.maxTouchPoints > 0);

  // Consider mobile if mobile UA is present, or touch device with a phone/tablet viewport size (<= 820px min dimension)
  return isMobileUA || (hasTouch && shortestSide <= 820);
}

export function isLandscapeOrientation(): boolean {
  if (typeof window === "undefined") return true;

  if (typeof screen !== "undefined" && screen.orientation && screen.orientation.type) {
    return screen.orientation.type.includes("landscape");
  }

  return window.innerWidth >= window.innerHeight;
}

export async function enterMobileFullscreenAndLandscape(
  element?: HTMLElement | null
): Promise<{ fullscreen: boolean; orientation: boolean }> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { fullscreen: false, orientation: false };
  }

  let fullscreenSuccess = false;
  let orientationSuccess = false;

  // 1. Enter Fullscreen Mode
  try {
    const target = element || document.documentElement;
    if (document.fullscreenElement || (document as any).webkitFullscreenElement) {
      fullscreenSuccess = true;
    } else if (target.requestFullscreen) {
      await target.requestFullscreen();
      fullscreenSuccess = true;
    } else if ((target as any).webkitRequestFullscreen) {
      await (target as any).webkitRequestFullscreen();
      fullscreenSuccess = true;
    } else if ((target as any).mozRequestFullScreen) {
      await (target as any).mozRequestFullScreen();
      fullscreenSuccess = true;
    } else if ((target as any).msRequestFullscreen) {
      await (target as any).msRequestFullscreen();
      fullscreenSuccess = true;
    }
  } catch (err: any) {
    // Browsers may restrict fullscreen without direct user gesture; fail gracefully
    console.warn("[MobileFullscreen] requestFullscreen note:", err?.message || err);
  }

  // 2. Lock Orientation to Landscape
  try {
    const orientationObj = typeof screen !== "undefined" ? (screen.orientation as any) : null;
    if (orientationObj && typeof orientationObj.lock === "function") {
      await orientationObj.lock("landscape").catch((e: any) => {
        console.warn("[MobileOrientation] screen.orientation.lock rejected:", e?.message || e);
      });
      orientationSuccess = true;
    } else if (typeof screen !== "undefined" && typeof (screen as any).lockOrientation === "function") {
      (screen as any).lockOrientation("landscape");
      orientationSuccess = true;
    } else if (typeof screen !== "undefined" && typeof (screen as any).webkitLockOrientation === "function") {
      (screen as any).webkitLockOrientation("landscape");
      orientationSuccess = true;
    }
  } catch (err: any) {
    console.warn("[MobileOrientation] lockOrientation note:", err?.message || err);
  }

  return { fullscreen: fullscreenSuccess, orientation: orientationSuccess };
}

export async function exitMobileFullscreenAndUnlock(): Promise<void> {
  if (typeof document === "undefined") return;

  try {
    if (document.fullscreenElement || (document as any).webkitFullscreenElement) {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if ((document as any).webkitExitFullscreen) {
        await (document as any).webkitExitFullscreen();
      } else if ((document as any).mozCancelFullScreen) {
        await (document as any).mozCancelFullScreen();
      } else if ((document as any).msExitFullscreen) {
        await (document as any).msExitFullscreen();
      }
    }
  } catch (err: any) {
    console.warn("[MobileFullscreen] exitFullscreen note:", err?.message || err);
  }

  try {
    const orientationObj = typeof screen !== "undefined" ? (screen.orientation as any) : null;
    if (orientationObj && typeof orientationObj.unlock === "function") {
      orientationObj.unlock();
    } else if (typeof screen !== "undefined" && typeof (screen as any).unlockOrientation === "function") {
      (screen as any).unlockOrientation();
    } else if (typeof screen !== "undefined" && typeof (screen as any).webkitUnlockOrientation === "function") {
      (screen as any).webkitUnlockOrientation();
    }
  } catch (err: any) {
    console.warn("[MobileOrientation] unlockOrientation note:", err?.message || err);
  }
}
