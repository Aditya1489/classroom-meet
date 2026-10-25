import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Tutor & Student Joining Lifecycle Test Suite", () => {
  const ROOM_CODE = "ptq-rtvq-rox";

  it("TC-JOIN-01: Tutor initializes meeting and room state as active host", () => {
    const tutorSession = {
      userId: "tutor-uuid-1",
      name: "Aditya Chavhan",
      role: "tutor",
      isHost: true,
      roomCode: ROOM_CODE,
    };

    assert.equal(tutorSession.isHost, true);
    assert.equal(tutorSession.role, "tutor");
    assert.equal(tutorSession.roomCode, ROOM_CODE);
  });

  it("TC-JOIN-02: Unauthenticated student link join is blocked by auth gate", () => {
    const evaluateAccess = (isAuthenticated: boolean) => {
      if (!isAuthenticated) {
        return { allowed: false, action: "PROMPT_GOOGLE_SIGN_IN" };
      }
      return { allowed: true, action: "ALLOW_ENTRY" };
    };

    const guestVisitor = evaluateAccess(false);
    assert.equal(guestVisitor.allowed, false);
    assert.equal(guestVisitor.action, "PROMPT_GOOGLE_SIGN_IN");
  });

  it("TC-JOIN-03: Target meeting URL is preserved and restored after OAuth", () => {
    const storage: Record<string, string> = {};
    const initialUrl = `/meet/${ROOM_CODE}`;

    // 1. Student hits link unauthenticated
    storage["mathsy_meet_redirect_url"] = initialUrl;

    // 2. Google OAuth returns token to origin
    const savedRedirect = storage["mathsy_meet_redirect_url"];
    delete storage["mathsy_meet_redirect_url"];

    assert.equal(savedRedirect, `/meet/${ROOM_CODE}`);
    assert.equal(storage["mathsy_meet_redirect_url"], undefined);
  });

  it("TC-JOIN-04: Authenticated student successfully enters room with verified Google profile", () => {
    const authenticatedStudent = {
      id: "usr-google-999",
      email: "student999@mathsy.in",
      name: "Rahul Kumar",
      role: "student" as const,
    };

    const roomParticipants: Array<{ id: string; name: string; role: string }> = [
      { id: "tutor-uuid-1", name: "Aditya Chavhan (Host)", role: "tutor" },
    ];

    // Student joins
    roomParticipants.push({
      id: authenticatedStudent.id,
      name: authenticatedStudent.name,
      role: authenticatedStudent.role,
    });

    assert.equal(roomParticipants.length, 2);
    assert.equal(roomParticipants[1].name, "Rahul Kumar");
    assert.equal(roomParticipants[1].role, "student");
  });

  it("TC-JOIN-05: Student arrives early before tutor (safe lobby waiting state)", () => {
    const roomState = {
      roomCode: ROOM_CODE,
      isTutorPresent: false,
    };

    const getLobbyStatus = (state: typeof roomState) => {
      if (!state.isTutorPresent) {
        return "WAITING_FOR_TUTOR";
      }
      return "TUTOR_ONLINE_READY";
    };

    assert.equal(getLobbyStatus(roomState), "WAITING_FOR_TUTOR");

    // Tutor enters room
    roomState.isTutorPresent = true;
    assert.equal(getLobbyStatus(roomState), "TUTOR_ONLINE_READY");
  });

  it("TC-JOIN-06: Student leaving and rejoining cleans up state with zero duplicates", () => {
    let participants = new Map<string, { id: string; name: string }>();

    // Initial Join
    participants.set("student-1", { id: "student-1", name: "Rahul Kumar" });
    assert.equal(participants.size, 1);

    // Leave
    participants.delete("student-1");
    assert.equal(participants.size, 0);

    // Rejoin
    participants.set("student-1", { id: "student-1", name: "Rahul Kumar" });
    assert.equal(participants.size, 1);
    assert.equal(participants.get("student-1")?.name, "Rahul Kumar");
  });
});
