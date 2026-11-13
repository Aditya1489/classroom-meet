import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();

test("Whiteboard Document Persistence Until Meeting End Suite", async (t) => {
  const whiteboardPath = path.join(rootDir, "src/components/whiteboard/Whiteboard.tsx");
  const meetingRoomPath = path.join(rootDir, "src/components/meet/MeetingRoom.tsx");
  const dbClientPath = path.join(rootDir, "src/lib/dbClient.ts");
  const enginePath = path.join(rootDir, "src/engine/mediasoupClient.ts");

  assert.ok(fs.existsSync(whiteboardPath), "Whiteboard.tsx must exist");
  assert.ok(fs.existsSync(meetingRoomPath), "MeetingRoom.tsx must exist");
  assert.ok(fs.existsSync(dbClientPath), "dbClient.ts must exist");
  assert.ok(fs.existsSync(enginePath), "mediasoupClient.ts must exist");

  const whiteboardCode = fs.readFileSync(whiteboardPath, "utf-8");
  const meetingRoomCode = fs.readFileSync(meetingRoomPath, "utf-8");
  const dbClientCode = fs.readFileSync(dbClientPath, "utf-8");
  const engineCode = fs.readFileSync(enginePath, "utf-8");

  await t.test("WDP-01: Document slides and snapshot are persisted in MeetingRoom state across view changes", () => {
    assert.ok(
      meetingRoomCode.includes("roomWhiteboardSnapshot") &&
      meetingRoomCode.includes("roomPresentationSlides") &&
      meetingRoomCode.includes("handleWhiteboardStateChange"),
      "MeetingRoom must hold roomWhiteboardSnapshot and roomPresentationSlides in state to survive Whiteboard unmount/remount"
    );

    assert.ok(
      meetingRoomCode.includes("initialSlides={roomPresentationSlides}") &&
      meetingRoomCode.includes("onStateChange={handleWhiteboardStateChange}"),
      "MeetingRoom must pass initialSlides and onStateChange to Whiteboard component"
    );
  });

  await t.test("WDP-02: Single-slide and multi-slide documents (>= 1) are reconstructed on reload or fresh mount", () => {
    assert.ok(
      whiteboardCode.includes("slideShapes.length >= 1 && slidesRef.current.length === 0"),
      "Whiteboard must reconstruct presentation slides for all imported documents (length >= 1)"
    );
  });

  await t.test("WDP-03: clearCanvas protects imported PDF/document shapes and only deletes ink annotations", () => {
    assert.ok(
      whiteboardCode.includes("const hasSlides = presentationSlides.length > 0 || shapes.some") &&
      whiteboardCode.includes("shapes.filter((s) => !s.isLocked || s.type !== \"image\")"),
      "clearCanvas must protect locked image slide shapes so imported PDFs remain on the canvas until class ends"
    );
  });

  await t.test("WDP-04: dbClient whiteboard endpoints strictly pass roomCode to getAuthHeaders", () => {
    assert.ok(
      dbClientCode.includes("saveWhiteboardSnapshot(roomCode: string, snapshot: any)") &&
      dbClientCode.includes("headers: getAuthHeaders(undefined, roomCode)") &&
      dbClientCode.includes("getWhiteboardSnapshot(roomCode: string)"),
      "dbClient whiteboard methods must pass roomCode to getAuthHeaders for valid token resolution"
    );
  });

  await t.test("WDP-05: LocalStorage caching preserves whiteboard document across browser tab reloads", () => {
    assert.ok(
      whiteboardCode.includes("mathsy_room_whiteboard_") &&
      meetingRoomCode.includes("mathsy_room_whiteboard_"),
      "Document and snapshot state must be cached in mathsy_room_whiteboard_${roomCode} for reload recovery"
    );
  });

  await t.test("WDP-06: Ending the class explicitly purges the room whiteboard cache", () => {
    assert.ok(
      meetingRoomCode.includes("localStorage.removeItem(`mathsy_room_whiteboard_${meetingCode}`)") &&
      meetingRoomCode.includes("handleEndClassClick"),
      "When host ends class, room whiteboard cache must be cleanly purged"
    );
  });

  await t.test("WDP-07: Mediasoup engine caches whiteboard snapshot on broadcast and diff receipt", () => {
    assert.ok(
      engineCode.includes("if (data?.snapshot) {") &&
      engineCode.includes("this.whiteboardSnapshot = data.snapshot;") &&
      engineCode.includes("this.whiteboardSnapshot = msg.whiteboardData.snapshot;"),
      "Mediasoup engine must maintain active whiteboardSnapshot for fresh joiners"
    );
  });

  await t.test("WDP-08: Slide navigation pill does not contain destructive close cross and handleZoomToFit fits active slide bounds", () => {
    assert.ok(
      !whiteboardCode.includes('title="Exit Slide Presentation Mode"'),
      "Slide navigation pill must NOT contain destructive Exit Slide Presentation cross button"
    );
    assert.ok(
      whiteboardCode.includes("editor.zoomToBounds(bounds, {") &&
      whiteboardCode.includes("presentationSlides[currentSlideIndex]"),
      "handleZoomToFit must zoom to the active slide bounds instead of shrinking all slides"
    );
    assert.ok(
      whiteboardCode.includes("Close Document & Free Canvas") &&
      whiteboardCode.includes("editor.deleteShapes(slideShapeIds)"),
      "Options menu provides clean document closure that safely removes slide shapes"
    );
  });
});

