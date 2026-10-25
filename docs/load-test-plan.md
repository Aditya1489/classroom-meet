# Mathsy Meet — Architecture, Risk Audit & 100-User Load Test Plan

## 1. System Architecture Overview

Mathsy Meet is a real-time collaborative classroom platform designed for STEM education. It is divided into three operational planes:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             CLIENT BROWSER LAYER                            │
│  React 18 + Vite SPA, TypeScript, Tailwind CSS, TLDraw Infinite Canvas      │
│  - Media Engine: src/engine/mediasoupClient.ts (mediasoup-client v3)        │
│  - REST API Client: src/lib/dbClient.ts                                     │
│  - UI Orchestration: src/components/meet/MeetingRoom.tsx                    │
└───────────────────────┬───────────────────────────────┬─────────────────────┘
                        │                               │
         HTTPS / REST API Requests               WSS Socket.IO & WebRTC (ICE/DTLS)
                        │                               │
                        ▼                               ▼
┌──────────────────────────────────────┐  ┌───────────────────────────────────┐
│     BACKEND API APPLICATION LAYER    │  │       MEDIASOUP SFU SIGNALING     │
│   Node.js + Express (Port 5001)      │  │        & MEDIA ROUTER LAYER       │
│                                      │  │       (rtc.mathsy.in / SFU)       │
│ - server/routes/auth.ts (JWT Auth)   │  │                                   │
│ - server/routes/rooms.ts (Rooms/Att) │  │ - Socket.IO Signaling Server      │
│ - server/routes/chat.ts (Temp Chat)  │  │ - Mediasoup C++ Media Workers     │
│ - server/routes/whiteboard.ts (W/B)  │  │ - WebRtcTransports (Send & Recv)  │
│ - server/routes/polls.ts (Polls)     │  │ - Producers & Consumers           │
│ - server/routes/tablet.ts (Pairing)  │  │ - Audio/Video Routing Pipeline    │
└──────────────┬────────────────┬──────┘  └─────────────────┬─────────────────┘
               │                │                           │
        SQL Queries        Mongo BSON                 WebRTC UDP
               │                │                           │
               ▼                ▼                           ▼
┌──────────────────────┐ ┌─────────────┐  ┌───────────────────────────────────┐
│     PostgreSQL       │ │   MongoDB   │  │     CLIENT MEDIA RECEIVER         │
│ Database: mathsy_meet│ │ (Ephemeral) │  │  - Remote Audio Sinks             │
│ - users              │ │             │  │  - Video Track Players            │
│ - live_classes       │ │chat_messages│  │  - Screen Presentation Stream     │
│ - room_participants  │ │(Per-session)│  └───────────────────────────────────┘
│ - polls & poll_votes │ └─────────────┘
└──────────────────────┘
```

### Component Breakdown
1. **Frontend (`src/`):**
   - **`MeetingRoom.tsx`**: Central orchestrator for meeting lifecycle, state machines, layout modes (Grid, Spotlight, Whiteboard, Screenshare), and persistent audio sinks.
   - **`mediasoupClient.ts`**: WebRTC client handling device capabilities, send/receive transports, audio/video/screen producers, consumer negotiation, and signaling events.
   - **`Whiteboard.tsx`**: TLDraw interactive math canvas with geometry tools (ruler, protractor, compass, set square).
   - **`ClassFeedSidepanel.tsx`**: Real-time sidepanel handling live chat, poll launch/voting, and participant lists.
   - **`dbClient.ts`**: HTTP client connecting to backend API.

2. **Backend Services (`server/`):**
   - **PostgreSQL**: Manages durable records (users, active classrooms, attendance history, persistent polls).
   - **MongoDB (Ephemeral)**: Manages temporary in-class chat messages that are automatically wiped when a class session ends.
   - **Express REST Endpoints**: Strict JWT authentication (`requireAuth`) validating user identity, room ownership, and attendance.

3. **Media & Signaling Server (`rtc.mathsy.in`):**
   - External SFU (Selective Forwarding Unit) orchestrating WebRTC RTP media and Socket.IO signaling.
   - Handles room joining (`roomJoined`), transport negotiation (`createWebRtcTransport`, `connectWebRtcTransport`), media publishing (`produce`), and media consumption (`consume`, `resumeConsumer`).

---

## 2. Risk Audit & Potential Bottlenecks

### A. WebRTC Media Stream Fan-Out Explosion
In a classroom of $N$ participants:
- **Audio Fan-Out**: When $M$ participants speak simultaneously, total consumer audio streams $= M \times (N - 1)$.
- **Video Fan-Out**:
  - In Full Mesh (P2P), bandwidth scales as $O(N^2)$, which collapses past 5-6 users.
  - In Mediasoup SFU, publishers send 1 stream to the SFU ($O(1)$ upstream). However, downstream bandwidth scales as $K \times (N - 1)$ where $K$ is the number of active video publishers.
  - **Tutor Presentation Model (1 Tutor Video + 1 Screen Share + 100 Students)**:
    - Ingest: 2 streams (Tutor camera + Tutor screen).
    - Egress: 2 streams $\times$ 100 students = 200 consumer media tracks.
  - **All-Camera Mode (100 Students + 1 Tutor with Cameras On)**:
    - Ingest: 101 video streams.
    - Egress: $101 \times 100 = 10,100$ video tracks!
    - **Bottleneck**: No single SFU worker or consumer browser can decode 100 incoming video streams simultaneously.
    - **Mitigation Needed**: Strict tiered layout (Spotlight active speaker, thumbnail simulcast, disable off-screen video consumers).

### B. Signaling Channel Storms
- **Stampede on Join**: When 100 students join within 3 seconds, Socket.IO emits 100 `peerJoined` events to all connected clients $\to \sum_{i=1}^{100} (i-1) = 4,950$ broadcast payloads!
- **Mitigation Needed**: Debounce peer list updates, batch participant state, and rate-limit join bursts.

### C. Database Connection Pool Exhaustion
- PostgreSQL pool default `max: 20`. If 100 participants concurrently hit `POST /api/rooms/:roomCode/participants` on join, connection queues may timeout if queries block.
- **Mitigation Needed**: Fast parameterized queries, indexes on `room_participants(room_code, user_id, left_at)`, and pool queue monitoring.

### D. Audio Concurrency & Hardware Collisions
- Browsers enforce autoplay policies and single-stream hardware locks on microphones.
- Multi-event signaling can trigger racing `getUserMedia` calls.
- **Mitigation**: Client mutex lock (`isEnablingAudio`) and deduplication set (`processedControlIds`) implemented in `mediasoupClient.ts`.

---

## 3. Test Environments & Critical Safety Boundaries

1. **Local Safe Testing Environment:**
   - Backend API: `http://localhost:5001` (Node.js/Express, local PostgreSQL, local MongoDB).
   - Frontend: `http://localhost:5174` (Vite dev server).
   - Test Rooms: Synthetic UUID prefixes (`load-test-room-*`, `bench-*`).
   - Test Accounts: Synthetic mock credentials with valid signed test JWT tokens.
2. **External SFU Safety Policy:**
   - **CRITICAL:** High-volume 100-user load tests MUST NOT be directed against production `rtc.mathsy.in` without explicit infrastructure isolation.
   - Load tests are conducted using local synthetic mock signaling clients and controlled staged socket connections.

---

## 4. Test Suite Matrix

| Test Suite | Target Component | Concurrency | Success Metric |
|---|---|---|---|
| **Suite A: Functional Lifecycle** | REST API & DB Attendance | 1–10 Users | 100% Pass, 0 Error |
| **Suite B: Mic State Machine** | Permission, Approval, Force Mute | 1–5 Users | 100% Pass, 0 Leaks |
| **Suite C: 100-User Join Stampede** | REST API + DB Pool | 100 Virtual Users | $\ge 99\%$ Joins, p95 $< 300\text{ms}$ |
| **Suite D: 100-User Mic Request Queue** | Signaling Request Pipeline | 100 Virtual Users | 0 Dropped, 0 Cross-room leak |
| **Suite E: Chat & Poll Concurrent Stress**| MongoDB + Express Router | 100 Virtual Users | 100% Message delivery, 0 Dups |
| **Suite F: Fault Injection & Reconnect** | Socket & Network drop/reconnect | 25 Users Churn | Clean teardown, 0 Ghost peers |
| **Suite G: Real-Media Capacity Model** | WebRTC SFU Fan-out Math | Simulated 100 Users | Documented resource limits |

---

## 5. Execution & Abort Mechanism
All load tests must incorporate:
- Strict execution timeouts (e.g. 30 seconds max per test).
- Immediate abort trigger upon error rate exceeding 5%.
- Graceful session cleanup in `afterEach` / `finally` blocks to leave zero orphaned database or socket records.

---

## 6. Real Socket.IO Signaling Test Execution & Verification

Automated in `tests/real_signaling_lifecycle.test.ts` against `https://rtc.mathsy.in` with isolated synthetic rooms:

- **TC-SIG-01 (Room Joining):** Tutor joins Room A, receives `roomJoined` with Mediasoup `routerRtpCapabilities` in **141.5ms**.
- **TC-SIG-02 (Peer Updates):** Student 1 connects, Tutor receives `peerJoined` with correct identity in **1345.0ms**.
- **TC-SIG-03 (Multi-Peer Tracking):** Student 2 connects, peers tracked with zero state divergence.
- **TC-SIG-04 (Speaking Request):** Student 1 emits speaking request; delivered to Tutor in **27.1ms**.
- **TC-SIG-05 (Targeted Approval):** Tutor approves Student 1; Student 1 receives `approved: true` in **21.5ms**; Student 2 receives zero approvals.
- **TC-SIG-06 (Targeted Rejection):** Tutor rejects Student 2; Student 2 receives `approved: false` in **25.5ms**.
- **TC-SIG-07 (Disconnect Broadcast):** Student 2 disconnects; Tutor receives `peerLeft` in **23.1ms**.
- **TC-SIG-08 (Room Isolation):** Events emitted in Room A leak zero data to Room B (verified over 2023.9ms quiet window).

---

## 7. Real WebRTC Mediasoup Media Probe & Verification

Empirically verified in `tests/real_webrtc_consumer_probe.ts` and automated browser session:

1. **Browser Video Publishing:**
   - Synthetic 30fps canvas video stream injected into `MeetingRoom.tsx`.
   - Mediasoup Send Transport created (`c15d588a-...`, ICE Lite, UDP port 16312).
   - DTLS handshake completed (`state: connected`).
   - Video Producer created: `2062a922-5eda-47ac-ae02-a482ab6dda2b` (VP8, 90kHz clockRate, SSRC 104919831).
2. **Student WebRTC Stream Consumption:**
   - Student subscriber joined room `test-media-101`.
   - Received `activeProducers` notification from SFU.
   - Created Recv Transport (`d7c18803-...`, UDP port 19756).
   - Called `consume` on SFU: Server returned Consumer `9b414d88-bec2-4681-8de5-7bad810e55a3` with matching VP8 parameters.
3. **Limitation & Capacity Boundary:**
   - 100 concurrent WebRTC video decoders cannot be safely spawned on a single development machine without hardware exhaustion.
   - 100-publisher media testing on `rtc.mathsy.in` is deferred pending staging infrastructure allocation, as mandated by Critical Safety Rule 1.

