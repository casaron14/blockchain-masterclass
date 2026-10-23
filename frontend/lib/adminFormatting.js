const ADMIN_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const ADMIN_AMOUNT_FORMATTER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
});

export function formatAdminTimestamp(rawTimestamp) {
  if (!rawTimestamp) {
    return '—';
  }

  const parsedTimestamp = new Date(rawTimestamp);

  if (Number.isNaN(parsedTimestamp.getTime())) {
    return '—';
  }

  return ADMIN_TIMESTAMP_FORMATTER.format(parsedTimestamp).replace(',', ' ·');
}

export function formatAdminAmount(rawAmount) {
  const parsedAmount = Number(rawAmount);

  if (!Number.isFinite(parsedAmount)) {
    return '—';
  }

  return ADMIN_AMOUNT_FORMATTER.format(parsedAmount);
}

export function formatAdminAmountWithCurrency(rawAmount, currencyCode) {
  const formattedAmount = formatAdminAmount(rawAmount);

  if (formattedAmount === '—' || !currencyCode) {
    return formattedAmount;
  }

  return `${currencyCode} ${formattedAmount}`;
}

export function formatAdminStatusLabel(rawStatus) {
  if (!rawStatus) {
    return '—';
  }

  return String(rawStatus)
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (firstLetter) => firstLetter.toUpperCase());
}
