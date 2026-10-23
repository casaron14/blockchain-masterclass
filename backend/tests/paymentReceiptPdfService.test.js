import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'zlib';

import { generatePaymentReceiptPdfBuffer } from '../services/paymentReceiptPdfService.js';

const COMPLETING_TRANSACTION_HASH =
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const EVENT_DETAILS = {
  eventTitle: 'Blockchain Masterclass',
  eventDate: '7th November 2026',
  eventLocation: 'Arusha, Tanzania',
};

function buildReceiptRenderInput() {
  return {
    bookingRecord: {
      id: 41,
      ref: 'RCPT01',
      full_name: 'Receipt Pdf Attendee',
      email: 'receipt-pdf@example.com',
    },
    paymentRecord: {
      id: 42,
      payment_method: 'usdt_bep20',
    },
    receiptRecord: {
      id: 7,
      paymentId: 42,
      bookingId: 41,
      depositAddress: '0xDepositAddressForReceiptPdf',
      payerAddress: '0x1111111111111111111111111111111111111111',
      txHash: COMPLETING_TRANSACTION_HASH,
      blockNumber: 101,
      blockHash: '0xblockhash101',
      amountPaidUsdt: '3.80',
      amountWei: '3800000000000000000',
      finalizedBlockNumber: 110,
      confirmationsAtIssue: 10,
      explorerTxUrl: `https://bscscan.com/tx/${COMPLETING_TRANSACTION_HASH}`,
    },
    eventDetails: EVENT_DETAILS,
    qrPayloadPayload: {
      documentType: 'payment-receipt',
      bookingReference: 'RCPT01',
      receiptId: 7,
    },
  };
}

// The rendered text layer lives inside Flate-compressed content streams, and
// pdfkit writes each run of text as a hex-encoded byte string inside a TJ
// array. Inflating the streams and decoding those hex runs recovers the text
// the attendee sees, without asserting on raw PDF bytes.
function inflatePdfContentStreams(pdfBuffer) {
  const inflatedStreamContents = [];
  const streamMarker = Buffer.from('stream');
  const endStreamMarker = Buffer.from('endstream');

  let searchOffset = 0;
  while (searchOffset < pdfBuffer.length) {
    const streamStartIndex = pdfBuffer.indexOf(streamMarker, searchOffset);
    if (streamStartIndex === -1) {
      break;
    }

    const contentStartIndex = streamStartIndex + streamMarker.length + 1;
    const streamEndIndex = pdfBuffer.indexOf(endStreamMarker, contentStartIndex);
    if (streamEndIndex === -1) {
      break;
    }

    const rawStreamSlice = pdfBuffer.subarray(contentStartIndex, streamEndIndex);
    try {
      inflatedStreamContents.push(
        zlib.inflateSync(rawStreamSlice).toString('latin1')
      );
    } catch (streamIsNotInflatableError) {
      // Embedded font binaries are not Flate-compressed text streams.
    }

    searchOffset = streamEndIndex + endStreamMarker.length;
  }

  return inflatedStreamContents;
}

function decodeHexEncodedTextRun(hexEncodedTextRun) {
  return Buffer.from(hexEncodedTextRun, 'hex').toString('latin1');
}

// Each TJ array is one drawn line of text. The array also carries kerning
// numbers, and pdfkit splits a line into several hex runs, so the hex runs of
// one array are concatenated back into the single string that was drawn.
function extractRenderedTextLinesFromPdf(pdfBuffer) {
  const renderedTextLines = [];
  const showingTextLinePattern = /\[([^\]]*)\]\s*TJ/g;

  for (const streamContent of inflatePdfContentStreams(pdfBuffer)) {
    let showingTextLineMatch = showingTextLinePattern.exec(streamContent);
    while (showingTextLineMatch !== null) {
      const hexEncodedTextRuns = showingTextLineMatch[1].match(/<[0-9a-fA-F]+>/g) ?? [];
      const drawnTextLine = hexEncodedTextRuns
        .map((hexEncodedTextRun) =>
          decodeHexEncodedTextRun(hexEncodedTextRun.slice(1, -1))
        )
        .join('');
      renderedTextLines.push(drawnTextLine);
      showingTextLineMatch = showingTextLinePattern.exec(streamContent);
    }
  }

  return renderedTextLines;
}

// Whitespace is dropped because kerning-driven hex splitting leaves stray
// spaces inside a word, and because pdfkit wraps long values onto a new line.
function removeAllWhitespaceFromText(text) {
  return text.replace(/\s+/g, '');
}

test('generatePaymentReceiptPdfBuffer returns a non-trivial PDF buffer', async () => {
  const receiptPdfBuffer = await generatePaymentReceiptPdfBuffer(
    buildReceiptRenderInput()
  );

  assert.ok(Buffer.isBuffer(receiptPdfBuffer));
  assert.equal(receiptPdfBuffer.subarray(0, 5).toString(), '%PDF-');
  assert.ok(
    receiptPdfBuffer.toString('latin1').includes('%%EOF'),
    'the PDF must be terminated'
  );
  assert.ok(receiptPdfBuffer.length > 2000, 'the receipt PDF must not be a stub');
});

test('generatePaymentReceiptPdfBuffer renders the transaction hash, amount and attendee details', async () => {
  const receiptPdfBuffer = await generatePaymentReceiptPdfBuffer(
    buildReceiptRenderInput()
  );

  const renderedTextLines = extractRenderedTextLinesFromPdf(receiptPdfBuffer);
  const flattenedRenderedText = removeAllWhitespaceFromText(
    renderedTextLines.join(' ')
  );

  assert.ok(
    flattenedRenderedText.includes(COMPLETING_TRANSACTION_HASH),
    `the transaction hash must be on the receipt, got: ${flattenedRenderedText}`
  );
  assert.ok(flattenedRenderedText.includes('3.80USDT'));
  assert.ok(flattenedRenderedText.includes('3800000000000000000'));
  assert.ok(flattenedRenderedText.includes('RCPT01'));
  assert.ok(flattenedRenderedText.includes('ReceiptPdfAttendee'));
  assert.ok(flattenedRenderedText.includes('receipt-pdf@example.com'));
  assert.ok(flattenedRenderedText.includes('BlockNumber:101'));
  assert.ok(flattenedRenderedText.includes('FinalizedBlockNumber:110'));
  assert.ok(flattenedRenderedText.includes('ConfirmationsAtIssue:10'));
  assert.ok(flattenedRenderedText.includes('0xDepositAddressForReceiptPdf'));
  assert.ok(flattenedRenderedText.includes('0x1111111111111111111111111111111111111111'));
  assert.ok(flattenedRenderedText.includes('usdt_bep20'));
  assert.ok(
    flattenedRenderedText.includes(
      removeAllWhitespaceFromText(`https://bscscan.com/tx/${COMPLETING_TRANSACTION_HASH}`)
    )
  );
  assert.ok(flattenedRenderedText.includes('PAYMENTRECEIPT'));
  assert.ok(flattenedRenderedText.includes('EVENTDETAILS'));
  assert.ok(flattenedRenderedText.includes('ON-CHAINDETAILS'));
});

test('generatePaymentReceiptPdfBuffer brands the receipt as DienAcademy in the institutional design', async () => {
  const receiptPdfBuffer = await generatePaymentReceiptPdfBuffer(
    buildReceiptRenderInput()
  );

  const renderedTextLines = extractRenderedTextLinesFromPdf(receiptPdfBuffer);
  const joinedRenderedText = renderedTextLines.join(' ');
  const flattenedRenderedText = removeAllWhitespaceFromText(joinedRenderedText);

  assert.ok(
    joinedRenderedText.includes('DienAcademy'),
    'the receipt must carry the one-word DienAcademy wordmark'
  );
  assert.ok(
    !joinedRenderedText.includes('Dien Academy'),
    'the receipt must not use the two-word brand name'
  );
  assert.ok(flattenedRenderedText.includes('DIENACADEMY'));
  assert.ok(flattenedRenderedText.includes('PAYMENTRECEIPT'));
  assert.ok(flattenedRenderedText.includes('CONFIRMED'));
  assert.ok(flattenedRenderedText.includes('Finalisedon-chain'));
});

test('generatePaymentReceiptPdfBuffer wraps a long transaction hash instead of dropping it', async () => {
  const receiptPdfBuffer = await generatePaymentReceiptPdfBuffer(
    buildReceiptRenderInput()
  );

  const renderedTextLines = extractRenderedTextLinesFromPdf(receiptPdfBuffer);
  // The explorer URL repeats the hash, so only the drawn lines that consist of
  // nothing but hash characters belong to the transaction hash itself.
  const drawnHashLines = renderedTextLines.filter((textLine) =>
    /^(0x)?b+$/.test(removeAllWhitespaceFromText(textLine))
  );

  assert.ok(drawnHashLines.length > 0, 'the transaction hash must be drawn');
  assert.equal(
    removeAllWhitespaceFromText(drawnHashLines.join('')),
    COMPLETING_TRANSACTION_HASH,
    'the drawn transaction hash must not be truncated'
  );

  const explorerUrlLine = renderedTextLines.find((textLine) =>
    textLine.includes('bscscan.com')
  );
  const explorerUrlContinuationLine = renderedTextLines[
    renderedTextLines.indexOf(explorerUrlLine) + 1
  ];

  assert.equal(
    removeAllWhitespaceFromText(explorerUrlLine + explorerUrlContinuationLine).replace(
      /^Explorer:/,
      ''
    ),
    removeAllWhitespaceFromText(`https://bscscan.com/tx/${COMPLETING_TRANSACTION_HASH}`),
    'the explorer URL must wrap without losing the transaction hash'
  );
});
