import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SDK_ROOT = path.resolve(__dirname, "../sdk");
const SDK_DIST = path.resolve(SDK_ROOT, "dist");

describe("Phase 5: SDK Package Build, Exports & React Integration Suite", () => {
  // --- TEST 1: Package JSON and Manifest Readiness ---
  it("TC-SDK-BUILD-01: Verifies package.json manifests, dual export maps, and files whitelist", () => {
    const pkgPath = path.join(SDK_ROOT, "package.json");
    assert.ok(fs.existsSync(pkgPath), "sdk/package.json must exist");

    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    assert.strictEqual(pkg.name, "@mathsy/meet-sdk");
    assert.ok(pkg.version, "Package version must be defined");
    assert.ok(pkg.main, "package.json must define main");
    assert.ok(pkg.module, "package.json must define module");
    assert.ok(pkg.types, "package.json must define types");

    // Dual export maps for root, server, browser, and react
    assert.ok(pkg.exports["."], "Exports must include '.'");
    assert.ok(pkg.exports["./server"], "Exports must include './server'");
    assert.ok(pkg.exports["./browser"], "Exports must include './browser'");
    assert.ok(pkg.exports["./react"], "Exports must include './react'");

    // Files whitelist
    assert.ok(Array.isArray(pkg.files), "package.json must include files array");
    assert.ok(pkg.files.includes("dist"), "files must include 'dist'");
    assert.ok(pkg.files.includes("README.md"), "files must include 'README.md'");

    // Peer dependencies for React
    assert.ok(pkg.peerDependencies?.react, "React must be a peer dependency");
    assert.ok(pkg.peerDependenciesMeta?.react?.optional, "React peer dependency should be optional");

    // README
    const readmePath = path.join(SDK_ROOT, "README.md");
    assert.ok(fs.existsSync(readmePath), "sdk/README.md must exist");
  });

  // --- TEST 2: Build Output Verification (Dual ESM, CJS, and .d.ts) ---
  it("TC-SDK-BUILD-02: Verifies compiled bundle artifacts exist for ESM, CommonJS, and TypeScript declarations", () => {
    assert.ok(fs.existsSync(SDK_DIST), "sdk/dist directory must exist after build");

    const expectedArtifacts = [
      "index.cjs",
      "index.mjs",
      "index.d.ts",
      "server.cjs",
      "server.mjs",
      "server.d.ts",
      "browser.cjs",
      "browser.mjs",
      "browser.d.ts",
      "react.cjs",
      "react.mjs",
      "react.d.ts",
    ];

    for (const file of expectedArtifacts) {
      const fullPath = path.join(SDK_DIST, file);
      assert.ok(fs.existsSync(fullPath), `Expected artifact 'dist/${file}' to exist`);
      const stat = fs.statSync(fullPath);
      assert.ok(stat.size > 0, `Artifact 'dist/${file}' must not be empty`);
    }
  });

  // --- TEST 3: CommonJS & ESM Consumption Verification ---
  it("TC-SDK-CONSUME-03: Successfully imports both ESM and CommonJS compiled outputs", async () => {
    // 1. ESM Root Import
    const esmIndex = await import(path.join(SDK_DIST, "index.mjs"));
    assert.ok(esmIndex.MathsyMeetServerClient, "ESM index must export MathsyMeetServerClient");
    assert.ok(esmIndex.embedMeeting, "ESM index must export embedMeeting");
    assert.ok(esmIndex.SecurityError, "ESM index must export SecurityError");

    // 2. ESM Server Subpath Import
    const esmServer = await import(path.join(SDK_DIST, "server.mjs"));
    assert.ok(esmServer.MathsyMeetServerClient, "ESM server must export MathsyMeetServerClient");

    // 3. ESM Browser Subpath Import
    const esmBrowser = await import(path.join(SDK_DIST, "browser.mjs"));
    assert.ok(esmBrowser.embedMeeting, "ESM browser must export embedMeeting");

    // 4. ESM React Subpath Import
    const esmReact = await import(path.join(SDK_DIST, "react.mjs"));
    assert.ok(esmReact.MathsyMeeting, "ESM react must export MathsyMeeting component");
    assert.ok(esmReact.useMathsyMeeting, "ESM react must export useMathsyMeeting hook");

    // 5. CJS Root & Subpath Imports
    const cjsIndex = require(path.join(SDK_DIST, "index.cjs"));
    assert.ok(cjsIndex.MathsyMeetServerClient, "CJS index must export MathsyMeetServerClient");
    assert.ok(cjsIndex.embedMeeting, "CJS index must export embedMeeting");
    assert.ok(cjsIndex.MathsyMeeting, "CJS index must export MathsyMeeting");

    const cjsServer = require(path.join(SDK_DIST, "server.cjs"));
    assert.ok(cjsServer.MathsyMeetServerClient, "CJS server must export MathsyMeetServerClient");

    const cjsBrowser = require(path.join(SDK_DIST, "browser.cjs"));
    assert.ok(cjsBrowser.embedMeeting, "CJS browser must export embedMeeting");

    const cjsReact = require(path.join(SDK_DIST, "react.cjs"));
    assert.ok(cjsReact.MathsyMeeting, "CJS react must export MathsyMeeting");
  });

  // --- TEST 4: Browser SDK Event Callbacks & Error Handling ---
  it("TC-SDK-CALLBACKS-04: Dispatches typed events through both option callbacks and controller.on listeners", () => {
    const { embedMeeting } = require(path.join(SDK_DIST, "browser.cjs"));

    let readyCallbackPayload: any = null;
    let errorCallbackPayload: any = null;
    let joinedListenerPayload: any = null;

    const mockIframe: any = {
      contentWindow: { postMessage: () => {} },
      style: {},
    };

    const mockContainer: any = {
      appendChild: () => {},
      removeChild: () => {},
    };

    const controller = embedMeeting({
      container: mockContainer,
      roomCode: "test-room-123",
      token: "header.payload.signature",
      embedBaseUrl: "http://localhost:5001",
      parentOrigin: "http://localhost:5002",
      _mockIframe: mockIframe,
      onReady: (p: any) => { readyCallbackPayload = p; },
      onError: (e: any) => { errorCallbackPayload = e; },
    });

    controller.on("joined", (p: any) => { joinedListenerPayload = p; });

    // Simulate incoming postMessage events from embed iframe
    controller._handleIncomingMessage({
      origin: "http://localhost:5001",
      data: { type: "meeting.ready", payload: { roomCode: "test-room-123" } },
    });

    controller._handleIncomingMessage({
      origin: "http://localhost:5001",
      data: { type: "meeting.joined", payload: { participantId: "p1", name: "Alice" } },
    });

    // Simulate ORIGIN_NOT_ALLOWED error event
    controller._handleIncomingMessage({
      origin: "http://localhost:5001",
      data: {
        type: "meeting.error",
        payload: {
          code: "ORIGIN_NOT_ALLOWED",
          message: "Origin 'http://localhost:5002' is not whitelisted by the organization.",
        },
      },
    });

    assert.deepStrictEqual(readyCallbackPayload, { roomCode: "test-room-123" });
    assert.deepStrictEqual(joinedListenerPayload, { participantId: "p1", name: "Alice" });
    assert.strictEqual(errorCallbackPayload?.code, "ORIGIN_NOT_ALLOWED");

    controller.destroy();
  });

  // --- TEST 5: Customer Portal Demo Workspace Dependency ---
  it("TC-SDK-DEMO-05: Customer portal declares @mathsy/meet-sdk dependency and resolves it cleanly", () => {
    const demoPkgPath = path.resolve(__dirname, "../demo/customer-portal/package.json");
    assert.ok(fs.existsSync(demoPkgPath), "demo package.json must exist");

    const demoPkg = JSON.parse(fs.readFileSync(demoPkgPath, "utf-8"));
    assert.ok(
      demoPkg.dependencies["@mathsy/meet-sdk"],
      "demo/customer-portal must declare '@mathsy/meet-sdk' as a dependency"
    );
  });

  // --- TEST 6: React Component & Hook Instantiation Verification ---
  it("TC-SDK-REACT-06: Verifies React MathsyMeeting element creation and useMathsyMeeting hook type", async () => {
    const React = await import("react");
    const { MathsyMeeting, useMathsyMeeting } = await import(path.join(SDK_DIST, "react.mjs"));

    assert.strictEqual(typeof MathsyMeeting, "function", "MathsyMeeting must be a React function component");
    assert.strictEqual(typeof useMathsyMeeting, "function", "useMathsyMeeting must be a function hook");

    // Create element with props
    const element = React.createElement(MathsyMeeting, {
      roomCode: "abc-defg-hij",
      token: "mock.token.sig",
      className: "test-meeting-class",
      onReady: () => {},
      onError: () => {},
    });

    assert.ok(React.isValidElement(element), "MathsyMeeting must return a valid React element");
    assert.strictEqual(element.props.roomCode, "abc-defg-hij");
    assert.strictEqual(element.props.token, "mock.token.sig");
    assert.strictEqual(element.props.className, "test-meeting-class");
  });
});
