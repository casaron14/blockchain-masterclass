// Reads the extra PDF that accompanies a confirmed booking's ticket email.
//
// The file lives in backend/assets so the email never depends on Google Drive
// being reachable at send time. CONFIRMATION_EMAIL_ATTACHMENT_FILE_PATH may
// point at another absolute path or at a path relative to the process working
// directory. The default searches the common working directories used by the
// Express server, a self-hosted Next.js process and a serverless API function.

import { readFile } from 'fs/promises';
import path from 'path';

export const CONFIRMATION_EMAIL_ATTACHMENT_FILE_NAME =
  'Blockchain Masterclass Playbook.pdf';

export class ConfirmationEmailAttachmentUnavailableError extends Error {
  constructor(attemptedAttachmentFilePaths, unavailableReason) {
    super(
      `CONFIRMATION_EMAIL_ATTACHMENT_UNAVAILABLE:${attemptedAttachmentFilePaths.join('|')}:${unavailableReason}`
    );
    this.name = 'ConfirmationEmailAttachmentUnavailableError';
    this.attemptedAttachmentFilePaths = attemptedAttachmentFilePaths;
    this.unavailableReason = unavailableReason;
  }
}

function buildDefaultConfirmationEmailAttachmentFilePathCandidates() {
  const attachmentFileName = CONFIRMATION_EMAIL_ATTACHMENT_FILE_NAME;

  return [
    path.join(process.cwd(), 'assets', attachmentFileName),
    path.join(process.cwd(), 'backend', 'assets', attachmentFileName),
    path.join(process.cwd(), '..', 'backend', 'assets', attachmentFileName),
    path.join(process.cwd(), '..', '..', 'backend', 'assets', attachmentFileName),
  ];
}

function resolveConfiguredConfirmationEmailAttachmentFilePath() {
  const configuredAttachmentFilePath =
    process.env.CONFIRMATION_EMAIL_ATTACHMENT_FILE_PATH?.trim();

  if (!configuredAttachmentFilePath) {
    return null;
  }

  return path.isAbsolute(configuredAttachmentFilePath)
    ? configuredAttachmentFilePath
    : path.resolve(process.cwd(), configuredAttachmentFilePath);
}

export function resolveConfirmationEmailAttachmentFilePath() {
  const configuredAttachmentFilePath =
    resolveConfiguredConfirmationEmailAttachmentFilePath();

  if (configuredAttachmentFilePath) {
    return configuredAttachmentFilePath;
  }

  return buildDefaultConfirmationEmailAttachmentFilePathCandidates()[0];
}

export async function readConfirmationEmailAttachmentPdf() {
  const configuredAttachmentFilePath =
    resolveConfiguredConfirmationEmailAttachmentFilePath();
  const attachmentFilePathCandidates = configuredAttachmentFilePath
    ? [configuredAttachmentFilePath]
    : buildDefaultConfirmationEmailAttachmentFilePathCandidates();

  for (const attachmentFilePath of attachmentFilePathCandidates) {
    let attachmentPdfBuffer;

    try {
      attachmentPdfBuffer = await readFile(attachmentFilePath);
    } catch (readError) {
      if (readError.code === 'ENOENT') {
        continue;
      }

      throw new ConfirmationEmailAttachmentUnavailableError(
        [attachmentFilePath],
        'file_not_readable'
      );
    }

    const pdfSignature = attachmentPdfBuffer.subarray(0, 5).toString('ascii');
    if (pdfSignature !== '%PDF-') {
      throw new ConfirmationEmailAttachmentUnavailableError(
        [attachmentFilePath],
        'not_a_pdf_file'
      );
    }

    return {
      filename: path.basename(attachmentFilePath),
      content: attachmentPdfBuffer,
      contentType: 'application/pdf',
    };
  }

  throw new ConfirmationEmailAttachmentUnavailableError(
    attachmentFilePathCandidates,
    'file_not_found'
  );
}
