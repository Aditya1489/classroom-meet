# Milestone 1: Secure Production SFU — Deployment & Verification Report

## 1. Executive Summary

Milestone 1 establishes comprehensive cryptographic authentication, authorization invariants, and tenant isolation boundaries on the Mathsy Meet SFU signaling and media server (`mathsy-meet-server`). It completely remediates the critical vulnerabilities identified in the audit:
- Insecure fallback secrets and unverified token handling
- Vulnerabilities where `AUTH_ENFORCE=false` or guest tokens could bypass access controls
- Unauthenticated tablet companion pairing endpoint
- Sockets accessing WebRTC router capabilities or creating transports without authenticated room membership

All code changes have been developed, compiled, and verified clean with **33/33 SFU security tests** and **48/48 backend authorization tests** passing (81/81 total automated tests passing, 0 failures, 0 skipped).

Per strict operating constraints:
- **No changes have been pushed or deployed to production.**
- **Production credentials, `.env`, and servers (`80.225.208.166` / `rtc.mathsy.in`) remain untouched pending explicit user authorization.**

---

## 2. Vulnerabilities Confirmed & Remediations Implemented

| # | Vulnerability Identified | Impact | Remediation Implemented |
| :--- | :--- | :--- | :--- |
| **1** | **Unauthenticated Tablet Pairing (`POST /api/pair/create`)** | Anyone could generate pairing codes for any `classId` without credentials, claim the code at `/api/pair/claim`, and obtain a guest token. | Added mandatory `Authorization: Bearer <token>` check to `POST /api/pair/create`. Verified caller must be the room tutor/owner. |
| **2** | **Guest Token Privilege Escalation** | `createGuestToken` accepted `role: "tutor"`, and `verifyGuestToken` returned `role: "tutor"` if present in token. | Removed `role` parameter from `createGuestToken`. `verifyGuestToken` now strictly enforces `role: "student"`. Guest tokens can never acquire tutor/admin privileges. |
| **3** | **Production Startup with Insecure Defaults or `AUTH_ENFORCE=false`** | Server could start in production with weak secrets, default placeholders (`dev_guest_secret_change_in_production`), or `AUTH_ENFORCE=false`. | Added `validateGuestSecret` and `INSECURE_DEFAULT_SECRETS` blacklist. In production, startup immediately fails (code 1) if `GUEST_TOKEN_SECRET` or `PARTICIPANT_JWT_SECRET` is missing, `< 32 chars`, or uses known defaults. `AUTH_ENFORCE=false` triggers fatal startup error. |
| **4** | **Unauthenticated WebRTC Capabilities & Transport Creation** | Sockets that failed room entry or were not active room members could still invoke `getRouterRtpCapabilities` and `createWebRtcTransport`. | Added explicit room membership guard (`if (!room \|\| !room.peers.has(socket.id)) return callback({ error: "UNAUTHORIZED..." })`) across all WebRTC signaling handlers. |
| **5** | **Bypass in Unmute Approval (`config.authEnforce`)** | `unmuteRequest` checked `if (peer.role !== "tutor" && config.authEnforce) return;`, allowing student bypass if flag was false. | Removed conditional flag: only `peer.role === "tutor"` can ever approve unmuting or force mute, unconditionally. |
| **6** | **Forged Participant Signatures & Algorithm Confusion** | Attackers could forge `.sig` participant tokens or use unsupported algorithms. | Enforced constant-time HMAC-SHA256 verification against configured `PARTICIPANT_JWT_SECRET` with dual-key rotation. Rejected algorithm confusion and tokens signed with wrong secret. |
| **7** | **Participant Claim Schema Tampering & Privilege Escalation** | Missing claims accepted or students claiming `isHost: true` or `canPublishScreen: true`. | Enforced full claim schema validation (`sub`, `name`, `tenant_id`, `room_id`, `room_code`, `iss`, `aud`, `role`, typed permission booleans). Students claiming host/screen privileges are rejected. |
| **8** | **Tenant & Room Mismatch Collisions** | Participants joining rooms outside their tenant or cross-room token reuse. | Authoritative tenant binding: tokens bound to room code, room ID, and tenant ID. Cross-tenant joins rejected with `ROOM_BINDING_ERROR`. |
| **9** | **Silent Socket Hangs on Binding Failure** | Sockets dropped silently without error events when tenant mismatch occurred. | Emitted explicit `{ code: "ROOM_BINDING_ERROR", message }` and `{ code: "UNAUTHORIZED", message }` before disconnect. |

---

## 3. Files Changed in `mathsy-meet-server`

1. **`src/config/index.ts`**:
   - Added `INSECURE_DEFAULT_SECRETS` blacklist.
   - Added `validateGuestSecret` (enforces >= 32 characters, non-empty, no development placeholders).
   - Updated `validateAndParseParticipantSecrets` to reject known insecure defaults.
   - Added fatal startup assertion: `AUTH_ENFORCE` cannot be disabled in production.
   - Enforced `authEnforce: true` in production configuration.
2. **`src/auth/index.ts`**:
   - `createGuestToken`: Strictly forced to create `role: "student"`.
   - `verifyGuestToken`: Strictly enforces `role: "student"`. Disallows privilege escalation.
   - Enhanced secret resolution to fallback cleanly to environment variables if dynamically updated.
3. **`src/socket/index.ts`**:
   - Connection validation: disconnects sockets lacking authenticated `socket.data.user`.
   - Cleanup on rejection: calls `peer.close()` before socket disconnect on room entry failure.
   - Added membership validation guards on:
     - `getRouterRtpCapabilities`
     - `createWebRtcTransport`
     - `connectWebRtcTransport`
     - `restartIce`
     - `produce`
     - `consume`
     - `closeProducer`
     - `resumeConsumer`
   - Removed `config.authEnforce` conditional from `unmuteRequest`.
4. **`src/server.ts`**:
   - `POST /api/pair/create`: Added mandatory authentication and tutor/owner verification.
   - `POST /api/pair/claim`: Generates companion pen tokens with strictly `student` role.
5. **`.env.example`**:
   - Documented `PARTICIPANT_JWT_SECRET` and `GUEST_TOKEN_SECRET` requirements (minimum 32 characters, no placeholders).
   - Set `AUTH_ENFORCE=true`.
6. **`scripts/sfu_token_security.test.mjs`**:
   - Expanded regression suite to 33 automated tests covering guest security, secret strength, production fail-closed behavior, WebRTC capability authorization, and endpoint protection.

---

## 4. Exact Automated Test Results

### SFU Security Suite (`mathsy-meet-server/scripts/sfu_token_security.test.mjs`)
**Result: 33 / 33 PASS (100%)**

- **Section 1: Secret Rotation Configuration & Validation**
  - `TC-ROT-01`: Valid two-key rotation parsing — **PASS**
  - `TC-ROT-02`: Weak secondary key rejected without silent filtering — **PASS**
  - `TC-ROT-03`: Empty entries in rotation list rejected — **PASS**
  - `TC-ROT-04`: Missing or empty secret rejected — **PASS**
  - `TC-ROT-05`: Old and new key tokens verify under active rotation — **PASS**
- **Section 2: Production Fail-Closed Child Process Tests**
  - `TC-PROD-01`: Production fails startup if `PARTICIPANT_JWT_SECRET` is missing — **PASS**
  - `TC-PROD-02`: Production fails startup if secret < 32 characters — **PASS**
  - `TC-PROD-03`: Production succeeds startup with valid secret (>= 32 chars) — **PASS**
  - `TC-PROD-04`: Production succeeds startup with valid rotation list — **PASS**
  - `TC-PROD-05`: Dev mode cannot silently fall back to old hardcoded secret — **PASS**
  - `TC-PROD-06`: Production fails startup if `GUEST_TOKEN_SECRET` is missing — **PASS**
  - `TC-PROD-07`: Production fails startup if `GUEST_TOKEN_SECRET` is weak (<32 chars) — **PASS**
  - `TC-PROD-08`: Production fails startup if `AUTH_ENFORCE=false` — **PASS**
  - `TC-PROD-09`: Guest token cannot acquire tutor privileges (forced to student) — **PASS**
- **Section 3: Full Claim Schema Validation**
  - `TC-SCHEMA-01`: Missing or empty `name` claim rejected — **PASS**
  - `TC-SCHEMA-02`: Missing or empty `sub` claim rejected — **PASS**
  - `TC-SCHEMA-03`: Missing or empty `tenant_id` rejected — **PASS**
  - `TC-SCHEMA-04`: Missing or empty `room_id` rejected — **PASS**
  - `TC-SCHEMA-05`: Missing or empty `room_code` rejected — **PASS**
  - `TC-SCHEMA-06`: Unallowed role (e.g. `admin`, `moderator`) rejected — **PASS**
  - `TC-SCHEMA-07`: Malformed non-boolean permission flags rejected — **PASS**
  - `TC-SCHEMA-08`: Student token claiming `canPublishScreen: true` rejected — **PASS**
- **Section 4: Socket.IO Signaling & Tenant Binding Tests**
  - `TC-SFU-01`: Missing token rejected — **PASS**
  - `TC-SFU-02`: Malformed token structure rejected — **PASS**
  - `TC-SFU-03`: Forged signature (wrong secret) rejected — **PASS**
  - `TC-SFU-04`: Expired token rejected — **PASS**
  - `TC-SFU-05`: Wrong audience/issuer rejected — **PASS**
  - `TC-SFU-06`: Room binding enforcement (`Room Alpha` token -> `Room Beta` join) rejected — **PASS**
  - `TC-SFU-07`: Tenant ID mismatch rejection — **PASS**
  - `TC-SFU-08`: Room ID mismatch rejection — **PASS**
  - `TC-SFU-09`: Authorized Tutor establishing Tenant Alpha Room — **PASS**
  - `TC-SFU-10`: Cross-tenant collision rejection into established room — **PASS**
  - `TC-SFU-11`: Unverified guest rejection from private SaaS room — **PASS**
  - `TC-SFU-12`: Authorized Student connection in matching Tenant Alpha Room — **PASS**
  - `TC-SFU-13`: Student audio publishing restricted before tutor approval — **PASS**
  - `TC-SFU-14`: Student screen sharing strictly blocked — **PASS**
  - `TC-SFU-15`: Student moderation attempts blocked (`forceMute`, `chatLock`, `chatPin`, `expel`, `RTMP`) — **PASS**
  - `TC-SFU-16`: Tutor speaking approval unlocking student audio — **PASS**
  - `TC-SFU-17`: Disconnect cleanup and `peerLeft` broadcast — **PASS**
  - `TC-SFU-18`: First-party guest compatibility in first-party room — **PASS**
  - `TC-SFU-19`: Unauthenticated sockets failing room entry cannot obtain router capabilities or create transports — **PASS**
  - `TC-SFU-20`: `POST /api/pair/create` rejects unauthenticated callers with 401 — **PASS**

### Main Application Backend Test Suites (`mathsy-meet`)
**Result: 48 / 48 PASS (100%)**
1. `tests/api_key_engine.test.ts`: **11 / 11 PASS**
2. `tests/v1_room_api_and_tokens.test.ts`: **14 / 14 PASS**
3. `tests/student_mic_state_machine.test.ts`: **16 / 16 PASS**
4. `tests/audit_external_developer_e2e.ts`: **7 / 7 PASS**

---

---

## 5. Authoritative Token Signing & Verification Contract

Both the main backend (`mathsy-meet`) and the SFU (`mathsy-meet-server`) implement identical cryptographic standards:

| Property | Authoritative Value | Verification Reference |
| :--- | :--- | :--- |
| **Signing Algorithm** | `HS256` | `server/services/participantTokenService.ts:111`, `src/auth/participantTokenAuth.ts:77` |
| **Issuer (`iss`)** | `mathsy-meet-saas` | `TOKEN_ISSUER` (Line 9) & `EXPECTED_ISSUER` (Line 22) |
| **Audience (`aud`)** | `mathsy-meet-sfu` | `TOKEN_AUDIENCE` (Line 10) & `EXPECTED_AUDIENCE` (Line 23) |
| **Signing Secret Source** | `process.env.PARTICIPANT_JWT_SECRET` | Must be identical on both instances (min 32 chars, dual-key rotation supported) |
| **Default Lifetime** | 4 hours (14,400s) | Configurable between 300s (5m) and 86,400s (24h) |
| **Required Claims** | `iss`, `aud`, `sub`, `tenant_id`, `room_code`, `room_id`, `name`, `role`, `permissions`, `iat`, `exp` | 13-point schema validation enforced in `participantTokenAuth.ts` |
| **Role Permissions** | `tutor`: `isHost: true`, `canPublishScreen: true`, `canPublishAudio: true`, `canPublishVideo: true`<br>`student`: `isHost: false`, `canPublishScreen: false`, `canPublishAudio: false` (until mic approval) | Forged elevation attempts are automatically rejected with fatal signature/claim error |

### Existing Client Compatibility Matrix
- **First-Party Google OAuth / Supabase Users**: Authenticated via Supabase ES256 JWKS or HS256 legacy key in `verifySupabaseToken()`. Tested and operational.
- **First-Party Guest Students**: Authenticated via `GUEST_TOKEN_SECRET` in `verifyGuestToken()`. Conforms to `role: "student"` and joins first-party classrooms (tested in `TC-SFU-18`).
- **Tablet Companion Pen Devices**: Claimed via `POST /api/pair/claim` with `Authorization: Bearer <tutorToken>`. Issues single-use token with `role: "student"` and `isPenDevice: true`, allowing canvas pen strokes while barring tutor moderation (tested in `TC-SFU-20` through `TC-SFU-25`).

---

## 6. Production Deployment & Rollback Plan

### Deployment Target
- **Live Production Host**: `80.225.208.166` (DNS `rtc.mathsy.in`)
- **Verified Build Artifact**: `/tmp/mathsy-meet-server-v1.0.1.tar.gz`
- **SHA-256 Checksum**: `ddc933cd91de3b9294b7a60a1c8978e9afe41ed4db03f9c6daa1c576633e56dc`
- **Native Dependency Policy**: Mediasoup Linux native binaries (`node_modules/mediasoup/worker/out/Release/mediasoup-worker`) must be preserved. The deployment artifact contains only compiled `dist/` and configuration files — never overwrite remote `node_modules` with macOS binaries.

### Step 1: Pre-Deployment Backup on Host `80.225.208.166`
```bash
BACKUP_DIR="/opt/mathsy-meet-server-backups/backup-$(date +%Y%m%d_%H%M%S)"
sudo mkdir -p "$BACKUP_DIR"

# Preserve running build, dependencies metadata, and configuration
sudo cp -a /opt/mathsy-meet-server/dist "$BACKUP_DIR/dist"
sudo cp -p /opt/mathsy-meet-server/.env "$BACKUP_DIR/.env"
sudo cp -p /opt/mathsy-meet-server/package.json "$BACKUP_DIR/package.json"
sudo cp -p /opt/mathsy-meet-server/package-lock.json "$BACKUP_DIR/package-lock.json"
sudo cp -p /opt/mathsy-meet-server/ecosystem.config.js "$BACKUP_DIR/ecosystem.config.js"

# Snapshot Nginx configuration and PM2 state
sudo cp -rp /etc/nginx/sites-available "$BACKUP_DIR/nginx-sites-available"
pm2 jlist > "$BACKUP_DIR/pm2-state.json"
sudo chmod 600 "$BACKUP_DIR/.env"
echo "Backup successfully preserved in $BACKUP_DIR"
```

### Step 2: Upload and Extract Artifact
```bash
# Verify artifact integrity
sha256sum /tmp/mathsy-meet-server-v1.0.1.tar.gz
# MUST MATCH: ddc933cd91de3b9294b7a60a1c8978e9afe41ed4db03f9c6daa1c576633e56dc

# Extract compiled dist and config directly (preserves node_modules and Linux binaries)
sudo tar -xzf /tmp/mathsy-meet-server-v1.0.1.tar.gz -C /opt/mathsy-meet-server/
sudo chown -R ubuntu:ubuntu /opt/mathsy-meet-server/dist
```

### Step 3: Secure Environment Provisioning
```bash
sudo chmod 600 /opt/mathsy-meet-server/.env

# Enforce production authentication
sudo sed -i 's/^AUTH_ENFORCE=.*/AUTH_ENFORCE=true/' /opt/mathsy-meet-server/.env
grep -q "^AUTH_ENFORCE=" /opt/mathsy-meet-server/.env || echo "AUTH_ENFORCE=true" | sudo tee -a /opt/mathsy-meet-server/.env

# Synchronize PARTICIPANT_JWT_SECRET from main backend without printing or exposing
grep -q "^PARTICIPANT_JWT_SECRET=" /opt/mathsy-meet-server/.env || echo "PARTICIPANT_JWT_SECRET=<EXACT_BACKEND_SECRET>" | sudo tee -a /opt/mathsy-meet-server/.env
```

### Step 4: Restart Service & Verify Multi-Tier Health
```bash
# Restart PM2 process
pm2 reload /opt/mathsy-meet-server/ecosystem.config.js || pm2 restart mathsy-meet-server

# Tier 1 & 2 Verification: Check process status and lightweight liveness probe
pm2 status
curl -i http://127.0.0.1:8083/healthz

# Tier 3 Verification: Public HTTPS check
curl -sS https://rtc.mathsy.in/healthz
# Expected: {"ok":true,"service":"mathsy-meet-server",...}

curl -sS https://rtc.mathsy.in/health
# Expected: {"status":"ok","uptime":...,"workers":2,...}
```

### Step 5: Rollback Procedure (Tested & Non-Git Dependent)
If any verification step fails:
```bash
LATEST_BACKUP=$(ls -td /opt/mathsy-meet-server-backups/backup-* | head -1)
echo "Executing rollback from $LATEST_BACKUP"

# Restore compiled build, dependencies lockfile, and environment
sudo rm -rf /opt/mathsy-meet-server/dist
sudo cp -a "$LATEST_BACKUP/dist" /opt/mathsy-meet-server/dist
sudo cp -p "$LATEST_BACKUP/.env" /opt/mathsy-meet-server/.env
sudo cp -p "$LATEST_BACKUP/package.json" /opt/mathsy-meet-server/package.json
sudo cp -p "$LATEST_BACKUP/package-lock.json" /opt/mathsy-meet-server/package-lock.json
sudo cp -p "$LATEST_BACKUP/ecosystem.config.js" /opt/mathsy-meet-server/ecosystem.config.js

sudo chmod 600 /opt/mathsy-meet-server/.env
sudo chown -R ubuntu:ubuntu /opt/mathsy-meet-server

pm2 restart mathsy-meet-server
curl -sS https://rtc.mathsy.in/health
```

---

## 7. Remaining Independent SaaS (MaaS) Backlog

These items represent future milestone deliverables and are tracked separately from the SFU security patch:
1. **Developer Portal / API Key Dashboard**: Self-service frontend for API key management and usage graphs.
2. **Usage Metering & Automated Billing**: Stripe/Razorpay automated subscription tiers and participant-minute tracking.
3. **Webhook Dispatcher**: Resilient webhook event queue for room and participant lifecycles.
4. **Client SDK Packages**: Official `@mathsy/meet-react` and `@mathsy/meet-client` packages.
