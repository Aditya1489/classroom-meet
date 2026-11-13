import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Mediasoup Reconnect & Top Bar Slide Controls Suite", async (t) => {
  const rootDir = process.cwd();
  const mediasoupPath = path.join(rootDir, "src/engine/mediasoupClient.ts");
  const whiteboardPath = path.join(rootDir, "src/components/whiteboard/Whiteboard.tsx");
  const meetingRoomPath = path.join(rootDir, "src/components/meet/MeetingRoom.tsx");

  const mediasoupCode = fs.readFileSync(mediasoupPath, "utf-8");
  const whiteboardCode = fs.readFileSync(whiteboardPath, "utf-8");
  const meetingRoomCode = fs.readFileSync(meetingRoomPath, "utf-8");

  await t.test("MSC-01: Disconnect event safely cleans up stale WebRTC transports, consumers, and producers", () => {
    assert.ok(
      mediasoupCode.includes("this.sendTransport = null") &&
      mediasoupCode.includes("this.recvTransport = null"),
      "mediasoupClient must nullify sendTransport and recvTransport on disconnect"
    );
    assert.ok(
      mediasoupCode.includes("this.consumers.clear()") &&
      mediasoupCode.includes("this.producers.clear()"),
      "mediasoupClient must clear consumers and producers maps on disconnect"
    );
  });

  await t.test("MSC-02: roomJoined and handleActiveProducers ensure fresh transports on active socket session", () => {
    assert.ok(
      mediasoupCode.includes("await this.createTransports(roomId)") ||
      mediasoupCode.includes("this.createTransports(roomId)"),
      "roomJoined must always invoke createTransports on the active socket"
    );
    assert.ok(
      mediasoupCode.includes("createTransportsPromise"),
      "mediasoupClient must prevent concurrent race conditions with createTransportsPromise"
    );
  });

  await t.test("MSC-03: consumeTrack detects stale transport errors from server and transparently recovers", () => {
    assert.ok(
      mediasoupCode.includes("errStr.toLowerCase().includes(\"transport\") && errStr.toLowerCase().includes(\"not found\")"),
      "consumeTrack must detect Transport not found error from mediasoup server"
    );
    assert.ok(
      mediasoupCode.includes("this.createTransports(this.roomId || \"\")"),
      "consumeTrack must recreate transports upon detecting stale transport"
    );
    assert.ok(
      mediasoupCode.includes("return this.consumeTrack(producerId, peerId, kind, source)"),
      "consumeTrack must retry consuming the track with the fresh transport"
    );
  });

  await t.test("MSC-04: Slide controls embedded directly in top header alongside annotation tools", () => {
    assert.ok(
      whiteboardCode.includes('data-testid="header-slide-controls"'),
      "Whiteboard header must contain header-slide-controls inside the top bar"
    );
    assert.ok(
      whiteboardCode.includes("goToSlide(currentSlideIndex - 1)") &&
      whiteboardCode.includes("goToSlide(currentSlideIndex + 1)"),
      "Header slide controls must contain Previous and Next slide buttons"
    );
    assert.ok(
      whiteboardCode.includes("Host Controls Slides"),
      "Header slide controls must display authoritative Host Controls Slides badge"
    );
    assert.ok(
      whiteboardCode.includes("Zen View (Z)"),
      "Header slide controls must display Zen View toggle button"
    );
  });

  await t.test("MSC-05: Canvas surface is free of floating presentation switcher dock", () => {
    // Assert that the canvas surface container does not have floating slide switcher
    assert.doesNotMatch(
      whiteboardCode,
      /className=\{\`absolute z-30 flex items-center gap-1\.5 sm:gap-2 px-3\.5 py-1\.5 rounded-full bg-\[\#16130f\]\/95/,
      "Canvas surface must not render floating slide presentation dock"
    );
  });

  await t.test("MSC-06: Strict Non-Regression: Users, Chat, and Polls intact", () => {
    assert.ok(
      meetingRoomCode.includes("activeSideTab") &&
      meetingRoomCode.includes("isSideDrawerOpen") &&
      meetingRoomCode.includes("<ClassFeedSidepanel"),
      "MeetingRoom.tsx drawers must remain completely intact"
    );
  });
});

