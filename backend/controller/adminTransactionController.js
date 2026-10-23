import {
  fetchTransactionTrackingRecords,
  InvalidTransactionMethodFilterError,
  InvalidTransactionPaymentStatusFilterError,
} from '../services/transactionTrackingService.js';

async function fetchTransactionTrackingEndpoint(req, res) {
  const { method: methodFilter, payment_status: paymentStatusFilter } = req.query;

  try {
    const transactions = await fetchTransactionTrackingRecords({
      methodFilter: methodFilter || null,
      paymentStatusFilter: paymentStatusFilter || null,
    });
    return res.status(200).json({ transactions });
  } catch (error) {
    if (
      error instanceof InvalidTransactionMethodFilterError ||
      error instanceof InvalidTransactionPaymentStatusFilterError
    ) {
      return res.status(400).json({ message: error.message });
    }
    console.error('Error fetching transaction tracking records', error);
    return res.status(500).json({ message: 'Error fetching transaction tracking records' });
  }
}

export default {
  fetchTransactionTrackingEndpoint,
};