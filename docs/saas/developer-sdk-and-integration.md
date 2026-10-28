# Mathsy Meet Developer SDK & External Integration Guide

## 1. Executive Overview

Mathsy Meet Cloud provides an enterprise-grade, embeddable video meeting infrastructure designed for external SaaS platforms, learning management systems (LMS), and custom developer applications.

The integration architecture follows a strict **Zero-Trust Client** security model:
1. **Never expose Secret API Keys in browsers:** Secret API keys (`sec_live_...` or `sec_test_...`) are strictly held by the customer's trusted backend.
2. **Server-Minted Short-Lived Participant Tokens:** The customer's backend authenticates users, determines permissions (audio, video, screen share, host controls), and mints short-lived (5m–60m), HMAC-SHA256 signed participant tokens via Mathsy Meet's Control Plane API.
3. **Secure Iframe Embedding:** The customer's frontend embeds Mathsy Meet using the browser SDK helper `embedMeeting()` or the React `<MathsyMeeting>` component. The participant token is transmitted in the URL hash fragment (`#token=...`), ensuring it is never leaked via HTTP `Referer` headers or network logs.
4. **Bi-directional Typed PostMessage:** The host page and embedded meeting communicate via an origin-validated `postMessage` protocol with strict target origin checks (wildcards `*` are forbidden).
5. **Origin Authorization:** Only domains registered in your organization's Developer Dashboard (`allowed_domains`) can embed meeting rooms. If an unlisted origin attempts to embed, the meeting is blocked and a typed `ORIGIN_NOT_ALLOWED` error is emitted to the host frame.

---

## 2. Package Architecture & Installation

The `@mathsy/meet-sdk` package provides dual ESM (`.mjs`) and CommonJS (`.cjs`) builds with complete TypeScript declarations (`.d.ts`):

```
@mathsy/meet-sdk/
├── dist/
│   ├── index.mjs / index.cjs / index.d.ts      # Unified package root
│   ├── server.mjs / server.cjs / server.d.ts   # Server-side client (Node / Edge)
│   ├── browser.mjs / browser.cjs / browser.d.ts# Browser embed controller
│   └── react.mjs / react.cjs / react.d.ts      # React component & hook
├── package.json
└── README.md
```

### Installation

Install the package via your package manager:

```bash
npm install @mathsy/meet-sdk
# or
yarn add @mathsy/meet-sdk
# or
pnpm add @mathsy/meet-sdk
```

For local repository development:
```bash
npm install /path/to/mathsy-meet/sdk
# or link as a workspace dependency:
# "@mathsy/meet-sdk": "file:../../sdk"
```

### Peer Dependencies
- For Node.js / Server environments: Node.js >= 18 (Fetch API built-in). No external runtime dependencies.
- For React environments: `react` >= 16.8.0 and `react-dom` >= 16.8.0.

---

## 3. Server-Side Integration Guide

### 3.1 Initializing the Client

```typescript
import { MathsyMeetServerClient } from "@mathsy/meet-sdk/server";

// Initialize with your secret API key
const client = new MathsyMeetServerClient({
  apiKey: process.env.MATHSY_MEET_API_KEY!, // e.g., sec_live_... or sec_test_...
  apiBaseUrl: process.env.MATHSY_MEET_API_URL || "https://api.mathsy.in/api/v1", // http://localhost:5001/api/v1 for local dev
  timeoutMs: 10000,
});
```

> [!CAUTION]
> **Server-Only Safeguard:** If `MathsyMeetServerClient` detects a browser window (`typeof window !== "undefined"`), it immediately throws a `SecurityError` to prevent accidental credential leakage into client bundles.

### 3.2 Creating a Room

```typescript
// Create a scheduled or instant video meeting room
const room = await client.createMeeting({
  title: "Grade 10 Algebra — Live Class",
  metadata: {
    courseId: "MATH-101",
    sectionId: "SEC-B",
    instructorId: "usr_tutor_42",
  },
});

console.log("Room created successfully:");
console.log(`- Room Code:       ${room.roomCode}`);
console.log(`- Room ID:         ${room.id}`);
console.log(`- Organization ID: ${room.organizationId}`);
console.log(`- Environment:     ${room.environment}`);
```

### 3.3 Issuing Participant Tokens

When an authenticated student or tutor clicks "Join Meeting" on your platform:

```typescript
// In your backend route (e.g. POST /api/meetings/:roomCode/join)
app.post("/api/meetings/:roomCode/join", requireAuth, async (req, res) => {
  const { roomCode } = req.params;
  const user = req.user; // Authenticated user from your session/JWT

  const isTutor = user.role === "teacher" || user.role === "instructor";

  try {
    const tokenResult = await client.createParticipantToken(roomCode, {
      participantId: user.id,
      name: user.fullName,
      role: isTutor ? "tutor" : "student", // Supported roles: "tutor" | "student"
      permissions: {
        canPublishAudio: true,
        canPublishVideo: true,
        canPublishScreen: isTutor, // Only tutors can publish screen
        canChat: true,
        isHost: isTutor,           // Host controls (muting others, room ending)
      },
      expiresInSeconds: 3600,      // 1 hour token validity (60s to 86400s)
    });

    res.json({
      success: true,
      roomCode: tokenResult.roomCode,
      token: tokenResult.token,
      expiresAt: tokenResult.expiresAt,
      participant: tokenResult.participant,
    });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({
      error: err.message,
      code: err.code || "TOKEN_ISSUANCE_FAILED",
    });
  }
});
```

### 3.4 Ending Meetings

```typescript
// Terminate an active session and evict all connected participants
await client.endMeeting(roomCode);
```

### 3.5 Checking Meeting Status and Active Participants

```typescript
// Retrieve room metadata and active participant count
const meeting = await client.getMeeting(roomCode);
console.log(`Active participants: ${meeting.activeParticipantsCount}`);

// List participant records
const participants = await client.listParticipants(roomCode, "active");
```

---

## 4. Frontend Embed Integration Guide

### 4.1 React Integration (`<MathsyMeeting>` & `useMathsyMeeting`)

The `@mathsy/meet-sdk/react` subpath provides a complete, first-class React component and custom hook.

```tsx
import React, { useState } from "react";
import { MathsyMeeting, MeetingController } from "@mathsy/meet-sdk/react";

export function ClassroomSession({ roomCode, token }: { roomCode: string; token: string }) {
  const [controller, setController] = useState<MeetingController | null>(null);

  return (
    <div className="classroom-layout" style={{ width: "100%", height: "800px" }}>
      {/* Optional external controls */}
      <div className="toolbar" style={{ marginBottom: "1rem" }}>
        <button onClick={() => controller?.muteAudio()}>Mute</button>
        <button onClick={() => controller?.unmuteAudio()}>Unmute</button>
        <button onClick={() => controller?.leaveMeeting()}>Leave</button>
      </div>

      <MathsyMeeting
        roomCode={roomCode}
        token={token}
        embedBaseUrl={import.meta.env.VITE_MATHSY_EMBED_URL || "http://localhost:5174"}
        parentOrigin={window.location.origin}
        className="meeting-frame-container"
        onReady={(payload) => {
          console.log("Embed initialized for participant:", payload.participantId);
        }}
        onJoined={(payload) => {
          console.log("Connected to room audio/video:", payload);
        }}
        onLeft={(payload) => {
          console.log("Disconnected from meeting:", payload);
        }}
        onMediaStateChanged={(media) => {
          console.log("Mic:", media.isMicEnabled, "Cam:", media.isCamEnabled);
        }}
        onError={(err) => {
          console.error("Meeting Error:", err.code, err.message);
        }}
        loadingNode={
          <div className="loading-spinner">Connecting to Mathsy Meet...</div>
        }
      />
    </div>
  );
}
```

#### Custom Hook: `useMathsyMeeting`
For custom UI rendering and manual DOM element binding:

```tsx
import React, { useRef } from "react";
import { useMathsyMeeting } from "@mathsy/meet-sdk/react";

export function CustomMeetingPlayer({ roomCode, token }: { roomCode: string; token: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  const { controller, status, error, isReady } = useMathsyMeeting(containerRef, {
    roomCode,
    token,
    embedBaseUrl: "https://meet.mathsy.in",
    onJoined: () => console.log("Joined!"),
  });

  return (
    <div>
      {status === "loading" && <p>Loading room...</p>}
      {error && <p className="error">Error: {error.message}</p>}
      <div ref={containerRef} style={{ width: "100%", height: "600px" }} />
    </div>
  );
}
```

### 4.2 Vanilla JavaScript / TypeScript Integration

```html
<div id="meeting-container" style="width: 100%; height: 750px;"></div>

<script type="module">
  import { embedMeeting } from "@mathsy/meet-sdk/browser";

  // 1. Fetch short-lived token from YOUR backend
  const response = await fetch(`/api/meetings/ptq-rtvq-rox/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });
  const { roomCode, token } = await response.json();

  // 2. Embed the meeting iframe
  const controller = embedMeeting({
    container: document.getElementById("meeting-container"),
    roomCode,
    token,
    embedBaseUrl: "https://meet.mathsy.in", // Or http://localhost:5174 for local dev
    parentOrigin: window.location.origin,
    onReady: (payload) => console.log("Meeting ready:", payload),
    onJoined: (payload) => console.log("Participant joined:", payload),
    onLeft: (payload) => console.log("Participant left:", payload),
    onMediaStateChanged: (media) => console.log("Media state:", media),
    onError: (err) => console.error("Meeting error:", err.code, err.message),
  });

  // 3. Programmatic parent controls
  document.getElementById("btn-mute").onclick = () => controller.muteAudio();
  document.getElementById("btn-unmute").onclick = () => controller.unmuteAudio();
  document.getElementById("btn-cam-off").onclick = () => controller.disableVideo();
  document.getElementById("btn-cam-on").onclick = () => controller.enableVideo();
  document.getElementById("btn-leave").onclick = () => controller.leaveMeeting();

  // 4. Cleanup when navigating away
  // controller.destroy();
</script>
```

---

## 5. Security Architecture & Allowed Domains

### 5.1 Registering Allowed Domains in the Developer Dashboard
Mathsy Meet prevents clickjacking, iframe abuse, and token theft using origin verification and frame ancestry headers:
1. Log in to the Mathsy Meet Developer Console.
2. Under **Organization Apps**, select or create an App for your web product.
3. Add all origins that will embed the meeting under **Allowed Domains**:
   - `http://localhost:3000` (Local frontend)
   - `http://localhost:5002` (Local demo portal)
   - `https://app.acmelearning.com` (Production website)
4. When a user navigates to `/embed/:roomCode`, the control plane checks `ancestorOrigins` and the parent origin against your app's registered `allowed_domains`.
5. If the parent origin is unauthorized, Mathsy Meet securely displays an origin rejection screen and posts a typed error message to the parent frame:
   ```json
   {
     "type": "meeting.error",
     "payload": {
       "code": "ORIGIN_NOT_ALLOWED",
       "message": "The origin 'https://unauthorized-domain.com' is not permitted to embed this meeting."
     }
   }
   ```

### 5.2 Roles & Permission Matrix

| Field | Supported Values | Notes |
|---|---|---|
| `role` | `"tutor"`, `"student"` | `"tutor"` represents instructor/host; `"student"` represents attendee/learner. |
| `permissions.canPublishAudio` | `true`, `false` | Microphone stream publishing. |
| `permissions.canPublishVideo` | `true`, `false` | Camera stream publishing. |
| `permissions.canPublishScreen`| `true`, `false` | Display-capture/screen-share streaming. |
| `permissions.canChat` | `true`, `false` | In-meeting text chat and reactions. |
| `permissions.isHost` | `true`, `false` | Host controls (muting other participants, terminating meeting). |

---

## 6. PostMessage Communication Protocol

All messages exchanged between the external host window and the Mathsy Meet iframe are typed JSON payloads with target origin matching.

### 6.1 Host Commands (`window.postMessage`)

Dispatched by the SDK controller to the meeting iframe:

| Command | Payload | Description |
|---|---|---|
| `MUTE_AUDIO` | `{}` | Mutes participant's microphone |
| `UNMUTE_AUDIO` | `{}` | Requests unmuting microphone |
| `DISABLE_VIDEO` | `{}` | Stops camera stream |
| `ENABLE_VIDEO` | `{}` | Starts camera stream |
| `LEAVE_MEETING` | `{}` | Safely leaves the meeting |
| `GET_STATUS` | `{}` | Requests current room and media state |

### 6.2 Meeting Events (`window.postMessage`)

Dispatched by the meeting iframe to the host parent window:

| Event | Payload | Description |
|---|---|---|
| `meeting.ready` | `{ roomCode, participantId, role }` | Embed route initialized, verification succeeded |
| `meeting.joined` | `{ participantId, name, role }` | Participant joined SFU room |
| `meeting.left` | `{ reason }` | Participant left or was evicted |
| `media.state_changed` | `{ isMicEnabled, isCamEnabled, isScreenSharing }` | Microphone/camera state changed |
| `meeting.error` | `{ code, message }` | Fatal or recoverable error occurred |

---

## 7. Running the Customer Portal Reference Demo

A complete customer portal reference implementation is provided in `demo/customer-portal`.

### Starting Local Services

```bash
# Terminal 1: Control-plane API (port 5001)
npm run server

# Terminal 2: Mathsy Meet Frontend (port 5174)
npm run dev

# Terminal 3: Customer LMS Portal Demo (port 5002)
npx tsx demo/customer-portal/server.ts
```

Open `http://localhost:5002` in your browser to experience the end-to-end embedding flow, parent controls, and negative security testing scenarios.
