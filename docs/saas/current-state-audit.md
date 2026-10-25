# Mathsy Meet — Current State Architecture & Technical Baseline Audit

**Document:** `docs/saas/current-state-audit.md`  
**Date:** October 2026  
**Auditor:** SRE & WebRTC Performance Architecture Team  
**Status:** Complete Architectural Baseline

---

## 1. Executive Summary

Mathsy Meet is currently deployed as a single-tenant, education-focused virtual classroom platform. This document establishes the exact, verified technical baseline of the codebase across frontend, backend, database, signaling, and WebRTC media layers before undertaking any SaaS multi-tenant migration.

---

## 2. Frontend Framework & Routing

- **Framework:** React 18.3.1 with TypeScript 5.8.3, bundled via Vite 5.4.19 (`@vitejs/plugin-react`).
- **Styling:** Tailwind CSS 3.4.17 with `tailwindcss-animate`, Lucide React icons, and Radix UI primitives.
- **Canvas/Whiteboard:** TLDraw 5.0.1 integrated with custom math tools (ruler, protractor, compass, set square) in [src/components/whiteboard/Whiteboard.tsx](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/components/whiteboard/Whiteboard.tsx).
- **Client Routing Architecture:** Single-Page Application (SPA) driven by state and URL inspection in [src/App.tsx](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/App.tsx):
  - Path `/` $\to$ `<LandingView />` (Create meeting, join meeting by code, Google sign-in).
  - Path `/meet/:roomCode` $\to$ `<LobbyView />` (Media pre-join test, audio/video toggles, display name confirmation) followed by `<MeetingRoom />`.
  - Session Persistence: `sessionStorage.getItem('mathsy_active_meet_' + roomCode)` prevents accidental disconnects on page reload.
- **Media Engine:** [src/engine/mediasoupClient.ts](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/engine/mediasoupClient.ts) using `mediasoup-client` 3.21.0 and `socket.io-client` 4.8.3.

---

## 3. Backend Architecture & API Routes

- **Runtime:** Node.js with Express 5.3.0 in [server/index.ts](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/server/index.ts).
- **Port:** Local port 5001 (`process.env.PORT || 5001`).
- **Middleware:** `cors()` with origin reflection, `express.json({ limit: "25mb" })`.
- **API Surface:**
  - `GET /api/health`: Health status, PostgreSQL uptime, and MongoDB connectivity status.
  - `POST /api/auth/google`: Cryptographic verification of Google ID/Access tokens via `google-auth-library`. Generates 7-day HMAC-SHA256 JWT.
  - `POST /api/auth/guest`: **Explicitly disabled (403 Forbidden)** to enforce verified identity.
  - `GET /api/auth/me`: Profile retrieval via Bearer JWT.
  - `PATCH /api/auth/role`: Toggles active role between `tutor` and `student`.
  - `GET /api/rooms/:roomCode`: Room metadata and status check.
  - `POST /api/rooms`: Tutors-only room creation/upsert. Enforces room ownership.
  - `POST /api/rooms/:roomCode/participants`: Attendance record. Derives user ID and role server-side. Deduplicates prior active records (`left_at = NOW()`).
  - `GET /api/rooms/:roomCode/participants`: List active attendees (`left_at IS NULL`).
  - `POST /api/rooms/:roomCode/leave`: Marks participant departure timestamp.
  - `POST /api/rooms/:roomCode/end`: Room owner only. Marks room inactive, closes participant records, and purges temporary MongoDB chat.
  - `GET /api/rooms/:roomCode/chat`: Retrieves active session messages from MongoDB.
  - `POST /api/rooms/:roomCode/chat`: Persists temporary chat message. Enforces chat lock (423), rate limits (429), and max length 2000 (400).
  - `GET /api/rooms/:roomCode/polls` & `POST /api/rooms/:roomCode/polls`: Poll creation.
  - `POST /api/polls/:pollId/vote`: Deduplicated poll voting.
  - `GET /api/rooms/:roomCode/whiteboard` & `PUT /api/rooms/:roomCode/whiteboard`: TLDraw snapshot persistence in PostgreSQL.
  - `POST /api/tablet/pair`, `/status`, `/unpair`: Companion math drawing tablet pairing.

---

## 4. Authentication & Security Middleware

- **Mechanism:** Bearer JSON Web Tokens signed with `JWT_SECRET` (`HS256`, 7-day expiry).
- **Implementation:** [server/routes/auth.ts](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/server/routes/auth.ts):
  - `requireAuth`: Strict guard. Rejects missing/invalid tokens with 401. Validates UUID against PostgreSQL `users` table and checks `is_active`.
  - `authMiddleware`: Lenient guard for optional user context.
- **Trustworthy Role Verification:**
  - Client-supplied `role: "tutor"` or `isHost: true` parameter in request bodies confer **zero privileges**.
  - Host authorization is determined exclusively by verifying `user.id === live_classes.tutor_id`.

---

## 5. PostgreSQL Schema & Access Patterns

- **Driver:** `pg` 8.23.1 connection pool (`max: 20`, `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 5000`).
- **Initialization:** [server/db/index.ts](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/server/db/index.ts) applies [server/db/schema.sql](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/server/db/schema.sql) and migrations in `server/db/migrations/`.
- **Existing Tables:**
  1. `users`: UUID primary key, Google provider ID, email, role (`tutor`, `student`, `admin`).
  2. `refresh_tokens`: Token hashes for persistent sessions.
  3. `live_classes`: Unique `room_code` (e.g., `ptq-rtvq-rox`), `tutor_id`, `is_active`, `metadata JSONB`.
  4. `room_participants`: `room_code`, `user_id`, `display_name`, `role`, `camera_allowed`, `joined_at`, `left_at`.
  5. `chat_messages`: Legacy SQL chat table (active chat is stored in MongoDB).
  6. `polls`, `poll_options`, `poll_votes`: In-meeting interactive questions.
  7. `whiteboard_snapshots`: JSONB snapshot of TLDraw shapes per room.
  8. `tutor_youtube_connections`: Encrypted OAuth tokens for YouTube live stream forwarding.
  9. `tablet_pairings`: 9-character code for mobile drawing tablet accompaniment.

---

## 6. MongoDB Ephemeral Storage & Lifecycle

- **Driver:** `mongodb` 7.7.0 client with connection pooling (`minPoolSize: 5`, `maxPoolSize: 20`).
- **Database:** `mathsy_meet_chat` in [server/db/mongo.ts](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/server/db/mongo.ts).
- **Collections:**
  1. `chat_messages`: Stored with `sessionId`, `roomCode`, `senderId`, `senderRole`, `isHost`, `text`, `createdAt`, `clientMessageId`, `expireAt`.
  2. `class_sessions`: Tracks `sessionId`, `roomCode`, `tutorId`, `status`, `isChatLocked`, `pinnedMessage`.
- **Compound Indexes:**
  - `{ sessionId: 1, createdAt: 1, _id: 1 }`: Fast chronological retrieval.
  - `{ sessionId: 1, clientMessageId: 1 }`: Idempotent deduplication of retried messages.
  - `{ expireAt: 1 }` TTL index: 24-hour fallback deletion for abandoned rooms.
- **Authoritative Purge:** When a room owner calls `POST /api/rooms/:roomCode/end`, `chatCol.deleteMany({ sessionId })` purges all temporary messages immediately.

---

## 7. Mediasoup SFU & Socket.IO Signaling (External)

- **Signaling Endpoint:** `https://rtc.mathsy.in` (WebSocket connection with query params `token`, `classId`, `name`, `role`, `peerIdentity`).
- **Server Deployment:** Hosted externally on Ubuntu Linux (`80.225.208.166`). **The signaling server source code is not located within this repository.**
- **Transports & Media Negotiation:**
  - SFU returns `routerRtpCapabilities` on `roomJoined`.
  - Client creates `WebRtcTransport` for sending (ICE Lite on UDP port range 10000–20000).
  - Client creates `WebRtcTransport` for receiving.
  - IP Rewriting: Client-side [mediasoupClient.ts:44](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/engine/mediasoupClient.ts#L44) detects private IP candidates (e.g. `10.0.1.132`) and rewrites them to public IP `80.225.208.166`.
  - Codecs: VP8 video (clockRate 90000), Opus audio (clockRate 48000).
- **Speaking Request Protocol:**
  - Student emits `unmuteRequest` and `chatMessage` (`REQUEST_MIC`).
  - Tutor receives single debounced event in queue.
  - Tutor emits `chatMessage` (`MIC_RESPONSE`, `approved: true/false`).
  - Student receives targeted approval and enables mic. Student muting revokes permission immediately.

---

## 8. Baseline Build and Test Status

| Test Suite / Command | Scope | Result | Execution Time |
|---|---|---|---|
| `npm run build` | TypeScript + Vite production bundle | **PASS** (0 errors) | 9.75s |
| `tests/room_authorization.test.ts` | Room creation, join RBAC, end room | **PASS** (10/10) | 77.3ms |
| `tests/student_mic_state_machine.test.ts`| Speaking approval, mute, force mute | **PASS** (16/16) | 2.3ms |
| `tests/secure_auth.test.ts` | Google auth verification, token checks | **PASS** (9/9) | 221.0ms |
| `tests/chat_backend_persistence.test.ts` | MongoDB chat, dedup, lock, purge | **PASS** (10/10) | 263.9ms |
| `tests/real_signaling_lifecycle.test.ts` | Real Socket.IO signaling on SFU | **PASS** (8/8) | 5.21s |
| `tests/real_webrtc_consumer_probe.ts` | Real WebRTC Video Producer & Consumer | **PASS** (Verified VP8 Consumer) | 8.12s |

---

## 9. Current Limitations & Blockers for Commercial Multi-Tenancy

1. **No Tenant Hierarchy:** All database entities (`users`, `live_classes`, `room_participants`, `polls`) exist in a flat, global namespace with zero organization or customer tenancy scoping.
2. **Hardcoded First-Party Identity:** Authentication is coupled to Google OAuth and consumer email sign-in. There is no B2B customer API key system (`sec_live_...`) or server-to-server token minting.
3. **No Embed Integration Layer:** The meeting view cannot be embedded safely in third-party iframes without risking clickjacking and CSP restrictions. No `postMessage` SDK protocol exists.
4. **External SFU Authorization Gap:** The external signaling server at `rtc.mathsy.in` accepts connections without cross-referencing room membership or tenant boundaries with the PostgreSQL backend.
5. **Zero Usage Metering:** There is no tracking of participant-minutes, peak concurrency, or billable WebRTC usage.
