-- Migration: 010_onboarding_completed.sql
-- Add onboarding_completed flag to users table

ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;

-- Ensure all existing users prior to this migration are marked as completed
UPDATE users SET onboarding_completed = TRUE WHERE created_at < NOW() AND onboarding_completed = FALSE;

