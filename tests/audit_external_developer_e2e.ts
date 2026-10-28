import { io } from "socket.io-client";
import { query, pool } from "../server/db";
import { createApiKey } from "../server/services/apiKeyService";

const API_BASE = "http://localhost:5001/api/v1";
const SFU_URL = "https://rtc.mathsy.in";

async function runDeveloperSimulation() {
  console.log("==================================================================");
  console.log("🧪 SIMULATING EXTERNAL DEVELOPER INTEGRATION PATH");
  console.log("==================================================================");

  let orgId = "";
  let apiKey = "";
  let roomCode = "";
  let roomId = "";
  let tutorToken = "";
  let studentToken = "";

  try {
    // 1. Provision a test tenant organization and API key
    console.log("\n[Step 1] Creating external customer organization & API key...");
    const orgRes = await query(
      `INSERT INTO organizations (name, slug, status, settings)
       VALUES ('Acme Corp LMS', 'acme-lms-${Date.now()}', 'active', '{"plan": "enterprise"}'::jsonb)
       RETURNING id;`
    );
    orgId = orgRes.rows[0].id;

    const keyRes = await createApiKey({
      organizationId: orgId,
      name: "Acme Production Backend Key",
      environment: "live",
      permissions: ["rooms:read", "rooms:write", "tokens:write"],
    });
    apiKey = keyRes.rawKey;
    console.log(`✓ Organization ID: ${orgId}`);
    console.log(`✓ Generated Raw API Key: ${apiKey.substring(0, 14)}... (Secret retained)`);

    // 2. External developer creates a room via REST API
    console.log("\n[Step 2] Developer calls POST /api/v1/rooms...");
    const createRoomRes = await fetch(`${API_BASE}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        title: "Calculus 101 Lecture",
        metadata: { courseId: "MATH-101", lmsUserId: "prof_oak" },
      }),
    });

    const createRoomData = await createRoomRes.json();
    if (!createRoomRes.ok) {
      throw new Error(`Failed to create room: ${JSON.stringify(createRoomData)}`);
    }

    roomCode = createRoomData.room.roomCode;
    roomId = createRoomData.room.id;
    console.log(`✓ Room created! Code: ${roomCode} | ID: ${roomId} | Status: ${createRoomRes.status}`);

    // 3. Developer retrieves room information via GET /api/v1/rooms/:roomId
    console.log("\n[Step 3] Developer calls GET /api/v1/rooms/:roomId...");
    const getRoomRes = await fetch(`${API_BASE}/rooms/${roomCode}`, {
      headers: { "Authorization": `Bearer ${apiKey}` },
    });
    const getRoomData = await getRoomRes.json();
    console.log(`✓ Room retrieved! Title: "${getRoomData.room.title}" | Active: ${getRoomData.room.isActive}`);

    // 4. Developer issues participant tokens for Tutor and Student
    console.log("\n[Step 4] Developer calls POST /api/v1/rooms/:roomId/tokens (Tutor)...");
    const tutorTokenRes = await fetch(`${API_BASE}/rooms/${roomCode}/tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        participantId: "acme-tutor-001",
        name: "Dr. Evelyn Reed",
        role: "tutor",
        permissions: { canPublishAudio: true, canPublishVideo: true, canPublishScreen: true, isHost: true },
      }),
    });
    const tutorTokenData = await tutorTokenRes.json();
    if (!tutorTokenRes.ok) throw new Error(`Failed to issue tutor token: ${JSON.stringify(tutorTokenData)}`);
    tutorToken = tutorTokenData.token;
    console.log(`✓ Tutor participant token issued! Sub: ${tutorTokenData.participant.id}`);

    console.log("\n[Step 4b] Developer calls POST /api/v1/rooms/:roomId/tokens (Student)...");
    const studentTokenRes = await fetch(`${API_BASE}/rooms/${roomCode}/tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        participantId: "acme-student-999",
        name: "Alice Walker",
        role: "student",
      }),
    });
    const studentTokenData = await studentTokenRes.json();
    studentToken = studentTokenData.token;
    console.log(`✓ Student participant token issued! Sub: ${studentTokenData.participant.id}`);

    // 5. Connect to the SFU at rtc.mathsy.in with the signed participant token
    console.log(`\n[Step 5] Connecting Tutor to production SFU (${SFU_URL}) with participant token...`);
    const tutorSocket = io(SFU_URL, {
      auth: { token: tutorToken },
      query: { token: tutorToken, classId: roomCode, name: "Dr. Evelyn Reed", role: "tutor", peerIdentity: "acme-tutor-001" },
      transports: ["websocket"],
      reconnection: false,
      timeout: 5000,
    });

    const tutorConnectResult = await new Promise<{ connected: boolean; error?: string; roomJoined?: any }>((resolve) => {
      let roomJoinedData: any = null;
      tutorSocket.on("connect", () => {
        console.log(`✓ Socket connected to ${SFU_URL}! Socket ID: ${tutorSocket.id}`);
      });
      tutorSocket.on("roomJoined", (data) => {
        console.log(`✓ roomJoined event received from SFU! Role: ${data?.role}`);
        roomJoinedData = data;
        resolve({ connected: true, roomJoined: data });
      });
      tutorSocket.on("connect_error", (err) => {
        resolve({ connected: false, error: err.message });
      });
      setTimeout(() => {
        resolve({ connected: tutorSocket.connected, roomJoined: roomJoinedData, error: "Timed out waiting for roomJoined" });
      }, 5000);
    });

    console.log("SFU Handshake Result:", tutorConnectResult);

    // 6. Test Cross-Tenant Access Rejection
    console.log("\n[Step 6] Testing Cross-Tenant Security: Org B tries to access Org A room...");
    const orgBRes = await query(
      `INSERT INTO organizations (name, slug, status, settings)
       VALUES ('Competitor Corp', 'competitor-${Date.now()}', 'active', '{}'::jsonb)
       RETURNING id;`
    );
    const orgBId = orgBRes.rows[0].id;
    const keyBRes = await createApiKey({
      organizationId: orgBId,
      name: "Competitor Key",
      permissions: ["rooms:read", "rooms:write", "tokens:write"],
    });
    const keyB = keyBRes.rawKey;

    const crossTenantGet = await fetch(`${API_BASE}/rooms/${roomCode}`, {
      headers: { "Authorization": `Bearer ${keyB}` },
    });
    console.log(`Cross-tenant GET response status: ${crossTenantGet.status} (Expected: 404)`);

    const crossTenantToken = await fetch(`${API_BASE}/rooms/${roomCode}/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${keyB}` },
      body: JSON.stringify({ participantId: "intruder", name: "Intruder", role: "student" }),
    });
    console.log(`Cross-tenant Token Mint status: ${crossTenantToken.status} (Expected: 404)`);

    // 7. Developer ends the room via POST /api/v1/rooms/:roomId/end
    console.log("\n[Step 7] Developer ends room via POST /api/v1/rooms/:roomId/end...");
    const endRoomRes = await fetch(`${API_BASE}/rooms/${roomCode}/end`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}` },
    });
    const endRoomData = await endRoomRes.json();
    console.log(`✓ Room ended status: ${endRoomRes.status} | Active: ${endRoomData.room.isActive}`);

    // Disconnect socket
    tutorSocket.disconnect();

    console.log("\n==================================================================");
    console.log("🎉 SIMULATION RUN COMPLETED");
    console.log("==================================================================");
  } catch (err: any) {
    console.error("❌ SIMULATION FAILED:", err.message);
  } finally {
    // Cleanup test data from DB
    if (orgId) {
      await query("DELETE FROM organizations WHERE id = $1;", [orgId]);
    }
  }
}

runDeveloperSimulation().then(() => {
  process.exit(0);
});
