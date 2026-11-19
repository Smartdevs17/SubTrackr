/** Shared invoice formatting so PDFs, email and API representations agree. */
export function formatMoney(amount: number, currency: string, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale || 'en-US', {
    style: 'currency',
    currency: (currency || 'USD').toUpperCase(),
    currencyDisplay: 'symbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function formatDate(value: string, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale || 'en-US').format(new Date(value));
}
