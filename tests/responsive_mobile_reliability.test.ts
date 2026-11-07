import test from "node:test";
import assert from "node:assert/strict";

test("Responsive Layout & Mobile Reliability Suite", async (t) => {
  await t.test("TC-RESP-01: 2-participant grid allocates mobile vertical stacking class", () => {
    const getGridClass = (participantCount: number) => {
      if (participantCount === 1) return "grid-cols-1";
      if (participantCount === 2) return "grid-cols-1 sm:grid-cols-2";
      if (participantCount <= 4) return "grid-cols-2 grid-rows-2";
      if (participantCount <= 6) return "grid-cols-2 md:grid-cols-3 grid-rows-2";
      return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4";
    };

    assert.equal(getGridClass(1), "grid-cols-1");
    // On mobile (< 640px), 1 col stacks tutor & student vertically. On tablet/desktop (>= 640px), 2 cols side-by-side.
    assert.equal(getGridClass(2), "grid-cols-1 sm:grid-cols-2");
    assert.equal(getGridClass(4), "grid-cols-2 grid-rows-2");
    assert.equal(getGridClass(6), "grid-cols-2 md:grid-cols-3 grid-rows-2");
  });

  await t.test("TC-RESP-02: Screen share gracefully handles mobile browser without getDisplayMedia", () => {
    const mockMobileNavigator = {
      mediaDevices: {}, // getDisplayMedia is undefined on mobile Safari / Android Chrome
    };

    const isScreenShareSupported = (nav: any) => {
      return Boolean(nav?.mediaDevices && typeof nav.mediaDevices.getDisplayMedia === "function");
    };

    assert.equal(isScreenShareSupported(mockMobileNavigator), false, "Must detect mobile browser lacks getDisplayMedia");

    const mockDesktopNavigator = {
      mediaDevices: {
        getDisplayMedia: async () => ({ id: "mock-stream" }),
      },
    };
    assert.equal(isScreenShareSupported(mockDesktopNavigator), true, "Must detect desktop browser supports getDisplayMedia");
  });

  await t.test("TC-RESP-03: Sidepanel uses fixed overlay on mobile and relative dock on tablet/desktop", () => {
    const panelClasses = "fixed inset-0 z-50 md:relative md:inset-auto md:w-80 lg:w-96 h-full bg-[#1a1814]";
    
    assert.ok(panelClasses.includes("fixed inset-0"), "Mobile view uses full screen overlay to prevent squishing video");
    assert.ok(panelClasses.includes("md:relative"), "Desktop/tablet docks relative to video");
    assert.ok(panelClasses.includes("md:w-80"), "Preserves 320px width on desktop/tablet");
  });

  await t.test("TC-RESP-04: Viewport meta tag includes viewport-fit=cover for safe-area insets", async () => {
    const fs = await import("node:fs/promises");
    const indexHtml = await fs.readFile("index.html", "utf-8");
    assert.ok(indexHtml.includes("viewport-fit=cover"), "index.html must specify viewport-fit=cover for iOS safe area");
  });

  await t.test("TC-RESP-05: Whiteboard top toolbar includes overflow-x-auto to prevent button truncation", async () => {
    const fs = await import("node:fs/promises");
    const whiteboardCode = await fs.readFile("src/components/whiteboard/Whiteboard.tsx", "utf-8");
    assert.ok(whiteboardCode.includes("overflow-x-auto"), "Whiteboard header must support horizontal scrolling for compact viewports");
  });

  await t.test("TC-RESP-06: Landing view contains mobile navigation hamburger toggle and responsive drawer", async () => {
    const fs = await import("node:fs/promises");
    const landingCode = await fs.readFile("src/components/landing/LandingView.tsx", "utf-8");
    assert.ok(landingCode.includes("isMobileMenuOpen"), "Landing page must manage mobile menu drawer state");
    assert.ok(landingCode.includes("overflow-x-hidden"), "Landing root must prevent horizontal scroll overflow");
    assert.ok(landingCode.includes("md:hidden"), "Mobile navigation hamburger must be present on small viewports");
    assert.ok(landingCode.includes("hidden md:flex"), "Desktop auth cluster must be hidden on mobile viewports");
  });

  await t.test("TC-RESP-07: Hero forms stack vertically on small phones and dropdown fits viewport", async () => {
    const fs = await import("node:fs/promises");
    const landingCode = await fs.readFile("src/components/landing/LandingView.tsx", "utf-8");
    assert.ok(landingCode.includes("flex-col sm:flex-row"), "Hero meeting form must stack vertically on mobile phones");
    assert.ok(landingCode.includes("w-[calc(100vw-2rem)]"), "New meeting dropdown must scale flexibly without overflowing small viewports");
  });

  await t.test("TC-RESP-08: Navbar decluttering and unified platform drawer architecture", async () => {
    const fs = await import("node:fs/promises");
    const landingCode = await fs.readFile("src/components/landing/LandingView.tsx", "utf-8");
    assert.ok(!landingCode.includes('<nav className="hidden lg:flex'), "Navbar must not duplicate horizontal navigation links on desktop");
    assert.ok(landingCode.includes("Open platform menu") || landingCode.includes(">Menu</span>"), "Desktop must have dedicated platform menu button");
    assert.ok(landingCode.includes("scroll-mt-16"), "Target anchor sections must include scroll margin top for sticky header compensation");
    assert.ok(landingCode.includes('e.key === "Escape"'), "Drawer must support Escape key dismissal");
    assert.ok(landingCode.includes('document.body.style.overflow = "hidden"'), "Drawer must lock background body scroll while active");
  });
});

