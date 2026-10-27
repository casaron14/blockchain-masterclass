// Development-only smoke test for the real ticket email.
//
//   DEV_TEST_TICKET_RECIPIENT_EMAIL=you@gmail.com npm run test:ticket-email
//   npm run test:ticket-email -- --to=you@gmail.com
//
// It creates a throwaway booking, confirms the seat, sends the same ticket
// email a real confirmation sends, writes a copy of the PNG for visual review,
// then deletes the booking. It refuses to run in production. This is a script,
// not a route, so there is no endpoint to remember to remove before deploy.

import '../config/environment.js';

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pool from '../config/db.js';

import {
  createBookingRecordWithActiveSeatHold,
  confirmBookingSeatWithinCapacity,
} from '../services/bookingService.js';
import { deliverTicketForConfirmedBooking } from '../services/ticketDeliveryService.js';
import { isValidAttendeeEmailAddress } from '../services/attendeeEmailAddressValidator.js';

const backendRootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

function readRecipientEmailAddressFromArguments() {
  const recipientArgument = process.argv.find((argument) =>
    argument.startsWith('--to=')
  );

  return (
    recipientArgument?.slice('--to='.length).trim() ||
    process.env.DEV_TEST_TICKET_RECIPIENT_EMAIL?.trim() ||
    ''
  );
}

async function runDevelopmentTicketEmailSmokeTest() {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL === '1') {
    throw new Error('This smoke test refuses to run in production');
  }

  const recipientEmailAddress = readRecipientEmailAddressFromArguments();
  if (!isValidAttendeeEmailAddress(recipientEmailAddress)) {
    throw new Error(
      'Set DEV_TEST_TICKET_RECIPIENT_EMAIL or pass --to=you@gmail.com with a valid address'
    );
  }

  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Development Ticket Tester',
    email: recipientEmailAddress,
    phone_number: '+255700000001',
  });

  try {
    await confirmBookingSeatWithinCapacity(bookingRecord.id);

    const deliveryResult = await deliverTicketForConfirmedBooking(bookingRecord.id);
    if (!deliveryResult?.delivered) {
      throw new Error(
        `Ticket email was not delivered: ${deliveryResult?.reason ?? 'unknown reason'}`
      );
    }

    const { renderTicketPngBufferForBooking } = await import(
      '../../frontend/lib/ticketImageRenderer.mjs'
    );
    const previewDirectoryPath = path.join(backendRootDirectory, 'out/tickets');
    const previewFilePath = path.join(
      previewDirectoryPath,
      `dev-test-ticket-${bookingRecord.ref}.png`
    );
    await fs.mkdir(previewDirectoryPath, { recursive: true });
    await fs.writeFile(
      previewFilePath,
      await renderTicketPngBufferForBooking(bookingRecord, {
        eventTimeLabel: process.env.EVENT_TIME_LABEL?.trim() || '',
      })
    );

    console.log(
      JSON.stringify(
        {
          delivered: true,
          bookingId: bookingRecord.id,
          bookingReferenceCode: bookingRecord.ref,
          recipientEmailAddress,
          attachmentFileName: deliveryResult.ticketAttachmentFileName,
          previewFilePath,
        },
        null,
        2
      )
    );
  } finally {
    await pool.query('DELETE FROM bookings WHERE id = $1', [bookingRecord.id]);
  }
}

runDevelopmentTicketEmailSmokeTest()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
