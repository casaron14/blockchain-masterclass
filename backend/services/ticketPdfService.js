import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

import { buildTicketQrCodeUrl } from './ticketQrCodeService.js';
import { INKRYPTUS_LOGO_ON_BLACK_PNG_BASE64 } from '../assets/inkryptusLogoOnBlackPngAsset.js';

// The ticket is a print-ready pass. Its copy is fixed to the details printed
// on the event pass, while attendee and referral data stay dynamic per booking.
const TICKET_EVENT_TITLE = 'Blockchain Masterclass';
const TICKET_EVENT_TITLE_LINES = TICKET_EVENT_TITLE.toUpperCase().split(' ');
const TICKET_BRAND_NAME = 'Inkryptus';
const TICKET_EVENT_DATE = '07/10/2026';
const TICKET_EVENT_TAGLINE = 'Jenga mustakabali kwa Blockchain';
const TICKET_VENUE_NAME = 'Village Hall Mafao House';
const TICKET_VENUE_CITY = 'Arusha, Tanzania';
const TICKET_WEBSITE_ADDRESS = 'inkryptus.com';
const TICKET_CONTACT_PHONE_NUMBER = '+255 621 745 217';

const TICKET_PAGE_WIDTH = 841.89;
const TICKET_PAGE_HEIGHT = 595.28;
const TICKET_PAGE_MARGIN = 42;
const TICKET_CONTENT_TOP_Y = 124;
const TICKET_FOOTER_BASELINE_Y = 556;
const TICKET_HEADER_RULE_Y = 96;
const TICKET_PANEL_DIVIDER_X = 506;
const TICKET_LEFT_COLUMN_WIDTH = TICKET_PANEL_DIVIDER_X - TICKET_PAGE_MARGIN - 28;

const TICKET_PREFERRED_TITLE_FONT_SIZE = 56;
const TICKET_TITLE_LINE_HEIGHT = 58;
const TICKET_TITLE_TOP_Y = 124;
const TICKET_DATE_TOP_Y = 264;
const TICKET_TAGLINE_TOP_Y = 308;
const TICKET_VENUE_TOP_Y = 340;
const TICKET_ATTENDEE_DIVIDER_Y = 396;
const TICKET_ATTENDEE_LABEL_TOP_Y = 414;
const TICKET_ATTENDEE_NAME_TOP_Y = 430;
const TICKET_ATTENDEE_NAME_MAX_HEIGHT = 24;
const TICKET_REFERENCE_TOP_Y = 460;

const TICKET_QR_OUTER_SIZE = 268;
const TICKET_QR_OUTER_PADDING = 8;
const TICKET_QR_TOP_Y = 196;
const TICKET_QR_CAPTION_TOP_Y = 482;
const TICKET_QR_REFERENCE_TOP_Y = 500;

const TICKET_BLACK = '#000000';
const TICKET_WHITE = '#FFFFFF';
const TICKET_SECONDARY_TEXT = '#C9C9C9';
const TICKET_MUTED_TEXT = '#8A8A8A';
const TICKET_DIVIDER_COLOR = '#444444';
const TICKET_QR_IMAGE_SIZE = TICKET_QR_OUTER_SIZE - TICKET_QR_OUTER_PADDING * 2;
const TICKET_QR_PANEL_X = TICKET_PAGE_WIDTH - TICKET_PAGE_MARGIN - TICKET_QR_OUTER_SIZE;
const TICKET_LOGO_WIDTH = 136;

const INKRYPTUS_LOGO_ON_BLACK_PNG_BUFFER = Buffer.from(
  INKRYPTUS_LOGO_ON_BLACK_PNG_BASE64,
  'base64'
);

export async function generateTicketPdfBuffer(bookingRecord, paymentSummary = null) {
  const ticketQrCodeUrl = buildTicketQrCodeUrl(bookingRecord);
  const qrCodePngBuffer = await QRCode.toBuffer(ticketQrCodeUrl, {
    width: 1000,
    margin: 4,
    errorCorrectionLevel: 'M',
    color: { dark: TICKET_BLACK, light: TICKET_WHITE },
  });

  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: [TICKET_PAGE_WIDTH, TICKET_PAGE_HEIGHT],
      margin: 0,
      info: {
        Title: `${TICKET_EVENT_TITLE} ticket - ${bookingRecord.ref}`,
        Author: TICKET_BRAND_NAME,
        Subject: `Admit one: ${bookingRecord.full_name}`,
      },
    });

    const pdfChunks = [];
    document.on('data', (chunk) => pdfChunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(pdfChunks)));
    document.on('error', reject);

    drawTicketBackground(document);
    drawTicketHeader(document);
    drawTicketEventTitle(document);
    drawTicketDate(document);
    drawTicketTaglineAndVenue(document);
    drawAttendeeDetails(document, bookingRecord);

    if (paymentSummary) {
      drawPaymentSummary(document, paymentSummary);
    }

    drawTicketFooter(document);
    drawQrPanelDivider(document);
    drawQrCodePanel(document, qrCodePngBuffer, bookingRecord);

    document.end();
  });
}

function drawTicketBackground(document) {
  document
    .rect(0, 0, TICKET_PAGE_WIDTH, TICKET_PAGE_HEIGHT)
    .fill(TICKET_BLACK);
}

function drawTicketHeader(document) {
  document.image(INKRYPTUS_LOGO_ON_BLACK_PNG_BUFFER, TICKET_PAGE_MARGIN, 37, {
    width: TICKET_LOGO_WIDTH,
  });

  document
    .font('Helvetica')
    .fontSize(10)
    .fillColor(TICKET_WHITE)
    .text(TICKET_WEBSITE_ADDRESS, 0, 49, {
      width: TICKET_PAGE_WIDTH,
      align: 'center',
      characterSpacing: 2,
    });

  document.text(TICKET_CONTACT_PHONE_NUMBER, 0, 49, {
    width: TICKET_PAGE_WIDTH - TICKET_PAGE_MARGIN,
    align: 'right',
    characterSpacing: 0.6,
  });

  document
    .moveTo(TICKET_PAGE_MARGIN, TICKET_HEADER_RULE_Y)
    .lineTo(TICKET_PAGE_WIDTH - TICKET_PAGE_MARGIN, TICKET_HEADER_RULE_Y)
    .lineWidth(0.5)
    .strokeColor(TICKET_DIVIDER_COLOR)
    .stroke();
}

function drawTicketEventTitle(document) {
  const sharedTitleFontSize = resolveSharedTitleFontSize(document);

  document.font('Helvetica-Bold').fontSize(sharedTitleFontSize).fillColor(TICKET_WHITE);

  TICKET_EVENT_TITLE_LINES.forEach((titleLine, titleLineIndex) => {
    document.text(
      titleLine,
      TICKET_PAGE_MARGIN,
      TICKET_TITLE_TOP_Y + titleLineIndex * TICKET_TITLE_LINE_HEIGHT,
      { characterSpacing: -0.8 }
    );
  });
}

function resolveSharedTitleFontSize(document) {
  document.font('Helvetica-Bold').fontSize(TICKET_PREFERRED_TITLE_FONT_SIZE);

  return TICKET_EVENT_TITLE_LINES.reduce((sharedTitleFontSize, titleLine) => {
    const measuredTitleWidth = document.widthOfString(titleLine);
    const largestFontSizeThatFits =
      (TICKET_PREFERRED_TITLE_FONT_SIZE * TICKET_LEFT_COLUMN_WIDTH) / measuredTitleWidth;

    return Math.min(sharedTitleFontSize, Math.floor(largestFontSizeThatFits));
  }, TICKET_PREFERRED_TITLE_FONT_SIZE);
}

function drawTicketDate(document) {
  document
    .font('Helvetica-Bold')
    .fontSize(26)
    .fillColor(TICKET_WHITE)
    .text(TICKET_EVENT_DATE, TICKET_PAGE_MARGIN, TICKET_DATE_TOP_Y, {
      width: TICKET_LEFT_COLUMN_WIDTH,
      align: 'center',
      characterSpacing: 1.5,
    });
}

function drawTicketTaglineAndVenue(document) {
  document
    .font('Helvetica-Oblique')
    .fontSize(15)
    .fillColor(TICKET_SECONDARY_TEXT)
    .text(TICKET_EVENT_TAGLINE, TICKET_PAGE_MARGIN, TICKET_TAGLINE_TOP_Y, {
      width: TICKET_LEFT_COLUMN_WIDTH,
      align: 'center',
    });

  document
    .font('Helvetica-Bold')
    .fontSize(12.5)
    .fillColor(TICKET_WHITE)
    .text(TICKET_VENUE_NAME, TICKET_PAGE_MARGIN, TICKET_VENUE_TOP_Y, {
      width: TICKET_LEFT_COLUMN_WIDTH,
      align: 'center',
    });

  document
    .font('Helvetica')
    .fontSize(11.5)
    .fillColor(TICKET_SECONDARY_TEXT)
    .text(TICKET_VENUE_CITY, TICKET_PAGE_MARGIN, TICKET_VENUE_TOP_Y + 17, {
      width: TICKET_LEFT_COLUMN_WIDTH,
      align: 'center',
    });
}

function drawAttendeeDetails(document, bookingRecord) {
  drawLeftColumnRule(document, TICKET_ATTENDEE_DIVIDER_Y);

  document
    .font('Helvetica')
    .fontSize(8)
    .fillColor(TICKET_MUTED_TEXT)
    .text('ATTENDEE', TICKET_PAGE_MARGIN, TICKET_ATTENDEE_LABEL_TOP_Y, {
      characterSpacing: 2.4,
    });

  document
    .font('Helvetica-Bold')
    .fontSize(17)
    .fillColor(TICKET_WHITE)
    .text(bookingRecord.full_name, TICKET_PAGE_MARGIN, TICKET_ATTENDEE_NAME_TOP_Y, {
      width: TICKET_LEFT_COLUMN_WIDTH,
      height: TICKET_ATTENDEE_NAME_MAX_HEIGHT,
      ellipsis: true,
    });

  document
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor(TICKET_SECONDARY_TEXT)
    .text(
      `TICKET ID  EVT-${bookingRecord.ref}`,
      TICKET_PAGE_MARGIN,
      TICKET_REFERENCE_TOP_Y,
      { characterSpacing: 1.2 }
    );
}

function drawPaymentSummary(document, paymentSummary) {
  const shortenedTransactionHash = shortenBlockchainTransactionHashForTicket(
    paymentSummary.txHash
  );

  document
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(TICKET_MUTED_TEXT)
    .text(
      `PAYMENT  ${paymentSummary.amountPaidUsdt} USDT  ·  BLOCK ${paymentSummary.blockNumber}  ·  TX ${shortenedTransactionHash}`,
      TICKET_PAGE_MARGIN,
      TICKET_REFERENCE_TOP_Y + 26,
      {
        width: TICKET_LEFT_COLUMN_WIDTH,
        height: 12,
        ellipsis: true,
        characterSpacing: 0.4,
      }
    );
}

function shortenBlockchainTransactionHashForTicket(transactionHash) {
  if (transactionHash.length <= 24) {
    return transactionHash;
  }

  return `${transactionHash.slice(0, 12)}...${transactionHash.slice(-6)}`;
}

function drawTicketFooter(document) {
  document
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(TICKET_MUTED_TEXT)
    .text(
      'This ticket is non-transferable. Present a valid photo ID at the entrance.',
      TICKET_PAGE_MARGIN,
      TICKET_FOOTER_BASELINE_Y,
      {
        width: TICKET_LEFT_COLUMN_WIDTH,
        align: 'center',
        characterSpacing: 0.4,
      }
    );
}

function drawLeftColumnRule(document, yPosition) {
  document
    .moveTo(TICKET_PAGE_MARGIN, yPosition)
    .lineTo(TICKET_PAGE_MARGIN + TICKET_LEFT_COLUMN_WIDTH, yPosition)
    .lineWidth(0.5)
    .strokeColor(TICKET_DIVIDER_COLOR)
    .stroke();
}

function drawQrPanelDivider(document) {
  document
    .moveTo(TICKET_PANEL_DIVIDER_X, TICKET_CONTENT_TOP_Y)
    .lineTo(TICKET_PANEL_DIVIDER_X, TICKET_FOOTER_BASELINE_Y)
    .lineWidth(0.5)
    .strokeColor(TICKET_DIVIDER_COLOR)
    .stroke();
}

function drawQrCodePanel(document, qrCodePngBuffer, bookingRecord) {
  const qrPanelCaptionWidth = TICKET_QR_OUTER_SIZE;

  document
    .rect(TICKET_QR_PANEL_X, TICKET_QR_TOP_Y, TICKET_QR_OUTER_SIZE, TICKET_QR_OUTER_SIZE)
    .fill(TICKET_WHITE);

  document.image(
    qrCodePngBuffer,
    TICKET_QR_PANEL_X + TICKET_QR_OUTER_PADDING,
    TICKET_QR_TOP_Y + TICKET_QR_OUTER_PADDING,
    {
      width: TICKET_QR_IMAGE_SIZE,
      height: TICKET_QR_IMAGE_SIZE,
    }
  );

  document
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(TICKET_WHITE)
    .text('SCAN AT ENTRY', TICKET_QR_PANEL_X, TICKET_QR_CAPTION_TOP_Y, {
      width: qrPanelCaptionWidth,
      align: 'center',
      characterSpacing: 2.4,
    });

  document
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(TICKET_MUTED_TEXT)
    .text(`EVT-${bookingRecord.ref}`, TICKET_QR_PANEL_X, TICKET_QR_REFERENCE_TOP_Y, {
      width: qrPanelCaptionWidth,
      align: 'center',
      characterSpacing: 1.8,
    });
}
