import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import nextConfig from '../next.config.mjs';

const FRONTEND_ROOT_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const PDFKIT_PACKAGE_RELATIVE_DIRECTORY = 'node_modules/pdfkit';
const API_FUNCTION_TRACING_KEY = '/api/**';

// Next traces static requires only. pdfkit loads its built-in AFM fonts through
// its package "imports" map (#standard-fonts/Helvetica), so the modules below
// reach the deployed function only when they are listed in
// outputFileTracingIncludes.
function collectPdfKitStandardFontModulePaths() {
  const standardFontModuleRoot = path.join(
    FRONTEND_ROOT_DIRECTORY,
    PDFKIT_PACKAGE_RELATIVE_DIRECTORY,
    'js/standard-fonts',
  );

  return fs
    .readdirSync(standardFontModuleRoot, { recursive: true })
    .filter((relativePath) => relativePath.endsWith('.cjs'))
    .map(
      (relativePath) =>
        `./${PDFKIT_PACKAGE_RELATIVE_DIRECTORY}/js/standard-fonts/${relativePath.split(path.sep).join('/')}`,
    );
}

function listTracedDirectoryPrefixes(apiTracingIncludeGlobs) {
  return apiTracingIncludeGlobs
    .filter((tracingIncludeGlob) => tracingIncludeGlob.endsWith('/**/*'))
    .map((tracingIncludeGlob) => tracingIncludeGlob.slice(0, -'/**/*'.length));
}

test('the API function trace includes every pdfkit standard font module', () => {
  const apiTracingIncludeGlobs =
    nextConfig.outputFileTracingIncludes[API_FUNCTION_TRACING_KEY];
  const tracedDirectoryPrefixes = listTracedDirectoryPrefixes(apiTracingIncludeGlobs);
  const standardFontModulePaths = collectPdfKitStandardFontModulePaths();

  assert.ok(standardFontModulePaths.length > 0, 'pdfkit standard font modules were not found');

  for (const standardFontModulePath of standardFontModulePaths) {
    const isModuleTraced = tracedDirectoryPrefixes.some((tracedDirectoryPrefix) =>
      standardFontModulePath.startsWith(`${tracedDirectoryPrefix}/`),
    );

    assert.ok(
      isModuleTraced,
      `${standardFontModulePath} is not covered by outputFileTracingIncludes["${API_FUNCTION_TRACING_KEY}"]`,
    );
  }
});

test('pdfkit stays outside the webpack bundle so it resolves its own font modules', () => {
  assert.ok(
    nextConfig.serverExternalPackages.includes('pdfkit'),
    'pdfkit must be listed in serverExternalPackages to load #standard-fonts at runtime',
  );
});

test('the API function trace no longer needs the next/og renderer', () => {
  const apiTracingIncludeGlobs =
    nextConfig.outputFileTracingIncludes[API_FUNCTION_TRACING_KEY];

  assert.ok(
    !apiTracingIncludeGlobs.some((tracingIncludeGlob) =>
      tracingIncludeGlob.includes('node_modules/next/dist/compiled/@vercel/og'),
    ),
    'ticket email now uses the PDF generator, so next/og should not be traced',
  );
});
