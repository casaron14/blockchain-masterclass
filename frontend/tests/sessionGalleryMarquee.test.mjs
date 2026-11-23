import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const componentSource = readFileSync(
  new URL('../components/SessionGalleryMarquee.jsx', import.meta.url),
  'utf8'
);
const homePageSource = readFileSync(new URL('../app/(event)/page.jsx', import.meta.url), 'utf8');
const stylesheetSource = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

const sessionPhotographPaths = [
  '@/assets/IMG_5762.webp',
  '@/assets/WhatsApp Image 2026-11-23 at 15.02.52.webp',
  '@/assets/WhatsApp Image 2026-11-23 at 15.02.55.webp',
  '@/assets/WhatsApp Image 2026-11-23 at 15.02.55 (1).webp',
  '@/assets/WhatsApp Image 2026-11-23 at 15.08.58.webp',
  '@/assets/WhatsApp Image 2026-11-23 at 15.08.58 (1).webp',
];

test('the session gallery renders every added photograph', () => {
  for (const sessionPhotographPath of sessionPhotographPaths) {
    assert.ok(
      componentSource.includes(sessionPhotographPath),
      `${sessionPhotographPath} must appear in the gallery`
    );
  }
});

test('the looping copy is hidden from assistive technology', () => {
  assert.match(componentSource, /session-gallery__group--duplicate" aria-hidden="true"/);
  assert.equal(
    (componentSource.match(/renderSessionPhotographFrames\(/g) || []).length,
    2,
    'one original group and one hidden copy must both render the photographs'
  );
});

test('the strip freezes into a still grid under reduced motion', () => {
  assert.match(stylesheetSource, /@keyframes session-gallery-travel/);
  assert.match(stylesheetSource, /\.session-gallery__group--duplicate\s*\{\s*display: none/);
});

test('the home page shows the gallery instead of the hero-adjacent seat ledger', () => {
  assert.ok(homePageSource.includes('<SessionGalleryMarquee />'));
  assert.equal(homePageSource.includes('fullBleed'), false);
  assert.equal(homePageSource.includes('className="ledger-band"'), false);
});
