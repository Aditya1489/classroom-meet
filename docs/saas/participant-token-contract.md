# Participant Token Contract & SFU Verification Specification

---

## 1. Security Overview & Boundary Notice

> [!CAUTION]
> **CRITICAL SECURITY BOUNDARY:**
> The mediasoup SFU currently running at `https://rtc.mathsy.in` is an external server whose source code is managed outside this repository.
> 
> Participant tokens minted by the Mathsy Meet backend (`api.mathsy.in`) cryptographically bind a user to a specific tenant, room, and role. However, **media traffic and WebRTC transports are NOT secured until the external SFU actively validates this token signature, room binding, and permissions on every incoming Socket.IO connection.**
>
> Customer API keys must **NEVER** be used as participant tokens, transmitted to the browser, or embedded in iframe URLs.

---

## 2. Token Cryptographic Profile

- **Algorithm:** HMAC-SHA256 (`HS256`)
- **Key:** Dedicated server-side secret (`PARTICIPANT_JWT_SECRET`).
- **Standard Lifetime:** Default 4 hours (14,400 seconds); minimum 5 minutes, maximum 24 hours.
- **Replay Protection:** Token validity is strictly constrained by `exp` timestamp and room active status.

---

## 3. JWT Claims Specification

```json
{
  "iss": "mathsy-meet-saas",
  "aud": "mathsy-meet-sfu",
  "sub": "student-ada-202",
  "tenant_id": "50e9bd1d-d5ae-4439-bb47-73d7023c7263",
  "room_code": "ptq-rtvq-rox",
  "room_id": "7f09320d-71ee-48c0-8d5f-75ea7f2ba48d",
  "name": "Ada Lovelace",
  "role": "student",
  "permissions": {
    "canPublishAudio": false,
    "canPublishVideo": true,
    "canPublishScreen": false,
    "canChat": true,
    "isHost": false
  },
  "iat": 1740000000,
  "exp": 1740014400
}
```

### Claims Definition Table

| Claim | Type | Description | Strict Enforcement Rules |
| :--- | :--- | :--- | :--- |
| `iss` | `string` | Issuer identifier | Must equal `"mathsy-meet-saas"`. Reject if mismatched. |
| `aud` | `string` | Audience | Must equal `"mathsy-meet-sfu"`. Reject if mismatched. |
| `sub` | `string` | Subject (Participant ID) | External stable ID provided by customer backend. |
| `tenant_id` | `UUID` | Organization ID | Tenant who owns the room. |
| `room_code` | `string` | Canonical room code | Must strictly match the requested Socket.IO `roomId` or `classId`. |
| `room_id` | `UUID` | PostgreSQL Room ID | Database identifier for billing and audit correlation. |
| `name` | `string` | Display Name | Sanitized participant name. |
| `role` | `enum` | Participant Role | Allowed values: `"tutor"` or `"student"`. |
| `permissions`| `object` | Authoritative permissions | Defines media and control capabilities. |
| `permissions.isHost` | `boolean` | Host privileges | **Must be false if role is 'student'.** |
| `permissions.canPublishAudio` | `boolean` | Audio publish authorization | Tutor: true. Student: false by default (requires mic approval). |
| `permissions.canPublishVideo` | `boolean` | Video publish authorization | Defaults to true. |
| `permissions.canPublishScreen` | `boolean` | Screen sharing permission | Tutor: true. Student: false. |
| `permissions.canChat` | `boolean` | Chat permission | Defaults to true. |
| `iat` | `number` | Issued At timestamp | UNIX epoch in seconds. |
| `exp` | `number` | Expiration timestamp | UNIX epoch in seconds. If `NOW() > exp`, reject connection. |

---

## 4. SFU Verification Pseudocode (Milestone 5 Implementation Target)

When a client connects to the Mediasoup SFU via Socket.IO:

```typescript
// Incoming socket connection at rtc.mathsy.in
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  const requestedRoom = (socket.handshake.query?.classId || socket.handshake.query?.roomId || "").toLowerCase().trim();

  if (!token) {
    return next(new Error("AUTH_ERROR: Missing participant token"));
  }

  try {
    // 1. Verify cryptographic signature, issuer, and audience
    const claims = jwt.verify(token, process.env.PARTICIPANT_JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "mathsy-meet-saas",
      audience: "mathsy-meet-sfu",
    });

    // 2. Validate room binding
    if (claims.room_code.toLowerCase() !== requestedRoom) {
      return next(new Error("AUTH_ERROR: Token room does not match requested room"));
    }

    // 3. Attach verified claims to socket session
    socket.data.user = {
      participantId: claims.sub,
      name: claims.name,
      role: claims.role,
      tenantId: claims.tenant_id,
      roomCode: claims.room_code,
      permissions: claims.permissions,
      isHost: claims.permissions.isHost,
    };

    next();
  } catch (err) {
    return next(new Error("AUTH_ERROR: Invalid or expired participant token"));
  }
});

// Enforce permissions when allocating transports
socket.on("produce", async ({ kind, rtpParameters }, callback) => {
  const { permissions, role } = socket.data.user;

  if (kind === "audio" && !permissions.canPublishAudio) {
    return callback({ error: "FORBIDDEN: Participant is not authorized to publish audio" });
  }

  if (kind === "video" && !permissions.canPublishVideo) {
    return callback({ error: "FORBIDDEN: Participant is not authorized to publish video" });
  }

  // Allocate producer...
});
```
