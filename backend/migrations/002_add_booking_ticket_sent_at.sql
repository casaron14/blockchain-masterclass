-- Ticket email delivery is tracked on the booking itself so every
-- confirmation path has one unambiguous answer to "has this attendee already
-- been emailed a ticket?".
--
-- ticket_sent_at is set only after the mail server accepts the message. It is
-- deliberately not the send lock: a crash between claiming and sending must
-- not make the ticket look delivered. The lock lives in
-- ticket_deliveries.send_claimed_at, which expires on its own.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS ticket_sent_at TIMESTAMPTZ;

ALTER TABLE ticket_deliveries
  ADD COLUMN IF NOT EXISTS send_claimed_at TIMESTAMPTZ;

-- Bookings that were already emailed before this migration must never be
-- emailed again just because the new column starts empty.
UPDATE bookings AS booking_record
   SET ticket_sent_at = ticket_delivery.sent_at
  FROM ticket_deliveries AS ticket_delivery
 WHERE ticket_delivery.booking_id = booking_record.id
   AND ticket_delivery.status = 'sent'
   AND ticket_delivery.sent_at IS NOT NULL
   AND booking_record.ticket_sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_ticket_sent_at
  ON bookings (ticket_sent_at)
  WHERE ticket_sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ticket_deliveries_send_claim
  ON ticket_deliveries (send_claimed_at)
  WHERE send_claimed_at IS NOT NULL;
