import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNotFoundDestinationLinks } from '../lib/notFoundLinks.js';
import {
  checkEventSlugExistsInConfiguration,
  DEFAULT_EVENT_SLUG,
} from '../lib/eventConfig.js';
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  translate,
  translations,
} from '../lib/translations.js';

const NOT_FOUND_COPY_KEYS = [
  'eyebrow',
  'codeLabel',
  'heading',
  'body',
  'primary',
  'secondary',
  'tertiary',
  'docketLabel',
  'docketSerial',
  'requestedAddress',
  'statusLabel',
  'statusValue',
  'eventLabel',
  'dateLabel',
  'supportNote',
  'sealText',
];

const LOADING_STATE_KEYS = [
  'loadingEvent',
  'loadingPayment',
  'loadingQr',
  'loadingWallet',
  'sendingStkPrompt',
  'creatingBooking',
  'searchingBooking',
  'preparingPayment',
  'downloadingTicket',
  'uploadingReceipt',
  'subscribing',
  'loadingAttendee',
  'securityCheck',
];

test('buildNotFoundDestinationLinks routes the 404 actions to the root event page, the booking lookup and the back office', () => {
  const destinationLinks = buildNotFoundDestinationLinks();

  assert.equal(destinationLinks.eventHome, '/');
  assert.equal(destinationLinks.bookingLookup, '/book');
  assert.equal(destinationLinks.backOffice, '/admin');
});

test('the event configuration lookup only accepts configured event slugs', () => {
  assert.equal(checkEventSlugExistsInConfiguration(DEFAULT_EVENT_SLUG), true);
  assert.equal(checkEventSlugExistsInConfiguration('not-a-configured-event'), false);
  assert.equal(checkEventSlugExistsInConfiguration(''), false);
});

test('every supported language defines the full 404 record copy', () => {
  for (const languageCode of Object.keys(SUPPORTED_LANGUAGES)) {
    const notFoundCopy = translations[languageCode].notFound;

    assert.ok(notFoundCopy, `${languageCode} has no notFound copy`);
    for (const copyKey of NOT_FOUND_COPY_KEYS) {
      assert.equal(
        typeof notFoundCopy[copyKey],
        'string',
        `${languageCode}.notFound.${copyKey} must be a string`
      );
      assert.ok(
        notFoundCopy[copyKey].trim().length > 0,
        `${languageCode}.notFound.${copyKey} must not be empty`
      );
    }
  }
});

test('every supported language defines a loading label for each async process', () => {
  for (const languageCode of Object.keys(SUPPORTED_LANGUAGES)) {
    const loadingStateCopy = translations[languageCode].loadingStates;

    assert.ok(loadingStateCopy, `${languageCode} has no loadingStates copy`);
    for (const loadingKey of LOADING_STATE_KEYS) {
      assert.equal(
        typeof loadingStateCopy[loadingKey],
        'string',
        `${languageCode}.loadingStates.${loadingKey} must be a string`
      );
      assert.ok(
        loadingStateCopy[loadingKey].trim().length > 0,
        `${languageCode}.loadingStates.${loadingKey} must not be empty`
      );
    }
  }
});

test('the 404 heading resolves through the active language instead of leaking a raw key', () => {
  const englishHeading = translate('en', 'notFound.heading');
  const swahiliHeading = translate('sw', 'notFound.heading');

  assert.notEqual(englishHeading, 'notFound.heading');
  assert.notEqual(swahiliHeading, 'notFound.heading');
  assert.notEqual(englishHeading, swahiliHeading);
  assert.equal(translate(DEFAULT_LANGUAGE, 'notFound.heading'), swahiliHeading);
});
