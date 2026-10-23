import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

import {
  getEventDetails,
  buildTicketQrPayload,
} from './ticketDeliveryService.js';

const BRAND_TEAL = '#2E8282';
const BRAND_PURPLE = '#69478A';
const BRAND_DARK = '#1C3535';
const BRAND_MUTED = '#5F7F7F';
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;

export async function generateTicketPdfBuffer(bookingRecord, paymentSummary = null) {
  const eventDetails = getEventDetails();
  const qrPayload = buildTicketQrPayload(bookingRecord);
  const qrBuffer = await QRCode.toBuffer(JSON.stringify(qrPayload), {
    width: 200,
    margin: 1,
    color: { dark: '#0C2231', light: '#FFFFFF' },
  });

  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: 'A4',
      margin: MARGIN,
      info: {
        Title: `Ticket - ${eventDetails.eventTitle} (${bookingRecord.ref})`,
        Author: eventDetails.eventTitle,
        Subject: `Admit one: ${bookingRecord.full_name}`,
      },
    });

    const chunks = [];
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    drawHeaderBackground(document, eventDetails);
    drawEventDetailsSection(document, eventDetails);
    drawAttendeeDetailsSection(document, bookingRecord);

    if (paymentSummary) {
      drawPaymentSummarySection(document, paymentSummary);
    }

    drawQrCodeSection(document, qrBuffer);
    drawFooterSection(document, eventDetails);

    document.end();
  });
}

function drawHeaderBackground(document, eventDetails) {
  document
    .rect(0, 0, PAGE_WIDTH, 130)
    .fill(BRAND_TEAL);

  document
    .font('Helvetica-Bold')
    .fontSize(24)
    .fillColor('#FFFFFF')
    .text(eventDetails.eventTitle.toUpperCase(), MARGIN, 45, {
      width: PAGE_WIDTH - MARGIN * 2,
      align: 'center',
    });

  document
    .font('Helvetica')
    .fontSize(11)
    .fillColor('#FFFFFF')
    .text('ELECTRONIC TICKET', MARGIN, 80, {
      width: PAGE_WIDTH - MARGIN * 2,
      align: 'center',
    });
}

function drawEventDetailsSection(document, eventDetails) {
  const sectionTop = 155;

  document
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(BRAND_PURPLE)
    .text('EVENT DETAILS', MARGIN, sectionTop);

  document.moveDown(0.3);

  document
    .font('Helvetica')
    .fontSize(11)
    .fillColor(BRAND_DARK);

  document.text(`Event:  ${eventDetails.eventTitle}`, MARGIN);
  document.text(`Date:  ${eventDetails.eventDate}`, MARGIN);
  document.text(`Location:  ${eventDetails.eventLocation}`, MARGIN);

  document.moveDown(0.8);

  drawHorizontalRule(document, document.y);
}

function drawAttendeeDetailsSection(document, bookingRecord) {
  const sectionTop = document.y + 20;

  document
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(BRAND_PURPLE)
    .text('ATTENDEE', MARGIN, sectionTop);

  document.moveDown(0.3);

  document
    .font('Helvetica')
    .fontSize(11)
    .fillColor(BRAND_DARK);

  document.text(`Name:  ${bookingRecord.full_name}`, MARGIN);
  document.text(`Ticket ID:  EVT-${bookingRecord.ref}`, MARGIN);
  document.text(`Booking Reference:  ${bookingRecord.ref}`, MARGIN);

  document.moveDown(0.8);

  drawHorizontalRule(document, document.y);
}

function drawPaymentSummarySection(document, paymentSummary) {
  const sectionTop = document.y + 20;

  document
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(BRAND_PURPLE)
    .text('PAYMENT', MARGIN, sectionTop);

  document.moveDown(0.3);

  document
    .font('Helvetica')
    .fontSize(11)
    .fillColor(BRAND_DARK);

  document.text(`Amount Paid:  ${paymentSummary.amountPaidUsdt} USDT`, MARGIN);
  document.text(`Block Number:  ${paymentSummary.blockNumber}`, MARGIN);
  document.text(`Transaction Hash:  ${paymentSummary.txHash}`, MARGIN);

  document.moveDown(0.8);

  drawHorizontalRule(document, document.y);
}

function drawQrCodeSection(document, qrBuffer) {
  const qrSize = 160;
  const qrX = (PAGE_WIDTH - qrSize) / 2;
  const qrY = document.y + 25;

  document
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(BRAND_PURPLE)
    .text('SCAN FOR CHECK-IN', MARGIN, qrY - 15, {
      width: PAGE_WIDTH - MARGIN * 2,
      align: 'center',
    });

  document.image(qrBuffer, qrX, qrY + 5, {
    width: qrSize,
    height: qrSize,
  });

  document.y = qrY + qrSize + 25;

  document
    .font('Helvetica')
    .fontSize(10)
    .fillColor(BRAND_MUTED)
    .text(
      'Present this QR code at the venue for check-in.',
      MARGIN,
      document.y,
      {
        width: PAGE_WIDTH - MARGIN * 2,
        align: 'center',
      }
    );
}

function drawFooterSection(document, eventDetails) {
  const footerY = PAGE_HEIGHT - 100;

  drawHorizontalRule(document, footerY);

  document
    .font('Helvetica')
    .fontSize(9)
    .fillColor(BRAND_MUTED)
    .text(
      `${eventDetails.eventTitle} | ${eventDetails.eventDate} | ${eventDetails.eventLocation}`,
      MARGIN,
      footerY + 12,
      {
        width: PAGE_WIDTH - MARGIN * 2,
        align: 'center',
      }
    );

  document
    .font('Helvetica')
    .fontSize(8)
    .fillColor(BRAND_MUTED)
    .text(
      'This ticket is non-transferable. Please present a valid photo ID alongside this ticket.',
      MARGIN,
      footerY + 28,
      {
        width: PAGE_WIDTH - MARGIN * 2,
        align: 'center',
      }
    );
}

function drawHorizontalRule(document, yPosition) {
  document
    .moveTo(MARGIN, yPosition)
    .lineTo(PAGE_WIDTH - MARGIN, yPosition)
    .lineWidth(0.5)
    .strokeColor(BRAND_TEAL)
    .stroke();
}
