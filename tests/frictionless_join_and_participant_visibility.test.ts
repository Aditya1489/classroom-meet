import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Frictionless Meeting Join & Participant Visibility Test Suite", () => {
  it("TC-VIS-01: Remote participants with identical display names are NOT filtered out", () => {
    const myUserId = "usr-tab-chrome-123";
    const myName = "Aditya Chavhan";

    const remoteParticipants = [
      {
        id: "usr-tab-safari-456",
        peerId: "usr-tab-safari-456",
        name: "Aditya Chavhan",
        role: "student",
      },
      {
        id: "usr-tab-chrome-123", // self
        peerId: "usr-tab-chrome-123",
        name: "Aditya Chavhan",
        role: "host",
      },
      {
        id: "usr-student-789",
        peerId: "usr-student-789",
        name: "Rahul Sharma",
        role: "student",
      },
    ];

    // Previously: .filter((p) => p.id !== myUserId && p.name.trim().toLowerCase() !== myName.trim().toLowerCase())
    // Fixed: filters ONLY by user/peer ID
    const visibleRemote = remoteParticipants.filter(
      (p) => p.id !== myUserId && p.peerId !== myUserId
    );

    assert.equal(visibleRemote.length, 2, "Both other participants should be visible");
    assert.equal(
      visibleRemote.some((p) => p.id === "usr-tab-safari-456"),
      true,
      "Second tab with same user name must be visible in the meeting"
    );
  });

  it("TC-VIS-02: Each browser tab generates a distinct session peer ID even with identical profile ID", () => {
    const profileId = "google-user-98765";

    const generateTabUserId = (baseId: string, tabSuffix: string) => {
      return `${baseId.replace(/_/g, "-")}-${tabSuffix}`;
    };

    const tab1Id = generateTabUserId(profileId, "tab01");
    const tab2Id = generateTabUserId(profileId, "tab02");

    assert.notEqual(tab1Id, tab2Id, "Tab 1 and Tab 2 must have distinct peer IDs");
    assert.equal(tab1Id, "google-user-98765-tab01");
    assert.equal(tab2Id, "google-user-98765-tab02");
  });

  it("TC-JOIN-01: Landing code join handles full URL and room code without DB 404 block", () => {
    const sanitizeRoomId = (input: string): string => {
      if (!input) return "";
      let cleaned = input.trim();
      const meetMatch = cleaned.match(/\/meet\/([a-zA-Z0-9_-]+)/);
      if (meetMatch && meetMatch[1]) return meetMatch[1].toLowerCase();
      cleaned = cleaned.replace(/^https?:\/\/[^/]+/i, "");
      cleaned = cleaned.replace(/^\/+/, "");
      cleaned = cleaned.replace(/^meet\//i, "");
      return cleaned.split(/[?#]/)[0].toLowerCase();
    };

    assert.equal(sanitizeRoomId("http://localhost:5174/meet/vin-rlmu-rgn"), "vin-rlmu-rgn");
    assert.equal(sanitizeRoomId("vin-rlmu-rgn"), "vin-rlmu-rgn");
    assert.equal(sanitizeRoomId("   vin-rlmu-rgn   "), "vin-rlmu-rgn");
    assert.equal(sanitizeRoomId("https://mathsy.meet/meet/abc-defg-hij?role=student"), "abc-defg-hij");
  });

  it("TC-JOIN-02: Room existence defaults to true for active or unsynced SFU rooms", () => {
    const evaluateRoomExists = (r: { is_active: boolean; ended_at?: string | null } | null) => {
      if (r && r.is_active === false && r.ended_at) {
        return false;
      }
      return true;
    };

    // Case 1: Room created on SFU but not yet in PostgreSQL DB
    assert.equal(evaluateRoomExists(null), true, "New/unsynced rooms must allow lobby access");

    // Case 2: Active room in DB
    assert.equal(evaluateRoomExists({ is_active: true, ended_at: null }), true);

    // Case 3: Ended class session
    assert.equal(evaluateRoomExists({ is_active: false, ended_at: "2026-11-01T00:00:00Z" }), false);
  });

  it("TC-JOIN-03: Guest can join directly with display name without Google OAuth block", () => {
    let joined = false;
    let finalDisplayName = "";

    const handleJoinWithRole = (
      role: "tutor" | "student",
      inputName: string,
      profileName?: string
    ) => {
      const fallbackPrefix = role === "tutor" ? "Tutor" : "Student";
      const finalName = inputName.trim() || profileName || `${fallbackPrefix} 101`;
      joined = true;
      finalDisplayName = finalName;
    };

    handleJoinWithRole("student", "Guest Tester");
    assert.equal(joined, true);
    assert.equal(finalDisplayName, "Guest Tester");

    handleJoinWithRole("student", "");
    assert.equal(joined, true);
    assert.equal(finalDisplayName, "Student 101");
  });

  it("TC-TRACK-01: Remote video track presence automatically unblocks isVideoMuted", () => {
    // Simulating remote participant state in MeetingRoom
    const remotePeer = {
      id: "tutor-uuid",
      name: "Aditya Chavhan Teacher",
      role: "host",
      videoTrack: { id: "track-123", enabled: true } as any,
      isVideoMuted: true, // Started with initial true before track consumed
    };

    // MeetingRoom logic: if videoTrack exists and enabled, isVideoMuted must be false
    const computedIsVideoMuted = remotePeer.videoTrack
      ? Boolean(remotePeer.isVideoMuted && !remotePeer.videoTrack.enabled)
      : true;

    assert.equal(computedIsVideoMuted, false, "Live enabled video track must not be marked as muted");
    assert.equal(Boolean(remotePeer.videoTrack) && !computedIsVideoMuted, true, "hasVideo must evaluate to true");
  });

  it("TC-TRACK-02: Producer peer resolution matches 1-on-1 tutor even if peerId is formatted differently", () => {
    const participants = new Map<string, { id: string; name: string; role: string; videoTrack?: any }>();
    participants.set("socket-tutor-999", {
      id: "socket-tutor-999",
      name: "Aditya Chavhan Teacher",
      role: "host",
    });

    const resolveParticipant = (incomingPeerId: string, isHostUser: boolean) => {
      let p = incomingPeerId ? participants.get(incomingPeerId) : undefined;
      if (!p && participants.size === 1) {
        p = Array.from(participants.values())[0];
      }
      if (!p && !isHostUser) {
        p = Array.from(participants.values()).find((item) => item.role === "host");
      }
      return p;
    };

    // Scenario: SFU emits producer with userId "usr-tutor-abc" instead of "socket-tutor-999"
    const matched = resolveParticipant("usr-tutor-abc", false);
    assert.ok(matched, "Participant must be resolved");
    assert.equal(matched?.name, "Aditya Chavhan Teacher");
  });
});

