-- Migration: 005_webhook_secret_encryption.sql
-- Description: Add encrypted_secret column to webhook_endpoints for authenticated AES-256-GCM HMAC signing
-- Safeguards: Fully idempotent, additive only, zero data loss, preserves all existing tables and rows

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'webhook_endpoints' AND column_name = 'encrypted_secret'
    ) THEN
        ALTER TABLE webhook_endpoints ADD COLUMN encrypted_secret TEXT;
    END IF;
END $$;
