import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { initDb, pool } from "./db";
import { authRouter } from "./routes/auth";
import { roomsRouter } from "./routes/rooms";
import { chatRouter } from "./routes/chat";
import { whiteboardRouter } from "./routes/whiteboard";
import { pollsRouter } from "./routes/polls";
import { tabletRouter } from "./routes/tablet";

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
    return res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      database: dbRes.rows[0],
      connected: true,
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

// Start Server and Initialize Database
async function startServer() {
  console.log("--------------------------------------------------");
  console.log("🚀 Starting Mathsy Meet PostgreSQL Backend Server...");
  console.log("--------------------------------------------------");

  // Initialize DB schema
  await initDb();

  app.listen(PORT, () => {
    console.log(`📡 Backend API Server running at: http://localhost:${PORT}`);
    console.log(`🩺 Health check available at:     http://localhost:${PORT}/api/health\n`);
  });
}

startServer().catch((err) => {
  console.error("Fatal error during server startup:", err);
});
