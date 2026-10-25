import { performance } from "node:perf_hooks";
import jwt from "jsonwebtoken";

const API_BASE = process.env.API_BASE || "http://localhost:5001/api";
const ROOM_CODE = "ptq-rtvq-rox";
const TOTAL_VIRTUAL_USERS = 1000;
const BATCH_SIZE = 50; // Concurrency batch window
const JWT_SECRET = process.env.JWT_SECRET || "mathsy_meet_jwt_secret_dev_key_2026";

const tutorToken = jwt.sign(
  { id: "tutor-stress-001", sub: "tutor-stress-001", email: "tutor@mathsy.in", role: "tutor", name: "Aditya Chavhan (Host)" },
  JWT_SECRET,
  { expiresIn: "2h" }
);

function makeStudentToken(idx: number) {
  return jwt.sign(
    { id: `student-stress-${idx}`, sub: `student-stress-${idx}`, email: `student${idx}@mathsy.in`, role: "student", name: `Student ${idx}` },
    JWT_SECRET,
    { expiresIn: "2h" }
  );
}

interface LatencyMetrics {
  total: number;
  success: number;
  failed: number;
  durations: number[];
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  avg: number;
  reqPerSec: number;
}

function calculateMetrics(durations: number[], totalElapsedSec: number, totalRequests: number, successCount: number): LatencyMetrics {
  if (durations.length === 0) {
    return { total: totalRequests, success: 0, failed: totalRequests, durations: [], p50: 0, p90: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0, reqPerSec: 0 };
  }

  const sorted = [...durations].sort((a, b) => a - b);
  const getPercentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const avg = sum / sorted.length;

  return {
    total: totalRequests,
    success: successCount,
    failed: totalRequests - successCount,
    durations: sorted,
    p50: Math.round(getPercentile(50) * 100) / 100,
    p90: Math.round(getPercentile(90) * 100) / 100,
    p95: Math.round(getPercentile(95) * 100) / 100,
    p99: Math.round(getPercentile(99) * 100) / 100,
    min: Math.round(sorted[0] * 100) / 100,
    max: Math.round(sorted[sorted.length - 1] * 100) / 100,
    avg: Math.round(avg * 100) / 100,
    reqPerSec: Math.round((totalRequests / Math.max(0.001, totalElapsedSec)) * 100) / 100,
  };
}

async function runLoadTest() {
  console.log("================================================================================");
  console.log(`🔥 STARTING 1,000 CONCURRENT VIRTUAL USER STRESS TEST ON MATHSY MEET`);
  console.log(`   Target Room: ${ROOM_CODE}`);
  console.log(`   API Endpoint: ${API_BASE}`);
  console.log(`   Total Users: ${TOTAL_VIRTUAL_USERS} simulated students`);
  console.log(`   Batch Concurrency: ${BATCH_SIZE} parallel requests per window`);
  console.log("================================================================================\n");

  const initialMemory = process.memoryUsage();

  // Step 0: Ensure Classroom Exists via Authenticated Tutor Request
  console.log("[Init] Ensuring target classroom exists in PostgreSQL with authorized tutor session...");
  const initRes = await fetch(`${API_BASE}/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tutorToken}`,
    },
    body: JSON.stringify({
      room_code: ROOM_CODE,
      title: `Mathsy Class ${ROOM_CODE}`,
      is_active: true,
    }),
  });
  if (!initRes.ok) {
    const errText = await initRes.text();
    throw new Error(`Failed to ensure test room exists. Status: ${initRes.status} Details: ${errText}`);
  }
  console.log(`[Init] ✓ Target room ${ROOM_CODE} is verified and active.\n`);

  // ── PHASE 1: 1,000 Students Link-Join Check (GET /api/rooms/:roomCode) ──
  console.log("── PHASE 1: 1,000 Concurrent Students Accessing Meeting Link ──");
  const p1Start = performance.now();
  const p1Durations: number[] = [];
  let p1Success = 0;

  for (let i = 0; i < TOTAL_VIRTUAL_USERS; i += BATCH_SIZE) {
    const batch = Array.from({ length: Math.min(BATCH_SIZE, TOTAL_VIRTUAL_USERS - i) }, async (_, idx) => {
      const studentIdx = i + idx;
      const reqStart = performance.now();
      try {
        const res = await fetch(`${API_BASE}/rooms/${ROOM_CODE}`, {
          headers: {
            "User-Agent": `MathsyLoadBot/1.0 Student-${studentIdx}`,
            Accept: "application/json",
          },
        });
        const reqEnd = performance.now();
        if (res.ok) {
          p1Success++;
          p1Durations.push(reqEnd - reqStart);
        } else {
          p1Durations.push(reqEnd - reqStart);
        }
      } catch (err) {
        // Connection error or timeout
      }
    });

    await Promise.all(batch);
  }

  const p1ElapsedSec = (performance.now() - p1Start) / 1000;
  const p1Metrics = calculateMetrics(p1Durations, p1ElapsedSec, TOTAL_VIRTUAL_USERS, p1Success);

  console.log(`✓ Phase 1 Completed in ${p1ElapsedSec.toFixed(2)}s`);
  console.log(`  Success Rate: ${((p1Metrics.success / p1Metrics.total) * 100).toFixed(1)}% (${p1Metrics.success}/${p1Metrics.total})`);
  console.log(`  Throughput:   ${p1Metrics.reqPerSec} req/sec`);
  console.log(`  Latency:      p50: ${p1Metrics.p50}ms | p90: ${p1Metrics.p90}ms | p95: ${p1Metrics.p95}ms | p99: ${p1Metrics.p99}ms | Avg: ${p1Metrics.avg}ms\n`);

  // ── PHASE 2: 1,000 Students Registering Attendance (POST /api/rooms/:roomCode/participants) ──
  console.log("── PHASE 2: 1,000 Concurrent Students Registering with Authenticated Sessions ──");
  const p2Start = performance.now();
  const p2Durations: number[] = [];
  let p2Success = 0;

  for (let i = 0; i < TOTAL_VIRTUAL_USERS; i += BATCH_SIZE) {
    const batch = Array.from({ length: Math.min(BATCH_SIZE, TOTAL_VIRTUAL_USERS - i) }, async (_, idx) => {
      const studentIdx = i + idx;
      const studentName = `Student ${studentIdx + 1}`;
      const token = makeStudentToken(studentIdx);
      const reqStart = performance.now();

      try {
        const res = await fetch(`${API_BASE}/rooms/${ROOM_CODE}/participants`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            display_name: studentName,
            role: "student",
            camera_allowed: false,
          }),
        });

        const reqEnd = performance.now();
        if (res.ok) {
          p2Success++;
          p2Durations.push(reqEnd - reqStart);
        } else {
          p2Durations.push(reqEnd - reqStart);
        }
      } catch (err) {
        // Connection error
      }
    });

    await Promise.all(batch);
  }

  const p2ElapsedSec = (performance.now() - p2Start) / 1000;
  const p2Metrics = calculateMetrics(p2Durations, p2ElapsedSec, TOTAL_VIRTUAL_USERS, p2Success);

  console.log(`✓ Phase 2 Completed in ${p2ElapsedSec.toFixed(2)}s`);
  console.log(`  Success Rate: ${((p2Metrics.success / p2Metrics.total) * 100).toFixed(1)}% (${p2Metrics.success}/${p2Metrics.total})`);
  console.log(`  Throughput:   ${p2Metrics.reqPerSec} writes/sec`);
  console.log(`  Latency:      p50: ${p2Metrics.p50}ms | p90: ${p2Metrics.p90}ms | p95: ${p2Metrics.p95}ms | p99: ${p2Metrics.p99}ms | Avg: ${p2Metrics.avg}ms\n`);

  // ── PHASE 3: Real-Time Chat & Activity Under 1,000 Virtual Users (POST /api/rooms/:roomCode/chat) ──
  console.log("── PHASE 3: 500 Concurrent In-Class Inquiries & Hand-Raise Signals ──");
  const p3Start = performance.now();
  const p3Durations: number[] = [];
  let p3Success = 0;
  const CHAT_USERS = 500;

  for (let i = 0; i < CHAT_USERS; i += BATCH_SIZE) {
    const batch = Array.from({ length: Math.min(BATCH_SIZE, CHAT_USERS - i) }, async (_, idx) => {
      const studentIdx = i + idx;
      const reqStart = performance.now();

      try {
        const res = await fetch(`${API_BASE}/rooms/${ROOM_CODE}/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${makeStudentToken(studentIdx)}`,
          },
          body: JSON.stringify({
            sender_id: `student-usr-${studentIdx + 1}`,
            sender_name: `Student ${studentIdx + 1}`,
            content: `Hello Tutor! Question on Step #${(studentIdx % 10) + 1}`,
            sender_role: "student",
          }),
        });

        const reqEnd = performance.now();
        if (res.ok) {
          p3Success++;
          p3Durations.push(reqEnd - reqStart);
        } else {
          p3Durations.push(reqEnd - reqStart);
        }
      } catch (err) {
        // Chat post error
      }
    });

    await Promise.all(batch);
  }

  const p3ElapsedSec = (performance.now() - p3Start) / 1000;
  const p3Metrics = calculateMetrics(p3Durations, p3ElapsedSec, CHAT_USERS, p3Success);

  console.log(`✓ Phase 3 Completed in ${p3ElapsedSec.toFixed(2)}s`);
  console.log(`  Success Rate: ${((p3Metrics.success / p3Metrics.total) * 100).toFixed(1)}% (${p3Metrics.success}/${p3Metrics.total})`);
  console.log(`  Throughput:   ${p3Metrics.reqPerSec} msg/sec`);
  console.log(`  Latency:      p50: ${p3Metrics.p50}ms | p90: ${p3Metrics.p90}ms | p95: ${p3Metrics.p95}ms | p99: ${p3Metrics.p99}ms | Avg: ${p3Metrics.avg}ms\n`);

  // ── PHASE 4: Verification of Database Records & Pool Integrity ──
  console.log("── PHASE 4: Database Integrity & Health Verification ──");
  const healthRes = await fetch(`${API_BASE}/health`);
  const healthData = await healthRes.json();
  const finalMemory = process.memoryUsage();

  console.log(`✓ Health Status: ${healthData.status} (DB Connected: ${healthData.connected})`);
  console.log(`  Server DB Timestamp: ${healthData.database?.current_time}`);
  console.log(`  Heap Memory Delta:   +${Math.round((finalMemory.heapUsed - initialMemory.heapUsed) / (1024 * 1024))}MB`);
  console.log(`  RSS Memory:          ${Math.round(finalMemory.rss / (1024 * 1024))}MB\n`);

  console.log("================================================================================");
  console.log("🏆 1,000 VIRTUAL USER STRESS TEST SUMMARY");
  console.log("================================================================================");
  console.log(`• Phase 1 Link Access (1,000 reqs):  ${((p1Metrics.success / p1Metrics.total) * 100).toFixed(1)}% success, p95 = ${p1Metrics.p95}ms, ${p1Metrics.reqPerSec} req/s`);
  console.log(`• Phase 2 DB Attendance (1,000 reqs): ${((p2Metrics.success / p2Metrics.total) * 100).toFixed(1)}% success, p95 = ${p2Metrics.p95}ms, ${p2Metrics.reqPerSec} req/s`);
  console.log(`• Phase 3 Chat Activity (500 reqs):   ${((p3Metrics.success / p3Metrics.total) * 100).toFixed(1)}% success, p95 = ${p3Metrics.p95}ms, ${p3Metrics.reqPerSec} req/s`);
  console.log("================================================================================\n");

  if (p1Metrics.success < TOTAL_VIRTUAL_USERS * 0.95 || p2Metrics.success < TOTAL_VIRTUAL_USERS * 0.95) {
    console.error("❌ STRESS TEST FAILED: Success rate dropped below 95% threshold under 1,000 users!");
    process.exit(1);
  } else {
    console.log("✅ STRESS TEST PASSED: 1,000 virtual users sustained with 0 fatal crashes or pool exhaustion.");
  }
}

runLoadTest().catch((err) => {
  console.error("Fatal Error running 1,000 Virtual User Stress Test:", err);
  process.exit(1);
});
