import {
  fetchPaymentReviewFlags,
  resolvePaymentReviewFlag,
  PaymentReviewFlagNotFoundError,
} from '../services/paymentReviewFlagService.js';

const MINIMUM_RESOLUTION_NOTE_LENGTH = 3;
const MAXIMUM_RESOLUTION_NOTE_LENGTH = 1000;

async function fetchPaymentReviewFlagsEndpoint(req, res) {
  const includeResolved =
    String(req.query.include_resolved || '').toLowerCase() === 'true';
  const requestedLimit = req.query.limit;

  try {
    const paymentReviewFlags = await fetchPaymentReviewFlags({
      includeResolved,
      limit: requestedLimit,
    });
    return res.status(200).json({ paymentReviewFlags });
  } catch (error) {
    console.error('Error fetching payment review flags', error);
    return res.status(500).json({ message: 'Error fetching payment review flags' });
  }
}

async function resolvePaymentReviewFlagEndpoint(req, res) {
  const paymentReviewFlagId = Number(req.params.id);
  const resolutionNote = String(req.body?.resolution_note || '').trim();

  if (
    resolutionNote.length < MINIMUM_RESOLUTION_NOTE_LENGTH ||
    resolutionNote.length > MAXIMUM_RESOLUTION_NOTE_LENGTH
  ) {
    return res.status(400).json({
      message: `resolution_note must be between ${MINIMUM_RESOLUTION_NOTE_LENGTH} and ${MAXIMUM_RESOLUTION_NOTE_LENGTH} characters`,
      error: 'PAYMENT_REVIEW_RESOLUTION_NOTE_INVALID',
    });
  }

  try {
    const resolvedPaymentReviewFlag = await resolvePaymentReviewFlag({
      paymentReviewFlagId,
      resolutionNote,
    });
    return res.status(200).json({ paymentReviewFlag: resolvedPaymentReviewFlag });
  } catch (error) {
    if (error instanceof PaymentReviewFlagNotFoundError) {
      return res.status(404).json({
        message: error.message,
        error: 'PAYMENT_REVIEW_FLAG_NOT_FOUND',
      });
    }

    console.error('Error resolving payment review flag', error);
    return res.status(500).json({ message: 'Error resolving payment review flag' });
  }
}

export default {
  fetchPaymentReviewFlagsEndpoint,
  resolvePaymentReviewFlagEndpoint,
};
