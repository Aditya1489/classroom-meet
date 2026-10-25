# Mathsy Meet SaaS — Milestone 2 Verification Report

**Document:** `docs/saas/milestone-2-verification.md`  
**Date:** October 2026  
**Auditor:** SRE & Security Architecture Team  
**Status:** Verified & Documented

---

## 1. Executive Summary

A comprehensive post-implementation verification of Milestone 2 was conducted across the PostgreSQL database, MongoDB ephemeral storage, migration scripts, and test suites.

The core database foundation is sound, additive, and backward-compatible. However, critical operational and security distinctions have been identified and documented below regarding database target isolation, query scoping, foreign key constraints, and MongoDB tenant fields.

---

## 2. Detailed Verification Findings

### A. Database Target & Connection Isolation (Questions 2 & 3)
- **Target Database:** The migration and tests executed against the database specified in `process.env.DATABASE_URL` (local development database `mathsy_meet` on port 5432).
- **Isolation Assessment:**
  - The migration test did **not** use an ephemeral, isolated disposable test database.
  - While test-created organizations (`Acme Academy`) were cleanly deleted in a `finally` block, executing DDL against `mathsy_meet` modified the shared developer database schema.
  - **Mitigation & Standard:** For CI/CD and automated test runners, tests should connect to a dedicated `mathsy_meet_test` database or wrap DDL validation inside a rolled-back transaction (`BEGIN ... ROLLBACK`) where DDL transactions are supported by PostgreSQL.

---

### B. First-Party Tenant Backfill & Data Preservation (Question 4)
- **Pre- vs. Post-Migration Verification:**
  - `live_classes`: Exactly 28 rows before, 28 rows after (100% backfilled with `organization_id = '00000000-0000-0000-0000-000000000001'`).
  - `room_participants`: Exactly 4,613 rows before, 4,613 rows after (100% backfilled).
  - `whiteboard_snapshots`: 4 rows before, 4 rows after (100% backfilled).
  - `polls`: 1 row before, 1 row after (100% backfilled).
  - `chat_messages`: 2,000 rows before, 2,000 rows after (100% backfilled).
  - `users`: 110 rows before, 110 rows after (unaffected, global auth).
- **Result:** Zero data loss. Zero orphan foreign keys.

---

### C. Foreign Keys & Unique Constraints (Question 5)
- **Global Room Code Uniqueness:**
  - `live_classes.room_code` maintains its global `UNIQUE` constraint (`live_classes_room_code_key`).
  - **Critical Dependency:** Five existing tables maintain foreign key references directly to `live_classes(room_code)`:
    1. `room_participants(room_code) REFERENCES live_classes(room_code)`
    2. `whiteboard_snapshots(room_code) REFERENCES live_classes(room_code)`
    3. `chat_messages(room_code) REFERENCES live_classes(room_code)`
    4. `polls(room_code) REFERENCES live_classes(room_code)`
    5. `tablet_pairings(room_code) REFERENCES live_classes(room_code)`
  - Furthermore, the external Mediasoup signaling server (`rtc.mathsy.in`) routes media and WebSockets by `room_code` (`classId`).
  - **Architectural Decision:** Room codes **must remain globally unique** across all tenants. Allowing duplicate room codes across tenants would cause cross-tenant stream collision at the external SFU.
  - In addition, a composite index `idx_live_classes_org_code (organization_id, room_code)` was added to optimize tenant-filtered lookups.

---

### D. Rollback SQL & Destruction Risks (Question 6)
- **Analysis:**
  - The previously documented rollback SQL executes `DROP TABLE IF EXISTS customer_apps, api_keys, organization_members, organizations CASCADE`.
  - While this is safe immediately following migration before customers are onboarded, executing this rollback in production after SaaS customer data has been created would **permanently destroy all tenant organizations, member accounts, API keys, and custom branding**.
  - **Policy:** **Never execute automated rollbacks in production.** Any rollback in a populated multi-tenant environment must be a staged, forward-migrating fix (expand-and-contract) rather than a destructive drop.

---

### E. Application Query Tenant Enforcement (Question 7)
- **Current State:**
  - The `organization_id` column on `live_classes` and `room_participants` is currently nullable with foreign keys.
  - Existing first-party application routes (`server/routes/rooms.ts`) continue querying by `WHERE room_code = $1` without filtering by `organization_id`.
  - **Status:** This is expected for Milestone 2 (which is strictly a database foundation milestone). Tenant-scoped authorization and queries will be enforced in **Milestone 4** when the versioned `/v1/rooms` REST API and scoped authorization middleware are implemented.

---

### F. MongoDB Ephemeral Chat Tenant Field (Question 8)
- **Audit Findings:**
  - Inspection of `server/db/mongo.ts` and `server/routes/chat.ts` reveals that `MongoChatMessage` and `MongoClassSession` **do not currently have a `tenantId` or `organizationId` field**.
  - Current chat queries (`GET /:roomCode/chat`) and insertions (`POST /:roomCode/chat`) operate strictly on `sessionId`.
  - Because `sessionId` is a cryptographically unique UUID generated per class and linked to `live_classes.metadata.session_id`, chat messages are isolated between classes by `sessionId`.
  - **Defect / Future Requirement:** For commercial multi-tenant SaaS, MongoDB documents must include `tenantId`. In Milestone 4, `tenantId?: string` should be added to `MongoChatMessage` and indexed (`{ tenantId: 1, sessionId: 1, createdAt: 1 }`) to provide defense-in-depth tenant isolation in the ephemeral chat layer.

---

## 3. Conclusion & Authorization for Milestone 3

The database foundation in `002_multi_tenant_foundation.sql` is verified to be safe, non-destructive, and backward-compatible with existing classroom operations. The foundation is approved for Milestone 3 (API Key Engine).
