import express from "express";
import cors from "cors";
import path from "node:path";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { MathsyMeetServerClient } from "@mathsy/meet-sdk/server";
import { query } from "../../server/db";
import { createApiKey } from "../../server/services/apiKeyService";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5002;
const MATHSY_API_URL = process.env.MATHSY_MEET_API_URL || "http://localhost:5001/api/v1";
const MATHSY_EMBED_URL = process.env.MATHSY_MEET_EMBED_URL || "http://localhost:5174";

app.use(cors());
app.use(express.json());
// Serve compiled SDK bundle directly for browser client demo
app.use("/sdk", express.static(path.join(__dirname, "../../sdk/dist")));
app.use(express.static(path.join(__dirname, "public")));

let sdkClient: MathsyMeetServerClient | null = null;
let currentOrgId: string = "";
let currentApiKey: string = "";

/**
 * Bootstraps a test tenant organization and API key if not provided via environment
 */
async function initializeClient() {
  if (process.env.MATHSY_MEET_API_KEY && process.env.MATHSY_MEET_API_KEY.startsWith("sec_")) {
    currentApiKey = process.env.MATHSY_MEET_API_KEY;
    sdkClient = new MathsyMeetServerClient({
      apiKey: currentApiKey,
      apiBaseUrl: MATHSY_API_URL,
    });
    console.log(`[Acme Demo Backend] Initialized SDK client with configured environment API key.`);
    return;
  }

  console.log(`[Acme Demo Backend] No API key in environment. Auto-provisioning local demo tenant...`);
  try {
    const slug = "acme-lms-demo";
    let orgRes = await query("SELECT id FROM organizations WHERE slug = $1;", [slug]);

    if (orgRes.rows.length === 0) {
      orgRes = await query(
        `INSERT INTO organizations (name, slug, status, settings)
         VALUES ('Acme University LMS Demo', $1, 'active', '{"plan": "enterprise"}'::jsonb)
         RETURNING id;`,
        [slug]
      );
    }
    currentOrgId = orgRes.rows[0].id;

    // Ensure customer_apps whitelists http://localhost:5002
    await query(
      `INSERT INTO customer_apps (organization_id, app_name, allowed_domains, branding)
       VALUES ($1, 'Acme Portal', ARRAY['http://localhost:5002', 'http://127.0.0.1:5002'], '{"primary_color": "#2563eb"}'::jsonb)
       ON CONFLICT (organization_id, app_name) DO UPDATE
       SET allowed_domains = ARRAY['http://localhost:5002', 'http://127.0.0.1:5002'];`,
      [currentOrgId]
    );

    // Deactivate old demo keys so duplicate name constraint is satisfied cleanly
    await query(
      `UPDATE api_keys SET is_active = false WHERE organization_id = $1 AND name LIKE 'Demo Auto Key%';`,
      [currentOrgId]
    );

    // Create demo API key
    const key = await createApiKey({
      organizationId: currentOrgId,
      name: `Demo Auto Key ${Date.now()}`,
      environment: "test",
      permissions: ["rooms:read", "rooms:write", "tokens:write"],
    });

    currentApiKey = key.rawKey;
    sdkClient = new MathsyMeetServerClient({
      apiKey: currentApiKey,
      apiBaseUrl: MATHSY_API_URL,
    });

    console.log(`[Acme Demo Backend] Auto-provisioned Tenant '${slug}' (${currentOrgId})`);
    console.log(`[Acme Demo Backend] API Key: ${currentApiKey.substring(0, 16)}...`);
  } catch (err: any) {
    console.error(`[Acme Demo Backend] Failed to auto-provision test tenant:`, err.message);
  }
}

// Config endpoint for demo frontend
app.get("/api/config", (req, res) => {
  return res.json({
    embedBaseUrl: MATHSY_EMBED_URL,
    parentOrigin: `http://localhost:${PORT}`,
    isConfigured: Boolean(sdkClient),
  });
});

// Endpoint: Customer backend requests a new meeting
app.post("/api/sessions/create", async (req, res) => {
  try {
    if (!sdkClient) {
      return res.status(500).json({ error: "SDK client is not initialized" });
    }

    const { title, metadata = {} } = req.body;
    const meeting = await sdkClient.createMeeting({
      title: title || "Calculus 101 Lecture",
      metadata: {
        ...metadata,
        createdFrom: "Acme Customer LMS Portal Demo",
      },
    });

    return res.json({ success: true, meeting });
  } catch (err: any) {
    console.error("[Acme Demo] Error creating meeting:", err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message,
      code: err.code || "CREATE_MEETING_FAILED",
    });
  }
});

// Endpoint: Customer backend obtains short-lived participant token
app.post("/api/sessions/:roomCode/join", async (req, res) => {
  try {
    if (!sdkClient) {
      return res.status(500).json({ error: "SDK client is not initialized" });
    }

    const { roomCode } = req.params;
    const { userId, userName, role = "student", simulateExpired = false } = req.body;

    if (!userId || !userName) {
      return res.status(400).json({ error: "userId and userName are required" });
    }

    const isTutor = role === "tutor";

    // If simulation of expired token is requested:
    const expiresInSeconds = simulateExpired ? 300 : 7200; // 2 hours standard

    const tokenResult = await sdkClient.createParticipantToken(roomCode, {
      participantId: String(userId),
      name: String(userName),
      role: isTutor ? "tutor" : "student",
      expiresInSeconds,
      permissions: {
        canPublishAudio: isTutor ? true : false,
        canPublishVideo: true,
        canPublishScreen: isTutor ? true : false,
        canChat: true,
        isHost: isTutor ? true : false,
      },
    });

    let effectiveToken = tokenResult.token;
    if (simulateExpired) {
      // Intentionally tamper exp to simulate an expired token for negative testing
      const parts = tokenResult.token.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
        payload.exp = Math.floor(Date.now() / 1000) - 30; // 30s in the past
        effectiveToken = `${parts[0]}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.tampered`;
      }
    }

    return res.json({
      success: true,
      roomCode,
      token: effectiveToken,
      expiresAt: tokenResult.expiresAt,
      participant: tokenResult.participant,
    });
  } catch (err: any) {
    console.error("[Acme Demo] Error issuing participant token:", err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message,
      code: err.code || "ISSUE_TOKEN_FAILED",
    });
  }
});

// Endpoint: Customer backend ends a meeting
app.post("/api/sessions/:roomCode/end", async (req, res) => {
  try {
    if (!sdkClient) {
      return res.status(500).json({ error: "SDK client is not initialized" });
    }
    const { roomCode } = req.params;
    const result = await sdkClient.endMeeting(roomCode);
    return res.json(result);
  } catch (err: any) {
    console.error("[Acme Demo] Error ending meeting:", err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message,
      code: err.code || "END_MEETING_FAILED",
    });
  }
});

// Endpoint: Query meeting status
app.get("/api/sessions/:roomCode/status", async (req, res) => {
  try {
    if (!sdkClient) {
      return res.status(500).json({ error: "SDK client is not initialized" });
    }
    const { roomCode } = req.params;
    const meeting = await sdkClient.getMeeting(roomCode);
    return res.json({ success: true, meeting });
  } catch (err: any) {
    return res.status(err.statusCode || 500).json({
      error: err.message,
      code: err.code || "GET_MEETING_FAILED",
    });
  }
});

initializeClient().then(() => {
  app.listen(PORT, () => {
    console.log(`\n============================================================`);
    console.log(`🎓 Acme Learning Portal (Customer Integration Demo)`);
    console.log(`📡 URL: http://localhost:${PORT}`);
    console.log(`🔌 Connected to Mathsy Meet API: ${MATHSY_API_URL}`);
    console.log(`============================================================\n`);
  });
});
