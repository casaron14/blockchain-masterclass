const CSV_FIELD_SEPARATOR = ',';
const CSV_LINE_SEPARATOR = '\r\n';
const UTF8_BYTE_ORDER_MARK = '\uFEFF';

// A value that starts with these characters is executed as a formula by
// spreadsheet applications. Attendee names and phone numbers are
// attacker-controlled, so the export prefixes such a value with an apostrophe
// instead of letting a booking create a formula in the operator's spreadsheet.
const SPREADSHEET_FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

function formatCsvFieldValue(rawFieldValue) {
  if (rawFieldValue === null || rawFieldValue === undefined) {
    return '';
  }

  if (rawFieldValue instanceof Date) {
    return rawFieldValue.toISOString();
  }

  if (typeof rawFieldValue === 'object') {
    return JSON.stringify(rawFieldValue);
  }

  return String(rawFieldValue);
}

export function escapeCsvFieldValue(rawFieldValue) {
  let fieldText = formatCsvFieldValue(rawFieldValue);

  if (
    fieldText.length > 0 &&
    SPREADSHEET_FORMULA_PREFIXES.some((prefixCharacter) =>
      fieldText.startsWith(prefixCharacter)
    )
  ) {
    fieldText = `'${fieldText}`;
  }

  const fieldNeedsQuotes =
    fieldText.includes('"') ||
    fieldText.includes(CSV_FIELD_SEPARATOR) ||
    fieldText.includes('\n') ||
    fieldText.includes('\r') ||
    fieldText.startsWith(' ') ||
    fieldText.endsWith(' ');

  if (!fieldNeedsQuotes) {
    return fieldText;
  }

  return `"${fieldText.replace(/"/g, '""')}"`;
}

function buildCsvRowFromValues(rowValues) {
  return rowValues.map(escapeCsvFieldValue).join(CSV_FIELD_SEPARATOR);
}

export function buildCsvDocumentFromRecords(columnDefinitions, recordRows) {
  const headerRow = buildCsvRowFromValues(
    columnDefinitions.map((columnDefinition) => columnDefinition.headerLabel)
  );

  const dataRows = recordRows.map((recordRow) =>
    buildCsvRowFromValues(
      columnDefinitions.map((columnDefinition) =>
        columnDefinition.readValue(recordRow)
      )
    )
  );

  return UTF8_BYTE_ORDER_MARK + [headerRow, ...dataRows].join(CSV_LINE_SEPARATOR) + CSV_LINE_SEPARATOR;
}

export function buildCsvExportFileName(exportName, exportDate = new Date()) {
  const exportDateStamp = exportDate.toISOString().slice(0, 10);
  const safeExportName = String(exportName || 'export')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${safeExportName || 'export'}-${exportDateStamp}.csv`;
}

const BOOKING_EXPORT_COLUMNS = Object.freeze([
  { headerLabel: 'Booking reference', readValue: (booking) => booking.ref },
  { headerLabel: 'Attendee name', readValue: (booking) => booking.full_name },
  { headerLabel: 'Email address', readValue: (booking) => booking.email },
  { headerLabel: 'Phone number', readValue: (booking) => booking.phone_number },
  { headerLabel: 'Booking status', readValue: (booking) => booking.status },
  { headerLabel: 'Payment method', readValue: (booking) => booking.payment_method },
  { headerLabel: 'Payment status', readValue: (booking) => booking.payment_status },
  { headerLabel: 'Referral source', readValue: (booking) => booking.utm_source },
  { headerLabel: 'Referred by', readValue: (booking) => booking.referrer_name },
  { headerLabel: 'Booking created at', readValue: (booking) => booking.created_at },
  { headerLabel: 'Hold expires at', readValue: (booking) => booking.expires_at },
  {
    headerLabel: 'Payment confirmed at',
    readValue: (booking) => booking.payment_confirmed_at,
  },
  {
    headerLabel: 'Ticket last sent at',
    readValue: (booking) => booking.ticket_last_sent_at || booking.ticket_sent_at,
  },
]);

export function buildBookingsCsvDocument(bookingRecords) {
  return buildCsvDocumentFromRecords(BOOKING_EXPORT_COLUMNS, bookingRecords);
}

const REFERRED_CLIENT_EXPORT_COLUMNS = Object.freeze([
  { headerLabel: 'Booking reference', readValue: (booking) => booking.ref },
  { headerLabel: 'Client name', readValue: (booking) => booking.full_name },
  { headerLabel: 'Email address', readValue: (booking) => booking.email },
  { headerLabel: 'Phone number', readValue: (booking) => booking.phone_number },
  { headerLabel: 'Booking status', readValue: (booking) => booking.status },
  { headerLabel: 'Payment status', readValue: (booking) => booking.payment_status },
  { headerLabel: 'Referral source', readValue: (booking) => booking.utm_source },
  { headerLabel: 'Referred by', readValue: (booking) => booking.referrer_name },
  { headerLabel: 'Referred at', readValue: (booking) => booking.created_at },
]);

export function buildReferredClientsCsvDocument(clientRecords) {
  return buildCsvDocumentFromRecords(
    REFERRED_CLIENT_EXPORT_COLUMNS,
    clientRecords
  );
}

const REFERRAL_SUMMARY_EXPORT_COLUMNS = Object.freeze([
  { headerLabel: 'Referrer name', readValue: (referral) => referral.referrer_label },
  { headerLabel: 'Referral username', readValue: (referral) => referral.referrer_code },
  { headerLabel: 'Referrer phone', readValue: (referral) => referral.referrer_phone },
  { headerLabel: 'Total referred clients', readValue: (referral) => referral.booking_count },
  { headerLabel: 'Confirmed clients', readValue: (referral) => referral.confirmed_count },
  { headerLabel: 'Pending clients', readValue: (referral) => referral.pending_count },
  { headerLabel: 'First referral', readValue: (referral) => referral.first_referral_at },
  { headerLabel: 'Latest referral', readValue: (referral) => referral.latest_referral_at },
]);

export function buildReferralSummaryCsvDocument(referralSummaryRows) {
  return buildCsvDocumentFromRecords(
    REFERRAL_SUMMARY_EXPORT_COLUMNS,
    referralSummaryRows
  );
}
