-- Migration: 002_multi_tenant_foundation.sql
-- Description: Additive PostgreSQL foundation for multi-tenant SaaS.
-- Safeguards: Fully idempotent, expand-and-contract pattern, zero destructive operations,
--             preserves all existing tables, foreign keys, room codes, and participant records.

-- 1. Organizations (Tenants)
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'delinquent')),
    settings JSONB NOT NULL DEFAULT '{"max_room_duration_min": 240, "default_camera_locked": true}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);

-- 2. Organization Memberships & Dashboard Roles
CREATE TABLE IF NOT EXISTS organization_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(30) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'developer', 'member', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);

-- 3. API Keys (Machine-to-Machine Server Credentials)
-- Never stores raw secrets. Stores only non-secret prefix and cryptographic hash.
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    key_prefix VARCHAR(16) NOT NULL,
    key_hash VARCHAR(64) NOT NULL UNIQUE,
    environment VARCHAR(10) NOT NULL DEFAULT 'live' CHECK (environment IN ('live', 'test')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    permissions JSONB NOT NULL DEFAULT '["rooms:read", "rooms:write", "tokens:write"]'::jsonb,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, name)
);
CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(organization_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- 4. Customer Apps (Embed Whitelisting & Origin Security)
CREATE TABLE IF NOT EXISTS customer_apps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    app_name VARCHAR(100) NOT NULL,
    allowed_domains TEXT[] NOT NULL DEFAULT '{}',
    branding JSONB NOT NULL DEFAULT '{"logo_url": null, "primary_color": "#4f46e5"}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, app_name)
);
CREATE INDEX IF NOT EXISTS idx_customer_apps_org ON customer_apps(organization_id);

-- 5. Additive Nullable organization_id on Existing Tenant-Owned Tables
DO $$
BEGIN
    -- 5a. live_classes
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'live_classes' AND column_name = 'organization_id'
    ) THEN
        ALTER TABLE live_classes ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
        CREATE INDEX idx_live_classes_organization_id ON live_classes(organization_id);
        CREATE INDEX idx_live_classes_org_code ON live_classes(organization_id, room_code);
    END IF;

    -- 5b. room_participants
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'room_participants' AND column_name = 'organization_id'
    ) THEN
        ALTER TABLE room_participants ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
        CREATE INDEX idx_room_participants_organization_id ON room_participants(organization_id);
    END IF;

    -- 5c. whiteboard_snapshots
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'whiteboard_snapshots' AND column_name = 'organization_id'
    ) THEN
        ALTER TABLE whiteboard_snapshots ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
        CREATE INDEX idx_whiteboard_snapshots_organization_id ON whiteboard_snapshots(organization_id);
    END IF;

    -- 5d. polls
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'polls' AND column_name = 'organization_id'
    ) THEN
        ALTER TABLE polls ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
        CREATE INDEX idx_polls_organization_id ON polls(organization_id);
    END IF;

    -- 5e. chat_messages
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'chat_messages' AND column_name = 'organization_id'
    ) THEN
        ALTER TABLE chat_messages ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
        CREATE INDEX idx_chat_messages_organization_id ON chat_messages(organization_id);
    END IF;
END $$;

-- 6. First-Party Mathsy Organization Seed (Stable, Non-conflicting UUID)
INSERT INTO organizations (id, name, slug, status, settings)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Mathsy Classroom (First-Party)',
    'mathsy-first-party',
    'active',
    '{"is_system_tenant": true, "max_room_duration_min": 720, "default_camera_locked": true}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET 
    name = EXCLUDED.name,
    settings = EXCLUDED.settings;

-- 7. Seed Primary Tutor as Owner of First-Party Organization if User Exists
INSERT INTO organization_members (organization_id, user_id, role)
SELECT '00000000-0000-0000-0000-000000000001', id, 'owner'
FROM users 
WHERE email = 'aditya@mathsy.in'
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- 8. Backfill Existing Classroom Records to First-Party Organization
UPDATE live_classes 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

UPDATE room_participants 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

UPDATE whiteboard_snapshots 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

UPDATE polls 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

UPDATE chat_messages 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;
