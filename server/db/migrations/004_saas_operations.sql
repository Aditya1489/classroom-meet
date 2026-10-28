-- Migration: 004_saas_operations.sql
-- Description: Additive tables for webhooks, delivery logs, usage ledger, and subscription quotas.
-- Safeguards: Idempotent, zero destructive operations, tenant-isolated foreign keys.

-- 1. Webhook Endpoints (Organization-Scoped)
CREATE TABLE IF NOT EXISTS webhook_endpoints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    secret_hash VARCHAR(64) NOT NULL,
    secret_prefix VARCHAR(16) NOT NULL,
    events TEXT[] NOT NULL DEFAULT '{"room.created", "room.ended"}',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    description VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_org ON webhook_endpoints(organization_id);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_active ON webhook_endpoints(organization_id, is_active);

-- 2. Webhook Deliveries (Delivery Logs & Retries)
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
    event_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    response_status INT,
    response_body TEXT,
    attempt_count INT NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL CHECK (status IN ('delivered', 'failed', 'retrying')),
    error_message TEXT,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_org ON webhook_deliveries(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint ON webhook_deliveries(endpoint_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_event ON webhook_deliveries(event_id);

-- 3. Auditable Organization Usage Ledger
-- Stores idempotent, whole-minute billed session records.
CREATE TABLE IF NOT EXISTS organization_usage_ledger (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    room_id UUID REFERENCES live_classes(id) ON DELETE SET NULL,
    room_code VARCHAR(50) NOT NULL,
    participant_id VARCHAR(255) NOT NULL,
    participant_name VARCHAR(255),
    role VARCHAR(30) NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL,
    left_at TIMESTAMPTZ NOT NULL,
    duration_seconds INT NOT NULL,
    billed_minutes INT NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_org_time ON organization_usage_ledger(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_room ON organization_usage_ledger(room_code);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_idempotency ON organization_usage_ledger(idempotency_key);

-- 4. Additive Plan & Quota Columns on organizations
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'plan_tier'
    ) THEN
        ALTER TABLE organizations ADD COLUMN plan_tier VARCHAR(30) NOT NULL DEFAULT 'free';
        ALTER TABLE organizations ADD COLUMN monthly_minute_limit INT NOT NULL DEFAULT 10000;
        ALTER TABLE organizations ADD COLUMN max_concurrent_rooms INT NOT NULL DEFAULT 10;
        CREATE INDEX idx_organizations_plan_tier ON organizations(plan_tier);
    END IF;
END $$;
