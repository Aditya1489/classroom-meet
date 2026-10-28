# @mathsy/meet-sdk

Official TypeScript & JavaScript Developer SDK for **Mathsy Meet Cloud**.

Embed low-latency, WebRTC-powered video classrooms and meetings into any web application or learning management system (LMS) with full camera, microphone, screen-sharing, collaborative whiteboard, and live poll support.

---

## 🔒 Security Architecture (Zero-Trust Client)

Mathsy Meet enforces a **Zero-Trust Client** security model:
1. **Never expose Secret API Keys in the browser:** Your secret API key (`sec_live_...` or `sec_test_...`) remains on your secure backend.
2. **Short-Lived Participant Tokens:** Your backend authenticates users and mints room-bound, short-lived (5m–24h) HMAC-SHA256 signed participant tokens via `@mathsy/meet-sdk/server`.
3. **No Token Leaks:** The browser embed helper (`@mathsy/meet-sdk/browser` or `@mathsy/meet-sdk/react`) transmits the participant token in the URL hash fragment (`#token=...`), ensuring it is never leaked via HTTP `Referer` headers.
4. **Origin Validation:** The embedded meeting room strictly verifies allowed parent origins against your tenant configuration in the Developer Dashboard via Content Security Policy `frame-ancestors`.

---

## 📦 Installation

```bash
# Using npm
npm install @mathsy/meet-sdk

# Using pnpm
pnpm add @mathsy/meet-sdk

# Using yarn
yarn add @mathsy/meet-sdk
```

---

## 🚀 Quickstart

### 1. Backend: Minting Participant Tokens (Node.js)

```typescript
import { MathsyMeetServerClient } from "@mathsy/meet-sdk/server";

// Initialize server client with secret API key from environment
const client = new MathsyMeetServerClient({
  apiKey: process.env.MATHSY_MEET_API_KEY!, // e.g. sec_live_... or sec_test_...
  apiBaseUrl: process.env.MATHSY_MEET_API_URL || "https://api.mathsy.in/api/v1",
});

// Step A: Create a Meeting Room
const meeting = await client.createMeeting({
  title: "Advanced Mathematics Class",
  settings: { default_camera_locked: false },
});

console.log("Room Created:", meeting.roomCode);

// Step B: Mint Short-Lived Participant Token for an authenticated student or tutor
const tokenResult = await client.createParticipantToken(meeting.roomCode, {
  participantId: "user_alice_123",
  name: "Alice Smith",
  role: "student", // Valid roles: "tutor" | "student"
  expiresInSeconds: 14400, // 4 hours
});

// Return roomCode and token to your frontend
// res.json({ roomCode: meeting.roomCode, token: tokenResult.token });
```

---

### 2. Frontend: Embedding in React (`@mathsy/meet-sdk/react`)

```tsx
import React, { useState } from "react";
import { MathsyMeeting, MathsyMeetEmbedController } from "@mathsy/meet-sdk/react";

export const ClassroomPage = ({ roomCode, token }: { roomCode: string; token: string }) => {
  const [controller, setController] = useState<MathsyMeetEmbedController | null>(null);

  return (
    <div className="w-full h-[700px] rounded-2xl overflow-hidden border border-gray-800">
      <MathsyMeeting
        roomCode={roomCode}
        token={token}
        embedBaseUrl="https://meet.mathsy.in" // Local dev: "http://localhost:5174"
        width="100%"
        height="100%"
        onControllerReady={(ctrl) => setController(ctrl)}
        onReady={() => console.log("Meeting ready")}
        onJoined={(participant) => console.log("Joined meeting:", participant)}
        onLeft={(event) => console.log("Left meeting:", event.reason)}
        onError={(err) => console.error("Meeting error:", err.code, err.message)}
      />

      {/* Programmatic Controls */}
      {controller && (
        <div className="flex gap-2 p-3 bg-gray-900">
          <button onClick={() => controller.muteAudio()}>Mute</button>
          <button onClick={() => controller.unmuteAudio()}>Unmute</button>
          <button onClick={() => controller.leaveMeeting()}>Leave</button>
        </div>
      )}
    </div>
  );
};
```

---

### 3. Frontend: Embedding in Plain JavaScript (`@mathsy/meet-sdk/browser`)

```html
<div id="meeting-container" style="width: 100%; height: 600px;"></div>

<script type="module">
  import { embedMeeting } from "@mathsy/meet-sdk/browser";

  // 1. Fetch token from your backend
  const res = await fetch("/api/join-meeting");
  const { roomCode, token } = await res.json();

  // 2. Mount embed controller
  const controller = embedMeeting({
    container: "#meeting-container",
    roomCode: roomCode,
    token: token,
    embedBaseUrl: "https://meet.mathsy.in",
    onReady: () => console.log("Meeting ready"),
    onJoined: (p) => console.log("Participant joined", p),
    onLeft: () => console.log("Participant left"),
    onError: (err) => console.error("Embed error:", err.code, err.message),
  });

  // 3. Programmatic controls
  document.getElementById("btn-mute")?.addEventListener("click", () => controller.muteAudio());
</script>
```

---

## ⚙️ Configuration & Allowed Domains

Before embedding in production:
1. Log in to the **Mathsy Meet Developer Console** at `/dashboard`.
2. Under **Allowed Domains**, register your application domain (e.g. `https://lms.myedu.com` or `*.myedu.com`).
3. If an embedding request originates from an unwhitelisted domain, the SDK dispatches an `ORIGIN_NOT_ALLOWED` error to your `onError` handler.

---

## 📜 API Reference

### `MathsyMeetServerClient`
* `constructor(config: ServerClientConfig)`:
  * `apiKey`: Your secret API key (`sec_live_...` or `sec_test_...`).
  * `apiBaseUrl`: Base URL for Mathsy Meet Control-Plane (defaults to `https://api.mathsy.in/api/v1`).
  * `timeoutMs`: HTTP request timeout (defaults to `10000`).
* `createMeeting(options?: CreateMeetingOptions): Promise<MeetingRoom>`
* `getMeeting(roomIdOrCode: string): Promise<MeetingRoom>`
* `endMeeting(roomIdOrCode: string): Promise<{ success: boolean; room: any }>`
* `listParticipants(roomIdOrCode: string, status?: 'active' | 'all'): Promise<ParticipantList>`
* `createParticipantToken(roomIdOrCode: string, options: CreateParticipantTokenOptions): Promise<ParticipantTokenResult>`
* `verifyApiKey(): Promise<ApiKeyVerification>`

### Participant Roles & Permissions
* **Roles:** `"tutor"` (instructor / host) or `"student"` (attendee).
* **Permissions:**
  * `canPublishAudio`: boolean
  * `canPublishVideo`: boolean
  * `canPublishScreen`: boolean (students are authoritatively restricted)
  * `canChat`: boolean
  * `isHost`: boolean (students cannot be elevated to host)

---

## 📄 License

MIT © Mathsy Technologies Inc.
