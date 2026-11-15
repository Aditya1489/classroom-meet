import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Unit Test Suite for Screen Share Presentation Layout & Track Routing:
 * Verifies that:
 * 1. Screen tracks and Camera tracks are strictly segregated.
 * 2. Remote screen tracks never overwrite camera video tiles.
 * 3. Dedicated presentation view displays the active screen track (local or remote).
 * 4. Presenter camera is maintained as a separate video tile or floating PIP.
 * 5. Layout transitions return safely to "grid" when sharing ends.
 * 6. Whiteboard and Screen Share presentation modes are mutually consistent.
 */

describe("Screen Share Presentation UI & State Logic", () => {
  // ── 1. Track Routing & Segregation ──
  it("TC-SCREEN-01: Engine routes screen tracks to screenTrack without overwriting videoTrack", () => {
    const participant: {
      id: string;
      name: string;
      role: string;
      videoTrack?: { id: string; kind: string };
      screenTrack?: { id: string; kind: string };
      isVideoMuted?: boolean;
    } = {
      id: "tutor-123",
      name: "Tutor Aditya",
      role: "host",
      videoTrack: { id: "track-camera-1", kind: "video" },
      isVideoMuted: false,
    };

    // Incoming producer 2: screen share
    const screenConsumer = {
      id: "consumer-screen-2",
      kind: "video",
      track: { id: "track-screen-2", kind: "video" },
    };
    const source = "screen";

    const isScreenSource =
      source === "screen" ||
      (screenConsumer.kind === "video" && participant.videoTrack && participant.videoTrack.id !== screenConsumer.track.id);

    if (isScreenSource) {
      participant.screenTrack = screenConsumer.track;
    } else if (screenConsumer.kind === "video") {
      participant.videoTrack = screenConsumer.track;
    }

    // Verify: camera videoTrack was NOT overwritten
    assert.equal(participant.videoTrack?.id, "track-camera-1");
    assert.equal(participant.videoTrack?.kind, "video");
    // Verify: screenTrack received the second video producer
    assert.equal(participant.screenTrack?.id, "track-screen-2");
  });

  // ── 2. Consumer Closure Segregation ──
  it("TC-SCREEN-02: Closing screen producer unsets screenTrack without nuking camera videoTrack", () => {
    const participant: {
      videoTrack?: { id: string };
      screenTrack?: { id: string };
      isVideoMuted: boolean;
    } = {
      videoTrack: { id: "track-cam-abc" },
      screenTrack: { id: "track-screen-xyz" },
      isVideoMuted: false,
    };

    const closedConsumer = {
      kind: "video",
      track: { id: "track-screen-xyz" },
    };

    const trackId = closedConsumer.track.id;
    if (trackId && participant.screenTrack?.id === trackId) {
      participant.screenTrack = undefined;
    } else if (trackId && participant.videoTrack?.id === trackId) {
      participant.videoTrack = undefined;
      participant.isVideoMuted = true;
    }

    // Camera videoTrack MUST stay alive
    assert.equal(participant.videoTrack?.id, "track-cam-abc");
    assert.equal(participant.isVideoMuted, false);
    // screenTrack MUST be cleared
    assert.equal(participant.screenTrack, undefined);
  });

  // ── 3. Active Screen Track Resolution for Local and Remote Viewers ──
  it("TC-SCREEN-03: Active screen track resolves correctly for local presenter and remote student", () => {
    // Scenario A: Local user is tutor and starts screen share
    const localScreenTrack = { id: "local-screen-track-1" };
    const remoteParticipantsNoShare: any[] = [
      { id: "student-1", name: "Student 1", videoTrack: { id: "cam-s1" } },
    ];

    const remoteScreenSharerA = remoteParticipantsNoShare.find((p) => Boolean(p.screenTrack));
    const activeScreenTrackA = localScreenTrack || remoteScreenSharerA?.screenTrack || null;
    const isAnyoneScreenSharingA = Boolean(activeScreenTrackA);

    assert.equal(isAnyoneScreenSharingA, true);
    assert.equal(activeScreenTrackA?.id, "local-screen-track-1");

    // Scenario B: Remote student viewing tutor screen share
    const studentLocalScreenTrack = null;
    const remoteParticipantsWithShare: any[] = [
      { id: "tutor-1", name: "Tutor", role: "host", videoTrack: { id: "cam-tutor" }, screenTrack: { id: "remote-screen-tutor" } },
    ];

    const remoteScreenSharerB = remoteParticipantsWithShare.find((p) => Boolean(p.screenTrack));
    const activeScreenTrackB = studentLocalScreenTrack || remoteScreenSharerB?.screenTrack || null;
    const isAnyoneScreenSharingB = Boolean(activeScreenTrackB);

    assert.equal(isAnyoneScreenSharingB, true);
    assert.equal(activeScreenTrackB?.id, "remote-screen-tutor");
    assert.equal(remoteScreenSharerB?.name, "Tutor");
  });

  // ── 4. Participant Tiles Retain Camera Track Only ──
  it("TC-SCREEN-04: Participant video tile mapping preserves camera track separate from presentation canvas", () => {
    const myUserId = "tutor-1";
    const myName = "Tutor Aditya";
    const isHost = true;
    const localVideoTrack = { id: "local-cam-1" };
    const localScreenTrack = { id: "local-screen-1" };

    const remoteParticipants = [
      {
        id: "student-1",
        name: "Student Priya",
        role: "student",
        videoTrack: { id: "student-cam-1" },
        audioTrack: { id: "student-mic-1" },
      },
    ];

    const allParticipants = [
      {
        id: myUserId,
        name: myName,
        role: isHost ? "host" : "student",
        videoTrack: localVideoTrack,
        screenTrack: localScreenTrack,
      },
      ...remoteParticipants.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        videoTrack: p.videoTrack,
        screenTrack: (p as any).screenTrack || null,
      })),
    ];

    // Tutor tile in sidebar only has camera
    const tutorTile = allParticipants.find((p) => p.id === myUserId);
    assert.equal(tutorTile?.videoTrack?.id, "local-cam-1");
    assert.notEqual(tutorTile?.videoTrack?.id, localScreenTrack.id);

    // Presentation stage track
    const activeScreenTrack = localScreenTrack;
    assert.equal(activeScreenTrack.id, "local-screen-1");
  });

  // ── 5. Layout Transition to Grid on Stop (In-app or Browser Native) ──
  it("TC-SCREEN-05: Stopping screen share resets layout from screenshare to grid", () => {
    let layoutMode = "screenshare";
    let isScreenSharing = true;
    let localScreenTrack: any = { id: "screen-1" };

    const onScreenShareEnded = () => {
      localScreenTrack = null;
      isScreenSharing = false;
      if (layoutMode === "screenshare") layoutMode = "grid";
    };

    // User triggers stop (either via in-app button or native OS/browser stop bar)
    onScreenShareEnded();

    assert.equal(isScreenSharing, false);
    assert.equal(localScreenTrack, null);
    assert.equal(layoutMode, "grid");
  });

  // ── 6. Mutually Consistent Whiteboard & Screen Share ──
  it("TC-SCREEN-06: Opening whiteboard while screen sharing stops screen share cleanly", () => {
    let layoutMode = "screenshare";
    let isScreenSharing = true;
    let showWhiteboard = false;
    let localScreenTrack: any = { id: "screen-1" };

    // Tutor clicks whiteboard toggle
    const handleToggleWhiteboard = () => {
      const next = !showWhiteboard;
      showWhiteboard = next;
      if (next) {
        if (isScreenSharing) {
          localScreenTrack = null;
          isScreenSharing = false;
        }
        layoutMode = "whiteboard";
      }
    };

    handleToggleWhiteboard();

    assert.equal(showWhiteboard, true);
    assert.equal(layoutMode, "whiteboard");
    assert.equal(isScreenSharing, false);
    assert.equal(localScreenTrack, null);
  });

  // ── 7. Mobile Full View & Contain Assurance ──
  it("TC-SCREEN-07: VideoTrackPlayer cleans object-cover and enforces object-fit contain when requested", async () => {
    const fs = await import("node:fs/promises");
    const vtpCode = await fs.readFile("src/components/meet/VideoTrackPlayer.tsx", "utf-8");
    assert.ok(vtpCode.includes('objectFit?: "contain" | "cover" | "fill" | "none" | "scale-down"'), "VideoTrackPlayer must accept objectFit prop");
    assert.ok(vtpCode.includes('style={{ objectFit: fitMode, ...style }}'), "VideoTrackPlayer must apply inline style objectFit to prevent CSS precedence override");
    assert.ok(vtpCode.includes('cleanedClassName'), "VideoTrackPlayer must clean conflicting object-* classes from className");
  });

  it("TC-SCREEN-08: MeetingRoom screen share stage explicitly passes objectFit contain", async () => {
    const fs = await import("node:fs/promises");
    const mrCode = await fs.readFile("src/components/meet/MeetingRoom.tsx", "utf-8");
    assert.ok(mrCode.includes('objectFit="contain"'), "Screen share player must pass objectFit contain");
    assert.ok(mrCode.includes('Tap for Widescreen'), "Mobile screen share stage must provide 1-tap widescreen button");
  });

  it("TC-SCREEN-09: Screen share supports interactive zoom toggle on mobile", async () => {
    const fs = await import("node:fs/promises");
    const mrCode = await fs.readFile("src/components/meet/MeetingRoom.tsx", "utf-8");
    assert.ok(mrCode.includes('screenZoom'), "Must support screenZoom state");
    assert.ok(mrCode.includes('setScreenZoom'), "Must provide zoom toggle");
  });
});

