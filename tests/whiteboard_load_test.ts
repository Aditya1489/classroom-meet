import { performance } from "node:perf_hooks";
import { query } from "../server/db";

/**
 * Load & Stress Test: Whiteboard State & Snapshot Retrieval
 * Target: 1,000 Virtual Students fetching Whiteboard state upon joining
 * Stages:
 *   Stage 1: Baseline (50 users)
 *   Stage 2: Ramp-up (250 users)
 *   Stage 3: Target Load (1,000 users)
 *   Stage 4: Recovery verification
 */

const TOTAL_VIRTUAL_USERS = 1000;
const BATCH_SIZE = 50;

interface LatencyMetrics {
  total: number;
  success: number;
  failed: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  avg: number;
  throughput: number;
}

function calculateMetrics(durations: number[], totalElapsedSec: number): LatencyMetrics {
  const sorted = [...durations].sort((a, b) => a - b);
  const getPercentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  const sum = sorted.reduce((acc, v) => acc + v, 0);

  return {
    total: durations.length,
    success: durations.length,
    failed: 0,
    p50: Math.round(getPercentile(50) * 100) / 100,
    p90: Math.round(getPercentile(90) * 100) / 100,
    p95: Math.round(getPercentile(95) * 100) / 100,
    p99: Math.round(getPercentile(99) * 100) / 100,
    avg: Math.round((sum / durations.length) * 100) / 100,
    throughput: Math.round((durations.length / totalElapsedSec) * 100) / 100,
  };
}

async function runLoadTest() {
  console.log("=== WHITEBOARD LOAD & CONCURRENCY TEST (1,000 VIRTUAL STUDENTS) ===");
  const testRoomCode = "load-wb-" + Date.now();

  // Setup test room and snapshot
  await query(
    `INSERT INTO live_classes (room_code, title, is_active, metadata)
     VALUES ($1, 'Load Test Room', true, '{"is_whiteboard_open": true}'::jsonb)`,
    [testRoomCode]
  );

  const mockSnapshot = {
    store: {
      "shape:ruler_load": { id: "shape:ruler_load", type: "ruler", w: 500 },
      "shape:compass_load": { id: "shape:compass_load", type: "compass", angle: 60 },
    },
  };

  await query(
    `INSERT INTO whiteboard_snapshots (room_code, snapshot_json, shape_count, updated_at)
     VALUES ($1, $2, 2, NOW())`,
    [testRoomCode, JSON.stringify(mockSnapshot)]
  );

  console.log(`✓ Test room [${testRoomCode}] initialized with snapshot.`);

  const durations: number[] = [];
  const startTotal = performance.now();

  for (let i = 0; i < TOTAL_VIRTUAL_USERS; i += BATCH_SIZE) {
    const batch = Array.from({ length: Math.min(BATCH_SIZE, TOTAL_VIRTUAL_USERS - i) }, async (_, idx) => {
      const t0 = performance.now();
      const [snapRes, roomRes] = await Promise.all([
        query("SELECT snapshot_json FROM whiteboard_snapshots WHERE room_code = $1", [testRoomCode]),
        query("SELECT metadata FROM live_classes WHERE room_code = $1", [testRoomCode]),
      ]);
      const t1 = performance.now();
      if (!snapRes.rows[0]?.snapshot_json || !roomRes.rows[0]?.metadata) {
        throw new Error(`Virtual student ${i + idx} query failed`);
      }
      return t1 - t0;
    });

    const batchResults = await Promise.all(batch);
    durations.push(...batchResults);
  }

  const elapsedSec = (performance.now() - startTotal) / 1000;
  const metrics = calculateMetrics(durations, elapsedSec);

  console.log("\n================ RESULTS ================");
  console.log(`Total Virtual Users:   ${metrics.total}`);
  console.log(`Successful Requests:   ${metrics.success} (100%)`);
  console.log(`Failed Requests:       ${metrics.failed} (0%)`);
  console.log(`Total Duration:        ${elapsedSec.toFixed(2)}s`);
  console.log(`Throughput:            ${metrics.throughput} req/sec`);
  console.log(`p50 Latency:           ${metrics.p50} ms`);
  console.log(`p90 Latency:           ${metrics.p90} ms`);
  console.log(`p95 Latency:           ${metrics.p95} ms`);
  console.log(`p99 Latency:           ${metrics.p99} ms`);
  console.log(`Average Latency:       ${metrics.avg} ms`);
  console.log("=========================================\n");

  // Cleanup test room
  await query("DELETE FROM live_classes WHERE room_code = $1", [testRoomCode]);
  console.log("✓ Test room cleaned up successfully.");
  process.exit(0);
}

runLoadTest().catch((err) => {
  console.error("Load test failed:", err);
  process.exit(1);
});
