# Milestone 4: Versioned Tenant-Scoped Room API Specification

---

## 1. Overview & Security Invariants

The Versioned B2B Room API (`/api/v1/rooms` and `/v1/rooms`) enables external customer backends to programmatically provision, inspect, terminate, and mint participant tokens for video-conferencing rooms.

### Non-Negotiable Security Invariants
1. **Zero Client Trust:** Organization identity is derived exclusively from the verified server-side API key (`req.organization`). Any client-supplied `organization_id`, `tenantId`, or slug in URL params or JSON body is strictly ignored for authorization.
2. **Tenant Scoping:** Every SQL query includes `WHERE organization_id = req.organization.id`. Cross-tenant requests return `404 Not Found` (`ROOM_NOT_FOUND`) with zero information leakage regarding the existence of other tenants' rooms.
3. **Global Room Code Uniqueness:** All rooms enforce global uniqueness on `room_code`. Attempting to register an already existing `room_code` returns `409 Conflict` (`ROOM_CODE_ALREADY_EXISTS`).
4. **Scope-Based Authorization:**
   - Room creation and termination require `rooms:write`.
   - Room lookup and participant listing require `rooms:read`.
   - Participant token issuance requires `tokens:write`.
5. **No Secret Leaks:** Raw API keys are never accepted in query strings, never exposed in JSON responses, and never logged.

---

## 2. API Reference

All requests must include a valid Machine-to-Machine API key via the `X-API-Key` or `Authorization: Bearer <key>` header.

### 2.1 Create Room
`POST /api/v1/rooms` (or `POST /v1/rooms`)
- **Required Permission:** `rooms:write`
- **Request Headers:**
  ```http
  Content-Type: application/json
  X-API-Key: sec_live_...
  ```
- **Request Body:**
  ```json
  {
    "title": "Calculus 101 Lecture",
    "roomCode": "calc-101-mon",
    "settings": {
      "cameraDefault": true,
      "micDefault": false
    },
    "metadata": {
      "courseId": "math-101",
      "instructorId": "faculty-42"
    }
  }
  ```
  *(If `roomCode` is omitted, the server automatically generates a cryptographically secure 3-4-3 format code, e.g. `ptq-rtvq-rox`).*

- **Response (201 Created):**
  ```json
  {
    "room": {
      "id": "7f09320d-71ee-48c0-8d5f-75ea7f2ba48d",
      "roomCode": "calc-101-mon",
      "title": "Calculus 101 Lecture",
      "isActive": true,
      "organizationId": "50e9bd1d-d5ae-4439-bb47-73d7023c7263",
      "environment": "live",
      "settings": {
        "cameraDefault": true,
        "micDefault": false
      },
      "createdAt": "2026-10-25T16:08:44.298Z",
      "startedAt": "2026-10-25T16:08:44.298Z"
    }
  }
  ```

---

### 2.2 Get Room
`GET /api/v1/rooms/:roomId`
- **Required Permission:** `rooms:read`
- **Parameters:** `:roomId` can be either the room UUID (`id`) or the canonical string (`room_code`).
- **Response (200 OK):**
  ```json
  {
    "room": {
      "id": "7f09320d-71ee-48c0-8d5f-75ea7f2ba48d",
      "roomCode": "calc-101-mon",
      "title": "Calculus 101 Lecture",
      "isActive": true,
      "organizationId": "50e9bd1d-d5ae-4439-bb47-73d7023c7263",
      "environment": "live",
      "settings": {
        "cameraDefault": true,
        "micDefault": false
      },
      "activeParticipantsCount": 3,
      "createdAt": "2026-10-25T16:08:44.298Z",
      "startedAt": "2026-10-25T16:08:44.298Z",
      "endedAt": null
    }
  }
  ```
- **Error Responses:**
  - `404 Not Found` (`ROOM_NOT_FOUND`): Room does not exist or belongs to another tenant.

---

### 2.3 End Room
`POST /api/v1/rooms/:roomId/end`
- **Required Permission:** `rooms:write`
- **Behavior:**
  1. Sets `is_active = FALSE` and `ended_at = NOW()` on `live_classes`.
  2. Sets `left_at = NOW()` on all active `room_participants`.
  3. Purges ephemeral in-class chat from MongoDB for this session.
  4. Blocks subsequent token issuance for this room.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Room ended successfully",
    "room": {
      "id": "7f09320d-71ee-48c0-8d5f-75ea7f2ba48d",
      "roomCode": "calc-101-mon",
      "isActive": false,
      "endedAt": "2026-10-25T16:08:44.330Z"
    }
  }
  ```

---

### 2.4 List Participants
`GET /api/v1/rooms/:roomId/participants`
- **Required Permission:** `rooms:read`
- **Query Parameters:** `?status=active` (default) or `?status=all`
- **Response (200 OK):**
  ```json
  {
    "roomCode": "calc-101-mon",
    "participants": [
      {
        "id": "e0b965ba-87b2-4d82-8bc2-a6642730b91e",
        "displayName": "Jane Doe",
        "role": "student",
        "cameraAllowed": true,
        "joinedAt": "2026-10-25T16:08:44.310Z",
        "leftAt": null
      }
    ]
  }
  ```

---

### 2.5 Mint Participant Token
`POST /api/v1/rooms/:roomId/tokens`
- **Required Permission:** `tokens:write`
- **Request Body:**
  ```json
  {
    "participantId": "student-ada-202",
    "name": "Ada Lovelace",
    "role": "student",
    "expiresInSeconds": 14400,
    "permissions": {
      "canPublishVideo": true
    }
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresAt": "2026-10-25T20:08:44.310Z",
    "room": {
      "id": "7f09320d-71ee-48c0-8d5f-75ea7f2ba48d",
      "roomCode": "calc-101-mon"
    },
    "participant": {
      "id": "student-ada-202",
      "name": "Ada Lovelace",
      "role": "student",
      "permissions": {
        "canPublishAudio": false,
        "canPublishVideo": true,
        "canPublishScreen": false,
        "canChat": true,
        "isHost": false
      }
    }
  }
  ```
