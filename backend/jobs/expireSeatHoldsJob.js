import { expireAllExpiredSeatHolds } from '../services/bookingService.js';

export async function runExpireSeatHoldsJob() {
  const expiredCount = await expireAllExpiredSeatHolds();

  if (expiredCount > 0) {
    console.log(`Seat holds job: expired ${expiredCount} stale booking(s)`);
  }

  return { expiredCount };
}