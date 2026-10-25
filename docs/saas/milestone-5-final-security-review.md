# Milestone 5: Mediasoup SFU Final Security Review Before Deployment

---

## 1. Executive Summary & Review Scope

Following the implementation of Milestone 5B, a comprehensive security review and code audit was conducted on the standalone Mediasoup SFU codebase located in `/Users/adityachavhan/Documents/Mathsy/mathsy-meet-server`.

This review verified and hardened:
1. **Signing Secret Configuration:** Elimination of all hardcoded fallbacks, fail-closed production checks, strict separation of legacy guest and SaaS participant signing keys, and zero-downtime multi-secret rotation.
2. **Authoritative Claim Schema Validation:** Complete validation of all JWT claims beyond mere cryptographic signature verification, rejecting malformed, incomplete, or privilege-escalated payloads.
3. **Exhaustive Socket Event Audit:** Server-side authorization verification across all 28 registered Socket.IO events, confirming strict tenant, room, role, and transport boundaries.
4. **Security Regression Tests:** Expansion of the automated SFU test suite to 20 comprehensive test cases (`scripts/sfu_token_security.test.mjs`) passing cleanly (20/20 PASS) alongside the main backend test suites.
5. **Production Isolation:** No deployment was performed to `rtc.mathsy.in` (`80.225.208.166`), and production infrastructure remains completely untouched.

---

## 2. Signing-Secret Configuration & Key Management

### 2.1 Elimination of Hardcoded Secret Fallbacks
- In `src/config/index.ts`, `participantJwtSecret` previously defaulted to `process.env.GUEST_TOKEN_SECRET || "mathsy_participant_token_signing_secret_dev_2026_at_least_32_chars"`. This fallback has been completely removed.
- `participantJwtSecret` now evaluates strictly to `process.env.PARTICIPANT_JWT_SECRET || ""`.
- In `src/auth/index.ts`, the legacy fallback string `"dev_guest_secret_change_in_production"` was eliminated from both `createGuestToken` and `verifyGuestToken`. If `GUEST_TOKEN_SECRET` is unset, the server throws an explicit configuration error rather than falling back to an insecure default.

### 2.2 Production Startup Failure on Missing or Weak Configuration
In `src/config/index.ts`, when `NODE_ENV === "production"`, `PARTICIPANT_JWT_SECRET` is now included in the mandatory `requiredEnv` list. Additionally, an entropy check validates that the secret is at least 32 characters in length:
```typescript
if (process.env.NODE_ENV === "production") {
  const requiredEnv = [
    "PORT",
    "NODE_ENV",
    "MEDIASOUP_ANNOUNCED_IP",
    "PUBLIC_DOMAIN",
    "ALLOWED_ORIGINS",
    "SUPABASE_URL",
    "GUEST_TOKEN_SECRET",
    "PARTICIPANT_JWT_SECRET"
  ];
  const missing = requiredEnv.filter(key => !process.env[key]);
  const participantSecret = process.env.PARTICIPANT_JWT_SECRET || "";
  if (participantSecret.length < 32) {
    console.error("CRITICAL STARTUP ERROR: PARTICIPANT_JWT_SECRET must be at least 32 characters long in production.");
    process.exit(1);
  }
  if (missing.length > 0) {
    process.exit(1);
  }
}
```

### 2.3 Strict Separation of Verification Paths
- **SaaS Participant Tokens:** Verified strictly by `verifyParticipantToken()` against `PARTICIPANT_JWT_SECRET`. They never fall back to `GUEST_TOKEN_SECRET`.
- **First-Party Guest Tokens:** Verified strictly by `verifyGuestToken()` against `GUEST_TOKEN_SECRET`.
- **First-Party Authenticated Hosts:** Verified strictly by `verifySupabaseToken()` against Supabase JWKS ES256 (or `SUPABASE_JWT_SECRET`).
- Tokens presented to the wrong verification path are unconditionally rejected.

### 2.4 Tested Zero-Downtime Multi-Secret Rotation
To support seamless rotation of the signing secret between the API backend and SFU without dropping active participants, `verifyParticipantToken` supports a comma-separated list of candidate secrets:
```typescript
export function getParticipantJwtSecrets(): string[] {
  const raw = config.participantJwtSecret || process.env.PARTICIPANT_JWT_SECRET || "";
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length >= 32);
}
```
During rotation:
1. SFU environment is updated with `PARTICIPANT_JWT_SECRET="<NEW_SECRET>,<OLD_SECRET>"`.
2. Backend API issuer is switched to mint tokens with `<NEW_SECRET>`.
3. Existing client tokens minted with `<OLD_SECRET>` continue to verify successfully during their remaining 5-minute lifespan.
4. Once all old tokens have expired, `<OLD_SECRET>` is removed from the SFU environment.
*Verified in TC-SFU-18.*

### 2.5 Secure Secret Synchronization Between API and SFU
1. **Never transmit secrets over unencrypted channels:** Secrets must not be committed to Git, posted in issue trackers, or logged.
2. **Environment injection:** The backend API (`mathsy-meet`) and SFU server (`mathsy-meet-server`) receive their matching secret exclusively via system environment variables (`.env` on their respective hosts or container environment injection).
3. **Rotation synchronization:** Secret rotation must always update the SFU verifier *first* (with both new and old keys), verify receipt, and only then update the backend API issuer.

---

## 3. Authoritative Claim Schema Validation

In `src/auth/participantTokenAuth.ts`, cryptographic signature verification alone is no longer treated as sufficient authorization. Every verified JWT payload is subject to authoritative claim validation before the connection is accepted:

| Claim | Type & Invariants | Rejection Condition |
|---|---|---|
| `sub` | Non-empty `string` | Missing, empty, or whitespace-only string |
| `tenant_id` | Non-empty `string` | Missing, empty, or non-string |
| `room_id` | Non-empty `string` | Missing, empty, or non-string |
| `room_code` | Non-empty `string` | Must match `requestedRoomCode` (case-insensitive) |
| `iss` | String matching `"mathsy-meet-saas"` | Any other issuer |
| `aud` | String matching `"mathsy-meet-sfu"` | Any other audience |
| `iat` | Finite `number` | Non-numeric, or issued in future (`iat > now + 10s`) |
| `exp` | Finite `number` | Non-numeric, `exp <= iat`, or expired (`exp <= now - 10s`) |
| `role` | `"tutor"` or `"student"` | Any other string (e.g. `"admin"`, `"moderator"`) |
| `permissions` | Non-null `object` | Non-object, null, or array |
| `permissions.canPublishAudio` | `boolean` | Must be strictly `typeof boolean` |
| `permissions.canPublishVideo` | `boolean` | Must be strictly `typeof boolean` |
| `permissions.canPublishScreen` | `boolean` | Must be strictly `typeof boolean`. If `role === 'student'`, must be `false` |
| `permissions.canChat` | `boolean` | Must be strictly `typeof boolean` |
| `permissions.isHost` | `boolean` | Must be strictly `typeof boolean`. If `role === 'student'`, must be `false`. If `role === 'tutor'`, must be `true` |

Any payload failing these schema rules is rejected immediately at the Socket.IO handshake with a descriptive rejection reason.

---

## 4. Comprehensive Audit of All Socket.IO Event Handlers

The complete signaling implementation in `src/socket/index.ts` was audited. All 28 registered handlers enforce server-side authorization:

| Event Handler | Scope & Boundaries | Authorization Rule Enforced |
|---|---|---|
| `getRouterRtpCapabilities` | Read-only | Returns router capabilities for the peer's bound room. |
| `createWebRtcTransport` | Connection-bound | Verifies CORS origin; enforces `peer.transports.size < 10` allocation cap. |
| `connectWebRtcTransport` | Peer-owned | Verifies target transport belongs to `peer.transports`. |
| `restartIce` | Peer-owned | Verifies transport ownership before restarting ICE. |
| `produce` | Media Producer | **Audio:** requires tutor or mic speaking approval (`peer.approvedForAudio`).<br>**Video:** requires `canPublishVideo !== false`.<br>**Screen:** requires tutor role; students strictly forbidden. |
| `closeProducer` | Producer-owned | Looks up producer strictly in `peer.producers.get(producerId)`. |
| `consume` | Room-scoped | Verifies target producer exists in peer's bound room (`room.getProducer(producerId)`). |
| `resumeConsumer` | Consumer-owned | Looks up consumer strictly in `peer.consumers.get(consumerId)`. |
| `chat:send` / `chatMessage` | In-Room Collaboration | Enforces `room.isChatLocked` and `peer.permissions.canChat`. Blocks forged control actions (`MIC_RESPONSE`, `FORCE_MUTE`, `CLASS_ENDED`). Authoritatively overwrites `senderName`, `senderId`, `isHost`, and `senderRole` from verified session. |
| `reaction:send` / `reaction` | In-Room Broadcast | Broadcasts reaction to bound room only. |
| `hand:toggle` / `raiseHand` | Peer-bound | Broadcasts hand state bound to `peer.id`. |
| `whiteboard:sync` / `whiteboardDraw` | Collaborative Canvas | Rejects non-tutor draw attempts when `room.letStudentsDraw` is false (`FORBIDDEN: Whiteboard drawing is locked by the tutor`). |
| `whiteboard:toggleDrawing` | Canvas Moderation | Restricted to `peer.role === 'tutor'`. |
| `poll:create` | Interaction Moderation | Restricted to `peer.role === 'tutor'`. Students receive `FORBIDDEN: Only tutors can create polls`. |
| `poll:vote` | Student Interaction | Allows voting on active poll. |
| `pollUpdate` | State Synchronization | Restricts poll structure modification to `peer.role === 'tutor'`. |
| `forceMute` | Audio Moderation | Restricted to `peer.role === 'tutor'`. Closes target student audio producer and clears `approvedForAudio`. |
| `forceMuteAll` | Audio Moderation | Restricted to `peer.role === 'tutor'`. Closes all student audio producers in room. |
| `hand:lower` / `hand:lowerAll` | Queue Moderation | Restricted to `peer.role === 'tutor'`. Non-tutors receive `FORBIDDEN: Only tutors can lower hands`. |
| `chatLock` | Chat Moderation | Restricted to `peer.role === 'tutor'`. Non-tutors receive `FORBIDDEN: Only tutors can lock chat`. |
| `chatPin` | Chat Moderation | Restricted to `peer.role === 'tutor'`. Non-tutors receive `FORBIDDEN: Only tutors can pin messages`. |
| `expelStudent` | Room Moderation | Restricted to `peer.role === 'tutor'`. Adds student ID and user ID to `room.bannedPeers`, closes socket, and broadcasts `peerLeft`. |
| `cameraOffRequest` | Student Permission | Forwarded to room tutor. |
| `cameraOffResponse` | Tutor Decision | Restricted to `peer.role === 'tutor'`. |
| `unmuteRequest` | Mic Permission Flow | `REQUEST` forwarded to tutor; `APPROVE` / `FORCE_MUTE` restricted to `peer.role === 'tutor'`. |
| `startRtmpStream` | Live Streaming | Restricted to `peer.role === 'tutor' && peer.isOwner && !peer.isGuest`. Validates YouTube RTMP URL. |
| `rtmpChunk` | Live Streaming Ingest | Restricted to `peer.role === 'tutor' && peer.isOwner && !peer.isGuest`. |
| `stopRtmpStream` | Live Streaming Control| Restricted to `peer.role === 'tutor' && peer.isOwner && !peer.isGuest`. |
| `disconnect` | Lifecycle Cleanup | 10s grace timeout for tutor live stream; removes peer and broadcasts `peerLeft`. |

---

## 5. Security Regression Test Evidence

### 5.1 Standalone SFU Security Suite (`mathsy-meet-server`)
Command: `npm test` (running `scripts/sfu_token_security.test.mjs`)
Results: **20 / 20 Tests Passed (Clean Exit Code 0)**

```text
============================================================
   MATHSY MEET SFU AUTHORITATIVE SECURITY SUITE
   Target Local Server: http://localhost:8098
============================================================

[Setup] Spawning local test SFU server on port 8098...
✓ Local test SFU is healthy and active.

[TC-SFU-01] Testing rejection of missing token... PASS (Rejected with AUTH_ERROR)
[TC-SFU-02] Testing rejection of malformed token structure... PASS (Rejected with Malformed JWT)
[TC-SFU-03] Testing rejection of forged signature (wrong secret)... PASS (Rejected with Invalid Signature)
[TC-SFU-04] Testing rejection of expired token... PASS (Rejected with Token Expired)
[TC-SFU-05] Testing rejection of wrong audience/issuer... PASS (Rejected with Invalid Audience)
[TC-SFU-06] Testing room binding enforcement (Room Alpha token -> Room Beta join)... PASS (Rejected with Room Mismatch)
[TC-SFU-07] Testing rejection of forged student privilege elevation... PASS (Rejected with Forged Privilege)
[TC-SFU-08] Testing authorized Tutor connection and roomJoined payload... PASS (Authorized Tutor Connected as Host)
[TC-SFU-09] Testing authorized Student connection... PASS (Authorized Student Connected strictly as Student)
[TC-SFU-10] Testing audio publishing restriction before speaking approval... PASS (Student Audio Rejected before approval)
[TC-SFU-11] Testing screen sharing restriction for student... PASS (Student Screen Sharing Strictly Blocked)
[TC-SFU-12] Testing student moderation attempt rejection (forceMute)... PASS (Student Moderation Blocked)
[TC-SFU-13] Testing tutor speaking approval unlocking student audio... PASS (Student successfully produced audio after Tutor approval)
[TC-SFU-14] Testing peer disconnect cleanup and peerLeft broadcast... PASS (Peer disconnect cleaned up and broadcast to room)
[TC-SFU-15] Testing backward compatibility with genuine guest token... PASS (First-party guest token authenticated and bounded)
[TC-SFU-16] Testing missing and weak signing-secret fail-safe behavior... PASS (Missing & weak configurations fail safely, no silent fallback)
[TC-SFU-17] Testing complete claim schema validation (incomplete / malformed claims)... PASS (All malformed and incomplete claim schemas rejected)
[TC-SFU-18] Testing zero-downtime secret rotation (multi-key verification)... PASS (Seamless multi-key rotation verified: old and new keys accept, untrusted rejects)
[TC-SFU-19] Testing unauthorized sensitive operations across socket handlers... PASS (Poll, whiteboard, chatLock, chatPin, expel, and RTMP stream strictly blocked for students)
[TC-SFU-20] Testing strict isolation between SaaS and Guest verification paths... PASS (Guest and SaaS authentication paths are completely segregated)

============================================================
   ALL 20 SFU SECURITY SUITE TESTS PASSED CLEANLY!
============================================================
```

### 5.2 Main Backend Regression Test Suites (`mathsy-meet`)
- `tests/v1_room_api_and_tokens.test.ts`: **14 / 14 Passed** (160ms)
- `tests/api_key_engine.test.ts`: **11 / 11 Passed** (174ms)
- `tests/room_authorization.test.ts`: **10 / 10 Passed** (71ms)
- `tests/student_mic_state_machine.test.ts`: **16 / 16 Passed** (5ms)
- `tests/chat_backend_persistence.test.ts`: **10 / 10 Passed** (136ms)
- TypeScript build (`tsc && vite build`): **0 errors** (9.40s)

---

## 6. Remaining Risks & Pre-Deployment Review

1. **Production Secret Synchronization:**
   - Prior to deployment, `PARTICIPANT_JWT_SECRET` must be set in `/opt/mathsy-meet-server/.env` on the host `80.225.208.166` before restarting the SFU server.
   - It must match the secret configured in the Mathsy Meet API environment.
2. **First-Party Legacy Classroom Transition:**
   - Existing first-party users connecting via Supabase user tokens and guest tokens continue to be authenticated via their existing verified paths.
   - Active calls at the exact moment of PM2 reload will experience a standard signaling reconnect; Mediasoup ICE restart will maintain the WebRTC session.
3. **Strict Client Screen-Sharing Prohibition:**
   - Any customized customer frontend that attempts to produce a screen share stream for a participant with `role: "student"` will receive a server-side `FORBIDDEN` error.

---

## 7. Manual Production Deployment Runbook (For Administrator)

> [!IMPORTANT]
> The following steps are documented for administrative execution. Do not execute them automatically. Wait for explicit owner approval before deployment.

### Step 1: Prepare Host Environment
SSH into the production SFU host:
```bash
ssh ubuntu@80.225.208.166
```
Edit `/opt/mathsy-meet-server/.env` and ensure `PARTICIPANT_JWT_SECRET` is configured with a high-entropy secret (>= 32 chars):
```bash
nano /opt/mathsy-meet-server/.env
# Add or update:
# PARTICIPANT_JWT_SECRET=<matching_backend_secret_at_least_32_chars>
```

### Step 2: Update SFU Codebase on Host
```bash
cd /opt/mathsy-meet-server
git pull origin main
npm install
npm run build
npm test
```
Confirm all 20 security tests pass in the local test run on the host.

### Step 3: Zero-Downtime Service Reload
```bash
pm2 reload ecosystem.config.js --update-env
pm2 status
pm2 logs mathsy-meet-server --lines 50
```

### Step 4: Verification of Fix on Production
Probe `https://rtc.mathsy.in` with a forged token and confirm handshake rejection:
```bash
curl -i "https://rtc.mathsy.in/healthz"
```
Verify that an unauthenticated or forged Socket.IO connection receives `AUTH_ERROR`.

### Step 5: Rollback Procedure (If Needed)
```bash
cd /opt/mathsy-meet-server
git checkout HEAD~1
npm run build
pm2 reload ecosystem.config.js --update-env
```

---

## 8. Final Status

- **SFU Repository:** `/Users/adityachavhan/Documents/Mathsy/mathsy-meet-server`
- **Main Backend Repository:** `/Users/adityachavhan/Documents/Mathsy/mathsy-meet`
- **Code Audit & Hardening:** **100% COMPLETE**
- **Automated Tests:** **20 / 20 PASS (SFU)**, **61 / 61 PASS (Main API)**
- **Production State:** **UNCHANGED (Awaiting Administrator Approval)**
