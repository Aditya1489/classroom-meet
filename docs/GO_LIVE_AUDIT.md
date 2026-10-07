# Go Live on YouTube — Audit & Architecture Review

**Date**: 2026-10-07  
**System**: Mathsy Meet (`classroom-meet`) + Node.js Mediasoup SFU Server (`rtc.mathsy.in`)  
**Scope**: End-to-end security, reliability, protocol integrity, and resource management for the "Go Live on YouTube" feature.

---

## 1. Core Audit Questions

### 1. Socket JWT Verification
* **Frontend Reference**: [`src/engine/mediasoupClient.ts:55-67`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/engine/mediasoupClient.ts#L55-L67), [`src/engine/mediasoupClient.ts:142-146`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/engine/mediasoupClient.ts#L142-L146)
* **Backend Reference**: [`server/mediasoup-server/src/auth/index.ts:16-46`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/src/auth/index.ts#L16-L46), [`server/mediasoup-server/src/socket/index.ts:74-76`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/src/socket/index.ts#L74-L76)
* **Findings**:
  * The client constructs an unsigned synthetic JWT signed with literal `.mathsySig` (`generateClientJwt`).
  * On the backend, `verifySupabaseToken(token)` calls `jwt.verify(cleanToken, config.supabaseJwtSecret, { algorithms: ["HS256"] })`.
  * **However**, if `config.supabaseJwtSecret` is not set or in development, `auth/index.ts:28` falls back to `jwt.decode(cleanToken)`, completely accepting forged tokens with arbitrary `sub` (user IDs) and roles!
  * On the frontend, `mediasoupClient.ts:142-146` catches `connect_error` and masks failures by forcibly setting `this.onConnectionStateChange?.("connected")`, masking server-side auth rejections.
* **Verdict**: **BUG** (Insecure token validation fallback + client masks auth failures).

---

### 2. Authorization of Live Stream Handlers (`startRtmpStream`, `stopRtmpStream`, `rtmpChunk`, `/rtmp-chunk`)
* **Backend Reference**: [`server/mediasoup-server/src/socket/index.ts:515-678`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/src/socket/index.ts#L515-L678), [`server/mediasoup-server/src/server.ts:29-44`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/src/server.ts#L29-L44)
* **Findings**:
  * `socket.on("startRtmpStream", ...)`, `socket.on("rtmpChunk", ...)`, and `socket.on("stopRtmpStream", ...)` do **not** check `socket.data.role === "tutor"` nor verify that `socket.data.baseUserId` is the authorized tutor of `classId`.
  * Any student or guest connected to the socket can start, corrupt, or abort a class's YouTube live stream.
  * The HTTP endpoint `POST /rtmp-chunk` accepts raw binary payloads using only the `x-class-id` header or query parameter without any token, authentication, or session validation.
* **Verdict**: **BUG** (Total absence of role gating or caller verification on RTMP controls).

---

### 3. Destination Ingest Host Validation (`rtmpUrl`)
* **Backend Reference**: [`server/mediasoup-server/src/socket/index.ts:524-532`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/src/socket/index.ts#L524-L532)
* **Findings**:
  * The server only checks if `rtmpUrl` starts with `rtmp://a.rtmp.youtube.com/live2/` to rewrite it to `rtmps://...`.
  * It does not enforce a whitelist of valid YouTube ingest hostnames (`a.rtmp.youtube.com`, `b.rtmp.youtube.com`, `a.rtmps.youtube.com`).
  * An attacker can pass arbitrary destination endpoints (e.g. internal network addresses, SSRF targets, or malicious servers) directly into the child process command line.
* **Verdict**: **BUG** (Unrestricted target URL / parameter injection vulnerability).

---

### 4. FFmpeg Process Lifecycle & Early Chunk Handling
* **Backend Reference**: [`server/mediasoup-server/src/socket/index.ts:540-637`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/src/socket/index.ts#L540-L637)
* **Frontend Reference**: [`src/services/youtubeService.ts:609-611`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/services/youtubeService.ts#L609-L611)
* **Findings**:
  * `spawnFfmpeg` is invoked asynchronously. If an existing process is detected, the server delays spawning by 3 seconds (`setTimeout(() => spawnFfmpeg(rtmpUrl), 3000)`).
  * During this 3-second delay, all incoming chunks sent by the client are immediately discarded with `FFmpeg process inactive for class`.
  * Even during initial spawn, early chunks that arrive before `ffmpeg.stdin` is initialized and writable are dropped because there is no inbound buffer on the server.
  * The frontend waits a naive `setTimeout(r, 1200)` and begins recording without waiting for a server acknowledgement. If the initial WebM initialization segment (header chunk with EBML header & Tracks elements) is dropped, FFmpeg immediately fails with:  
    `Invalid data found when processing input`.
* **Verdict**: **BUG** (No startup handshake ack, no early chunk buffering, dropped EBML header).

---

### 5. HTTP and Socket Chunk Interleaving & Deduplication
* **Frontend Reference**: [`src/services/youtubeService.ts:553-576`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/services/youtubeService.ts#L553-L576)
* **Backend Reference**: [`server/mediasoup-server/src/server.ts:39`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/src/server.ts#L39), [`server/mediasoup-server/src/socket/index.ts:37-45`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/src/socket/index.ts#L37-L45)
* **Findings**:
  * In `flushRtmpQueue()`, the client sends chunks via HTTP `POST /rtmp-chunk`. If the HTTP request is slow or throws a network error, it immediately falls back to emitting `rtmpChunk` over the WebSocket.
  * If the HTTP request actually reached the server in flight, the same chunk is written to `stdin` twice.
  * Neither the client nor server tracks sequence numbers (`seq`). Duplicates and out-of-order deliveries inject corrupted Matroska/WebM clusters into FFmpeg stdin, causing audio/video desync and YouTube stream errors.
* **Verdict**: **BUG** (No sequence tracking, race conditions between HTTP and Socket, WebM corruption).

---

### 6. FFmpeg Command Line Inspection
* **Backend Reference**: [`server/mediasoup-server/src/socket/index.ts:543-577`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/src/socket/index.ts#L543-L577)
* **Active Command**:
  ```bash
  ffmpeg -loglevel info -stats -thread_queue_size 8192 \
    -fflags +genpts+discardcorrupt -avoid_negative_ts make_zero \
    -probesize 512k -analyzeduration 250k -f matroska -i pipe:0 \
    -vf "scale=1280:720:flags=fast_bilinear:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black" \
    -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p \
    -b:v 1800k -maxrate 2200k -bufsize 4400k -r 30 -fps_mode cfr \
    -g 60 -keyint_min 60 -sc_threshold 0 -max_muxing_queue_size 8192 \
    -af "aresample=async=1000:min_hard_comp=0.010000:first_pts=0" \
    -c:a aac -b:a 128k -ar 44100 -ac 2 \
    -f flv [REDACTED_INGEST_URL]
  ```
* **Findings**:
  * Input is piped via `matroska` container from `pipe:0`.
  * Re-encodes VP8 video to H.264 (`libx264`) and Opus audio to AAC (`aac`).
  * Missing `-use_wallclock_as_timestamps 1` on input pipe, causing timestamp instability when chunks fluctuate.
  * Uses `-preset ultrafast` instead of `-preset veryfast` (lower compression efficiency at equivalent bitrates).
  * Video bitrate is constrained to 1800k (below YouTube 720p recommendation of 2500k).
  * Audio is sampled at 44.1 kHz instead of standard 48.0 kHz.
* **Verdict**: **BUG** (Suboptimal encoding parameters, missing wallclock timestamp flags).

---

### 7. stdin Backpressure (`drain`), EPIPE & Process Exit Handling
* **Backend Reference**: [`server/mediasoup-server/src/socket/index.ts:18-46`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/src/socket/index.ts#L18-L46)
* **Findings**:
  * `writeRtmpChunk()` executes `entry.stdin.write(buffer)`. It does **not** check whether `write()` returns `false` (indicating stdin buffer saturation).
  * There is no listener for the `'drain'` event on `stdin`, nor any backpressure signal returned to the client to pause chunk delivery.
  * `stdin` has no error listener (`entry.stdin.on('error', ...)`). An unhandled `EPIPE` when FFmpeg crashes will cause an uncaught stream error.
  * While `ffmpeg.on("close")` removes the process from `rtmpProcesses`, any in-flight chunk received before the close callback runs will crash into broken stdin.
* **Verdict**: **BUG** (Backpressure ignored, potential EPIPE crash, missing drain coordination).

---

### 8. `rtmpStatus` "active" Timing
* **Backend Reference**: [`server/mediasoup-server/src/socket/index.ts:608-610`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/src/socket/index.ts#L608-L610)
* **Frontend Reference**: [`src/services/youtubeService.ts:621-632`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/services/youtubeService.ts#L621-L632)
* **Findings**:
  * The server emits `io.to(targetId).emit("rtmpStatus", { status: "active", classId: targetId })` **immediately** upon `spawn()`, before FFmpeg has read the header, verified streams, or connected to YouTube RTMP!
  * On the client side, `youtubeService.ts` fires `onStatusChange?.("live")` and displays `You are LIVE on YouTube!` toast immediately after calling `recorder.start(1000)`, without waiting for any server or YouTube confirmation!
* **Verdict**: **BUG** (False positive "LIVE" UI before connection is established).

---

### 9. Process Termination & Concurrency Scenarios
* **Backend Reference**: [`server/mediasoup-server/src/socket/index.ts:655-667`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/src/socket/index.ts#L655-L667), [`server/mediasoup-server/src/socket/index.ts:800-806`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/src/socket/index.ts#L800-L806), [`server/mediasoup-server/src/server.ts:140-156`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/src/server.ts#L140-L156)
* **Findings**:
  * **On stop**: Attempts `stdin.end()`, then SIGINT after 1s, then SIGKILL after 2.5s.
  * **On tutor disconnect**: FFmpeg is left running for a **120-second** reconnect grace timer (`tutorReconnectTimers.set(classId)`).
  * **On chunk inactivity**: **MISSING**. If client crashes or pauses without closing socket, FFmpeg runs indefinitely.
  * **On server SIGTERM / SIGINT**: `shutdown()` in `server.ts` closes rooms and worker pools, but does **not** iterate or kill `rtmpProcesses`. All active FFmpeg child processes are orphaned on deploy/restart.
  * **Concurrent sessions per class**: No mutex or state guard; rapid double-clicks trigger overlapping spawns.
* **Verdict**: **BUG / MISSING** (No inactivity watchdog, orphaned processes on SIGTERM, excessive 120s disconnect grace).

---

### 10. Buffer Sizes, Body Limits & CORS Handling
* **Backend Reference**: [`server/mediasoup-server/src/socket/index.ts:48-53`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/src/socket/index.ts#L48-L53), [`server/mediasoup-server/src/server.ts:20-44`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/src/server.ts#L20-L44)
* **Findings**:
  * Socket.IO is initialized without `maxHttpBufferSize`. The default is **1 MB** (`1e6 bytes`). Any large video/audio chunk transmitted via WebSocket that exceeds 1 MB triggers an immediate disconnect.
  * HTTP body limit on `POST /rtmp-chunk` is 50 MB (`express.raw({ limit: "50mb" })`), which is generous.
  * CORS allows `*` on Socket.IO and `origin: true` on Express with preflight handling.
* **Verdict**: **BUG** (`maxHttpBufferSize` defaults to 1 MB instead of required 5 MB).

---

### 11. Secrets Exposure & Committed `.env` Files
* **Frontend Reference**: [`src/services/youtubeService.ts:39-46`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/services/youtubeService.ts#L39-L46), [`.env`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/.env)
* **Backend Reference**: [`server/mediasoup-server/.env`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/.env)
* **Findings**:
  * **CRITICAL**: `src/services/youtubeService.ts` contains hardcoded Google OAuth client credentials:
    * `clientId: "65166613028-i5bb5pai6ob6qjploqtr7r47m2bmha46.apps.googleusercontent.com"`
    * `clientSecret: "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"` (**EXPOSED**)
    * `refreshToken: "1//04EUIyzDUSRUsCgYIARAAGAQSNwF-L9Ir5XnQUPv7DlEP53XXSZcdPr2soYrt695pbfbaKBAJnLrMnn1hlevfCG5VaD4TjHv7_Dw"` (**EXPOSED**)
  * `.env` is tracked in git history in both `classroom-meet` and `mathsycrm-60886267`.
* **Verdict**: **BUG** (Critical security exposure; immediate rotation and git purge required).

---

## 2. Known Frontend Bugs Audit (a through l)

| ID | Issue Description | File & Line References | Verdict & Current State |
| :--- | :--- | :--- | :--- |
| **(a)** | `getGoogleAccessToken()` hardcodes Google OAuth client secret and refresh token in bundle | [`src/services/youtubeService.ts:39-46`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/services/youtubeService.ts#L39-L46) | **BUG (CRITICAL)**: Secret & token compiled into client bundle. |
| **(b)** | Watch links persisted in `localStorage` (`videoUrl`/`liveUrl`) and reused across streams | [`src/utils/youtubeUtils.ts:77-112`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/utils/youtubeUtils.ts#L77-L112), [`RecordingModal.tsx:78-84`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/components/recording/RecordingModal.tsx#L78-L84) | **BUG**: Viewers receive old recorded VOD links or stale broadcast URLs instead of current stream. |
| **(c)** | "LIVE" status and success toast fire before server or YouTube confirmation | [`src/services/youtubeService.ts:621-632`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/services/youtubeService.ts#L621-L632) | **BUG**: `onStatusChange("live")` called immediately on `recorder.start()`. |
| **(d)** | Queue drops oldest chunk at >60; HTTP→socket fallback can send same chunk twice | [`src/services/youtubeService.ts:553-575`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/services/youtubeService.ts#L553-L575), [`src/services/youtubeService.ts:597-599`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/services/youtubeService.ts#L597-L599) | **BUG**: Drops older chunks silently and duplicates chunks on retry, breaking WebM stream parser. |
| **(e)** | Audio mixer built once; muting breaks track, late joiners never added | [`src/services/youtubeService.ts:288-327`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/services/youtubeService.ts#L288-L327) | **BUG**: Static AudioContext initialization with no dynamic re-wiring on participant/track events. |
| **(f)** | `getDisplayMedia` has no resolution or frame-rate limits | [`src/services/youtubeService.ts:373-378`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/services/youtubeService.ts#L373-L378) | **BUG**: Browser captures unconstrained 4K/60fps screens, causing encoder bottlenecks. |
| **(g)** | `MediaRecorder` support checked after server is told to start | [`src/services/youtubeService.ts:507`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/services/youtubeService.ts#L507), [`src/services/youtubeService.ts:520`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/services/youtubeService.ts#L520) | **BUG**: Emits `startRtmpStream` before validating recorder MIME type support. |
| **(h)** | `stopRtmpStream` sent before final chunk; tab close leaves server running | [`src/services/youtubeService.ts:641-654`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/services/youtubeService.ts#L641-L654) | **BUG**: Signals stop before trailing chunks are delivered; no `pagehide` hook. |
| **(i)** | `rtmpStatus` listener never unsubscribed; timeouts not cleared; `AudioContext` never closed | [`src/services/youtubeService.ts:484-495`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/services/youtubeService.ts#L484-L495), [`src/services/youtubeService.ts:499`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/services/youtubeService.ts#L499), [`src/services/youtubeService.ts:640-672`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/services/youtubeService.ts#L640-L672) | **BUG**: Resource and listener leaks upon stream completion. |
| **(j)** | Header Record/Live button visible to students | [`src/components/meet/MeetingRoom.tsx:773-798`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/components/meet/MeetingRoom.tsx#L773-L798) | **BUG**: Button is rendered without checking `isTutor`. |
| **(k)** | Stream key stored in plaintext in `localStorage` and logged to console | [`src/utils/youtubeUtils.ts:124-127`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/utils/youtubeUtils.ts#L124-L127), [`src/services/youtubeService.ts:431`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/services/youtubeService.ts#L431) | **BUG**: Plaintext secret exposure in browser storage and dev tools console. |
| **(l)** | `resolveChannelLiveVideoUrl` poller uses `search.list` every 3s with leaked credentials | [`src/services/youtubeService.ts:102-105`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/services/youtubeService.ts#L102-L105), [`src/services/youtubeService.ts:436-455`](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/services/youtubeService.ts#L436-L455) | **BUG**: Consumes 100 quota units every 3 seconds (2,000 units/min), quickly exhausting the 10,000/day YouTube API quota. |

---

## 3. Prioritized Bug List

1. **P0 (Critical Security & Secrets)**:
   - Leaked OAuth client secret & refresh token hardcoded in `youtubeService.ts`.
   - `.env` committed and tracked in git.
   - Plaintext RTMP stream key storage in `localStorage` and cleartext console logging.
   - Socket accepting unsigned/forged `.mathsySig` tokens.
   - Live stream handlers and HTTP endpoint lacking any role/ownership authorization.
2. **P1 (Pipeline Reliability & Stream Corruption)**:
   - Dropping the EBML header chunk on startup due to race conditions and missing server acks.
   - HTTP/Socket chunk duplication and race conditions corrupting WebM streams.
   - Premature "LIVE" state in UI without server confirmation.
   - Stale watch URLs persisted and served to viewers.
   - Orphaned FFmpeg processes on server restart/SIGTERM and lack of inactivity watchdog.
3. **P2 (Audio/Video & Client Experience)**:
   - Audio mixer fails when mic is toggled or when participants join/leave.
   - Inefficient 100-quota-unit `search.list` polling draining YouTube API quotas.
   - Record/Live button exposed to non-tutors.
   - Missing resolution/framerate constraints on `getDisplayMedia`.
   - Socket buffer drops on chunks >1 MB due to missing `maxHttpBufferSize`.

---

## 4. Implementation Plan

### Phase 1 — Security Hotfix
1. **Remove Client-Side YouTube API Engine & Secrets**:
   - Delete `getGoogleAccessToken()`, `resolveChannelLiveVideoUrl()`, the 3s search poller, direct broadcast creators, and the `cNyhzfzQD4E` fallback.
   - Redact all logging of stream keys, tokens, and ingest URLs.
2. **Strict Socket Authentication**:
   - Require and verify genuine Supabase JWT access token on connection handshake.
   - Reject unsigned or forged tokens.
   - Remove `generateClientJwt` from frontend and pass the Supabase session token.
   - Fix `mediasoupClient.ts` `connect_error` handler so it accurately flags failure.
3. **Server-Side Tutor Authorization**:
   - Add `isClassTutor(userId, classId)` helper checking the authenticated room owner.
   - Authorize all live streaming commands against `isClassTutor`.
   - Gate frontend UI so only verified tutors see Live/Record controls.
4. **Environment Hygiene**:
   - Add `.env` to `.gitignore` in both repos, create clean `.env.example` templates.
   - Provide manual rotation runbook for Google OAuth credentials.

### Phase 2 — Reliable Streaming Pipeline
1. **Standardized Socket.IO Protocol**:
   - Replace old handlers with acked events:
     - `live:start { classId, visibility }` -> ack `{ ok, sessionId, watchUrl, broadcastId }`
     - `live:chunk { sessionId, seq, data: ArrayBuffer }` -> ack `{ ok, seq }`
     - `live:restart { sessionId }` -> ack `{ ok }`
     - `live:stop { sessionId, reason }` -> ack `{ ok }`
     - Server -> Client `live:status { sessionId, state, message?, stats? }`
   - Remove legacy `/rtmp-chunk` HTTP route and old socket events.
2. **Hardened Server Ingestion Engine**:
   - Enforce 1 active session per class with mutex protection.
   - Buffer early chunks until FFmpeg `stdin` is confirmed writable.
   - Enforce sequential writing by `seq` with deduplication.
   - Implement `stdin.write()` backpressure monitoring (`drain` event).
   - Emit `"live"` status only upon receiving real frame output from FFmpeg stderr (`frame=`).
   - Clean shutdown watchdog: terminate on `live:stop`, 10s tutor disconnect grace, 15s chunk inactivity, and SIGTERM/SIGINT.
   - Configure `maxHttpBufferSize: 5e6` (5 MB).
   - Standardize FFmpeg command with wallclock timestamps, `libx264 veryfast`, `aac 48k`.
3. **Frontend `LiveStreamController` Architecture**:
   - State machine: `idle` -> `requesting_capture` -> `starting` -> `live` <-> `reconnecting` -> `stopping` -> `idle`.
   - Preflight checks: `MediaRecorder.isTypeSupported`, connected channel, socket connection.
   - Constrained `getDisplayMedia` capture (720p/30fps).
   - Dynamic `AudioMixer` class with persistent `AudioContext` and `updateSources(localTrack, remoteTracks)`.
   - Strict in-order sequential chunk transmitter with retry and automatic restart triggers.
   - Lifecycle termination tied to button, browser stop sharing, class end, unmount, and `pagehide`.
   - Debug overlay available via `?debugLive=1`.

### Phase 3 — Authenticated YouTube OAuth Pipeline
1. **Google OAuth Authorization Code Flow**:
   - Server-side exchange at `/api/youtube/oauth/callback` with offline access.
   - Encrypt and store refresh tokens in Supabase `tutor_youtube_connections` (AES-256-GCM).
   - Expose authenticated `GET /api/youtube/connection` and `DELETE /api/youtube/connection`.
2. **Quota-Optimized Broadcast Management**:
   - Create and reuse 1 persistent `liveStreams` ingestion resource per tutor.
   - On `live:start`, create `liveBroadcasts` with `enableAutoStart: true`, bind to tutor stream, and return exact watch URL.
3. **Frontend YouTube Experience**:
   - Replace stream key inputs with 1-click "Connect YouTube" / "Disconnect" UI.
   - Provide visibility selector (public/unlisted) and collapsible in-app live preview embed with echo warning.
   - Clean up legacy localStorage stream keys.

---

## 5. Amendments & Technical Discovery (A1 - A7)

### A1. Exact FFmpeg Commands Spawns & Transcoding Verification
* **Live RTMP Forwarding Command**:
  [`server/mediasoup-server/src/socket/index.ts:543-577`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/src/socket/index.ts#L543-L577)
  ```bash
  ffmpeg \
    -loglevel info \
    -stats \
    -thread_queue_size 8192 \
    -fflags +genpts+discardcorrupt \
    -avoid_negative_ts make_zero \
    -probesize 512k \
    -analyzeduration 250k \
    -f matroska \
    -i pipe:0 \
    -vf "scale=1280:720:flags=fast_bilinear:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black" \
    -c:v libx264 \
    -preset ultrafast \
    -tune zerolatency \
    -pix_fmt yuv420p \
    -b:v 1800k \
    -maxrate 2200k \
    -bufsize 4400k \
    -r 30 \
    -fps_mode cfr \
    -g 60 \
    -keyint_min 60 \
    -sc_threshold 0 \
    -max_muxing_queue_size 8192 \
    -af "aresample=async=1000:min_hard_comp=0.010000:first_pts=0" \
    -c:a aac \
    -b:a 128k \
    -ar 44100 \
    -ac 2 \
    -f flv \
    [REDACTED_YOUTUBE_RTMPS_URL]
  ```
* **Post-Class Recording Merge Command**:
  [`server/mediasoup-server/src/recording/merge.ts:110`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/src/recording/merge.ts#L110)
  ```bash
  ffmpeg -y -f concat -safe 0 -i "${listFilePath}" -c copy "${mergedFilePath}"
  ```
* **Analysis**:
  - Live streaming is **NOT** `-c copy`. It performs a full transcode from browser VP8/Opus (Matroska) to H.264 (`libx264`) and AAC (`aac`) in an FLV container sent over RTMPS.
  - `-c copy` is used strictly for offline post-recording file merging.

---

### A2. stdin Backpressure ('drain'), EPIPE & Process Exit Handling
* **Location**: [`server/mediasoup-server/src/socket/index.ts:18-46, 596-606`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/src/socket/index.ts#L18-L46)
* **stdin Backpressure**: **BUG**. Line 37 executes `entry.stdin.write(buffer)`. The boolean return value of `write()` is completely ignored. There is no listener for the `'drain'` event on `entry.stdin`, and no backpressure signal or pause mechanism exists for either the HTTP relay or the socket chunk receiver.
* **EPIPE Handling**: **BUG**. `entry.stdin.on('error', ...)` is NOT attached. While line 37 has a synchronous `try / catch`, Node stream writes emit `'error'` events asynchronously. If FFmpeg terminates abruptly while chunks are arriving, writing to closed stdin triggers an unhandled `EPIPE` error event that risks crashing the Node process.
* **FFmpeg-Exit Handling**: **BUG**. Lines 596-605 attach `ffmpeg.on("close")` and `ffmpeg.on("error")` which delete the entry from `rtmpProcesses` and emit `rtmpStatus: "ended"` or `"error"`. However, because in-flight chunks are not stopped immediately, chunks that arrive between exit initiation and `'close'` emission hit a dying process without graceful drain.

---

### A3. Concurrent Sessions for Same `classId` & Old FFmpeg Process Cleanup
* **Location**: [`server/mediasoup-server/src/socket/index.ts:622-636`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/src/socket/index.ts#L622-L636)
* **Behavior**:
  - When a new `startRtmpStream` request arrives for an existing `targetId`, the server immediately calls `rtmpProcesses.delete(targetId)` and attempts tiered termination:
    1. `existing.stdin.end()` immediately.
    2. `SIGINT` after 500 ms.
    3. `SIGKILL` after 1500 ms.
  - It then executes: `setTimeout(() => spawnFfmpeg(rtmpUrl), 3000)`.
* **Findings**:
  - Two FFmpeg processes cannot stream simultaneously for the same `classId` once the 3s delay elapses.
  - **However**, during that 3000 ms delay, `rtmpProcesses.get(targetId)` is empty. All chunks sent by the client during these 3 seconds are **dropped** by `writeRtmpChunk()`.
  - There is no mutex or lock protecting `startRtmpStream`. If two requests arrive in parallel (such as double-clicking or socket retries), two separate 3s timeout timers are set, causing two conflicting FFmpeg processes to spawn.

---

### A4. CORS Configuration for `/rtmp-chunk`
* **Location**: [`server/mediasoup-server/src/server.ts:20-27`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/src/server.ts#L20-L27)
  ```ts
  app.use(cors({
    origin: true,
    credentials: true,
    allowedHeaders: ["Content-Type", "x-class-id", "Authorization"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
  }));
  app.options("*", cors());
  ```
* **Findings**:
  - **Preflight Handling**: Fully configured via `app.options("*", cors())`.
  - **Origin**: `origin: true` dynamically reflects the `Origin` header of the caller, allowing `mathsy.in`, `localhost`, and Vercel preview URLs.
  - **Allowed Headers**: Includes `Content-Type`, `x-class-id`, and `Authorization`.
  - **Credentials**: `true`.

---

### A5. Supabase JWT Authentication in Production & JWKS vs. HS256 Support
* **Deployment Config Analysis**:
  - [`server/mediasoup-server/deploy.sh:75`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/deploy.sh#L75) validates that `SUPABASE_JWT_SECRET` is defined in production `.env` before PM2 starts.
  - [`server/mediasoup-server/src/config/index.ts:16`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/src/config/index.ts#L16) strictly requires `SUPABASE_JWT_SECRET` if `NODE_ENV === "production"`; missing it causes `process.exit(1)`.
  - [`server/mediasoup-server/ecosystem.config.js:10`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/ecosystem.config.js#L10) launches `dist/server.js` with PM2, loading variables via `dotenv.config()` in `config/index.ts`.
* **Signing Algorithm & JWKS vs. HS256**:
  - The codebase currently verifies tokens using symmetric `HS256` via `config.supabaseJwtSecret` in [`server/mediasoup-server/src/auth/index.ts:36-38`](file:///Users/adityachavhan/Documents/Mathsy/mathsycrm-60886267/server/mediasoup-server/src/auth/index.ts#L36-L38).
  - Modern Supabase projects also support asymmetric signing keys (ES256/RS256) via the JWKS endpoint (`https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`).
  - **Architecture Decision**: The authentication validator will support **dual verification**:
    1. Symmetric `HS256` verification if `SUPABASE_JWT_SECRET` is configured.
    2. Asymmetric `JWKS` verification fetching public keys from `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` if tokens are signed with asymmetric algorithms.

---

### A6. Blast Radius & Client Audit Across Repositories
The Mediasoup server is shared between `mathsycrm-60886267` and `mathsy-meet`. Here is the complete inventory of all connecting clients:

| Client App / Component | File Location | Events Emitted / Listened | Authentication Mechanism | Status & Impact |
| :--- | :--- | :--- | :--- | :--- |
| **Mathsy Meet — Room Engine** | `mathsy-meet/src/engine/mediasoupClient.ts` | Connects socket, produces WebRTC media, handles chat, polls, reactions | Synthetic token: `header.payload.mathsySig` | **Must update**: send genuine Supabase session access token or server guest token. |
| **Mathsy Meet — YouTube Service** | `mathsy-meet/src/services/youtubeService.ts` | `startRtmpStream`, `stopRtmpStream`, `rtmpChunk`, `rtmpStatus`, `/rtmp-chunk` | Relies on Room Engine socket | **Must replace**: Migrate to authenticated `live:*` protocol. |
| **Mathsy CRM — MediasoupProvider** | `mathsycrm-60886267/src/platform/media/MediasoupProvider.ts` | Connects socket, signaling for room media, chat, whiteboard | LiveKit token (`lk-token` Edge function) passed in query | **Must preserve**: Genuine signed token with role metadata. Server auth must continue supporting it. |
| **Mathsy CRM — YouTube Recorder** | `mathsycrm-60886267/src/features/live-classes/components/MediasoupYouTubeRecorder.tsx` | Emits `startRtmpStream`, `stopRtmpStream`, `rtmpChunk`; listens to `rtmpStatus`; POSTs to `/rtmp-chunk` | Relies on CRM MediasoupProvider socket | **CRITICAL BACKWARD COMPATIBILITY**: Server MUST keep legacy events intact for CRM callers. |
| **Mathsy CRM — MediasoupDebug** | `mathsycrm-60886267/src/features/live-classes/pages/MediasoupDebug.tsx` | Diagnostic socket test | Raw socket connection test | Continues working. |

---

### A7. Tracked `.env` Variable Names & Secret Classification
*(Values are excluded per security rules)*

#### 1. `mathsy-meet/.env`
* `VITE_APP_NAME` — Public configuration
* `VITE_SUPABASE_PROJECT_ID` — Public reference
* `VITE_SUPABASE_URL` — Public endpoint
* `VITE_SUPABASE_ANON_KEY` — **Client-Safe Key** (browser anon key, public by design)
* `VITE_MEDIASOUP_SERVER_URL` — Public endpoint
* `VITE_GOOGLE_CLIENT_ID` — Public OAuth identifier
* `VITE_TLDRAW_LICENSE_KEY` — **SECRET** (Commercial third-party license key)

#### 2. `mathsycrm-60886267/.env`
* `VITE_SUPABASE_PROJECT_ID` — Public reference
* `VITE_SUPABASE_PUBLISHABLE_KEY` — Public key
* `VITE_SUPABASE_URL` — Public endpoint
* `VITE_SUPABASE_ANON_KEY` — Public anon key
* `GEMINI_API_KEY` — **SECRET** (Google AI API Key)
* `VITE_GOOGLE_DRIVE_API_KEY` — **SECRET** (Google Cloud API Key)
* `VITE_LIVEKIT_URL` — Public endpoint
* `LIVEKIT_API_KEY` — **SECRET** (LiveKit API Key)
* `LIVEKIT_API_SECRET` — **SECRET** (LiveKit API Secret)
* `VITE_LIVEKIT_API_KEY` — **SECRET** (Leaked in VITE client bundle)
* `VITE_LIVEKIT_API_SECRET` — **SECRET** (Leaked in VITE client bundle)
* `VITE_GOOGLE_CLIENT_ID` — Public OAuth identifier
* `VITE_TLDRAW_LICENSE_KEY` — **SECRET** (Third-party license key)
* `VITE_MEDIASOUP_SERVER_URL` — Public endpoint
* `YOUTUBE_CLIENT_ID` — Public OAuth identifier
* `YOUTUBE_CLIENT_SECRET` — **SECRET** (Google OAuth Client Secret)
* `YOUTUBE_REFRESH_TOKEN` — **SECRET** (Google OAuth Refresh Token)

#### 3. `mathsycrm-60886267/server/mediasoup-server/.env`
* `PORT` — Server config
* `HOST` — Server config
* `NODE_ENV` — Server config
* `MEDIASOUP_LISTEN_IP` — Server network config
* `MEDIASOUP_MIN_PORT` — Port range
* `MEDIASOUP_MAX_PORT` — Port range
* `MEDIASOUP_ENABLE_TCP` — Server config
* `MEDIASOUP_LOG_LEVEL` — Server config
* `SUPABASE_URL` — Server endpoint
* `SUPABASE_ANON_KEY` — Public anon key
* `SUPABASE_SERVICE_ROLE_KEY` — **CRITICAL SECRET** (Bypasses all Supabase RLS)
* `SUPABASE_JWT_SECRET` — **CRITICAL SECRET** (Signs and verifies all user JWTs)
* `MEDIASOUP_ANNOUNCED_IP` — Public IP address

#### 4. `mathsycrm-60886267/python_analyzer/.env`
* `GEMINI_API_KEY` — **SECRET** (Google AI API Key)

---

## 6. Revised Implementation Plan (Incorporating Constraints B1 - B6)

### Git Preparation (Constraint B6)
Before any code changes, create branch `fix/go-live` in both repositories:
- `mathsy-meet`
- `mathsycrm-60886267`

### Phase 1: Security Hotfix & Backward-Compatible Auth
1. **Frontend (`mathsy-meet`) Cleanup**:
   - Delete `getGoogleAccessToken()`, `resolveChannelLiveVideoUrl()`, the 3s search poller, direct broadcast creators, and `cNyhzfzQD4E` hardcoding from `src/services/youtubeService.ts` and `src/components/recording/RecordingModal.tsx`.
   - Remove cleartext logging of stream keys and ingest URLs.
   - Delete `generateClientJwt` from `src/engine/mediasoupClient.ts`.
   - Send genuine Supabase access token for authenticated users; implement `POST /api/guest-token` integration for guests (restricted strictly to student role).
   - Fix `connect_error` in `mediasoupClient.ts` to report connection error rather than masking it.
   - Hide all live-stream and recording controls from students in `MeetingRoom.tsx`.
2. **Backend (`server/mediasoup-server`) Auth Rollout**:
   - Implement dual verification (HS256 secret + JWKS fallback).
   - Add env flag `AUTH_ENFORCE` (defaults to `false`).
   - When `AUTH_ENFORCE=false`: If token verification fails or is missing, log a warning with client identifier and user ID, but permit connection (graceful migration period).
   - Add endpoint `POST /api/guest-token` returning signed guest tokens restricted to `role: "student"`.
   - Implement server authorization helper `isClassTutor(userId, classId)` against room owner registry or Supabase `live_classes.tutor_id`.
   - Protect new `live:*` events: require verified tutor status immediately from day one.
   - **Preserve legacy events** (`startRtmpStream`, `stopRtmpStream`, `rtmpChunk`, `rtmpStatus`, `/rtmp-chunk`) so Mathsy CRM continues functioning without disruption.
3. **Secrets & Git Hygiene**:
   - Untrack `.env` files in both repos (`git rm --cached .env`).
   - Update `.gitignore` and add sanitized `.env.example` templates.
   - Document secrets requiring rotation in `docs/DEPLOY_LIVE_FIX.md`.

### Phase 2: Reliable Streaming Pipeline
1. **Protocol & Engine**:
   - Add acked `live:start`, `live:chunk`, `live:restart`, `live:stop`, and `live:status` events on server.
   - Remove 3-second spawn delay; buffer early chunks until FFmpeg `stdin` is confirmed writable.
   - Buffer and enforce sequential chunk delivery via `seq` numbers with deduplication.
   - Emit `"live"` status only upon receiving real frame output from FFmpeg stderr (`frame=`).
   - Implement `stdin.write()` backpressure monitoring (`drain` event).
   - Set `maxHttpBufferSize` to 5 MB on Socket.IO server.
   - Add 15-second chunk-inactivity watchdog and reduce live-session disconnect grace to 10 seconds.
   - Kill all FFmpeg child processes on server SIGTERM/SIGINT.
   - Standardize FFmpeg transcoding parameters (wallclock timestamps, 720p/30fps, `libx264 veryfast`, `aac 48k`).
2. **Frontend `LiveStreamController`**:
   - Implement deterministic state machine, preflight recorder checks, 720p/30fps constraints, and dynamic `AudioMixer`.

### Phase 3: Authenticated YouTube OAuth Pipeline
1. Server-side OAuth token exchange and encrypted storage.
2. Single persistent ingestion resource per tutor with automated broadcast binding.
3. 1-click connect/disconnect UI with echo warning on preview embed.

### Documentation & Rollout Runbook
- Generate `docs/DEPLOY_LIVE_FIX.md` detailing exact deployment order, environment variable configuration, secret rotation steps, and verification commands.

