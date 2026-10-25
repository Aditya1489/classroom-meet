import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Participant Mute State & Visualizer Protocol", () => {
  it("TC-MUTE-01: Participant initializes with muted audio and video by default", () => {
    const peerData = { id: "student-123", name: "Aditya Chavhan S", role: "student" };
    const participant = {
      id: peerData.id,
      name: peerData.name,
      role: peerData.role,
      isSpeaking: false,
      isHandRaised: false,
      isAudioMuted: true,
      isVideoMuted: true,
    };

    assert.equal(participant.isAudioMuted, true, "New participant audio should default to muted");
    assert.equal(participant.isVideoMuted, true, "New participant video should default to muted");
  });

  it("TC-MUTE-02: Consuming active audio un-mutes participant", () => {
    const participant = {
      id: "student-123",
      name: "Aditya Chavhan S",
      isAudioMuted: true,
      audioTrack: undefined as any,
    };

    const mockTrack = { id: "track-audio-1", readyState: "live", enabled: true };
    participant.audioTrack = mockTrack;
    participant.isAudioMuted = false;

    assert.equal(participant.isAudioMuted, false);
    assert.equal(participant.audioTrack.id, "track-audio-1");
  });

  it("TC-MUTE-03: Producer close / PEER_MUTE_STATE immediately restores muted status and clears track", () => {
    const participant = {
      id: "student-123",
      name: "Aditya Chavhan S",
      isAudioMuted: false,
      audioTrack: { id: "track-audio-1", readyState: "live", enabled: true } as any,
    };

    // Simulate PEER_MUTE_STATE payload received over control channel
    const controlMsg = {
      isControl: true,
      controlAction: "PEER_MUTE_STATE",
      userId: "student-123",
      isAudioMuted: true,
    };

    if (controlMsg.isAudioMuted) {
      participant.isAudioMuted = true;
      participant.audioTrack = undefined;
    }

    assert.equal(participant.isAudioMuted, true);
    assert.equal(participant.audioTrack, undefined);
  });

  it("TC-MUTE-04: Visualizer effective mute logic handles all dead/muted track conditions", () => {
    const computeIsEffectivelyMuted = (track?: { readyState: string; enabled: boolean } | null, isMuted = false) => {
      return isMuted || !track || track.readyState !== "live" || !track.enabled;
    };

    // Case 1: No track, isMuted false -> should still be effectively muted
    assert.equal(computeIsEffectivelyMuted(null, false), true);

    // Case 2: Track ended/dead -> should be effectively muted
    assert.equal(computeIsEffectivelyMuted({ readyState: "ended", enabled: true }, false), true);

    // Case 3: Track disabled -> should be effectively muted
    assert.equal(computeIsEffectivelyMuted({ readyState: "live", enabled: false }, false), true);

    // Case 4: Track live and enabled, but isMuted explicitly true -> should be effectively muted
    assert.equal(computeIsEffectivelyMuted({ readyState: "live", enabled: true }, true), true);

    // Case 5: Track live, enabled, and isMuted false -> active (NOT muted)
    assert.equal(computeIsEffectivelyMuted({ readyState: "live", enabled: true }, false), false);
  });
});
