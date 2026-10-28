import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { authRateLimitStore } from "../server/routes/auth";

const JWT_SECRET = process.env.JWT_SECRET || "mathsy_meet_jwt_secret_dev_key_2026";
const API_BASE = process.env.API_BASE || "http://localhost:5001/api";

describe("Phase 2 & 3: Secure Google Authentication & Session Authorization Test Suite", () => {
  before(async () => {
    // Ensure test isolation by clearing any residual rate-limit timestamps
    if (authRateLimitStore && typeof authRateLimitStore.resetAll === "function") {
      await authRateLimitStore.resetAll();
    }
  });

  it("TC-AUTH-01: Rejects arbitrary email submission without Google credentials", async () => {
    const res = await fetch(`${API_BASE}/auth/google`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-client-ip": "secure-auth-test-client",
      },
      body: JSON.stringify({
        email: "victim@mathsy.in",
        name: "Victim User",
      }),
    });

    assert.equal(res.status, 401, "Submitting plain email without Google token must return 401");
    const data = await res.json();
    assert.ok(data.error.includes("credential") || data.error.includes("required"));
  });

  it("TC-AUTH-02: Rejects invalid, forged, or malformed Google ID tokens", async () => {
    const res = await fetch(`${API_BASE}/auth/google`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-client-ip": "secure-auth-test-client",
      },
      body: JSON.stringify({
        idToken: "header.invalid_payload_forged.signature",
      }),
    });

    assert.equal(res.status, 401, "Forged or invalid Google ID token must return 401");
    const data = await res.json();
    assert.ok(data.error.includes("verification failed") || data.error.includes("Invalid"));
  });

  it("TC-AUTH-03: Rejects expired Google ID tokens", async () => {
    // Generate a simulated expired token
    const expiredFakeToken = jwt.sign(
      { sub: "12345", email: "student@mathsy.in", email_verified: true, exp: Math.floor(Date.now() / 1000) - 3600 },
      "dummy_secret"
    );

    const res = await fetch(`${API_BASE}/auth/google`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-client-ip": "secure-auth-test-client",
      },
      body: JSON.stringify({
        idToken: expiredFakeToken,
      }),
    });

    assert.equal(res.status, 401, "Expired Google ID token must be rejected with 401");
  });

  it("TC-AUTH-04: Guest substitute accounts are strictly blocked", async () => {
    const res = await fetch(`${API_BASE}/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guestName: "Anonymous Attacker",
        role: "tutor",
      }),
    });

    assert.equal(res.status, 403, "Guest endpoint must return 403 Forbidden");
    const data = await res.json();
    assert.ok(data.error.includes("disabled"));
  });

  it("TC-AUTH-05: Missing Bearer token on protected route returns 401", async () => {
    const res = await fetch(`${API_BASE}/auth/me`);
    assert.equal(res.status, 401, "Missing Authorization header must return 401");
  });

  it("TC-AUTH-06: Malformed Bearer token returns 401", async () => {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: "Bearer not-a-valid-jwt-token" },
    });
    assert.equal(res.status, 401, "Malformed Bearer token must return 401");
  });

  it("TC-AUTH-07: Expired application JWT returns 401", async () => {
    const expiredToken = jwt.sign(
      { id: "usr-test-1", sub: "usr-test-1", email: "test@mathsy.in", role: "student" },
      JWT_SECRET,
      { expiresIn: "-10s" }
    );

    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    assert.equal(res.status, 401, "Expired application session token must return 401");
  });

  it("TC-AUTH-08: Tampered or forged JWT signature is rejected with 401", async () => {
    const validPayload = { id: "usr-admin-1", sub: "usr-admin-1", email: "admin@mathsy.in", role: "tutor" };
    // Signed with an unauthorized attacker key
    const forgedToken = jwt.sign(validPayload, "attacker_secret_key_12345");

    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${forgedToken}` },
    });
    assert.equal(res.status, 401, "Tampered signature must return 401");
  });

  it("TC-AUTH-09: Authenticated session returns verified profile", async () => {
    const validToken = jwt.sign(
      { id: "usr-verified-student", sub: "usr-verified-student", email: "student@mathsy.in", name: "Rohan Verma", role: "student" },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    assert.equal(res.status, 200, "Valid token must return 200");
    const data = await res.json();
    assert.equal(data.user.id, "usr-verified-student");
    assert.equal(data.user.role, "student");
    assert.equal(data.user.isHost, false);
  });
});
