import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DOCUMENT_STORAGE_MODE_IN_MEMORY,
  DOCUMENT_STORAGE_MODE_LOCAL_FILE_SYSTEM,
  isLocalDocumentStorageEnabled,
  resolveDocumentStorageMode,
} from '../config/documentStorage.js';

function restoreEnvironmentVariable(variableName, previousValue) {
  if (previousValue === undefined) {
    delete process.env[variableName];
    return;
  }
  process.env[variableName] = previousValue;
}

test('Vercel uses in-memory document storage even when local storage is configured', () => {
  const previousVercelSetting = process.env.VERCEL;
  const previousDocumentStorageMode = process.env.DOCUMENT_STORAGE_MODE;
  process.env.VERCEL = '1';
  process.env.DOCUMENT_STORAGE_MODE = DOCUMENT_STORAGE_MODE_LOCAL_FILE_SYSTEM;

  try {
    assert.equal(resolveDocumentStorageMode(), DOCUMENT_STORAGE_MODE_IN_MEMORY);
    assert.equal(isLocalDocumentStorageEnabled(), false);
  } finally {
    restoreEnvironmentVariable('VERCEL', previousVercelSetting);
    restoreEnvironmentVariable('DOCUMENT_STORAGE_MODE', previousDocumentStorageMode);
  }
});

test('self-hosted deployments can configure local document storage', () => {
  const previousVercelSetting = process.env.VERCEL;
  const previousDocumentStorageMode = process.env.DOCUMENT_STORAGE_MODE;
  delete process.env.VERCEL;
  process.env.DOCUMENT_STORAGE_MODE = DOCUMENT_STORAGE_MODE_LOCAL_FILE_SYSTEM;

  try {
    assert.equal(resolveDocumentStorageMode(), DOCUMENT_STORAGE_MODE_LOCAL_FILE_SYSTEM);
    assert.equal(isLocalDocumentStorageEnabled(), true);
  } finally {
    restoreEnvironmentVariable('VERCEL', previousVercelSetting);
    restoreEnvironmentVariable('DOCUMENT_STORAGE_MODE', previousDocumentStorageMode);
  }
});
