import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import pool from '../config/db.js';

import {
  buildUsdtTransferLogQuery,
  computeNextScanStartBlock,
  parseUsdtTransferEventLog,
  parseUsdtTransferEventLogs,
  fetchUsdtTransferEventLogsForBlockWindow,
  fetchTransferEventLogsInBlockChunks,
  matchTransfersToWatchedDepositAddresses,
  recordObservedUsdtTransfer,
  fetchTransferScanState,
  updateTransferScanStateAfterSuccessfulScan,
  updateTransferScanStateAfterFailedScan,
  dropObservedDepositsFromReorgedBlocks,
  USDT_TRANSFER_EVENT_TOPIC,
} from '../services/monitorService.js';

import { createOrderWithDepositAddressForBooking } from '../services/orderService.js';
import { createBookingRecordWithActiveSeatHold } from '../services/bookingService.js';
import { createPendingPaymentRecordForBooking } from '../services/paymentService.js';
import { DEFAULT_USDT_DECIMALS } from '../services/usdtPaymentService.js';

const MOCK_USDT_CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const PAYER_FROM_ADDRESS = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
const TRANSFER_TOPIC = USDT_TRANSFER_EVENT_TOPIC;

const previousEnvironment = {};
for (const environmentName of [
  'MONITOR_SCAN_OVERLAP_BLOCKS',
  'MONITOR_INITIAL_SCAN_LOOKBACK_BLOCKS',
  'MONITOR_LOG_SCAN_CHUNK_BLOCKS',
  'USDT_CONTRACT_ADDRESS',
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

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
  await pool.query(
    `UPDATE usdt_transfer_scan_state
        SET last_scanned_block = 0, last_finalized_block = 0, last_error = NULL, consecutive_failures = 0
      WHERE id = 1`
  );
}

function buildTransferEventLog({ blockNumber, toAddress, amountUsdt, blockHash, txHash }) {
  const usdtInterface = new ethers.Interface([
    'event Transfer(address indexed from, address indexed to, uint256 value)',
  ]);
  const encodedTransferEvent = usdtInterface.encodeEventLog('Transfer', [
    PAYER_FROM_ADDRESS,
    toAddress,
    ethers.parseUnits(String(amountUsdt), DEFAULT_USDT_DECIMALS),
  ]);
  return {
    address: MOCK_USDT_CONTRACT_ADDRESS,
    blockNumber,
    blockHash: blockHash ?? `0xblockhash${blockNumber}`,
    transactionHash: txHash ?? `0xtransfer${blockNumber}`,
    logIndex: 0,
    topics: encodedTransferEvent.topics,
    data: encodedTransferEvent.data,
  };
}

async function createOrderWithDepositAddressForTestBooking() {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Listener Test Attendee',
    email: `listener-${Date.now()}@example.com`,
    phone_number: '+255712345000',
  });
  await createPendingPaymentRecordForBooking(bookingRecord.id, 'usdt_bep20');
  const createdOrder = await createOrderWithDepositAddressForBooking(bookingRecord.id);
  return { bookingRecord, createdOrder };
}

beforeEach(resetDatabaseState);
after(() => {
  for (const [environmentName, environmentValue] of Object.entries(previousEnvironment)) {
    if (environmentValue === undefined) {
      delete process.env[environmentName];
    } else {
      process.env[environmentName] = environmentValue;
    }
  }
});

test('buildUsdtTransferLogQuery scans the token contract by Transfer topic only', () => {
  applyEnvironment({ USDT_CONTRACT_ADDRESS: MOCK_USDT_CONTRACT_ADDRESS });
  const usdtTransferLogQuery = buildUsdtTransferLogQuery(MOCK_USDT_CONTRACT_ADDRESS, 90, 100);

  assert.equal(usdtTransferLogQuery.address, MOCK_USDT_CONTRACT_ADDRESS);
  assert.equal(usdtTransferLogQuery.fromBlock, 90);
  assert.equal(usdtTransferLogQuery.toBlock, 100);
  assert.deepEqual(usdtTransferLogQuery.topics, [TRANSFER_TOPIC]);
});

test('computeNextScanStartBlock looks back over the overlap on later ticks', () => {
  applyEnvironment({ MONITOR_SCAN_OVERLAP_BLOCKS: '5' });
  assert.equal(
    computeNextScanStartBlock({ lastScannedBlock: 1000, latestBlockNumber: 1005 }),
    995
  );
});

test('computeNextScanStartBlock starts a fresh cursor from the lookback window', () => {
  applyEnvironment({ MONITOR_INITIAL_SCAN_LOOKBACK_BLOCKS: '20000' });
  assert.equal(
    computeNextScanStartBlock({ lastScannedBlock: 0, latestBlockNumber: 134_000_000 }),
    133_980_000
  );
});

test('computeNextScanStartBlock never returns a negative block on a young chain', () => {
  applyEnvironment({ MONITOR_INITIAL_SCAN_LOOKBACK_BLOCKS: '20000' });
  assert.equal(computeNextScanStartBlock({ lastScannedBlock: 0, latestBlockNumber: 40 }), 0);
});

test('parseUsdtTransferEventLog extracts the exact wei amount and the block hash', () => {
  const depositAddress = '0x7EA6489A34F7C4Aa427832DDb640Da5eB40E0191';
  const parsedTransfer = parseUsdtTransferEventLog(
    buildTransferEventLog({ blockNumber: 42, toAddress: depositAddress, amountUsdt: 1.9 })
  );

  assert.equal(parsedTransfer.blockNumber, 42);
  assert.equal(parsedTransfer.toAddress, depositAddress);
  assert.equal(parsedTransfer.fromAddress, PAYER_FROM_ADDRESS);
  assert.equal(parsedTransfer.amountUsdt, 1.9);
  assert.equal(parsedTransfer.amountWei, ethers.parseUnits('1.9', DEFAULT_USDT_DECIMALS));
  assert.equal(parsedTransfer.blockHash, '0xblockhash42');
});

test('parseUsdtTransferEventLogs drops logs that are not Transfer events', () => {
  const depositAddress = '0x7EA6489A34F7C4Aa427832DDb640Da5eB40E0191';
  const notATransferLog = {
    topics: [ethers.id('Approval(address,address,uint256)')],
    data: '0x',
    blockNumber: 7,
    blockHash: '0xdeadbeef',
    transactionHash: '0xapproval',
  };

  const parsedTransfers = parseUsdtTransferEventLogs([
    buildTransferEventLog({ blockNumber: 8, toAddress: depositAddress, amountUsdt: 3.8 }),
    notATransferLog,
  ]);

  assert.equal(parsedTransfers.length, 1);
  assert.equal(parsedTransfers[0].blockNumber, 8);
});

test('fetchTransferEventLogsInBlockChunks walks the window in provider sized chunks', async () => {
  const requestedBlockRanges = [];
  const stubProviderRecordingRanges = {
    async getLogs(usdtTransferLogQuery) {
      requestedBlockRanges.push([usdtTransferLogQuery.fromBlock, usdtTransferLogQuery.toBlock]);
      return [];
    },
  };

  const usdtTransferLogQuery = buildUsdtTransferLogQuery(MOCK_USDT_CONTRACT_ADDRESS, 90, 1005);
  const collectedEventLogs = await fetchTransferEventLogsInBlockChunks(
    stubProviderRecordingRanges,
    usdtTransferLogQuery,
    500
  );

  assert.deepEqual(requestedBlockRanges, [
    [90, 589],
    [590, 1005],
  ]);
  assert.equal(collectedEventLogs.length, 0);
});

test('fetchUsdtTransferEventLogsForBlockWindow issues one query when chunking is off', async () => {
  applyEnvironment({
    USDT_CONTRACT_ADDRESS: MOCK_USDT_CONTRACT_ADDRESS,
    MONITOR_LOG_SCAN_CHUNK_BLOCKS: undefined,
  });

  let getLogsCallCount = 0;
  const stubProviderCountingCalls = {
    async getLogs() {
      getLogsCallCount += 1;
      return [];
    },
  };

  await fetchUsdtTransferEventLogsForBlockWindow(stubProviderCountingCalls, 100, 200);
  assert.equal(getLogsCallCount, 1);
});

test('a transfer to a known deposit address is matched to its order', async () => {
  const { createdOrder } = await createOrderWithDepositAddressForTestBooking();

  const matchedTransfers = await matchTransfersToWatchedDepositAddresses([
    {
      txHash: '0xknownaddress',
      blockNumber: 10,
      blockHash: '0xabc',
      logIndex: 0,
      fromAddress: PAYER_FROM_ADDRESS,
      toAddress: createdOrder.deposit_address,
      amountWei: ethers.parseUnits('3.8', DEFAULT_USDT_DECIMALS),
      amountUsdt: 3.8,
    },
    {
      txHash: '0xstranger',
      blockNumber: 10,
      blockHash: '0xabc',
      logIndex: 1,
      fromAddress: PAYER_FROM_ADDRESS,
      toAddress: '0x000000000000000000000000000000000000dEaD',
      amountWei: ethers.parseUnits('3.8', DEFAULT_USDT_DECIMALS),
      amountUsdt: 3.8,
    },
  ]);

  assert.equal(matchedTransfers.length, 1);
  assert.equal(matchedTransfers[0].depositAddressRecord.order_id, createdOrder.id);
});

test('recording the same transfer twice keeps a single observed deposit row', async () => {
  const { createdOrder } = await createOrderWithDepositAddressForTestBooking();
  const watchedAddressResult = await pool.query(
    'SELECT id, order_id, address FROM deposit_addresses WHERE order_id = $1',
    [createdOrder.id]
  );
  const depositAddressRecord = watchedAddressResult.rows[0];

  const matchedTransfer = {
    depositAddressRecord,
    parsedTransfer: {
      txHash: '0xduplicatedtransfer',
      blockNumber: 55,
      blockHash: '0xblock55',
      logIndex: 0,
      fromAddress: PAYER_FROM_ADDRESS,
      toAddress: createdOrder.deposit_address,
      amountWei: ethers.parseUnits('3.8', DEFAULT_USDT_DECIMALS),
      amountUsdt: 3.8,
    },
  };

  const firstRecord = await recordObservedUsdtTransfer(matchedTransfer);
  const secondRecord = await recordObservedUsdtTransfer(matchedTransfer);

  assert.ok(firstRecord, 'the first observation is stored');
  assert.equal(secondRecord, null, 'a replayed transfer is not stored twice');

  const observedDepositResult = await pool.query(
    'SELECT amount, amount_wei, block_hash FROM deposits_observed WHERE tx_hash = $1',
    ['0xduplicatedtransfer']
  );
  assert.equal(observedDepositResult.rows.length, 1);
  assert.equal(observedDepositResult.rows[0].block_hash, '0xblock55');
});

test('a deposit from a replaced block is dropped before it can be confirmed', async () => {
  const { createdOrder } = await createOrderWithDepositAddressForTestBooking();
  await pool.query(
    `INSERT INTO deposits_observed
       (address, tx_hash, from_address, amount, amount_wei, block_number, block_hash, order_id)
     VALUES ($1, '0xreorgedtransfer', $2, 3.80, $3, 900, '0xorphanedblockhash', $4)`,
    [
      createdOrder.deposit_address,
      PAYER_FROM_ADDRESS,
      ethers.parseUnits('3.8', DEFAULT_USDT_DECIMALS).toString(),
      createdOrder.id,
    ]
  );

  const providerWithoutThatBlock = {
    async getBlock() {
      return null;
    },
  };

  const droppedDeposits = await dropObservedDepositsFromReorgedBlocks(providerWithoutThatBlock);

  assert.equal(droppedDeposits.length, 1);
  const remainingDepositResult = await pool.query(
    'SELECT count(*)::INT AS remaining FROM deposits_observed WHERE tx_hash = $1',
    ['0xreorgedtransfer']
  );
  assert.equal(remainingDepositResult.rows[0].remaining, 0);
});

test('a deposit whose block is still canonical is kept', async () => {
  const { createdOrder } = await createOrderWithDepositAddressForTestBooking();
  await pool.query(
    `INSERT INTO deposits_observed
       (address, tx_hash, from_address, amount, amount_wei, block_number, block_hash, order_id)
     VALUES ($1, '0xcanonicaltransfer', $2, 3.80, $3, 900, '0xcanonicalblockhash', $4)`,
    [
      createdOrder.deposit_address,
      PAYER_FROM_ADDRESS,
      ethers.parseUnits('3.8', DEFAULT_USDT_DECIMALS).toString(),
      createdOrder.id,
    ]
  );

  const providerWithThatBlock = {
    async getBlock(blockNumber) {
      return { number: blockNumber, hash: '0xcanonicalblockhash' };
    },
  };

  const droppedDeposits = await dropObservedDepositsFromReorgedBlocks(providerWithThatBlock);

  assert.equal(droppedDeposits.length, 0);
  const keptDepositResult = await pool.query(
    'SELECT count(*)::INT AS remaining FROM deposits_observed WHERE tx_hash = $1',
    ['0xcanonicaltransfer']
  );
  assert.equal(keptDepositResult.rows[0].remaining, 1);
});

test('the scan cursor advances monotonically and survives a failure', async () => {
  await updateTransferScanStateAfterSuccessfulScan({
    scannedToBlock: 1000,
    finalizedBlockNumber: 998,
  });
  await updateTransferScanStateAfterSuccessfulScan({
    scannedToBlock: 900,
    finalizedBlockNumber: 899,
  });

  let scanState = await fetchTransferScanState();
  assert.equal(scanState.lastScannedBlock, 1000);
  assert.equal(scanState.lastFinalizedBlock, 998);

  await updateTransferScanStateAfterFailedScan('rate limited');
  scanState = await fetchTransferScanState();
  assert.equal(scanState.consecutiveFailures, 1);

  await updateTransferScanStateAfterSuccessfulScan({
    scannedToBlock: 1001,
    finalizedBlockNumber: 999,
  });
  scanState = await fetchTransferScanState();
  assert.equal(scanState.consecutiveFailures, 0);
  assert.equal(scanState.lastScannedBlock, 1001);
});
