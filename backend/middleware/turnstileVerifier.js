const TURNSTILE_SITE_VERIFY_ENDPOINT_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_CHALLENGE_TOKEN_FIELD_NAME = 'cf_turnstile_response';

function readTurnstileSecretKeyFromEnvironment() {
  return process.env.TURNSTILE_SECRET_KEY;
}

function isRunningInProductionEnvironment() {
  return process.env.NODE_ENV === 'production';
}

export async function verifyTurnstileTokenWithCloudflare({
  secretKey,
  challengeToken,
  remoteIp,
  fetchImplementation = fetch,
}) {
  const siteVerifyRequestPayload = new URLSearchParams({
    secret: secretKey,
    response: challengeToken,
  });

  if (remoteIp) {
    siteVerifyRequestPayload.set('remoteip', remoteIp);
  }

  const siteVerifyResponse = await fetchImplementation(
    TURNSTILE_SITE_VERIFY_ENDPOINT_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: siteVerifyRequestPayload,
    }
  );

  if (!siteVerifyResponse.ok) {
    return { success: false, errorCodes: ['siteverify-http-error'] };
  }

  const siteVerifyResult = await siteVerifyResponse.json();

  return {
    success: siteVerifyResult.success === true,
    errorCodes: siteVerifyResult['error-codes'] || [],
  };
}

export async function verifyTurnstileChallengeToken(req, res, next) {
  const turnstileSecretKey = readTurnstileSecretKeyFromEnvironment();

  if (!turnstileSecretKey) {
    if (isRunningInProductionEnvironment()) {
      return res.status(503).json({
        message: 'Bot detection is not configured on the server',
        error: 'TURNSTILE_NOT_CONFIGURED',
      });
    }
    console.warn(
      'TURNSTILE_SECRET_KEY is not set; skipping bot detection for this request'
    );
    return next();
  }

  const challengeToken = req.body?.[TURNSTILE_CHALLENGE_TOKEN_FIELD_NAME];

  // Strip the challenge token from the request body before it reaches
  // downstream validation, which rejects unknown keys (Joi's default
  // allowUnknown=false) with '"cf_turnstile_response" is not allowed'.
  delete req.body?.[TURNSTILE_CHALLENGE_TOKEN_FIELD_NAME];

  if (!challengeToken || typeof challengeToken !== 'string') {
    return res.status(400).json({
      message: 'Missing Turnstile challenge token',
      error: 'TURNSTILE_TOKEN_REQUIRED',
    });
  }

  try {
    const verificationOutcome = await verifyTurnstileTokenWithCloudflare({
      secretKey: turnstileSecretKey,
      challengeToken,
      remoteIp: req.ip,
    });

    if (!verificationOutcome.success) {
      return res.status(403).json({
        message: 'Bot verification failed. Please complete the security check and try again.',
        error: 'TURNSTILE_VERIFICATION_FAILED',
      });
    }

    return next();
  } catch (error) {
    console.error('Error verifying Turnstile challenge token', error);
    return res.status(500).json({
      message: 'Unable to verify the security check at this time',
      error: 'TURNSTILE_VERIFICATION_UNAVAILABLE',
    });
  }
}

export default verifyTurnstileChallengeToken;