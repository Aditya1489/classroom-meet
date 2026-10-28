import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { pool, query } from "../server/db";
import { MathsyMeetServerClient } from "../sdk/src/server";
import { dispatchTestWebhook, SUPPORTED_WEBHOOK_EVENTS } from "../server/services/webhookService";

// ============================================================================
// PHASE 8 CHECKPOINT 6 & 9: DEVELOPER CONSOLE INTEGRATION & AUDIT TEST SUITE
// ============================================================================
// Tests:
// 1. Webhook Endpoint Registration & Single Raw Secret Reveal
// 2. Webhook List Never Leaks Plaintext or Encrypted Secret
// 3. Webhook Patch (Update URL, Events, isActive, Description)
// 4. Webhook Deliveries Listing & Organization Isolation
// 5. Webhook Delete & Cascade Cleanup
// 6. Cross-Tenant Webhook Isolation (Org B cannot view/edit Org A's webhooks)
// 7. Test Ping Endpoint & Event Dispatch Behavior Audit
// 8. Organization Usage Query, Metrics & Date Range Filtering
// 9. Usage Multi-Tenant Isolation (Org B cannot query Org A's usage)
// 10. SDK Webhook Signature Verification Compatibility
// 11. Webhook Event Whitelist & Validation (SEC-P8-01)
// ============================================================================

const API_BASE = process.env.API_BASE || "http://localhost:5001/api";
const JWT_SECRET = process.env.JWT_SECRET || "mathsy_meet_jwt_secret_dev_key_2026";

describe("Phase 8 Checkpoint 6: Developer Console Integration Suite", () => {
  let userAId: string;
  let userAToken: string;
  let userBId: string;
  let userBToken: string;

  let orgAId: string;
  let orgBId: string;

  let webhookEndpointId: string;
  let rawWebhookSecret: string;
  let originalFetch: typeof globalThis.fetch;

  before(async () => {
    process.env.ALLOW_LOCAL_WEBHOOKS = "true";

    // Mock outbound webhook deliveries so real network requests are not sent
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as any).url;
      if (urlStr.startsWith("https://example.com/webhooks")) {
        return new Response(JSON.stringify({ received: true, status: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(input, init);
    };

    // 1. Seed User A
    userAId = crypto.randomUUID();
    await query(
      `INSERT INTO users (id, email, full_name, role, auth_provider)
       VALUES ($1, 'audit_user_a@example.com', 'Audit User A', 'tutor', 'google')
       ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;`,
      [userAId]
    );
    userAToken = jwt.sign(
      { id: userAId, sub: userAId, email: "audit_user_a@example.com", role: "tutor", name: "Audit User A" },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    // 2. Seed User B
    userBId = crypto.randomUUID();
    await query(
      `INSERT INTO users (id, email, full_name, role, auth_provider)
       VALUES ($1, 'audit_user_b@example.com', 'Audit User B', 'tutor', 'google')
       ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;`,
      [userBId]
    );
    userBToken = jwt.sign(
      { id: userBId, sub: userBId, email: "audit_user_b@example.com", role: "tutor", name: "Audit User B" },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    // 3. Create Org A owned by User A
    const orgARes = await query(
      `INSERT INTO organizations (name, slug)
       VALUES ('Audit Org Alpha', 'audit-org-alpha-${Date.now().toString(36)}')
       RETURNING id;`
    );
    orgAId = orgARes.rows[0].id;
    await query(
      `INSERT INTO organization_members (organization_id, user_id, role)
       VALUES ($1, $2, 'owner');`,
      [orgAId, userAId]
    );

    // 4. Create Org B owned by User B
    const orgBRes = await query(
      `INSERT INTO organizations (name, slug)
       VALUES ('Audit Org Beta', 'audit-org-beta-${Date.now().toString(36)}')
       RETURNING id;`
    );
    orgBId = orgBRes.rows[0].id;
    await query(
      `INSERT INTO organization_members (organization_id, user_id, role)
       VALUES ($1, $2, 'owner');`,
      [orgBId, userBId]
    );
  });

  after(async () => {
    delete process.env.ALLOW_LOCAL_WEBHOOKS;
    if (orgAId) await query("DELETE FROM organizations WHERE id = $1;", [orgAId]);
    if (orgBId) await query("DELETE FROM organizations WHERE id = $1;", [orgBId]);
    if (userAId) await query("DELETE FROM users WHERE id = $1;", [userAId]);
    if (userBId) await query("DELETE FROM users WHERE id = $1;", [userBId]);
    if (originalFetch) globalThis.fetch = originalFetch;
    await pool.end();
  });

  // --- TEST 1: Register Webhook Endpoint & Secret Reveal ---
  it("TC-AUDIT-01: Registers webhook endpoint and returns raw secret strictly ONCE", async () => {
    const res = await fetch(`${API_BASE}/organizations/${orgAId}/webhooks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        url: "https://example.com/webhooks/listener",
        description: "Primary Notification Listener",
        events: ["room.created", "room.ended"],
      }),
    });

    assert.strictEqual(res.status, 201, "Webhook registration must return HTTP 201");
    const data: any = await res.json();

    assert.ok(data.endpoint, "Response must include created endpoint");
    assert.ok(data.secret, "Response must include raw secret upon creation");
    assert.ok(data.secret.startsWith("whsec_"), "Secret must have whsec_ prefix");
    assert.strictEqual(data.endpoint.secretPrefix, data.secret.slice(0, 12));
    assert.strictEqual(data.endpoint.url, "https://example.com/webhooks/listener");
    assert.strictEqual(data.endpoint.isActive, true);
    assert.deepStrictEqual(data.endpoint.events, ["room.created", "room.ended"]);

    webhookEndpointId = data.endpoint.id;
    rawWebhookSecret = data.secret;
  });

  // --- TEST 2: List Webhooks Never Leaks Plaintext Secret ---
  it("TC-AUDIT-02: Listing webhooks returns masked secretPrefix and NEVER exposes raw or encrypted secrets", async () => {
    const res = await fetch(`${API_BASE}/organizations/${orgAId}/webhooks`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    });

    assert.strictEqual(res.status, 200);
    const data: any = await res.json();
    assert.ok(Array.isArray(data.endpoints));
    assert.strictEqual(data.endpoints.length, 1);

    const ep = data.endpoints[0];
    assert.strictEqual(ep.id, webhookEndpointId);
    assert.strictEqual(ep.secretPrefix, rawWebhookSecret.slice(0, 12));
    assert.strictEqual(ep.secret, undefined, "Raw secret must NEVER exist in list response");
    assert.strictEqual(ep.secretHash, undefined, "Secret hash must NOT be leaked");
    assert.strictEqual(ep.encryptedSecret, undefined, "Encrypted secret must NOT be leaked");
  });

  // --- TEST 3: Webhook Patch / Update ---
  it("TC-AUDIT-03: Updates webhook endpoint URL, description, events, and active toggle", async () => {
    const res = await fetch(`${API_BASE}/organizations/${orgAId}/webhooks/${webhookEndpointId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        url: "https://example.com/webhooks/updated",
        description: "Updated Listener Description",
        events: ["room.created"],
        isActive: false,
      }),
    });

    assert.strictEqual(res.status, 200, "PATCH webhook must return HTTP 200");
    const data: any = await res.json();
    assert.strictEqual(data.endpoint.url, "https://example.com/webhooks/updated");
    assert.strictEqual(data.endpoint.description, "Updated Listener Description");
    assert.strictEqual(data.endpoint.isActive, false);
    assert.deepStrictEqual(data.endpoint.events, ["room.created"]);
  });

  // --- TEST 4: Webhook Deliveries List & Isolation ---
  it("TC-AUDIT-04: Returns delivery logs for endpoint and enforces organization isolation", async () => {
    // Manually insert a mock delivery log for this endpoint
    const eventId = `evt_${crypto.randomUUID().replace(/-/g, "")}`;
    await query(
      `INSERT INTO webhook_deliveries (
        organization_id, endpoint_id, event_id, event_type, payload,
        response_status, response_body, attempt_count, status, delivered_at
      ) VALUES ($1, $2, $3, 'room.created', '{"test":true}'::jsonb, 200, '{"ok":true}', 1, 'delivered', NOW());`,
      [orgAId, webhookEndpointId, eventId]
    );

    // 1. Owner A queries deliveries
    const resA = await fetch(
      `${API_BASE}/organizations/${orgAId}/webhooks/${webhookEndpointId}/deliveries`,
      { headers: { Authorization: `Bearer ${userAToken}` } }
    );
    assert.strictEqual(resA.status, 200);
    const dataA: any = await resA.json();
    assert.strictEqual(dataA.deliveries.length, 1);
    assert.strictEqual(dataA.deliveries[0].eventId, eventId);
    assert.strictEqual(dataA.deliveries[0].status, "delivered");
    assert.strictEqual(dataA.deliveries[0].responseStatus, 200);

    // 2. User B in Org B attempts to query Org A's deliveries -> 403 Forbidden
    const resB = await fetch(
      `${API_BASE}/organizations/${orgAId}/webhooks/${webhookEndpointId}/deliveries`,
      { headers: { Authorization: `Bearer ${userBToken}` } }
    );
    assert.strictEqual(resB.status, 403, "User B must be rejected with 403 ORG_ACCESS_DENIED");
  });

  // --- TEST 5: Cross-Tenant Webhook Isolation ---
  it("TC-AUDIT-05: Enforces strict cross-tenant isolation on webhooks", async () => {
    // Org B listing webhooks sees 0
    const listResB = await fetch(`${API_BASE}/organizations/${orgBId}/webhooks`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    const listDataB: any = await listResB.json();
    assert.strictEqual(listDataB.endpoints.length, 0);

    // User B attempts to PATCH Org A's webhook -> 403 Forbidden
    const patchRes = await fetch(`${API_BASE}/organizations/${orgAId}/webhooks/${webhookEndpointId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({ isActive: true }),
    });
    assert.strictEqual(patchRes.status, 403);

    // User B attempts to DELETE Org A's webhook -> 403 Forbidden
    const deleteRes = await fetch(`${API_BASE}/organizations/${orgAId}/webhooks/${webhookEndpointId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    assert.strictEqual(deleteRes.status, 403);
  });

  // --- TEST 6: Audit Test Event Ping Endpoint ---
  it("TC-AUDIT-06: Test ping targets selected endpoint even without webhook.test subscription and writes delivery log", async () => {
    // 1. Reactivate endpoint for testing
    await query("UPDATE webhook_endpoints SET is_active = TRUE WHERE id = $1;", [webhookEndpointId]);

    // 2. Dispatch test ping to endpoint (which only subscribes to room events, NOT webhook.test)
    const testResult = await dispatchTestWebhook(orgAId, webhookEndpointId);
    assert.strictEqual(testResult.dispatched, true, "dispatchTestWebhook must return dispatched: true");
    assert.ok(testResult.eventId, "Test ping response must return eventId");

    // 3. Verify delivery attempt was recorded in webhook_deliveries for this endpoint
    let foundDelivery = false;
    for (let i = 0; i < 15; i++) {
      const delivRes = await query(
        `SELECT id, endpoint_id, event_type, status, error_message
         FROM webhook_deliveries
         WHERE event_id = $1 AND endpoint_id = $2;`,
        [testResult.eventId, webhookEndpointId]
      );
      if (delivRes.rows.length > 0) {
        foundDelivery = true;
        assert.strictEqual(delivRes.rows[0].event_type, "webhook.test");
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(foundDelivery, "Test ping delivery attempt must be recorded in webhook_deliveries");

    // 4. Non-existent endpoint ID returns dispatched: false with 404 reason
    const fakeEndpointId = crypto.randomUUID();
    const notFoundResult = await dispatchTestWebhook(orgAId, fakeEndpointId);
    assert.strictEqual(notFoundResult.dispatched, false);
    assert.strictEqual(notFoundResult.reason, "Webhook endpoint not found");

    // 5. Cross-organization endpoint ID returns dispatched: false with not found reason
    const crossOrgResult = await dispatchTestWebhook(orgBId, webhookEndpointId);
    assert.strictEqual(crossOrgResult.dispatched, false);
    assert.strictEqual(crossOrgResult.reason, "Webhook endpoint not found");

    // 6. Cross-organization HTTP caller User B cannot trigger test ping on Org A endpoint -> 403
    const forbiddenRes = await fetch(
      `${API_BASE}/organizations/${orgAId}/webhooks/${webhookEndpointId}/test`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${userBToken}` },
      }
    );
    assert.strictEqual(forbiddenRes.status, 403, "Cross-org user must be rejected with 403");
  });

  // --- TEST 7: Organization Usage API & Date Ranges & Validation ---
  it("TC-AUDIT-07: Queries usage metrics, breaks down by role, and enforces strict date validation", async () => {
    // Seed sample usage ledger entries for Org A
    const roomCode1 = `audit-room-${Date.now().toString(36)}`;
    const now = new Date();
    const tenMinAgo = new Date(now.getTime() - 600000);

    await query(
      `INSERT INTO organization_usage_ledger (
        organization_id, room_code, participant_id, participant_name,
        role, joined_at, left_at, duration_seconds, billed_minutes, idempotency_key
      ) VALUES
      ($1, $2, 'part_tutor_1', 'Prof Alpha', 'tutor', $3, $4, 600, 10, $5),
      ($1, $2, 'part_student_1', 'Student Beta', 'student', $3, $4, 600, 10, $6);`,
      [
        orgAId,
        roomCode1,
        tenMinAgo.toISOString(),
        now.toISOString(),
        crypto.randomUUID(),
        crypto.randomUUID(),
      ]
    );

    // 1. Query usage without dates (default 30d window)
    const usageRes = await fetch(`${API_BASE}/organizations/${orgAId}/usage`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    assert.strictEqual(usageRes.status, 200);
    const usageData: any = await usageRes.json();
    assert.ok(usageData.usage);
    assert.strictEqual(usageData.usage.organizationId, orgAId);
    assert.strictEqual(usageData.usage.totalBilledMinutes, 20);
    assert.strictEqual(usageData.usage.totalParticipantSessions, 2);
    assert.strictEqual(usageData.usage.totalDistinctRooms, 1);
    assert.strictEqual(usageData.usage.breakdownByRole.tutor, 10);
    assert.strictEqual(usageData.usage.breakdownByRole.student, 10);

    // 2. Reject malformed startDate -> HTTP 400
    const badStartRes = await fetch(
      `${API_BASE}/organizations/${orgAId}/usage?startDate=invalid-date-string`,
      { headers: { Authorization: `Bearer ${userAToken}` } }
    );
    assert.strictEqual(badStartRes.status, 400, "Malformed startDate must return HTTP 400");
    const badStartData: any = await badStartRes.json();
    assert.ok(badStartData.error?.includes("Invalid startDate format"));

    // 3. Reject malformed endDate -> HTTP 400
    const badEndRes = await fetch(
      `${API_BASE}/organizations/${orgAId}/usage?endDate=invalid-end`,
      { headers: { Authorization: `Bearer ${userAToken}` } }
    );
    assert.strictEqual(badEndRes.status, 400, "Malformed endDate must return HTTP 400");
    const badEndData: any = await badEndRes.json();
    assert.ok(badEndData.error?.includes("Invalid endDate format"));

    // 4. Reject invalid date ordering (startDate > endDate) -> HTTP 400
    const invertedRes = await fetch(
      `${API_BASE}/organizations/${orgAId}/usage?startDate=2026-10-28T00:00:00Z&endDate=2026-10-20T00:00:00Z`,
      { headers: { Authorization: `Bearer ${userAToken}` } }
    );
    assert.strictEqual(invertedRes.status, 400, "Inverted date range must return HTTP 400");
    const invertedData: any = await invertedRes.json();
    assert.ok(invertedData.error?.includes("startDate must not be after endDate"));

    // 5. Query with valid date filter outside the window (e.g. 1 year ago) -> HTTP 200 with 0 usage
    const oldStart = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
    const oldEnd = new Date(Date.now() - 360 * 24 * 3600 * 1000).toISOString();
    const emptyRes = await fetch(
      `${API_BASE}/organizations/${orgAId}/usage?startDate=${encodeURIComponent(oldStart)}&endDate=${encodeURIComponent(oldEnd)}`,
      { headers: { Authorization: `Bearer ${userAToken}` } }
    );
    assert.strictEqual(emptyRes.status, 200);
    const emptyData: any = await emptyRes.json();
    assert.strictEqual(emptyData.usage.totalBilledMinutes, 0);
    assert.strictEqual(emptyData.usage.totalParticipantSessions, 0);
  });

  // --- TEST 8: Usage Cross-Tenant Isolation ---
  it("TC-AUDIT-08: Cross-tenant isolation protects usage ledger from unauthorized access", async () => {
    const resB = await fetch(`${API_BASE}/organizations/${orgAId}/usage`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    assert.strictEqual(resB.status, 403, "User B must not be permitted to read Org A's usage");
    const dataB: any = await resB.json();
    assert.strictEqual(dataB.code, "ORG_ACCESS_DENIED");
  });

  // --- TEST 9: SDK Signature Verification Compatibility ---
  it("TC-AUDIT-09: MathsyMeetServerClient verifies real HMAC-SHA256 signatures generated with webhook secrets", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      event: "room.created",
      eventId: "evt_verification_123",
      timestamp,
      organizationId: orgAId,
      data: { roomCode: "abc-defg-hij" },
    });

    const signaturePayload = `${timestamp}.${payload}`;
    const signature = crypto.createHmac("sha256", rawWebhookSecret).update(signaturePayload).digest("hex");
    const signatureHeader = `t=${timestamp},v1=${signature}`;

    const verification = MathsyMeetServerClient.verifyWebhookSignature({
      payload,
      signatureHeader,
      secret: rawWebhookSecret,
      toleranceSeconds: 300,
    });

    assert.strictEqual(verification.valid, true, "Signature verification must succeed");
  });

  // --- TEST 10: Webhook Delete & Cascade ---
  it("TC-AUDIT-10: Deletes webhook endpoint and cascades deletion to delivery logs", async () => {
    const delRes = await fetch(
      `${API_BASE}/organizations/${orgAId}/webhooks/${webhookEndpointId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${userAToken}` },
      }
    );
    assert.strictEqual(delRes.status, 200);

    // Verify endpoint is gone
    const listRes = await fetch(`${API_BASE}/organizations/${orgAId}/webhooks`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    const listData: any = await listRes.json();
    assert.strictEqual(listData.endpoints.length, 0);

    // Verify delivery logs were cascade-deleted
    const delivCount = await query(
      "SELECT COUNT(*)::int as count FROM webhook_deliveries WHERE endpoint_id = $1;",
      [webhookEndpointId]
    );
    assert.strictEqual(delivCount.rows[0].count, 0, "Delivery logs must cascade delete");
  });

  // --- TEST 11: Webhook Event Whitelist & Validation (SEC-P8-01) ---
  it("TC-AUDIT-11: Enforces webhook event whitelist and rejects unimplemented or malformed events", async () => {
    // 1. Create with unknown event name -> HTTP 400
    const unknownCreateRes = await fetch(`${API_BASE}/organizations/${orgAId}/webhooks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        url: "https://example.com/webhooks/listener-unknown",
        events: ["room.created", "unknown.custom_event"],
      }),
    });
    assert.strictEqual(unknownCreateRes.status, 400);
    const unknownCreateData: any = await unknownCreateRes.json();
    assert.ok(unknownCreateData.error?.includes("Unsupported webhook event 'unknown.custom_event'"));
    assert.ok(unknownCreateData.error?.includes("room.created, room.ended"));

    // 2. Create with unimplemented events -> HTTP 400
    for (const unimplEvent of ["participant.joined", "participant.left", "recording.ready"]) {
      const unimplRes = await fetch(`${API_BASE}/organizations/${orgAId}/webhooks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userAToken}`,
        },
        body: JSON.stringify({
          url: "https://example.com/webhooks/unimplemented",
          events: [unimplEvent],
        }),
      });
      assert.strictEqual(unimplRes.status, 400, `Creating with '${unimplEvent}' must return 400`);
      const unimplData: any = await unimplRes.json();
      assert.ok(unimplData.error?.includes(`Unsupported webhook event '${unimplEvent}'`));
    }

    // 3. Create with malformed event values -> HTTP 400
    const malformedPayloads = [
      { events: "room.created" }, // Non-array
      { events: [] },             // Empty array
      { events: [123] },          // Non-string element
      { events: [""] },           // Empty string element
    ];
    for (const badPayload of malformedPayloads) {
      const badRes = await fetch(`${API_BASE}/organizations/${orgAId}/webhooks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userAToken}`,
        },
        body: JSON.stringify({
          url: "https://example.com/webhooks/malformed",
          ...badPayload,
        }),
      });
      assert.strictEqual(badRes.status, 400, "Malformed events payload must return HTTP 400");
    }

    // 4. Create with both supported events -> HTTP 201
    const validCreateRes = await fetch(`${API_BASE}/organizations/${orgAId}/webhooks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        url: "https://example.com/webhooks/valid-both",
        events: ["room.created", "room.ended"],
      }),
    });
    assert.strictEqual(validCreateRes.status, 201);
    const validCreateData: any = await validCreateRes.json();
    const tempEndpointId = validCreateData.endpoint.id;

    // 5. Update with unknown event -> HTTP 400 & DB remains unchanged
    const patchUnknownRes = await fetch(`${API_BASE}/organizations/${orgAId}/webhooks/${tempEndpointId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        events: ["room.created", "fake.event"],
      }),
    });
    assert.strictEqual(patchUnknownRes.status, 400);

    // Verify DB subscriptions are completely unchanged
    const dbCheck1 = await query("SELECT events FROM webhook_endpoints WHERE id = $1;", [tempEndpointId]);
    assert.deepStrictEqual(dbCheck1.rows[0].events, ["room.created", "room.ended"]);

    // 6. Update with unimplemented event -> HTTP 400 & DB remains unchanged
    const patchUnimplRes = await fetch(`${API_BASE}/organizations/${orgAId}/webhooks/${tempEndpointId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        events: ["participant.joined"],
      }),
    });
    assert.strictEqual(patchUnimplRes.status, 400);

    const dbCheck2 = await query("SELECT events FROM webhook_endpoints WHERE id = $1;", [tempEndpointId]);
    assert.deepStrictEqual(dbCheck2.rows[0].events, ["room.created", "room.ended"]);

    // 7. Update with malformed event values (null, non-array, empty array) -> HTTP 400 & DB remains unchanged
    for (const badPatch of [{ events: null }, { events: "room.created" }, { events: [] }]) {
      const badPatchRes = await fetch(`${API_BASE}/organizations/${orgAId}/webhooks/${tempEndpointId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userAToken}`,
        },
        body: JSON.stringify(badPatch),
      });
      assert.strictEqual(badPatchRes.status, 400, "Malformed patch events must return HTTP 400");
    }

    const dbCheck3 = await query("SELECT events FROM webhook_endpoints WHERE id = $1;", [tempEndpointId]);
    assert.deepStrictEqual(dbCheck3.rows[0].events, ["room.created", "room.ended"]);

    // 8. Update omitting events preserves existing subscriptions
    const patchOmitRes = await fetch(`${API_BASE}/organizations/${orgAId}/webhooks/${tempEndpointId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        description: "New description without modifying events",
      }),
    });
    assert.strictEqual(patchOmitRes.status, 200);
    const patchOmitData: any = await patchOmitRes.json();
    assert.deepStrictEqual(patchOmitData.endpoint.events, ["room.created", "room.ended"]);

    // Clean up temporary endpoint
    await query("DELETE FROM webhook_endpoints WHERE id = $1;", [tempEndpointId]);
  });
});
