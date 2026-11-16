import { logError } from '../utils/applicationLogger.js';

import {
  matchTransfersToWatchedDepositAddresses,
  recordObservedUsdtTransfer,
} from '../services/monitorService.js';
import {
  buildObservedUsdtTransfersFromAlchemyActivityWebhookPayload,
  ALCHEMY_WEBHOOK_STATUS_ACCEPTED,
} from '../services/alchemyDepositActivityParser.js';
import { resolveMissingAlchemyTransferLogIndexes } from '../services/alchemyDepositLogIndexResolver.js';
import {
  ALCHEMY_WEBHOOK_SIGNATURE_HEADER_NAME,
  verifyAlchemyWebhookSignature,
} from '../services/alchemyWebhookSignatureVerifier.js';

/**
 * Fast path for deposit detection.
 *
 * It records transfers and stops there: settlement, reorg checks and
 * confirmation counting stay in the polling listener, so both paths write the
 * same deposits_observed rows and the slow path remains the source of truth for
 * whether a payment is confirmed.
 */
export async function handleAlchemyDepositWebhook(req, res) {
  let isSignatureValid = false;
  try {
    isSignatureValid = verifyAlchemyWebhookSignature(
      req.rawBody,
      req.get(ALCHEMY_WEBHOOK_SIGNATURE_HEADER_NAME)
    );
  } catch (signatureError) {
    logError('alchemy_webhook_signature_unavailable', {
      errorMessage: signatureError.message,
    });
    return res.status(503).json({
      message: 'Alchemy webhook verification is not configured',
      error: 'WEBHOOK_VERIFICATION_NOT_CONFIGURED',
    });
  }

  if (!isSignatureValid) {
    return res.status(401).json({
      message: 'Invalid Alchemy webhook signature',
      error: 'WEBHOOK_SIGNATURE_INVALID',
    });
  }

  let webhookPayload;
  try {
    webhookPayload = JSON.parse(req.rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({
      message: 'Alchemy webhook body is not valid JSON',
      error: 'WEBHOOK_BODY_INVALID',
    });
  }

  const parsedWebhookActivity = buildObservedUsdtTransfersFromAlchemyActivityWebhookPayload(
    webhookPayload
  );

  if (parsedWebhookActivity.status !== ALCHEMY_WEBHOOK_STATUS_ACCEPTED) {
    return res.status(200).json({
      ok: true,
      ignoredReason: parsedWebhookActivity.reason,
    });
  }

  try {
    const resolvedTransfers = await resolveMissingAlchemyTransferLogIndexes(
      parsedWebhookActivity.parsedTransfers
    );
    if (resolvedTransfers.length === 0) {
      // The receipt did not identify which Transfer log paid the address. The
      // polling listener records it on its next pass, so acknowledging is safe.
      return res.status(200).json({
        ok: true,
        matchedTransferCount: 0,
        recordedTransferCount: 0,
      });
    }

    const matchedTransfers = await matchTransfersToWatchedDepositAddresses(
      resolvedTransfers
    );

    let recordedTransferCount = 0;
    for (const matchedTransfer of matchedTransfers) {
      const recordedTransfer = await recordObservedUsdtTransfer(matchedTransfer);
      if (recordedTransfer) {
        recordedTransferCount += 1;
      }
    }

    return res.status(200).json({
      ok: true,
      matchedTransferCount: matchedTransfers.length,
      recordedTransferCount,
    });
  } catch (recordingError) {
    // A non-2xx makes Alchemy retry the delivery, and recording is idempotent,
    // so a transient database failure must not be acknowledged as received.
    logError('alchemy_webhook_deposit_recording_failed', {
      errorMessage: recordingError.message,
    });
    return res.status(500).json({
      message: 'Alchemy webhook deposit recording failed',
      error: 'WEBHOOK_RECORDING_FAILED',
    });
  }
}
