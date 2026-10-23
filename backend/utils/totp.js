import crypto from 'node:crypto';

import { EVENT_TITLE } from '../services/eventConfigService.js';

const TOTP_TIME_STEP_SECONDS = 30;
const TOTP_CODE_LENGTH = 6;
const TOTP_VERIFY_WINDOW_STEPS = 1;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function generateRandomSecretBytes(byteLength = 20) {
  return crypto.randomBytes(byteLength);
}

export function encodeBase32Secret(rawBytes) {
  let encodedBits = '';
  for (const byteValue of rawBytes) {
    encodedBits += byteValue.toString(2).padStart(8, '0');
  }

  let encodedString = '';
  for (let bitIndex = 0; bitIndex < encodedBits.length; bitIndex += 5) {
    const chunkBits = encodedBits.slice(bitIndex, bitIndex + 5);
    encodedString += BASE32_ALPHABET[parseInt(chunkBits.padEnd(5, '0'), 2)];
  }

  while (encodedString.length % 8 !== 0) {
    encodedString += '=';
  }

  return encodedString;
}

export function decodeBase32Secret(encodedSecret) {
  const normalizedSecret = encodedSecret.replace(/[=\s]/g, '').toUpperCase();

  let decodedBits = '';
  for (const alphabetChar of normalizedSecret) {
    const characterIndex = BASE32_ALPHABET.indexOf(alphabetChar);
    if (characterIndex === -1) {
      throw new Error('Invalid base32 secret character');
    }
    decodedBits += characterIndex.toString(2).padStart(5, '0');
  }

  const paddingLength = decodedBits.length % 8;
  if (paddingLength > 0) {
    decodedBits = decodedBits.slice(0, decodedBits.length - paddingLength);
  }

  const decodedBytes = [];
  for (let bitIndex = 0; bitIndex < decodedBits.length; bitIndex += 8) {
    decodedBytes.push(parseInt(decodedBits.slice(bitIndex, bitIndex + 8), 2));
  }

  return Buffer.from(decodedBytes);
}

export function generateTotpSecret() {
  return encodeBase32Secret(generateRandomSecretBytes()).replace(/=+$/, '');
}

export function buildOtpauthUrl(accountLabel, base32Secret, issuerName = `${EVENT_TITLE} Admin`) {
  const encodedLabel = encodeURIComponent(`${issuerName}:${accountLabel}`);
  return `otpauth://totp/${encodedLabel}?secret=${encodeURIComponent(base32Secret)}&issuer=${encodeURIComponent(issuerName)}&algorithm=SHA1&digits=${TOTP_CODE_LENGTH}&period=${TOTP_TIME_STEP_SECONDS}`;
}

function generateTotpCodeForTimeCounter(base32Secret, timeCounter) {
  const keyBytes = decodeBase32Secret(base32Secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigInt64BE(BigInt(timeCounter));

  const hmacDigest = crypto.createHmac('sha1', keyBytes).update(counterBuffer).digest();
  const offset = hmacDigest[hmacDigest.length - 1] & 0x0f;
  const binaryCode =
    ((hmacDigest[offset] & 0x7f) << 24) |
    ((hmacDigest[offset + 1] & 0xff) << 16) |
    ((hmacDigest[offset + 2] & 0xff) << 8) |
    (hmacDigest[offset + 3] & 0xff);

  return String(binaryCode % 10 ** TOTP_CODE_LENGTH).padStart(TOTP_CODE_LENGTH, '0');
}

export function generateCurrentTotpCode(base32Secret, unixTimeMillis = Date.now()) {
  const timeCounter = Math.floor(unixTimeMillis / 1000 / TOTP_TIME_STEP_SECONDS);
  return generateTotpCodeForTimeCounter(base32Secret, timeCounter);
}

export function verifyTotpCodeAgainstSecret(base32Secret, providedCode, unixTimeMillis = Date.now()) {
  if (!base32Secret || !providedCode) {
    return false;
  }

  const normalizedCode = String(providedCode).replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalizedCode)) {
    return false;
  }

  const currentTimeCounter = Math.floor(unixTimeMillis / 1000 / TOTP_TIME_STEP_SECONDS);

  for (let stepOffset = -TOTP_VERIFY_WINDOW_STEPS; stepOffset <= TOTP_VERIFY_WINDOW_STEPS; stepOffset += 1) {
    const candidateCode = generateTotpCodeForTimeCounter(
      base32Secret,
      currentTimeCounter + stepOffset
    );
    if (candidateCode === normalizedCode) {
      return true;
    }
  }

  return false;
}