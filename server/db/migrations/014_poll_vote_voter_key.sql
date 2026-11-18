-- Migration 014: One vote per participant per poll, including embedded (non-account) participants.
-- poll_votes was only unique on (poll_id, user_id). Embedded participants authenticate with participant
-- tokens and have no users row, so user_id is NULL for them, and NULLs never conflict: every vote they
-- cast was inserted as a new row. voter_key holds a stable identity for every voter:
--   * account users: their users.id
--   * participant tokens: 'pt:<tenant_id>:<sub>'

ALTER TABLE poll_votes ADD COLUMN IF NOT EXISTS voter_key TEXT;

UPDATE poll_votes
SET voter_key = user_id::text
WHERE voter_key IS NULL AND user_id IS NOT NULL;

-- Rows with NULL voter_key (historical anonymous votes) stay as they are; NULLs don't collide in a unique index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_poll_votes_poll_voter_key ON poll_votes(poll_id, voter_key);
