import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBookingsCsvDocument,
  buildCsvDocumentFromRecords,
  buildCsvExportFileName,
  buildReferralSummaryCsvDocument,
  buildReferredClientsCsvDocument,
  escapeCsvFieldValue,
} from '../services/adminCsvExportService.js';

test('escapeCsvFieldValue quotes commas, quotes and line breaks', () => {
  assert.equal(escapeCsvFieldValue('plain value'), 'plain value');
  assert.equal(escapeCsvFieldValue('Doe, Jane'), '"Doe, Jane"');
  assert.equal(escapeCsvFieldValue('He said "hello"'), '"He said ""hello"""');
  assert.equal(escapeCsvFieldValue('first line\nsecond line'), '"first line\nsecond line"');
  assert.equal(escapeCsvFieldValue(null), '');
  assert.equal(escapeCsvFieldValue(undefined), '');
});

test('escapeCsvFieldValue neutralises spreadsheet formula prefixes', () => {
  assert.equal(escapeCsvFieldValue('=HYPERLINK("https://example.com")'), `"'=HYPERLINK(""https://example.com"")"`);
  assert.equal(escapeCsvFieldValue('+255712345678'), "'+255712345678");
  assert.equal(escapeCsvFieldValue('-42'), "'-42");
  assert.equal(escapeCsvFieldValue('@SUM(A1:A2)'), "'@SUM(A1:A2)");
});

test('buildCsvDocumentFromRecords writes a UTF-8 BOM, a header and CRLF rows', () => {
  const csvDocument = buildCsvDocumentFromRecords(
    [
      { headerLabel: 'Client name', readValue: (record) => record.clientName },
      { headerLabel: 'Phone', readValue: (record) => record.clientPhone },
    ],
    [
      { clientName: 'Neema Mushi', clientPhone: '+255712345678' },
      { clientName: 'Doe, Jane', clientPhone: '0712345678' },
    ]
  );

  assert.equal(
    csvDocument,
    '\uFEFFClient name,Phone\r\nNeema Mushi,\'+255712345678\r\n"Doe, Jane",0712345678\r\n'
  );
});

test('buildBookingsCsvDocument resolves the referrer name and payment state', () => {
  const csvDocument = buildBookingsCsvDocument([
    {
      ref: 'BMC-1001',
      full_name: 'Neema Mushi',
      email: 'neema@example.com',
      phone_number: '+255712345678',
      status: 'confirmed',
      payment_method: 'lipanamba',
      payment_status: 'confirmed',
      utm_source: 'ref_neema_x7k2',
      referrer_name: 'Neema Mushi',
      created_at: new Date('2026-10-24T09:15:00.000Z'),
      expires_at: new Date('2026-10-24T10:15:00.000Z'),
      payment_confirmed_at: new Date('2026-10-24T09:20:00.000Z'),
    },
  ]);

  const [headerRow, bookingRow] = csvDocument.replace(/^\uFEFF/, '').trim().split('\r\n');

  assert.match(headerRow, /Booking reference,Attendee name/);
  assert.match(headerRow, /Referral source,Referred by/);
  assert.match(bookingRow, /BMC-1001,Neema Mushi/);
  assert.match(bookingRow, /ref_neema_x7k2,Neema Mushi/);
  assert.match(bookingRow, /2026-10-24T09:15:00.000Z/);
});

test('buildReferredClientsCsvDocument contains only the clients of one referral code', () => {
  const csvDocument = buildReferredClientsCsvDocument([
    {
      ref: 'BMC-2001',
      full_name: 'Baraka Juma',
      email: 'baraka@example.com',
      phone_number: '+255723456789',
      status: 'pending',
      payment_status: null,
      utm_source: 'ref_juma_a1b2',
      referrer_name: 'Juma Ally',
      created_at: new Date('2026-10-24T11:00:00.000Z'),
    },
  ]);

  assert.match(csvDocument, /Client name,Email address,Phone number/);
  assert.match(csvDocument, /BMC-2001,Baraka Juma,baraka@example\.com/);
  assert.match(csvDocument, /ref_juma_a1b2,Juma Ally/);
});

test('buildReferralSummaryCsvDocument includes the per-referrer totals', () => {
  const csvDocument = buildReferralSummaryCsvDocument([
    {
      referrer_label: 'Neema Mushi',
      referrer_code: 'ref_neema_x7k2',
      referrer_phone: '+255712345678',
      booking_count: 4,
      confirmed_count: 3,
      pending_count: 1,
      first_referral_at: new Date('2026-10-20T08:00:00.000Z'),
      latest_referral_at: new Date('2026-10-24T08:00:00.000Z'),
    },
  ]);

  assert.match(csvDocument, /Referrer name,Referral username,Referrer phone/);
  assert.match(csvDocument, /Neema Mushi,ref_neema_x7k2,\'\+255712345678,4,3,1/);
});

test('buildCsvExportFileName produces a safe dated file name', () => {
  assert.equal(
    buildCsvExportFileName('Referred Clients: ref_neema_x7k2', new Date('2026-10-24T12:00:00Z')),
    'referred-clients-ref_neema_x7k2-2026-10-24.csv'
  );
  assert.equal(
    buildCsvExportFileName('', new Date('2026-10-24T12:00:00Z')),
    'export-2026-10-24.csv'
  );
});
