import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import http from "node:http";
import crypto from "node:crypto";
import { query, pool } from "../server/db";
import { createApiKey } from "../server/services/apiKeyService";
import {
  validateWebhookUrl,
  computeWebhookSignature,
  generateWebhookSecret,
  createWebhookEndpoint,
  listWebhookEndpoints,
  isPrivateOrRestrictedIp,
} from "../server/services/webhookService";
import {
  calculateBilledMinutes,
  generateIdempotencyKey,
  recordSessionUsage,
  reconcileRoomSessions,
  getOrganizationUsageSummary,
} from "../server/services/meteringService";
import { redactString, redactObject } from "../server/services/logger";
import { MathsyMeetServerClient } from "../sdk/dist/server.mjs";

const API_BASE = "http://localhost:5001";

describe("Phase 6: SaaS Operations Test Suite", () => {
  let orgAId: string;
  let orgBId: string;
  let userAId: string;
  let userBId: string;
  let orgAApiKey: string;

  before(async () => {
    // 1. Create Organization A
    const orgARes = await query(
      `INSERT INTO organizations (name, slug, status, settings, plan_tier, monthly_minute_limit)
       VALUES ('Ops Org Alpha', $1, 'active', '{"plan": "pro"}'::jsonb, 'pro', 25000)
       RETURNING id;`,
      [`ops-alpha-${Date.now().toString(36)}`]
    );
    orgAId = orgARes.rows[0].id;

    // 2. Create Organization B (Tenant Isolation Target)
    const orgBRes = await query(
      `INSERT INTO organizations (name, slug, status, settings, plan_tier, monthly_minute_limit)
       VALUES ('Ops Org Beta', $1, 'active', '{"plan": "starter"}'::jsonb, 'starter', 5000)
       RETURNING id;`,
      [`ops-beta-${Date.now().toString(36)}`]
    );
    orgBId = orgBRes.rows[0].id;

    // 3. Create Users & Memberships
    userAId = crypto.randomUUID();
    userBId = crypto.randomUUID();

    await query(
      `INSERT INTO users (id, email, full_name, role, is_active)
       VALUES ($1, $2, 'Alice Admin', 'tutor', TRUE),
              ($3, $4, 'Bob Attacker', 'tutor', TRUE);`,
      [userAId, `alice-${Date.now()}@test.com`, userBId, `bob-${Date.now()}@test.com`]
    );

    await query(
      `INSERT INTO organization_members (organization_id, user_id, role)
       VALUES ($1, $2, 'owner'), ($3, $4, 'owner');`,
      [orgAId, userAId, orgBId, userBId]
    );

    // 4. Create API Key for Org A
    const key = await createApiKey({
      organizationId: orgAId,
      name: "Ops Key A",
      environment: "test",
      permissions: ["rooms:read", "rooms:write", "tokens:write"],
    });
    orgAApiKey = key.rawKey;
  });

  // --- TEST 1: Request ID Middleware ---
  it("TC-OPS-REQID-01: Adopts valid X-Request-Id and generates UUIDv4 for missing or malformed inputs", async () => {
    // 1. Missing request ID -> generates new UUIDv4
    const res1 = await fetch(`${API_BASE}/api/health/live`);
    assert.strictEqual(res1.status, 200);
    const reqId1 = res1.headers.get("x-request-id");
    assert.ok(reqId1, "Response must include X-Request-Id header");
    assert.match(reqId1, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    // 2. Client-supplied valid request ID -> preserved
    const customId = "client-trace-abc-12345";
    const res2 = await fetch(`${API_BASE}/api/health/live`, {
      headers: { "X-Request-Id": customId },
    });
    assert.strictEqual(res2.headers.get("x-request-id"), customId);

    // 3. Client-supplied malformed/hostile input -> replaced with safe UUIDv4
    const res3 = await fetch(`${API_BASE}/api/health/live`, {
      headers: { "X-Request-Id": "<script>alert(1)</script>" },
    });
    const reqId3 = res3.headers.get("x-request-id");
    assert.notStrictEqual(reqId3, "<script>alert(1)</script>");
    assert.match(reqId3!, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  // --- TEST 2: Structured Logging & Secret Redaction ---
  it("TC-OPS-LOG-02: Structured JSON logger automatically redacts API keys, JWTs, secrets, and auth headers", () => {
    // 1. String redactions
    const sampleRaw = "Authorization: Bearer sec_live_1234567890abcdef1234567890 and whsec_abcdef0123456789abcdef0123456789 with token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozS6q_b";
    const sanitized = redactString(sampleRaw);
    assert.ok(!sanitized.includes("sec_live_1234567890"), "Must redact API key");
    assert.ok(!sanitized.includes("whsec_abcdef0123"), "Must redact webhook secret");
    assert.ok(!sanitized.includes("eyJhbGciOiJIUzI1NiJ9"), "Must redact JWT");
    assert.ok(sanitized.includes("[REDACTED]"), "Must contain REDACTED marker");

    // 2. Object redactions
    const payload = {
      user: "test-user",
      apiKey: "sec_test_secret123456789",
      token: "secret-token-value",
      password: "SuperSecretPassword123!",
      nested: {
        authorization: "Bearer secret-bearer-token",
        safeField: "safe value",
      },
    };
    const cleaned = redactObject(payload);
    assert.strictEqual(cleaned.apiKey, "[REDACTED]");
    assert.strictEqual(cleaned.token, "[REDACTED]");
    assert.strictEqual(cleaned.password, "[REDACTED]");
    assert.strictEqual(cleaned.nested.authorization, "[REDACTED]");
    assert.strictEqual(cleaned.nested.safeField, "safe value");
  });

  // --- TEST 3: SSRF Protection ---
  it("TC-OPS-SSRF-03: Webhook URL validator blocks loopback, private RFC1918, and cloud metadata targets", async () => {
    // Loopback targets
    const r1 = await validateWebhookUrl("http://localhost:3000/webhook");
    assert.strictEqual(r1.valid, false, "Must block localhost");

    const r2 = await validateWebhookUrl("http://127.0.0.1:8080/hook");
    assert.strictEqual(r2.valid, false, "Must block 127.0.0.1");

    // Cloud metadata service
    const r3 = await validateWebhookUrl("http://169.254.169.254/latest/meta-data");
    assert.strictEqual(r3.valid, false, "Must block cloud metadata IP");

    // Private RFC1918 addresses
    const r4 = await validateWebhookUrl("http://10.0.0.1/hook");
    assert.strictEqual(r4.valid, false, "Must block 10.x.x.x");

    const r5 = await validateWebhookUrl("http://192.168.1.50:5000/hook");
    assert.strictEqual(r5.valid, false, "Must block 192.168.x.x");

    // Non-HTTP protocols
    const r6 = await validateWebhookUrl("ftp://api.example.com/hook");
    assert.strictEqual(r6.valid, false, "Must block non-HTTP protocols");

    // IPv4-mapped IPv6 targets (SSRF evasion mitigation)
    assert.strictEqual(isPrivateOrRestrictedIp("::ffff:127.0.0.1"), true, "Must block IPv4-mapped loopback");
    assert.strictEqual(isPrivateOrRestrictedIp("::ffff:169.254.169.254"), true, "Must block IPv4-mapped metadata");
    assert.strictEqual(isPrivateOrRestrictedIp("::ffff:10.0.0.1"), true, "Must block IPv4-mapped private 10.x");
    assert.strictEqual(isPrivateOrRestrictedIp("::ffff:7f00:0001"), true, "Must block hex IPv4-mapped loopback");

    // IPv4-compatible IPv6 targets
    assert.strictEqual(isPrivateOrRestrictedIp("::127.0.0.1"), true, "Must block IPv4-compatible loopback");
    assert.strictEqual(isPrivateOrRestrictedIp("::169.254.169.254"), true, "Must block IPv4-compatible metadata");
    assert.strictEqual(isPrivateOrRestrictedIp("::7f00:1"), true, "Must block hex IPv4-compatible loopback");

    // NAT64 & 6to4 encapsulation targets
    assert.strictEqual(isPrivateOrRestrictedIp("64:ff9b::127.0.0.1"), true, "Must block NAT64 mapped loopback");
    assert.strictEqual(isPrivateOrRestrictedIp("64:ff9b::8.8.8.8"), false, "Must allow NAT64 public IP");
    assert.strictEqual(isPrivateOrRestrictedIp("2002:7f00:1::"), true, "Must block 6to4 encapsulated loopback");
    assert.strictEqual(isPrivateOrRestrictedIp("2002:0808:0808::"), false, "Must allow 6to4 public IP");

    // Multicast, link-local, documentation & unspecified ranges
    assert.strictEqual(isPrivateOrRestrictedIp("224.0.0.1"), true, "Must block IPv4 multicast");
    assert.strictEqual(isPrivateOrRestrictedIp("ff02::1"), true, "Must block IPv6 multicast");
    assert.strictEqual(isPrivateOrRestrictedIp("fe80::1"), true, "Must block IPv6 link-local");
    assert.strictEqual(isPrivateOrRestrictedIp("2001:db8::1"), true, "Must block IPv6 documentation prefix");
    assert.strictEqual(isPrivateOrRestrictedIp("::"), true, "Must block unspecified IPv6 ::");

    // URL validation with bracketed literals
    const rBracketLoopback = await validateWebhookUrl("http://[::1]/hook");
    assert.strictEqual(rBracketLoopback.valid, false, "Must block bracketed IPv6 loopback");

    const rBracketMapped = await validateWebhookUrl("http://[::ffff:169.254.169.254]/latest/meta-data");
    assert.strictEqual(rBracketMapped.valid, false, "Must block bracketed IPv4-mapped metadata");

    // Valid public IP targets pass
    assert.strictEqual(isPrivateOrRestrictedIp("8.8.8.8"), false, "Public IP must not be restricted");
    assert.strictEqual(isPrivateOrRestrictedIp("2607:f8b0:4005:805::200e"), false, "Public IPv6 must not be restricted");
  });

  // --- TEST 4: Webhook Signature & Replay Protection ---
  it("TC-OPS-WH-SIG-04: Computes HMAC-SHA256 signature and validates using SDK verifyWebhookSignature", () => {
    const { rawSecret } = generateWebhookSecret();
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      event: "room.created",
      eventId: "evt_test123",
      timestamp,
      data: { roomCode: "ptq-rtvq-rox" },
    });

    const sig = computeWebhookSignature(rawSecret, timestamp, payload);
    const header = `t=${timestamp},v1=${sig}`;

    // 1. Valid signature passes
    const v1 = MathsyMeetServerClient.verifyWebhookSignature({
      payload,
      signatureHeader: header,
      secret: rawSecret,
    });
    assert.strictEqual(v1.valid, true);

    // 2. Tampered payload fails
    const v2 = MathsyMeetServerClient.verifyWebhookSignature({
      payload: payload + "tampered",
      signatureHeader: header,
      secret: rawSecret,
    });
    assert.strictEqual(v2.valid, false);
    assert.strictEqual(v2.error, "Invalid signature");

    // 3. Stale timestamp outside 300s tolerance window fails replay protection
    const oldTimestamp = timestamp - 301;
    const oldSig = computeWebhookSignature(rawSecret, oldTimestamp, payload);
    const oldHeader = `t=${oldTimestamp},v1=${oldSig}`;
    const v3 = MathsyMeetServerClient.verifyWebhookSignature({
      payload,
      signatureHeader: oldHeader,
      secret: rawSecret,
    });
    assert.strictEqual(v3.valid, false);
    assert.ok(v3.error?.includes("tolerance window"));

    // 4. Incorrect secret fails
    const v4 = MathsyMeetServerClient.verifyWebhookSignature({
      payload,
      signatureHeader: header,
      secret: "whsec_wrongsecret00000000000000000",
    });
    assert.strictEqual(v4.valid, false);
  });

  // --- TEST 5: Webhook Endpoints & Cross-Tenant Isolation ---
  it("TC-OPS-WH-CRUD-05: Enforces organization isolation on webhook configuration and delivery history", async () => {
    // Enable local webhooks for this test case
    process.env.ALLOW_LOCAL_WEBHOOKS = "true";

    // 1. Org A registers a webhook endpoint
    const { endpoint, rawSecret } = await createWebhookEndpoint({
      organizationId: orgAId,
      url: "http://localhost:9999/acme-webhook",
      events: ["room.created", "room.ended"],
      description: "Acme Webhook Listener",
    });

    assert.ok(endpoint.id);
    assert.strictEqual(endpoint.organizationId, orgAId);
    assert.ok(rawSecret.startsWith("whsec_"));
    assert.strictEqual(endpoint.secretPrefix, rawSecret.slice(0, 12));

    // 2. Listing endpoints for Org A masks raw secret
    const listA = await listWebhookEndpoints(orgAId);
    assert.strictEqual(listA.length, 1);
    assert.strictEqual(listA[0].id, endpoint.id);
    assert.ok(!("rawSecret" in listA[0]));

    // 3. Org B cannot see Org A's endpoints
    const listB = await listWebhookEndpoints(orgBId);
    assert.strictEqual(listB.length, 0, "Org B must have 0 endpoints");

    delete process.env.ALLOW_LOCAL_WEBHOOKS;
  });

  // --- TEST 6: Idempotent Usage Ledger & Billed Minutes ---
  it("TC-OPS-METER-06: Accurately calculates whole billed minutes and enforces ledger idempotency", async () => {
    // 1. Whole minute calculation checks (ceiling rule)
    assert.strictEqual(calculateBilledMinutes(0), 0);
    assert.strictEqual(calculateBilledMinutes(10), 1);
    assert.strictEqual(calculateBilledMinutes(60), 1);
    assert.strictEqual(calculateBilledMinutes(61), 2);
    assert.strictEqual(calculateBilledMinutes(120), 2);
    assert.strictEqual(calculateBilledMinutes(121), 3);
    assert.strictEqual(calculateBilledMinutes(3600), 60);

    const testRoomCode = `meter-test-${Date.now().toString(36)}`;
    const joinTime = new Date(Date.now() - 300000); // 5 minutes ago
    const leaveTime = new Date();

    // 2. Record participant session 1
    const r1 = await recordSessionUsage({
      organizationId: orgAId,
      roomCode: testRoomCode,
      participantId: "student-user-1",
      participantName: "Student One",
      role: "student",
      joinedAt: joinTime,
      leftAt: leaveTime,
    });
    assert.strictEqual(r1.recorded, true);
    assert.strictEqual(r1.billedMinutes, 5);

    // 3. Duplicate record submission with identical idempotency key -> NO-OP (idempotent)
    const r2 = await recordSessionUsage({
      organizationId: orgAId,
      roomCode: testRoomCode,
      participantId: "student-user-1",
      participantName: "Student One",
      role: "student",
      joinedAt: joinTime,
      leftAt: leaveTime,
    });
    assert.strictEqual(r2.recorded, false, "Duplicate entry must not be inserted");

    // 4. Usage summary aggregation
    const summary = await getOrganizationUsageSummary(orgAId);
    assert.strictEqual(summary.organizationId, orgAId);
    assert.ok(summary.totalBilledMinutes >= 5);
    assert.ok(summary.totalParticipantSessions >= 1);
    assert.ok(summary.totalDistinctRooms >= 1);
    assert.strictEqual(summary.breakdownByRole.student >= 5, true);

    // 5. Org B usage summary is isolated and shows 0
    const summaryB = await getOrganizationUsageSummary(orgBId);
    assert.strictEqual(summaryB.totalBilledMinutes, 0);
    assert.strictEqual(summaryB.totalParticipantSessions, 0);
  });

  // --- TEST 7: Health, Liveness & Readiness Probes ---
  it("TC-OPS-HEALTH-07: Health probes report accurate control-plane liveness, DB readiness, and SFU component", async () => {
    // 1. Fast Liveness probe
    const liveRes = await fetch(`${API_BASE}/api/health/live`);
    assert.strictEqual(liveRes.status, 200);
    const liveJson = await liveRes.json();
    assert.strictEqual(liveJson.status, "ok");
    assert.ok(typeof liveJson.uptimeSeconds === "number");

    // 2. DB Readiness probe
    const readyRes = await fetch(`${API_BASE}/api/health/ready`);
    assert.strictEqual(readyRes.status, 200);
    const readyJson = await readyRes.json();
    assert.strictEqual(readyJson.ready, true);
    assert.strictEqual(readyJson.postgres, "ok");

    // 3. Full System Health check
    const healthRes = await fetch(`${API_BASE}/api/health`);
    assert.ok(healthRes.status === 200 || healthRes.status === 503);
    const healthJson = await healthRes.json();
    assert.ok("database" in healthJson);
    assert.ok("mongo" in healthJson);
    assert.ok("sfu" in healthJson);
    assert.ok("components" in healthJson);
    assert.strictEqual(healthJson.components.postgres.status, "ok");
  });

  // --- TEST 8: Route-Specific Rate Limits ---
  it("TC-OPS-RATELIMIT-08: Rejects excessive spam bursts on authentication endpoint with 429", async () => {
    let triggeredRateLimit = false;

    // Burst of 35 requests to /api/auth/google (limit is 30 per minute)
    // Uses an isolated test client IP header so the burst does not pollute localhost for subsequent test suites
    for (let i = 0; i < 35; i++) {
      const res = await fetch(`${API_BASE}/api/auth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-client-ip": "test-ratelimit-burst-client",
        },
        body: JSON.stringify({ idToken: "invalid_token_burst" }),
      });

      if (res.status === 429) {
        triggeredRateLimit = true;
        const json = await res.json();
        assert.strictEqual(json.code, "AUTH_RATE_LIMIT_EXCEEDED");
        assert.ok(res.headers.get("retry-after"));
        break;
      }
    }

    assert.strictEqual(triggeredRateLimit, true, "Rapid burst to auth route must trigger HTTP 429");
  });

  after(async () => {
    await pool.end();
  });
});
