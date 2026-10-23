import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

import { PLATFORM_BRAND_NAME, PLATFORM_WEBSITE_ADDRESS } from './eventConfigService.js';

// The receipt is a document of record, so it is set in the same institutional
// language as the event site: bone paper, an ink masthead, one burnished copper
// accent used as ink, hairline rules and the perforated-ticket silhouette.
const INSTITUTION_INK_COLOR = '#14120E';
const INSTITUTION_PAPER_COLOR = '#F2EDE3';
const INSTITUTION_PAPER_SUNK_COLOR = '#E9E2D5';
const INSTITUTION_COPPER_COLOR = '#A34A25';
const INSTITUTION_COPPER_LIGHT_COLOR = '#C9703F';
const INSTITUTION_SECONDARY_TEXT_COLOR = '#615A4D';
const INSTITUTION_ON_INK_MUTED_COLOR = '#A6A198';
const INSTITUTION_HAIRLINE_COLOR = '#CAC6BD';
const INSTITUTION_HAIRLINE_STRONG_COLOR = '#A29E96';

const RECEIPT_DISPLAY_FONT = 'Times-Roman';
const RECEIPT_DISPLAY_ITALIC_FONT = 'Times-Italic';
const RECEIPT_BODY_FONT = 'Helvetica';
const RECEIPT_MONO_FONT = 'Courier';
const RECEIPT_MONO_BOLD_FONT = 'Courier-Bold';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const CONTENT_MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - CONTENT_MARGIN * 2;

const MASTHEAD_HEIGHT = 128;
const EVENT_FACT_COLUMNS = [
  { factX: CONTENT_MARGIN, factWidth: 165 },
  { factX: 228, factWidth: 160 },
  { factX: 398, factWidth: 149 },
];
// The attendee row carries an email address, so it gives that column the extra
// width an address needs instead of forcing a mid-word break.
const ATTENDEE_FACT_COLUMNS = [
  { factX: CONTENT_MARGIN, factWidth: 160 },
  { factX: 218, factWidth: 205 },
  { factX: 433, factWidth: 114 },
];
const PAYMENT_FACT_COLUMNS = [
  { factX: CONTENT_MARGIN, factWidth: 237 },
  { factX: 305, factWidth: 242 },
];

const BARCODE_LINE_WIDTHS = [
  2, 1, 3, 1, 2, 4, 1, 1, 3, 2, 1, 4, 2, 1, 3, 1, 2, 3, 1, 2,
  2, 1, 3, 2, 1, 4, 1, 2, 3, 1,
];

export async function generatePaymentReceiptPdfBuffer({
  bookingRecord,
  paymentRecord,
  receiptRecord,
  eventDetails,
  qrPayloadPayload,
}) {
  const receiptQrPayload =
    qrPayloadPayload ?? buildFallbackPaymentReceiptQrPayload(bookingRecord, receiptRecord);
  const receiptQrBuffer = await generateReceiptQrBuffer(receiptQrPayload);

  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: 'A4',
      margin: CONTENT_MARGIN,
      info: {
        Title: `Payment receipt - ${eventDetails.eventTitle} (${bookingRecord.ref})`,
        Author: PLATFORM_BRAND_NAME,
        Subject: `Payment receipt for ${bookingRecord.full_name}`,
        Creator: PLATFORM_WEBSITE_ADDRESS,
      },
    });

    const receiptPdfChunks = [];
    document.on('data', (chunk) => receiptPdfChunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(receiptPdfChunks)));
    document.on('error', reject);

    drawReceiptPageBackgroundOnDocument(document);
    drawInstitutionMastheadOnDocument(document, eventDetails, receiptRecord);
    drawAmountPaidSummaryOnDocument(document, receiptRecord);
    drawReceiptVerificationQrOnDocument(document, receiptQrBuffer);

    drawReceiptSectionHeadingOnDocument(document, 'EVENT DETAILS', 300);
    drawEventFactGridOnDocument(document, eventDetails, 320);

    drawReceiptSectionHeadingOnDocument(document, 'ATTENDEE', 358);
    drawAttendeeFactGridOnDocument(document, bookingRecord, 378);

    drawHairlineRuleAcrossContentOnDocument(document, 414);

    drawReceiptSectionHeadingOnDocument(document, 'PAYMENT', 428);
    drawPaymentFactGridOnDocument(document, { paymentRecord, receiptRecord }, 448);

    drawHairlineRuleAcrossContentOnDocument(document, 578);

    drawReceiptSectionHeadingOnDocument(document, 'ON-CHAIN DETAILS', 592);
    drawBlockchainFactRowsOnDocument(document, receiptRecord, 612);

    drawSettlementRecordBandOnDocument(document, receiptRecord);
    drawReceiptFooterOnDocument(document);

    document.end();
  });
}

function buildFallbackPaymentReceiptQrPayload(bookingRecord, receiptRecord) {
  return {
    documentType: 'payment-receipt',
    bookingReference: bookingRecord.ref,
    attendeeName: bookingRecord.full_name,
    receiptId: receiptRecord.id,
    paymentTransactionHash: receiptRecord.txHash,
    amountPaidUsdt: receiptRecord.amountPaidUsdt,
    amountPaidWei: receiptRecord.amountWei,
    explorerTransactionUrl: receiptRecord.explorerTxUrl,
  };
}

async function generateReceiptQrBuffer(receiptQrPayload) {
  return QRCode.toBuffer(JSON.stringify(receiptQrPayload), {
    width: 240,
    margin: 1,
    color: { dark: INSTITUTION_INK_COLOR, light: INSTITUTION_PAPER_COLOR },
  });
}

function drawReceiptPageBackgroundOnDocument(document) {
  document.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT).fill(INSTITUTION_PAPER_COLOR);
}

function drawInstitutionMastheadOnDocument(document, eventDetails, receiptRecord) {
  document.rect(0, 0, PAGE_WIDTH, MASTHEAD_HEIGHT).fill(INSTITUTION_INK_COLOR);
  document.rect(0, MASTHEAD_HEIGHT - 1, PAGE_WIDTH, 1).fill(INSTITUTION_COPPER_COLOR);

  document
    .font(RECEIPT_MONO_BOLD_FONT)
    .fontSize(8)
    .fillColor(INSTITUTION_COPPER_LIGHT_COLOR)
    .text(PLATFORM_BRAND_NAME.toUpperCase(), CONTENT_MARGIN, 26, {
      characterSpacing: 2.6,
    });

  document
    .font(RECEIPT_MONO_FONT)
    .fontSize(7.5)
    .fillColor(INSTITUTION_COPPER_LIGHT_COLOR)
    .text('PAYMENT RECEIPT', CONTENT_MARGIN, 26, {
      width: CONTENT_WIDTH,
      align: 'right',
      characterSpacing: 1.8,
    });

  document
    .font(RECEIPT_DISPLAY_FONT)
    .fontSize(28)
    .fillColor(INSTITUTION_PAPER_COLOR)
    .text(eventDetails.eventTitle, CONTENT_MARGIN, 48, {
      width: CONTENT_WIDTH - 120,
    });

  document
    .font(RECEIPT_BODY_FONT)
    .fontSize(9)
    .fillColor(INSTITUTION_ON_INK_MUTED_COLOR)
    .text(`${eventDetails.eventDate}  ·  ${eventDetails.eventLocation}`, CONTENT_MARGIN, 94, {
      width: CONTENT_WIDTH - 140,
    });

  document
    .font(RECEIPT_MONO_FONT)
    .fontSize(7.5)
    .fillColor(INSTITUTION_ON_INK_MUTED_COLOR)
    .text(`RECEIPT NO. RCP-${receiptRecord.id}`, CONTENT_MARGIN, 94, {
      width: CONTENT_WIDTH,
      align: 'right',
      characterSpacing: 1.2,
    });
}

function drawAmountPaidSummaryOnDocument(document, receiptRecord) {
  drawMonoFieldLabelOnDocument(document, 'AMOUNT PAID', CONTENT_MARGIN, 154);

  document
    .font(RECEIPT_DISPLAY_FONT)
    .fontSize(34)
    .fillColor(INSTITUTION_INK_COLOR)
    .text(`${receiptRecord.amountPaidUsdt} USDT`, CONTENT_MARGIN, 166, {
      width: 300,
    });

  document
    .font(RECEIPT_MONO_FONT)
    .fontSize(7)
    .fillColor(INSTITUTION_SECONDARY_TEXT_COLOR)
    .text(`${receiptRecord.amountWei} WEI`, CONTENT_MARGIN, 212, {
      width: 300,
      characterSpacing: 0.6,
    });

  drawSettlementStatusChipOnDocument(document, 'CONFIRMED', CONTENT_MARGIN, 236);
}

function drawSettlementStatusChipOnDocument(document, statusLabel, chipX, chipY) {
  const chipWidth = 92;
  const chipHeight = 22;

  document
    .lineWidth(0.8)
    .strokeColor(INSTITUTION_HAIRLINE_STRONG_COLOR)
    .rect(chipX, chipY, chipWidth, chipHeight)
    .stroke();

  document
    .font(RECEIPT_MONO_BOLD_FONT)
    .fontSize(6.5)
    .fillColor(INSTITUTION_INK_COLOR)
    .text(statusLabel, chipX, chipY + 7, {
      width: chipWidth,
      align: 'center',
      characterSpacing: 1.4,
    });
}

function drawReceiptVerificationQrOnDocument(document, receiptQrBuffer) {
  const qrSize = 118;
  const qrX = PAGE_WIDTH - CONTENT_MARGIN - qrSize;
  const qrY = 156;

  document
    .font(RECEIPT_MONO_FONT)
    .fontSize(5.8)
    .fillColor(INSTITUTION_SECONDARY_TEXT_COLOR)
    .text('SCAN TO VERIFY THIS RECEIPT', qrX, 142, {
      width: qrSize,
      align: 'center',
      characterSpacing: 0.8,
    });

  document.image(receiptQrBuffer, qrX, qrY, {
    width: qrSize,
    height: qrSize,
  });

  document
    .lineWidth(0.7)
    .strokeColor(INSTITUTION_HAIRLINE_COLOR)
    .rect(qrX - 6, qrY - 6, qrSize + 12, qrSize + 12)
    .stroke();
}

function drawReceiptSectionHeadingOnDocument(document, headingText, headingY) {
  document
    .font(RECEIPT_MONO_BOLD_FONT)
    .fontSize(7.5)
    .fillColor(INSTITUTION_COPPER_COLOR)
    .text(headingText, CONTENT_MARGIN, headingY, {
      characterSpacing: 1.8,
    });

  document
    .lineWidth(0.6)
    .strokeColor(INSTITUTION_HAIRLINE_COLOR)
    .moveTo(CONTENT_MARGIN, headingY + 13)
    .lineTo(PAGE_WIDTH - CONTENT_MARGIN, headingY + 13)
    .stroke();
}

function drawEventFactGridOnDocument(document, eventDetails, gridTop) {
  const eventFacts = [
    { factLabel: 'DATE', factValue: eventDetails.eventDate },
    { factLabel: 'VENUE', factValue: eventDetails.eventLocation },
    { factLabel: 'EVENT', factValue: eventDetails.eventTitle },
  ];

  eventFacts.forEach((eventFact, columnIndex) => {
    const factColumn = EVENT_FACT_COLUMNS[columnIndex];
    drawTextFactOnDocument(document, {
      factLabel: eventFact.factLabel,
      factValue: eventFact.factValue,
      factX: factColumn.factX,
      factY: gridTop,
      factWidth: factColumn.factWidth,
    });
  });
}

function drawAttendeeFactGridOnDocument(document, bookingRecord, gridTop) {
  const attendeeFacts = [
    { factLabel: 'ATTENDEE', factValue: bookingRecord.full_name },
    { factLabel: 'EMAIL', factValue: bookingRecord.email },
    { factLabel: 'BOOKING REFERENCE', factValue: bookingRecord.ref },
  ];

  attendeeFacts.forEach((attendeeFact, columnIndex) => {
    const factColumn = ATTENDEE_FACT_COLUMNS[columnIndex];
    drawTextFactOnDocument(document, {
      factLabel: attendeeFact.factLabel,
      factValue: attendeeFact.factValue,
      factX: factColumn.factX,
      factY: gridTop,
      factWidth: factColumn.factWidth,
    });
  });
}

function drawTextFactOnDocument(document, { factLabel, factValue, factX, factY, factWidth }) {
  drawMonoFieldLabelOnDocument(document, factLabel, factX, factY, factWidth);

  document
    .font(RECEIPT_BODY_FONT)
    .fontSize(10)
    .fillColor(INSTITUTION_INK_COLOR)
    .text(factValue ?? '—', factX, factY + 11, {
      width: factWidth,
      lineGap: 1,
    });
}

function drawPaymentFactGridOnDocument(document, { paymentRecord, receiptRecord }, gridTop) {
  const paymentFactRows = [
    [
      { factLabel: 'Payment Reference:', factValue: `RCP-${receiptRecord.id}` },
      { factLabel: 'Payment Method:', factValue: paymentRecord.payment_method },
    ],
    [
      { factLabel: 'Amount Paid:', factValue: `${receiptRecord.amountPaidUsdt} USDT` },
      { factLabel: 'Amount Paid (Wei):', factValue: receiptRecord.amountWei },
    ],
    [
      { factLabel: 'Block Number:', factValue: String(receiptRecord.blockNumber) },
      {
        factLabel: 'Finalized Block Number:',
        factValue: String(receiptRecord.finalizedBlockNumber),
      },
    ],
    [
      {
        factLabel: 'Confirmations At Issue:',
        factValue: String(receiptRecord.confirmationsAtIssue),
      },
      { factLabel: 'Settlement:', factValue: 'On-chain' },
    ],
  ];

  paymentFactRows.forEach((paymentFactRow, rowIndex) => {
    const rowTop = gridTop + rowIndex * 32;

    paymentFactRow.forEach((paymentFact, columnIndex) => {
      const factColumn = PAYMENT_FACT_COLUMNS[columnIndex];
      drawMonoFieldLabelOnDocument(
        document,
        paymentFact.factLabel,
        factColumn.factX,
        rowTop,
        factColumn.factWidth
      );

      document
        .font(RECEIPT_MONO_FONT)
        .fontSize(8.5)
        .fillColor(INSTITUTION_INK_COLOR)
        .text(paymentFact.factValue, factColumn.factX, rowTop + 10, {
          width: factColumn.factWidth,
          height: 12,
          ellipsis: true,
        });
    });
  });
}

function drawBlockchainFactRowsOnDocument(document, receiptRecord, rowsTop) {
  const blockchainFactRows = [
    { factLabel: 'TRANSACTION HASH:', factValue: receiptRecord.txHash, wrapsAtWidth: 499 },
    { factLabel: 'DEPOSIT ADDRESS:', factValue: receiptRecord.depositAddress, wrapsAtWidth: 499 },
    {
      factLabel: 'PAYER ADDRESS:',
      factValue: receiptRecord.payerAddress ?? 'Not recorded',
      wrapsAtWidth: 499,
    },
  ];

  blockchainFactRows.forEach((blockchainFactRow, rowIndex) => {
    const rowTop = rowsTop + rowIndex * 30;
    const factX = CONTENT_MARGIN;

    drawMonoFieldLabelOnDocument(document, blockchainFactRow.factLabel, factX, rowTop);

    document
      .font(RECEIPT_MONO_FONT)
      .fontSize(8.5)
      .fillColor(INSTITUTION_INK_COLOR)
      .text(blockchainFactRow.factValue, factX, rowTop + 10, {
        width: blockchainFactRow.wrapsAtWidth,
        lineGap: 1.5,
        characterSpacing: 0.2,
      });
  });

  const explorerRowTop = rowsTop + blockchainFactRows.length * 30;

  if (receiptRecord.explorerTxUrl) {
    document
      .font(RECEIPT_MONO_FONT)
      .fontSize(9)
      .fillColor(INSTITUTION_SECONDARY_TEXT_COLOR)
      .text(`Explorer:  ${receiptRecord.explorerTxUrl}`, CONTENT_MARGIN, explorerRowTop, {
        width: 430,
        lineGap: 1.5,
        characterSpacing: 0.2,
      });
  }
}

function drawSettlementRecordBandOnDocument(document, receiptRecord) {
  const bandTop = 732;
  const bandHeight = 56;

  document.rect(CONTENT_MARGIN, bandTop, CONTENT_WIDTH, bandHeight).fill(INSTITUTION_PAPER_SUNK_COLOR);
  document
    .lineWidth(0.6)
    .strokeColor(INSTITUTION_HAIRLINE_COLOR)
    .rect(CONTENT_MARGIN, bandTop, CONTENT_WIDTH, bandHeight)
    .stroke();

  drawReceiptSealOnDocument(document, CONTENT_MARGIN + 40, bandTop + bandHeight / 2);

  document
    .font(RECEIPT_MONO_FONT)
    .fontSize(5.8)
    .fillColor(INSTITUTION_COPPER_COLOR)
    .text('SETTLEMENT', CONTENT_MARGIN + 82, bandTop + 12, {
      characterSpacing: 1.4,
    });

  document
    .font(RECEIPT_DISPLAY_FONT)
    .fontSize(13)
    .fillColor(INSTITUTION_INK_COLOR)
    .text('Finalised on-chain', CONTENT_MARGIN + 82, bandTop + 21, {
      width: 180,
    });

  document
    .font(RECEIPT_MONO_FONT)
    .fontSize(5.8)
    .fillColor(INSTITUTION_SECONDARY_TEXT_COLOR)
    .text(
      `Block ${receiptRecord.blockNumber} · ${receiptRecord.confirmationsAtIssue} confirmations`,
      CONTENT_MARGIN + 82,
      bandTop + 38,
      {
        width: 180,
        characterSpacing: 0.4,
      }
    );

  drawReceiptBarcodeOnDocument(document, {
    barcodeX: PAGE_WIDTH - CONTENT_MARGIN - 156,
    barcodeY: bandTop + 10,
    barcodeWidth: 156,
    barcodeHeight: 24,
  });

  document
    .font(RECEIPT_MONO_FONT)
    .fontSize(5.4)
    .fillColor(INSTITUTION_SECONDARY_TEXT_COLOR)
    .text(`RCP-${receiptRecord.id} · ${receiptRecord.amountPaidUsdt} USDT`, PAGE_WIDTH - CONTENT_MARGIN - 156, bandTop + 39, {
      width: 156,
      align: 'right',
      characterSpacing: 0.5,
    });
}

function drawReceiptSealOnDocument(document, sealCenterX, sealCenterY) {
  document
    .lineWidth(0.9)
    .strokeColor(INSTITUTION_COPPER_COLOR)
    .circle(sealCenterX, sealCenterY, 23)
    .stroke();

  document
    .lineWidth(0.4)
    .strokeColor(INSTITUTION_COPPER_COLOR)
    .circle(sealCenterX, sealCenterY, 18.5)
    .stroke();

  document
    .font(RECEIPT_MONO_BOLD_FONT)
    .fontSize(4.4)
    .fillColor(INSTITUTION_COPPER_COLOR)
    .text(PLATFORM_BRAND_NAME.toUpperCase(), sealCenterX - 24, sealCenterY - 9, {
      width: 48,
      align: 'center',
      characterSpacing: 0.2,
    });

  document
    .font(RECEIPT_DISPLAY_ITALIC_FONT)
    .fontSize(9)
    .fillColor(INSTITUTION_COPPER_COLOR)
    .text('Paid', sealCenterX - 24, sealCenterY - 3, {
      width: 48,
      align: 'center',
    });

  document
    .font(RECEIPT_MONO_FONT)
    .fontSize(3.8)
    .fillColor(INSTITUTION_COPPER_COLOR)
    .text('ON-CHAIN', sealCenterX - 24, sealCenterY + 8, {
      width: 48,
      align: 'center',
      characterSpacing: 0.4,
    });
}

function drawReceiptBarcodeOnDocument(
  document,
  { barcodeX, barcodeY, barcodeWidth, barcodeHeight }
) {
  let lineCursorX = barcodeX;
  let lineIndex = 0;

  while (lineCursorX < barcodeX + barcodeWidth) {
    const barFillWidth = BARCODE_LINE_WIDTHS[lineIndex % BARCODE_LINE_WIDTHS.length] * 1.35;
    if (lineCursorX + barFillWidth > barcodeX + barcodeWidth) {
      break;
    }

    document.rect(lineCursorX, barcodeY, barFillWidth, barcodeHeight).fill(INSTITUTION_INK_COLOR);
    lineCursorX += barFillWidth + 2.1;
    lineIndex += 1;
  }
}

function drawReceiptFooterOnDocument(document) {
  const seamY = 800;

  document
    .save()
    .lineWidth(0.7)
    .strokeColor(INSTITUTION_COPPER_COLOR)
    .dash(2, { space: 4 })
    .moveTo(CONTENT_MARGIN, seamY)
    .lineTo(PAGE_WIDTH - CONTENT_MARGIN, seamY)
    .stroke()
    .undash()
    .restore();

  document
    .font(RECEIPT_MONO_BOLD_FONT)
    .fontSize(7)
    .fillColor(INSTITUTION_INK_COLOR)
    .text(PLATFORM_BRAND_NAME, CONTENT_MARGIN, seamY + 12, {
      characterSpacing: 1.2,
    });

  document
    .font(RECEIPT_MONO_FONT)
    .fontSize(6.4)
    .fillColor(INSTITUTION_SECONDARY_TEXT_COLOR)
    .text(PLATFORM_WEBSITE_ADDRESS, CONTENT_MARGIN, seamY + 24, {
      characterSpacing: 0.4,
    });

  document
    .font(RECEIPT_MONO_FONT)
    .fontSize(6.2)
    .fillColor(INSTITUTION_SECONDARY_TEXT_COLOR)
    .text(
      'This receipt confirms an on-chain payment. Keep it for your records.',
      CONTENT_MARGIN,
      seamY + 12,
      {
        width: CONTENT_WIDTH,
        align: 'right',
      }
    );

  document
    .font(RECEIPT_MONO_FONT)
    .fontSize(5.6)
    .fillColor(INSTITUTION_SECONDARY_TEXT_COLOR)
    .text(
      `Issued by ${PLATFORM_BRAND_NAME} · ${PLATFORM_WEBSITE_ADDRESS}`,
      CONTENT_MARGIN,
      seamY + 24,
      {
        width: CONTENT_WIDTH,
        align: 'right',
        characterSpacing: 0.3,
      }
    );
}

function drawMonoFieldLabelOnDocument(
  document,
  fieldLabel,
  fieldX,
  fieldY,
  fieldLabelWidth = CONTENT_WIDTH
) {
  document
    .font(RECEIPT_MONO_FONT)
    .fontSize(6)
    .fillColor(INSTITUTION_SECONDARY_TEXT_COLOR)
    .text(fieldLabel, fieldX, fieldY, {
      width: fieldLabelWidth,
      characterSpacing: 0.9,
      lineBreak: false,
    });
}

function drawHairlineRuleAcrossContentOnDocument(document, ruleY) {
  document
    .lineWidth(0.6)
    .strokeColor(INSTITUTION_HAIRLINE_COLOR)
    .moveTo(CONTENT_MARGIN, ruleY)
    .lineTo(PAGE_WIDTH - CONTENT_MARGIN, ruleY)
    .stroke();
}
