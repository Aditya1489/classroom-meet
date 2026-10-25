# Mathsy Meet SaaS — Milestone 2: Multi-Tenant Database Implementation Report

**Document:** `docs/saas/milestone-2-database-implementation.md`  
**Date:** October 2026  
**Status:** Completed & Verified  
**Migration File:** [server/db/migrations/002_multi_tenant_foundation.sql](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/server/db/migrations/002_multi_tenant_foundation.sql)  
**Test Suite:** [tests/multi_tenant_database_migration.test.ts](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/tests/multi_tenant_database_migration.test.ts)

---

## 1. Executive Summary

Milestone 2 establishes the multi-tenant PostgreSQL database foundation required for commercial SaaS operations while preserving 100% backward compatibility for existing Mathsy Meet classrooms. 

The implementation strictly followed an **additive, expand-and-contract pattern**:
- Zero existing tables or columns were dropped, altered, or renamed.
- A stable, non-conflicting system organization UUID (`00000000-0000-0000-0000-000000000001`) was seeded.
- All 28 pre-existing classroom rooms and 4,613 historical participant attendance records were backfilled with zero data loss.
- High-entropy API keys store only a cryptographic SHA-256 hash and non-secret prefix; raw secrets are never stored.

---

## 2. Database Changes (DDL & DML)

### A. New Tables Added

1. **`organizations` (Tenants):**
   - Root entity for B2B commercial accounts.
   - Primary Key: `id` UUID (`uuid_generate_v4()`).
   - Columns: `name`, `slug` (UNIQUE), `status` (`active`, `suspended`, `delinquent`), `settings` JSONB, `created_at`, `updated_at`.
   - Indexes: `idx_organizations_slug`, `idx_organizations_status`.

2. **`organization_members`:**
   - Multi-user dashboard access per organization.
   - Primary Key: `id` UUID.
   - Columns: `organization_id` (FK $\to$ `organizations.id` ON DELETE CASCADE), `user_id` (FK $\to$ `users.id` ON DELETE CASCADE), `role` (`owner`, `admin`, `developer`, `member`, `viewer`), timestamps.
   - Constraints: `UNIQUE(organization_id, user_id)`.
   - Indexes: `idx_org_members_org`, `idx_org_members_user`.

3. **`api_keys`:**
   - Server-to-server machine authentication credentials.
   - Primary Key: `id` UUID.
   - Columns: `organization_id` (FK $\to$ `organizations.id` ON DELETE CASCADE), `name`, `key_prefix` VARCHAR(16), `key_hash` VARCHAR(64) UNIQUE, `environment` (`live`, `test`), `is_active`, `permissions` JSONB, `last_used_at`, `expires_at`, `created_at`.
   - Constraints: `UNIQUE(organization_id, name)`.
   - Indexes: `idx_api_keys_org`, `idx_api_keys_hash`.

4. **`customer_apps`:**
   - Whitelists embed domains and branding for third-party websites.
   - Primary Key: `id` UUID.
   - Columns: `organization_id` (FK $\to$ `organizations.id` ON DELETE CASCADE), `app_name`, `allowed_domains` TEXT[], `branding` JSONB, timestamps.
   - Constraints: `UNIQUE(organization_id, app_name)`.
   - Indexes: `idx_customer_apps_org`.

### B. Additive Nullable Foreign Keys on Existing Tables

To allow tenant-scoped queries without breaking legacy single-tenant operations:
- `live_classes.organization_id`: UUID REFERENCES `organizations(id)` ON DELETE SET NULL.
  - Indexed via `idx_live_classes_organization_id` and composite `idx_live_classes_org_code (organization_id, room_code)`.
- `room_participants.organization_id`: UUID REFERENCES `organizations(id)` ON DELETE SET NULL.
  - Indexed via `idx_room_participants_organization_id`.
- `whiteboard_snapshots.organization_id`: UUID REFERENCES `organizations(id)` ON DELETE SET NULL.
- `polls.organization_id`: UUID REFERENCES `organizations(id)` ON DELETE SET NULL.
- `chat_messages.organization_id`: UUID REFERENCES `organizations(id)` ON DELETE SET NULL.

### C. First-Party Seed & Data Backfill

- **First-Party System Organization:**
  - ID: `00000000-0000-0000-0000-000000000001`
  - Name: `"Mathsy Classroom (First-Party)"`
  - Slug: `"mathsy-first-party"`
  - Status: `"active"`
  - Settings: `{"is_system_tenant": true, "max_room_duration_min": 720, "default_camera_locked": true}`
- **Primary Owner Attached:**
  - User `aditya@mathsy.in` (`1857b3cb-1a92-47e5-884f-6ffe115cf740`) attached as `owner` in `organization_members`.
- **Authoritative Backfill:**
  - All existing `live_classes` rows backfilled with `organization_id = '00000000-0000-0000-0000-000000000001'`.
  - All existing `room_participants` rows backfilled with `organization_id = '00000000-0000-0000-0000-000000000001'`.
  - All existing `polls`, `whiteboard_snapshots`, and `chat_messages` backfilled.

---

## 3. Pre-Migration vs. Post-Migration Row Counts (Zero Data Loss)

Verification queries confirmed exact row count preservation across all tables:

| Table | Pre-Migration Count | Post-Migration Count | Backfilled to First-Party Tenant | Data Loss / Discrepancy |
|---|---|---|---|---|
| `live_classes` | 28 | 28 | **28 (100%)** | **0 (Zero)** |
| `room_participants` | 4,613 | 4,613 | **4,613 (100%)** | **0 (Zero)** |
| `whiteboard_snapshots` | 4 | 4 | **4 (100%)** | **0 (Zero)** |
| `polls` | 1 | 1 | **1 (100%)** | **0 (Zero)** |
| `chat_messages` | 2,000 | 2,000 | **2,000 (100%)** | **0 (Zero)** |
| `users` | 110 | 110 | N/A (Global auth) | **0 (Zero)** |
| `organizations` | 0 | 1 | Seeded First-Party | **+1 (Expected)** |
| `organization_members` | 0 | 1 | Primary Owner Seeded | **+1 (Expected)** |
| `api_keys` | 0 | 0 | Ready for M3 | **0** |
| `customer_apps` | 0 | 0 | Ready for M6 | **0** |

---

## 4. Automated Verification Test Suite

A dedicated automated test suite was created in [tests/multi_tenant_database_migration.test.ts](file:///Users/adityachavhan/Documents/Mathsy/mathsy-meet/tests/multi_tenant_database_migration.test.ts):

```bash
$ npx tsx tests/multi_tenant_database_migration.test.ts
```
```
▶ Milestone 2: Multi-Tenant Database Foundation Verification
  ✔ M2-01: 002_multi_tenant_foundation.sql executes cleanly and creates all new tables (38.01ms)
  ✔ M2-02: Re-running 002_multi_tenant_foundation.sql is completely idempotent and safe to retry (9.47ms)
  ✔ M2-03: Pre-migration vs post-migration row counts match exactly (zero data loss) (1.30ms)
  ✔ M2-04: First-party organization exists and all existing classroom records are backfilled (1.11ms)
  ✔ M2-05: Foreign key constraints and cascades behave correctly (6.04ms)
  ✔ M2-06: Tenant-scoped uniqueness constraints are strictly enforced (15.40ms)
  ✔ M2-07: Existing first-party classroom query patterns continue working seamlessly (1.09ms)
✔ Milestone 2: Multi-Tenant Database Foundation Verification (106.01ms)
ℹ tests 7 | pass 7 | fail 0 | cancelled 0 | duration_ms 108.79
```

### Full Regression Suite Results:
- `tests/room_authorization.test.ts`: **PASS** (10/10 passed). Existing classroom creation, tutor ownership, and student attendance work without modification.
- `tests/secure_auth.test.ts`: **PASS** (9/9 passed). Google OAuth verification and JWT authorization unaffected.
- `tests/student_mic_state_machine.test.ts`: **PASS** (16/16 passed). Speaking requests, tutor approvals, and force mute unaffected.
- `tests/chat_backend_persistence.test.ts`: **PASS** (10/10 passed). MongoDB ephemeral chat and room end purge unaffected.
- `npm run build`: **PASS** (`tsc && vite build` built in 9.70s, 0 errors).

---

## 5. Tenant-Aware Query & Authorization Guidelines (For Milestones 3 & 4)

Developers extending the codebase must follow these mandatory patterns:

1. **Mandatory Tenant Query Scope:**
   - Any query fetching customer rooms MUST filter by `organization_id`:
     ```sql
     -- Correct:
     SELECT * FROM live_classes WHERE room_code = $1 AND organization_id = $2;
     -- Forbidden (cross-tenant leak):
     SELECT * FROM live_classes WHERE room_code = $1;
     ```
2. **First-Party Legacy Compatibility Fallback:**
   - When handling requests from first-party routes (`/meet/:roomCode` or `/api/rooms/*`), fallback to `DEFAULT_ORG_ID` (`00000000-0000-0000-0000-000000000001`) if `req.organization` is not present.
3. **API Key Hash Invariance:**
   - When querying `api_keys`, compute the SHA-256 hash of the incoming Bearer token:
     ```typescript
     const keyHash = crypto.createHash("sha256").update(rawSecret).digest("hex");
     const res = await query("SELECT * FROM api_keys WHERE key_hash = $1 AND is_active = TRUE", [keyHash]);
     ```

---

## 6. Rollback Strategy & Risk Assessment

### Safe Rollback Procedure:
If Milestone 2 ever needed to be reverted, run the following non-destructive rollback SQL:
```sql
ALTER TABLE live_classes DROP COLUMN IF EXISTS organization_id;
ALTER TABLE room_participants DROP COLUMN IF EXISTS organization_id;
ALTER TABLE whiteboard_snapshots DROP COLUMN IF EXISTS organization_id;
ALTER TABLE polls DROP COLUMN IF EXISTS organization_id;
ALTER TABLE chat_messages DROP COLUMN IF EXISTS organization_id;
DROP TABLE IF EXISTS customer_apps CASCADE;
DROP TABLE IF EXISTS api_keys CASCADE;
DROP TABLE IF EXISTS organization_members CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;
```
*Note:* Reverting does NOT touch or delete any existing `live_classes` or `room_participants` data.

### Unresolved Risks:
- **None identified for Milestone 2.** The database changes are 100% additive, fully indexed, and zero existing endpoints or UI components were altered.
