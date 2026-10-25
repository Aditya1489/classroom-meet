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

async function probe() {
  const serverUrl = "https://rtc.mathsy.in";
  const roomCode = "probe-" + Math.random().toString(36).substring(2, 7);
  const tutorId = "probe-tutor-" + Math.random().toString(36).substring(2, 7);
  const token = makeToken(tutorId, "tutor", "Probe Tutor");

  console.log(`Connecting probe client to ${serverUrl} in room ${roomCode}...`);
  const socket = io(serverUrl, {
    auth: { token },
    query: { token, classId: roomCode, name: "Probe Tutor", role: "tutor", peerIdentity: tutorId },
    transports: ["websocket"],
  });

  await new Promise<void>((resolve, reject) => {
    socket.on("connect", () => {
      console.log("✓ Socket connected! Socket ID:", socket.id);
      resolve();
    });
    socket.on("connect_error", (err) => {
      reject(err);
    });
    setTimeout(() => reject(new Error("Socket connect timeout")), 5000);
  });

  // Listen for roomJoined
  const roomJoinedData = await new Promise<any>((resolve) => {
    socket.on("roomJoined", (data) => {
      console.log("✓ roomJoined received! Router capabilities present:", !!data?.routerRtpCapabilities);
      resolve(data);
    });
    setTimeout(() => resolve(null), 4000);
  });

  console.log("Testing createWebRtcTransport for producing...");
  const sendTransportRes = await new Promise<any>((resolve) => {
    socket.emit("createWebRtcTransport", { producing: true, consuming: false }, (res: any) => {
      resolve(res);
    });
    setTimeout(() => resolve("TIMEOUT"), 4000);
  });
  console.log("Send Transport response:", JSON.stringify(sendTransportRes, null, 2));

  console.log("Testing createWebRtcTransport for consuming...");
  const recvTransportRes = await new Promise<any>((resolve) => {
    socket.emit("createWebRtcTransport", { producing: false, consuming: true }, (res: any) => {
      resolve(res);
    });
    setTimeout(() => resolve("TIMEOUT"), 4000);
  });
  console.log("Recv Transport response:", JSON.stringify(recvTransportRes, null, 2));

  socket.disconnect();
}

probe().catch((err) => {
  console.error("Probe error:", err);
  process.exit(1);
});
