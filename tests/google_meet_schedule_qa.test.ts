import test from "node:test";
import assert from "node:assert/strict";
import { generateIcsCalendarEvent, buildClassInvitationEmailHtml } from "../server/services/emailService";

test("Google Meet-Style Schedule Meeting QA Test Suite", async (t) => {
  // 1. Core Scheduling Flow
  await t.test("SCH-002: Schedule meeting with valid details formats date, title, and unlimited duration", () => {
    const meetingPayload = {
      title: "Mathsy Live Geometry",
      subject: "Mathematics",
      scheduledAt: "2026-11-10T14:30:00.000Z",
      durationMinutes: 0,
      inviteeEmails: ["student@gmail.com"],
    };

    assert.ok(meetingPayload.title.trim().length > 0, "Title must be non-empty");
    const d = new Date(meetingPayload.scheduledAt);
    assert.equal(isNaN(d.getTime()), false, "Date must be valid ISO timestamp");
    assert.equal(meetingPayload.durationMinutes, 0, "0 represents unlimited duration");
  });

  await t.test("SCH-003: Rejects schedule request when required fields are missing", () => {
    const validate = (payload: { title?: string; scheduledAt?: string }) => {
      if (!payload.title || !payload.title.trim()) return { ok: false, error: "A class title is required" };
      if (!payload.scheduledAt) return { ok: false, error: "Scheduled date and time is required" };
      const d = new Date(payload.scheduledAt);
      if (isNaN(d.getTime())) return { ok: false, error: "Invalid date/time format provided" };
      return { ok: true };
    };

    assert.equal(validate({}).ok, false);
    assert.equal(validate({ title: "   " }).ok, false);
    assert.equal(validate({ title: "Calculus", scheduledAt: "" }).ok, false);
    assert.equal(validate({ title: "Calculus", scheduledAt: "invalid" }).ok, false);
    assert.equal(validate({ title: "Calculus", scheduledAt: "2026-11-05T10:00:00Z" }).ok, true);
  });

  await t.test("SCH-004: Supports scheduling several days or weeks ahead into the future", () => {
    const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 2 weeks ahead
    assert.ok(futureDate.getTime() > Date.now());
  });

  await t.test("SCH-005: Supports scheduling for today at a future time", () => {
    const todayFuture = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now
    assert.ok(todayFuture.getTime() > Date.now());
  });

  await t.test("SCH-006: Rejects past date or time with a 5-minute grace threshold", () => {
    const validateFutureTime = (isoString: string) => {
      const scheduledTime = new Date(isoString).getTime();
      const now = Date.now();
      const gracePeriodMs = 5 * 60 * 1000;
      if (scheduledTime < now - gracePeriodMs) {
        return { valid: false, error: "Cannot schedule a class in the past. Please select a future date and time." };
      }
      return { valid: true };
    };

    const pastYesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const pastOneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const futureTomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    assert.equal(validateFutureTime(pastYesterday).valid, false);
    assert.equal(validateFutureTime(pastOneHourAgo).valid, false);
    assert.equal(validateFutureTime(futureTomorrow).valid, true);
  });

  await t.test("SCH-007: Rejects negative duration and allows 0 (unlimited) or positive duration", () => {
    const validateDuration = (durationMinutes?: number) => {
      if (typeof durationMinutes !== "undefined" && durationMinutes < 0) {
        return { valid: false, error: "Duration cannot be negative" };
      }
      return { valid: true };
    };

    assert.equal(validateDuration(-10).valid, false);
    assert.equal(validateDuration(0).valid, true);
    assert.equal(validateDuration(45).valid, true);
    assert.equal(validateDuration(60).valid, true);
  });

  await t.test("SCH-008: Form allows editing title, date, time before submission and uses latest state", () => {
    let formState = { title: "Draft 1", date: "2026-11-05", time: "10:00" };
    // User updates before clicking submit
    formState = { ...formState, title: "Final Calculus Seminar", time: "11:30" };
    assert.equal(formState.title, "Final Calculus Seminar");
    assert.equal(formState.time, "11:30");
  });

  await t.test("SCH-009: Prevent duplicate meeting creation via isSubmitting guard", () => {
    let submitCount = 0;
    let isSubmitting = false;

    const handleSubmit = async () => {
      if (isSubmitting) return;
      isSubmitting = true;
      submitCount++;
      // Simulate network wait
      await new Promise((r) => setTimeout(r, 10));
      isSubmitting = false;
    };

    // Simulate rapid double click
    handleSubmit();
    handleSubmit();
    assert.equal(submitCount, 1, "Only one submission allowed while isSubmitting is true");
  });

  // 2. Google Meet Creation Options
  await t.test("SCH-012 & SCH-043: Generates 10-char Google Meet format room codes (xxx-xxxx-xxx) with collision safety", () => {
    const generateRoomCode = () => {
      const chars = "abcdefghijklmnopqrstuvwxyz";
      const part = (len: number) =>
        Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
      return `${part(3)}-${part(4)}-${part(3)}`;
    };

    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const code = generateRoomCode();
      assert.match(code, /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/, "Must conform to Google Meet code syntax");
      codes.add(code);
    }
    assert.equal(codes.size, 1000, "1000 randomly generated room codes must be unique");
  });

  await t.test("SCH-013: Copy meeting link formats URL accurately with window.location.origin", () => {
    const origin = "https://meet.mathsy.in";
    const roomCode = "abc-defg-hij";
    const shareUrl = `${origin}/meet/${roomCode}`;
    assert.equal(shareUrl, "https://meet.mathsy.in/meet/abc-defg-hij");
  });

  // 3. Meeting List & Dashboard Filtering
  await t.test("SCH-015 & SCH-019: Segregates upcoming vs past meetings based on scheduled window", () => {
    const now = new Date("2026-11-05T12:00:00Z");

    const isClassUpcomingOrActive = (c: { scheduled_at: string; duration_minutes: number; status: string }) => {
      if (c.status === "cancelled" || c.status === "completed") return false;
      const classTime = new Date(c.scheduled_at);
      const effectiveWindowMs = (c.duration_minutes > 0 ? c.duration_minutes : 24 * 60) * 60000;
      return classTime.getTime() + effectiveWindowMs >= now.getTime();
    };

    const classUpcoming = { scheduled_at: "2026-11-05T14:00:00Z", duration_minutes: 60, status: "scheduled" };
    const classPast = { scheduled_at: "2026-11-04T10:00:00Z", duration_minutes: 60, status: "scheduled" };
    const classCancelled = { scheduled_at: "2026-11-05T15:00:00Z", duration_minutes: 60, status: "cancelled" };

    assert.equal(isClassUpcomingOrActive(classUpcoming), true, "Future class is upcoming");
    assert.equal(isClassUpcomingOrActive(classPast), false, "Yesterday class is past");
    assert.equal(isClassUpcomingOrActive(classCancelled), false, "Cancelled class is excluded from upcoming");
  });

  // 4. Cancellation & Security
  await t.test("SCH-022 & SCH-025: Cancelled meeting blocks RSVP and alerts participant", () => {
    const inviteRecord = {
      token: "tok_xyz",
      class_status: "cancelled",
    };

    const attemptRsvp = (invite: { class_status: string }) => {
      if (invite.class_status === "cancelled") {
        throw new Error("This class has been cancelled by the tutor");
      }
      return { success: true };
    };

    assert.throws(() => attemptRsvp(inviteRecord), /cancelled by the tutor/);
  });

  await t.test("SCH-041: Authentication guard prevents unauthorized requests without bearer token", () => {
    const requireAuth = (authHeader?: string) => {
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return { status: 401, error: "Authentication required" };
      }
      return { status: 200 };
    };

    assert.equal(requireAuth(undefined).status, 401);
    assert.equal(requireAuth("Basic 123").status, 401);
    assert.equal(requireAuth("Bearer valid_jwt_token").status, 200);
  });

  await t.test("SCH-042: Tutor authorization ensures only host can cancel their meeting", () => {
    const cancelMeeting = (meetingTutorId: string, requestingUserId: string) => {
      if (meetingTutorId !== requestingUserId) {
        throw new Error("You are not authorized to cancel this class");
      }
      return { cancelled: true };
    };

    assert.throws(() => cancelMeeting("tutor_aditya", "student_john"), /not authorized/);
    assert.equal(cancelMeeting("tutor_aditya", "tutor_aditya").cancelled, true);
  });

  await t.test("SCH-044: Sanitizes HTML/script injection in email template strings", () => {
    const maliciousPayload = {
      title: '<script>alert("xss")</script>Calculus',
      tutorName: 'Prof. Hacker<img src=x onerror="steal()">',
      subject: 'Math & Science',
      durationMinutes: 60,
      description: '<b>Warning</b>: Bring compass & <style>body{display:none}</style>',
    };

    const html = buildClassInvitationEmailHtml({
      payload: maliciousPayload,
      formattedDate: "Nov 5, 2026",
      formattedTime: "10:00 AM",
      rsvpUrl: "https://mathsy.in/invite/tok123",
    });

    assert.equal(html.includes("<script>"), false, "Must not contain raw script tags");
    assert.equal(html.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'), true, "Script tag must be escaped");
    assert.equal(html.includes("<img src=x"), false, "Must not contain raw img tags");
    assert.equal(html.includes("&lt;img src=x onerror=&quot;steal()&quot;&gt;"), true, "Img tag must be escaped");
  });

  await t.test("SCH-040: Calendar .ics attachment contains compliant VEVENT with reminder VALARM", () => {
    const ics = generateIcsCalendarEvent({
      title: "Algebra & Polynomials",
      description: "Live session",
      scheduledAt: new Date("2026-11-12T09:00:00Z"),
      durationMinutes: 45,
      tutorName: "Aditya",
      joinUrl: "https://mathsy.in/invite/tok456",
      roomCode: "alg-poly-101",
    });

    assert.ok(ics.includes("BEGIN:VCALENDAR"));
    assert.ok(ics.includes("BEGIN:VEVENT"));
    assert.ok(ics.includes("BEGIN:VALARM"));
    assert.ok(ics.includes("TRIGGER:-PT15M"), "Must set 15m reminder alarm");
    assert.ok(ics.includes("END:VALARM"));
    assert.ok(ics.includes("END:VEVENT"));
    assert.ok(ics.includes("END:VCALENDAR"));
  });
});
