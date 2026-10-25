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

async function testSignalingChat() {
  const serverUrl = "https://rtc.mathsy.in";
  const room = "diag-chat-" + Date.now();

  const tutorToken = makeToken("tutor-1", "tutor", "Tutor Alice");
  const studentToken = makeToken("student-1", "student", "Student Bob");

  console.log("Connecting tutor and student to room:", room);

  const tutor = io(serverUrl, {
    auth: { token: tutorToken },
    query: { token: tutorToken, classId: room, name: "Tutor Alice", role: "tutor", peerIdentity: "tutor-1" },
    transports: ["websocket"],
  });

  const student = io(serverUrl, {
    auth: { token: studentToken },
    query: { token: studentToken, classId: room, name: "Student Bob", role: "student", peerIdentity: "student-1" },
    transports: ["websocket"],
  });

  await Promise.all([
    new Promise<void>((r) => tutor.on("connect", r)),
    new Promise<void>((r) => student.on("connect", r)),
  ]);

  console.log("Both connected.");
  await new Promise((r) => setTimeout(r, 1000));

  const receivedTutor: any[] = [];
  const receivedStudent: any[] = [];

  tutor.on("chatMessage", (data) => receivedTutor.push({ event: "chatMessage", data }));
  tutor.on("chat:message", (data) => receivedTutor.push({ event: "chat:message", data }));

  student.on("chatMessage", (data) => receivedStudent.push({ event: "chatMessage", data }));
  student.on("chat:message", (data) => receivedStudent.push({ event: "chat:message", data }));

  // Test 1: emit "chatMessage" from tutor
  console.log("Emitting chatMessage from tutor...");
  tutor.emit("chatMessage", {
    id: "msg-1",
    senderId: "tutor-1",
    senderName: "Tutor Alice",
    text: "Hello Class via chatMessage",
    isHost: true,
  });

  await new Promise((r) => setTimeout(r, 1000));

  console.log("After chatMessage emit:");
  console.log("Tutor received (echo?):", receivedTutor.length, receivedTutor);
  console.log("Student received:", receivedStudent.length, receivedStudent);

  // Test 2: emit "chat:send" from tutor
  console.log("Emitting chat:send from tutor...");
  tutor.emit("chat:send", {
    id: "msg-2",
    senderId: "tutor-1",
    senderName: "Tutor Alice",
    text: "Hello Class via chat:send",
    isHost: true,
  });

  await new Promise((r) => setTimeout(r, 1000));

  console.log("After chat:send emit:");
  console.log("Tutor received total:", receivedTutor.length, receivedTutor);
  console.log("Student received total:", receivedStudent.length, receivedStudent);

  // Test 3: emit BOTH as mediasoupClient.ts does
  const countBeforeT = receivedTutor.length;
  const countBeforeS = receivedStudent.length;
  console.log("Emitting BOTH chatMessage AND chat:send as mediasoupClient.ts does...");
  const msgBoth = {
    id: "msg-both-1",
    senderId: "tutor-1",
    senderName: "Tutor Alice",
    text: "Testing dual emit",
    isHost: true,
  };
  tutor.emit("chatMessage", msgBoth);
  tutor.emit("chat:send", msgBoth);

  await new Promise((r) => setTimeout(r, 1500));

  console.log("After dual emit:");
  console.log("Tutor delta received:", receivedTutor.length - countBeforeT);
  console.log("Student delta received:", receivedStudent.length - countBeforeS, receivedStudent.slice(countBeforeS));

  tutor.disconnect();
  student.disconnect();
}

testSignalingChat().catch(console.error);
