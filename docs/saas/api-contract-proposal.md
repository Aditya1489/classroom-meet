# Mathsy Meet SaaS — Public API & SDK Contract Proposal

**Document:** `docs/saas/api-contract-proposal.md`  
**Date:** October 2026  
**Status:** PROPOSED API CONTRACT (Design Only — Not Implemented)

---

## 1. Overview & Conventions

The Mathsy Meet SaaS Public API allows customer backend applications to manage video rooms, generate short-lived participant tokens, subscribe to webhooks, and query usage analytics.

- **Base URL:** `https://api.mathsy.in/v1`
- **Authentication:** `Authorization: Bearer sec_live_...` (or `sec_test_...` for sandbox)
- **Content Type:** `application/json`
- **Idempotency:** Supported on `POST` requests via `Idempotency-Key: <UUID>` header.

---

## 2. Room Management Endpoints

### A. Create Room
`POST /v1/rooms`

#### Proposed Request:
```bash
curl -X POST https://api.mathsy.in/v1/rooms \
  -H "Authorization: Bearer sec_live_9xK2..." \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Calculus 101 - Lecture 4",
    "room_code": "calc-deriv-04",
    "max_participants": 50,
    "features": {
      "whiteboard": true,
      "polls": true,
      "chat": true,
      "screenshare": true,
      "recording": false
    },
    "metadata": {
      "course_id": "math_204",
      "teacher_id": "prof_euler"
    }
  }'
```

#### Proposed Response (201 Created):
```json
{
  "id": "rm_8f3d10a2-4e67-4f81-a98b-21a47b198c21",
  "room_code": "calc-deriv-04",
  "title": "Calculus 101 - Lecture 4",
  "is_active": true,
  "max_participants": 50,
  "features": {
    "whiteboard": true,
    "polls": true,
    "chat": true,
    "screenshare": true,
    "recording": false
  },
  "metadata": {
    "course_id": "math_204",
    "teacher_id": "prof_euler"
  },
  "created_at": "2026-10-25T15:00:00Z",
  "embed_url": "https://meet.mathsy.in/embed/calc-deriv-04"
}
```

---

### B. Retrieve Room
`GET /v1/rooms/:idOrCode`

#### Proposed Response (200 OK):
```json
{
  "id": "rm_8f3d10a2-4e67-4f81-a98b-21a47b198c21",
  "room_code": "calc-deriv-04",
  "title": "Calculus 101 - Lecture 4",
  "is_active": true,
  "active_session": {
    "session_id": "sess_91b2c3-...",
    "started_at": "2026-10-25T15:02:10Z",
    "active_participant_count": 18
  },
  "created_at": "2026-10-25T15:00:00Z"
}
```

---

### C. End Room
`POST /v1/rooms/:idOrCode/end`

Forces all connected participants to disconnect, ends active media producers, and purges temporary session chat.

#### Proposed Response (200 OK):
```json
{
  "success": true,
  "room_code": "calc-deriv-04",
  "session_id": "sess_91b2c3-...",
  "ended_at": "2026-10-25T16:00:00Z",
  "total_duration_minutes": 58,
  "peak_participants": 24
}
```

---

## 3. Participant Token Minting Endpoint

### Issue Participant Token
`POST /v1/rooms/:idOrCode/tokens`

Mints an ephemeral, cryptographically signed JWT for a student or teacher to join an embedded or standalone session.

#### Proposed Request:
```bash
curl -X POST https://api.mathsy.in/v1/rooms/calc-deriv-04/tokens \
  -H "Authorization: Bearer sec_live_9xK2..." \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "student_98214",
    "display_name": "Arjun Sharma",
    "role": "student",
    "ttl_seconds": 7200,
    "permissions": {
      "can_publish_audio": false,
      "can_publish_video": false,
      "can_share_screen": false
    }
  }'
```

#### Proposed Response (200 OK):
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "room_code": "calc-deriv-04",
  "expires_at": "2026-10-25T17:00:00Z",
  "embed_url": "https://meet.mathsy.in/embed/calc-deriv-04?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

## 4. Participant & Attendance Analytics

### List Room Participants
`GET /v1/rooms/:idOrCode/participants?status=active`

#### Proposed Response (200 OK):
```json
{
  "participants": [
    {
      "user_id": "prof_euler",
      "display_name": "Dr. Leonhard Euler",
      "role": "host",
      "is_audio_muted": false,
      "is_video_muted": false,
      "joined_at": "2026-10-25T15:02:10Z"
    },
    {
      "user_id": "student_98214",
      "display_name": "Arjun Sharma",
      "role": "student",
      "is_audio_muted": true,
      "is_video_muted": true,
      "joined_at": "2026-10-25T15:05:42Z"
    }
  ],
  "total_count": 2
}
```

---

## 5. Usage & Metering Endpoints

### Get Monthly Usage
`GET /v1/usage?period=2026-10`

#### Proposed Response (200 OK):
```json
{
  "period": "2026-10",
  "organization_id": "org_8f3d10a2-...",
  "plan": "growth",
  "participant_minutes_used": 14250,
  "participant_minutes_included": 50000,
  "percentage_used": 28.5,
  "peak_concurrent_participants": 84,
  "total_rooms_hosted": 128
}
```

---

## 6. Webhooks Management

### Register Webhook Endpoint
`POST /v1/webhooks`

#### Proposed Request:
```json
{
  "url": "https://api.acmeschool.edu/webhooks/mathsy",
  "events": [
    "room.created",
    "room.ended",
    "participant.joined",
    "participant.left",
    "recording.ready"
  ]
}
```

#### Proposed Response (201 Created):
```json
{
  "id": "wh_77b102-...",
  "url": "https://api.acmeschool.edu/webhooks/mathsy",
  "secret": "whsec_99182a4c10...",
  "events": ["room.created", "room.ended", "participant.joined", "participant.left", "recording.ready"],
  "is_active": true
}
```

---

## 7. TypeScript SDK Interface Proposal (`@mathsy/meet-sdk`)

### Client SDK (Frontend Embed Controller)
```typescript
import { MathsyMeetEmbed } from "@mathsy/meet-sdk/client";

const container = document.getElementById("meeting-container")!;

const meet = new MathsyMeetEmbed({
  container,
  roomCode: "calc-deriv-04",
  token: "eyJhbGciOiJIUzI1NiIsIn...", // Server-minted token
  width: "100%",
  height: "100%",
  theme: "dark",
  ui: {
    showControls: true,
    showChat: true,
    showWhiteboard: true,
  },
});

// Event Listeners
meet.on("ready", () => console.log("Meeting ready"));
meet.on("participant.joined", (p) => console.log("Joined:", p.name));
meet.on("participant.left", (p) => console.log("Left:", p.name));
meet.on("speaking_request", (req) => console.log("Speaking request:", req));

// Control Methods
await meet.join();
await meet.mute();
await meet.unmute(); // Triggers speaking request if student
await meet.leave();
```

### Server SDK (Node.js / Express Backend)
```typescript
import { MathsyMeetServer } from "@mathsy/meet-sdk/server";

const client = new MathsyMeetServer({
  apiKey: process.env.MATHSY_API_KEY!, // sec_live_...
});

// 1. Create a room
const room = await client.rooms.create({
  title: "Physics Lab 1",
  maxParticipants: 30,
});

// 2. Issue student token
const token = await client.tokens.create(room.roomCode, {
  userId: "student_456",
  displayName: "Priya Patel",
  role: "student",
});

console.log("Embed URL:", token.embedUrl);
```
