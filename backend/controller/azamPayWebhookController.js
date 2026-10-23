import { processAzamPayWebhook } from '../services/paymentService.js';

async function receiveAzamPayWebhook(req, res) {
  const webhookPayload = req.body;

  try {
    const processedResult = await processAzamPayWebhook(webhookPayload);
    console.log(
      `AzamPay webhook processed: ${processedResult.transactionStatus} for booking ${processedResult.bookingId}`
    );
  } catch (error) {
    console.error('AzamPay webhook ignored or failed', error.message);
  }

  res.status(200).json({ received: true });
}

export default {
  receiveAzamPayWebhook,
};
