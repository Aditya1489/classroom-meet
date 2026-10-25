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

async function testConsume() {
  const serverUrl = "https://rtc.mathsy.in";
  const roomCode = "test-media-101";
  const studentId = "student-sub-001";
  const token = makeToken(studentId, "student", "Student Subscriber");

  console.log(`Connecting Student Subscriber to ${serverUrl} in room ${roomCode}...`);
  const socket = io(serverUrl, {
    auth: { token },
    query: { token, classId: roomCode, name: "Student Subscriber", role: "student", peerIdentity: studentId },
    transports: ["websocket"],
  });

  const activeProducersReceived: any[] = [];
  socket.on("activeProducers", (data) => {
    console.log("✓ activeProducers received on join:", JSON.stringify(data));
    activeProducersReceived.push(data);
  });
  socket.on("active-producers", (data) => {
    console.log("✓ active-producers received on join:", JSON.stringify(data));
    activeProducersReceived.push(data);
  });
  socket.on("newProducer", (data) => {
    console.log("✓ newProducer received:", JSON.stringify(data));
    activeProducersReceived.push(data);
  });

  await new Promise<void>((resolve, reject) => {
    socket.on("connect", () => {
      console.log("✓ Student socket connected! Socket ID:", socket.id);
      resolve();
    });
    setTimeout(() => reject(new Error("Connect timeout")), 5000);
  });

  const roomJoined = await new Promise<any>((resolve) => {
    socket.on("roomJoined", (d) => {
      console.log("✓ Student roomJoined received! Peers in room:", d?.peers?.length || 0);
      resolve(d);
    });
    setTimeout(() => resolve(null), 4000);
  });

  // Create receiving WebRTC transport
  console.log("Requesting recvWebRtcTransport from SFU...");
  const recvTransportRes = await new Promise<any>((resolve) => {
    socket.emit("createWebRtcTransport", { producing: false, consuming: true }, (res: any) => {
      resolve(res);
    });
    setTimeout(() => resolve("TIMEOUT"), 4000);
  });

  console.log("Recv Transport Result:", JSON.stringify(recvTransportRes, null, 2));

  // Request consume on the active video producer if found
  const flatProducers = activeProducersReceived.flat(2);
  const videoProducer = flatProducers.find((p) => p.kind === "video");

  if (videoProducer) {
    console.log("Found Video Producer on SFU! Producer ID:", videoProducer.producerId || videoProducer.id);
    const prodId = videoProducer.producerId || videoProducer.id;
    const recvTransportId = recvTransportRes?.params?.id || recvTransportRes?.id;

    console.log(`Requesting consume from SFU for producer ${prodId} on transport ${recvTransportId}...`);
    const consumeRes = await new Promise<any>((resolve) => {
      socket.emit(
        "consume",
        {
          transportId: recvTransportId,
          producerId: prodId,
          rtpCapabilities: roomJoined?.routerRtpCapabilities,
        },
        (res: any) => {
          resolve(res);
        }
      );
      setTimeout(() => resolve("TIMEOUT"), 5000);
    });

    console.log("Consume Result from SFU:", JSON.stringify(consumeRes, null, 2));
  } else {
    console.log("No video producer found in activeProducers list.");
  }

  socket.disconnect();
}

testConsume().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
