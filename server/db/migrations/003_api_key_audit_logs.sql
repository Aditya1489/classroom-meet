-- Migration: 003_api_key_audit_logs.sql
-- Description: Audit logging table for API key lifecycle events (creation, rotation, revocation, security rejection).
-- Safeguards: Idempotent, zero destructive operations, never stores raw secrets.

ALTER TABLE api_keys ALTER COLUMN key_prefix TYPE VARCHAR(32);

-- Replace full table unique constraint with partial index on active keys
-- Allows key rotation and recreation of revoked key names while guaranteeing active uniqueness
ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_organization_id_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_active_org_name ON api_keys (organization_id, name) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS api_key_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL CHECK (action IN ('created', 'rotated', 'revoked', 'rate_limited', 'permission_denied')),
    actor_id VARCHAR(255) NOT NULL DEFAULT 'system',
    key_prefix VARCHAR(32),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_key_audit_org ON api_key_audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_key_audit_key ON api_key_audit_logs(api_key_id);
