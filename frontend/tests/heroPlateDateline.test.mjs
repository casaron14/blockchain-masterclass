import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildEventConfigFromPayload, defaultEventConfig } from '../lib/eventConfig.js';
import { fetchPrimaryEventConfiguration } from '../../shared/eventConfig.js';

const homePageSource = readFileSync(new URL('../app/(event)/page.jsx', import.meta.url), 'utf8');

test('the default event config carries the shared event time', () => {
  const primaryEventConfiguration = fetchPrimaryEventConfiguration();

  assert.equal(defaultEventConfig.eventTime, primaryEventConfiguration.event.eventTime);
});

test('the event payload overrides the event time and falls back when it is absent', () => {
  const eventConfigFromPayload = buildEventConfigFromPayload({
    event: {
      date: '1st January 2027',
      eventTime: '9:00 AM - 12:00 PM',
      location: 'Dodoma, Tanzania',
    },
  });

  assert.equal(eventConfigFromPayload.eventTime, '9:00 AM - 12:00 PM');
  assert.equal(
    buildEventConfigFromPayload({ event: { date: '1st January 2027' } }).eventTime,
    defaultEventConfig.eventTime
  );
});

test('the hero dateline renders the event time between the date and the location', () => {
  assert.match(
    homePageSource,
    /className="hero-plate__dateline">\s*\{dateLabel\} · \{eventTime\} · \{location\}\s*<\/p>/
  );
});
