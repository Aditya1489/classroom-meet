/**
 * Acme University LMS — Customer Portal Frontend Script
 * Demonstrates embedding Mathsy Meet using the Browser SDK without exposing API secrets.
 */

// Import browser SDK directly from compiled bundle served at /sdk
import { embedMeeting } from "/sdk/browser.mjs";

// State
let activeController = null;
let serverConfig = { embedBaseUrl: "http://localhost:5174", parentOrigin: "http://localhost:5002" };
let currentRoomCode = "";

// DOM Elements
const logBox = document.getElementById("event-log");
const emptyState = document.getElementById("empty-state");
const embedTarget = document.getElementById("embed-target");
const parentControlsCard = document.getElementById("parent-controls-card");
const statusPill = document.getElementById("status-pill");
const statusText = document.getElementById("status-text");

function log(text, type = "info") {
  const time = new Date().toLocaleTimeString();
  const div = document.createElement("div");
  div.className = `log-item ${type}`;
  div.textContent = `[${time}] ${text}`;
  logBox.appendChild(div);
  logBox.scrollTop = logBox.scrollHeight;
}

// Fetch backend config on load
async function loadConfig() {
  try {
    const res = await fetch("/api/config");
    serverConfig = await res.json();
    log(`Connected to customer backend. Embed server: ${serverConfig.embedBaseUrl}`, "info");
  } catch (err) {
    log(`Failed to load backend config: ${err.message}`, "error");
  }
}
loadConfig();

// Mount active meeting
function mountMeeting(roomCode, token) {
  if (activeController) {
    activeController.destroy();
  }

  emptyState.style.display = "none";
  embedTarget.style.display = "block";
  parentControlsCard.style.opacity = "1";
  parentControlsCard.style.pointerEvents = "auto";
  statusPill.className = "status-pill active";
  statusText.textContent = `Connected: ${roomCode}`;

  log(`Embedding room '${roomCode}' using verified participant token...`, "command");

  activeController = embedMeeting({
    container: embedTarget,
    roomCode,
    token,
    embedBaseUrl: serverConfig.embedBaseUrl,
    parentOrigin: serverConfig.parentOrigin,
  });

  // Event handlers
  activeController.on("ready", (payload) => {
    log(`[EVENT: ready] Session ready for participant: ${payload.participantId} (${payload.role})`, "event");
  });

  activeController.on("joined", (payload) => {
    log(`[EVENT: joined] Connected to classroom audio/video mesh!`, "event");
  });

  activeController.on("mediaStateChanged", (payload) => {
    log(`[EVENT: mediaStateChanged] Mic: ${payload.isMicEnabled ? "ON" : "OFF"}, Cam: ${payload.isCamEnabled ? "ON" : "OFF"}`, "event");
  });

  activeController.on("error", (payload) => {
    log(`[EVENT: error] Code: ${payload.code} — ${payload.message}`, "error");
  });

  activeController.on("left", () => {
    log(`[EVENT: left] Participant disconnected from session.`, "info");
    statusPill.className = "status-pill";
    statusText.textContent = "Session Left";
  });
}

// 1. Create and Join Meeting
document.getElementById("btn-create-join").addEventListener("click", async () => {
  const name = document.getElementById("participant-name").value.trim() || "Dr. Eleanor Vance";
  const role = document.getElementById("participant-role").value;
  const title = document.getElementById("meeting-title").value.trim() || "Calculus 101 Lecture";

  try {
    log(`[Step 1] Customer backend requesting new meeting room...`, "info");
    const createRes = await fetch("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });

    const createData = await createRes.json();
    if (!createRes.ok) throw new Error(createData.error || "Room creation failed");

    currentRoomCode = createData.meeting.roomCode;
    log(`[Step 2] Meeting created! Room Code: ${currentRoomCode}`, "info");

    log(`[Step 3] Requesting short-lived participant token from customer backend...`, "info");
    const joinRes = await fetch(`/api/sessions/${currentRoomCode}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: `usr-${Date.now().toString(36)}`,
        userName: name,
        role,
      }),
    });

    const joinData = await joinRes.json();
    if (!joinRes.ok) throw new Error(joinData.error || "Token issuance failed");

    log(`[Step 4] Participant token issued! Expires: ${new Date(joinData.expiresAt).toLocaleTimeString()}`, "info");
    mountMeeting(currentRoomCode, joinData.token);
  } catch (err) {
    log(`Error: ${err.message}`, "error");
  }
});

// 2. Join Existing Meeting
document.getElementById("btn-join-existing").addEventListener("click", async () => {
  const roomCode = document.getElementById("join-room-code").value.trim().toLowerCase();
  const name = document.getElementById("participant-name").value.trim() || "Student Learner";
  const role = document.getElementById("participant-role").value;

  if (!roomCode) {
    alert("Please enter a room code");
    return;
  }

  try {
    log(`Requesting token for room '${roomCode}'...`, "info");
    const joinRes = await fetch(`/api/sessions/${roomCode}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: `usr-${Date.now().toString(36)}`,
        userName: name,
        role,
      }),
    });

    const joinData = await joinRes.json();
    if (!joinRes.ok) throw new Error(joinData.error || "Token issuance failed");

    currentRoomCode = roomCode;
    mountMeeting(roomCode, joinData.token);
  } catch (err) {
    log(`Error: ${err.message}`, "error");
  }
});

// 3. Parent postMessage Controls
document.getElementById("cmd-mute").addEventListener("click", () => {
  if (activeController) {
    log("Parent dispatched command: MUTE_AUDIO", "command");
    activeController.muteAudio();
  }
});

document.getElementById("cmd-unmute").addEventListener("click", () => {
  if (activeController) {
    log("Parent dispatched command: UNMUTE_AUDIO", "command");
    activeController.unmuteAudio();
  }
});

document.getElementById("cmd-cam-off").addEventListener("click", () => {
  if (activeController) {
    log("Parent dispatched command: DISABLE_VIDEO", "command");
    activeController.disableVideo();
  }
});

document.getElementById("cmd-cam-on").addEventListener("click", () => {
  if (activeController) {
    log("Parent dispatched command: ENABLE_VIDEO", "command");
    activeController.enableVideo();
  }
});

document.getElementById("cmd-leave").addEventListener("click", () => {
  if (activeController) {
    log("Parent dispatched command: LEAVE_MEETING", "command");
    activeController.leaveMeeting();
  }
});

// 4. Negative Testing Simulations
document.getElementById("sim-expired").addEventListener("click", async () => {
  log("Simulating expired participant token rejection...", "warning");
  try {
    const res = await fetch(`/api/sessions/demo-room-expired/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "test-user-expired",
        userName: "Expired Participant",
        role: "student",
        simulateExpired: true,
      }),
    });
    const data = await res.json();
    mountMeeting("demo-room-expired", data.token || "expired.tampered.token");
  } catch (err) {
    mountMeeting("demo-room-expired", "expired.tampered.token");
  }
});

document.getElementById("sim-wrong-room").addEventListener("click", async () => {
  log("Simulating wrong-room token mismatch rejection...", "warning");
  try {
    // Obtain token for room A, embed in room B
    const res = await fetch("/api/sessions/create", { method: "POST", headers: { "Content-Type": "application/json" } });
    const createData = await res.json();
    const tokenRes = await fetch(`/api/sessions/${createData.meeting.roomCode}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "user-1", userName: "Alice", role: "student" }),
    });
    const tokenData = await tokenRes.json();
    // Mount with mismatched room code
    mountMeeting("completely-different-room-xyz", tokenData.token);
  } catch (err) {
    log(`Simulation error: ${err.message}`, "error");
  }
});

document.getElementById("btn-clear-logs").addEventListener("click", () => {
  logBox.innerHTML = "";
});
