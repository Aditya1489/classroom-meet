# Mathsy Meet SaaS — Infrastructure & Deployment Plan

**Document:** `docs/saas/deployment-plan.md`  
**Date:** October 2026  
**Status:** Infrastructure & SRE Specification

---

## 1. Multi-Cluster Deployment Architecture

Video conferencing infrastructure requires separating stateful, high-throughput UDP media routing from stateless HTTP application services:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       TRAFFIC INGRESS & DNS ROUTING                         │
│  - meet.mathsy.in  ──► Cloudflare CDN / Edge (Static SPA Frontend)          │
│  - api.mathsy.in   ──► ALB / Ingress Controller (Stateless Express API)     │
│  - rtc.mathsy.in   ──► Dedicated Bare-Metal / High-Bandwidth SFU (UDP Media)│
│  - turn.mathsy.in  ──► Coturn Cluster (STUN 3478, TURN TLS 443 Relay)       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Infrastructure Sizing & Node Roles

### A. Stateless API Gateway (`api.mathsy.in`)
- **Hosting:** Docker containerized service on AWS ECS Fargate, Kubernetes, or Fly.io.
- **Node Specs:** 2–4 vCPU, 4–8 GB RAM per container instance (Auto-scaling: 2 to 10 nodes).
- **Responsibilities:** REST API endpoints (`/v1/*`), JWT token minting, Google OAuth, webhook dispatching, database read/write queries.
- **Connection Management:** Connects to PostgreSQL via **PgBouncer** connection pooler to prevent pool exhaustion under auto-scaling.

### B. Mediasoup SFU & Signaling Nodes (`rtc.mathsy.in`)
- **Hosting:** Dedicated Compute Instances with unthrottled networking (e.g., AWS EC2 `c6in.4xlarge` or Hetzner Dedicated AX-Line).
- **Requirements:**
  - Dedicated public IPv4 address (NAT-free or 1:1 public IP binding).
  - High-bandwidth uplink (minimum 1 Gbps, recommended 10 Gbps unmetered).
  - Open UDP Port Range: **10000 to 20000 UDP** for WebRTC RTP media streams.
  - Multi-Core CPU: Mediasoup spawns 1 C++ worker per CPU core (`mediasoup.createWorker({ rtcMinPort: 10000, rtcMaxPort: 20000 })`).

### C. Coturn STUN/TURN Cluster (`turn.mathsy.in`)
- **Purpose:** Relays media for participants behind strict enterprise, university, or cellular symmetric NATs that block direct UDP.
- **Ports:**
  - Port 3478 UDP/TCP (Standard STUN/TURN)
  - Port 443 TCP/TLS (TURN-over-TLS for firewalls that block all non-HTTPS traffic)
- **Authentication:** Ephemeral TURN credentials generated via HMAC-SHA1 shared secret (`use-auth-secret`).

---

## 3. Database Architecture & Persistence

### A. PostgreSQL 15+ (Relational / Authoritative)
- **Hosting:** Managed PostgreSQL (e.g., AWS RDS PostgreSQL or Supabase Dedicated).
- **Configuration:**
  - Storage: 100 GB NVMe SSD (gp3) with automatic storage scaling.
  - Connection Pooler: PgBouncer running in `transaction` mode (max connections: 500).
- **Backup & Recovery Strategy:**
  - Automated daily snapshots retained for 30 days.
  - Continuous WAL archiving for Point-In-Time Recovery (PITR) up to 7 days.
  - Read-Replica for heavy usage analytics queries (`GET /v1/usage`).

### B. MongoDB 7.0+ (Ephemeral In-Class Chat)
- **Hosting:** MongoDB Atlas M10+ or dedicated container cluster.
- **Configuration:**
  - In-memory working set tuned for active class sessions.
  - TTL Indexes configured for automatic 24-hour cleanup.
  - Daily dumps for compliance if enterprise recording archiving is enabled.

---

## 4. Environment Variables & Secrets Management

Secrets are managed via **Doppler** or **AWS Secrets Manager**; zero raw secrets are stored in Git.

| Variable Name | Description | Environment |
|---|---|---|
| `PORT` | HTTP port for backend service (default 5001) | All |
| `DATABASE_URL` | PostgreSQL connection string | Staging / Production |
| `MONGODB_URI` | MongoDB connection string | Staging / Production |
| `JWT_SECRET` | Master cryptographic key for signing tokens | Staging / Production |
| `API_KEY_SALT` | Salt used for hashing customer API keys | Staging / Production |
| `MEDIASOUP_LISTEN_IP` | Public IP of the SFU host | SFU Node |
| `MEDIASOUP_MIN_PORT` | Lowest UDP media port (10000) | SFU Node |
| `MEDIASOUP_MAX_PORT` | Highest UDP media port (20000) | SFU Node |
| `TURN_SECRET` | Shared secret for Coturn credentials | Staging / Production |
| `WEBHOOK_HMAC_SECRET` | Default signing secret for outbound webhooks | Staging / Production |

---

## 5. Observability, Monitoring & Alerting

1. **Prometheus Metrics Exporter:**
   - SFU Worker CPU & Memory utilization (`worker.getResourceUsage()`).
   - Active WebRtcTransports, Producers, and Consumers count.
   - Inbound & Outbound RTP bitrate (bps) and packet loss percentage.
   - Node.js event-loop lag (`nodejs_eventloop_lag_seconds`).
2. **Grafana Dashboards:**
   - Real-time active rooms and global concurrent participants.
   - SFU bandwidth saturation gauges.
   - API response latency (p50, p95, p99).
3. **Alerting Thresholds (PagerDuty / Slack):**
   - **P0 Alert:** SFU CPU $>85\%$ for $>2\text{ minutes}$ $\to$ Trigger room placement drain.
   - **P0 Alert:** API error rate $>2\%$ over 5-minute window.
   - **P1 Alert:** PostgreSQL connection pool saturation $>80\%$.
   - **P2 Alert:** Webhook delivery failure rate $>5\%$.

---

## 6. Staging & Production Isolation

- **Staging (`stage-api.mathsy.in`, `stage-rtc.mathsy.in`):**
  - Completely isolated PostgreSQL and MongoDB databases.
  - Dedicated staging SFU node for pre-release load testing and customer sandbox testing (`sec_test_...` API keys).
- **Production (`api.mathsy.in`, `rtc.mathsy.in`):**
  - Live production traffic only (`sec_live_...` API keys).
  - Strict zero-downtime rolling deployments via blue/green or canary strategy.
