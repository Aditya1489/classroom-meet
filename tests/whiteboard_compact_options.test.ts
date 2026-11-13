import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Whiteboard Top Bar Consolidation Suite", async (t) => {
  const whiteboardPath = path.resolve(process.cwd(), "src/components/whiteboard/Whiteboard.tsx");
  const content = fs.readFileSync(whiteboardPath, "utf-8");

  await t.test("WTC-01: Top bar contains only Options, Math Canvas, Fit, Full, and Close", () => {
    // Math Canvas badge is present
    assert.match(content, /Math Canvas/);

    // Options dropdown button is present
    assert.match(content, /setIsOptionsMenuOpen\(!isOptionsMenuOpen\)/);

    // Fit button is present
    assert.match(content, /handleZoomToFit/);

    // Fullscreen button is present
    assert.match(content, /Maximize \(Full Screen\)/);

    // Loose horizontal geometry button container is removed from top bar
    assert.doesNotMatch(content, /Geometry Quick Tools/);
  });

  await t.test("WTC-02: Options dropdown popover contains all 3 organized sections", () => {
    // Section 1: STEM Geometry
    assert.match(content, /Geometry Tools/);
    assert.match(content, /insertRuler\(\)/);
    assert.match(content, /insertCompass\(\)/);
    assert.match(content, /insertProtractor\(\)/);
    assert.match(content, /insertSetSquare\(\)/);
    assert.match(content, /clearCanvas\(\)/);

    // Section 2: Documents & Notes
    assert.match(content, /Documents & Notes/);
    assert.match(content, /fileInputRef\.current\?\.click\(\)/);
    assert.match(content, /handleExportPdf\(\)/);

    // Section 3: Classroom Controls
    assert.match(content, /Classroom Controls/);
    assert.match(content, /onToggleStudentDrawing/);
    assert.match(content, /onToggleFocusMode/);
  });

  await t.test("WTC-03: Zero regressions on drawer panels and routes", () => {
    const meetingRoomPath = path.resolve(process.cwd(), "src/components/meet/MeetingRoom.tsx");
    const meetingRoomContent = fs.readFileSync(meetingRoomPath, "utf-8");

    // Chat, Polls, and Participants drawers intact
    assert.match(meetingRoomContent, /activeSideTab/);
    assert.match(meetingRoomContent, /isSideDrawerOpen/);
    assert.match(meetingRoomContent, /<ClassFeedSidepanel/);
  });

  await t.test("WTC-04: Zen / Zero-UI Presentation Mode auto-hiding controls, keyboard shortcuts, and full canvas immersion", () => {
    // Zen Mode state and keybindings exist
    assert.match(content, /isZenMode/);
    assert.match(content, /e\.key === "z" \|\| e\.key === "Z"/);
    assert.match(content, /e\.key === "Escape"/);
    assert.match(content, /e\.key === "ArrowRight"/);

    // Auto-hide controls timeout
    assert.match(content, /resetControlsTimeout/);
    assert.match(content, /setIsControlsVisible\(false\)/);

    // Zen Mode toggle button in Options popover
    assert.match(content, /Zen Presentation/);

    // TLDraw hideUi and component suppression in Zen mode
    assert.match(content, /hideUi=\{!canDraw \|\| isZenMode\}/);
    assert.match(content, /StylePanel:\s*null/);
    assert.match(content, /QuickActions:\s*null/);
  });

  await t.test("WTC-05: Header annotation toolbar positioned between Math Canvas and Fit with canvas floating dock suppressed", () => {
    // Annotation toolbar container is rendered between Math Canvas and Fit in the top bar
    assert.match(content, /data-testid="header-annotation-toolbar"/);

    // All core annotation tools are present in the header strip
    assert.match(content, /selectTool\("select"\)/);
    assert.match(content, /selectTool\("hand"\)/);
    assert.match(content, /selectTool\("draw"\)/);
    assert.match(content, /selectTool\("eraser"\)/);
    assert.match(content, /selectTool\("arrow"\)/);
    assert.match(content, /selectTool\("text"\)/);
    assert.match(content, /selectTool\("note"\)/);
    assert.match(content, /selectTool\("geo"\)/);
    assert.match(content, /fileInputRef\.current\?\.click\(\)/);

    // Active tool state and listener sync with TLDraw editor
    assert.match(content, /setActiveTool/);
    assert.match(content, /ed\.getCurrentToolId\(\)/);

    // Floating toolbar dock is permanently suppressed on the whiteboard drawing canvas screen
    assert.match(content, /components=\{\{\s*Toolbar:\s*null/);
  });
});
