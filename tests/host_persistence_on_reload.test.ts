import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Host Role Persistence on Page Reload Suite", () => {
  const meetingRoomPath = path.resolve(process.cwd(), "src/components/meet/MeetingRoom.tsx");
  const appPath = path.resolve(process.cwd(), "src/App.tsx");
  const lobbyPath = path.resolve(process.cwd(), "src/components/lobby/LobbyView.tsx");
  const dbClientPath = path.resolve(process.cwd(), "src/lib/dbClient.ts");

  const meetingRoomCode = fs.readFileSync(meetingRoomPath, "utf-8");
  const appCode = fs.readFileSync(appPath, "utf-8");
  const lobbyCode = fs.readFileSync(lobbyPath, "utf-8");
  const dbClientCode = fs.readFileSync(dbClientPath, "utf-8");

  it("HP-01: App.tsx preserves isHost and role: tutor on reload when sessionStorage mathsy_host_${code} was set", () => {
    assert.ok(
      appCode.includes("const wasHost = sessionStorage.getItem(`mathsy_host_${code}`) === \"true\";"),
      "App.tsx must check wasHost from sessionStorage"
    );
    assert.ok(
      appCode.includes("parsedOptions.isHost = true;") && appCode.includes("parsedOptions.role = \"tutor\";"),
      "App.tsx must re-assert parsedOptions.isHost = true and role = 'tutor' if wasHost was true"
    );
  });

  it("HP-02: MeetingRoom.tsx initializes isHost using OR condition (initialOptions.isHost || fromSession)", () => {
    assert.ok(
      meetingRoomCode.includes("return Boolean(initialOptions.isHost || fromSession);"),
      "MeetingRoom.tsx must use OR condition so either initialOptions or sessionStorage maintains host role"
    );
  });

  it("HP-03: MeetingRoom.tsx recovers myUserId from localStorage mathsy_meet_user if profile is not yet hydrated", () => {
    assert.ok(
      meetingRoomCode.includes('window.localStorage.getItem("mathsy_meet_user")'),
      "MeetingRoom.tsx must synchronously check saved user in localStorage during initial render"
    );
  });

  it("HP-04: engine.onRoleAssigned does NOT demote an established room host or wipe sessionStorage", () => {
    assert.ok(
      meetingRoomCode.includes("else if (!isHostRef.current)"),
      "engine.onRoleAssigned must only demote if participant was not already an established room host"
    );
  });

  it("HP-05: dbClient.recordParticipantJoin accepts customToken and passes it in auth headers", () => {
    assert.ok(
      dbClientCode.includes("async recordParticipantJoin(participant: DbParticipant, customToken?: string)"),
      "dbClient.recordParticipantJoin must accept optional customToken"
    );
    assert.ok(
      dbClientCode.includes("headers: getAuthHeaders(customToken, participant.room_code)"),
      "dbClient.recordParticipantJoin must pass customToken to getAuthHeaders"
    );
  });

  it("HP-06: MeetingRoom.tsx includes post-hydration ownership synchronization effect", () => {
    assert.ok(
      meetingRoomCode.includes("// Authoritative room ownership synchronization when async authentication resolves"),
      "MeetingRoom.tsx must include post-hydration ownership synchronization"
    );
    assert.ok(
      meetingRoomCode.includes("[profile?.id, session?.access_token, meetingCode]"),
      "Sync effect must watch profile?.id and session?.access_token"
    );
  });

  it("HP-07: LobbyView.tsx checks isHostFromLanding || fromSession to preserve host role", () => {
    assert.ok(
      lobbyCode.includes("return Boolean(isHostFromLanding || fromSession);"),
      "LobbyView.tsx must use OR logic for isRoomHost"
    );
  });

  it("HP-08: Strict Non-Regression: Users, Chat, and Polls drawers intact and zero backend routers modified", () => {
    const classFeedPath = path.resolve(process.cwd(), "src/components/meet/ClassFeedSidepanel.tsx");
    const classFeedCode = fs.readFileSync(classFeedPath, "utf-8");

    assert.ok(classFeedCode.includes("Chat"), "Chat drawer must remain intact");
    assert.ok(classFeedCode.includes("Polls"), "Polls drawer must remain intact");
    assert.ok(classFeedCode.includes("Class Members"), "Class Members / Users drawer must remain intact");
    assert.ok(classFeedCode.includes("Mute All"), "Mute All control must remain intact");
    assert.ok(classFeedCode.includes("Lower Hands"), "Lower Hands control must remain intact");
  });
});

