import { generateAdminSummaryReport, runReconciliationCheck } from '../services/reconciliationService.js';

async function printCliReport() {
  let summaryReport;
  try {
    summaryReport = await generateAdminSummaryReport({});
  } catch (error) {
    console.error('Could not read on-chain balances (RPC unreachable?).');
    console.error(`Reason: ${error.message}`);
    summaryReport = {
      treasuryWalletAddress: 'unknown (RPC unreachable)',
      pendingOrderCount: 0,
      paidOrderCount: 0,
      ordersAwaitingSweep: [],
      gasWalletBnbBalance: null,
      treasuryUsdtBalance: null,
    };
  }

  console.log('=== Admin Summary Report ===');
  console.log(`Treasury wallet:        ${summaryReport.treasuryWalletAddress}`);
  console.log(`Pending orders:         ${summaryReport.pendingOrderCount}`);
  console.log(`Paid orders:            ${summaryReport.paidOrderCount}`);
  console.log(`Awaiting sweep:         ${summaryReport.ordersAwaitingSweep.length}`);
  for (const awaitingOrder of summaryReport.ordersAwaitingSweep) {
    console.log(`  - order ${awaitingOrder.orderId} @ ${awaitingOrder.depositAddress} (${awaitingOrder.amountUsdt} USDT)`);
  }
  console.log(`Gas wallet BNB balance: ${summaryReport.gasWalletBnbBalance ?? 'unreachable'}`);
  console.log(`Treasury USDT balance:  ${summaryReport.treasuryUsdtBalance ?? 'unreachable'}`);

  try {
    const reconciliationResult = await runReconciliationCheck({});
    console.log('');
    console.log('=== Reconciliation ===');
    console.log(`Confirmed deposits:    ${reconciliationResult.confirmedDepositsUsdt} USDT`);
    console.log(`Treasury ledger total:  ${reconciliationResult.treasuryLedgerUsdt} USDT`);
    console.log(`On-chain treasury:      ${reconciliationResult.onChainTreasuryUsdt} USDT`);
    console.log(`Balanced:               ${reconciliationResult.balanced ? 'yes' : 'NO - MISMATCH'}`);
  } catch (error) {
    console.log('');
    console.log(`Reconciliation skipped (${error.message})`);
  }
}

printCliReport();