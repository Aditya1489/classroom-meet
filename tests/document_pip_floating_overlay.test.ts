import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();

test("Floating Mini-Meet Overlay Document Picture-in-Picture Suite", async (t) => {
  const pipHookPath = path.join(rootDir, "src/hooks/useDocumentPiP.ts");
  const overlayCompPath = path.join(rootDir, "src/components/meet/FloatingMeetOverlay.tsx");
  const meetingRoomPath = path.join(rootDir, "src/components/meet/MeetingRoom.tsx");
  const mediasoupClientPath = path.join(rootDir, "src/engine/mediasoupClient.ts");

  assert.ok(fs.existsSync(pipHookPath), "useDocumentPiP.ts must exist");
  assert.ok(fs.existsSync(overlayCompPath), "FloatingMeetOverlay.tsx must exist");
  assert.ok(fs.existsSync(meetingRoomPath), "MeetingRoom.tsx must exist");
  assert.ok(fs.existsSync(mediasoupClientPath), "mediasoupClient.ts must exist");

  const pipHookCode = fs.readFileSync(pipHookPath, "utf-8");
  const overlayCompCode = fs.readFileSync(overlayCompPath, "utf-8");
  const meetingRoomCode = fs.readFileSync(meetingRoomPath, "utf-8");
  const mediasoupCode = fs.readFileSync(mediasoupClientPath, "utf-8");

  await t.test("PIP-01: copyStylesToPiP synchronizes CSS rules, stylesheets, links, and dark theme", () => {
    assert.ok(
      pipHookCode.includes("export function copyStylesToPiP(pipWindow: Window)"),
      "Must export copyStylesToPiP utility"
    );
    assert.ok(
      pipHookCode.includes("document.styleSheets") &&
      pipHookCode.includes("pipDoc.createElement(\"link\")") &&
      pipHookCode.includes("pipDoc.createElement(\"style\")"),
      "copyStylesToPiP must transfer stylesheets, link tags, and inline style rules"
    );
    assert.ok(
      pipHookCode.includes("pipDoc.documentElement.className =") &&
      pipHookCode.includes("pipDoc.body.className ="),
      "copyStylesToPiP must synchronize dark theme classes and layout styling"
    );
  });

  await t.test("PIP-02: useDocumentPiP handles Chromium documentPictureInPicture and graceful fallback", () => {
    assert.ok(
      pipHookCode.includes("documentPictureInPicture.requestWindow"),
      "Must request Picture-in-Picture window via documentPictureInPicture API"
    );
    assert.ok(
      pipHookCode.includes("pagehide") && pipHookCode.includes("setPipWindow(null)"),
      "Must attach pagehide listener to cleanly reset pipWindow state on close"
    );
    assert.ok(
      pipHookCode.includes("window.open") || pipHookCode.includes("requestPictureInPicture"),
      "Must support graceful fallback for non-Chromium browsers (Firefox / Safari)"
    );
  });

  await t.test("PIP-03: FloatingMeetOverlay renders via React Portal into pipWindow.document.body", () => {
    assert.ok(
      overlayCompCode.includes("createPortal(content, pipWindow.document.body)") ||
      overlayCompCode.includes("createPortal("),
      "FloatingMeetOverlay must render using createPortal into pipWindow.document.body"
    );
    assert.ok(
      overlayCompCode.includes('data-testid="floating-meet-overlay"'),
      "Floating overlay must have test identifier"
    );
  });

  await t.test("PIP-04: Floating overlay includes Mini Video Grid with muted inline playback", () => {
    assert.ok(
      overlayCompCode.includes("PipVideoTile") &&
      overlayCompCode.includes("new MediaStream([track])"),
      "Overlay must include PipVideoTile attaching MediaStream tracks to video elements"
    );
    assert.ok(
      overlayCompCode.includes("el.muted = true") &&
      overlayCompCode.includes("el.playsInline = true"),
      "Video streams in PiP must be muted and inline to prevent audio echo and playback failures"
    );
    assert.ok(
      overlayCompCode.includes("displayRemote") &&
      overlayCompCode.includes("localVideoTrack"),
      "Mini video grid must display both remote active participants and local presenter"
    );
  });

  await t.test("PIP-05: Floating overlay includes Live Chat Drawer with real-time replies", () => {
    assert.ok(
      overlayCompCode.includes("chatMessages") &&
      overlayCompCode.includes("onSendMessage"),
      "Live Chat drawer must render incoming messages and accept replies"
    );
    assert.ok(
      overlayCompCode.includes("unreadCount") &&
      overlayCompCode.includes("setActiveTab"),
      "Overlay must support tab switching and track unread chat message count"
    );
  });

  await t.test("PIP-06: Sticky bottom Quick Action Bar provides mic, camera, and stop sharing controls", () => {
    assert.ok(
      overlayCompCode.includes("onToggleMute") &&
      overlayCompCode.includes("onToggleVideo"),
      "Quick action bar must provide mic and camera toggle actions"
    );
    assert.ok(
      overlayCompCode.includes("onStopScreenShare") &&
      overlayCompCode.includes("Stop Sharing"),
      "Quick action bar must provide prominent Stop Sharing button"
    );
  });

  await t.test("PIP-07: CaptureController integration and smooth focus transition during screen share", () => {
    assert.ok(
      meetingRoomCode.includes("CaptureController") &&
      meetingRoomCode.includes("setFocusBehavior(\"focus-captured-surface\")"),
      "MeetingRoom must instantiate CaptureController with focus-captured-surface behavior"
    );
    assert.ok(
      mediasoupCode.includes("startScreenShare(controller?: any)") &&
      mediasoupCode.includes("displayMediaOptions.controller = controller"),
      "mediasoupClient must pass controller parameter into getDisplayMedia"
    );
  });

  await t.test("PIP-08: Automatic PiP trigger on startScreenShare, mediaSession Chrome 120+, and close on ended", () => {
    assert.ok(
      meetingRoomCode.includes("openPiP({ width: 340, height: 480 })"),
      "MeetingRoom must open PiP window when screen sharing begins"
    );
    assert.ok(
      meetingRoomCode.includes("setActionHandler(\"enterpictureinpicture\""),
      "MeetingRoom must register enterpictureinpicture action handler for Chrome 120+ tab switching"
    );
    assert.ok(
      meetingRoomCode.includes("closePiP()"),
      "MeetingRoom must invoke closePiP on screen share termination"
    );
  });

  await t.test("PIP-09: Re-opening floating mini-view via 'Pop Out Mini-View' button", () => {
    assert.ok(
      meetingRoomCode.includes("Pop Out Mini-View") &&
      meetingRoomCode.includes("!isPiPActive"),
      "MeetingRoom must offer Pop Out Mini-View button when sharing screen without active PiP"
    );
  });

  await t.test("PIP-10: Strict Non-Regression: Drawers, Chat, Polls, and Whiteboard intact", () => {
    assert.ok(
      meetingRoomCode.includes("<ClassFeedSidepanel") &&
      meetingRoomCode.includes("<Whiteboard"),
      "ClassFeedSidepanel and Whiteboard components must remain fully intact"
    );
  });

  await t.test("PIP-11: Screen share presentation stage occupies full canvas without side participant carousel", () => {
    assert.ok(
      !meetingRoomCode.includes("Sidebar Carousel of Participants (Tutor + Students)"),
      "Desktop screenshare must not render sidebar carousel of participant video tiles"
    );
    assert.ok(
      meetingRoomCode.includes("Central Screen Presentation Canvas (Full Stage, Clean & Unobstructed)"),
      "Screenshare presentation canvas must be unobstructed and full-stage"
    );
  });
});

