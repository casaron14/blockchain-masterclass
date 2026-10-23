import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPaymentReceiptEmailHtml,
  buildPaymentReceiptEmailSubject,
} from '../services/paymentReceiptEmailComposer.js';

const COMPLETING_TRANSACTION_HASH =
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function buildReceiptEmailInput() {
  return {
    bookingRecord: {
      id: 41,
      ref: 'RCPT01',
      full_name: 'Receipt Email Attendee',
      email: 'receipt-email@example.com',
    },
    receiptRecord: {
      id: 7,
      txHash: COMPLETING_TRANSACTION_HASH,
      blockNumber: 101,
      depositAddress: '0xDepositAddressForReceiptEmail',
      amountPaidUsdt: '3.80',
      amountWei: '3800000000000000000',
      explorerTxUrl: `https://bscscan.com/tx/${COMPLETING_TRANSACTION_HASH}`,
    },
  };
}

test('buildPaymentReceiptEmailSubject names the event and the booking reference', () => {
  const { bookingRecord } = buildReceiptEmailInput();

  const receiptEmailSubject = buildPaymentReceiptEmailSubject(bookingRecord);

  assert.equal(
    receiptEmailSubject,
    'Your payment receipt for Blockchain Masterclass (RCPT01)'
  );
});

test('buildPaymentReceiptEmailHtml renders the payment facts and on-chain proof', () => {
  const { bookingRecord, receiptRecord } = buildReceiptEmailInput();

  const receiptEmailHtml = buildPaymentReceiptEmailHtml(bookingRecord, receiptRecord);

  assert.ok(receiptEmailHtml.includes('Receipt Email Attendee'));
  assert.ok(receiptEmailHtml.includes('RCPT01'));
  assert.ok(receiptEmailHtml.includes('RCP-7'));
  assert.ok(receiptEmailHtml.includes('3.80 USDT'));
  assert.ok(receiptEmailHtml.includes('3800000000000000000'));
  assert.ok(receiptEmailHtml.includes(COMPLETING_TRANSACTION_HASH));
  assert.ok(receiptEmailHtml.includes(receiptRecord.depositAddress));
  assert.ok(receiptEmailHtml.includes(receiptRecord.explorerTxUrl));
  assert.ok(receiptEmailHtml.includes('Block Number'.toUpperCase()));
});

test('buildPaymentReceiptEmailHtml uses the DienAcademy brand and the receipt design language', () => {
  const { bookingRecord, receiptRecord } = buildReceiptEmailInput();

  const receiptEmailHtml = buildPaymentReceiptEmailHtml(bookingRecord, receiptRecord);

  assert.ok(receiptEmailHtml.includes('DienAcademy'));
  assert.ok(!receiptEmailHtml.includes('Dien Academy'));
  assert.ok(receiptEmailHtml.includes('PAYMENT RECEIPT'));
  assert.ok(receiptEmailHtml.includes('AMOUNT PAID'));
  assert.ok(receiptEmailHtml.includes('CONFIRMED'));
  assert.ok(receiptEmailHtml.includes('EVENT DETAILS'));
  assert.ok(receiptEmailHtml.includes('ON-CHAIN DETAILS'));
  assert.ok(receiptEmailHtml.includes('#A34A25'));
  assert.ok(receiptEmailHtml.includes('#F2EDE3'));
});

test('buildPaymentReceiptEmailHtml escapes attendee text instead of injecting markup', () => {
  const { bookingRecord, receiptRecord } = buildReceiptEmailInput();
  const attendeeNameWithMarkup = '<script>alert("x")</script>';

  const receiptEmailHtml = buildPaymentReceiptEmailHtml(
    { ...bookingRecord, full_name: attendeeNameWithMarkup },
    receiptRecord
  );

  assert.ok(!receiptEmailHtml.includes('<script>alert'));
  assert.ok(
    receiptEmailHtml.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
  );
});
