import { generateAdminSummaryReport } from '../services/adminSummaryReportService.js';

async function printCliReport() {
  const summaryReport = await generateAdminSummaryReport({});

  console.log('=== Admin Summary Report ===');
  console.log(`Pending orders:         ${summaryReport.pendingOrderCount}`);
  console.log(`Paid orders:            ${summaryReport.paidOrderCount}`);
}

printCliReport().catch((error) => {
  console.error(`Could not generate the admin summary report: ${error.message}`);
  process.exitCode = 1;
});
