-- Remove multi-event scoping.
--
-- Back to one event per database: a booking no longer belongs to an event row,
-- and the seat counter is the single seat_capacity row again.
--
-- This file only drops what the per-event model added. Existing bookings and
-- referrers rows are kept; a historical booking simply stops carrying the
-- event it was sold under.
--
-- config/schema.sql is replayed before this file on every deploy. It already
-- replaces the multi-event compatibility view with the single seat_capacity
-- table and recounts confirmed seats from bookings, so the counter is correct
-- by the time these columns disappear.

DROP TRIGGER IF EXISTS trg_sync_event_seat_capacity ON bookings;
DROP FUNCTION IF EXISTS sync_event_seat_capacity();

ALTER TABLE bookings DROP COLUMN IF EXISTS event_snapshot;
ALTER TABLE bookings DROP COLUMN IF EXISTS event_id;

ALTER TABLE referrers DROP COLUMN IF EXISTS event_id;

DROP TABLE IF EXISTS event_seat_capacity;
DROP TABLE IF EXISTS events;
DROP TYPE IF EXISTS event_lifecycle_status;
