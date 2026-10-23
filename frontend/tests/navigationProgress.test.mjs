import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowNavigationProgressForAnchor } from '../lib/navigationProgress.js';

const CURRENT_EVENT_URL = 'https://masterclass.example/blockchain-masterclass';

function createAnchorElement({
  href = '',
  target = '',
  hasDownloadAttribute = false,
  hasNoProgressAttribute = false,
} = {}) {
  return {
    getAttribute(attributeName) {
      if (attributeName === 'href') return href;
      if (attributeName === 'target') return target || null;
      return null;
    },
    hasAttribute(attributeName) {
      if (attributeName === 'download') return hasDownloadAttribute;
      if (attributeName === 'data-no-route-progress') return hasNoProgressAttribute;
      return false;
    },
  };
}

test('route progress starts for an internal navigation to a different page', () => {
  assert.equal(
    shouldShowNavigationProgressForAnchor(
      createAnchorElement({ href: '/admin/transactions' }),
      CURRENT_EVENT_URL
    ),
    true
  );
  assert.equal(
    shouldShowNavigationProgressForAnchor(
      createAnchorElement({ href: '/blockchain-masterclass/book' }),
      CURRENT_EVENT_URL
    ),
    true
  );
});

test('route progress ignores same-page anchors and hash links', () => {
  assert.equal(
    shouldShowNavigationProgressForAnchor(
      createAnchorElement({ href: '#schedule' }),
      CURRENT_EVENT_URL
    ),
    false
  );
  assert.equal(
    shouldShowNavigationProgressForAnchor(
      createAnchorElement({ href: '/blockchain-masterclass#schedule' }),
      CURRENT_EVENT_URL
    ),
    false
  );
});

test('route progress starts when the query string changes on the same page', () => {
  assert.equal(
    shouldShowNavigationProgressForAnchor(
      createAnchorElement({ href: '/blockchain-masterclass?source=email' }),
      CURRENT_EVENT_URL
    ),
    true
  );
});

test('route progress ignores external, download and new-tab links', () => {
  assert.equal(
    shouldShowNavigationProgressForAnchor(
      createAnchorElement({ href: 'https://other.example/admin' }),
      CURRENT_EVENT_URL
    ),
    false
  );
  assert.equal(
    shouldShowNavigationProgressForAnchor(
      createAnchorElement({ href: '/api/tickets/ABC123.pdf' }),
      CURRENT_EVENT_URL
    ),
    false
  );
  assert.equal(
    shouldShowNavigationProgressForAnchor(
      createAnchorElement({ href: '/admin', target: '_blank' }),
      CURRENT_EVENT_URL
    ),
    false
  );
  assert.equal(
    shouldShowNavigationProgressForAnchor(
      createAnchorElement({ href: '/api/tickets/ABC123.pdf', hasDownloadAttribute: true }),
      CURRENT_EVENT_URL
    ),
    false
  );
});

test('route progress ignores mail links, opted-out links and empty hrefs', () => {
  assert.equal(
    shouldShowNavigationProgressForAnchor(
      createAnchorElement({ href: 'mailto:support@dienacademy.com' }),
      CURRENT_EVENT_URL
    ),
    false
  );
  assert.equal(
    shouldShowNavigationProgressForAnchor(
      createAnchorElement({ href: '/admin', hasNoProgressAttribute: true }),
      CURRENT_EVENT_URL
    ),
    false
  );
  assert.equal(
    shouldShowNavigationProgressForAnchor(
      createAnchorElement({ href: '' }),
      CURRENT_EVENT_URL
    ),
    false
  );
});

test('route progress compares the destination with the page the click started from', () => {
  assert.equal(
    shouldShowNavigationProgressForAnchor(
      createAnchorElement({ href: '/blockchain-masterclass#schedule' }),
      'https://masterclass.example/blockchain-masterclass/book'
    ),
    true
  );
});
