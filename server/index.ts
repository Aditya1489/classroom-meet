import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { initDb, pool } from "./db";
import { connectMongo, getMongoDb, closeMongo } from "./db/mongo";
import { authRouter } from "./routes/auth";
import { roomsRouter } from "./routes/rooms";
import { chatRouter } from "./routes/chat";
import { whiteboardRouter } from "./routes/whiteboard";
import { pollsRouter } from "./routes/polls";
import { tabletRouter } from "./routes/tablet";
import { apiKeysRouter } from "./routes/apiKeys";
import { v1RoomsRouter } from "./routes/v1/rooms";
import { apiKeyAuth, requirePermission } from "./middleware/apiKeyAuth";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

// CORS configuration
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow local development and any configured frontend origin
      callback(null, true);
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "25mb" }));

// Health Check
app.get("/api/health", async (req, res) => {
  try {
    const dbRes = await pool.query("SELECT NOW() as current_time, current_database() as database;");
    const mongoConnected = !!getMongoDb();
    return res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      database: dbRes.rows[0],
      connected: true,
      mongo: {
        connected: mongoConnected,
        purpose: "temporary_active_class_chat",
      },
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

// Mount Routes
app.use("/api/auth", authRouter);
app.use("/api/rooms", roomsRouter);
app.use("/api/rooms", chatRouter);
app.use("/api/rooms", whiteboardRouter);
app.use("/api/rooms", pollsRouter);
app.use("/api/polls", pollsRouter);
app.use("/api/tablet", tabletRouter);
app.use("/api/organizations", apiKeysRouter);
app.use("/api/v1/rooms", v1RoomsRouter);
app.use("/v1/rooms", v1RoomsRouter);

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

  // Initialize DB schema
  await initDb();

  // Initialize MongoDB for temporary in-class chat storage
  await connectMongo();

  const server = app.listen(PORT, () => {
    console.log(`📡 Backend API Server running at: http://localhost:${PORT}`);
    console.log(`🩺 Health check available at:     http://localhost:${PORT}/api/health\n`);
  });

  const handleShutdown = async () => {
    console.log("\n[Server] Gracefully shutting down...");
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
});
