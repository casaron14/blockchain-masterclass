import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ethers } from 'ethers';
import pool from '../config/db.js';

import { createApplication } from '../app.js';
import { createBookingRecordWithActiveSeatHold } from '../services/bookingService.js';
import { createPendingPaymentRecordForBooking } from '../services/paymentService.js';
import { createOrderWithDepositAddressForBooking } from '../services/orderService.js';
import {
  ALCHEMY_WEBHOOK_IGNORED_NO_MATCHING_TRANSFERS,
  ALCHEMY_WEBHOOK_IGNORED_UNEXPECTED_NETWORK,
  ALCHEMY_WEBHOOK_IGNORED_UNSUPPORTED_TYPE,
  ALCHEMY_WEBHOOK_STATUS_ACCEPTED,
  ALCHEMY_WEBHOOK_STATUS_IGNORED,
  buildObservedUsdtTransfersFromAlchemyActivityWebhookPayload,
} from '../services/alchemyDepositActivityParser.js';
import {
  ALCHEMY_WEBHOOK_SIGNATURE_HEADER_NAME,
  computeAlchemyWebhookSignatureDigest,
  verifyAlchemyWebhookSignature,
} from '../services/alchemyWebhookSignatureVerifier.js';

const TEST_USDT_CONTRACT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';
const TEST_PAYER_ADDRESS = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
const TEST_WEBHOOK_SIGNING_KEY = 'test-alchemy-webhook-signing-key';

const previousEnvironment = {};
for (const environmentName of [
  'USDT_CONTRACT_ADDRESS',
  'CHAIN_ID',
  'ALCHEMY_WEBHOOK_SIGNING_KEY',
  'ALCHEMY_WEBHOOK_ID',
  'ALCHEMY_WEBHOOK_AUTH_TOKEN',
]) {
  previousEnvironment[environmentName] = process.env[environmentName];
}

function applyEnvironment(overrides) {
  for (const [environmentName, environmentValue] of Object.entries(overrides)) {
    if (environmentValue === undefined) {
      delete process.env[environmentName];
    } else {
      process.env[environmentName] = environmentValue;
    }
  }
}

function restoreEnvironment() {
  for (const [environmentName, environmentValue] of Object.entries(previousEnvironment)) {
    if (environmentValue === undefined) {
      delete process.env[environmentName];
    } else {
      process.env[environmentName] = environmentValue;
    }
  }
}

function buildAlchemyTransferActivity({
  depositAddress,
  txHash,
  amountWei,
  contractAddress = TEST_USDT_CONTRACT_ADDRESS,
  category = 'token',
  removed = false,
  blockNumberHex = '0x1f4',
}) {
  return {
    blockNum: blockNumberHex,
    hash: txHash,
    fromAddress: TEST_PAYER_ADDRESS,
    toAddress: depositAddress,
    // Deliberately a rounded float: the parser must read rawValue instead.
    value: 12.000000000000001,
    asset: 'USDT',
    category,
    removed,
    rawContract: {
      rawValue: `0x${amountWei.toString(16)}`,
      address: contractAddress,
      decimals: '0x12',
    },
    log: { logIndex: '0x3' },
  };
}

function buildAddressActivityWebhookPayload(activityList, {
  network = 'BNB_MAINNET',
  webhookType = 'ADDRESS_ACTIVITY',
} = {}) {
  return {
    webhookId: 'wh_test',
    id: 'whevt_test',
    createdAt: new Date().toISOString(),
    type: webhookType,
    event: { network, activity: activityList },
  };
}

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
}

async function createOrderWithDepositAddressForTestAttendee() {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Alchemy Webhook Attendee',
    email: `alchemy-${Date.now()}@example.com`,
    phone_number: '+255712345111',
  });
  await createPendingPaymentRecordForBooking(bookingRecord.id, 'usdt_bep20');
  const createdOrder = await createOrderWithDepositAddressForBooking(bookingRecord.id);
  return { bookingRecord, createdOrder };
}

async function startTestApplication() {
  const expressApplication = createApplication();
  const httpServer = await new Promise((resolve) => {
    const listeningServer = expressApplication.listen(0, () => resolve(listeningServer));
  });
  const serverBaseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  return {
    serverBaseUrl,
    async close() {
      await new Promise((resolve) => httpServer.close(resolve));
    },
  };
}

async function deliverSignedWebhookRequest(serverBaseUrl, webhookPayload, {
  signingKey = TEST_WEBHOOK_SIGNING_KEY,
} = {}) {
  const rawRequestBody = JSON.stringify(webhookPayload);
  const signatureDigest = signingKey === null
    ? ''
    : computeAlchemyWebhookSignatureDigest(Buffer.from(rawRequestBody), signingKey);

  const webhookResponse = await fetch(`${serverBaseUrl}/api/webhook/alchemy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [ALCHEMY_WEBHOOK_SIGNATURE_HEADER_NAME]: signatureDigest,
    },
    body: rawRequestBody,
  });

  return {
    status: webhookResponse.status,
    body: await webhookResponse.json(),
  };
}

beforeEach(resetDatabaseState);

afterEach(() => {
  restoreEnvironment();
});

test('verifyAlchemyWebhookSignature accepts a signature computed over the exact request bytes', () => {
  applyEnvironment({
    ALCHEMY_WEBHOOK_SIGNING_KEY: TEST_WEBHOOK_SIGNING_KEY,
    USDT_CONTRACT_ADDRESS: TEST_USDT_CONTRACT_ADDRESS,
    CHAIN_ID: '56',
  });

  const rawRequestBody = Buffer.from('{"type":"ADDRESS_ACTIVITY"}');
  const signatureDigest = crypto
    .createHmac('sha256', TEST_WEBHOOK_SIGNING_KEY)
    .update(rawRequestBody)
    .digest('hex');

  assert.equal(verifyAlchemyWebhookSignature(rawRequestBody, signatureDigest), true);
  assert.equal(verifyAlchemyWebhookSignature(rawRequestBody, `${signatureDigest}0`), false);
  assert.equal(verifyAlchemyWebhookSignature(rawRequestBody, ''), false);
  assert.equal(verifyAlchemyWebhookSignature(undefined, signatureDigest), false);

  const tamperedRequestBody = Buffer.from('{"type":"ADDRESS_ACTIVITY","extra":1}');
  assert.equal(verifyAlchemyWebhookSignature(tamperedRequestBody, signatureDigest), false);
});

test('parser keeps only token transfers of the configured USDT contract', () => {
  applyEnvironment({
    USDT_CONTRACT_ADDRESS: TEST_USDT_CONTRACT_ADDRESS,
    CHAIN_ID: '56',
  });

  const depositAddress = '0x1111111111111111111111111111111111111111';
  const parsedWebhookActivity = buildObservedUsdtTransfersFromAlchemyActivityWebhookPayload(
    buildAddressActivityWebhookPayload([
      buildAlchemyTransferActivity({
        depositAddress,
        txHash: '0xaaa1',
        amountWei: 12n * 10n ** 18n,
      }),
      buildAlchemyTransferActivity({
        depositAddress,
        txHash: '0xaaa2',
        amountWei: 5n * 10n ** 18n,
        contractAddress: '0x2222222222222222222222222222222222222222',
      }),
      buildAlchemyTransferActivity({
        depositAddress,
        txHash: '0xaaa3',
        amountWei: 1n * 10n ** 18n,
        category: 'external',
      }),
      buildAlchemyTransferActivity({
        depositAddress,
        txHash: '0xaaa4',
        amountWei: 3n * 10n ** 18n,
        removed: true,
      }),
    ])
  );

  assert.equal(parsedWebhookActivity.status, ALCHEMY_WEBHOOK_STATUS_ACCEPTED);
  assert.equal(parsedWebhookActivity.parsedTransfers.length, 1);

  const [parsedTransfer] = parsedWebhookActivity.parsedTransfers;
  assert.equal(parsedTransfer.txHash, '0xaaa1');
  assert.equal(parsedTransfer.blockNumber, 500);
  assert.equal(parsedTransfer.logIndex, 3);
  assert.equal(parsedTransfer.toAddress, depositAddress);
  assert.equal(parsedTransfer.amountWei, 12n * 10n ** 18n);
  assert.equal(parsedTransfer.amountUsdt, 12);
});

test('parser ignores other webhook types, other networks and payloads with no USDT transfer', () => {
  applyEnvironment({
    USDT_CONTRACT_ADDRESS: TEST_USDT_CONTRACT_ADDRESS,
    CHAIN_ID: '56',
  });

  const depositAddress = '0x1111111111111111111111111111111111111111';

  assert.equal(
    buildObservedUsdtTransfersFromAlchemyActivityWebhookPayload(
      buildAddressActivityWebhookPayload([], { webhookType: 'NFT_ACTIVITY' })
    ).reason,
    ALCHEMY_WEBHOOK_IGNORED_UNSUPPORTED_TYPE
  );

  assert.equal(
    buildObservedUsdtTransfersFromAlchemyActivityWebhookPayload(
      buildAddressActivityWebhookPayload([], { network: 'ETH_MAINNET' })
    ).reason,
    ALCHEMY_WEBHOOK_IGNORED_UNEXPECTED_NETWORK
  );

  const noMatchingTransfer = buildObservedUsdtTransfersFromAlchemyActivityWebhookPayload(
    buildAddressActivityWebhookPayload([
      buildAlchemyTransferActivity({
        depositAddress,
        txHash: '0xbbb1',
        amountWei: 1n * 10n ** 18n,
        category: 'external',
      }),
    ])
  );
  assert.equal(noMatchingTransfer.status, ALCHEMY_WEBHOOK_STATUS_IGNORED);
  assert.equal(noMatchingTransfer.reason, ALCHEMY_WEBHOOK_IGNORED_NO_MATCHING_TRANSFERS);
});

test('webhook endpoint records a deposit once and rejects an unsigned delivery', async () => {
  applyEnvironment({
    ALCHEMY_WEBHOOK_SIGNING_KEY: TEST_WEBHOOK_SIGNING_KEY,
    USDT_CONTRACT_ADDRESS: TEST_USDT_CONTRACT_ADDRESS,
    CHAIN_ID: '56',
    ALCHEMY_WEBHOOK_ID: undefined,
    ALCHEMY_WEBHOOK_AUTH_TOKEN: undefined,
  });

  const { createdOrder } = await createOrderWithDepositAddressForTestAttendee();
  const txHash = `0x${crypto.randomBytes(32).toString('hex')}`;
  const webhookPayload = buildAddressActivityWebhookPayload([
    buildAlchemyTransferActivity({
      depositAddress: createdOrder.deposit_address,
      txHash,
      amountWei: 12n * 10n ** 18n,
    }),
  ]);

  const testApplication = await startTestApplication();
  try {
    const rejectedDelivery = await deliverSignedWebhookRequest(
      testApplication.serverBaseUrl,
      webhookPayload,
      { signingKey: 'the-wrong-signing-key' }
    );
    assert.equal(rejectedDelivery.status, 401);

    const acceptedDelivery = await deliverSignedWebhookRequest(
      testApplication.serverBaseUrl,
      webhookPayload
    );
    assert.equal(acceptedDelivery.status, 200);
    assert.equal(acceptedDelivery.body.matchedTransferCount, 1);
    assert.equal(acceptedDelivery.body.recordedTransferCount, 1);

    const depositedRowResult = await pool.query(
      'SELECT address, order_id, amount_wei, block_number FROM deposits_observed WHERE tx_hash = $1',
      [txHash]
    );
    assert.equal(depositedRowResult.rows.length, 1);
    assert.equal(depositedRowResult.rows[0].address, createdOrder.deposit_address);
    assert.equal(Number(depositedRowResult.rows[0].amount_wei), Number(12n * 10n ** 18n));

    // Alchemy retries deliveries, so the same event must not produce a second
    // deposit row.
    const repeatedDelivery = await deliverSignedWebhookRequest(
      testApplication.serverBaseUrl,
      webhookPayload
    );
    assert.equal(repeatedDelivery.status, 200);
    assert.equal(repeatedDelivery.body.recordedTransferCount, 0);

    const depositedRowCountResult = await pool.query(
      'SELECT count(*) AS deposit_count FROM deposits_observed WHERE tx_hash = $1',
      [txHash]
    );
    assert.equal(Number(depositedRowCountResult.rows[0].deposit_count), 1);
  } finally {
    await testApplication.close();
  }
});

test('webhook endpoint ignores a transfer to an address that belongs to no order', async () => {
  applyEnvironment({
    ALCHEMY_WEBHOOK_SIGNING_KEY: TEST_WEBHOOK_SIGNING_KEY,
    USDT_CONTRACT_ADDRESS: TEST_USDT_CONTRACT_ADDRESS,
    CHAIN_ID: '56',
  });

  const unknownAddress = ethers.Wallet.createRandom().address;
  const webhookPayload = buildAddressActivityWebhookPayload([
    buildAlchemyTransferActivity({
      depositAddress: unknownAddress,
      txHash: `0x${crypto.randomBytes(32).toString('hex')}`,
      amountWei: 12n * 10n ** 18n,
    }),
  ]);

  const testApplication = await startTestApplication();
  try {
    const delivery = await deliverSignedWebhookRequest(
      testApplication.serverBaseUrl,
      webhookPayload
    );
    assert.equal(delivery.status, 200);
    assert.equal(delivery.body.matchedTransferCount, 0);
  } finally {
    await testApplication.close();
  }
});
