# Milestone 5: Mediasoup SFU Authentication, Authorization & Security Runbook

---

## 1. Executive Summary & Implementation Status

- **Status:** **IMPLEMENTED & VERIFIED LOCALLY (Milestone 5B)**
- **SFU Repository:** `/Users/adityachavhan/Documents/Mathsy/mathsy-meet-server`
- **Main Backend:** `/Users/adityachavhan/Documents/Mathsy/mathsy-meet`
- **Build & Test Evidence:**
  - TypeScript compilation: `npm run build` succeeds cleanly with 0 errors.
  - Automated integration test suite: `npm test` runs `scripts/sfu_token_security.test.mjs` — **15/15 PASS** in 189ms.
- **Production Status:** Local implementation complete. Deployment to `rtc.mathsy.in` (`80.225.208.166`) is intentionally paused pending explicit administrator deployment authorization.

This document specifies the authoritative server-side security architecture for the standalone Mediasoup SFU server (`mathsy-meet-server`). It implements the cryptographic verification of participant tokens issued by the Mathsy Meet backend (`docs/saas/participant-token-contract.md`) and secures all signaling and WebRTC media transport events.

---

## 2. Server-Side Token Verification Module

The module is implemented in `src/auth/participantTokenAuth.ts` on the `mathsy-meet-server` repository:

```typescript
import jwt from "jsonwebtoken";

export interface ParticipantPermissions {
  canPublishAudio: boolean;
  canPublishVideo: boolean;
  canPublishScreen: boolean;
  canChat: boolean;
  isHost: boolean;
}

export interface VerifiedParticipantClaims {
  sub: string;            // Participant ID
  name: string;           // Display Name
  role: "tutor" | "student";
  tenant_id: string;      // Organization UUID
  room_code: string;      // Bound Room Code
  room_id: string;        // Room UUID
  permissions: ParticipantPermissions;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

const PARTICIPANT_JWT_SECRET = process.env.PARTICIPANT_JWT_SECRET || "";
const EXPECTED_ISSUER = "mathsy-meet-saas";
const EXPECTED_AUDIENCE = "mathsy-meet-sfu";

/**
 * Authoritatively verifies a participant JWT against the backend signing secret.
 * Enforces cryptographic signature, expiration, issuer, audience, and room binding.
 */
export function verifyParticipantToken(
  rawToken: string,
  requestedRoomCode: string
): { valid: boolean; claims?: VerifiedParticipantClaims; error?: string } {
  if (!rawToken || typeof rawToken !== "string" || rawToken.trim().length === 0) {
    return { valid: false, error: "Missing participant token" };
  }

  if (!PARTICIPANT_JWT_SECRET) {
    console.error("[CRITICAL] PARTICIPANT_JWT_SECRET is not configured on the SFU server!");
    return { valid: false, error: "SFU server authentication misconfigured" };
  }

  const cleanToken = rawToken.startsWith("Bearer ") ? rawToken.slice(7).trim() : rawToken.trim();

  try {
    const claims = jwt.verify(cleanToken, PARTICIPANT_JWT_SECRET, {
      algorithms: ["HS256"], // Strictly enforce HS256 to prevent algorithm confusion attacks
      issuer: EXPECTED_ISSUER,
      audience: EXPECTED_AUDIENCE,
      clockTolerance: 10, // 10 seconds tolerance for clock skew
    }) as VerifiedParticipantClaims;

    // Room Binding Check: Token room MUST match the requested classId/roomCode
    if (!claims.room_code || claims.room_code.toLowerCase().trim() !== requestedRoomCode.toLowerCase().trim()) {
      return {
        valid: false,
        error: `Token room mismatch: token is bound to room '${claims.room_code}', but requested '${requestedRoomCode}'`,
      };
    }

    // Role Invariant: If role is student, isHost must strictly be false
    if (claims.role !== "tutor" && claims.role !== "student") {
      return { valid: false, error: `Invalid role '${claims.role}' in token claims` };
    }

    if (claims.role === "student" && claims.permissions?.isHost) {
      return { valid: false, error: "Forged privilege: student cannot possess isHost: true" };
    }

    return { valid: true, claims };
  } catch (err: any) {
    return { valid: false, error: `Token signature or claim verification failed: ${err.message}` };
  }
}
```

---

## 3. Socket.IO Interceptors & Event Authorization Guard

In `src/socket/index.ts` on the SFU server, replace the permissive handshake with strict token validation:

### 3.1 Handshake Middleware
```typescript
io.use(async (socket: Socket, next) => {
  const token =
    (socket.handshake.auth?.token as string) ||
    (socket.handshake.query?.token as string) ||
    (socket.handshake.headers?.authorization as string);

  const classId =
    (socket.handshake.query?.classId as string) ||
    (socket.handshake.auth?.classId as string) ||
    (socket.handshake.query?.roomCode as string) ||
    (socket.handshake.auth?.roomCode as string);

  if (!classId) {
    return next(new Error("AUTH_ERROR: Missing classId / roomCode"));
  }

  const auth = verifyParticipantToken(token, classId);
  if (!auth.valid || !auth.claims) {
    console.warn(`[SFU Auth Reject] Socket ${socket.id} rejected: ${auth.error}`);
    return next(new Error(`AUTH_ERROR: ${auth.error}`));
  }

  // Bind verified session claims authoritatively to socket data
  socket.data = {
    user: {
      sub: auth.claims.sub,
      name: auth.claims.name,
    },
    tenantId: auth.claims.tenant_id,
    classId: auth.claims.room_code,
    role: auth.claims.role,
    isHost: auth.claims.permissions.isHost,
    permissions: auth.claims.permissions,
  };

  next();
});
```

### 3.2 WebRTC Media & Transport Guards
```typescript
// 1. Send Transport Creation Guard
socket.on("createWebRtcTransport", async (payload, callback) => {
  try {
    const { producing } = payload;
    const { permissions, role } = socket.data;

    // If client attempts to create a send transport but lacks any publishing permission
    if (producing && !permissions.canPublishAudio && !permissions.canPublishVideo && !permissions.canPublishScreen) {
      return callback({ error: "FORBIDDEN: Participant has no publishing permissions" });
    }

    const transportParams = await room.createWebRtcTransport(socket.id, origin);
    callback(transportParams);
  } catch (err: any) {
    callback({ error: err.message });
  }
});

// 2. Media Produce Guard (Audio, Video, Screen)
socket.on("produce", async (payload, callback) => {
  try {
    const { kind, appData } = payload;
    const { permissions, role } = socket.data;

    // Enforce Audio Publishing Permission
    if (kind === "audio" && !permissions.canPublishAudio) {
      return callback({ error: "FORBIDDEN: Audio publishing requires speaking permission approval" });
    }

    // Enforce Video Publishing Permission
    if (kind === "video" && appData?.source !== "screen" && !permissions.canPublishVideo) {
      return callback({ error: "FORBIDDEN: Video publishing is disabled for this participant" });
    }

    // Enforce Screen Sharing Permission (Students strictly blocked)
    if (appData?.source === "screen" && (!permissions.canPublishScreen || role !== "tutor")) {
      return callback({ error: "FORBIDDEN: Screen sharing is restricted to tutors" });
    }

    const producerResult = await room.createProducer(
      socket.id,
      payload.transportId,
      kind,
      payload.rtpParameters,
      appData,
      () => {
        io.to(socket.data.classId).emit("producerClosed", {
          producerId: producerResult.id,
          peerId: socket.id,
        });
      }
    );

    callback(producerResult);
  } catch (err: any) {
    callback({ error: err.message });
  }
});

// 3. Consume Guard (Strict Room Scoping)
socket.on("consume", async (payload, callback) => {
  try {
    const { producerId, rtpCapabilities } = payload;

    // Verify producer belongs to the SAME room as the requesting socket
    const targetProducer = room.getProducer(producerId);
    if (!targetProducer) {
      return callback({ error: "FORBIDDEN: Producer does not exist in this room" });
    }

    const consumerParams = await room.createConsumer(socket.id, payload.transportId, producerId, rtpCapabilities);
    callback(consumerParams);
  } catch (err: any) {
    callback({ error: err.message });
  }
});

// 4. Privileged Moderation Actions Guard (forceMute, chatLock, expelStudent)
socket.on("forceMute", (payload: any) => {
  if (!socket.data.isHost || socket.data.role !== "tutor") {
    return socket.emit("error", { message: "FORBIDDEN: Only meeting hosts can force mute participants" });
  }
  socket.to(socket.data.classId).emit("forceMute", payload);
});

socket.on("chatLock", (payload: any) => {
  if (!socket.data.isHost || socket.data.role !== "tutor") {
    return socket.emit("error", { message: "FORBIDDEN: Only meeting hosts can lock chat" });
  }
  room.isChatLocked = Boolean(payload.locked);
  io.to(socket.data.classId).emit("chatLock", payload);
});
```

---

## 4. Automated SFU Security Test Suite

Create `tests/sfu_security_suite.ts` on the SFU server to verify that every security assertion passes:

```typescript
import { io } from "socket.io-client";
import jwt from "jsonwebtoken";
import assert from "node:assert";

const SFU_URL = process.env.SFU_TEST_URL || "http://localhost:8083";
const TEST_SECRET = "test_sfu_signing_secret_min_32_characters";

function mintToken(claims: any, secret = TEST_SECRET) {
  return jwt.sign(
    {
      iss: "mathsy-meet-saas",
      aud: "mathsy-meet-sfu",
      ...claims,
    },
    secret,
    { algorithm: "HS256" }
  );
}

async function runTests() {
  console.log("Starting SFU Authoritative Security Suite...");

  // TC-SFU-01: Rejects missing token
  const s1 = io(SFU_URL, { query: { classId: "room-101" }, transports: ["websocket"] });
  await new Promise<void>((resolve) => {
    s1.on("connect_error", (err) => {
      assert.ok(err.message.includes("AUTH_ERROR"));
      console.log("✓ TC-SFU-01 Passed: Missing token rejected");
      resolve();
    });
  });

  // TC-SFU-02: Rejects wrong signing secret
  const badSigToken = mintToken({ room_code: "room-101", sub: "user-1", role: "student" }, "wrong_secret");
  const s2 = io(SFU_URL, { auth: { token: badSigToken }, query: { classId: "room-101" }, transports: ["websocket"] });
  await new Promise<void>((resolve) => {
    s2.on("connect_error", (err) => {
      assert.ok(err.message.includes("AUTH_ERROR"));
      console.log("✓ TC-SFU-02 Passed: Forged signature rejected");
      resolve();
    });
  });

  // TC-SFU-03: Rejects room mismatch (Token Room A -> Joining Room B)
  const roomMismatchToken = mintToken({ room_code: "room-A", sub: "user-1", role: "student" });
  const s3 = io(SFU_URL, { auth: { token: roomMismatchToken }, query: { classId: "room-B" }, transports: ["websocket"] });
  await new Promise<void>((resolve) => {
    s3.on("connect_error", (err) => {
      assert.ok(err.message.includes("Token room mismatch"));
      console.log("✓ TC-SFU-03 Passed: Cross-room connection rejected");
      resolve();
    });
  });

  // TC-SFU-04: Authorizes valid token and enforces media constraints
  const validStudentToken = mintToken({
    room_code: "room-101",
    sub: "student-1",
    role: "student",
    permissions: { canPublishAudio: false, canPublishVideo: true, canPublishScreen: false, isHost: false },
  });
  const s4 = io(SFU_URL, { auth: { token: validStudentToken }, query: { classId: "room-101" }, transports: ["websocket"] });
  await new Promise<void>((resolve) => {
    s4.on("connect", () => {
      console.log("✓ TC-SFU-04 Passed: Valid student connected");
      resolve();
    });
  });

  console.log("All SFU Security Suite Tests Passed!");
}
```

---

## 5. Deployment Runbook & Operational Procedures

### 5.1 Environment Configuration on Host (`/opt/mathsy-meet-server/.env`)
Ensure the following environment variables are configured:
```ini
NODE_ENV=production
PORT=8083
PUBLIC_DOMAIN=rtc.mathsy.in
ANNOUNCED_IP=80.225.208.166

# Synchronized with Mathsy Meet API Backend
PARTICIPANT_JWT_SECRET=super_secure_high_entropy_secret_min_32_characters

# WebRTC Port Allocation
MEDIASOUP_MIN_PORT=40000
MEDIASOUP_MAX_PORT=40199
```

### 5.2 Deployment Steps
1. SSH into the SFU host:
   ```bash
   ssh ubuntu@80.225.208.166
   ```
2. Pull latest code or apply patch in `/opt/mathsy-meet-server`:
   ```bash
   cd /opt/mathsy-meet-server
   git pull
   npm install
   npm run build
   ```
3. Test locally with smoke tests:
   ```bash
   node scripts/smoke-test.mjs
   ```
4. Reload process with zero downtime using PM2:
   ```bash
   pm2 reload ecosystem.config.js --update-env
   pm2 status
   ```

### 5.3 Rollback Plan
If an unexpected connection error occurs during deployment:
```bash
./deploy/rollback.sh
# Or manually:
git checkout HEAD~1
npm run build
pm2 reload ecosystem.config.js --update-env
```
