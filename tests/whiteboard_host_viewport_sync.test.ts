import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Whiteboard Host Viewport Sync & Mobile Full View Suite", async (t) => {
  const whiteboardPath = path.resolve(process.cwd(), "src/components/whiteboard/Whiteboard.tsx");
  const meetingRoomPath = path.resolve(process.cwd(), "src/components/meet/MeetingRoom.tsx");

  const whiteboardSrc = fs.readFileSync(whiteboardPath, "utf-8");
  const meetingRoomSrc = fs.readFileSync(meetingRoomPath, "utf-8");

  await t.test("WHV-01: Whiteboard implements lastHostViewportRef and broadcastViewport", () => {
    assert.match(whiteboardSrc, /lastHostViewportRef\s*=\s*useRef/, "Must track host viewport bounds");
    assert.match(whiteboardSrc, /broadcastViewport\s*=\s*useCallback/, "Must have broadcastViewport helper");
    assert.match(whiteboardSrc, /type:\s*["']viewport["']/, "Must broadcast type: viewport");
  });

  await t.test("WHV-02: Whiteboard listens to camera movements to broadcast host viewport to participants", () => {
    assert.match(whiteboardSrc, /startsWith\(["']camera:["']\)/, "Must detect camera changes in store listener");
    assert.match(whiteboardSrc, /unlistenCamera/, "Must register unlistenCamera listener");
  });

  await t.test("WHV-03: Whiteboard handles remote viewport updates and requests", () => {
    assert.match(whiteboardSrc, /data\.type\s*===\s*["']viewport["']\s*&&\s*data\.bounds/, "Must handle remote viewport message");
    assert.match(whiteboardSrc, /editor\.zoomToBounds\(data\.bounds,\s*\{/, "Must zoom participant editor to host bounds");
    assert.match(whiteboardSrc, /data\.type\s*===\s*["']request-viewport["']/, "Must handle request-viewport from participants");
  });

  await t.test("WHV-04: Whiteboard zoomToFit prioritizes host viewport for participants", () => {
    assert.match(whiteboardSrc, /!isHost\s*&&\s*lastHostViewportRef\.current/, "zoomToFit must align to host viewport first");
    assert.match(whiteboardSrc, /editor\.zoomToBounds\(lastHostViewportRef\.current/, "Must zoom to lastHostViewportRef");
  });

  await t.test("WHV-05: MeetingRoom toggleFullscreen activates isFocusMode on mobile", () => {
    assert.match(meetingRoomSrc, /if\s*\(isMobile\)\s*setIsFocusMode\(true\)/, "toggleFullscreen must enable isFocusMode on mobile");
    assert.match(meetingRoomSrc, /if\s*\(isMobile\)\s*setIsFocusMode\(false\)/, "Exiting fullscreen must disable isFocusMode on mobile");
  });

  await t.test("WHV-06: MeetingRoom section and whiteboard card expand to edge-to-edge in Focus Mode", () => {
    assert.match(meetingRoomSrc, /isFocusMode\s*\?\s*["']p-0["']/, "Section must use p-0 in focus mode");
    assert.match(meetingRoomSrc, /isFocusMode\s*\?\s*["']rounded-none border-0["']/, "Whiteboard card must remove rounded corners in focus mode");
  });

  await t.test("WHV-07: Floating PiP camera is cleanly hidden in focus mode to prevent occluding the canvas", () => {
    assert.match(meetingRoomSrc, /if\s*\(isFocusMode\)\s*return null;/, "PiP camera must return null in focus mode");
  });

  await t.test("WHV-08: Tap for Full Screen button hides when already in focus mode", () => {
    assert.match(meetingRoomSrc, /!isFullscreen\s*&&\s*!isFocusMode/, "Fullscreen button must hide when already in focus mode");
  });
});
