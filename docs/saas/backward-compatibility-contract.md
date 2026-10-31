# Mathsy Meet — Client Integration Stability & Zero-Breaking-Change Contract

This document outlines the strict backward-compatibility rules governing all changes, updates, and releases to Mathsy Meet to guarantee zero disruption for platforms (such as Mathsy or third-party LMS portals) that integrate Mathsy Meet into their web applications.

---

## 1. Core Principle: Transparent Upgrades

Mathsy Meet is architected as an embeddable SaaS platform. When you make changes to Mathsy Meet:
* **Client Frontend Code Needs Zero Updates:** Improvements to in-room UI, collaborative whiteboard tools, participant layouts, chat, and WebRTC media codecs load automatically inside client iframes or popup tabs.
* **Client Backend Code Needs Zero Updates:** Existing API requests (`/api/v1/rooms`, `/api/v1/sso/launch-token`, `/api/v1/sso/consume-token`) continue to work seamlessly.

---

## 2. API Contract Immutability (`/api/v1/...`)

1. **No Removal or Renaming:**
   Never remove, rename, or change data types of existing fields in request bodies or response payloads:
   - Request fields: `roomCode`, `userId`, `email`, `name`, `role`, `externalIssuer`, `permissions`
   - Response fields: `launchToken`, `launchUrl`, `embedUrl`, `participantToken`, `participantId`, `claims`
2. **Additive Changes Only:**
   New request parameters must be strictly optional with safe, backwards-compatible defaults. New response properties may be added additively without altering existing structures.
3. **Route Versioning:**
   All public B2B REST endpoints must permanently retain the `/api/v1/` prefix.

---

## 3. Route & Embed URL Stability

1. **Permanent Routes:**
   - In-page iframe embed URL: `/embed/:roomCode`
   - Standalone meeting URL: `/meet/:roomCode`
   These URL structures must never be renamed or redirected.
2. **SSO Hash Protocol:**
   The URL hash `#sso_token=<token>` must remain permanently supported. On page load, the frontend client will automatically extract the launch token and exchange it for a participant JWT session without presenting a second authentication screen.
3. **Iframe Frame-Ancestors:**
   Never introduce `X-Frame-Options: DENY` or restrictive static CSP headers. Dynamic CSP `frame-ancestors` must always evaluate both `customer_apps.allowed_domains` and verified `organization_sso_domains` from PostgreSQL.

---

## 4. Additive Database Migrations Only

1. **Non-Destructive DDL:**
   Never drop or rename active database tables or columns that currently running backend code or existing client queries rely on.
2. **Safe Defaults:**
   Any newly added columns must include a safe `DEFAULT` value or allow `NULL`.
3. **Continuous Data Isolation:**
   All database queries must enforce multi-tenant organization boundary checks (`organization_id = $1`).

---

## 5. Deployment & Production Safety

1. **SFU Media Isolation:**
   Never hard-restart the mediasoup media process (`mathsy-meet-server`) during active peak classroom hours, as this will drop ongoing live WebRTC peer connections.
2. **Control-Plane Zero-Downtime:**
   Deploy control-plane backend updates using graceful PM2 reloads (`pm2 restart mathsy-meet-control-plane`) with preflight checks and health probe verification (`/api/health`).
3. **Mandatory Pre-Release Regression Testing:**
   Before any production release, verify:
   - Dynamic CORS & Domain Normalization tests (`tests/dynamic_cors_and_domain_sso.test.ts`)
   - SSO & Automatic Provisioning suite (`tests/organization_sso_phase9.test.ts`)
   - Server & Frontend builds (`npm run build:server`, `npm run build`)
   - SDK typecheck (`npm --prefix sdk run typecheck`)

