import { revokeExpiredOrderHolds } from '../services/orderService.js';

export async function runOrderExpiryJob() {
  const expiredOrderCount = await revokeExpiredOrderHolds();
  if (expiredOrderCount > 0) {
    console.log(`Order expiry job: expired ${expiredOrderCount} order(s)`);
  }
  return expiredOrderCount;
}