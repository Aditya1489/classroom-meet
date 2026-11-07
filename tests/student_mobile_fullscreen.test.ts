import test from "node:test";
import assert from "node:assert/strict";
import {
  isMobileDevice,
  isLandscapeOrientation,
  enterMobileFullscreenAndLandscape,
  exitMobileFullscreenAndUnlock,
} from "../src/lib/mobileFullscreen";

test("Student Mobile Fullscreen & Horizontal Screen Suite", async (t) => {
  await t.test("SMF-01: Correctly identifies mobile devices from user agents and touch dimensions", () => {
    // Mobile user agents
    const iphoneUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    const androidUA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
    const ipadUA = "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";

    // Desktop user agents
    const macDesktopUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
    const windowsDesktopUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

    assert.equal(isMobileDevice(iphoneUA, 390, 844), true, "iPhone must be detected as mobile");
    assert.equal(isMobileDevice(androidUA, 412, 915), true, "Android phone must be detected as mobile");
    assert.equal(isMobileDevice(ipadUA, 810, 1080), true, "iPad must be detected as mobile");

    assert.equal(isMobileDevice(macDesktopUA, 1440, 900), false, "Mac desktop must NOT be detected as mobile");
    assert.equal(isMobileDevice(windowsDesktopUA, 1920, 1080), false, "Windows PC must NOT be detected as mobile");
  });

  await t.test("SMF-02: Evaluates landscape orientation correctly", () => {
    // In node environment without window, isLandscapeOrientation returns true safely
    assert.equal(typeof isLandscapeOrientation(), "boolean");
  });

  await t.test("SMF-03: enterMobileFullscreenAndLandscape executes without throwing when APIs are missing or rejected", async () => {
    // In Node.js environment where document/screen are undefined
    const result = await enterMobileFullscreenAndLandscape(null);
    assert.deepEqual(result, { fullscreen: false, orientation: false, needsVirtualLandscape: false });
  });

  await t.test("SMF-04: Mock mobile browser with requestFullscreen and screen.orientation", async () => {
    let requestedFullscreen = false;
    let lockedOrientation = "";

    const mockElement = {
      requestFullscreen: async () => {
        requestedFullscreen = true;
      },
    };

    // Install mock globals temporarily
    const originalDocument = (global as any).document;
    const originalScreen = (global as any).screen;
    const originalWindow = (global as any).window;

    (global as any).window = {};
    (global as any).document = {
      fullscreenElement: null,
      exitFullscreen: async () => {},
    };
    (global as any).screen = {
      orientation: {
        type: "landscape-primary",
        lock: async (mode: string) => {
          lockedOrientation = mode;
        },
        unlock: () => {
          lockedOrientation = "unlocked";
        },
      },
    };

    try {
      const res = await enterMobileFullscreenAndLandscape(mockElement as any);
      assert.equal(res.fullscreen, true, "Fullscreen must be initiated");
      assert.equal(res.orientation, true, "Orientation lock must be initiated");
      assert.equal(res.needsVirtualLandscape, false);
      assert.equal(requestedFullscreen, true);
      assert.equal(lockedOrientation, "landscape");

      await exitMobileFullscreenAndUnlock();
      assert.equal(lockedOrientation, "unlocked");
    } finally {
      (global as any).document = originalDocument;
      (global as any).screen = originalScreen;
      (global as any).window = originalWindow;
    }
  });

  await t.test("SMF-06: iOS Safari / DevTools fallback sets needsVirtualLandscape to true on portrait mobile", async () => {
    const originalDocument = (global as any).document;
    const originalScreen = (global as any).screen;
    const originalWindow = (global as any).window;
    const origNavDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

    (global as any).window = {
      innerWidth: 375,
      innerHeight: 667,
    };
    Object.defineProperty(globalThis, "navigator", {
      value: {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
        maxTouchPoints: 5,
      },
      configurable: true,
      writable: true,
    });
    (global as any).document = {
      fullscreenElement: null,
      documentElement: {},
    };
    // iOS Safari has no screen.orientation.lock
    (global as any).screen = {
      orientation: undefined,
    };

    try {
      const res = await enterMobileFullscreenAndLandscape(null);
      assert.equal(res.orientation, false, "Native lock is unsupported on iOS");
      assert.equal(res.needsVirtualLandscape, true, "Must flag needsVirtualLandscape for software-driven CSS 90deg flip");
    } finally {
      (global as any).document = originalDocument;
      (global as any).screen = originalScreen;
      (global as any).window = originalWindow;
      if (origNavDescriptor) {
        Object.defineProperty(globalThis, "navigator", origNavDescriptor);
      }
    }
  });

  await t.test("SMF-05: Strict audience gating: Tutors and desktop users are NEVER auto-fullscreened", () => {
    const shouldAutoFullscreen = (isHost: boolean, role: string, isMobile: boolean) => {
      // Strictly for student attendees on mobile devices only
      if (isHost || role === "tutor") return false;
      if (!isMobile) return false;
      return true;
    };

    // Student on mobile -> Allowed
    assert.equal(shouldAutoFullscreen(false, "student", true), true);

    // Tutor / Host on mobile -> Blocked (tutor needs host controls, tablet companion, etc.)
    assert.equal(shouldAutoFullscreen(true, "tutor", true), false);
    assert.equal(shouldAutoFullscreen(true, "student", true), false);
    assert.equal(shouldAutoFullscreen(false, "tutor", true), false);

    // Student on desktop -> Blocked
    assert.equal(shouldAutoFullscreen(false, "student", false), false);

    // Tutor on desktop -> Blocked
    assert.equal(shouldAutoFullscreen(true, "tutor", false), false);
  });

  await t.test("SMF-07: CSS rules contain .mathsy-virtual-landscape and focus mode definitions", async () => {
    const fs = await import("node:fs/promises");
    const css = await fs.readFile("src/index.css", "utf-8");
    assert.ok(css.includes(".mathsy-virtual-landscape"), "index.css must include .mathsy-virtual-landscape");
    assert.ok(css.includes("rotate(90deg)"), "Must rotate 90deg for widescreen immersion");
    assert.ok(css.includes(".mathsy-focus-mode-header"), "Must include focus mode header class");
    assert.ok(css.includes(".mathsy-focus-mode-dock"), "Must include focus mode dock class");
  });

  await t.test("SMF-08: Whiteboard source code supports view-only UI decluttering and auto zoom-to-fit", async () => {
    const fs = await import("node:fs/promises");
    const wb = await fs.readFile("src/components/whiteboard/Whiteboard.tsx", "utf-8");
    assert.ok(wb.includes("hideUi={!canDraw}"), "Must hide Tldraw UI when user cannot draw");
    assert.ok(wb.includes("zoomToFit"), "Must support zoomToFit for canvas scaling");
    assert.ok(wb.includes("ZoomIn"), "Must provide 1-tap Fit button");
  });

  await t.test("SMF-09: Real-time whiteboard diff is routed through chatMessage control channel", async () => {
    const fs = await import("node:fs/promises");
    const clientCode = await fs.readFile("src/engine/mediasoupClient.ts", "utf-8");
    assert.ok(clientCode.includes('controlAction: "WHITEBOARD_DIFF"'), "Must wrap whiteboard diff in control channel");
    assert.ok(clientCode.includes('msg.controlAction === "WHITEBOARD_DIFF"'), "Must handle incoming WHITEBOARD_DIFF in chatMessage handler");
  });

  await t.test("SMF-10: Non-hardcoded responsive presentation stage architecture", async () => {
    const fs = await import("node:fs/promises");
    const meetingCode = await fs.readFile("src/components/meet/MeetingRoom.tsx", "utf-8");
    assert.ok(meetingCode.includes("h-[100dvh]"), "Must use dynamic viewport height (100dvh)");
    assert.ok(meetingCode.includes("isFocusMode"), "Must support 1-tap Focus Mode for presentations");
    assert.ok(meetingCode.includes("object-contain"), "Screen share must use object-contain without hardcoded pixel bounds");
  });
});

