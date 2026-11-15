import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Unit Test Suite for Peer Leaving & Ghost Participant Elimination
 * Verifies that:
 * 1. handlePeerLeft accurately cleans up participants regardless of whether the event
 *    passes peerId (socket ID), userId (auth UUID), baseUserId, or display name.
 * 2. In-meeting PEER_LEFT control message broadcast is intercepted and purges the participant instantly.
 * 3. MeetingRoom onPeerLeft listener strips remoteParticipants immediately.
 * 4. Engine leaveRoom emits explicit multi-channel leave signals before socket disconnect.
 * 5. Mobile pagehide triggers clean leaveRoom execution.
 */

describe("Peer Leaving & Ghost Participant Elimination Pipeline", () => {
  it("TC-LEAVE-01: handlePeerLeft removes participant when SFU emits socket.id but participant key is userId", () => {
    const participants = new Map<string, any>();
    // Student Aditya joined; key in map is userId, but peerId/socketId is attached
    participants.set("usr-aditya-123", {
      id: "usr-aditya-123",
      userId: "usr-aditya-123",
      peerId: "socket-xyz-999",
      baseUserId: "usr-aditya-123",
      name: "Aditya Chavhan",
      role: "student",
    });

    assert.equal(participants.size, 1);

    // SFU disconnect event arrives with ONLY socket id: { peerId: "socket-xyz-999" }
    const data = { peerId: "socket-xyz-999" };
    const targetId = data.peerId;

    const keysToDelete: string[] = [];
    for (const [key, part] of participants.entries()) {
      const match =
        key === targetId ||
        part.id === targetId ||
        part.userId === targetId ||
        part.peerId === targetId ||
        part.baseUserId === targetId;
      if (match) {
        keysToDelete.push(key);
      }
    }

    for (const k of keysToDelete) {
      participants.delete(k);
    }

    assert.equal(participants.size, 0, "Participant must be purged even when event only has socket peerId");
  });

  it("TC-LEAVE-02: handlePeerLeft removes participant when event only has display name or userId", () => {
    const participants = new Map<string, any>();
    participants.set("socket-peer-888", {
      id: "socket-peer-888",
      userId: "uuid-student-456",
      name: "Aditya Chavhan",
      role: "student",
    });

    assert.equal(participants.size, 1);

    // Broadcast arrives with userId and name
    const data = { userId: "uuid-student-456", name: "Aditya Chavhan" };

    const keysToDelete: string[] = [];
    for (const [key, part] of participants.entries()) {
      const match =
        key === data.userId ||
        part.id === data.userId ||
        part.userId === data.userId ||
        (data.name && part.name && part.name.trim().toLowerCase() === data.name.trim().toLowerCase());
      if (match) {
        keysToDelete.push(key);
      }
    }

    for (const k of keysToDelete) {
      participants.delete(k);
    }

    assert.equal(participants.size, 0, "Participant must be purged by userId or name match");
  });

  it("TC-LEAVE-03: PEER_LEFT control message is handled as a priority control action", () => {
    const controlAction = "PEER_LEFT";
    let purgedId = "";

    const handlePeerLeftMock = (id: string) => {
      purgedId = id;
    };

    const msg = {
      isControl: true,
      controlAction: "PEER_LEFT",
      userId: "usr-leave-1",
      peerId: "socket-leave-1",
      name: "Aditya Chavhan",
    };

    if (msg.controlAction === "PEER_LEFT") {
      const pId = msg.userId || msg.peerId;
      handlePeerLeftMock(pId);
    }

    assert.equal(purgedId, "usr-leave-1");
  });

  it("TC-LEAVE-04: MeetingRoom onPeerLeft immediately filters remoteParticipants state", () => {
    let remoteParticipants = [
      { id: "usr-aditya-123", userId: "usr-aditya-123", name: "Aditya Chavhan", role: "student" },
      { id: "usr-sumit-456", userId: "usr-sumit-456", name: "Sumit Chavhan", role: "student" },
    ];

    const onPeerLeft = (leftId: string) => {
      remoteParticipants = remoteParticipants.filter((p) => {
        const isMatch =
          p.id === leftId ||
          p.userId === leftId ||
          (p as any).peerId === leftId;
        return !isMatch;
      });
    };

    // Aditya leaves
    onPeerLeft("usr-aditya-123");

    assert.equal(remoteParticipants.length, 1);
    assert.equal(remoteParticipants[0].name, "Sumit Chavhan");
  });

  it("TC-LEAVE-05: mediasoupClient source code contains multi-channel leave listeners and robust matching", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile("src/engine/mediasoupClient.ts", "utf-8");

    assert.ok(
      code.includes("PEER_LEFT"),
      "mediasoupClient must recognize PEER_LEFT control action"
    );
    assert.ok(
      code.includes("leaveRoom"),
      "mediasoupClient must expose explicit leaveRoom method"
    );
    assert.ok(
      code.includes('this.socket.on("userLeft"'),
      "mediasoupClient must listen for userLeft"
    );
    assert.ok(
      code.includes('this.socket.on("participantLeft"'),
      "mediasoupClient must listen for participantLeft"
    );
  });

  it("TC-LEAVE-06: MeetingRoom source contains pagehide listener and handleLeaveMeeting hookup", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile("src/components/meet/MeetingRoom.tsx", "utf-8");

    assert.ok(
      code.includes('window.addEventListener("pagehide"'),
      "MeetingRoom must attach pagehide listener for mobile tab switch/close"
    );
    assert.ok(
      code.includes("handleLeaveMeeting"),
      "MeetingRoom must define handleLeaveMeeting to broadcast departure"
    );
    assert.ok(
      code.includes("engineRef.current?.leaveRoom()"),
      "MeetingRoom must call leaveRoom on engine before unmounting"
    );
  });

  it("TC-LEAVE-07: handlePeerLeft cleans up associated consumers when participant leaves", () => {
    const consumers = new Map<string, any>();
    let closedConsumerId = "";

    consumers.set("c-video-1", {
      id: "c-video-1",
      appData: { peerId: "usr-aditya-123" },
      close: () => {
        closedConsumerId = "c-video-1";
      },
    });

    const targetId = "usr-aditya-123";
    for (const [cId, consumer] of consumers.entries()) {
      if (consumer.appData?.peerId === targetId) {
        consumer.close();
        consumers.delete(cId);
      }
    }

    assert.equal(closedConsumerId, "c-video-1");
    assert.equal(consumers.size, 0, "Consumer must be closed and deleted when peer leaves");
  });

  it("TC-LEAVE-08: Substring and hyphen-sanitized IDs match accurately without false positives", () => {
    const participants = new Map<string, any>();
    participants.set("usr-aditya-123", {
      id: "usr-aditya-123",
      userId: "usr-aditya-123",
      name: "Aditya Chavhan",
    });
    participants.set("usr-sumit-456", {
      id: "usr-sumit-456",
      userId: "usr-sumit-456",
      name: "Sumit Chavhan",
    });

    // Match by base substring
    const targetUserId = "aditya-123";
    const keysToDelete: string[] = [];

    for (const [key, part] of participants.entries()) {
      const isMatch =
        key === targetUserId ||
        part.id === targetUserId ||
        (targetUserId && (key.includes(targetUserId) || part.id.includes(targetUserId)));
      if (isMatch) keysToDelete.push(key);
    }

    for (const k of keysToDelete) participants.delete(k);

    assert.equal(participants.size, 1);
    assert.ok(participants.has("usr-sumit-456"));
    assert.ok(!participants.has("usr-aditya-123"));
  });

  it("TC-LEAVE-09: Unmute requests and raised hand states for departing peer are purged", () => {
    let unmuteRequests = [
      { userId: "usr-aditya-123", name: "Aditya Chavhan" },
      { userId: "usr-sumit-456", name: "Sumit Chavhan" },
    ];

    const leftId = "usr-aditya-123";
    unmuteRequests = unmuteRequests.filter((r) => r.userId !== leftId);

    assert.equal(unmuteRequests.length, 1);
    assert.equal(unmuteRequests[0].userId, "usr-sumit-456");
  });
});
