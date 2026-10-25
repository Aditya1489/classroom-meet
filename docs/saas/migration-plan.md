# Mathsy Meet SaaS — 10-Milestone Migration Plan

**Document:** `docs/saas/migration-plan.md`  
**Date:** October 2026  
**Status:** Concrete Implementation Roadmap

---

## 1. Migration Philosophy & Safety Guarantees

1. **Non-Destructive Evolution:** Never perform a risky rewrite. Extend the working single-tenant core by layering tenant awareness and versioned B2B interfaces.
2. **First-Party Business Continuity:** Mathsy’s current tutoring rooms and students must experience zero downtime or behavioral regressions during migration.
3. **Milestone Independence:** Every milestone delivers an independently verifiable, testable slice with a defined rollback mechanism.

---

## 2. Phased Milestone Roadmap

```
Milestone 1: Architectural Baseline & Migration Plan (Complete)
     │
     ▼
Milestone 2: Multi-Tenant Database Schema & First-Party System Tenant
     │
     ▼
Milestone 3: API Key Engine & Server-to-Server Authentication
     │
     ▼
Milestone 4: Versioned B2B Room Management API & Scoped Token Minting
     │
     ▼
Milestone 5: Authoritative Signaling & Mediasoup Token Verification
     │
     ▼
Milestone 6: Frameless Embed Route (`/embed/:roomCode`) & postMessage Bridge
     │
     ▼
Milestone 7: TypeScript SDK (`@mathsy/meet-sdk`) Client & Server Libraries
     │
     ▼
Milestone 8: Usage Metering Engine, Quota Enforcement & Outbound Webhooks
     │
     ▼
Milestone 9: Developer Portal & Customer Self-Serve Dashboard
     │
     ▼
Milestone 10: Staging Hardening, 100-User Multi-Tenant Load Test & Beta Release
```

---

## 3. Milestone Detailed Specifications

### Milestone 1: Architectural Baseline & Migration Plan
- **Scope:** Complete discovery, codebase inspection, signaling probe, and documentation generation.
- **Files Affected:** `docs/saas/*.md`.
- **Status:** **COMPLETE.**

---

### Milestone 2: Multi-Tenant Database Schema & First-Party System Tenant
- **Scope:**
  - Create additive migration `server/db/migrations/002_multi_tenant_foundation.sql`.
  - Create core tenant tables: `organizations`, `organization_members`, `api_keys`, `customer_apps`.
  - Seed default first-party organization (`00000000-0000-0000-0000-000000000001`).
  - Attach primary tutor (`aditya@mathsy.in`) as owner in `organization_members`.
  - Add additive nullable `organization_id` foreign key columns and indexes to existing tables (`live_classes`, `room_participants`, `whiteboard_snapshots`, `polls`, `chat_messages`).
  - Backfill existing classroom records with zero data loss.
- **Files Affected:** [server/db/migrations/002_multi_tenant_foundation.sql](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/server/db/migrations/002_multi_tenant_foundation.sql), [tests/multi_tenant_database_migration.test.ts](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/tests/multi_tenant_database_migration.test.ts), [docs/saas/milestone-2-database-implementation.md](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/docs/saas/milestone-2-database-implementation.md).
- **Status:** **COMPLETE & VERIFIED.**
- **Evidence:**
  - Automated test suite `tests/multi_tenant_database_migration.test.ts` (7/7 tests passed in 108ms).
  - Pre-migration vs post-migration row counts match 100% (28 `live_classes`, 4,613 `room_participants`, 2,000 `chat_messages`).
  - Existing regression test suites pass (`room_authorization`, `secure_auth`, `student_mic_state_machine`, `chat_backend_persistence`).
  - Production build `npm run build` succeeds cleanly in 9.70s.

---

### Milestone 3: API Key Engine & Server-to-Server Authentication
- **Scope:**
  - High-entropy cryptographic API key generation with environment prefixing (`sec_live_...`, `sec_test_...`).
  - Hash-only storage with SHA-256 and constant-time comparison (`crypto.timingSafeEqual`).
  - Key lifecycle management: creation, masked listing, rotation, revocation, and audit logging.
  - Organization isolation and status checking (suspension blocks key auth).
  - Fine-grained permission checks (`requirePermission('rooms:write')`).
  - Sliding-window rate limiting per API key (100 req / 10s with `Retry-After: 10`).
  - Additive migration `server/db/migrations/003_api_key_audit_logs.sql`.
- **Files Affected:**
  - Migration: [server/db/migrations/003_api_key_audit_logs.sql](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/server/db/migrations/003_api_key_audit_logs.sql)
  - Engine Service: [server/services/apiKeyService.ts](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/server/services/apiKeyService.ts)
  - Middleware: [server/middleware/apiKeyAuth.ts](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/server/middleware/apiKeyAuth.ts)
  - Management Routes: [server/routes/apiKeys.ts](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/server/routes/apiKeys.ts)
  - Server Hook: [server/index.ts](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/server/index.ts)
  - Automated Suite: [tests/api_key_engine.test.ts](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/tests/api_key_engine.test.ts)
- **Status:** **COMPLETE & VERIFIED.**
- **Evidence:**
  - Automated test suite `tests/api_key_engine.test.ts` (11/11 tests passed in 187ms).
  - Covers TC-KEY-01 through TC-KEY-11 (high entropy, hash-only storage, verification & tampering rejection, environment segregation, revocation/expiration, organization suspension, atomic key rotation, HTTP middleware, permission enforcement, cross-org isolation, audit logging, rate limiting).
  - All existing regression suites pass: `multi_tenant_database_migration` (7/7), `room_authorization` (10/10), `secure_auth` (9/9), `student_mic_state_machine` (16/16), `chat_backend_persistence` (10/10).
  - Full TypeScript and Vite build `npm run build` succeeds cleanly in 9.35s.

---

### Milestone 4: Versioned B2B Room Management API & Scoped Token Minting
- **Scope:**
  - Mount `/api/v1/rooms` and `/v1/rooms` routers:
    - `POST /rooms` (Create room with tenant scoping and global uniqueness)
    - `GET /rooms/:id` (Get room metadata, status, and active participant count)
    - `POST /rooms/:id/end` (Terminate room, mark participants left, and purge temporary chat)
    - `GET /rooms/:id/participants` (List active/historical room participants)
    - `POST /rooms/:id/tokens` (Mint short-lived participant JWT with authoritative claims)
  - Strict tenant scoping: organization derived exclusively from verified API key (`req.organization`).
  - Authoritative role bounds: student tokens strictly forbid elevated permissions (`isHost: false`).
  - Cryptographic participant token service using vetted `jsonwebtoken` library.
  - Comprehensive documentation: [docs/saas/milestone-4-room-api.md](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/docs/saas/milestone-4-room-api.md) and [docs/saas/participant-token-contract.md](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/docs/saas/participant-token-contract.md).
- **Files Affected:**
  - Token Service: [server/services/participantTokenService.ts](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/server/services/participantTokenService.ts)
  - Room Router: [server/routes/v1/rooms.ts](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/server/routes/v1/rooms.ts)
  - Server Hook: [server/index.ts](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/server/index.ts)
  - Test Suite: [tests/v1_room_api_and_tokens.test.ts](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/tests/v1_room_api_and_tokens.test.ts)
  - Specifications: [docs/saas/milestone-4-room-api.md](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/docs/saas/milestone-4-room-api.md), [docs/saas/participant-token-contract.md](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/docs/saas/participant-token-contract.md)
- **Status:** **COMPLETE & VERIFIED.**
- **Evidence:**
  - Automated test suite `tests/v1_room_api_and_tokens.test.ts` (14/14 tests passed in 290ms).
  - Covers TC-M4-01 through TC-M4-14 (room creation, org spoofing prevention, scope enforcement, global code uniqueness, tenant lookup, cross-tenant isolation, tutor/student token issuance, student host elevation stripping, tokens:write scope check, cross-tenant minting block, invalid roles & suspended org rejection, participant listing, room termination & ended room token block, cryptographic signature tamper rejection).
  - All existing regression suites pass: `api_key_engine` (11/11), `multi_tenant_database_migration` (7/7), `room_authorization` (10/10), `secure_auth` (9/9), `student_mic_state_machine` (16/16), `chat_backend_persistence` (10/10).
  - Full TypeScript and Vite build `npm run build` succeeds cleanly in 9.56s.
- **Critical Security Boundary:**
  - Participant tokens are minted and cryptographically signed. However, the media layer on the external SFU at `rtc.mathsy.in` will not enforce these tokens until Milestone 5 is implemented on the signaling server.

---

### Milestone 5: Authoritative Signaling & Mediasoup Token Verification
- **Scope:**
  - Audit SFU server source code and deployment architecture.
  - Implement cryptographic participant token verification on the SFU socket layer (`mathsy-meet-server`).
  - Enforce token room binding, tenant isolation, role authorization, and media producer permissions.
  - Build automated SFU security test suite (`scripts/sfu_token_security.test.mjs`) and verify all 15 scenarios.
  - Establish production deployment runbook and secret rotation procedure.
- **Repositories & Files Affected:**
  - SFU Implementation (`mathsy-meet-server`):
    - `src/auth/participantTokenAuth.ts` (Authoritative token verification & claim enforcement)
    - `src/auth/index.ts` (Routing & guest compatibility)
    - `src/config/index.ts` (Secret & authEnforce default to fail-closed)
    - `src/peers/Peer.ts` (Permissions & audio approval state)
    - `src/rooms/Room.ts` (Room-scoped producer lookup)
    - `src/socket/index.ts` (Strict handshake, media producer guards, moderation guards, chat sanitization)
    - `scripts/sfu_token_security.test.mjs` (Comprehensive automated security suite)
- **Status:** **IMPLEMENTED & VERIFIED LOCALLY (DEPLOYMENT TO RTC.MATHSY.IN PENDING ADMIN AUTHORIZATION).**
- **Evidence:**
  - `npm --prefix ../mathsy-meet-server test` runs `scripts/sfu_token_security.test.mjs`: **15/15 PASS** in 189ms.
    - Covers: missing token, malformed token, forged signature, expired token, wrong audience/issuer, room binding enforcement, student privilege escalation rejection, authorized tutor session, authorized student session, unauthorized student audio rejection, student screen sharing block, unauthorized student moderation block, student mic approval flow, disconnect cleanup, first-party guest compatibility.
  - TypeScript build `npm --prefix ../mathsy-meet-server run build` succeeds cleanly with 0 errors.
  - All existing API regression suites in `mathsy-meet` remain **100% PASS** (14/14 room API, 11/11 API keys, 10/10 room auth, 16/16 mic state machine, 10/10 chat persistence).
- **Deployment Status:**
  - Deployment to production `rtc.mathsy.in` (`80.225.208.166`) is intentionally paused pending explicit administrative authorization. Runbook is documented in [docs/saas/milestone-5-sfu-security.md](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/docs/saas/milestone-5-sfu-security.md).

---

### Milestone 6: Frameless Embed Route (`/embed/:roomCode`) & postMessage Bridge
- **Scope:**
  - Add `/embed/:roomCode` in [src/App.tsx](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/App.tsx).
  - Create dedicated frameless meeting container without top banners or navigation headers.
  - Implement bidirectional `window.postMessage` bridge with strict parent origin validation.
- **Files Affected:** [src/App.tsx](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/src/App.tsx), new: `src/components/embed/EmbedRoomView.tsx`, `src/lib/embedBridge.ts`.
- **Tests Required:** Iframe loading in third-party host test page, postMessage event emission (`ready`, `joined`, `left`), origin rejection test.
- **Completion Criteria:** Video call runs seamlessly inside an iframe on an external domain.

---

### Milestone 7: TypeScript SDK (`@mathsy/meet-sdk`) Client & Server Libraries
- **Scope:**
  - Package `@mathsy/meet-sdk/client` (Iframe lifecycle manager, typed events, control methods).
  - Package `@mathsy/meet-sdk/server` (Node.js SDK for room management and token generation).
  - Create complete runnable integration example (e.g. Next.js / Express embed demo).
- **Files Affected:** New package directory: `packages/meet-sdk/`.
- **Tests Required:** SDK unit tests, end-to-end integration demo test.
- **Completion Criteria:** External developer can install SDK via npm and embed a meeting in under 10 lines of code.

---

### Milestone 8: Usage Metering Engine, Quota Enforcement & Outbound Webhooks
- **Scope:**
  - Implement participant session tracking on join/leave.
  - Implement background heartbeat reconciliation job.
  - Implement webhook event queue with HMAC-SHA256 signatures and exponential backoff retry.
  - Implement quota check in token minting endpoint.
- **Files Affected:** New: `server/services/meteringService.ts`, `server/services/webhookService.ts`, `server/jobs/reaperJob.ts`.
- **Tests Required:** Participant-minute calculation accuracy, webhook signature verification, quota overflow handling (402).
- **Completion Criteria:** Accurate billing minutes recorded; customer endpoint receives signed webhooks.

---

### Milestone 9: Developer Portal & Customer Self-Serve Dashboard
- **Scope:**
  - Build web dashboard for customer developers at `/dashboard`.
  - Organization settings, API key creation/revocation, webhook endpoint management, real-time analytics graphs.
- **Files Affected:** New frontend views: `src/components/dashboard/*`.
- **Tests Required:** RBAC permissions, key generation flow, secret reveal modal.
- **Completion Criteria:** Customer can register, generate an API key, and view usage charts without manual intervention.

---

### Milestone 10: Staging Hardening, 100-User Multi-Tenant Load Test & Beta Release
- **Scope:**
  - Deploy to staging environment with dedicated staging SFU.
  - Execute multi-tenant load test: 10 concurrent customer organizations running 100 total participants.
  - Security audit & penetration testing for cross-tenant isolation and rate limiting.
  - Invite initial beta customer cohort.
- **Tests Required:** Multi-tenant 100-user stress test, security penetration test, backup restoration drill.
- **Completion Criteria:** All acceptance criteria satisfied; zero P0/P1 defects; production rollout authorized.
