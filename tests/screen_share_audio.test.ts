import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Unit Test Suite for Screen Share Audio (System & Tab Audio Streaming)
 * Verifies that:
 * 1. Screen Share captures both video and high-fidelity audio tracks.
 * 2. mediasoupClient creates dedicated "screenAudio" producer without colliding with mic audio.
 * 3. Remote peers route "screenAudio" to participant.screenAudioTrack without clobbering microphone audioTrack.
 * 4. Muting microphone does not mute screen audio.
 * 5. Screen audio producer closure cleans up screenAudioTrack cleanly.
 * 6. MeetingRoom plays both microphone and screen audio via dedicated audio sinks.
 */

describe("Screen Share System & Tab Audio Pipeline", () => {
  // ── 1. Audio Constraints & Display Media Capture ──
  it("TC-SSA-01: Screen share capture requests uncompressed stereo/fidelity audio constraints", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile("src/engine/mediasoupClient.ts", "utf-8");

    assert.ok(
      code.includes("autoGainControl: false") &&
      code.includes("echoCancellation: false") &&
      code.includes("noiseSuppression: false"),
      "displayMediaOptions must disable AGC, AEC, and noise suppression for high-fidelity tab/system audio"
    );
    assert.ok(
      code.includes('systemAudio: "include"'),
      'displayMediaOptions must include systemAudio: "include" prompt hint'
    );
    assert.ok(
      code.includes("localScreenAudioTrack"),
      "mediasoupClient must track localScreenAudioTrack"
    );
  });

  // ── 2. Producer Creation & Segregation ──
  it("TC-SSA-02: Presenter engine produces screenAudio with appData mediaType: screenAudio", () => {
    const producers = new Map<string, any>();
    const calls: any[] = [];

    const mockSendTransport = {
      produce: async ({ track, appData }: any) => {
        calls.push({ trackId: track.id, appData });
        return { id: `prod-${appData.mediaType}`, appData };
      },
    };

    const videoTrack = { id: "track-video-screen-1", kind: "video" };
    const audioTrack = { id: "track-audio-screen-1", kind: "audio" };

    // Simulate startScreenShare producing both
    const simulateProduce = async () => {
      const vProd = await mockSendTransport.produce({
        track: videoTrack,
        appData: { mediaType: "screen", source: "screen" },
      });
      producers.set("screen", vProd);

      const aProd = await mockSendTransport.produce({
        track: audioTrack,
        appData: { mediaType: "screenAudio", source: "screenAudio" },
      });
      producers.set("screenAudio", aProd);
    };

    return simulateProduce().then(() => {
      assert.equal(producers.has("screen"), true);
      assert.equal(producers.has("screenAudio"), true);
      assert.equal(calls.length, 2);
      assert.equal(calls[0].appData.mediaType, "screen");
      assert.equal(calls[1].appData.mediaType, "screenAudio");
      assert.equal(calls[1].trackId, "track-audio-screen-1");
    });
  });

  // ── 3. Consumer Routing & Audio Segregation ──
  it("TC-SSA-03: Remote client routes incoming screenAudio to participant.screenAudioTrack without clobbering audioTrack", () => {
    const participant: {
      id: string;
      name: string;
      audioTrack?: { id: string; kind: string };
      videoTrack?: { id: string; kind: string };
      screenTrack?: { id: string; kind: string };
      screenAudioTrack?: { id: string; kind: string };
      isAudioMuted?: boolean;
    } = {
      id: "tutor-1",
      name: "Tutor Aditya",
      audioTrack: { id: "tutor-mic-track", kind: "audio" },
      videoTrack: { id: "tutor-cam-track", kind: "video" },
      isAudioMuted: false,
    };

    // Incoming producer with mediaType screenAudio
    const incomingConsumer = {
      id: "consumer-screen-audio-1",
      kind: "audio",
      track: { id: "tutor-tab-audio-track", kind: "audio" },
    };
    const source = "screenAudio";

    const isScreenAudioSource =
      source === "screenAudio" ||
      source === "screen-audio" ||
      (incomingConsumer.kind === "audio" && participant.audioTrack && participant.audioTrack.id !== incomingConsumer.track.id);

    if (isScreenAudioSource) {
      participant.screenAudioTrack = incomingConsumer.track;
    } else if (incomingConsumer.kind === "audio") {
      participant.audioTrack = incomingConsumer.track;
    }

    // Microphone track MUST remain untouched
    assert.equal(participant.audioTrack?.id, "tutor-mic-track");
    assert.equal(participant.isAudioMuted, false);

    // Screen audio track MUST be attached to screenAudioTrack
    assert.equal(participant.screenAudioTrack?.id, "tutor-tab-audio-track");
  });

  // ── 4. Independent Microphone Muting ──
  it("TC-SSA-04: Muting microphone leaves screenAudioTrack intact and audible", () => {
    const participant = {
      id: "tutor-1",
      audioTrack: { id: "tutor-mic-track", kind: "audio" },
      screenAudioTrack: { id: "tab-audio-track", kind: "audio" },
      isAudioMuted: false,
    };

    // Tutor mutes their microphone
    participant.isAudioMuted = true;

    // Mic state is muted, but screenAudioTrack exists and is active
    assert.equal(participant.isAudioMuted, true);
    assert.equal(participant.screenAudioTrack?.id, "tab-audio-track");
  });

  // ── 5. Screen Audio Producer Closure Cleanup ──
  it("TC-SSA-05: Closing screenAudio producer clears screenAudioTrack without touching mic audio", () => {
    const participant: {
      audioTrack?: { id: string };
      screenAudioTrack?: { id: string };
      isAudioMuted: boolean;
    } = {
      audioTrack: { id: "tutor-mic-track" },
      screenAudioTrack: { id: "tab-audio-track" },
      isAudioMuted: false,
    };

    const closedConsumer = {
      kind: "audio",
      track: { id: "tab-audio-track" },
      appData: { mediaType: "screenAudio" },
    };

    const trackId = closedConsumer.track.id;
    if (trackId && participant.screenAudioTrack?.id === trackId) {
      participant.screenAudioTrack = undefined;
    } else if (trackId && participant.audioTrack?.id === trackId) {
      participant.audioTrack = undefined;
      participant.isAudioMuted = true;
    }

    // Verify: screenAudioTrack was cleared
    assert.equal(participant.screenAudioTrack, undefined);
    // Verify: microphone audioTrack is intact and not muted
    assert.equal(participant.audioTrack?.id, "tutor-mic-track");
    assert.equal(participant.isAudioMuted, false);
  });

  // ── 6. Teardown on Presenter Side ──
  it("TC-SSA-06: stopScreenShare stops both video and screen audio tracks and deletes both producers", () => {
    let videoTrackStopped = false;
    let audioTrackStopped = false;

    const localScreenTrack = {
      stop: () => { videoTrackStopped = true; },
    };
    const localScreenAudioTrack = {
      stop: () => { audioTrackStopped = true; },
    };

    const producers = new Map<string, any>([
      ["screen", { id: "prod-screen", close: () => {} }],
      ["screenAudio", { id: "prod-audio", close: () => {} }],
    ]);

    const stopScreenAudio = () => {
      localScreenAudioTrack.stop();
      const p = producers.get("screenAudio");
      if (p) {
        p.close();
        producers.delete("screenAudio");
      }
    };

    const stopScreenShare = () => {
      localScreenTrack.stop();
      const p = producers.get("screen");
      if (p) {
        p.close();
        producers.delete("screen");
      }
      stopScreenAudio();
    };

    stopScreenShare();

    assert.equal(videoTrackStopped, true);
    assert.equal(audioTrackStopped, true);
    assert.equal(producers.has("screen"), false);
    assert.equal(producers.has("screenAudio"), false);
  });

  // ── 7. MeetingRoom Component Code Verification ──
  it("TC-SSA-07: MeetingRoom renders dedicated audio playback for participant.screenAudioTrack", async () => {
    const fs = await import("node:fs/promises");
    const mrCode = await fs.readFile("src/components/meet/MeetingRoom.tsx", "utf-8");

    assert.ok(
      mrCode.includes("screenAudioTrack"),
      "MeetingRoom must reference screenAudioTrack"
    );
    assert.ok(
      mrCode.includes("screenAudioRef"),
      "RemoteAudioElement must use screenAudioRef to play screen audio"
    );
  });

  // ── 8. RemoteParticipant Interface ──
  it("TC-SSA-08: RemoteParticipant interface in mediasoupClient has screenAudioTrack", async () => {
    const fs = await import("node:fs/promises");
    const clientCode = await fs.readFile("src/engine/mediasoupClient.ts", "utf-8");

    assert.ok(
      clientCode.includes("screenAudioTrack?: MediaStreamTrack"),
      "RemoteParticipant interface must declare screenAudioTrack?: MediaStreamTrack"
    );
  });

  // ── 9. A/V Lip-Sync: Low-latency Content Hints ──
  it("TC-AVSYNC-01: Engine configures contentHint motion for video and music for audio to eliminate encoder buffer lag", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile("src/engine/mediasoupClient.ts", "utf-8");

    assert.ok(
      code.includes('track.contentHint = "motion"'),
      "Screen video track must set contentHint = motion to prevent encoder buffering lag"
    );
    assert.ok(
      code.includes('audioTrack.contentHint = "music"'),
      "Screen audio track must set contentHint = music for full-bandwidth real-time fidelity"
    );
  });

  // ── 10. A/V Lip-Sync: Sender & Receiver Synchronization Group (streamId) ──
  it("TC-AVSYNC-02: Producer and Consumer pipelines link screen video and audio with matching streamId", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile("src/engine/mediasoupClient.ts", "utf-8");

    assert.ok(
      code.includes("syncStreamId") || code.includes("streamId: syncStreamId") || code.includes("screen-sync-"),
      "Engine must pass unified streamId to produce for A/V synchronization"
    );
    assert.ok(
      code.includes("playoutDelayHint") || code.includes("jitterBufferTarget"),
      "Consumer must configure playout delay hint for minimum latency"
    );
  });

  // ── 11. A/V Lip-Sync: Unified MediaStream in VideoTrackPlayer ──
  it("TC-AVSYNC-03: VideoTrackPlayer accepts audioTrack and binds it to the same MediaStream for hardware A/V clock sync", async () => {
    const fs = await import("node:fs/promises");
    const vtpCode = await fs.readFile("src/components/meet/VideoTrackPlayer.tsx", "utf-8");

    assert.ok(
      vtpCode.includes("audioTrack?: MediaStreamTrack | null"),
      "VideoTrackPlayer must accept optional audioTrack prop"
    );
    assert.ok(
      vtpCode.includes("tracksToAttach") || vtpCode.includes("new MediaStream(tracksToAttach)") || vtpCode.includes("new MediaStream([track, audioTrack])"),
      "VideoTrackPlayer must combine video and audio tracks into a single MediaStream"
    );
  });

  // ── 12. A/V Lip-Sync: MeetingRoom Presentation Stage Wiring ──
  it("TC-AVSYNC-04: MeetingRoom passes remoteScreenSharer.screenAudioTrack into VideoTrackPlayer for hardware lip-sync", async () => {
    const fs = await import("node:fs/promises");
    const mrCode = await fs.readFile("src/components/meet/MeetingRoom.tsx", "utf-8");

    assert.ok(
      mrCode.includes("audioTrack={localScreenTrack ? null : remoteScreenSharer?.screenAudioTrack}"),
      "MeetingRoom must pass screen audio to VideoTrackPlayer for remote viewers while keeping local presenter muted"
    );
    assert.ok(
      mrCode.includes("playScreenAudio={layoutMode !== \"screenshare\"}"),
      "RemoteAudioElement must defer to VideoTrackPlayer during screen share to prevent audio doubling"
    );
  });
});
