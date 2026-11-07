-- Migration 012: Allow unlimited class duration (duration_minutes >= 0, where 0 = unlimited)
ALTER TABLE class_schedules DROP CONSTRAINT IF EXISTS class_schedules_duration_minutes_check;
ALTER TABLE class_schedules ADD CONSTRAINT class_schedules_duration_minutes_check CHECK (duration_minutes >= 0);
ALTER TABLE class_schedules ALTER COLUMN duration_minutes SET DEFAULT 0;

