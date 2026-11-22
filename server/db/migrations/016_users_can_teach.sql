-- Migration 016: remember who has ever been a tutor, so a tutor who switches to Student (even by mistake)
-- can switch back. Students who were never tutors still cannot make themselves tutors.
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_teach BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE users SET can_teach = TRUE WHERE role IN ('tutor', 'admin') AND can_teach = FALSE;
