# Mathsy Meet — Phase 8, Checkpoint 2: Admin API Issuance & Customer Onboarding Audit

**Repository:** `/Users/adityachavhan/Documents/Mathsy/mathsy-meet`  
**Audit Date:** 2026-10-27  
**Audit Scope:** Platform Owner/Admin Workflow, Customer Developer Experience, Tenant Isolation & Credential Security, UI vs. Backend Gap Analysis  
**Mode:** READ-ONLY AUDIT (No application code or database schema changes applied)

---

## 1. Executive Verdict

### Verdict: 🟡 PARTIAL

The Mathsy Meet application possesses a **complete, robust, and verified multi-tenant backend foundation**, including cryptographic API key management, SHA-256 hash storage, customer application origin whitelisting, immutable audit trails, webhook dispatching with HMAC-SHA256 signatures, and an idempotent usage ledger. All 34 automated unit and integration tests across Phase 3, Phase 4, and Phase 6 pass cleanly (0 failures).

However, from an **operational and UI onboarding perspective**, the application is **PARTIAL** due to the following specific gaps:

1. **Self-Service Customer UI vs. Platform Superadmin UI:** The existing Developer Console (`src/components/dashboard/DeveloperDashboardView.tsx`) is designed as a *self-service tenant portal*. A logged-in user can create their own organization and manage its credentials. However, there is **no platform-wide superadmin interface** or endpoint (`GET /api/admin/organizations`) enabling the platform owner (`user.role === 'admin'`) to view, manage, or issue credentials for customer organizations they are not explicitly a member of.
2. **Backend-Only Features Missing in UI:** The backend endpoints for **Webhook Endpoints & Delivery Logs** (`server/routes/webhooks.ts`) and **Auditable Usage Metering** (`server/routes/organizations.ts` -> `/api/organizations/:orgId/usage`) are fully implemented and verified with database migrations and tests, but **have no corresponding tabs or UI controls** in `DeveloperDashboardView.tsx`.
3. **In-Dashboard Integration Quickstart & Embed Snippets:** While comprehensive developer documentation exists in `docs/saas/developer-sdk-and-integration.md` and runnable code is present in `demo/customer-portal/`, there is no in-dashboard UI tab displaying the customer's base URL, embed iframe code, or SDK installation snippet.

---

## 2. Feature-by-Feature Owner/Admin Workflow Audit

The table below documents the 8 core capabilities audited against the codebase:

| # | Capability | Status | UI Route / Component | Backend Endpoint | Database Tables | Verification Result | Usability / Technical Blockers |
|---|---|---|---|---|---|---|---|
| **1** | **View and manage customer organizations** | 🟡 **PARTIAL** | `/dashboard`<br>`DeveloperDashboardView.tsx`<br>(lines 351–389) | `GET /api/organizations`<br>(`server/routes/organizations.ts:22`) | `organizations`<br>`organization_members` | **PASS (Self-Service)**<br>Passed `TC-P4-02`. Filters strictly by `WHERE om.user_id = $1`. | **Platform Owner Gap:** Platform admin (`user.role === 'admin'`) cannot view or switch to customer organizations unless explicitly added to `organization_members`. No platform-wide admin query exists. |
| **2** | **Select existing org or create new one** | 🟢 **IMPLEMENTED** | `DeveloperDashboardView.tsx`<br>`CreateOrgModal.tsx` | `POST /api/organizations`<br>(`server/routes/organizations.ts:57`) | `organizations`<br>`organization_members` | **PASS**<br>Passed `TC-P4-01`. Creates organization, generates slug with random suffix, auto-assigns creator as `owner`. | None for self-service. Platform admin cannot create an organization and directly assign external customer emails as owner from UI. |
| **3** | **Issue test and live API keys** | 🟢 **IMPLEMENTED** | `CreateApiKeyModal.tsx`<br>(lines 1–217) | `POST /api/organizations/:orgId/keys`<br>(`server/routes/apiKeys.ts:51`) | `api_keys`<br>`api_key_audit_logs` | **PASS**<br>Passed `TC-P4-01`, `TC-P4-08`. Issues keys with `sec_live_` or `sec_test_` prefixes, configurable scopes, and optional expiration. | None. Key names are checked for active duplicates with HTTP 409 `KEY_NAME_EXISTS`. |
| **4** | **View secret key exactly once & store only hash** | 🟢 **IMPLEMENTED** | `ApiKeyRevealModal.tsx`<br>(lines 1–97) | `POST /api/organizations/:orgId/keys`<br>(`server/routes/apiKeys.ts:77`) | `api_keys`<br>(`key_hash` VARCHAR(64) UNIQUE,<br>`key_prefix` VARCHAR(32)) | **PASS**<br>Raw key returned only in `POST` response. Hashed via SHA-256 before insertion. `GET` returns only `key_prefix + '••••••••••••••••'`. | None. Clear alert banner warns user that the secret key cannot be retrieved again. |
| **5** | **Revoke and rotate keys** | 🟢 **IMPLEMENTED** | `DeveloperDashboardView.tsx`<br>(lines 569–591) | `DELETE /api/organizations/:orgId/keys/:keyId`<br>`POST /api/organizations/:orgId/keys/:keyId/rotate` | `api_keys`<br>`api_key_audit_logs` | **PASS**<br>Passed `TC-P4-09`. Rotation atomically deactivates old key, issues new active key, logs `action = 'rotated'`, and triggers reveal modal. | None. Non-destructive soft-revocation preserves historical audit records. |
| **6** | **Configure allowed domains** | 🟢 **IMPLEMENTED** | `DeveloperDashboardView.tsx`<br>"Allowed Domains" tab<br>`CreateAppModal.tsx` | `GET/POST/PATCH/DELETE`<br>`/api/organizations/:orgId/apps` | `customer_apps`<br>(`allowed_domains` TEXT[]) | **PASS**<br>Passed `TC-P4-04`, `TC-P4-10`. Enforced by `server/routes/v1/embed.ts` CSP `frame-ancestors` header. | None. Domain normalizer strips trailing slashes and normalizes lowercase strings. |
| **7** | **Access usage, request logs & webhook settings** | 🟡 **PARTIAL** | `DeveloperDashboardView.tsx`<br>"Audit Trail" tab only (lines 689–750) | Usage: `GET /api/organizations/:orgId/usage`<br>Webhooks: `GET/POST/PATCH/DELETE /api/organizations/:orgId/webhooks`<br>Deliveries: `GET /api/organizations/:orgId/webhooks/:endpointId/deliveries` | `webhook_endpoints`<br>`webhook_deliveries`<br>`organization_usage_ledger`<br>`api_key_audit_logs` | **PASS (Backend Only)**<br>Passed `TC-OPS-WH-CRUD-05`, `TC-OPS-METER-06`. Full API and DB support. | **UI Missing:** No tabs or controls in `DeveloperDashboardView.tsx` for webhooks, webhook test deliveries, or usage metering. Accessible only via direct REST API calls. |
| **8** | **Retrieve integration base URL, embed URL & SDK sample code** | 🟡 **PARTIAL** | External docs only:<br>`docs/saas/developer-sdk-and-integration.md`<br>`demo/customer-portal/` | Embed endpoint:<br>`GET /v1/embed/:roomId`<br>(`server/routes/v1/embed.ts`) | N/A | **PASS (Documentation)**<br>Passed `TC-SDK-13` through `TC-SDK-15`. Embed URL and SDK communication verified. | **Dashboard UI Missing:** Developer console lacks a "Quickstart" or "Docs" tab displaying base URLs, iframe embed snippet generator, and SDK initialization snippets. |

---

## 3. Customer Developer Experience Audit

### 3.1 Credential Management Experience
- **Navigation:** The developer console is directly accessible from the landing page navigation bar via the "Developer Console" button (`src/components/landing/LandingView.tsx:224`) and via direct route `/dashboard` or `/developer` (`src/App.tsx:49`).
- **Secret Hygiene:** When an API key is minted or rotated, the developer is presented with `ApiKeyRevealModal.tsx`, featuring a high-contrast copy button, a warning banner indicating the key will never be visible again, and a mandatory confirmation button (*"I have saved my secret key"*).
- **Environment Distinction:** Live keys (`sec_live_...`) are visually differentiated from Test keys (`sec_test_...`) using amber vs. blue badge color coding across all modal and table views.
- **Auditability:** Every credential action (`created`, `rotated`, `revoked`) is recorded in `api_key_audit_logs` with actor ID, IP address, and timestamp, rendered in the "Audit Trail" tab.

### 3.2 Embedding & Origin Security Experience
- **Customer Apps Management:** Under the "Allowed Domains" tab, developers can register multiple customer applications (e.g., LMS Portal, Tutor App) with custom brand colors and logos.
- **Allowed Domains Entry:** Multi-line or comma-separated origins can be entered (e.g. `https://lms.myedu.com`, `*.myedu.com`).
- **Enforcement:** When `/v1/embed/:roomId` is requested, `server/routes/v1/embed.ts` verifies that the `parentOrigin` query parameter matches the registered `customer_apps.allowed_domains` for that organization, and sets strict Content-Security-Policy headers:
  ```http
  Content-Security-Policy: frame-ancestors 'self' https://lms.myedu.com;
  ```

### 3.3 Developer Experience Gaps
1. **No In-Console Webhook Management:** While `webhook_endpoints` and `webhook_deliveries` tables and APIs exist, a customer cannot register a webhook URL, view past event deliveries, or trigger a test ping from the dashboard.
2. **No In-Console Usage Analytics:** While the `organization_usage_ledger` records participant billed minutes and `GET /api/organizations/:orgId/usage` aggregates them, no usage charts or summary widgets exist in the dashboard.
3. **No Embed Code Generator:** A customer must consult `docs/saas/developer-sdk-and-integration.md` to learn how to construct the iframe URL:
   ```html
   <iframe src="https://meet.mathsy.in/v1/embed/:roomId?token=:participantToken" allow="camera; microphone; display-capture"></iframe>
   ```
   Having an interactive copyable snippet generator in the dashboard would significantly accelerate developer onboarding.

---

## 4. Platform Tenant Isolation & Security Audit

### 4.1 Secret Key Protection Analysis
- **One-Way Cryptographic Hashing:** In `server/services/apiKeyService.ts`, the generated 32-byte high-entropy secret (`sec_live_...` or `sec_test_...`) is hashed using SHA-256:
  ```typescript
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  ```
- **Database Storage:** The database table `api_keys` stores `key_prefix` (e.g. `sec_live_a1b2c3d4`) and `key_hash` (64-character SHA-256 hex string). **The raw key is never stored in PostgreSQL or any cache.**
- **No Secret Key Leakage in GET Routes:** In `GET /api/organizations/:orgId/keys`, the query selects only non-secret columns and synthesizes `masked_key`:
  ```typescript
  masked_key: `${row.key_prefix}${"•".repeat(16)}`
  ```
- **Constant-Time Verification:** Verification in `verifyApiKey()` hashes incoming keys and performs constant-time byte comparisons via `crypto.timingSafeEqual()`, preventing timing attacks.
- **Logging Redaction:** The structured logger (`server/services/logger.ts`) automatically scrubs any string matching `sec_live_` or `sec_test_` from all request/response log outputs (verified by `TC-OPS-LOG-02`).

### 4.2 Multi-Tenant Data Isolation
- **Route-Level Authorization:** All tenant-scoped routes pass through `requireOrgRole(req, res, allowedRoles)` in `server/routes/apiKeys.ts`.
- **Query-Level Scoping:** Every SQL statement joins or filters against `organization_id = $1`. An authenticated user from Organization A cannot view, rotate, or revoke keys belonging to Organization B (verified by `TC-P4-03` and `TC-P4-06`).
- **System Tenant Safeguard (SEC-GAP-01):** The first-party platform organization (`00000000-0000-0000-0000-000000000001`) is hardcoded to permit access **only** if `req.user.role === 'admin'` (verified by `TC-P4-07`). Regular tutors or customer users cannot access the first-party system credentials.

### 4.3 Platform Admin vs. Organization Role Distinction
There are two distinct role hierarchies in the codebase:
1. **Platform User Role (`users.role`):** Can be `'admin'`, `'teacher'`, or `'student'`.
2. **Organization Member Role (`organization_members.role`):** Can be `'owner'`, `'admin'`, `'developer'`, `'member'`, or `'viewer'`.

**Audit Finding:** `requireOrgRole()` enforces that access to a customer organization requires an explicit membership row in `organization_members`. If the platform owner has `users.role === 'admin'`, but is not added as a member of Customer Organization X, the platform owner receives HTTP 403 `ORG_ACCESS_DENIED`.
- *Benefit:* Strict tenant isolation prevents accidental cross-tenant data leaks.
- *Limitation:* The platform owner currently lacks a platform-wide administrative "god mode" route (e.g., `GET /api/admin/organizations`) to inspect customer organizations, view their usage, or issue credentials on their behalf without manually inserting an `organization_members` record.

---

## 5. Existing Routes and API Endpoints

### 5.1 Multi-Tenant & Organization Endpoints (`server/routes/organizations.ts`)
| Method | Path | Auth / Role | Description |
|---|---|---|---|
| `GET` | `/api/organizations` | `requireAuth` | List organizations where the current user is a member |
| `POST` | `/api/organizations` | `requireAuth` | Create new organization (creator auto-assigned as `owner`) |
| `GET` | `/api/organizations/:orgId` | `requireOrgRole(viewer+)` | Get single organization metadata & settings |
| `PATCH` | `/api/organizations/:orgId` | `requireOrgRole(admin+)` | Update organization name and JSONB settings |
| `GET` | `/api/organizations/:orgId/usage` | `requireOrgRole(viewer+)` | Get aggregated auditable usage summary & billed minutes |
| `GET` | `/api/organizations/:orgId/apps` | `requireOrgRole(viewer+)` | List registered customer apps & allowed origins |
| `POST` | `/api/organizations/:orgId/apps` | `requireOrgRole(dev+)` | Register new customer app with allowed parent domains |
| `PATCH` | `/api/organizations/:orgId/apps/:appId` | `requireOrgRole(dev+)` | Update allowed domains or branding for customer app |
| `DELETE` | `/api/organizations/:orgId/apps/:appId` | `requireOrgRole(admin+)` | Delete customer app and origin bindings |

### 5.2 API Key Lifecycle Endpoints (`server/routes/apiKeys.ts`)
| Method | Path | Auth / Role | Description |
|---|---|---|---|
| `POST` | `/api/organizations/:orgId/keys` | `requireOrgRole(dev+)` | Generate new API key (returns `rawKey` once) |
| `GET` | `/api/organizations/:orgId/keys` | `requireOrgRole(viewer+)` | List masked keys for organization (`masked_key`) |
| `DELETE` | `/api/organizations/:orgId/keys/:keyId` | `requireOrgRole(admin+)` | Revoke an API key (soft-revoke, sets `is_active = FALSE`) |
| `POST` | `/api/organizations/:orgId/keys/:keyId/rotate` | `requireOrgRole(admin+)` | Atomically rotate API key (deactivates old, issues new `rawKey`) |
| `GET` | `/api/organizations/:orgId/keys/audit` | `requireOrgRole(admin+)` | Get immutable key lifecycle audit log history |

### 5.3 Webhook Management Endpoints (`server/routes/webhooks.ts`)
| Method | Path | Auth / Role | Description |
|---|---|---|---|
| `GET` | `/api/organizations/:orgId/webhooks` | `requireOrgRole(viewer+)` | List registered webhook endpoints |
| `POST` | `/api/organizations/:orgId/webhooks` | `requireOrgRole(dev+)` | Register webhook endpoint (returns signing secret once) |
| `PATCH` | `/api/organizations/:orgId/webhooks/:endpointId` | `requireOrgRole(admin+)` | Update webhook URL, subscriptions, or active status |
| `DELETE` | `/api/organizations/:orgId/webhooks/:endpointId` | `requireOrgRole(admin+)` | Delete webhook endpoint |
| `GET` | `/api/organizations/:orgId/webhooks/:endpointId/deliveries` | `requireOrgRole(viewer+)` | List recent webhook delivery logs and HTTP statuses |
| `POST` | `/api/organizations/:orgId/webhooks/:endpointId/test` | `requireOrgRole(dev+)` | Dispatch an immediate test webhook ping |

### 5.4 B2B API v1 Service Endpoints (`server/routes/v1/`)
| Method | Path | Auth / Guard | Description |
|---|---|---|---|
| `POST` | `/v1/rooms` | API Key (`rooms:write`) | Create video room with metadata, recording, and camera lock |
| `GET` | `/v1/rooms/:roomIdentifier` | API Key (`rooms:read`) | Get room metadata and current status |
| `POST` | `/v1/rooms/:roomIdentifier/end` | API Key (`rooms:write`) | Terminate active meeting room |
| `GET` | `/v1/rooms/:roomIdentifier/participants` | API Key (`rooms:read`) | List participants currently in room |
| `POST` | `/v1/rooms/:roomIdentifier/tokens` | API Key (`tokens:write`) | Mint signed participant JWT with role and permissions |
| `GET` | `/v1/embed/:roomId` | Origin Whitelist + CSP | Embeddable HTML page for iframe integration |

---

## 6. Automated Test Execution Evidence

All test suites were executed using the native Node.js test runner (`npx tsx --test`) against the active local database:

```bash
npx tsx --test \
  tests/customer_api_credentials_phase4.test.ts \
  tests/saas_operations_phase6.test.ts \
  tests/sdk_and_external_integration.test.ts
```

### Test Results Summary:
- **Total Test Suites:** 3
- **Total Tests:** 34
- **Passed:** 34
- **Failed:** 0
- **Duration:** 1,142 ms

### Breakdown by Suite:

#### 1. Phase 4: Customer API Credentials & Tenant Management Suite (`tests/customer_api_credentials_phase4.test.ts`)
| Test ID | Test Description | Result | Duration |
|---|---|---|---|
| `TC-P4-01` | Creates organization and automatically assigns creator as owner | ✅ PASS | 49.3 ms |
| `TC-P4-02` | Organization list strictly isolates organizations per user membership | ✅ PASS | 29.8 ms |
| `TC-P4-03` | Rejects cross-tenant access to organization details and updates | ✅ PASS | 14.5 ms |
| `TC-P4-04` | Manages Customer Apps with allowed_domains and branding | ✅ PASS | 17.2 ms |
| `TC-P4-05` | Rejects duplicate app names for the same organization with HTTP 409 | ✅ PASS | 5.3 ms |
| `TC-P4-06` | Forbids cross-tenant listing, updating, or deleting of customer apps | ✅ PASS | 3.6 ms |
| `TC-P4-07` | `[SEC-GAP-01]` Rejects unauthorized tutor access to system tenant API keys (403) | ✅ PASS | 4.1 ms |
| `TC-P4-08` | `[SEC-GAP-02]` Returns HTTP 409 KEY_NAME_EXISTS when creating duplicate active key | ✅ PASS | 8.0 ms |
| `TC-P4-09` | Supports key rotation, revocation, and re-creation of previously revoked name | ✅ PASS | 15.9 ms |
| `TC-P4-10` | Deletes customer app and cleans up domain bindings | ✅ PASS | 3.5 ms |

#### 2. Phase 6: SaaS Operations Test Suite (`tests/saas_operations_phase6.test.ts`)
| Test ID | Test Description | Result | Duration |
|---|---|---|---|
| `TC-OPS-REQID-01` | Adopts valid X-Request-Id and generates UUIDv4 for missing or malformed inputs | ✅ PASS | 24.5 ms |
| `TC-OPS-LOG-02` | Structured JSON logger automatically redacts API keys, JWTs, secrets, and auth headers | ✅ PASS | 0.5 ms |
| `TC-OPS-SSRF-03` | Webhook URL validator blocks loopback, private RFC1918, and cloud metadata targets | ✅ PASS | 0.3 ms |
| `TC-OPS-WH-SIG-04` | Computes HMAC-SHA256 signature and validates using SDK verifyWebhookSignature | ✅ PASS | 0.4 ms |
| `TC-OPS-WH-CRUD-05` | Enforces organization isolation on webhook configuration and delivery history | ✅ PASS | 3.9 ms |
| `TC-OPS-METER-06` | Accurately calculates whole billed minutes and enforces ledger idempotency | ✅ PASS | 11.9 ms |
| `TC-OPS-HEALTH-07` | Health probes report accurate control-plane liveness, DB readiness, and SFU component | ✅ PASS | 116.5 ms |
| `TC-OPS-RATELIMIT-08` | Rejects excessive spam bursts on authentication endpoint with 429 | ✅ PASS | 24.3 ms |

#### 3. Phase 3: Developer SDK & External Integration Suite (`tests/sdk_and_external_integration.test.ts`)
| Test ID | Test Description | Result | Duration |
|---|---|---|---|
| `TC-SDK-01` | Rejects missing, non-string, or invalid API key formats | ✅ PASS | 0.5 ms |
| `TC-SDK-02` | Throws SecurityError if initialized in a browser environment | ✅ PASS | 0.1 ms |
| `TC-SDK-03` | Successfully authenticates valid API key and verifies scopes | ✅ PASS | 31.5 ms |
| `TC-SDK-04` | Creates a meeting room with custom title, metadata, and auto roomCode | ✅ PASS | 23.7 ms |
| `TC-SDK-05` | Retrieves room metadata by roomCode and UUID | ✅ PASS | 13.5 ms |
| `TC-SDK-06` | Lists participants in the room | ✅ PASS | 8.0 ms |
| `TC-SDK-07` | Fails when API key lacks `rooms:write` permission | ✅ PASS | 3.3 ms |
| `TC-SDK-08` | Tenant B cannot access Tenant A's room (Tenant Isolation) | ✅ PASS | 11.5 ms |
| `TC-SDK-09` | Mints authoritative tutor token with host privileges | ✅ PASS | 6.9 ms |
| `TC-SDK-10` | Mints student token and strips host privileges authoritatively | ✅ PASS | 3.8 ms |
| `TC-SDK-11` | Rejects token issuance when API key lacks `tokens:write` permission | ✅ PASS | 1.8 ms |
| `TC-SDK-12` | Tenant B cannot mint token for Tenant A's room | ✅ PASS | 2.5 ms |
| `TC-SDK-13` | Validates required options and generates iframe with security attributes | ✅ PASS | 0.4 ms |
| `TC-SDK-14` | Dispatches typed postMessage commands to iframe using exact target origin | ✅ PASS | 0.2 ms |
| `TC-SDK-15` | Emits typed events to subscribers and ignores untrusted event origins | ✅ PASS | 0.1 ms |
| `TC-SDK-16` | Ends meeting through Server SDK and verifies isActive: false | ✅ PASS | 10.5 ms |

---

## 7. Recommended Smallest Next Implementation Step

To elevate customer onboarding and developer operations from **PARTIAL** to **COMPLETE**, the following two small, non-breaking next steps are identified:

### Option A: Complete Developer Self-Service UI (Recommended Next Step)
*Scope: Frontend only. Zero database or backend route changes needed.*
1. In `src/components/dashboard/DeveloperDashboardView.tsx`, add two tabs to the existing tab bar:
   - **"Webhooks" Tab:** Expose existing endpoints (`GET/POST/PATCH/DELETE /api/organizations/:orgId/webhooks`), allowing developers to register webhooks, reveal the signing secret once, trigger test pings (`POST .../test`), and view delivery logs.
   - **"Usage & Integration" Tab:** Display billed minutes from `GET /api/organizations/:orgId/usage`, and render copyable quickstart snippets (API base URL, iframe embed code with `:roomId` placeholder, and `@mathsy/meet-sdk` sample setup code).
2. *Estimated Effort:* 1 focused frontend checkpoint. All backend routes and test suites are already in place and passing.

### Option B: Platform Superadmin Organization Switcher
*Scope: One backend endpoint + minor UI dropdown enhancement.*
1. Add `GET /api/admin/organizations` guarded strictly by `req.user.role === 'admin'`.
2. In `DeveloperDashboardView.tsx`, if the logged-in user has `user.role === 'admin'`, allow them to view and select any organization in the database (or create organizations on behalf of customers).
3. Update `requireOrgRole()` to optionally allow platform superadmins (`req.user.role === 'admin'`) to manage any organization.

---

## 8. Updated Remaining Phase 8 Operational Blockers

With Checkpoint 1 (Dockerization & Fail-Fast Environment Validation) and Checkpoint 2 (Admin API Issuance & Onboarding Audit) completed, the updated operational blockers before staging deployment are:

| # | Blocker / Task | Category | Current Status | Ownership | Required Action |
|---|---|---|---|---|---|
| **1** | **Customer Dashboard Webhook & Usage Tabs** | Frontend UI | 🟡 Pending Option A | Frontend Dev | Add Webhooks and Usage/Quickstart tabs to `DeveloperDashboardView.tsx` to surface existing backend functionality. |
| **2** | **Platform Superadmin Cross-Tenant Mode** | Control Plane | 🟡 Pending Option B | Backend Dev | Implement `GET /api/admin/organizations` and superadmin bypass in `requireOrgRole` for platform owner onboarding of enterprise clients. |
| **3** | **Staging Infrastructure Provisioning** | Operations | 🔴 Blocked | DevOps / Cloud Admin | Provision isolated staging PostgreSQL, MongoDB instance, and SFU VM (separate from production `rtc.mathsy.in`). |
| **4** | **Staging Secret Generation & Injection** | Security / Ops | 🔴 Blocked | DevOps / Security Admin | Generate cryptographically random 32-byte staging secrets (`JWT_SECRET`, `PARTICIPANT_JWT_SECRET`, `WEBHOOK_ENCRYPTION_KEY`). |
| **5** | **Runtime SFU Secret Alignment Verification** | Operations | 🔴 Blocked | DevOps | Run non-secret hash comparison `sha256(PARTICIPANT_JWT_SECRET)` across control-plane and SFU hosts to ensure matching token signing keys. |
| **6** | **Staging Database Backup Drill** | Reliability | 🔴 Blocked | DBA / DevOps | Execute `pg_dump` and test restore drill on disposable staging database per runbook Section 1. |
| **7** | **Phase 9 Manual Media E2E Testing** | QA / Product | 🔴 Reserved | QA Team | Conduct manual camera/mic audio testing, screen share, and whiteboard verification against the staging SFU. |

---

## 9. Safety & Compliance Confirmation

- **Read-Only Audit:** No production systems were accessed or altered.
- **No SSH / Remote Execution:** No connection was attempted to `rtc.mathsy.in` / `80.225.208.166`.
- **Zero Secret Exposure:** No secret keys or hashes were printed or recorded in this audit.
- **Preservation of Codebase:** All existing uncommitted changes, Dockerfiles, and test suites were preserved untouched.
- **SDK Unpublished:** No packages were published to npm.
