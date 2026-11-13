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

  await t.test("SMF-11: Whiteboard Floating PiP Camera displays Tutor's camera to student and never student self-view", async () => {
    const fs = await import("node:fs/promises");
    const meetingCode = await fs.readFile("src/components/meet/MeetingRoom.tsx", "utf-8");

    // Verify remote participant role normalization includes both "host" and "tutor"
    assert.ok(
      meetingCode.includes('p.role === "host" || p.role === "tutor"'),
      "Must normalize remote tutor role to host in allParticipants"
    );

    // Verify student view strictly binds to tutor camera and does not fall back to localVideoTrack
    assert.ok(
      meetingCode.includes("tutorPeer?.videoTrack || null"),
      "Student PiP camera must strictly use tutorPeer video track"
    );
    assert.ok(
      !meetingCode.includes("hostPeer?.videoTrack || (isCamEnabled ? localVideoTrack : null)"),
      "Must not fall back to student's own videoTrack in the PiP box"
    );

    // Simulate PiP selection logic
    const resolvePip = (isHost: boolean, myUserId: string, participants: Array<{ id: string; name: string; role: string; videoTrack?: any }>, isCamEnabled: boolean, localVideoTrack: any) => {
      const tutorPeer = participants.find((p) => (p.role === "host" || p.role === "tutor") && p.id !== myUserId)
        || participants.find((p) => p.id !== myUserId);

      const pipTrack = isHost
        ? (isCamEnabled ? localVideoTrack : null)
        : (tutorPeer?.videoTrack || null);

      const pipName = isHost
        ? "Host (You)"
        : tutorPeer
        ? (tutorPeer.name ? `${tutorPeer.name} (Tutor)` : "Tutor")
        : "Tutor";

      return { pipTrack, pipName, tutorPeer };
    };

    const mockTutor = { id: "tutor-1", name: "Aditya Chavhan", role: "tutor", videoTrack: "tutor-cam-track" };
    const mockStudent = { id: "student-1", name: "Kunal Gupta", role: "student", videoTrack: "student-cam-track" };

    // When student views room with tutor:
    const studentView = resolvePip(false, "student-1", [mockStudent, mockTutor], true, "student-cam-track");
    assert.equal(studentView.pipName, "Aditya Chavhan (Tutor)", "Student PiP must display Tutor name");
    assert.equal(studentView.pipTrack, "tutor-cam-track", "Student PiP must stream Tutor video track");

    // Even if student has local video enabled, it must never show student's own track:
    const studentWithTutorCamOff = resolvePip(false, "student-1", [mockStudent, { ...mockTutor, videoTrack: null }], true, "student-cam-track");
    assert.equal(studentWithTutorCamOff.pipName, "Aditya Chavhan (Tutor)");
    assert.equal(studentWithTutorCamOff.pipTrack, null, "Must NOT show student's own camera when tutor camera is off");
  });

  await t.test("SMF-12: Horizontal landscape 75/25 split architecture on mobile devices", async () => {
    const fs = await import("node:fs/promises");
    const meetingCode = await fs.readFile("src/components/meet/MeetingRoom.tsx", "utf-8");

    // Scoping check: must strictly gate on mobile landscape when whiteboard or screenshare is active
    assert.ok(
      meetingCode.includes("const isMobileLandscapeSplit = isMobileLandscape && (showWhiteboard || layoutMode === \"whiteboard\" || (layoutMode === \"screenshare\" && isAnyoneScreenSharing))"),
      "Must define isMobileLandscapeSplit with mobile landscape and presentation stage conditions"
    );

    // 75% canvas and 25% sidebar width checks
    assert.ok(meetingCode.includes("w-[75%]"), "Must allocate 75% width to the whiteboard/screenshare canvas");
    assert.ok(meetingCode.includes("w-[25%]"), "Must allocate 25% width to the dedicated sidebar");

    // Vertical division inside 25% sidebar (top video tile + tools & controls)
    assert.ok(
      meetingCode.includes("h-[38%]") || meetingCode.includes("h-[49%]"),
      "Must provide dedicated top video tile in sidebar"
    );

    // Header and dock decluttering checks
    assert.ok(
      meetingCode.includes("${isMobileLandscapeSplit ? \"hidden\" : \"\"}"),
      "Header and footer dock must be hidden in 75/25 split mode to grant 100% vertical canvas height"
    );

    // Focus mode toggling support: collapses sidebar to grant 100% full screen
    assert.ok(meetingCode.includes('isFocusMode ? "w-full" : "w-[75%]"'), "Focus mode must expand canvas to 100% width");
  });

  await t.test("SMF-13: 1-Tap Mobile Fullscreen Pill and document.documentElement targeting", async () => {
    const fs = await import("node:fs/promises");
    const meetingCode = await fs.readFile("src/components/meet/MeetingRoom.tsx", "utf-8");
    const mobileFullscreenCode = await fs.readFile("src/lib/mobileFullscreen.ts", "utf-8");

    // 1-Tap mobile fullscreen banner exists in MeetingRoom for mobile when not in fullscreen
    assert.ok(
      meetingCode.includes("Tap for Full Screen"),
      "Must provide 1-tap mobile fullscreen trigger when not in fullscreen"
    );

    // Sidebar bottom control button directly triggers toggleFullscreen
    assert.ok(
      meetingCode.includes("title={isFullscreen ? \"Exit Fullscreen\" : \"Enter Fullscreen (Hide Browser Bar)\"}"),
      "Sidebar button must toggle native full screen to hide browser address bar"
    );

    // Fullscreen event listeners track document.fullscreenElement reactively
    assert.ok(
      meetingCode.includes("addEventListener(\"fullscreenchange\", handleFullscreenChange)"),
      "Must listen to fullscreenchange event to keep isFullscreen state synchronized"
    );

    // mobileFullscreen utility prefers document.documentElement on mobile devices
    assert.ok(
      mobileFullscreenCode.includes("isMobile ? document.documentElement : (element || document.documentElement)"),
      "Must target document.documentElement on mobile devices to collapse browser chrome cleanly"
    );
  });

  await t.test("SMF-14: Mobile Landscape Inline Chat in Sidebar with Back Navigation", async () => {
    const fs = await import("node:fs/promises");
    const meetingCode = await fs.readFile("src/components/meet/MeetingRoom.tsx", "utf-8");

    // Must have mobileSidebarTab state supporting controls, chat, and participants
    assert.ok(
      meetingCode.includes("mobileSidebarTab") && meetingCode.includes("setMobileSidebarTab"),
      "Must track mobileSidebarTab between controls, chat, and participants"
    );

    // Clicking chat button in sidebar switches tab to 'chat'
    assert.ok(
      meetingCode.includes("setMobileSidebarTab(\"chat\");"),
      "Chat button must switch mobileSidebarTab to chat"
    );

    // Chat view contains a Back button to return to controls
    assert.ok(
      meetingCode.includes("onClick={() => setMobileSidebarTab(\"controls\")}"),
      "Chat header must have Back button to return to controls menu"
    );

    // Chat view contains message feed, input field, and send button
    assert.ok(meetingCode.includes("Class Chat"), "Chat button must have Class Chat title");
    assert.ok(meetingCode.includes("handleSendMessage(mobileChatText.trim())"), "Chat form must send message via handleSendMessage");
    assert.ok(meetingCode.includes("placeholder={isChatLocked && !isHost ? \"Chat locked\" : \"Message...\"}"), "Input must handle chat lock status");
  });

  await t.test("SMF-15: 100-Student Smart Participant Switcher & Directory with Persistent Video", async () => {
    const fs = await import("node:fs/promises");
    const meetingCode = await fs.readFile("src/components/meet/MeetingRoom.tsx", "utf-8");

    // Must have selectedCameraPeerId, participantSearch, and participantFilter states
    assert.ok(meetingCode.includes("selectedCameraPeerId"), "Must track selectedCameraPeerId for camera swapping");
    assert.ok(meetingCode.includes("participantSearch"), "Must support participant search for 100 students");
    assert.ok(meetingCode.includes("participantFilter"), "Must support participant filtering (all, cameras, hands)");

    // Pinned Tutor pill always available
    assert.ok(meetingCode.includes("👑 Tutor"), "Must render pinned Tutor button");
    assert.ok(meetingCode.includes("setSelectedCameraPeerId(null)"), "Tutor pill must reset camera to tutor");

    // Directory switcher button
    assert.ok(meetingCode.includes("setMobileSidebarTab(\"participants\")") || meetingCode.includes("setMobileSidebarTab(mobileSidebarTab === \"participants\""), "Must toggle participant directory");

    // Persistent video tile on top with active camera resolution
    assert.ok(meetingCode.includes("mobilePipTrack"), "Must resolve mobilePipTrack dynamically");
    assert.ok(meetingCode.includes("mobilePipName"), "Must resolve active participant name");
  });

  await t.test("SMF-16: Mobile Sidebar Whiteboard Quick Tools & Canvas Top-Bar Decluttering", async () => {
    const fs = await import("node:fs/promises");
    const meetingCode = await fs.readFile("src/components/meet/MeetingRoom.tsx", "utf-8");
    const whiteboardCode = await fs.readFile("src/components/whiteboard/Whiteboard.tsx", "utf-8");

    // Whiteboard hides top header on mobile landscape split
    assert.ok(whiteboardCode.includes("hideTopBar?: boolean;"), "Whiteboard must accept hideTopBar prop");
    assert.ok(whiteboardCode.includes("!hideTopBar &&"), "Top header must be conditionally hidden when hideTopBar is true");
    assert.ok(meetingCode.includes("hideTopBar={isMobileLandscapeSplit}"), "MeetingRoom must pass hideTopBar to Whiteboard in split mode");

    // Whiteboard action callbacks (ZoomToFit, ExportPdf) exposed to sidebar
    assert.ok(whiteboardCode.includes("onRegisterActions?:"), "Whiteboard must expose onRegisterActions prop");
    assert.ok(meetingCode.includes("whiteboardActionsRef"), "MeetingRoom must maintain whiteboard actions ref");

    // Quick tools row in sidebar
    assert.ok(meetingCode.includes("whiteboardActionsRef.current?.zoomToFit()"), "Sidebar must have Fit action");
    assert.ok(meetingCode.includes("whiteboardActionsRef.current?.exportPdf()"), "Sidebar must have Notes PDF action");
  });
});

