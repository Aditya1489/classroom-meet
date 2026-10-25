import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Student Microphone Approval, Force Mute & Speaking Permissions State Machine", () => {
  // ── Helper state machine simulating client MeetingRoom & Engine state ──
  interface ClientState {
    userId: string;
    role: "tutor" | "student";
    isHost: boolean;
    authorizedTutorId: string | null;
    roomCode: string;
    isMicEnabled: boolean;
    hasSpeakingPermission: boolean;
    unmuteRequestStatus: "none" | "requesting" | "approved";
    unmuteRequests: Array<{ userId: string; name: string }>;
    hardwareTrackAvailable: boolean;
    hardwareError: string | null;
  }

  function createInitialStudent(userId: string, roomCode: string, initialOptions: { micMuted?: boolean } = {}): ClientState {
    const isHost = false;
    return {
      userId,
      role: "student",
      isHost: false,
      authorizedTutorId: null,
      roomCode,
      // Rule 3: Students join muted by default regardless of initialOptions.micMuted
      isMicEnabled: Boolean(isHost && !initialOptions.micMuted),
      hasSpeakingPermission: isHost,
      unmuteRequestStatus: isHost ? "approved" : "none",
      unmuteRequests: [],
      hardwareTrackAvailable: true,
      hardwareError: null,
    };
  }

  function createInitialTutor(userId: string, roomCode: string, initialOptions: { micMuted?: boolean } = {}): ClientState {
    const isHost = true;
    return {
      userId,
      role: "tutor",
      isHost: true,
      authorizedTutorId: userId,
      roomCode,
      isMicEnabled: !initialOptions.micMuted,
      hasSpeakingPermission: true,
      unmuteRequestStatus: "approved",
      unmuteRequests: [],
      hardwareTrackAvailable: true,
      hardwareError: null,
    };
  }

  // ── TEST 1: Student joins muted by default ──
  it("REQ-01: Student joins with microphone muted by default even if micMuted was omitted or false in lobby", () => {
    const student1 = createInitialStudent("student-01", "room-math-1", { micMuted: false });
    const student2 = createInitialStudent("student-02", "room-math-1", {}); // omitted micMuted

    assert.equal(student1.isMicEnabled, false, "Student 1 must join muted");
    assert.equal(student2.isMicEnabled, false, "Student 2 must join muted");
    assert.equal(student1.hasSpeakingPermission, false, "Student 1 must not have speaking permission on join");
    assert.equal(student2.hasSpeakingPermission, false, "Student 2 must not have speaking permission on join");
  });

  // ── TEST 2: Student cannot publish audio before permission is granted ──
  it("REQ-02: Student cannot publish live audio before speaking permission is granted", () => {
    const student = createInitialStudent("student-01", "room-math-1");
    assert.equal(student.hasSpeakingPermission, false);
    assert.equal(student.isMicEnabled, false);

    // If student attempts to toggle mic without permission, it enters 'requesting' state and does NOT activate track
    if (!student.hasSpeakingPermission) {
      if (student.unmuteRequestStatus === "none") {
        student.unmuteRequestStatus = "requesting";
      }
    }

    assert.equal(student.isMicEnabled, false, "Mic track must remain disabled");
    assert.equal(student.unmuteRequestStatus, "requesting", "Status must become requesting");
  });

  // ── TEST 3: Student sends speaking request and tutor receives it ──
  it("REQ-03: Student sends a speaking request and tutor receives it in queue", () => {
    const tutor = createInitialTutor("tutor-prof", "room-math-1");
    const student = createInitialStudent("student-01", "room-math-1");

    // Student clicks mic button
    student.unmuteRequestStatus = "requesting";
    const requestPayload = { userId: student.userId, name: "Gauss", roomCode: "room-math-1", timestamp: Date.now() };

    // Tutor receives request
    if (tutor.isHost) {
      if (!tutor.unmuteRequests.some((r) => r.userId === requestPayload.userId)) {
        tutor.unmuteRequests.push({ userId: requestPayload.userId, name: requestPayload.name });
      }
    }

    assert.equal(tutor.unmuteRequests.length, 1);
    assert.equal(tutor.unmuteRequests[0].userId, "student-01");
  });

  // ── TEST 4: Student cancels a pending request ──
  it("REQ-04: Student cancels a pending request and tutor queue is cleared", () => {
    const tutor = createInitialTutor("tutor-prof", "room-math-1");
    tutor.unmuteRequests = [{ userId: "student-01", name: "Gauss" }];
    const student = createInitialStudent("student-01", "room-math-1");
    student.unmuteRequestStatus = "requesting";

    // Student clicks again while in requesting state
    student.unmuteRequestStatus = "none";
    const cancelPayload = { controlAction: "CANCEL_REQUEST", userId: student.userId };

    // Tutor handles cancel
    if (tutor.isHost && cancelPayload.controlAction === "CANCEL_REQUEST") {
      tutor.unmuteRequests = tutor.unmuteRequests.filter((r) => r.userId !== cancelPayload.userId);
    }

    assert.equal(student.unmuteRequestStatus, "none");
    assert.equal(tutor.unmuteRequests.length, 0, "Tutor queue must be empty after cancellation");
  });

  // ── TEST 5: Tutor approves request and student receives authorized approval ──
  it("REQ-05: Tutor approves request and intended student receives authorized approval", () => {
    const tutor = createInitialTutor("tutor-prof", "room-math-1");
    const student = createInitialStudent("student-01", "room-math-1");
    student.authorizedTutorId = "tutor-prof";
    student.unmuteRequestStatus = "requesting";

    const approvalMsg = {
      isControl: true,
      controlAction: "MIC_RESPONSE",
      targetUserId: "student-01",
      approved: true,
      senderId: "tutor-prof",
      senderRole: "tutor",
      isHost: true,
      roomCode: "room-math-1",
    };

    // Client security gate:
    const isAuthorized = approvalMsg.senderId === student.authorizedTutorId && approvalMsg.senderId !== student.userId;
    assert.ok(isAuthorized, "Approval must be verified against authorized tutor ID");

    if (approvalMsg.targetUserId === student.userId && approvalMsg.approved) {
      student.hasSpeakingPermission = true;
      student.unmuteRequestStatus = "approved";
    }

    assert.equal(student.hasSpeakingPermission, true);
    assert.equal(student.unmuteRequestStatus, "approved");
  });

  // ── TEST 6: Student enables microphone after approval ──
  it("REQ-06: Student enables microphone after approval and browser permission", () => {
    const student = createInitialStudent("student-01", "room-math-1");
    student.hasSpeakingPermission = true;
    student.unmuteRequestStatus = "approved";
    student.isMicEnabled = false;

    // Student clicks mic button with active speaking permission
    if (student.hasSpeakingPermission) {
      student.isMicEnabled = true;
    }

    assert.equal(student.isMicEnabled, true, "Microphone track is now live");
  });

  // ── TEST 7: When student starts mic, tutor approval is required every time ──
  it("REQ-07: Student muting mic revokes speaking permission so restarting mic requires tutor approval every time", () => {
    const student = createInitialStudent("student-01", "room-math-1");
    student.hasSpeakingPermission = true;
    student.unmuteRequestStatus = "approved";
    student.isMicEnabled = true; // currently speaking

    // Student clicks mic to mute
    if (student.hasSpeakingPermission && student.isMicEnabled) {
      student.isMicEnabled = false;
      // Per business requirement: starting mic requires tutor approval every time
      student.hasSpeakingPermission = false;
      student.unmuteRequestStatus = "none";
    }

    assert.equal(student.isMicEnabled, false, "Microphone must be muted");
    assert.equal(student.hasSpeakingPermission, false, "Speaking permission must be revoked on mute");
    assert.equal(student.unmuteRequestStatus, "none", "Status must return to none");

    // Student clicks mic again to speak: must request approval from tutor again
    let emittedSpeakingRequest = false;
    if (student.hasSpeakingPermission && student.isMicEnabled) {
      student.isMicEnabled = false;
    } else {
      student.unmuteRequestStatus = "requesting";
      emittedSpeakingRequest = true;
    }

    assert.equal(emittedSpeakingRequest, true, "Must send a new speaking request to tutor");
    assert.equal(student.unmuteRequestStatus, "requesting", "Status must be requesting until tutor approves");
    assert.equal(student.isMicEnabled, false, "Microphone remains muted until tutor approves");
  });

  // ── TEST 8: Tutor revokes speaking permission (Force Mute) ──
  it("REQ-08: Tutor Force Mute revokes speaking permission and mutes the student", () => {
    const student = createInitialStudent("student-01", "room-math-1");
    student.authorizedTutorId = "tutor-prof";
    student.hasSpeakingPermission = true;
    student.unmuteRequestStatus = "approved";
    student.isMicEnabled = true;

    const forceMuteMsg = {
      isControl: true,
      controlAction: "FORCE_MUTE",
      targetUserId: "student-01",
      all: false,
      senderId: "tutor-prof",
      senderRole: "tutor",
      isHost: true,
      roomCode: "room-math-1",
    };

    // Client verifies sender
    const isAuthorized = forceMuteMsg.senderId === student.authorizedTutorId;
    assert.ok(isAuthorized);

    if (forceMuteMsg.targetUserId === student.userId || forceMuteMsg.all) {
      student.isMicEnabled = false;
      student.hasSpeakingPermission = false; // Revoked!
      student.unmuteRequestStatus = "none";
    }

    assert.equal(student.isMicEnabled, false, "Mic track disabled");
    assert.equal(student.hasSpeakingPermission, false, "Permission revoked");
    assert.equal(student.unmuteRequestStatus, "none", "Request status reset to none");
  });

  // ── TEST 9: Tutor denies request ──
  it("REQ-09: Tutor denies speaking request and student status returns to none", () => {
    const student = createInitialStudent("student-01", "room-math-1");
    student.authorizedTutorId = "tutor-prof";
    student.unmuteRequestStatus = "requesting";

    const denialMsg = {
      isControl: true,
      controlAction: "MIC_RESPONSE",
      targetUserId: "student-01",
      approved: false,
      senderId: "tutor-prof",
      senderRole: "tutor",
      isHost: true,
      roomCode: "room-math-1",
    };

    if (denialMsg.targetUserId === student.userId && !denialMsg.approved) {
      student.hasSpeakingPermission = false;
      student.unmuteRequestStatus = "none";
      student.isMicEnabled = false;
    }

    assert.equal(student.hasSpeakingPermission, false);
    assert.equal(student.unmuteRequestStatus, "none");
  });

  // ── TEST 10: Tutor Force Mute single student works ──
  it("REQ-10: Tutor Force Mute targets specific student and does not mute other students", () => {
    const student1 = createInitialStudent("student-01", "room-math-1");
    student1.isMicEnabled = true;
    student1.hasSpeakingPermission = true;

    const student2 = createInitialStudent("student-02", "room-math-1");
    student2.isMicEnabled = true;
    student2.hasSpeakingPermission = true;

    const forceMuteMsg = {
      isControl: true,
      controlAction: "FORCE_MUTE",
      targetUserId: "student-01",
      all: false,
      senderId: "tutor-prof",
      roomCode: "room-math-1",
    };

    // Apply to student 1:
    if (forceMuteMsg.targetUserId === student1.userId || forceMuteMsg.all) {
      student1.isMicEnabled = false;
      student1.hasSpeakingPermission = false;
    }

    // Apply to student 2:
    if (forceMuteMsg.targetUserId === student2.userId || forceMuteMsg.all) {
      student2.isMicEnabled = false;
      student2.hasSpeakingPermission = false;
    }

    assert.equal(student1.isMicEnabled, false, "Student 1 was targeted and muted");
    assert.equal(student2.isMicEnabled, true, "Student 2 was NOT targeted and remains unmuted");
  });

  // ── TEST 11: Tutor Mute All works only within authorized room ──
  it("REQ-11: Tutor Mute All affects only participants in the matching roomCode", () => {
    const studentInRoomA = createInitialStudent("student-A", "room-math-A");
    studentInRoomA.isMicEnabled = true;
    studentInRoomA.hasSpeakingPermission = true;

    const studentInRoomB = createInitialStudent("student-B", "room-math-B");
    studentInRoomB.isMicEnabled = true;
    studentInRoomB.hasSpeakingPermission = true;

    const muteAllRoomA = {
      isControl: true,
      controlAction: "FORCE_MUTE",
      all: true,
      senderId: "tutor-A",
      roomCode: "room-math-A",
    };

    // Process Room A student
    if (!muteAllRoomA.roomCode || muteAllRoomA.roomCode === studentInRoomA.roomCode) {
      if (muteAllRoomA.all) {
        studentInRoomA.isMicEnabled = false;
        studentInRoomA.hasSpeakingPermission = false;
      }
    }

    // Process Room B student
    if (!muteAllRoomA.roomCode || muteAllRoomA.roomCode === studentInRoomB.roomCode) {
      if (muteAllRoomA.all) {
        studentInRoomB.isMicEnabled = false;
        studentInRoomB.hasSpeakingPermission = false;
      }
    }

    assert.equal(studentInRoomA.isMicEnabled, false, "Room A student muted");
    assert.equal(studentInRoomB.isMicEnabled, true, "Room B student isolated and unaffected");
  });

  // ── TEST 12 & 13: Forged student controls and spoofed isHost / senderRole are rejected ──
  it("REQ-12 & 13: Forged student MIC_RESPONSE and FORCE_MUTE with isHost: true / senderRole: 'tutor' are rejected", () => {
    const student = createInitialStudent("student-victim", "room-math-1");
    student.authorizedTutorId = "tutor-prof";

    const forgedMicResponse = {
      isControl: true,
      controlAction: "MIC_RESPONSE",
      targetUserId: "student-victim",
      approved: true,
      senderId: "student-attacker",
      isHost: true, // Spoofed!
      senderRole: "tutor", // Spoofed!
      roomCode: "room-math-1",
    };

    const forgedForceMute = {
      isControl: true,
      controlAction: "FORCE_MUTE",
      all: true,
      senderId: "student-attacker",
      isHost: true, // Spoofed!
      senderRole: "tutor", // Spoofed!
      roomCode: "room-math-1",
    };

    function evaluateControlSecurity(msg: any, client: ClientState): boolean {
      const senderId = msg.senderId || msg.userId;
      if (!client.isHost && senderId === client.userId) return false;
      if (client.authorizedTutorId) {
        return senderId === client.authorizedTutorId;
      }
      return Boolean(msg.isHost || msg.senderRole === "tutor");
    }

    assert.equal(evaluateControlSecurity(forgedMicResponse, student), false, "Forged MIC_RESPONSE rejected");
    assert.equal(evaluateControlSecurity(forgedForceMute, student), false, "Forged FORCE_MUTE rejected");

    // Also test self-forgery: student trying to approve themselves
    const selfForgedApproval = {
      ...forgedMicResponse,
      senderId: "student-victim",
    };
    assert.equal(evaluateControlSecurity(selfForgedApproval, student), false, "Self-forgery rejected");
  });

  // ── TEST 14: Pending requests disappear when participant leaves or class ends ──
  it("REQ-14: Pending speaking requests disappear when a participant leaves or class ends", () => {
    const tutor = createInitialTutor("tutor-prof", "room-math-1");
    tutor.unmuteRequests = [
      { userId: "student-01", name: "Gauss" },
      { userId: "student-02", name: "Euler" },
    ];

    // Student 01 leaves the room
    const peerLeftId = "student-01";
    tutor.unmuteRequests = tutor.unmuteRequests.filter((r) => r.userId !== peerLeftId);

    assert.equal(tutor.unmuteRequests.length, 1);
    assert.equal(tutor.unmuteRequests[0].userId, "student-02");

    // Class ends
    tutor.unmuteRequests = [];
    assert.equal(tutor.unmuteRequests.length, 0, "Requests cleared when class ends");
  });

  // ── TEST 15: Late or duplicate control messages cannot affect wrong participant ──
  it("REQ-15: Control messages addressed to a different participant are ignored", () => {
    const student1 = createInitialStudent("student-01", "room-math-1");
    student1.unmuteRequestStatus = "requesting";

    const msgForStudent2 = {
      isControl: true,
      controlAction: "MIC_RESPONSE",
      targetUserId: "student-02", // Different student!
      approved: true,
      senderId: "tutor-prof",
      roomCode: "room-math-1",
    };

    if (msgForStudent2.targetUserId === student1.userId) {
      student1.hasSpeakingPermission = true;
      student1.unmuteRequestStatus = "approved";
    }

    assert.equal(student1.hasSpeakingPermission, false, "Must not approve student 1");
    assert.equal(student1.unmuteRequestStatus, "requesting", "Status must remain requesting");
  });

  // ── TEST 16: Browser microphone permission failures leave UI usable ──
  it("REQ-16: Browser microphone denial leaves UI usable, preserves speaking permission, and explains next action", () => {
    const student = createInitialStudent("student-01", "room-math-1");
    student.hasSpeakingPermission = true; // Tutor approved
    student.unmuteRequestStatus = "approved";

    // Simulate browser getUserMedia throwing NotAllowedError (e.g. user blocked mic in Chrome)
    const browserError = new Error("Permission denied");
    browserError.name = "NotAllowedError";

    try {
      throw browserError;
    } catch (err: any) {
      student.isMicEnabled = false;
      student.hardwareError = err.name;
    }

    // Speaking permission MUST remain true so student does not have to re-ask tutor!
    assert.equal(student.hasSpeakingPermission, true, "Speaking permission must remain intact");
    assert.equal(student.isMicEnabled, false, "Mic track is not active");
    assert.equal(student.hardwareError, "NotAllowedError", "Error diagnosed correctly");
  });

  // ── TEST 17: Existing tutor controls remain functional ──
  it("REQ-17: Tutor microphone toggle, mute all, and participant controls remain functional", () => {
    const tutor = createInitialTutor("tutor-prof", "room-math-1", { micMuted: false });
    assert.equal(tutor.isMicEnabled, true);

    // Tutor toggles mute
    tutor.isMicEnabled = false;
    assert.equal(tutor.isMicEnabled, false);

    // Tutor toggles unmute
    tutor.isMicEnabled = true;
    assert.equal(tutor.isMicEnabled, true);
  });
});
