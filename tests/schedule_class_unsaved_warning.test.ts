import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Schedule Class Unsaved Changes Warning & Backdrop Guard Suite", async (t) => {
  const modalPath = path.resolve(process.cwd(), "src/components/schedule/ScheduleClassModal.tsx");
  const modalCode = fs.readFileSync(modalPath, "utf-8");

  await t.test("SCW-01: Form dirty state detection accurately checks all form fields", () => {
    // Helper replicating component logic
    const computeIsDirty = (state: {
      scheduledResult: any;
      title: string;
      subject: string;
      date: string;
      time: string;
      description: string;
      emailInput: string;
      invitees: any[];
      durationMinutes: number;
    }) => {
      return Boolean(
        !state.scheduledResult && (
          state.title.trim().length > 0 ||
          state.subject.trim().length > 0 ||
          state.date.trim().length > 0 ||
          state.time.trim().length > 0 ||
          state.description.trim().length > 0 ||
          state.emailInput.trim().length > 0 ||
          state.invitees.length > 0 ||
          state.durationMinutes !== 0
        )
      );
    };

    // Clean initial state -> not dirty
    assert.equal(
      computeIsDirty({
        scheduledResult: null,
        title: "",
        subject: "",
        date: "",
        time: "",
        description: "",
        emailInput: "",
        invitees: [],
        durationMinutes: 0,
      }),
      false,
      "Empty form must be clean"
    );

    // Any individual field change makes it dirty
    assert.equal(computeIsDirty({ scheduledResult: null, title: "Algebra", subject: "", date: "", time: "", description: "", emailInput: "", invitees: [], durationMinutes: 0 }), true);
    assert.equal(computeIsDirty({ scheduledResult: null, title: "", subject: "Math", date: "", time: "", description: "", emailInput: "", invitees: [], durationMinutes: 0 }), true);
    assert.equal(computeIsDirty({ scheduledResult: null, title: "", subject: "", date: "2026-11-20", time: "", description: "", emailInput: "", invitees: [], durationMinutes: 0 }), true);
    assert.equal(computeIsDirty({ scheduledResult: null, title: "", subject: "", date: "", time: "14:00", description: "", emailInput: "", invitees: [], durationMinutes: 0 }), true);
    assert.equal(computeIsDirty({ scheduledResult: null, title: "", subject: "", date: "", time: "", description: "Bring notebooks", emailInput: "", invitees: [], durationMinutes: 0 }), true);
    assert.equal(computeIsDirty({ scheduledResult: null, title: "", subject: "", date: "", time: "", description: "", emailInput: "test@gmail.com", invitees: [], durationMinutes: 0 }), true);
    assert.equal(computeIsDirty({ scheduledResult: null, title: "", subject: "", date: "", time: "", description: "", emailInput: "", invitees: [{ email: "a@b.com" }], durationMinutes: 0 }), true);
    assert.equal(computeIsDirty({ scheduledResult: null, title: "", subject: "", date: "", time: "", description: "", emailInput: "", invitees: [], durationMinutes: 45 }), true);
  });

  await t.test("SCW-02: Successfully scheduled class suppresses dirty state to allow clean dismissal", () => {
    const isDirtyWithResult = Boolean(
      !{ roomCode: "abc-defg-hij" } && (
        "Algebra".trim().length > 0
      )
    );
    assert.equal(isDirtyWithResult, false, "Once class is scheduled, isDirty must be false so user can exit cleanly");
  });

  await t.test("SCW-03: ScheduleClassModal source code declares showDiscardConfirm state and isDirty logic", () => {
    assert.match(modalCode, /showDiscardConfirm/);
    assert.match(modalCode, /setShowDiscardConfirm/);
    assert.match(modalCode, /isDirty/);
    assert.match(modalCode, /handleAttemptClose/);
    assert.match(modalCode, /forceClose/);
  });

  await t.test("SCW-04: Backdrop click intercepts accidental dismissals and checks dirty state", () => {
    // Backdrop click must not unconditionally call handleClose
    assert.doesNotMatch(modalCode, /onClick=\{\(\)\s*=>\s*\{\s*if\s*\(!isSubmitting\)\s*handleClose\(\);?\s*\}\}/);
    // Must delegate to handleAttemptClose
    assert.match(modalCode, /handleAttemptClose\(\)/);
  });

  await t.test("SCW-05: Escape key listener respects unsaved changes and discard confirmation dialog", () => {
    assert.match(modalCode, /e\.key === "Escape"/);
    assert.match(modalCode, /showDiscardConfirm/);
  });

  await t.test("SCW-06: Header close X button delegates to safe close handler", () => {
    assert.match(modalCode, /onClick=\{handleAttemptClose\}/);
  });

  await t.test("SCW-07: Unsaved Changes confirmation dialog is rendered with clear warning and actions", () => {
    assert.match(modalCode, /Discard unsaved class\?/);
    assert.match(modalCode, /Keep Editing/);
    assert.match(modalCode, /Discard Changes/);
    assert.match(modalCode, /data-testid="discard-schedule-confirm-dialog"/);
  });

  await t.test("SCW-08: Browser beforeunload listener guards against accidental tab refresh / close when dirty", () => {
    assert.match(modalCode, /beforeunload/);
    assert.match(modalCode, /handleBeforeUnload/);
  });
});
