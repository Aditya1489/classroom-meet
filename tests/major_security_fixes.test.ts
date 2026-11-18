import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { query, pool } from "../server/db";
import { issueParticipantToken } from "../server/services/participantTokenService";

const JWT_SECRET = process.env.JWT_SECRET || "mathsy_meet_jwt_secret_dev_key_2026";
const API_BASE = process.env.API_BASE || "http://localhost:5001/api";

type TestUser = { id: string; email: string; name: string; token: string };

async function createUser(email: string, role: "tutor" | "student", fullName?: string): Promise<TestUser> {
  const name = fullName || email.split("@")[0];
  const res = await query(
    `INSERT INTO users (email, full_name, role, auth_provider, onboarding_completed)
     VALUES ($1, $2, $3, 'google', TRUE)
     ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, full_name = EXCLUDED.full_name, onboarding_completed = TRUE
     RETURNING id;`,
    [email, name, role]
  );
  const id = res.rows[0].id;
  const token = jwt.sign({ id, sub: id, email, name, role }, JWT_SECRET, { expiresIn: "1h" });
  return { id, email, name, token };
}

async function api(method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON body
  }
  return { status: res.status, data };
}

describe("Major security fixes (embed provisioning, poll answers, chat membership, leave/knock auth, embed vote dedupe)", () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const roomCode = `major-${suffix}`;
  let tutor: TestUser;
  let student: TestUser;
  let outsider: TestUser;
  let nameTwin: TestUser;

  before(async () => {
    tutor = await createUser(`major-tutor-${suffix}@example.test`, "tutor");
    student = await createUser(`major-student-${suffix}@example.test`, "student", `Major Student ${suffix}`);
    outsider = await createUser(`major-outsider-${suffix}@example.test`, "tutor");
    // Different account that shares the student's display name
    nameTwin = await createUser(`major-twin-${suffix}@example.test`, "student", `Major Student ${suffix}`);

    assert.equal((await api("POST", "/rooms", { token: tutor.token, body: { roomCode, title: "Major" } })).status, 200);
    assert.equal((await api("POST", `/rooms/${roomCode}/participants`, { token: tutor.token })).status, 200);
    const knock = await api("POST", `/rooms/${roomCode}/knock`, { token: student.token });
    assert.equal(knock.status, 200, "setup: student knocks");
    await api("POST", `/rooms/${roomCode}/knock/${knock.data.knock.id}/respond`, { token: tutor.token, body: { action: "admit" } });
    assert.equal((await api("POST", `/rooms/${roomCode}/participants`, { token: student.token })).status, 200, "setup: student joins");
  });

  after(async () => {
    await api("POST", `/rooms/${roomCode}/end`, { token: tutor.token });
    await query("DELETE FROM users WHERE email LIKE $1", [`major-%-${suffix}@example.test`]).catch(() => {});
    await pool.end().catch(() => {});
  });

  describe("1. Embed config never provisions or reactivates rooms", () => {
    it("returns 404 for an unknown room and does not create it", async () => {
      const ghost = `ghost-${suffix}`;
      const r = await api("GET", `/v1/embed/config/${ghost}`);
      assert.equal(r.status, 404);
      const rows = await query("SELECT 1 FROM live_classes WHERE room_code = $1", [ghost]);
      assert.equal(rows.rows.length, 0, "no live_classes row may be created by an unauthenticated GET");
    });

    it("does not reactivate an ended room", async () => {
      const endedCode = `ended-${suffix}`;
      await api("POST", "/rooms", { token: tutor.token, body: { roomCode: endedCode, title: "Ended" } });
      await api("POST", `/rooms/${endedCode}/end`, { token: tutor.token });
      const r = await api("GET", `/v1/embed/config/${endedCode}`);
      assert.equal(r.status, 404);
      const row = await query("SELECT is_active FROM live_classes WHERE room_code = $1", [endedCode]);
      assert.equal(row.rows[0].is_active, false, "ended room must stay ended");
    });

    describe("with an organization room", () => {
      const orgRoom = `orgroom-${suffix}-ab`;
      let orgId: string;

      before(async () => {
        const org = await query(
          `INSERT INTO organizations (name, slug, status) VALUES ($1, $2, 'active') RETURNING id;`,
          [`Major Org ${suffix}`, `major-org-${suffix}`]
        );
        orgId = org.rows[0].id;
        await query(
          `INSERT INTO customer_apps (organization_id, app_name, allowed_domains) VALUES ($1, 'Major App', $2::text[])`,
          [orgId, ["https://school.example"]]
        );
        await query(
          `INSERT INTO live_classes (room_code, title, organization_id, is_active, started_at) VALUES ($1, 'Org room', $2, TRUE, NOW())`,
          [orgRoom, orgId]
        );
      });

      after(async () => {
        await query("DELETE FROM live_classes WHERE room_code = $1", [orgRoom]).catch(() => {});
        await query("DELETE FROM customer_apps WHERE organization_id = $1", [orgId]).catch(() => {});
        await query("DELETE FROM organizations WHERE id = $1", [orgId]).catch(() => {});
      });

      it("resolves the exact room code", async () => {
        const r = await api("GET", `/v1/embed/config/${orgRoom}`);
        assert.equal(r.status, 200);
        assert.equal(r.data.roomCode, orgRoom);
      });

      it("does not match a different code that only differs by removed separators", async () => {
        const squashed = orgRoom.replace(/-/g, "");
        const r = await api("GET", `/v1/embed/config/${squashed}`);
        assert.equal(r.status, 404);
      });

      it("does not trust look-alike localhost origins", async () => {
        const r = await api("GET", `/v1/embed/config/${orgRoom}?parentOrigin=${encodeURIComponent("https://localhost.attacker.example")}`);
        assert.equal(r.status, 200);
        assert.equal(r.data.isOriginAllowed, false);
        assert.ok(!r.data.allowedOrigins.includes("https://localhost.attacker.example"));
      });

      it("still allows a registered origin", async () => {
        const r = await api("GET", `/v1/embed/config/${orgRoom}?parentOrigin=${encodeURIComponent("https://school.example")}`);
        assert.equal(r.data.isOriginAllowed, true);
      });
    });
  });

  describe("2. Poll answers stay hidden from students until the poll ends", () => {
    let pollId: string;

    before(async () => {
      const poll = await api("POST", `/rooms/${roomCode}/polls`, {
        token: tutor.token,
        body: { question: "3 x 3?", options: ["6", "9"], correct_option_index: 1 },
      });
      assert.equal(poll.status, 200);
      pollId = poll.data.poll.id;
    });

    it("student listing omits the answer while the poll is active", async () => {
      const r = await api("GET", `/rooms/${roomCode}/polls`, { token: student.token });
      assert.equal(r.status, 200);
      const p = r.data.polls.find((x: any) => x.id === pollId);
      assert.equal(p.correctOptionIndex, null);
      assert.ok(!(p.optionsDetailed || []).some((o: any) => "is_correct" in o));
    });

    it("host listing still includes the answer", async () => {
      const r = await api("GET", `/rooms/${roomCode}/polls`, { token: tutor.token });
      const p = r.data.polls.find((x: any) => x.id === pollId);
      assert.equal(p.correctOptionIndex, 1);
    });

    it("student vote response reports correctness without exposing the answer index", async () => {
      const r = await api("POST", `/polls/${pollId}/vote`, { token: student.token, body: { option_index: 0 } });
      assert.equal(r.status, 200);
      assert.equal(r.data.vote.is_correct, false);
    });

    it("student sees the answer after the poll ends", async () => {
      await api("POST", `/polls/${pollId}/end`, { token: tutor.token });
      const r = await api("GET", `/rooms/${roomCode}/polls`, { token: student.token });
      const p = r.data.polls.find((x: any) => x.id === pollId);
      assert.equal(p.correctOptionIndex, 1);
    });
  });

  describe("3. Chat and participant list are limited to people in the class", () => {
    it("participant can read and post chat", async () => {
      assert.equal((await api("GET", `/rooms/${roomCode}/chat`, { token: student.token })).status, 200);
      const post = await api("POST", `/rooms/${roomCode}/chat`, { token: student.token, body: { text: "hi from student" } });
      assert.ok([200, 201].includes(post.status));
    });

    it("signed-in outsider cannot read chat", async () => {
      assert.equal((await api("GET", `/rooms/${roomCode}/chat`, { token: outsider.token })).status, 403);
    });

    it("signed-in outsider cannot post chat", async () => {
      const r = await api("POST", `/rooms/${roomCode}/chat`, { token: outsider.token, body: { text: "spam" } });
      assert.equal(r.status, 403);
    });

    it("signed-in outsider cannot list participants", async () => {
      assert.equal((await api("GET", `/rooms/${roomCode}/participants`, { token: outsider.token })).status, 403);
    });

    it("a different account with the same display name as a participant is still rejected", async () => {
      assert.equal((await api("GET", `/rooms/${roomCode}/chat`, { token: nameTwin.token })).status, 403);
    });

    it("host and participants can list participants", async () => {
      assert.equal((await api("GET", `/rooms/${roomCode}/participants`, { token: tutor.token })).status, 200);
      assert.equal((await api("GET", `/rooms/${roomCode}/participants`, { token: student.token })).status, 200);
    });
  });

  describe("4. Leave requires the caller's own identity", () => {
    it("anonymous leave naming another user's id is rejected and changes nothing", async () => {
      const r = await api("POST", `/rooms/${roomCode}/leave`, { body: { user_id: student.id } });
      assert.equal(r.status, 401);
      const active = await query(
        "SELECT 1 FROM room_participants WHERE room_code = $1 AND user_id = $2 AND left_at IS NULL",
        [roomCode, student.id]
      );
      assert.equal(active.rows.length, 1, "student must still be in the class");
    });

    it("an authenticated caller cannot mark someone else as left via body user_id", async () => {
      await api("POST", `/rooms/${roomCode}/leave`, { token: outsider.token, body: { user_id: student.id, display_name: student.name } });
      const active = await query(
        "SELECT 1 FROM room_participants WHERE room_code = $1 AND user_id = $2 AND left_at IS NULL",
        [roomCode, student.id]
      );
      assert.equal(active.rows.length, 1, "student must still be in the class");
    });

    it("the page-close beacon can authenticate with a token in the body and only marks the caller", async () => {
      const r = await api("POST", `/rooms/${roomCode}/leave`, { body: { token: student.token } });
      assert.equal(r.status, 200);
      const active = await query(
        "SELECT 1 FROM room_participants WHERE room_code = $1 AND user_id = $2 AND left_at IS NULL",
        [roomCode, student.id]
      );
      assert.equal(active.rows.length, 0, "student is marked as left");
    });
  });

  describe("5. Knocking requires sign-in and uses the signed-in identity", () => {
    it("anonymous knock is rejected", async () => {
      const r = await api("POST", `/rooms/${roomCode}/knock`, { body: { email: "victim@example.test", display_name: "Victim" } });
      assert.equal(r.status, 401);
    });

    it("signed-in knock ignores spoofed name and email in the body", async () => {
      const r = await api("POST", `/rooms/${roomCode}/knock`, {
        token: outsider.token,
        body: { email: "victim@example.test", display_name: "Victim", role: "tutor" },
      });
      assert.equal(r.status, 200);
      assert.equal(r.data.knock.email, outsider.email);
      assert.notEqual(r.data.knock.display_name, "Victim");
      assert.equal(r.data.knock.role, "student");
    });
  });

  describe("6. Embedded participants get one vote per poll", () => {
    it("repeated votes from the same participant token are de-duplicated", async () => {
      const poll = await api("POST", `/rooms/${roomCode}/polls`, {
        token: tutor.token,
        body: { question: "Pick one", options: ["A", "B"] },
      });
      const pollId = poll.data.poll.id;
      const room = await query("SELECT id, room_code, is_active FROM live_classes WHERE room_code = $1", [roomCode]);
      const { token } = issueParticipantToken({
        organizationId: "00000000-0000-0000-0000-000000000000",
        room: room.rows[0],
        participantId: `embed-student-${suffix}`,
        name: "Embed Student",
        role: "student",
      });

      for (const idx of [0, 1, 0]) {
        const r = await api("POST", `/polls/${pollId}/vote`, { token, body: { option_index: idx } });
        assert.equal(r.status, 200);
      }
      const votes = await query("SELECT COUNT(*)::int AS n FROM poll_votes WHERE poll_id = $1", [pollId]);
      assert.equal(votes.rows[0].n, 1, "one participant token must produce one vote row");
    });
  });
});
