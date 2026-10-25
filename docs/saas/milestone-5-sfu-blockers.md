# Milestone 5: Mediasoup SFU Source Audit & Deployment Blockers

---

## 1. Executive Summary & Stop Notice

In accordance with the mandatory instructions for **Phase A**:
> *"If the SFU source or authorized deployment access is unavailable, STOP implementation. Create `docs/saas/milestone-5-sfu-blockers.md` explaining exactly what source code, repository, access, or deployment information is required. Do not pretend that changes to this React/API repository secure the external server."*

During the Phase A audit:
1. **SFU Source Code Located:** The source code for the standalone mediasoup SFU server was located on the local machine at `/Users/adityachavhan/Documents/Mathsy/mathsy-meet-server`. It is a separate Node.js/TypeScript project outside the `mathsy-meet` workspace.
2. **Authorized Deployment Access Unavailable:** No deployment credentials (SSH private keys, Oracle Cloud API keys, or CI/CD deployment pipelines) are available within this workspace to deploy or restart the running production SFU at `https://rtc.mathsy.in` (`80.225.208.166`).
3. **Confirmed Production Insecurity via Live Probe:** An active WebSocket handshake probe to `https://rtc.mathsy.in` confirmed that the production SFU accepted an unverified token with a forged signature (`${header}.${payload}.sig`).
4. **Action Taken:** Implementation on the production server has been halted. This document outlines the exact architecture, findings, and prerequisites required for deployment.

---

## 2. Source Code Architecture & Current State Audit

### 2.1 Repository Structure
- **Local Path:** `/Users/adityachavhan/Documents/Mathsy/mathsy-meet-server`
- **Application Type:** Standalone Node.js + Express + Socket.IO + Mediasoup SFU v3.
- **Key Modules:**
  - `src/server.ts`: Express HTTP and WebSocket bootstrap, health check (`/healthz`), and RTMP chunk receiver.
  - `src/socket/index.ts`: Socket.IO signaling, authentication middleware (`io.use`), peer attachment, and event routing.
  - `src/auth/index.ts`: Token verification logic (currently configured for legacy Supabase JWKS ES256 and fallback guest tokens).
  - `src/rooms/RoomManager.ts` & `src/rooms/Room.ts`: Mediasoup router creation, WebRTC transport management, producer/consumer pipelines.
  - `src/peers/Peer.ts`: In-memory participant representation.
  - `deploy/`: Deployment scripts (`deploy.sh`, `setup-oracle.sh`, `rollback.sh`).

---

## 3. How Existing Clients Currently Authenticate & Join Rooms

1. **Client Token Generation:**
   - In `mathsy-meet/src/engine/mediasoupClient.ts`, first-party clients construct an unsandboxed pseudo-JWT formatted as `${header}.${payload}.mathsySig` with claims `{ sub: userId, role, name, exp }`.
2. **Handshake Connection:**
   - The client connects to `wss://rtc.mathsy.in/socket.io/` sending `{ auth: { token }, query: { token, classId, name, role, peerIdentity } }`.
3. **Live Probe Findings:**
   - Testing against `https://rtc.mathsy.in`:
     - Providing a malformed string (`invalid_garbage_token`) returned `CONNECT ERROR: Authentication token missing`.
     - Providing a three-part dot-separated token with arbitrary unsigned payload and fake signature `${header}.${payload}.sig` succeeded with **`CONNECTED with makeToken!`**.
   - **Conclusion:** The live server at `rtc.mathsy.in` does not verify cryptographic signatures against a shared secret, does not validate tenant isolation, and does not cross-check client-supplied parameters against backend authorization records.

---

## 4. Socket.IO Handlers & Action Map on the SFU

The signaling server at `src/socket/index.ts` exposes 24 event handlers:

| Handler | Action | Current Authorization Gap |
| :--- | :--- | :--- |
| `getRouterRtpCapabilities` | Returns SFU RTP capabilities | Accessible to any connected socket. |
| `createWebRtcTransport` | Allocates WebRTC send/receive transport | Does not check participant permissions. |
| `connectWebRtcTransport` | Completes DTLS handshake | Transports bound only to socket ID. |
| `produce` | Publishes audio/video/screen tracks | **Does not enforce `canPublishAudio` or `canPublishScreen`.** Any socket can publish media tracks. |
| `consume` | Subscribes to peer media track | Does not verify tenant or room scoping. |
| `forceMute` / `forceMuteAll` | Mutes participants in room | Checks `peer.role === 'tutor'`; role was resolved by first-joiner claim. |
| `chatLock` / `chatPin` | Controls in-meeting chat state | Relies on unverified socket role. |
| `expelStudent` | Disconnects peer | Relies on unverified socket role. |
| `unmuteRequest` | Student request to speak | Forwarded to room without token permission checks. |
| `startRtmpStream` / `rtmpChunk` | Ingests live RTMP stream for YouTube | Requires tutor role claim. |
| `disconnect` | Cleans up transports and producers | Standard cleanup. |

---

## 5. Deployment Blockers & Required Information

To safely deploy Milestone 5 to the actual SFU infrastructure:

### Blocker 1: Production Deployment Credentials
- **Requirement:** SSH access (hostname, username, and private SSH key) to the SFU host at `80.225.208.166` (or `152.67.5.129`).
- **Required Privileges:** Sudo access to reload PM2 (`pm2 reload mathsy-meet-server --update-env`) and inspect logs.

### Blocker 2: Shared Secret Synchronization
- **Requirement:** Both the Mathsy Meet backend (`api.mathsy.in`) and the SFU (`rtc.mathsy.in`) must share the exact same `PARTICIPANT_JWT_SECRET`.
- **Action:** `PARTICIPANT_JWT_SECRET` must be provisioned into `/opt/mathsy-meet-server/.env` on the SFU instance without committing it to git.

### Blocker 3: Staging Environment Isolation
- **Requirement:** A dedicated staging SFU instance (e.g. `stage-rtc.mathsy.in`) is required to run automated media tests with real publishers and subscribers without impacting live first-party classes.

---

## 6. Safe Path Forward

1. Provide the complete server-side code implementation in [docs/saas/milestone-5-sfu-security.md](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/docs/saas/milestone-5-sfu-security.md) so the server administrator can review, test, and apply it directly to `/opt/mathsy-meet-server`.
2. Provide a full automated test suite to run against the SFU locally (`npm run test` or `node scripts/smoke-test.mjs`).
3. Provide a step-by-step deployment and rollback runbook for the system operator.
