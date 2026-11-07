-- Migration 011: Class Schedules & Email Invitations
CREATE TABLE IF NOT EXISTS class_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_code VARCHAR(32) NOT NULL,
    title VARCHAR(255) NOT NULL,
    subject VARCHAR(100),
    description TEXT,
    tutor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scheduled_at TIMESTAMPTZ NOT NULL,
    duration_minutes INT NOT NULL DEFAULT 60 CHECK (duration_minutes > 0),
    status VARCHAR(30) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_class_schedules_tutor ON class_schedules(tutor_id);
CREATE INDEX IF NOT EXISTS idx_class_schedules_scheduled_at ON class_schedules(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_class_schedules_room_code ON class_schedules(room_code);

CREATE TABLE IF NOT EXISTS class_invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    schedule_id UUID NOT NULL REFERENCES class_schedules(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    invitee_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    rsvp_status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (rsvp_status IN ('pending', 'accepted', 'declined')),
    token VARCHAR(64) NOT NULL UNIQUE,
    rsvp_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invitations_schedule ON class_invitations(schedule_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON class_invitations(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_invitations_token ON class_invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_user ON class_invitations(invitee_user_id);

