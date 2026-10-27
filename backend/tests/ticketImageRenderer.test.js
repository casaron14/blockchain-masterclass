import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import PNG from 'png-js';

import {
  buildTicketCodeForBooking,
  renderBookingCodeQrDataUrl,
  renderTicketPngBufferForBooking,
  TICKET_IMAGE_HEIGHT,
  TICKET_IMAGE_WIDTH,
} from '../../frontend/lib/ticketImageRenderer.mjs';

const TEST_BOOKING_RECORD = {
  id: 901,
  ref: 'TEST901',
  full_name: 'Amina Juma',
  email: 'amina@example.com',
};

function decodeQrTextFromPngDataUrl(qrPngDataUrl) {
  const qrPngBuffer = Buffer.from(qrPngDataUrl.split(',')[1], 'base64');

  return new Promise((resolve) => {
    const qrPngImage = new PNG(qrPngBuffer);

    qrPngImage.decode((rgbaPixels) => {
      const rgbaPixelData = new Uint8ClampedArray(
        rgbaPixels.buffer,
        rgbaPixels.byteOffset,
        rgbaPixels.length
      );
      const decodedQrCode = jsQR(rgbaPixelData, qrPngImage.width, qrPngImage.height);
      resolve(decodedQrCode?.data ?? null);
    });
  });
}

test('buildTicketCodeForBooking produces one unique code per booking reference', () => {
  assert.equal(buildTicketCodeForBooking(TEST_BOOKING_RECORD), 'EVT-TEST901');
});

test('renderBookingCodeQrDataUrl encodes the booking ticket code', async () => {
  const qrDataUrl = await renderBookingCodeQrDataUrl(TEST_BOOKING_RECORD);

  assert.match(qrDataUrl, /^data:image\/png;base64,/);
  assert.equal(await decodeQrTextFromPngDataUrl(qrDataUrl), 'EVT-TEST901');
});

test('renderTicketPngBufferForBooking returns a landscape PNG with the expected size', async () => {
  const ticketPngBuffer = await renderTicketPngBufferForBooking(TEST_BOOKING_RECORD, {
    eventTimeLabel: '09:00 EAT',
  });

  assert.ok(Buffer.isBuffer(ticketPngBuffer));
  assert.equal(ticketPngBuffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(ticketPngBuffer.readUInt32BE(16), TICKET_IMAGE_WIDTH);
  assert.equal(ticketPngBuffer.readUInt32BE(20), TICKET_IMAGE_HEIGHT);
  assert.ok(ticketPngBuffer.length > 20_000);
});
