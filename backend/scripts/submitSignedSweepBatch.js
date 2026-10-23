import '../config/environment.js';

import { readFileSync } from 'node:fs';

import { submitSignedSweepBatch } from '../services/sweepBatchSubmissionService.js';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error(
    'Usage: node scripts/submitSignedSweepBatch.js <signed-batch.json>'
  );
  process.exit(1);
}

const signedBatch = JSON.parse(readFileSync(inputPath, 'utf8'));
const submissionSummary = await submitSignedSweepBatch(signedBatch);

let failedCount = 0;
for (const submissionResult of submissionSummary.results) {
  if (submissionResult.status === 'FAILED') {
    failedCount += 1;
  }
  console.log(
    `order ${submissionResult.orderId} (sweep ${submissionResult.sweepId}): `
    + `${submissionResult.status}`
    + `${submissionResult.txHash ? ` ${submissionResult.txHash}` : ''}`
    + `${submissionResult.message ? ` - ${submissionResult.message}` : ''}`
  );
}

console.log(
  `Submitted batch ${submissionSummary.batchId}: `
  + `${submissionSummary.results.length - failedCount} ok, ${failedCount} failed.`
);
if (failedCount > 0) {
  process.exitCode = 1;
}
