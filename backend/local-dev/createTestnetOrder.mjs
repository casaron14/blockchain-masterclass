import '../config/environment.js';

const { createBookingRecordWithActiveSeatHold } = await import('../services/bookingService.js');
const { createPendingPaymentRecordForBooking } = await import('../services/paymentService.js');
const { createOrderWithDepositAddressForBooking } = await import('../services/orderService.js');
const { TICKET_PRICE_USDT } = await import('../services/eventConfigService.js');
const pool = (await import('../config/db.js')).default;

const attendeeFullName = process.argv[2] || 'Testnet Attendee';
const attendeeEmailAddress =
  process.argv[3] || `testnet-${Date.now()}@example.com`;
const attendeePhoneNumber = process.argv[4] || '+255712345678';

const bookingRecord = await createBookingRecordWithActiveSeatHold({
  full_name: attendeeFullName,
  email: attendeeEmailAddress,
  phone_number: attendeePhoneNumber,
});

const paymentRecord = await createPendingPaymentRecordForBooking(bookingRecord.id, 'usdt_bep20');
const createdOrder = await createOrderWithDepositAddressForBooking(bookingRecord.id);

console.log(`Booking ${bookingRecord.id} created for ${attendeeEmailAddress}`);
console.log(`Order   ${createdOrder.id} status=${createdOrder.status}`);
console.log(`Payment ${paymentRecord.id} status=${paymentRecord.status} expected=${paymentRecord.amount_expected}`);
console.log(`Ticket price to send: ${TICKET_PRICE_USDT} of the testnet token at ${process.env.USDT_CONTRACT_ADDRESS}`);
console.log('');
console.log(`Send the payment to this deposit address:`);
console.log(`  ${createdOrder.deposit_address}`);
console.log('');
console.log(`Pay it with: npm run testnet:pay -- ${createdOrder.deposit_address}`);

await pool.end();
process.exit(0);
