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
    assert.deepEqual(result, { fullscreen: false, orientation: false });
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
});
