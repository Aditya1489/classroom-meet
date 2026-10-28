import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { initDb, pool, runMigrations, resolveSchemaPath, resolveMigrationsDir } from "./db";
export { initDb, pool, runMigrations, resolveSchemaPath, resolveMigrationsDir };
import { connectMongo, getMongoDb, closeMongo } from "./db/mongo";
import { authRouter } from "./routes/auth";
import { roomsRouter } from "./routes/rooms";
import { chatRouter } from "./routes/chat";
import { whiteboardRouter } from "./routes/whiteboard";
import { pollsRouter } from "./routes/polls";
import { tabletRouter } from "./routes/tablet";
import { apiKeysRouter } from "./routes/apiKeys";
import { organizationsRouter } from "./routes/organizations";
import { v1RoomsRouter } from "./routes/v1/rooms";
import { embedRouter, handleEmbedHtmlDocument } from "./routes/v1/embed";
import { webhooksRouter } from "./routes/webhooks";
import { adminRouter } from "./routes/admin";
import { apiKeyAuth, requirePermission } from "./middleware/apiKeyAuth";
import { requestIdMiddleware } from "./middleware/requestId";
import { logger } from "./services/logger";
import { getSystemHealthReport, checkPostgresHealth } from "./services/healthService";
import { sweepStaleSessions, reconcileAbandonedRooms } from "./services/meteringService";
import { validateStartupEnvironment } from "./services/envValidator";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

// Attach correlation request ID to every inbound request
app.use(requestIdMiddleware);

// Proxy Trust Configuration
// In production behind reverse proxies (Nginx / ALB / Cloudflare), configure TRUST_PROXY explicitly.
// Default to false so untrusted client-supplied headers (e.g. X-Forwarded-For) cannot spoof client IP.
const trustProxyEnv = process.env.TRUST_PROXY;
if (trustProxyEnv) {
  if (trustProxyEnv === "true" || trustProxyEnv === "1") {
    app.set("trust proxy", 1);
  } else if (trustProxyEnv === "false" || trustProxyEnv === "0") {
    app.set("trust proxy", false);
  } else if (!isNaN(Number(trustProxyEnv))) {
    app.set("trust proxy", Number(trustProxyEnv));
  } else {
    app.set("trust proxy", trustProxyEnv);
  }
} else {
  app.set("trust proxy", false);
}

// Configured allowed origins for control plane API
export function getAllowedCorsOrigins(): string[] {
  const allowed = new Set<string>();

  if (process.env.FRONTEND_URL) {
    allowed.add(process.env.FRONTEND_URL.trim().replace(/\/$/, ""));
  }
  if (process.env.CUSTOMER_DEMO_URL) {
    allowed.add(process.env.CUSTOMER_DEMO_URL.trim().replace(/\/$/, ""));
  }
  if (process.env.CORS_ALLOWED_ORIGINS) {
    process.env.CORS_ALLOWED_ORIGINS.split(",")
      .map((o) => o.trim().replace(/\/$/, ""))
      .filter(Boolean)
      .forEach((o) => allowed.add(o));
  }

  // Always allow standard local dev origins in non-production
  if (process.env.NODE_ENV !== "production") {
    allowed.add("http://localhost:5173");
    allowed.add("http://localhost:5174");
    allowed.add("http://localhost:5001");
    allowed.add("http://localhost:5002");
    allowed.add("http://127.0.0.1:5173");
    allowed.add("http://127.0.0.1:5174");
    allowed.add("http://127.0.0.1:5001");
    allowed.add("http://127.0.0.1:5002");
  }

  return Array.from(allowed);
}

// CORS configuration: Replaces arbitrary-origin reflection with explicit whitelist
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser requests (e.g. curl, server-to-server API calls, mobile apps without origin)
      if (!origin) {
        return callback(null, true);
      }

      const normalizedOrigin = origin.trim().replace(/\/$/, "");
      const allowedOrigins = getAllowedCorsOrigins();

      // Check exact match or localhost in dev mode
      const isAllowed =
        allowedOrigins.includes(normalizedOrigin) ||
        (process.env.NODE_ENV !== "production" &&
          (normalizedOrigin.startsWith("http://localhost:") ||
           normalizedOrigin.startsWith("http://127.0.0.1:")));

      if (isAllowed) {
        callback(null, true);
      } else {
        // Reject cross-origin credentialed access from unauthorized domains
        callback(null, false);
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID", "X-API-Key", "X-API-Secret"],
  })
);

app.use(express.json({ limit: "25mb" }));

// Dynamic CSP frame-ancestors HTML embed document route
app.get("/embed/:roomCode", handleEmbedHtmlDocument);

// Comprehensive Health Check (Backwards compatible + SFU component)
app.get("/api/health", async (req, res) => {
  try {
    const report = await getSystemHealthReport();
    return res.status(report.status === "unhealthy" ? 503 : 200).json({
      status: report.status,
      timestamp: report.timestamp,
      database: report.components.postgres.details,
      connected: report.components.postgres.status === "ok",
      mongo: report.components.mongo.details,
      sfu: report.components.sfu,
      uptimeSeconds: report.uptimeSeconds,
      components: report.components,
    });
  } catch (err: any) {
    return res.status(503).json({
      status: "degraded",
      timestamp: new Date().toISOString(),
      database_error: err.message,
      connected: false,
    });
  }
});

// Liveness Probe (Instant response for process health)
app.get("/api/health/live", (_req, res) => {
  return res.json({
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Readiness Probe (Evaluates required database dependencies)
app.get("/api/health/ready", async (_req, res) => {
  const pg = await checkPostgresHealth();
  const isReady = pg.status === "ok";
  return res.status(isReady ? 200 : 503).json({
    ready: isReady,
    postgres: pg.status,
    timestamp: new Date().toISOString(),
  });
});

// Mount Routes
app.use("/api/auth", authRouter);
app.use("/api/rooms", roomsRouter);
app.use("/api/rooms", chatRouter);
app.use("/api/rooms", whiteboardRouter);
app.use("/api/rooms", pollsRouter);
app.use("/api/polls", pollsRouter);
app.use("/api/tablet", tabletRouter);
app.use("/api/organizations", organizationsRouter);
app.use("/api/organizations", apiKeysRouter);
app.use("/api/organizations", webhooksRouter);
app.use("/v1/organizations", webhooksRouter);
app.use("/api/v1/rooms", v1RoomsRouter);
app.use("/v1/rooms", v1RoomsRouter);
app.use("/api/v1/embed", embedRouter);
app.use("/v1/embed", embedRouter);
app.use("/api/admin", adminRouter);

// M2M API Key Verification Endpoint
app.get("/api/v1/auth/verify", apiKeyAuth(), (req, res) => {
  return res.json({
    authenticated: true,
    organization: (req as any).organization,
    environment: (req as any).environment,
    permissions: (req as any).apiKey.permissions,
  });
});

// Permission Guarded Test Endpoint
app.get("/api/v1/auth/rooms-guard", apiKeyAuth(), requirePermission("rooms:write"), (req, res) => {
  return res.json({ success: true, message: "Authorized for rooms:write" });
});

// Start Server and Initialize Database
async function startServer() {
  console.log("--------------------------------------------------");
  console.log("🚀 Starting Mathsy Meet PostgreSQL & MongoDB Backend Server...");
  console.log("--------------------------------------------------");

  // Validate startup environment variables (fail fast on weak/missing secrets in production)
  validateStartupEnvironment();

  // Initialize DB schema
  await initDb();


  // Initialize MongoDB for temporary in-class chat storage
  await connectMongo();

  // Start periodic session reaper for unclosed participant sessions & abandoned rooms (every 5 minutes)
  const reaperInterval = setInterval(async () => {
    try {
      await sweepStaleSessions();
      await reconcileAbandonedRooms();
    } catch (err: any) {
      logger.error("Periodic session reaper encountered error", { error: err.message });
    }
  }, 300000);

  const server = app.listen(PORT, () => {
    console.log(`📡 Backend API Server running at: http://localhost:${PORT}`);
    console.log(`🩺 Health check available at:     http://localhost:${PORT}/api/health\n`);
  });

  const handleShutdown = async () => {
    console.log("\n[Server] Gracefully shutting down...");
    clearInterval(reaperInterval);
    server.close(async () => {
      await closeMongo();
      await pool.end();
      process.exit(0);
    });
  };

  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);
}

startServer().catch((err) => {
  console.error("Fatal error during server startup:", err);
  process.exit(1);
});
