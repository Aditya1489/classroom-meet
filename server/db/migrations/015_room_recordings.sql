-- Migration 015: class recordings linked to a room, so students can watch them after class.
-- url points to where the tutor stored the video (Google Drive upload or a link they pasted).
CREATE TABLE IF NOT EXISTS room_recordings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_code TEXT NOT NULL,
  url TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'link' CHECK (source IN ('drive', 'link')),
  title TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_room_recordings_room ON room_recordings(room_code, created_at DESC);
