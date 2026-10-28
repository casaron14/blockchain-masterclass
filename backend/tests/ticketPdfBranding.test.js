import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { INKRYPTUS_LOGO_ON_BLACK_PNG_BASE64 } from '../../shared/inkryptusLogoOnBlackPngAsset.js';

const BACKEND_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND_LOGO_ASSET_PATH = path.join(
  BACKEND_DIRECTORY,
  '../frontend/assets/inkryptus-logo-white-on-black.png',
);

test('the embedded Inkryptus logo matches the frontend asset byte for byte', () => {
  const embeddedLogoPngBuffer = Buffer.from(INKRYPTUS_LOGO_ON_BLACK_PNG_BASE64, 'base64');
  const frontendLogoPngBuffer = fs.readFileSync(FRONTEND_LOGO_ASSET_PATH);

  assert.deepEqual(embeddedLogoPngBuffer, frontendLogoPngBuffer);
});

test('the embedded Inkryptus logo is an opaque PNG that pdfkit can draw', () => {
  const embeddedLogoPngBuffer = Buffer.from(INKRYPTUS_LOGO_ON_BLACK_PNG_BASE64, 'base64');
  const pngSignature = embeddedLogoPngBuffer.subarray(0, 8);
  const pngColorType = embeddedLogoPngBuffer[25];

  assert.deepEqual(
    pngSignature,
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  );
  // Color type 2 is truecolor RGB. An alpha channel makes pdfkit render the
  // white wordmark as grey, so the asset is flattened onto the ticket black.
  assert.equal(pngColorType, 2);
});
