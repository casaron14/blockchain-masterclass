// Copy for the emailed payment receipt. It is set in the same institutional
// language as the receipt PDF: bone paper, an ink masthead, one burnished
// copper accent, hairline rules and the perforated-ticket seam. Email clients
// only support table layout and inline styles, so the design is expressed with
// those primitives rather than the site's stylesheet.

import {
  EVENT_TITLE,
  EVENT_DATE_LABEL,
  EVENT_LOCATION,
  PLATFORM_BRAND_NAME,
  PLATFORM_WEBSITE_ADDRESS,
} from './eventConfigService.js';

const EMAIL_INK_COLOR = '#14120E';
const EMAIL_PAPER_COLOR = '#F2EDE3';
const EMAIL_PAPER_SUNK_COLOR = '#E9E2D5';
const EMAIL_COPPER_COLOR = '#A34A25';
const EMAIL_COPPER_LIGHT_COLOR = '#C9703F';
const EMAIL_SECONDARY_TEXT_COLOR = '#615A4D';
const EMAIL_ON_INK_MUTED_COLOR = '#A6A198';
const EMAIL_HAIRLINE_COLOR = '#CAC6BD';
const EMAIL_HAIRLINE_STRONG_COLOR = '#A29E96';

const EMAIL_MONO_FONT_STACK = "'Courier New',Courier,monospace";
const EMAIL_BODY_FONT_STACK = 'Helvetica,Arial,sans-serif';
const EMAIL_DISPLAY_FONT_STACK = "Georgia,'Times New Roman',serif";

export function buildPaymentReceiptEmailSubject(bookingRecord) {
  return `Your payment receipt for ${EVENT_TITLE} (${bookingRecord.ref})`;
}

export function buildPaymentReceiptEmailHtml(bookingRecord, receiptRecord) {
  const attendeeName = escapeHtmlTextForEmail(bookingRecord.full_name);
  const eventTitle = escapeHtmlTextForEmail(EVENT_TITLE);
  const eventDate = escapeHtmlTextForEmail(EVENT_DATE_LABEL);
  const eventLocation = escapeHtmlTextForEmail(EVENT_LOCATION);
  const bookingReference = escapeHtmlTextForEmail(bookingRecord.ref);
  const receiptNumber = `RCP-${receiptRecord.id}`;
  const amountPaidUsdt = escapeHtmlTextForEmail(receiptRecord.amountPaidUsdt);
  const amountPaidWei = escapeHtmlTextForEmail(receiptRecord.amountWei);
  const transactionHash = escapeHtmlTextForEmail(receiptRecord.txHash);
  const blockNumber = escapeHtmlTextForEmail(String(receiptRecord.blockNumber));
  const depositAddress = escapeHtmlTextForEmail(receiptRecord.depositAddress);
  const explorerTransactionUrl = escapeHtmlTextForEmail(receiptRecord.explorerTxUrl ?? '');
  const brandName = escapeHtmlTextForEmail(PLATFORM_BRAND_NAME);
  const websiteAddress = escapeHtmlTextForEmail(PLATFORM_WEBSITE_ADDRESS);

  const eventFactRows = [
    ['EVENT', eventTitle],
    ['DATE', eventDate],
    ['VENUE', eventLocation],
  ];
  const attendeeFactRows = [
    ['ATTENDEE', attendeeName],
    ['BOOKING REFERENCE', bookingReference],
  ];
  const paymentFactRows = [
    ['RECEIPT NUMBER', receiptNumber],
    ['AMOUNT PAID', `${amountPaidUsdt} USDT`],
    ['AMOUNT PAID (WEI)', amountPaidWei],
  ];
  const onChainFactRows = [
    ['TRANSACTION HASH', transactionHash, true],
    ['BLOCK NUMBER', blockNumber],
    ['DEPOSIT ADDRESS', depositAddress, true],
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Payment receipt for ${eventTitle}</title>
</head>
<body style="margin:0;padding:0;background-color:${EMAIL_PAPER_SUNK_COLOR};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${EMAIL_PAPER_SUNK_COLOR};">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:${EMAIL_PAPER_COLOR};border:1px solid ${EMAIL_HAIRLINE_COLOR};">

          <tr>
            <td style="background-color:${EMAIL_INK_COLOR};padding:26px 32px 24px 32px;border-bottom:2px solid ${EMAIL_COPPER_COLOR};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:${EMAIL_MONO_FONT_STACK};font-size:12px;letter-spacing:3px;color:${EMAIL_COPPER_LIGHT_COLOR};">${brandName.toUpperCase()}</td>
                  <td align="right" style="font-family:${EMAIL_MONO_FONT_STACK};font-size:11px;letter-spacing:2px;color:${EMAIL_COPPER_LIGHT_COLOR};">PAYMENT RECEIPT</td>
                </tr>
              </table>
              <div style="font-family:${EMAIL_DISPLAY_FONT_STACK};font-size:30px;line-height:1.15;color:${EMAIL_PAPER_COLOR};margin-top:18px;">${eventTitle}</div>
              <div style="font-family:${EMAIL_BODY_FONT_STACK};font-size:13px;line-height:1.5;color:${EMAIL_ON_INK_MUTED_COLOR};margin-top:8px;">${eventDate} &middot; ${eventLocation}</div>
            </td>
          </tr>

          <tr>
            <td style="padding:30px 32px 0 32px;">
              <div style="font-family:${EMAIL_MONO_FONT_STACK};font-size:10px;letter-spacing:2px;color:${EMAIL_SECONDARY_TEXT_COLOR};">AMOUNT PAID</div>
              <div style="font-family:${EMAIL_DISPLAY_FONT_STACK};font-size:40px;line-height:1.1;color:${EMAIL_INK_COLOR};margin-top:6px;">${amountPaidUsdt} USDT</div>
              <div style="font-family:${EMAIL_MONO_FONT_STACK};font-size:10px;color:${EMAIL_SECONDARY_TEXT_COLOR};margin-top:8px;">${amountPaidWei} WEI</div>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;">
                <tr>
                  <td style="border:1px solid ${EMAIL_HAIRLINE_STRONG_COLOR};padding:7px 16px;font-family:${EMAIL_MONO_FONT_STACK};font-size:10px;letter-spacing:2px;color:${EMAIL_INK_COLOR};">CONFIRMED</td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 32px 0 32px;">
              <p style="margin:0;font-family:${EMAIL_BODY_FONT_STACK};font-size:14px;line-height:1.6;color:${EMAIL_INK_COLOR};">Hi ${attendeeName},</p>
              <p style="margin:10px 0 0 0;font-family:${EMAIL_BODY_FONT_STACK};font-size:14px;line-height:1.6;color:${EMAIL_SECONDARY_TEXT_COLOR};">Your payment has been confirmed on the blockchain. Your receipt is attached to this email as a PDF.</p>
            </td>
          </tr>

          ${buildReceiptEmailFactSectionHtml('EVENT DETAILS', eventFactRows)}
          ${buildReceiptEmailFactSectionHtml('ATTENDEE', attendeeFactRows)}
          ${buildReceiptEmailFactSectionHtml('PAYMENT', paymentFactRows)}
          ${buildReceiptEmailFactSectionHtml('ON-CHAIN DETAILS', onChainFactRows)}

          <tr>
            <td style="padding:8px 32px 0 32px;">
              <div style="font-family:${EMAIL_MONO_FONT_STACK};font-size:10px;letter-spacing:1px;color:${EMAIL_SECONDARY_TEXT_COLOR};">EXPLORER</div>
              <div style="margin-top:6px;font-family:${EMAIL_MONO_FONT_STACK};font-size:11px;line-height:1.6;word-break:break-all;">
                <a href="${explorerTransactionUrl}" style="color:${EMAIL_COPPER_COLOR};text-decoration:underline;">${explorerTransactionUrl}</a>
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 32px 26px 32px;">
              <div style="border-top:1px dashed ${EMAIL_COPPER_COLOR};padding-top:16px;">
                <div style="font-family:${EMAIL_MONO_FONT_STACK};font-size:12px;letter-spacing:2px;color:${EMAIL_INK_COLOR};">${brandName}</div>
                <div style="font-family:${EMAIL_MONO_FONT_STACK};font-size:11px;color:${EMAIL_SECONDARY_TEXT_COLOR};margin-top:4px;">${websiteAddress}</div>
                <div style="font-family:${EMAIL_BODY_FONT_STACK};font-size:11px;line-height:1.6;color:${EMAIL_SECONDARY_TEXT_COLOR};margin-top:10px;">This receipt confirms an on-chain payment. Keep it for your records.</div>
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildReceiptEmailFactSectionHtml(sectionHeading, factRows) {
  const factRowsHtml = factRows
    .map(([factLabel, factValue, factValueUsesMonoFont]) => {
      const factValueStyle = factValueUsesMonoFont
        ? `font-family:${EMAIL_MONO_FONT_STACK};font-size:11px;line-height:1.6;word-break:break-all;color:${EMAIL_INK_COLOR};`
        : `font-family:${EMAIL_BODY_FONT_STACK};font-size:13px;line-height:1.5;color:${EMAIL_INK_COLOR};`;

      return `<tr>
                  <td style="padding:10px 0;border-bottom:1px solid ${EMAIL_HAIRLINE_COLOR};vertical-align:top;width:42%;font-family:${EMAIL_MONO_FONT_STACK};font-size:10px;letter-spacing:1px;color:${EMAIL_SECONDARY_TEXT_COLOR};">${factLabel}</td>
                  <td style="padding:10px 0;border-bottom:1px solid ${EMAIL_HAIRLINE_COLOR};vertical-align:top;${factValueStyle}">${factValue}</td>
                </tr>`;
    })
    .join('');

  return `<tr>
            <td style="padding:28px 32px 0 32px;">
              <div style="font-family:${EMAIL_MONO_FONT_STACK};font-size:10px;letter-spacing:2px;color:${EMAIL_COPPER_COLOR};padding-bottom:6px;border-bottom:1px solid ${EMAIL_COPPER_COLOR};">${sectionHeading}</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${factRowsHtml}
              </table>
            </td>
          </tr>`;
}

function escapeHtmlTextForEmail(htmlTextValue) {
  return String(htmlTextValue)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
