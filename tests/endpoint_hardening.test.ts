import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { query, pool } from "../server/db";

const JWT_SECRET = process.env.JWT_SECRET || "mathsy_meet_jwt_secret_dev_key_2026";
const API_BASE = process.env.API_BASE || "http://localhost:5001/api";
const BAD_ID = "not-a-uuid";
const ZERO_ID = "00000000-0000-0000-0000-000000000000";

type TestUser = { id: string; email: string; token: string };

async function createUser(email: string, role: "tutor" | "student", onboardingCompleted = true): Promise<TestUser> {
  const res = await query(
    `INSERT INTO users (email, full_name, role, auth_provider, onboarding_completed)
     VALUES ($1, $2, $3, 'google', $4)
     ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, onboarding_completed = EXCLUDED.onboarding_completed
     RETURNING id;`,
    [email, email.split("@")[0], role, onboardingCompleted]
  );
  const id = res.rows[0].id;
  const token = jwt.sign({ id, sub: id, email, name: email.split("@")[0], role }, JWT_SECRET, { expiresIn: "1h" });
  return { id, email, token };
}

async function api(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON body
  }
  return { status: res.status, data };
}

describe("Endpoint hardening: malformed IDs, input validation, onboarding role escalation", () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const roomCode = `harden-${suffix}`;
  let tutor: TestUser;
  let student: TestUser;
  let pollId: string;

  before(async () => {
    tutor = await createUser(`harden-tutor-${suffix}@example.test`, "tutor");
    student = await createUser(`harden-student-${suffix}@example.test`, "student");

    const created = await api("POST", "/rooms", tutor.token, { roomCode, title: "Hardening" });
    assert.equal(created.status, 200, "setup: tutor creates room");
    const hostJoin = await api("POST", `/rooms/${roomCode}/participants`, tutor.token);
    assert.equal(hostJoin.status, 200, "setup: host joins");

    const knock = await api("POST", `/rooms/${roomCode}/knock`, student.token);
    await api("POST", `/rooms/${roomCode}/knock/${knock.data.knock.id}/respond`, tutor.token, { action: "admit" });
    const studentJoin = await api("POST", `/rooms/${roomCode}/participants`, student.token);
    assert.equal(studentJoin.status, 200, "setup: admitted student joins");

    const poll = await api("POST", `/rooms/${roomCode}/polls`, tutor.token, {
      question: "2 + 2 = ?",
      options: ["3", "4", "5"],
      correct_option_index: 1,
    });
    assert.equal(poll.status, 200, "setup: poll created");
    pollId = poll.data.poll.id;
  });

  after(async () => {
    await api("POST", `/rooms/${roomCode}/end`, tutor.token);
    await query("DELETE FROM users WHERE email LIKE $1", [`harden-%-${suffix}@example.test`]).catch(() => {});
    await pool.end().catch(() => {});
  });

  describe("Malformed or unknown IDs return 4xx instead of 500", () => {
    it("GET knock status with a non-UUID knockId returns 404", async () => {
      const r = await api("GET", `/rooms/${roomCode}/knock/${BAD_ID}`);
      assert.equal(r.status, 404);
    });

    it("POST knock cancel with a non-UUID knockId returns 404", async () => {
      const r = await api("POST", `/rooms/${roomCode}/knock/${BAD_ID}/cancel`);
      assert.equal(r.status, 404);
    });

    it("POST knock respond with a non-UUID knockId returns 404", async () => {
      const r = await api("POST", `/rooms/${roomCode}/knock/${BAD_ID}/respond`, tutor.token, { action: "admit" });
      assert.equal(r.status, 404);
    });

    it("POST poll vote with a non-UUID pollId returns 404", async () => {
      const r = await api("POST", `/polls/${BAD_ID}/vote`, student.token, { option_index: 0 });
      assert.equal(r.status, 404);
    });

    it("POST poll end with a non-UUID pollId returns 404", async () => {
      const r = await api("POST", `/polls/${BAD_ID}/end`, tutor.token);
      assert.equal(r.status, 404);
    });

    it("DELETE schedule with a non-UUID id returns 404", async () => {
      const r = await api("DELETE", `/classes/${BAD_ID}`, tutor.token);
      assert.equal(r.status, 404);
    });

    it("DELETE schedule that does not exist (or belongs to someone else) returns 404", async () => {
      const r = await api("DELETE", `/classes/${ZERO_ID}`, tutor.token);
      assert.equal(r.status, 404);
    });

    it("GET organization with a non-UUID orgId returns 404", async () => {
      const r = await api("GET", `/organizations/${BAD_ID}`, tutor.token);
      assert.equal(r.status, 404);
    });
  });

  describe("Poll input validation", () => {
    it("rejects a non-string question with 400", async () => {
      const r = await api("POST", `/rooms/${roomCode}/polls`, tutor.token, { question: 5, options: ["a", "b"] });
      assert.equal(r.status, 400);
    });

    it("rejects a whitespace-only question with 400", async () => {
      const r = await api("POST", `/rooms/${roomCode}/polls`, tutor.token, { question: "   ", options: ["a", "b"] });
      assert.equal(r.status, 400);
    });

    it("rejects a non-integer option_index with 400", async () => {
      const r = await api("POST", `/polls/${pollId}/vote`, student.token, { option_index: "abc" });
      assert.equal(r.status, 400);
    });

    it("grades a numeric-string option_index the same as a number", async () => {
      const r = await api("POST", `/polls/${pollId}/vote`, student.token, { option_index: "1" });
      assert.equal(r.status, 200);
      assert.equal(r.data.vote.is_correct, true, "option '1' is the correct answer and must be graded correct");
    });

    it("still records a normal numeric vote and grades it", async () => {
      const r = await api("POST", `/polls/${pollId}/vote`, student.token, { option_index: 0 });
      assert.equal(r.status, 200);
      assert.equal(r.data.vote.is_correct, false);
    });
  });

  describe("Role escalation via stale onboarding token", () => {
    it("an onboarded student holding an old needsRoleSelection=true token cannot self-promote to tutor", async () => {
      const staleToken = jwt.sign(
        { id: student.id, sub: student.id, email: student.email, name: "s", role: "student", needsRoleSelection: true },
        JWT_SECRET,
        { expiresIn: "1h" }
      );
      const r = await api("PATCH", "/auth/role", staleToken, { role: "tutor" });
      assert.equal(r.status, 403);
      const row = await query("SELECT role FROM users WHERE id = $1", [student.id]);
      assert.equal(row.rows[0].role, "student", "DB role must remain student");
    });

    it("a genuinely new user (onboarding not completed) can still pick tutor once", async () => {
      const fresh = await createUser(`harden-fresh-${suffix}@example.test`, "student", false);
      const onboardingToken = jwt.sign(
        { id: fresh.id, sub: fresh.id, email: fresh.email, name: "f", role: "student", needsRoleSelection: true },
        JWT_SECRET,
        { expiresIn: "1h" }
      );
      const first = await api("PATCH", "/auth/role", onboardingToken, { role: "tutor" });
      assert.equal(first.status, 200);
      assert.equal(first.data.role, "tutor");

      // Re-using the same onboarding token after onboarding has completed must not allow another switch
      await query("UPDATE users SET role = 'student' WHERE id = $1", [fresh.id]);
      const replay = await api("PATCH", "/auth/role", onboardingToken, { role: "tutor" });
      assert.equal(replay.status, 403);
    });
  });
});
