import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Whiteboard Pen Color & Stroke Style Suite", async (t) => {
  const rootDir = process.cwd();
  const whiteboardPath = path.join(rootDir, "src/components/whiteboard/Whiteboard.tsx");
  const meetingRoomPath = path.join(rootDir, "src/components/meet/MeetingRoom.tsx");

  const whiteboardCode = fs.readFileSync(whiteboardPath, "utf-8");
  const meetingRoomCode = fs.readFileSync(meetingRoomPath, "utf-8");

  await t.test("PCS-01: Annotation toolbar contains header-pen-color-picker container", () => {
    assert.ok(
      whiteboardCode.includes('data-testid="header-pen-color-picker"'),
      "Whiteboard must contain data-testid='header-pen-color-picker' in annotation toolbar"
    );
  });

  await t.test("PCS-02: Instant 1-click swatches for high-frequency teaching colors (Black, Blue, Red, Green)", () => {
    assert.ok(
      whiteboardCode.includes('title={`Pen Color: ${c.label}`}') &&
      whiteboardCode.includes('label: "Black"') &&
      whiteboardCode.includes('label: "Blue"') &&
      whiteboardCode.includes('label: "Red"') &&
      whiteboardCode.includes('label: "Green"'),
      "Top bar must include instant 1-click swatches for Black, Blue, Red, and Green"
    );
  });

  await t.test("PCS-03: Palette popover features complete 12-color palette and stroke thicknesses", () => {
    assert.ok(
      whiteboardCode.includes("PEN_COLORS") &&
      whiteboardCode.includes("PEN_SIZES"),
      "Whiteboard must define PEN_COLORS and PEN_SIZES constants"
    );
    assert.ok(
      whiteboardCode.includes("isColorMenuOpen"),
      "Whiteboard must maintain isColorMenuOpen popover state"
    );
    assert.ok(
      whiteboardCode.includes("Stroke Thickness"),
      "Color popover must offer stroke thickness selection"
    );
  });

  await t.test("PCS-04: selectColor and selectSize properly integrate with TLDraw DefaultColorStyle and DefaultSizeStyle", () => {
    assert.ok(
      whiteboardCode.includes("DefaultColorStyle") &&
      whiteboardCode.includes("DefaultSizeStyle"),
      "Whiteboard must import DefaultColorStyle and DefaultSizeStyle from tldraw"
    );
    assert.ok(
      whiteboardCode.includes("editor.setStyleForNextShapes(DefaultColorStyle") &&
      whiteboardCode.includes("editor.setStyleForSelectedShapes(DefaultColorStyle"),
      "selectColor must apply DefaultColorStyle for both next and selected shapes"
    );
    assert.ok(
      whiteboardCode.includes("editor.setStyleForNextShapes(DefaultSizeStyle") &&
      whiteboardCode.includes("editor.setStyleForSelectedShapes(DefaultSizeStyle"),
      "selectSize must apply DefaultSizeStyle for both next and selected shapes"
    );
  });

  await t.test("PCS-05: Pen tool icon displays active color indicator pip", () => {
    assert.ok(
      whiteboardCode.includes("activeColorHex"),
      "Pen icon must display active color pip matching activeColorHex"
    );
  });

  await t.test("PCS-06: Strict Non-Regression: Drawers, slide controls, and routes intact", () => {
    assert.ok(
      whiteboardCode.includes('data-testid="header-slide-controls"') &&
      whiteboardCode.includes('data-testid="header-annotation-toolbar"'),
      "Both slide controls and annotation toolbar must remain intact in Whiteboard"
    );
    assert.ok(
      meetingRoomCode.includes("activeSideTab") &&
      meetingRoomCode.includes("isSideDrawerOpen") &&
      meetingRoomCode.includes("<ClassFeedSidepanel"),
      "MeetingRoom.tsx drawers must remain completely intact"
    );
  });
});
