# Mathsy Meet SaaS — Usage Metering & Quota Enforcement

**Document:** `docs/saas/usage-metering.md`  
**Date:** October 2026  
**Status:** Metering & Billing Architecture Specification

---

## 1. Auditable Participant-Minute Model

In commercial video infrastructure, billing is calculated based on **Participant-Minutes** consumed during active media sessions.

### Mathematical Definition:
$$\text{Total Usage} = \sum_{p \in \text{Participants}} \left\lceil \frac{\max(0, T_{\text{leave}}(p) - T_{\text{join}}(p))}{60} \right\rceil \text{ minutes}$$

- Every connected participant consumes minutes independently.
- A 60-minute room with 10 attendees generates:
  $$10 \text{ participants} \times 60 \text{ minutes} = \mathbf{600\text{ Participant-Minutes}}$$
- Each session is rounded up to the nearest whole minute for billing auditability.

---

## 2. Session Lifecycle & State Transitions

```
[Token Issued] 
      │
      ▼
[Socket Connect & Transport Ready] ──► Record: `participant_sessions` (joined_at = NOW())
      │
      ├──────────────────────► Periodic Backend Heartbeat (every 60s)
      │
      ├─► [Network Drop / Refresh] ──► Grace Window (45s pause before closing)
      │                                       │
      │                                       ├─► Reconnected ──► Merge interval
      │                                       └─► Expired ─────► Finalize left_at
      ▼
[Participant Leaves / Class Ends] ──► Finalize `left_at = NOW()`, compute duration_seconds
```

### Authoritative Origin of Metering Events:
- **Never trust client-reported durations.** A compromised browser client could report zero minutes.
- All session start timestamps (`joined_at`) and end timestamps (`left_at`) originate **exclusively from server-side clocks**:
  1. Primary: Socket.IO connection and disconnect events on the signaling server.
  2. Secondary: REST API attendance calls (`/api/rooms/:roomCode/participants` and `/leave`).

---

## 3. Edge Case Reconciliation

### A. Reconnects and Churn Storms
- **Scenario:** A student on unstable Wi-Fi disconnects and reconnects 5 times within a 10-minute window.
- **Metering Policy:**
  - If a participant reconnects with the same `(tenant_id, session_id, user_id)` within **45 seconds**, the disconnect is treated as a transient network blip.
  - The interval is merged into a continuous active session to prevent fractional minute overbilling.

### B. Missing Disconnect Events (Browser Crash / Closed Laptop)
- **Scenario:** Student abruptly closes their laptop lid without triggering the `beforeunload` beacon or `/leave` API.
- **Reconciliation Mechanism:**
  1. Socket.IO WebSocket heartbeat (`pingInterval: 25000`, `pingTimeout: 20000`): Detects socket loss within 45 seconds and emits `disconnect`.
  2. Ephemeral Session Reaper Job (runs every 5 minutes in background):
     - Scans `participant_sessions` where `left_at IS NULL`.
     - Cross-references active socket connections.
     - If no heartbeat has been observed for $>3\text{ minutes}$, the reaper stamps `left_at = last_heartbeat_timestamp`.

### C. Service Restart / Server Crash Recovery
- **Scenario:** The backend API server or signaling node restarts unexpectedly during an active class.
- **Recovery Strategy:**
  - `participant_sessions` are persisted in PostgreSQL upon initial entry.
  - Active participant state is dual-cached in Redis with a 90-second TTL.
  - When the service recovers, it re-queries active rooms and queries the Mediasoup SFU for active peer transports to resume heartbeat tracking.

---

## 4. Concurrent Participant Tracking

Peak concurrency determines infrastructure dimensioning and plan limits:
1. When a participant joins, the backend atomically increments the tenant's active counter:
   ```sql
   UPDATE room_sessions 
   SET peak_participants = GREATEST(peak_participants, current_active_count)
   WHERE session_id = $1;
   ```
2. In Redis, an active set tracks online participants: `SADD tenant:{id}:active_users {user_id}`.
3. Every 60 seconds, the maximum cardinality is sampled and stored in `usage_records(peak_concurrent_participants)`.

---

## 5. Quota Enforcement Policy

Tenants subscribe to plans with defined monthly limits (e.g. 50,000 participant-minutes/month, 100 max concurrent participants).

### Safety Rules:
1. **Never Abruptly Terminate Live Calls:**
   - If a tenant exceeds their monthly quota during an ongoing class, **live video calls are never dropped**.
   - Abruptly cutting off an active school lesson damages user experience.
2. **Soft Ceiling (Overdraft Protection):**
   - At **80% and 95% quota**, the system fires warning webhooks (`tenant.quota_warning`) and email alerts.
   - At **100% quota**, an automatic 15% grace overdraft is allowed.
3. **Hard Ceiling (Token Minting Rejection):**
   - When quota + overdraft is exhausted, the server rejects new token requests (`POST /v1/rooms/:id/tokens`) with `402 Payment Required` (`code: "QUOTA_EXCEEDED"`).
   - Existing participants already in rooms remain connected until the room naturally concludes.
