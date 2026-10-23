import '../config/environment.js';

import { readFileSync, writeFileSync } from 'node:fs';

import { signPreparedSweepBatchWithMasterMnemonic } from '../services/offlineSweepSigningService.js';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error(
    'Usage: node scripts/signSweepBatchOnOfflineMachine.js <unsigned-batch.json> [signed-batch.json]'
  );
  process.exit(1);
}

const defaultOutputPath = /unsigned/i.test(inputPath)
  ? inputPath.replace(/unsigned/i, 'signed')
  : `${inputPath.replace(/\.json$/i, '')}.signed.json`;
const outputPath = process.argv[3] ?? defaultOutputPath;

const preparedBatch = JSON.parse(readFileSync(inputPath, 'utf8'));
const signedBatch = await signPreparedSweepBatchWithMasterMnemonic(preparedBatch);

writeFileSync(outputPath, JSON.stringify(signedBatch, null, 2), { mode: 0o600 });

console.log(
  `Signed ${signedBatch.items.length} order(s) with ${signedBatch.items.reduce(
    (attemptTotal, batchItem) => attemptTotal + batchItem.attempts.length,
    0
  )} transaction(s).`
);
for (const batchItem of signedBatch.items) {
  console.log(
    `  order ${batchItem.orderId}: index ${batchItem.derivationIndex} `
    + `${batchItem.depositAddress}`
  );
}
console.log(`Signed batch written to ${outputPath}`);
console.log(
  'This file contains broadcastable transactions. Copy only the signed batch back '
  + 'to the online machine; never copy the mnemonic.'
);
