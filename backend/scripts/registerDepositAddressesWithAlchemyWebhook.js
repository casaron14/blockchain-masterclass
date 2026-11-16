import '../config/environment.js';

import pool from '../config/db.js';

import {
  ALCHEMY_WEBHOOK_MAX_ADDRESSES_PER_CALL,
  isAlchemyWebhookAddressRegistryConfigured,
  registerDepositAddressesWithAlchemyWebhook,
} from '../services/alchemyWebhookAddressRegistry.js';

// Every address an order ever held has to stay watched: a late payment to a
// superseded address must still be attributed, and addresses created before the
// webhook existed were never registered while the order was open.
async function fetchEveryDepositAddressFromDatabase() {
  const depositAddressResult = await pool.query(
    'SELECT address FROM deposit_addresses ORDER BY id'
  );
  return depositAddressResult.rows.map((depositAddressRow) => depositAddressRow.address);
}

function splitDepositAddressesIntoApiSizedBatches(depositAddresses) {
  const addressBatches = [];
  for (
    let batchStartIndex = 0;
    batchStartIndex < depositAddresses.length;
    batchStartIndex += ALCHEMY_WEBHOOK_MAX_ADDRESSES_PER_CALL
  ) {
    addressBatches.push(
      depositAddresses.slice(
        batchStartIndex,
        batchStartIndex + ALCHEMY_WEBHOOK_MAX_ADDRESSES_PER_CALL
      )
    );
  }
  return addressBatches;
}

async function registerEveryDepositAddressWithAlchemyWebhook() {
  if (!isAlchemyWebhookAddressRegistryConfigured()) {
    throw new Error(
      'ALCHEMY_WEBHOOK_ID and ALCHEMY_WEBHOOK_AUTH_TOKEN must be set '
      + 'before deposit addresses can be registered.'
    );
  }

  const depositAddresses = await fetchEveryDepositAddressFromDatabase();
  const addressBatches = splitDepositAddressesIntoApiSizedBatches(depositAddresses);

  let registeredAddressCount = 0;
  for (const addressBatch of addressBatches) {
    await registerDepositAddressesWithAlchemyWebhook(addressBatch);
    registeredAddressCount += addressBatch.length;
    console.log(
      `Registered ${registeredAddressCount}/${depositAddresses.length} deposit addresses`
    );
  }

  console.log(
    `Alchemy webhook now watches ${depositAddresses.length} deposit addresses `
    + `in ${addressBatches.length} batch(es).`
  );
  console.log(
    'Transfers received before the webhook existed are recovered by the polling '
    + 'scan; lower usdt_transfer_scan_state.last_scanned_block to rescan further back.'
  );
}

registerEveryDepositAddressWithAlchemyWebhook()
  .catch((registrationError) => {
    console.error(`Could not register deposit addresses with Alchemy: ${registrationError.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
