-- Migration: 007_organization_sso.sql
-- Description: Additive tables for Organization-based SSO, verified domains, user allowlists/provisioning, and single-use launch tokens.
-- Safeguards: Idempotent, zero destructive operations, tenant-isolated foreign keys, cascades on org deletion.

-- 1. Organization SSO Configurations
CREATE TABLE IF NOT EXISTS organization_sso_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
    sso_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    default_role VARCHAR(20) NOT NULL DEFAULT 'student' CHECK (default_role IN ('student', 'tutor')),
    allow_auto_provisioning BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sso_configs_org ON organization_sso_configs(organization_id);

-- 2. Organization Verified Domains
CREATE TABLE IF NOT EXISTS organization_sso_domains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    domain VARCHAR(255) NOT NULL,
    is_verified BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, domain)
);
CREATE INDEX IF NOT EXISTS idx_sso_domains_org ON organization_sso_domains(organization_id);

-- 3. Organization SSO Users (Manual Allowlist & Auto-Provisioned Users)
CREATE TABLE IF NOT EXISTS organization_sso_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    external_issuer VARCHAR(100) NOT NULL DEFAULT 'external',
    external_subject VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'tutor')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    auto_provisioned BOOLEAN NOT NULL DEFAULT FALSE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, external_issuer, external_subject)
);
CREATE INDEX IF NOT EXISTS idx_sso_users_org ON organization_sso_users(organization_id);
CREATE INDEX IF NOT EXISTS idx_sso_users_email ON organization_sso_users(organization_id, email);
CREATE INDEX IF NOT EXISTS idx_sso_users_active ON organization_sso_users(organization_id, is_active);

-- 4. Ephemeral Single-Use SSO Launch Tokens
CREATE TABLE IF NOT EXISTS sso_launch_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    room_code VARCHAR(32) NOT NULL REFERENCES live_classes(room_code) ON DELETE CASCADE,
    external_user_id VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('student', 'tutor')),
    permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sso_launch_token_hash ON sso_launch_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_sso_launch_token_exp ON sso_launch_tokens(expires_at);

-- 5. Expand API Key Audit Logs action check to support SSO launch tokens
DO $$
BEGIN
    ALTER TABLE api_key_audit_logs DROP CONSTRAINT IF EXISTS api_key_audit_logs_action_check;
    ALTER TABLE api_key_audit_logs ADD CONSTRAINT api_key_audit_logs_action_check 
        CHECK (action IN ('created', 'rotated', 'revoked', 'rate_limited', 'permission_denied', 'sso_launch_created'));
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;

