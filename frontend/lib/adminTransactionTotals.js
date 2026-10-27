// Sums the money that has actually been collected, split by currency.
//
// Payments store different units: Lipa Namba and AzamPesa amounts are TZS while
// USDT (BEP20) payments are crypto. Adding those into one number would be
// meaningless, so the transaction screen shows one total per currency. Only
// confirmed payments count as collected.

export function buildCollectedAmountTotals(transactionRows, options) {
  const {
    localCurrencyCode,
    cryptoCurrencyCode,
    cryptoPaymentMethod,
  } = options;

  const totalAmountByCurrencyCode = new Map();
  const currencyCodes = [...new Set([localCurrencyCode, cryptoCurrencyCode])];
  currencyCodes.forEach((currencyCode) => {
    totalAmountByCurrencyCode.set(currencyCode, 0);
  });

  transactionRows.forEach((transactionRow) => {
    if (transactionRow.payment_status !== 'confirmed') {
      return;
    }

    const isCryptoPayment =
      transactionRow.payment_method === cryptoPaymentMethod;
    const currencyCode = isCryptoPayment
      ? cryptoCurrencyCode
      : localCurrencyCode;
    const collectedAmount = Number(
      isCryptoPayment
        ? transactionRow.amount_usdt ?? transactionRow.amount_expected
        : transactionRow.amount_expected
    );

    if (!Number.isFinite(collectedAmount)) {
      return;
    }

    totalAmountByCurrencyCode.set(
      currencyCode,
      totalAmountByCurrencyCode.get(currencyCode) + collectedAmount
    );
  });

  return currencyCodes.map((currencyCode) => ({
    currencyCode,
    totalAmount: totalAmountByCurrencyCode.get(currencyCode),
  }));
}
