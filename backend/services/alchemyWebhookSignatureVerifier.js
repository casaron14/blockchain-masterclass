import crypto from 'node:crypto';

export const ALCHEMY_WEBHOOK_SIGNATURE_HEADER_NAME = 'x-alchemy-signature';

export function resolveAlchemyWebhookSigningKey() {
  const webhookSigningKey = process.env.ALCHEMY_WEBHOOK_SIGNING_KEY;
  if (!webhookSigningKey) {
    throw new Error('ALCHEMY_WEBHOOK_SIGNING_KEY is not configured');
  }
  return webhookSigningKey;
}

export function computeAlchemyWebhookSignatureDigest(
  rawRequestBody,
  webhookSigningKey = resolveAlchemyWebhookSigningKey()
) {
  return crypto
    .createHmac('sha256', webhookSigningKey)
    .update(rawRequestBody)
    .digest('hex');
}

// Alchemy signs the exact bytes it sent with the webhook's signing key. The
// check runs on the raw buffer the body parser preserved, never on
// request.body: re-serialising JSON changes byte order and whitespace, so a
// signature over the parsed object can never match.
//
// It fails closed: a missing signature, a missing raw body, or a missing key is
// a rejection, not a pass.
export function verifyAlchemyWebhookSignature(
  rawRequestBody,
  presentedSignature,
  webhookSigningKey = resolveAlchemyWebhookSigningKey()
) {
  if (!Buffer.isBuffer(rawRequestBody) || rawRequestBody.length === 0) {
    return false;
  }
  if (typeof presentedSignature !== 'string' || presentedSignature.length === 0) {
    return false;
  }

  const expectedDigest = Buffer.from(
    computeAlchemyWebhookSignatureDigest(rawRequestBody, webhookSigningKey),
    'utf8'
  );
  const presentedDigest = Buffer.from(presentedSignature.trim().toLowerCase(), 'utf8');

  if (expectedDigest.length !== presentedDigest.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedDigest, presentedDigest);
}
