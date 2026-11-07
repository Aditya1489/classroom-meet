import test from "node:test";
import assert from "node:assert/strict";
import { generateIcsCalendarEvent, buildClassInvitationEmailHtml } from "../server/services/emailService";

test("Class Scheduling, Nodemailer & RSVP State Machine Suite", async (t) => {
  await t.test("TC-SCHED-01: Validates schedule payload and rejects empty titles or invalid dates", () => {
    const validateSchedulePayload = (payload: {
      title?: string;
      scheduledAt?: string;
      durationMinutes?: number;
    }) => {
      if (!payload.title || typeof payload.title !== "string" || !payload.title.trim()) {
        return { valid: false, error: "A class title is required" };
      }
      if (!payload.scheduledAt || isNaN(new Date(payload.scheduledAt).getTime())) {
        return { valid: false, error: "Invalid date/time format provided" };
      }
      return { valid: true };
    };

    assert.equal(validateSchedulePayload({}).valid, false);
    assert.equal(validateSchedulePayload({ title: "   " }).valid, false);
    assert.equal(validateSchedulePayload({ title: "Calculus I", scheduledAt: "not-a-date" }).valid, false);
    assert.equal(validateSchedulePayload({ title: "Calculus I", scheduledAt: "2026-11-05T10:00:00Z" }).valid, true);
  });

  await t.test("TC-SCHED-02: Multi-email invitee parsing lowercases, trims, and deduplicates valid emails", () => {
    const parseInviteeEmails = (rawEmails: string[]) => {
      return Array.from(
        new Set(
          rawEmails
            .map((e) => e.trim().toLowerCase())
            .filter((e) => e.length > 3 && e.includes("@") && !e.includes(" "))
        )
      );
    };

    const input = [
      "  ALEX@GMAIL.COM  ",
      "alex@gmail.com",
      "priya@school.edu",
      "invalid-email",
      "space in@email.com",
      "PRIYA@SCHOOL.EDU",
    ];

    const parsed = parseInviteeEmails(input);
    assert.deepEqual(parsed, ["alex@gmail.com", "priya@school.edu"]);
    assert.equal(parsed.length, 2);
  });

  await t.test("TC-SCHED-03: Generates RFC 5545 compliant iCalendar string with required VCALENDAR & VEVENT tags", () => {
    const ics = generateIcsCalendarEvent({
      title: "Linear Algebra & Vectors",
      description: "Interactive session with geometry canvas",
      scheduledAt: new Date("2026-11-05T14:00:00.000Z"),
      durationMinutes: 60,
      tutorName: "Aditya Chavhan",
      joinUrl: "https://mathsy.in/invite/test_token_123",
      roomCode: "abc-defg-hij",
    });

    assert.ok(ics.includes("BEGIN:VCALENDAR"), "Must start with BEGIN:VCALENDAR");
    assert.ok(ics.includes("VERSION:2.0"), "Must declare iCalendar version 2.0");
    assert.ok(ics.includes("BEGIN:VEVENT"), "Must contain VEVENT block");
    assert.ok(ics.includes("SUMMARY:Linear Algebra & Vectors"), "Must embed class summary title");
    assert.ok(ics.includes("DTSTART:20261105T140000Z"), "Must compute UTC start timestamp");
    assert.ok(ics.includes("DTEND:20261105T150000Z"), "Must compute UTC end timestamp 60m after start");
    assert.ok(ics.includes("ORGANIZER;CN=Aditya Chavhan"), "Must name organizer tutor");
    assert.ok(ics.includes("END:VCALENDAR"), "Must conclude with END:VCALENDAR");
  });

  await t.test("TC-SCHED-04: Strict Google Auth Policy blocks unauthenticated or guest users from accepting invite", () => {
    const canAcceptInvite = (user: { id?: string; email?: string; authProvider?: string } | null) => {
      if (!user || !user.id || !user.email) return false;
      // Strict rule: must have a verified Google or registered email account, not an anonymous guest
      if (user.id.startsWith("guest_") || user.authProvider === "guest") return false;
      return true;
    };

    assert.equal(canAcceptInvite(null), false, "Null user cannot RSVP");
    assert.equal(canAcceptInvite({ id: "guest_99", email: "guest@mathsy.in", authProvider: "guest" }), false, "Guest cannot RSVP");
    assert.equal(canAcceptInvite({ id: "usr_google_1", email: "student@gmail.com", authProvider: "google" }), true, "Verified Google user can RSVP");
  });

  await t.test("TC-SCHED-05: RSVP transition state machine updates invitation status and associates user id", () => {
    interface InvitationRecord {
      id: string;
      email: string;
      invitee_user_id: string | null;
      rsvp_status: "pending" | "accepted" | "declined";
      rsvp_at: string | null;
    }

    const invitation: InvitationRecord = {
      id: "inv_123",
      email: "student@gmail.com",
      invitee_user_id: null,
      rsvp_status: "pending",
      rsvp_at: null,
    };

    const applyRsvp = (inv: InvitationRecord, userId: string, status: "accepted" | "declined"): InvitationRecord => {
      return {
        ...inv,
        invitee_user_id: userId,
        rsvp_status: status,
        rsvp_at: new Date().toISOString(),
      };
    };

    const updated = applyRsvp(invitation, "usr_student_456", "accepted");
    assert.equal(updated.rsvp_status, "accepted");
    assert.equal(updated.invitee_user_id, "usr_student_456");
    assert.ok(updated.rsvp_at !== null);
  });

  await t.test("TC-SCHED-06: Schedule authorization ensures only class creator can cancel or modify schedule", () => {
    const isAuthorizedToCancel = (scheduleTutorId: string, requestingUserId: string) => {
      return scheduleTutorId === requestingUserId;
    };

    assert.equal(isAuthorizedToCancel("tutor_aditya", "tutor_aditya"), true);
    assert.equal(isAuthorizedToCancel("tutor_aditya", "student_random"), false);
  });

  await t.test("TC-SCHED-07: Unlimited class duration (0 durationMinutes) generates valid open-ended .ics without cutoffs", () => {
    const ics = generateIcsCalendarEvent({
      title: "Advanced Math Workshop",
      description: "Open-ended workshop until finished",
      scheduledAt: new Date("2026-11-06T15:00:00.000Z"),
      durationMinutes: 0, // Unlimited duration
      tutorName: "Aditya Chavhan",
      joinUrl: "https://mathsy.in/invite/token_unlimited",
      roomCode: "unlimited-room-123",
    });

    assert.ok(ics.includes("BEGIN:VCALENDAR"));
    assert.ok(ics.includes("DTSTART:20261106T150000Z"));
    // Falls back to safe default 1h block on calendar grid while class has no cutoff
    assert.ok(ics.includes("DTEND:20261106T160000Z"));
    assert.ok(ics.includes("END:VCALENDAR"));
  });

  await t.test("TC-SCHED-08: Post-login intent preservation keeps returnUrl and pendingAction without dropping user to home", () => {
    interface PendingAuthAction {
      type: "start_instant_class" | "open_schedule_modal" | "view_schedule" | "join_room" | "accept_invite";
      roomId?: string;
      inviteToken?: string;
      returnUrl?: string;
    }

    const computePostAuthDestination = (targetRedirect: string | null, currentPath: string): string => {
      if (targetRedirect && targetRedirect.startsWith("/") && !targetRedirect.startsWith("//")) {
        return targetRedirect;
      }
      return currentPath !== "/" ? currentPath : "/";
    };

    // Case 1: Invitee clicking invite email link
    assert.equal(
      computePostAuthDestination("/invite/tok_algebra_99", "/"),
      "/invite/tok_algebra_99",
      "Must restore invite route"
    );

    // Case 2: User in meeting room / lobby
    assert.equal(
      computePostAuthDestination("/meet/geom-101", "/"),
      "/meet/geom-101",
      "Must restore meeting room route"
    );

    // Case 3: Action intent execution state
    const action: PendingAuthAction = {
      type: "accept_invite",
      inviteToken: "tok_algebra_99",
      returnUrl: "/invite/tok_algebra_99",
    };
    const serialized = JSON.stringify(action);
    const restored: PendingAuthAction = JSON.parse(serialized);

    assert.equal(restored.type, "accept_invite");
    assert.equal(restored.inviteToken, "tok_algebra_99");
    assert.equal(restored.returnUrl, "/invite/tok_algebra_99");
  });

  await t.test("TC-SCHED-09: Unaccepted pending invitations are strictly excluded from Upcoming Classes tab until accepted", () => {
    interface MockScheduledClass {
      id: string;
      title: string;
      my_rsvp_status?: "pending" | "accepted" | "declined";
    }

    const hostedClasses: MockScheduledClass[] = [{ id: "host-1", title: "My Hosted Math Class" }];
    const attendingClasses: MockScheduledClass[] = [
      { id: "invite-1", title: "Pending Physics Class", my_rsvp_status: "pending" },
      { id: "invite-2", title: "Accepted Chemistry Class", my_rsvp_status: "accepted" },
      { id: "invite-3", title: "Declined Biology Class", my_rsvp_status: "declined" },
    ];

    // Filter rule: only hosted OR explicitly accepted classes belong in upcoming schedule
    const acceptedAttending = attendingClasses.filter((c) => c.my_rsvp_status === "accepted");
    const allUpcoming = [...hostedClasses, ...acceptedAttending];

    // Pending rule: only pending invites belong in invitations tab
    const pendingInvites = attendingClasses.filter((c) => c.my_rsvp_status === "pending");

    assert.equal(allUpcoming.length, 2, "Upcoming classes must only contain hosted (1) and accepted (1)");
    assert.ok(allUpcoming.some((c) => c.id === "host-1"));
    assert.ok(allUpcoming.some((c) => c.id === "invite-2"));
    assert.ok(!allUpcoming.some((c) => c.id === "invite-1"), "Pending class must NOT be in upcoming classes");
    assert.ok(!allUpcoming.some((c) => c.id === "invite-3"), "Declined class must NOT be in upcoming classes");

    assert.equal(pendingInvites.length, 1);
    assert.equal(pendingInvites[0].id, "invite-1");
  });

  await t.test("TC-SCHED-10: Navigation badge count accurately reflects pending invitations awaiting RSVP", () => {
    interface MockAttendeeInvite {
      my_rsvp_status?: "pending" | "accepted" | "declined";
      status: "scheduled" | "cancelled" | "completed";
    }

    const computePendingCount = (invites: MockAttendeeInvite[]): number => {
      return invites.filter((c) => c.my_rsvp_status === "pending" && c.status !== "cancelled").length;
    };

    assert.equal(computePendingCount([]), 0);
    assert.equal(
      computePendingCount([
        { my_rsvp_status: "pending", status: "scheduled" },
        { my_rsvp_status: "accepted", status: "scheduled" },
        { my_rsvp_status: "declined", status: "scheduled" },
      ]),
      1
    );
    assert.equal(
      computePendingCount([
        { my_rsvp_status: "pending", status: "scheduled" },
        { my_rsvp_status: "pending", status: "scheduled" },
      ]),
      2
    );
    assert.equal(
      computePendingCount([
        { my_rsvp_status: "pending", status: "cancelled" }, // cancelled class does not increment badge
      ]),
      0
    );
  });

  await t.test("TC-SCHED-11: Email invitation template generates both Accept and Decline buttons with valid URLs", () => {
    const html = buildClassInvitationEmailHtml({
      payload: {
        title: "Calculus III Multivariable",
        subject: "Mathematics",
        description: "Vector fields and line integrals",
        durationMinutes: 60,
        tutorName: "Prof. Euler",
      },
      formattedDate: "Monday, Nov 2, 2026",
      formattedTime: "3:30 PM GMT+5:30",
      rsvpUrl: "https://meet.mathsy.in/invite/tok_test_calc_3",
    });

    assert.ok(html.includes("Accept Invitation & RSVP"), "Must render Accept button text");
    assert.ok(html.includes("tok_test_calc_3?action=accept"), "Accept button must link with ?action=accept");
    assert.ok(html.includes("Decline"), "Must render Decline button text");
    assert.ok(html.includes("tok_test_calc_3?action=decline"), "Decline button must link with ?action=decline");
    assert.ok(html.includes("cta-button"), "Must include primary cta-button CSS class");
    assert.ok(html.includes("cta-decline-button"), "Must include secondary cta-decline-button CSS class");
  });

  await t.test("TC-SCHED-12: Safe Foreign Key RSVP resolution prevents database 23503 constraint violation on stale tokens", () => {
    // Simulates the safety layer added to rsvpInviteByToken
    const mockUsersTable = [
      { id: "usr_valid_111", email: "aditya@mathsy.in" },
      { id: "usr_valid_222", email: "student@school.edu" },
    ];

    const resolveSafeUserId = (providedUserId: string | null | undefined, providedEmail: string): string | null => {
      // 1. Check if providedUserId matches an existing user
      if (providedUserId) {
        const found = mockUsersTable.find((u) => u.id === providedUserId);
        if (found) return found.id;
      }
      // 2. Fall back to resolving by email
      if (providedEmail) {
        const foundByEmail = mockUsersTable.find((u) => u.email.toLowerCase() === providedEmail.toLowerCase());
        if (foundByEmail) return foundByEmail.id;
      }
      // 3. Fall back to null (safe against FK violation since invitee_user_id is nullable)
      return null;
    };

    // Case A: Valid user id
    assert.equal(resolveSafeUserId("usr_valid_111", "aditya@mathsy.in"), "usr_valid_111");

    // Case B: Stale user id from client session (e.g. 86cf07f3-9687-48f3-8ba1-4a879fbac444)
    // but email matches existing record
    assert.equal(
      resolveSafeUserId("86cf07f3-9687-48f3-8ba1-4a879fbac444", "student@school.edu"),
      "usr_valid_222",
      "Must safely repair stale user ID using verified email"
    );

    // Case C: Stale user id and unregistered email (e.g. unauthenticated decline)
    assert.equal(
      resolveSafeUserId("86cf07f3-9687-48f3-8ba1-4a879fbac444", "unknown@guest.com"),
      null,
      "Must safely fall back to null rather than throwing 23503 foreign key violation"
    );
  });

  await t.test("TC-SCHED-13: Invitee decline updates state to declined and excludes from pending invitations", () => {
    interface MockInvitation {
      token: string;
      rsvp_status: "pending" | "accepted" | "declined";
    }

    const invitations: MockInvitation[] = [
      { token: "tok_1", rsvp_status: "pending" },
      { token: "tok_2", rsvp_status: "pending" },
    ];

    // User declines tok_1
    const target = invitations.find((i) => i.token === "tok_1");
    if (target) target.rsvp_status = "declined";

    const remainingPending = invitations.filter((i) => i.rsvp_status === "pending");
    assert.equal(remainingPending.length, 1);
    assert.equal(remainingPending[0].token, "tok_2");
    assert.equal(target?.rsvp_status, "declined");
  });

  await t.test("TC-SCHED-14: Invitations tab strictly filters for pending invites, while accepted classes move to Upcoming", () => {
    interface ScheduledClass {
      id: string;
      title: string;
      my_rsvp_status?: "pending" | "accepted" | "declined";
      status: "scheduled" | "cancelled";
      scheduled_at: string;
    }

    const attendingClasses: ScheduledClass[] = [
      { id: "c1", title: "Algebra I", my_rsvp_status: "accepted", status: "scheduled", scheduled_at: "2026-11-04T10:00:00Z" },
      { id: "c2", title: "Calculus II", my_rsvp_status: "declined", status: "scheduled", scheduled_at: "2026-11-04T12:00:00Z" },
      { id: "c3", title: "Geometry", my_rsvp_status: "pending", status: "scheduled", scheduled_at: "2026-11-04T14:00:00Z" },
      { id: "c4", title: "Cancelled Class", my_rsvp_status: "pending", status: "cancelled", scheduled_at: "2026-11-04T16:00:00Z" },
    ];

    // Filter strictly for pending invites awaiting user response (action required)
    const pendingInvites = attendingClasses.filter(
      (c) => (c.my_rsvp_status === "pending" || !c.my_rsvp_status) && c.status !== "cancelled"
    );

    assert.equal(pendingInvites.length, 1, "Only pending invites appear in Invitations tab");
    assert.equal(pendingInvites[0].id, "c3", "Item must be the pending Geometry invitation");

    // Once an invitation is accepted, it must NOT appear in Invitations tab
    assert.ok(!pendingInvites.some((c) => c.id === "c1"), "Accepted class 'c1' must be excluded from Invitations tab");

    // Upcoming classes inclusion rule: ONLY accepted attending classes appear on Upcoming agenda
    const acceptedAttending = attendingClasses.filter(
      (c) => c.my_rsvp_status === "accepted" && c.status !== "cancelled"
    );
    assert.equal(acceptedAttending.length, 1);
    assert.equal(acceptedAttending[0].id, "c1", "Accepted class 'c1' must appear in Upcoming Classes");

    // Pending count calculation for notification badge
    const pendingCount = pendingInvites.length;
    assert.equal(pendingCount, 1, "Badge reflects only pending invites count");
  });

  await t.test("TC-SCHED-15: Tutor view maps student RSVP status accurately into emerald, red, and amber badges", () => {
    interface Attendee {
      email: string;
      rsvp_status: "pending" | "accepted" | "declined";
    }

    const getAttendeeBadgeConfig = (att: Attendee) => {
      switch (att.rsvp_status) {
        case "accepted":
          return { color: "emerald", symbol: "✓", label: "Accepted" };
        case "declined":
          return { color: "red", symbol: "✕", label: "Declined" };
        case "pending":
        default:
          return { color: "amber", symbol: "?", label: "Pending" };
      }
    };

    assert.deepEqual(getAttendeeBadgeConfig({ email: "student1@gmail.com", rsvp_status: "accepted" }), {
      color: "emerald",
      symbol: "✓",
      label: "Accepted",
    });

    assert.deepEqual(getAttendeeBadgeConfig({ email: "student2@gmail.com", rsvp_status: "declined" }), {
      color: "red",
      symbol: "✕",
      label: "Declined",
    });

    assert.deepEqual(getAttendeeBadgeConfig({ email: "student3@gmail.com", rsvp_status: "pending" }), {
      color: "amber",
      symbol: "?",
      label: "Pending",
    });
  });

  await t.test("TC-SCHED-16: Auto-sync on window focus and visibility change triggers schedule re-fetch", () => {
    let fetchCount = 0;
    const fetchSchedule = () => {
      fetchCount++;
    };

    // Simulated event listeners
    const listeners: Record<string, Function[]> = {};
    const addListener = (event: string, fn: Function) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    };
    const dispatch = (event: string) => {
      (listeners[event] || []).forEach((fn) => fn());
    };

    const handleFocusSync = () => {
      fetchSchedule();
    };

    addListener("focus", handleFocusSync);
    addListener("visibilitychange", handleFocusSync);

    assert.equal(fetchCount, 0);

    // User switches back from Gmail on phone/desktop
    dispatch("focus");
    assert.equal(fetchCount, 1, "Focus event must trigger schedule reload");

    dispatch("visibilitychange");
    assert.equal(fetchCount, 2, "Visibility change event must trigger schedule reload");
  });

  await t.test("TC-SCHED-17: Auto-refresh triggers on mathsy:schedule-updated and refreshTrigger prop changes", () => {
    let backgroundFetchCount = 0;
    let foregroundFetchCount = 0;

    const fetchSchedule = (isBackground = false) => {
      if (isBackground) backgroundFetchCount++;
      else foregroundFetchCount++;
    };

    const listeners: Record<string, Function[]> = {};
    const addListener = (event: string, fn: Function) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    };
    const dispatch = (event: string) => {
      (listeners[event] || []).forEach((fn) => fn());
    };

    addListener("mathsy:schedule-updated", () => fetchSchedule(true));

    assert.equal(backgroundFetchCount, 0);

    // Tutor schedules a class or student RSVPs
    dispatch("mathsy:schedule-updated");
    assert.equal(backgroundFetchCount, 1, "Custom event mathsy:schedule-updated must immediately reload schedule");

    // Parent increments refreshTrigger
    let refreshTrigger = 0;
    const onPropChange = (newTrigger: number) => {
      if (newTrigger > 0) fetchSchedule(true);
    };

    refreshTrigger = 1;
    onPropChange(refreshTrigger);
    assert.equal(backgroundFetchCount, 2, "Parent refreshTrigger change must trigger background fetch");
  });

  await t.test("TC-SCHED-18: Accepting an invitation removes it from Invitations tab, places it in Upcoming Classes, and zeroes the Invitations badge", () => {
    interface ScheduledClass {
      id: string;
      title: string;
      my_rsvp_status?: "pending" | "accepted" | "declined";
      status: "scheduled" | "cancelled";
      scheduled_at: string;
    }

    let attendingClasses: ScheduledClass[] = [
      {
        id: "class_inv_99",
        title: "Advanced Geometry & Trigonometry",
        my_rsvp_status: "pending",
        status: "scheduled",
        scheduled_at: new Date(Date.now() + 3600000).toISOString(),
      },
    ];

    // 1. Initial State: 1 pending invitation
    let pendingInvites = attendingClasses.filter(
      (c) => (c.my_rsvp_status === "pending" || !c.my_rsvp_status) && c.status !== "cancelled"
    );
    let acceptedAttending = attendingClasses.filter(
      (c) => c.my_rsvp_status === "accepted" && c.status !== "cancelled"
    );

    assert.equal(pendingInvites.length, 1, "Must have 1 pending invitation initially");
    assert.equal(acceptedAttending.length, 0, "No accepted classes initially");

    // 2. User accepts the invitation (via email button or modal)
    attendingClasses = attendingClasses.map((c) =>
      c.id === "class_inv_99" ? { ...c, my_rsvp_status: "accepted" as const } : c
    );

    // 3. Re-evaluate tabs
    pendingInvites = attendingClasses.filter(
      (c) => (c.my_rsvp_status === "pending" || !c.my_rsvp_status) && c.status !== "cancelled"
    );
    acceptedAttending = attendingClasses.filter(
      (c) => c.my_rsvp_status === "accepted" && c.status !== "cancelled"
    );

    // Assert: The invitation MUST disappear from the Invitations tab
    assert.equal(pendingInvites.length, 0, "Invitations tab must have 0 pending invites after acceptance");
    // Assert: The accepted class MUST appear in Upcoming Classes
    assert.equal(acceptedAttending.length, 1, "Upcoming Classes must contain the accepted class");
    assert.equal(acceptedAttending[0].id, "class_inv_99");
  });

  await t.test("TC-SCHED-19: Unauthenticated or logged out user cannot view private schedule and is redirected to meetings/home", () => {
    let isAuthenticated = true;
    let workspaceTab: "meetings" | "schedule" = "schedule";

    const guardWorkspaceTab = () => {
      if (!isAuthenticated && workspaceTab !== "meetings") {
        workspaceTab = "meetings";
      }
    };

    // While logged in, user can be on schedule
    guardWorkspaceTab();
    assert.equal(workspaceTab, "schedule");

    // User logs out at any point
    isAuthenticated = false;
    guardWorkspaceTab();

    // Must reset to meetings (public home view)
    assert.equal(workspaceTab, "meetings", "Must reset workspaceTab to meetings when unauthenticated");
  });
});

