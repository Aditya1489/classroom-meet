# Mathsy Meet SaaS — Security & Threat Model

**Document:** `docs/saas/security-model.md`  
**Date:** October 2026  
**Status:** Security Architecture Specification

---

## 1. Authentication Boundaries

The SaaS platform establishes six strictly isolated authentication perimeters:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. Platform Admin Perimeter (Mathsy Internal Admins)                        │
│    - Multi-tenant oversight, billing configuration, abuse termination       │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. Customer Org Admin Perimeter (B2B Tenant Dashboard)                      │
│    - API key provisioning, webhook configuration, usage auditing            │
├─────────────────────────────────────────────────────────────────────────────┤
│ 3. Customer Backend Server Perimeter (Server-to-Server M2M)                 │
│    - Bearer sec_live_... / sec_test_... API keys for room management        │
├─────────────────────────────────────────────────────────────────────────────┤
│ 4. Participant Access Token Perimeter (Short-Lived JWT)                     │
│    - Minted by Customer Backend, verified by Mathsy Meet API & Signaling   │
├─────────────────────────────────────────────────────────────────────────────┤
│ 5. Embedded Web Perimeter (Iframe / postMessage)                            │
│    - Parent origin validation, CSP frame-ancestors, token handoff           │
├─────────────────────────────────────────────────────────────────────────────┤
│ 6. First-Party Legacy Perimeter (mathsy.in Users)                           │
│    - Google OAuth ID token verification mapped to default system tenant     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Perimeter Detailed Specifications

### A. First-Party Mathsy Meet Users
- **Mechanism:** Google OAuth 2.0 verified via `OAuth2Client.verifyIdToken`.
- **Identity:** Bound to Google `sub` claim.
- **Tenant Scope:** Implicitly mapped to `DEFAULT_TENANT_ID` (`00000000-0000-0000-0000-000000000000`).
- **Token:** 7-day HMAC-SHA256 JWT stored in client memory or `localStorage`.

### B. Customer Backend API Authentication
- **Mechanism:** High-entropy API keys issued to customer organizations.
- **Key Formats:**
  - Production: `sec_live_` + 32 cryptographically secure random bytes (Base62).
  - Sandbox: `sec_test_` + 32 cryptographically secure random bytes (Base62).
- **Storage Policy:**
  - Raw API keys are **never stored** in the database.
  - Only the SHA-256 hash or Argon2id hash (`key_hash`), prefix (e.g. `sec_live_7x9Q...`), and last 4 characters are persisted.
  - Full secret is displayed to the customer developer **exactly once** upon generation.

### C. Participant Access-Token Issuance
- **Mechanism:** Customer backend calls `POST /v1/rooms/:roomId/tokens` using its server API key.
- **Payload Structure (HMAC-SHA256):**
```json
{
  "iss": "https://api.mathsy.in",
  "sub": "user_customer_uuid_12345",
  "aud": "mathsy-meet-room",
  "tenant_id": "org_8f3d10a2-...",
  "room_id": "rm_99b1c2...",
  "room_code": "ptq-rtvq-rox",
  "role": "student",
  "name": "Arjun Sharma",
  "permissions": {
    "can_publish_audio": false,
    "can_publish_video": false,
    "can_share_screen": false,
    "can_chat": true
  },
  "exp": 1793528400,
  "iat": 1793524800,
  "jti": "tok_random_uuid"
}
```
- **Lifespan:** Strictly bounded (default 2 hours, maximum 4 hours).
- **Binding:** Cryptographically bound to a single `room_code` and `tenant_id`. Replay in any other room is rejected immediately.

### D. Embedded Meeting Initialization (Iframe Security)
- **Origin Whitelisting:** Customer organizations register authorized domains (e.g., `https://lms.acmeschool.edu`).
- **HTTP Header Enforcement:**
  - `Content-Security-Policy: frame-ancestors 'self' https://lms.acmeschool.edu;`
  - Prevents clickjacking and unauthorized embedding by third-party domains.
- **Secure Handoff:**
  - URL format: `https://meet.mathsy.in/embed/ptq-rtvq-rox?token=JWT_PARTICIPANT_TOKEN`
  - Iframe initializes in sandbox mode: `allow="camera; microphone; display-capture; autoplay"`.
  - Bidirectional communication uses `window.postMessage` with explicit `event.origin` verification.

### E. Socket.IO Signaling & Mediasoup SFU Authorization
- **Handshake Validation:**
  - When connecting to `wss://rtc.mathsy.in/socket.io/`, the signaling server MUST cryptographically verify the token's signature using `JWT_SECRET`.
  - The signaling server verifies:
    1. Signature is authentic.
    2. Token is not expired (`exp > now`).
    3. `room_code` in token matches `classId` query parameter.
    4. `tenant_id` in token matches the room's owner tenant.
- **Direct Connection Protection:**
  - Sockets attempting to connect without a token, or with a token for a different room, are closed during handshake (`next(new Error('Unauthorized room entry'))`).

### F. Platform Admins vs Tenant Org Admins (RBAC)

| Role | Scope | Permissions |
|---|---|---|
| **Super Admin** | Platform-Wide | View all tenants, suspend tenants, configure billing, inspect system health. |
| **Org Owner** | Single Tenant | Full access to tenant rooms, billing, API keys, delete organization. |
| **Org Admin** | Single Tenant | Create/revoke API keys, configure webhooks, view analytics. |
| **Org Developer** | Single Tenant | Access API keys, inspect webhook delivery logs, manage test rooms. |
| **Org Viewer** | Single Tenant | Read-only access to meeting analytics and usage reports. |

---

## 3. Threat Modeling & Abuse Prevention

### 1. Tenant ID Spoofing
- **Threat:** Malicious customer passes `tenant_id: "victim_school_org"` in request headers or body.
- **Mitigation:** `req.tenantId` is **never derived from user input**. It is derived exclusively from the verified API key hash in PostgreSQL or verified claims in the signed JWT.

### 2. Role Elevation (Student Claiming Host)
- **Threat:** Student client passes `role: "tutor"` or `isHost: true` in signaling payload.
- **Mitigation:**
  - Host privileges are evaluated server-side by checking `room.tutor_id === user.id` (first-party) or `token.role === 'host'` (SaaS API).
  - Client-side role claims are completely ignored by the Express backend and signaling router.

### 3. Cross-Tenant Room Access
- **Threat:** User from Tenant A attempts to join room code belonging to Tenant B.
- **Mitigation:**
  - Room lookup SQL queries enforce `WHERE room_code = $1 AND tenant_id = $2`.
  - Participant token validation rejects any token where `token.tenant_id !== room.tenant_id`.

### 4. Token Reuse Across Rooms
- **Threat:** Participant captures token for Room A and attempts to join Room B.
- **Mitigation:** Token payload explicitly embeds `aud: "mathsy-meet-room"` and `room_code: "ptq-rtvq-rox"`. The server rejects the token if `token.room_code !== requested_room_code`.

### 5. Replay of Expired Tokens
- **Threat:** Intercepted token re-used hours later.
- **Mitigation:** Tokens enforce short expirations ($\le 4\text{ hours}$). PostgreSQL attendance marks `left_at = NOW()` upon disconnect. Re-entry requires an active, unexpired token.

### 6. Resource Exhaustion & Denial of Service
- **Threat:** Malicious script generates 10,000 rapid room creation calls or 1,000 socket connections.
- **Mitigation:**
  - In-memory / Redis sliding window rate limiter: Max 60 room creations/minute per tenant.
  - Max concurrent participant limit enforced per tenant plan (e.g., 250 concurrent participants on Starter Plan).
  - Chat rate limit: Max 5 messages per 3 seconds per user.
