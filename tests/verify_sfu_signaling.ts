import assert from "node:assert";
import { io } from "socket.io-client";

function b64Url(obj: any) {
  return Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function makeToken(id: string, role: string, name: string) {
  const h = b64Url({ alg: "HS256", typ: "JWT" });
  const p = b64Url({ sub: id, id, role, name, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.sig`;
}

async function testRoomIsolation() {
  const serverUrl = "https://rtc.mathsy.in";
  const roomA = "room-a-" + Date.now();
  const roomB = "room-b-" + Date.now();

  const tutorTokenA = makeToken("tutor-a", "tutor", "Tutor A");
  const tutorA = io(serverUrl, {
    auth: { token: tutorTokenA },
    query: { token: tutorTokenA, classId: roomA, name: "Tutor A", role: "tutor", peerIdentity: "tutor-a" },
    transports: ["websocket"],
  });

  const studentTokenA = makeToken("student-a", "student", "Student A");
  const studentA = io(serverUrl, {
    auth: { token: studentTokenA },
    query: { token: studentTokenA, classId: roomA, name: "Student A", role: "student", peerIdentity: "student-a" },
    transports: ["websocket"],
  });

  const studentTokenB = makeToken("student-b", "student", "Student B");
  const studentB = io(serverUrl, {
    auth: { token: studentTokenB },
    query: { token: studentTokenB, classId: roomB, name: "Student B", role: "student", peerIdentity: "student-b" },
    transports: ["websocket"],
  });

  await Promise.all([
    new Promise<void>((res) => tutorA.on("connect", res)),
    new Promise<void>((res) => studentA.on("connect", res)),
    new Promise<void>((res) => studentB.on("connect", res)),
  ]);

  await new Promise((r) => setTimeout(r, 1000));

  let studentAReceived = false;
  let studentBReceived = false;

  studentA.on("whiteboardDraw", () => { studentAReceived = true; });
  studentB.on("whiteboardDraw", () => { studentBReceived = true; });

  tutorA.emit("whiteboardDraw", { room: roomA, shape: "test" });

  await new Promise((r) => setTimeout(r, 1500));

  assert.strictEqual(studentAReceived, true, "Student in Room A must receive Tutor A drawing");
  assert.strictEqual(studentBReceived, false, "Student in Room B must NOT receive Tutor A drawing (Room isolation confirmed)");

  console.log("✓ Room isolation verified! Student in Room B received 0 events from Room A.");

  tutorA.disconnect();
  studentA.disconnect();
  studentB.disconnect();
}

testRoomIsolation().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
