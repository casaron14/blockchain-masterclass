// Reads the extra PDF that accompanies a confirmed booking's ticket email.
//
// The file lives in backend/assets so the email never depends on Google Drive
// being reachable at send time. CONFIRMATION_EMAIL_ATTACHMENT_FILE_PATH may
// point at another absolute path or at a path relative to backend/. The default
// is the playbook operators place in backend/assets.

import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

export const CONFIRMATION_EMAIL_ATTACHMENT_FILE_NAME =
  'Blockchain Masterclass Playbook.pdf';

const BACKEND_DIRECTORY_PATH = fileURLToPath(new URL('..', import.meta.url));
const CONFIRMATION_EMAIL_ATTACHMENT_DIRECTORY_PATH = path.join(
  BACKEND_DIRECTORY_PATH,
  'assets'
);

export class ConfirmationEmailAttachmentUnavailableError extends Error {
  constructor(attachmentFilePath, unavailableReason) {
    super(
      `CONFIRMATION_EMAIL_ATTACHMENT_UNAVAILABLE:${attachmentFilePath}:${unavailableReason}`
    );
    this.name = 'ConfirmationEmailAttachmentUnavailableError';
    this.attachmentFilePath = attachmentFilePath;
    this.unavailableReason = unavailableReason;
  }
}

export function resolveConfirmationEmailAttachmentFilePath() {
  const configuredAttachmentFilePath =
    process.env.CONFIRMATION_EMAIL_ATTACHMENT_FILE_PATH?.trim();

  if (!configuredAttachmentFilePath) {
    return path.join(
      CONFIRMATION_EMAIL_ATTACHMENT_DIRECTORY_PATH,
      CONFIRMATION_EMAIL_ATTACHMENT_FILE_NAME
    );
  }

  return path.isAbsolute(configuredAttachmentFilePath)
    ? configuredAttachmentFilePath
    : path.resolve(BACKEND_DIRECTORY_PATH, configuredAttachmentFilePath);
}

export async function readConfirmationEmailAttachmentPdf() {
  const attachmentFilePath = resolveConfirmationEmailAttachmentFilePath();
  let attachmentPdfBuffer;

  try {
    attachmentPdfBuffer = await readFile(attachmentFilePath);
  } catch (readError) {
    throw new ConfirmationEmailAttachmentUnavailableError(
      attachmentFilePath,
      readError.code === 'ENOENT' ? 'file_not_found' : 'file_not_readable'
    );
  }

  const pdfSignature = attachmentPdfBuffer.subarray(0, 5).toString('ascii');
  if (pdfSignature !== '%PDF-') {
    throw new ConfirmationEmailAttachmentUnavailableError(
      attachmentFilePath,
      'not_a_pdf_file'
    );
  }

  return {
    filename: path.basename(attachmentFilePath),
    content: attachmentPdfBuffer,
    contentType: 'application/pdf',
  };
}
