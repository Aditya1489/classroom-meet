import { pool } from "../db";
import { getMongoDb } from "../db/mongo";
import { logger } from "./logger";

export interface ComponentHealth {
  status: "ok" | "degraded" | "unreachable" | "disabled";
  latencyMs?: number;
  details?: any;
}

export interface SystemHealthReport {
  status: "ok" | "degraded" | "unhealthy";
  timestamp: string;
  uptimeSeconds: number;
  components: {
    postgres: ComponentHealth;
    mongo: ComponentHealth;
    sfu: ComponentHealth;
  };
}

/**
 * Checks PostgreSQL connectivity
 */
export async function checkPostgresHealth(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    const res = await pool.query("SELECT NOW() as current_time, current_database() as database;");
    return {
      status: "ok",
      latencyMs: Date.now() - start,
      details: {
        database: res.rows[0]?.database,
      },
    };
  } catch (err: any) {
    return {
      status: "unreachable",
      latencyMs: Date.now() - start,
      details: {
        error: err.message,
      },
    };
  }
}

/**
 * Checks MongoDB connectivity
 */
export function checkMongoHealth(): ComponentHealth {
  const db = getMongoDb();
  if (!db) {
    return {
      status: "degraded",
      details: { connected: false, purpose: "temporary_active_class_chat" },
    };
  }
  return {
    status: "ok",
    details: { connected: true, purpose: "temporary_active_class_chat" },
  };
}

/**
 * Probes SFU signaling server reachability using a strict 2-second timeout.
 * Does not make the entire control-plane fail if SFU is down, but accurately reflects reality.
 */
export async function checkSfuHealth(): Promise<ComponentHealth> {
  const sfuUrl = (
    process.env.SFU_HEALTH_URL ||
    process.env.MEDIASOUP_SERVER_URL ||
    process.env.VITE_MEDIASOUP_SERVER_URL ||
    "https://rtc.mathsy.in"
  ).replace(/\/$/, "");

  // In test mode without network, if explicitly mocked:
  if (process.env.MOCK_SFU_HEALTH === "true") {
    return { status: "ok", latencyMs: 5, details: { url: sfuUrl, mocked: true } };
  }

  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);

  try {
    const targetUrl = `${sfuUrl}/healthz`;
    const res = await fetch(targetUrl, { signal: controller.signal });
    clearTimeout(timeout);
    return {
      status: res.ok ? "ok" : "degraded",
      latencyMs: Date.now() - start,
      details: { url: sfuUrl, httpStatus: res.status },
    };
  } catch (err: any) {
    clearTimeout(timeout);
    return {
      status: "unreachable",
      latencyMs: Date.now() - start,
      details: { url: sfuUrl, error: err.name === "AbortError" ? "Timeout after 2000ms" : err.message },
    };
  }
}

/**
 * Generates an aggregated system health report
 */
export async function getSystemHealthReport(): Promise<SystemHealthReport> {
  const [pg, sfu] = await Promise.all([checkPostgresHealth(), checkSfuHealth()]);
  const mongo = checkMongoHealth();

  const isPgHealthy = pg.status === "ok";
  const isSfuHealthy = sfu.status === "ok";

  let status: "ok" | "degraded" | "unhealthy" = "ok";
  if (!isPgHealthy) {
    status = "unhealthy";
  } else if (!isSfuHealthy || mongo.status !== "ok") {
    status = "degraded";
  }

  return {
    status,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    components: {
      postgres: pg,
      mongo,
      sfu,
    },
  };
}
