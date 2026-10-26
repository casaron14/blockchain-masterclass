import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'zlib';
import pool from '../config/db.js';

import { generateTicketPdfBuffer } from '../services/ticketPdfService.js';
import ticketController from '../controller/ticketController.js';

import {
  createBookingRecordWithActiveSeatHold,
  confirmBookingSeatWithinCapacity,
} from '../services/bookingService.js';

const { downloadTicketPdfEndpoint } = ticketController;

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
}

beforeEach(resetDatabaseState);

async function createConfirmedBooking() {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Ticket Download User',
    email: 'download@example.com',
    phone_number: '+255712345696',
  });
  return confirmBookingSeatWithinCapacity(bookingRecord.id);
}

// pdfkit writes the text layer as hex-encoded runs inside Flate-compressed
// content streams, so the drawn text is recovered by inflating the streams
// rather than by scanning the raw PDF bytes.
function readDrawnTextFromPdf(pdfBuffer) {
  const drawnTextRuns = [];
  const showingTextLinePattern = /\[([^\]]*)\]\s*TJ/g;

  let searchOffset = 0;
  while (searchOffset < pdfBuffer.length) {
    const streamStartIndex = pdfBuffer.indexOf('stream', searchOffset);
    if (streamStartIndex === -1) {
      break;
    }

    const contentStartIndex = streamStartIndex + 'stream'.length + 1;
    const streamEndIndex = pdfBuffer.indexOf('endstream', contentStartIndex);
    if (streamEndIndex === -1) {
      break;
    }

    try {
      const streamContent = zlib
        .inflateSync(pdfBuffer.subarray(contentStartIndex, streamEndIndex))
        .toString('latin1');

      let showingTextLineMatch = showingTextLinePattern.exec(streamContent);
      while (showingTextLineMatch !== null) {
        const hexEncodedTextRuns =
          showingTextLineMatch[1].match(/<[0-9a-fA-F]+>/g) ?? [];
        drawnTextRuns.push(
          hexEncodedTextRuns
            .map((hexEncodedTextRun) =>
              Buffer.from(hexEncodedTextRun.slice(1, -1), 'hex').toString('latin1')
            )
            .join('')
        );
        showingTextLineMatch = showingTextLinePattern.exec(streamContent);
      }
      showingTextLinePattern.lastIndex = 0;
    } catch (streamIsNotInflatableError) {
      // Embedded font binaries are not Flate-compressed text streams.
    }

    searchOffset = streamEndIndex + 'endstream'.length;
  }

  return drawnTextRuns.join(' ').replace(/\s+/g, '');
}

function createMockResponseObject() {
  return {
    statusCode: null,
    responseHeaders: {},
    body: null,
    status: function setStatus(code) {
      this.statusCode = code;
      return this;
    },
    set: function setHeaders(headers) {
      Object.assign(this.responseHeaders, headers);
      return this;
    },
    json: function sendJson(payload) {
      this.body = payload;
      return this;
    },
    send: function sendBuffer(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('generateTicketPdfBuffer returns a valid PDF buffer', async () => {
  const confirmedBooking = await createConfirmedBooking();

  const pdfBuffer = await generateTicketPdfBuffer(confirmedBooking);

  assert.ok(Buffer.isBuffer(pdfBuffer));
  assert.equal(pdfBuffer.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdfBuffer.toString('latin1').includes('%%EOF'));
  assert.ok(pdfBuffer.length > 2000, 'PDF should be more than a stub document');
});

test('generateTicketPdfBuffer embeds the booking reference inside the PDF', async () => {
  const confirmedBooking = await createConfirmedBooking();

  const pdfBuffer = await generateTicketPdfBuffer(confirmedBooking);

  const pdfTextContent = pdfBuffer.toString('latin1');
  assert.ok(pdfTextContent.includes(confirmedBooking.ref));
  assert.ok(pdfTextContent.includes(confirmedBooking.full_name));
});

test('generateTicketPdfBuffer omits the payment block when no payment summary is given', async () => {
  const confirmedBooking = await createConfirmedBooking();

  const pdfBuffer = await generateTicketPdfBuffer(confirmedBooking);

  const drawnTicketText = readDrawnTextFromPdf(pdfBuffer);
  assert.ok(drawnTicketText.includes('BLOCKCHAINMASTERCLASS'));
  assert.ok(drawnTicketText.includes('07/10/2026'));
  assert.ok(drawnTicketText.includes('JengamustakabalikwaBlockchain'));
  assert.ok(drawnTicketText.includes('VillageHallMafaoHouse'));
  assert.ok(drawnTicketText.includes('Arusha,Tanzania'));
  assert.ok(drawnTicketText.includes('inkryptus.com'));
  assert.ok(drawnTicketText.includes('+255621745217'));
  assert.ok(drawnTicketText.includes(confirmedBooking.ref.replace('-', '')));
  assert.ok(!drawnTicketText.includes('PAYMENT'));
});

test('generateTicketPdfBuffer prints the attendee name and ticket reference', async () => {
  const confirmedBooking = await createConfirmedBooking();

  const pdfBuffer = await generateTicketPdfBuffer(confirmedBooking);
  const drawnTicketText = readDrawnTextFromPdf(pdfBuffer);

  assert.ok(drawnTicketText.includes('ATTENDEE'));
  assert.ok(drawnTicketText.includes(confirmedBooking.full_name.replace(/\s+/g, '')));
  assert.ok(drawnTicketText.includes(`TICKETIDEVT-${confirmedBooking.ref}`));
});

test('generateTicketPdfBuffer embeds the Inkryptus logo and the QR code images', async () => {
  const confirmedBooking = await createConfirmedBooking();

  const pdfBuffer = await generateTicketPdfBuffer(confirmedBooking);
  const embeddedImageCount = (pdfBuffer.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length;

  assert.ok(embeddedImageCount >= 2, 'the ticket should embed both the wordmark and the QR code');
});

test('generateTicketPdfBuffer renders a payment block when a payment summary is given', async () => {
  const confirmedBooking = await createConfirmedBooking();
  const completingTransactionHash =
    '0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
  const paymentSummary = {
    txHash: completingTransactionHash,
    amountPaidUsdt: '3.80',
    blockNumber: 101,
  };

  const pdfBuffer = await generateTicketPdfBuffer(confirmedBooking, paymentSummary);

  assert.equal(pdfBuffer.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdfBuffer.length > 2000);

  const drawnTicketText = readDrawnTextFromPdf(pdfBuffer);
  assert.ok(drawnTicketText.includes('PAYMENT'));
  assert.ok(drawnTicketText.includes('3.80USDT'));
  assert.ok(drawnTicketText.includes('BLOCK101'));
  assert.ok(drawnTicketText.includes(`${completingTransactionHash.slice(0, 12)}...`));
  assert.ok(drawnTicketText.includes(completingTransactionHash.slice(-6)));
  assert.ok(!drawnTicketText.includes(completingTransactionHash));
});

test('downloadTicketPdfEndpoint returns a 404 for an unknown booking reference', async () => {
  const mockRequest = { params: { bookingRef: 'UNKNOWNREF' } };
  const mockResponse = createMockResponseObject();

  await downloadTicketPdfEndpoint(mockRequest, mockResponse);

  assert.equal(mockResponse.statusCode, 404);
  assert.ok(mockResponse.body.message.includes('Booking not found'));
});

test('downloadTicketPdfEndpoint returns a 403 for an unconfirmed booking', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Pending Download User',
    email: 'pending-download@example.com',
    phone_number: '+255712345697',
  });

  const mockRequest = { params: { bookingRef: bookingRecord.ref } };
  const mockResponse = createMockResponseObject();

  await downloadTicketPdfEndpoint(mockRequest, mockResponse);

  assert.equal(mockResponse.statusCode, 403);
  assert.ok(mockResponse.body.message.includes('confirmed'));
});

test('downloadTicketPdfEndpoint serves a PDF for a confirmed booking', async () => {
  const confirmedBooking = await createConfirmedBooking();

  const mockRequest = { params: { bookingRef: confirmedBooking.ref } };
  const mockResponse = createMockResponseObject();

  await downloadTicketPdfEndpoint(mockRequest, mockResponse);

  assert.equal(mockResponse.responseHeaders['Content-Type'], 'application/pdf');
  assert.ok(mockResponse.responseHeaders['Content-Disposition'].includes('attachment'));
  assert.ok(mockResponse.responseHeaders['Content-Disposition'].includes(confirmedBooking.ref));
  assert.ok(Buffer.isBuffer(mockResponse.body));
  assert.equal(mockResponse.body.subarray(0, 5).toString(), '%PDF-');
});