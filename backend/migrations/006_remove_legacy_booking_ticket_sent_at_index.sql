-- Ticket delivery is recorded only in ticket_deliveries now. bookings.ticket_sent_at
-- is a legacy column that nothing reads or writes, so the partial index added by
-- migration 002 would only add write cost to every booking.
DROP INDEX IF EXISTS idx_bookings_ticket_sent_at;
