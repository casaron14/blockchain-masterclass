import { fetchPendingOrderRecords, fetchPaidOrderRecords } from './orderService.js';

/**
 * Operational counts for the admin summary endpoint. Sweeps and treasury
 * reconciliation were removed with the collection flow, so the report only
 * answers how many deposit orders are pending and how many are paid.
 */
export async function generateAdminSummaryReport({
  fetchPendingOrders = fetchPendingOrderRecords,
  fetchPaidOrders = fetchPaidOrderRecords,
} = {}) {
  const pendingOrders = await fetchPendingOrders();
  const paidOrders = await fetchPaidOrders();

  return {
    pendingOrderCount: pendingOrders.length,
    paidOrderCount: paidOrders.length,
  };
}
