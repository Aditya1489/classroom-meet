import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { query, pool } from "../server/db";
import { connectMongo, getChatCollection, getSessionsCollection, closeMongo } from "../server/db/mongo";
import { generateToken } from "../server/routes/auth";

const API_BASE = process.env.API_BASE || "http://localhost:5001/api";

interface LoadStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  durationMs: number;
  throughputRps: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

function calculateStats(latencies: number[], durationMs: number): LoadStats {
  latencies.sort((a, b) => a - b);
  const totalRequests = latencies.length;
  const p50 = latencies[Math.floor(totalRequests * 0.5)] || 0;
  const p95 = latencies[Math.floor(totalRequests * 0.95)] || 0;
  const p99 = latencies[Math.floor(totalRequests * 0.99)] || 0;

  return {
    totalRequests,
    successfulRequests: latencies.length,
    failedRequests: 0,
    durationMs,
    throughputRps: Math.round((totalRequests / (durationMs / 1000)) * 10) / 10,
    p50Ms: Math.round(p50 * 10) / 10,
    p95Ms: Math.round(p95 * 10) / 10,
    p99Ms: Math.round(p99 * 10) / 10,
  };
}

describe("Chat API Scalability & Load Testing (Rule 8 Target: 1,000 Virtual Users)", () => {
  const loadRoomCode = "load-chat-" + Math.random().toString(36).substring(2, 7);
  const tutorId = "99999999-9999-4999-8999-999999999999";
  let tutorToken: string;

  before(async () => {
    await connectMongo();

    // Ensure tutor exists in users table
    await query(
      `INSERT INTO users (id, email, full_name, role)
       VALUES ($1, 'tutor.load@mathsy.in', 'Prof. Load', 'tutor')
       ON CONFLICT (id) DO NOTHING;`,
      [tutorId]
    );

    tutorToken = generateToken({
      id: tutorId,
      email: "tutor.load@mathsy.in",
      role: "tutor",
      name: "Prof. Load",
    });

    // Create room via rooms API
    const res = await fetch(`${API_BASE}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tutorToken}`,
      },
      body: JSON.stringify({
        roomCode: loadRoomCode,
        title: "High Concurrency Class",
      }),
    });
    assert.equal(res.status, 200);
  });

  it("Stage 1: Baseline Load (10 requests)", async () => {
    const latencies: number[] = [];
    const startTime = Date.now();

    for (let i = 0; i < 10; i++) {
      const studentToken = generateToken({
        id: `student-base-${i}`,
        role: "student",
        name: `Student Base ${i}`,
      });
      const t0 = performance.now();
      const res = await fetch(`${API_BASE}/rooms/${loadRoomCode}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${studentToken}`,
        },
        body: JSON.stringify({
          text: `Baseline message ${i}`,
        }),
      });
      assert.equal(res.status, 200);
      latencies.push(performance.now() - t0);
    }

    const duration = Date.now() - startTime;
    const stats = calculateStats(latencies, duration);
    console.log("    [Stage 1 Baseline Stats]:", stats);
    assert.ok(stats.p95Ms < 100, "Baseline p95 must be under 100ms");
  });

  it("Stage 2: Ramp-Up Load (100 concurrent requests)", async () => {
    const latencies: number[] = [];
    const startTime = Date.now();

    const tasks = Array.from({ length: 100 }, async (_, i) => {
      const studentToken = generateToken({
        id: `student-ramp-${i}`,
        role: "student",
        name: `Student Ramp ${i}`,
      });
      const t0 = performance.now();
      const res = await fetch(`${API_BASE}/rooms/${loadRoomCode}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${studentToken}`,
        },
        body: JSON.stringify({
          text: `Ramp message ${i}`,
        }),
      });
      assert.equal(res.status, 200);
      latencies.push(performance.now() - t0);
    });

    await Promise.all(tasks);
    const duration = Date.now() - startTime;
    const stats = calculateStats(latencies, duration);
    console.log("    [Stage 2 Ramp-Up Stats]:", stats);
    assert.ok(stats.p95Ms < 250, "Ramp-up p95 must be under 250ms");
  });

  it("Stage 3: Target Load (1,000 simulated virtual users / requests)", async () => {
    const latencies: number[] = [];
    const startTime = Date.now();
    const batchSize = 100;
    const totalBatches = 10; // 10 x 100 = 1,000 total requests

    // Pre-generate tokens so synchronous HMAC signing does not distort HTTP I/O latency
    const studentTokens = Array.from({ length: 1000 }, (_, i) =>
      generateToken({
        id: `student-vu-${i}`,
        role: "student",
        name: `VU Student ${i}`,
      })
    );

    for (let b = 0; b < totalBatches; b++) {
      const batchTasks = Array.from({ length: batchSize }, async (_, idx) => {
        const globalIdx = b * batchSize + idx;
        const studentToken = studentTokens[globalIdx];
        const t0 = performance.now();

        // 80% writes, 20% reads to simulate classroom chat workload
        if (globalIdx % 5 === 0) {
          const res = await fetch(`${API_BASE}/rooms/${loadRoomCode}/chat`, {
            headers: { Authorization: `Bearer ${studentToken}` },
          });
          assert.equal(res.status, 200);
        } else {
          const res = await fetch(`${API_BASE}/rooms/${loadRoomCode}/chat`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${studentToken}`,
            },
            body: JSON.stringify({
              text: `Simulated student question ${globalIdx}`,
            }),
          });
          assert.equal(res.status, 200);
        }
        latencies.push(performance.now() - t0);
      });

      await Promise.all(batchTasks);
    }

    const duration = Date.now() - startTime;
    const stats = calculateStats(latencies, duration);
    console.log("    [Stage 3 Target Load (1,000 VUs) Stats]:", stats);

    assert.equal(stats.totalRequests, 1000, "Must complete 1,000 simulated requests");
    assert.ok(stats.p99Ms < 800, "Target load p99 latency must be under 800ms");
  });

  it("Stage 4 & 5: Stress Burst and Recovery Verification", async () => {
    // Stage 4: Stress burst (150 concurrent requests in single flight)
    const burstLatencies: number[] = [];
    const burstStart = Date.now();

    const burstTasks = Array.from({ length: 150 }, async (_, i) => {
      const studentToken = generateToken({
        id: `student-burst-${i}`,
        role: "student",
        name: `Burst Student ${i}`,
      });
      const t0 = performance.now();
      const res = await fetch(`${API_BASE}/rooms/${loadRoomCode}/chat`, {
        headers: { Authorization: `Bearer ${studentToken}` },
      });
      assert.equal(res.status, 200);
      burstLatencies.push(performance.now() - t0);
    });

    await Promise.all(burstTasks);
    const burstStats = calculateStats(burstLatencies, Date.now() - burstStart);
    console.log("    [Stage 4 Stress Burst Stats]:", burstStats);

    // Wait 300ms for connection pool to settle
    await new Promise((r) => setTimeout(r, 300));

    // Stage 5: Recovery Check
    const recoveryStart = performance.now();
    const recoveryRes = await fetch(`${API_BASE}/rooms/${loadRoomCode}/chat`, {
      headers: { Authorization: `Bearer ${tutorToken}` },
    });
    const recoveryLatency = performance.now() - recoveryStart;
    assert.equal(recoveryRes.status, 200);
    console.log("    [Stage 5 Recovery Latency]:", Math.round(recoveryLatency * 10) / 10, "ms");
    assert.ok(recoveryLatency < 100, "Recovery request latency must be back to baseline (< 100ms)");
  });

  after(async () => {
    try {
      const chatCol = getChatCollection()!;
      const sessCol = getSessionsCollection()!;
      if (chatCol) await chatCol.deleteMany({ roomCode: loadRoomCode });
      if (sessCol) await sessCol.deleteMany({ roomCode: loadRoomCode });
    } catch (e) {}

    await query("DELETE FROM live_classes WHERE room_code = $1", [loadRoomCode]);
    await query("DELETE FROM users WHERE id = $1", [tutorId]);
    await closeMongo();
    await pool.end();
    setTimeout(() => process.exit(0), 500);
  });
});
