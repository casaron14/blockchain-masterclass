import '../config/environment.js';

import { writeFileSync } from 'node:fs';

import { prepareSweepBatchForOfflineSigning } from '../services/sweepBatchPreparationService.js';

const outputPath = process.argv[2]
  ?? `sweep-batch-unsigned-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

const preparedBatch = await prepareSweepBatchForOfflineSigning();

writeFileSync(outputPath, JSON.stringify(preparedBatch, null, 2), { mode: 0o600 });

const preparedItemCount = preparedBatch.items.length;
const skippedResults = preparedBatch.results.filter(
  (batchResult) => batchResult.status !== 'PREPARED_FOR_OFFLINE_SIGNING'
);

console.log(`Batch ${preparedBatch.batchId}`);
console.log(`Prepared ${preparedItemCount} order(s) for offline signing.`);
if (skippedResults.length > 0) {
  console.log(`Skipped ${skippedResults.length} order(s):`);
  for (const skippedResult of skippedResults) {
    console.log(
      `  order ${skippedResult.orderId}: ${skippedResult.status} `
      + `${skippedResult.reason ?? skippedResult.message ?? ''}`.trimEnd()
    );
  }
}
console.log(`Unsigned batch written to ${outputPath}`);
console.log('Next: copy it to the offline machine and run npm run sweep:sign.');
if (preparedItemCount === 0) {
  console.log('Nothing to sign. The file contains no items.');
}
