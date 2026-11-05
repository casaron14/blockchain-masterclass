import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  CONFIRMATION_EMAIL_ATTACHMENT_FILE_NAME,
  ConfirmationEmailAttachmentUnavailableError,
  readConfirmationEmailAttachmentPdf,
  resolveConfirmationEmailAttachmentFilePath,
} from '../services/confirmationEmailAttachmentService.js';

let temporaryAttachmentDirectoryPath;
let previousAttachmentFilePath;

before(async () => {
  temporaryAttachmentDirectoryPath = await mkdtemp(
    path.join(os.tmpdir(), 'confirmation-email-attachment-')
  );
  previousAttachmentFilePath =
    process.env.CONFIRMATION_EMAIL_ATTACHMENT_FILE_PATH;
});

after(async () => {
  await rm(temporaryAttachmentDirectoryPath, { force: true, recursive: true });

  if (previousAttachmentFilePath === undefined) {
    delete process.env.CONFIRMATION_EMAIL_ATTACHMENT_FILE_PATH;
  } else {
    process.env.CONFIRMATION_EMAIL_ATTACHMENT_FILE_PATH =
      previousAttachmentFilePath;
  }
});

test('resolveConfirmationEmailAttachmentFilePath defaults to the playbook in backend/assets', () => {
  delete process.env.CONFIRMATION_EMAIL_ATTACHMENT_FILE_PATH;

  const resolvedFilePath = resolveConfirmationEmailAttachmentFilePath();

  assert.equal(
    path.basename(resolvedFilePath),
    CONFIRMATION_EMAIL_ATTACHMENT_FILE_NAME
  );
  assert.equal(path.basename(path.dirname(resolvedFilePath)), 'assets');
});

test('readConfirmationEmailAttachmentPdf reads the playbook shipped in backend/assets', async () => {
  delete process.env.CONFIRMATION_EMAIL_ATTACHMENT_FILE_PATH;

  const attachment = await readConfirmationEmailAttachmentPdf();

  assert.equal(attachment.filename, CONFIRMATION_EMAIL_ATTACHMENT_FILE_NAME);
  assert.equal(attachment.contentType, 'application/pdf');
  assert.equal(attachment.content.subarray(0, 5).toString('ascii'), '%PDF-');
});

test('readConfirmationEmailAttachmentPdf reads the configured playbook as a PDF attachment', async () => {
  const attachmentFilePath = path.join(
    temporaryAttachmentDirectoryPath,
    CONFIRMATION_EMAIL_ATTACHMENT_FILE_NAME
  );
  const playbookPdfBuffer = Buffer.from('%PDF-1.4 playbook contents');
  await writeFile(attachmentFilePath, playbookPdfBuffer);
  process.env.CONFIRMATION_EMAIL_ATTACHMENT_FILE_PATH = attachmentFilePath;

  const attachment = await readConfirmationEmailAttachmentPdf();

  assert.equal(attachment.filename, CONFIRMATION_EMAIL_ATTACHMENT_FILE_NAME);
  assert.equal(attachment.contentType, 'application/pdf');
  assert.deepEqual(attachment.content, playbookPdfBuffer);
});

test('readConfirmationEmailAttachmentPdf rejects a missing playbook file', async () => {
  process.env.CONFIRMATION_EMAIL_ATTACHMENT_FILE_PATH = path.join(
    temporaryAttachmentDirectoryPath,
    'missing-playbook.pdf'
  );

  await assert.rejects(readConfirmationEmailAttachmentPdf(), (error) => {
    assert.ok(error instanceof ConfirmationEmailAttachmentUnavailableError);
    assert.equal(error.unavailableReason, 'file_not_found');
    assert.match(error.message, /CONFIRMATION_EMAIL_ATTACHMENT_UNAVAILABLE/);
    return true;
  });
});

test('readConfirmationEmailAttachmentPdf rejects a file that is not a PDF', async () => {
  const nonPdfFilePath = path.join(
    temporaryAttachmentDirectoryPath,
    'not-a-playbook.pdf'
  );
  await writeFile(nonPdfFilePath, 'this is not a PDF');
  process.env.CONFIRMATION_EMAIL_ATTACHMENT_FILE_PATH = nonPdfFilePath;

  await assert.rejects(readConfirmationEmailAttachmentPdf(), (error) => {
    assert.ok(error instanceof ConfirmationEmailAttachmentUnavailableError);
    assert.equal(error.unavailableReason, 'not_a_pdf_file');
    return true;
  });
});
