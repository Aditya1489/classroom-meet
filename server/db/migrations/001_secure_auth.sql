-- Migration: 001_secure_auth.sql
-- Enforces provider subject uniqueness and indexing for meeting authorization

-- 1. Unique index on (auth_provider, provider_user_id) for non-null provider IDs
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider_unique 
ON users(auth_provider, provider_user_id) 
WHERE provider_user_id IS NOT NULL;

-- 2. Index for room ownership verification by tutor_id
CREATE INDEX IF NOT EXISTS idx_live_classes_tutor_id 
ON live_classes(tutor_id);

-- 3. Ensure room_participants has index on user_id and room_code
CREATE INDEX IF NOT EXISTS idx_room_participants_lookup 
ON room_participants(room_code, user_id);
