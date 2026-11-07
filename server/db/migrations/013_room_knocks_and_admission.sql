-- Migration 013: Google Meet Style Host Admission & Room Knocks
-- Tracks pending, admitted, denied, and cancelled participant knocking requests

CREATE TABLE IF NOT EXISTS room_knocks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_code VARCHAR(32) NOT NULL REFERENCES live_classes(room_code) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    display_name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    avatar_url TEXT,
    role VARCHAR(20) NOT NULL DEFAULT 'student' CHECK (role IN ('tutor', 'student')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'admitted', 'denied', 'cancelled')),
    responded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    responded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_room_knocks_room_status ON room_knocks(room_code, status);
CREATE INDEX IF NOT EXISTS idx_room_knocks_user ON room_knocks(user_id);
CREATE INDEX IF NOT EXISTS idx_room_knocks_created_at ON room_knocks(created_at DESC);

