export function formatLocalPrice(priceValue) {
  if (typeof priceValue !== 'number') {
    return String(priceValue ?? '');
  }
  return priceValue.toLocaleString('en-US');
}

export function formatCryptoAmount(amountValue) {
  if (typeof amountValue === 'number') {
    return String(Math.round(amountValue * 100) / 100);
  }
  return String(amountValue ?? '');
}
