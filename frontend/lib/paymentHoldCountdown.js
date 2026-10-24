const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;

function padTwoDigitTimePart(timePart) {
  return String(timePart).padStart(2, '0');
}

/**
 * Formats the time left on a seat hold for the payment page.
 *
 * Lipa Namba receipts extend the hold to `offlineReviewHoldMinutes` (24 hours),
 * so a minutes-only format turns 23h 58m 35s into the confusing "1438:35".
 * Holds of an hour or more therefore include the hour, while shorter holds keep
 * the compact MM:SS form used for the normal 60-minute booking hold.
 */
export function formatPaymentHoldCountdown(remainingMilliseconds) {
  const safeRemainingMilliseconds = Number.isFinite(remainingMilliseconds)
    ? remainingMilliseconds
    : 0;
  const totalRemainingSeconds = Math.max(
    0,
    Math.floor(safeRemainingMilliseconds / MILLISECONDS_PER_SECOND)
  );

  const remainingHours = Math.floor(totalRemainingSeconds / SECONDS_PER_HOUR);
  const remainingMinutes = Math.floor(
    (totalRemainingSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE
  );
  const remainingSeconds = totalRemainingSeconds % SECONDS_PER_MINUTE;

  const paddedMinutesAndSeconds = `${padTwoDigitTimePart(remainingMinutes)}:${padTwoDigitTimePart(remainingSeconds)}`;

  if (remainingHours > 0) {
    return `${remainingHours}:${paddedMinutesAndSeconds}`;
  }
  return paddedMinutesAndSeconds;
}
