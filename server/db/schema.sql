-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Users Table (Replaces Supabase auth.users)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    role VARCHAR(20) NOT NULL DEFAULT 'student' CHECK (role IN ('tutor', 'student', 'admin')),
    auth_provider VARCHAR(50) NOT NULL DEFAULT 'google' CHECK (auth_provider IN ('google', 'guest', 'email')),
    provider_user_id VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 2. User Refresh / Session Tokens
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

-- 3. Live Classes (Rooms)
CREATE TABLE IF NOT EXISTS live_classes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_code VARCHAR(32) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    tutor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    tutor_name VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_live_streaming BOOLEAN NOT NULL DEFAULT FALSE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_live_classes_room_code ON live_classes(room_code);
CREATE INDEX IF NOT EXISTS idx_live_classes_is_active ON live_classes(is_active);

-- 4. Room Participants (Attendance & Camera Gating)
CREATE TABLE IF NOT EXISTS room_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_code VARCHAR(32) NOT NULL REFERENCES live_classes(room_code) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    display_name VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('tutor', 'student')),
    camera_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_participants_room ON room_participants(room_code);
CREATE INDEX IF NOT EXISTS idx_participants_user ON room_participants(user_id);

-- 5. Chat Messages
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_code VARCHAR(32) NOT NULL REFERENCES live_classes(room_code) ON DELETE CASCADE,
    sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
    sender_name VARCHAR(255) NOT NULL,
    sender_role VARCHAR(20) NOT NULL CHECK (sender_role IN ('tutor', 'student')),
    content TEXT NOT NULL,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    timestamp_ms BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_room_timestamp ON chat_messages(room_code, timestamp_ms ASC);

-- 6. Polls
CREATE TABLE IF NOT EXISTS polls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_code VARCHAR(32) NOT NULL REFERENCES live_classes(room_code) ON DELETE CASCADE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    question TEXT NOT NULL,
    poll_type VARCHAR(30) NOT NULL DEFAULT 'mcq' CHECK (poll_type IN ('mcq', 'multi_correct', 'subjective')),
    correct_option_index INT,
    timer_seconds INT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_polls_room ON polls(room_code);

-- 7. Poll Options
CREATE TABLE IF NOT EXISTS poll_options (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    option_index INT NOT NULL,
    option_text TEXT NOT NULL,
    UNIQUE(poll_id, option_index)
);

-- 8. Poll Votes
CREATE TABLE IF NOT EXISTS poll_votes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    option_id UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    is_correct BOOLEAN,
    duration_ms INT,
    voted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(poll_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON poll_votes(poll_id);

-- 9. Whiteboard Snapshots (Tldraw JSON State)
CREATE TABLE IF NOT EXISTS whiteboard_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_code VARCHAR(32) NOT NULL UNIQUE REFERENCES live_classes(room_code) ON DELETE CASCADE,
    snapshot_json JSONB NOT NULL,
    shape_count INT DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_whiteboard_room ON whiteboard_snapshots(room_code);

-- 10. Tutor YouTube Connections
CREATE TABLE IF NOT EXISTS tutor_youtube_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tutor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id VARCHAR(100),
    channel_title VARCHAR(255),
    channel_handle VARCHAR(100),
    encrypted_refresh_token TEXT NOT NULL,
    live_stream_url TEXT,
    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tutor_id)
);

-- 11. Tablet Companion Pairing Codes (Format: XXX-XXX-XXX)
CREATE TABLE IF NOT EXISTS tablet_pairings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_code VARCHAR(32) NOT NULL REFERENCES live_classes(room_code) ON DELETE CASCADE,
    host_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pairing_code VARCHAR(12) NOT NULL UNIQUE,
    is_paired BOOLEAN NOT NULL DEFAULT FALSE,
    paired_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tablet_pairing_code ON tablet_pairings(pairing_code);

-- 12. Organization SSO Configurations
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

-- 13. Organization Verified Domains
CREATE TABLE IF NOT EXISTS organization_sso_domains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    domain VARCHAR(255) NOT NULL,
    is_verified BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, domain)
);
CREATE INDEX IF NOT EXISTS idx_sso_domains_org ON organization_sso_domains(organization_id);

-- 14. Organization SSO Users (Manual Allowlist & Auto-Provisioned Users)
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

-- 15. Ephemeral Single-Use SSO Launch Tokens
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

