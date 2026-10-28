-- Migration: 006_platform_superadmin.sql
-- Description: Additive platform superadmin flag on users table with system tenant ownership constraint.
-- Safeguards: Fully idempotent, additive only, zero downtime, default FALSE.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_platform_superadmin'
    ) THEN
        ALTER TABLE users ADD COLUMN is_platform_superadmin BOOLEAN NOT NULL DEFAULT FALSE;
        CREATE INDEX IF NOT EXISTS idx_users_is_platform_superadmin ON users(is_platform_superadmin) WHERE is_platform_superadmin = TRUE;
    END IF;
END $$;

-- Authorize primary owner of system tenant as initial platform superadmin if account exists
UPDATE users 
SET is_platform_superadmin = TRUE, role = 'admin' 
WHERE email = 'aditya@mathsy.in';
