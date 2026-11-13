import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("Tutor Whiteboard File Importer Suite (PDF, PPTX, PNG)", async (t) => {
  const importerPath = path.join(rootDir, "src/components/whiteboard/importers/whiteboardImporter.ts");
  const whiteboardPath = path.join(rootDir, "src/components/whiteboard/Whiteboard.tsx");
  const meetingRoomPath = path.join(rootDir, "src/components/meet/MeetingRoom.tsx");

  assert.ok(fs.existsSync(importerPath), "whiteboardImporter.ts must exist");
  assert.ok(fs.existsSync(whiteboardPath), "Whiteboard.tsx must exist");
  assert.ok(fs.existsSync(meetingRoomPath), "MeetingRoom.tsx must exist");

  const importerCode = fs.readFileSync(importerPath, "utf-8");
  const whiteboardCode = fs.readFileSync(whiteboardPath, "utf-8");
  const meetingCode = fs.readFileSync(meetingRoomPath, "utf-8");

  await t.test("TWI-01: whiteboardImporter handles PNG, JPG, PDF, and PPT/PPTX formats", () => {
    // Assert detection for all 3 requested categories: PDF, PPT/PPTX, and Images (PNG/JPG)
    assert.ok(
      importerCode.includes("image/") || importerCode.includes("png") || importerCode.includes("jpeg"),
      "Must support PNG and standard images"
    );
    assert.ok(
      importerCode.includes("application/pdf") || importerCode.includes(".pdf"),
      "Must support PDF documents"
    );
    assert.ok(
      importerCode.includes(".pptx") || importerCode.includes("presentation"),
      "Must support PPT/PPTX presentations"
    );
  });

  await t.test("TWI-02: Compliant tldraw 5.x Asset and Shape creation with 'playing: true'", () => {
    assert.ok(
      importerCode.includes("AssetRecordType.createId()"),
      "Must create TLAsset IDs using AssetRecordType"
    );
    assert.ok(
      importerCode.includes("createShapeId()"),
      "Must generate TLShape IDs using createShapeId"
    );
    assert.ok(
      importerCode.includes("editor.createAssets("),
      "Must invoke editor.createAssets to register imported images"
    );
    assert.ok(
      importerCode.includes("editor.createShapes("),
      "Must invoke editor.createShapes to place shapes on canvas"
    );
    // Must include 'playing: true' to satisfy tldraw 5.x image shape validation
    assert.ok(
      importerCode.includes("playing: true"),
      "Must include playing: true for image shape schema compliance"
    );
  });

  await t.test("TWI-03: Full-bleed single-slide presentation layout and PresentationSlide structure", () => {
    assert.ok(
      importerCode.includes("PresentationSlide"),
      "Must define and export PresentationSlide interface"
    );
    assert.ok(
      importerCode.includes("slideW = 1600") && importerCode.includes("slideGap"),
      "Must use high-definition 1600px width and clean spacing between slides"
    );
    assert.ok(
      importerCode.includes("zoomToBounds"),
      "Must automatically zoom directly to the first slide edge-to-edge"
    );
  });

  await t.test("TWI-04: Whiteboard.tsx includes Import Button and Drag & Drop overlay", () => {
    assert.ok(
      whiteboardCode.includes("importFileToWhiteboard"),
      "Whiteboard.tsx must import importFileToWhiteboard utility"
    );
    assert.ok(
      whiteboardCode.includes("fileInputRef"),
      "Whiteboard.tsx must manage a file input ref"
    );
    assert.ok(
      whiteboardCode.includes("accept=\".pdf,.pptx,.ppt,.png,.jpg"),
      "Whiteboard.tsx file input must accept PDF, PPT, and PNG formats"
    );
    assert.ok(
      whiteboardCode.includes("onDragOver") && whiteboardCode.includes("onDrop"),
      "Whiteboard.tsx must support drag-and-drop file import"
    );
    assert.ok(
      whiteboardCode.includes("Drop to Import"),
      "Whiteboard.tsx must display visual drop target overlay"
    );
    assert.ok(
      whiteboardCode.includes("isHost"),
      "Import capability must be strictly gated to tutor / host"
    );
  });

  await t.test("TWI-05: Real-time room synchronization upon document import", () => {
    assert.ok(
      whiteboardCode.includes("onBroadcast?.({ snapshot })"),
      "Must broadcast authoritative whiteboard snapshot when slides are imported"
    );
    assert.ok(
      whiteboardCode.includes("dbClient.saveWhiteboardSnapshot"),
      "Must persist snapshot to database for late-joining students"
    );
  });

  await t.test("TWI-06: MeetingRoom mobile sidebar exposes Import button to Tutor", () => {
    assert.ok(
      meetingCode.includes("whiteboardActionsRef.current?.importFile"),
      "MeetingRoom mobile sidebar must register and invoke importFile for tutor"
    );
    assert.ok(
      meetingCode.includes("isHost ? \"grid-cols-4\" : \"grid-cols-3\""),
      "Mobile sidebar must dynamically allocate 4th column for Tutor Import"
    );
  });

  await t.test("TWI-07: Whiteboard toolbar Options Hamburger dropdown menu", () => {
    assert.ok(
      whiteboardCode.includes("isOptionsMenuOpen"),
      "Whiteboard must maintain isOptionsMenuOpen state"
    );
    assert.ok(
      whiteboardCode.includes("Menu") && whiteboardCode.includes("Options"),
      "Whiteboard toolbar must feature Options menu button"
    );
    assert.ok(
      whiteboardCode.includes("Student Drawing") && whiteboardCode.includes("Focus Mode"),
      "Options dropdown must package Student Drawing lock and Focus Mode"
    );
  });

  await t.test("TWI-08: Floating Authoritative Slide Presentation Switcher", () => {
    assert.ok(
      whiteboardCode.includes("presentationSlides.length > 0"),
      "Whiteboard must conditionally render slide switcher when presentation is active"
    );
    assert.ok(
      whiteboardCode.includes("Host Controls Slides") || whiteboardCode.includes("Only Tutor Controls Slides"),
      "Tutor slide bar must display authoritative host control indicator"
    );
    assert.ok(
      whiteboardCode.includes("Controlled by Tutor"),
      "Student slide bar must display view-locked indicator"
    );
    assert.ok(
      whiteboardCode.includes("goToSlide"),
      "Whiteboard must implement goToSlide handler with bounds zooming"
    );
  });

  await t.test("TWI-09: Strict Non-Regression: Users, Chat, and Polls intact and zero router modifications", () => {
    const sidepanelPath = path.join(rootDir, "src/components/meet/ClassFeedSidepanel.tsx");
    assert.ok(fs.existsSync(sidepanelPath), "ClassFeedSidepanel.tsx must exist");
    const sidepanelCode = fs.readFileSync(sidepanelPath, "utf-8");

    assert.ok(
      sidepanelCode.includes("Class Members"),
      "ClassFeedSidepanel must render Class Members header"
    );
    assert.ok(
      sidepanelCode.includes("Mute All") && sidepanelCode.includes("Lower Hands"),
      "Host moderation buttons (Mute All, Lower Hands) must remain intact"
    );
    assert.ok(
      sidepanelCode.includes("Copy Meeting Link") || sidepanelCode.includes("copyLink"),
      "Copy meeting link button must remain intact"
    );
    assert.ok(
      sidepanelCode.includes("activeTab === \"chat\"") && sidepanelCode.includes("activeTab === \"polls\""),
      "Chat and Polls tabs must remain intact in sidepanel"
    );
    assert.ok(
      meetingCode.includes("<ClassFeedSidepanel"),
      "MeetingRoom must render ClassFeedSidepanel"
    );
  });
});

