import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateTotpSecret,
  generateCurrentTotpCode,
  verifyTotpCodeAgainstSecret,
  decodeBase32Secret,
  encodeBase32Secret,
} from '../utils/totp.js';

// RFC 6238 Appendix B test vectors (SHA1, using the ASCII secret
// "12345678901234567890" base32-encoded as GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ).
const RFC_SHA1_BASE32_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

function unixTimeMillisForTimestampSeconds(timestampSeconds) {
  return timestampSeconds * 1000;
}

test('generateTotpSecret produces a valid base32 secret of at least 16 characters', () => {
  const generatedSecret = generateTotpSecret();
  assert.ok(generatedSecret.length >= 16);
  assert.doesNotThrow(() => decodeBase32Secret(generatedSecret));
});

test('encodeBase32Secret and decodeBase32Secret round-trip the rfc secret', () => {
  const decodedBytes = decodeBase32Secret(RFC_SHA1_BASE32_SECRET);
  assert.equal(Buffer.from(decodedBytes).toString('utf8'), '12345678901234567890');
  assert.equal(encodeBase32Secret(decodedBytes).replace(/=+$/, ''), RFC_SHA1_BASE32_SECRET);
});

test('generateCurrentTotpCode matches RFC 6238 SHA1 vectors', () => {
  const testVectors = [
    { timestampSeconds: 59, expectedCode: '287082' },
    { timestampSeconds: 1111111109, expectedCode: '081804' },
    { timestampSeconds: 1234567890, expectedCode: '005924' },
    { timestampSeconds: 2000000000, expectedCode: '279037' },
  ];

  for (const testVector of testVectors) {
    const generatedCode = generateCurrentTotpCode(
      RFC_SHA1_BASE32_SECRET,
      unixTimeMillisForTimestampSeconds(testVector.timestampSeconds)
    );
    assert.equal(generatedCode, testVector.expectedCode);
  }
});

test('verifyTotpCodeAgainstSecret accepts a correct code and rejects a wrong one', () => {
  const unixTimeMillis = unixTimeMillisForTimestampSeconds(59);
  const correctCode = generateCurrentTotpCode(RFC_SHA1_BASE32_SECRET, unixTimeMillis);

  assert.equal(
    verifyTotpCodeAgainstSecret(RFC_SHA1_BASE32_SECRET, correctCode, unixTimeMillis),
    true
  );
  assert.equal(
    verifyTotpCodeAgainstSecret(RFC_SHA1_BASE32_SECRET, '000000', unixTimeMillis),
    false
  );
});

test('verifyTotpCodeAgainstSecret rejects malformed codes and empty secrets', () => {
  assert.equal(verifyTotpCodeAgainstSecret(RFC_SHA1_BASE32_SECRET, '12345', Date.now()), false);
  assert.equal(verifyTotpCodeAgainstSecret(RFC_SHA1_BASE32_SECRET, 'abcdef', Date.now()), false);
  assert.equal(verifyTotpCodeAgainstSecret('', '123456', Date.now()), false);
  assert.equal(verifyTotpCodeAgainstSecret(RFC_SHA1_BASE32_SECRET, '', Date.now()), false);
});