import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearStoredAttendeeProfile,
  clearStoredBookingDraft,
  clearStoredBookingProgress,
  fetchStoredAttendeeProfile,
  fetchStoredBookingDraft,
  fetchStoredBookingRecord,
  fetchStoredPaymentPublicToken,
  storeAttendeeProfileLocally,
  storeBookingDraftLocally,
  storeBookingRecordLocally,
  storePaymentPublicTokenLocally,
} from '../lib/bookingStorage.js';

function createInMemoryLocalStorage() {
  const storedValues = new Map();
  return {
    getItem(storageKey) {
      return storedValues.has(storageKey) ? storedValues.get(storageKey) : null;
    },
    setItem(storageKey, rawValue) {
      storedValues.set(storageKey, String(rawValue));
    },
    removeItem(storageKey) {
      storedValues.delete(storageKey);
    },
  };
}

function installBrowserWindowWith(inMemoryLocalStorage) {
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: inMemoryLocalStorage };
  return function restorePreviousWindow() {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  };
}

test('stores and fetches the attendee profile across events', () => {
  const restoreWindow = installBrowserWindowWith(createInMemoryLocalStorage());
  try {
    storeAttendeeProfileLocally({
      full_name: 'Anna Mwangi',
      phone_number: '+255712345678',
      email: 'anna@example.com',
    });

    const storedAttendeeProfile = fetchStoredAttendeeProfile();
    assert.equal(storedAttendeeProfile.full_name, 'Anna Mwangi');
    assert.equal(storedAttendeeProfile.phone_number, '+255712345678');
    assert.equal(storedAttendeeProfile.email, 'anna@example.com');
  } finally {
    restoreWindow();
  }
});

test('attendee profile survives booking draft clearing', () => {
  const restoreWindow = installBrowserWindowWith(createInMemoryLocalStorage());
  try {
    storeAttendeeProfileLocally({
      full_name: 'Baraka Juma',
      phone_number: '+255723456789',
      email: 'baraka@example.com',
    });
    storeBookingDraftLocally('blockchain-summit', {
      full_name: 'Baraka Juma',
      phone_number: '+255723456789',
      email: 'baraka@example.com',
      payment_method: 'azampesa',
    });

    clearStoredBookingDraft('blockchain-summit');

    assert.equal(fetchStoredBookingDraft('blockchain-summit'), null);
    assert.equal(fetchStoredAttendeeProfile().full_name, 'Baraka Juma');
  } finally {
    restoreWindow();
  }
});

test('attendee profile is readable for a different event slug', () => {
  const restoreWindow = installBrowserWindowWith(createInMemoryLocalStorage());
  try {
    storeAttendeeProfileLocally({
      full_name: 'Neema Joseph',
      phone_number: '+255734567890',
      email: 'neema@example.com',
    });

    assert.equal(fetchStoredAttendeeProfile().full_name, 'Neema Joseph');
  } finally {
    restoreWindow();
  }
});

test('clears the stored attendee profile', () => {
  const restoreWindow = installBrowserWindowWith(createInMemoryLocalStorage());
  try {
    storeAttendeeProfileLocally({
      full_name: 'Said Hassan',
      phone_number: '+255745678901',
      email: 'said@example.com',
    });
    assert.notEqual(fetchStoredAttendeeProfile(), null);

    clearStoredAttendeeProfile();

    assert.equal(fetchStoredAttendeeProfile(), null);
  } finally {
    restoreWindow();
  }
});

test('stores and retrieves a booking record with a payment public token', () => {
  const restoreWindow = installBrowserWindowWith(createInMemoryLocalStorage());
  try {
    const bookingRecord = { id: 42, expires_at: '2099-01-01T00:00:00Z' };
    storeBookingRecordLocally('blockchain-summit', bookingRecord);
    storePaymentPublicTokenLocally('blockchain-summit', '9f2c1a7b-3d4e-4f5a-8b6c-7d8e9f0a1b2c');

    assert.deepEqual(fetchStoredBookingRecord('blockchain-summit'), bookingRecord);
    assert.equal(
      fetchStoredPaymentPublicToken('blockchain-summit'),
      '9f2c1a7b-3d4e-4f5a-8b6c-7d8e9f0a1b2c'
    );
  } finally {
    restoreWindow();
  }
});