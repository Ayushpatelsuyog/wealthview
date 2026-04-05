/** Comprehensive currency → symbol map for display */
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',  EUR: '€',  GBP: '£',  JPY: '¥',
  CNY: '¥',  CNH: '¥',  HKD: 'HK$', AUD: 'A$',
  CAD: 'C$', CHF: 'CHF', SGD: 'S$', KRW: '₩',
  TWD: 'NT$', INR: '₹', NZD: 'NZ$', SEK: 'kr',
  NOK: 'kr', DKK: 'kr', ZAR: 'R',  BRL: 'R$',
  MXN: 'MX$', THB: '฿', MYR: 'RM', IDR: 'Rp',
  PHP: '₱',  VND: '₫', AED: 'د.إ', SAR: '﷼',
  ILS: '₪',  TRY: '₺', PLN: 'zł', CZK: 'Kč',
  HUF: 'Ft', RUB: '₽', GBp: '£',
};

export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? CURRENCY_SYMBOLS[currency?.toUpperCase()] ?? currency ?? '$';
}

/**
 * Format a local-currency amount with the correct symbol.
 * Handles GBp (pence) → GBP conversion.
 */
export function fmtLocalCurrency(v: number, currency: string): string {
  const sym = getCurrencySymbol(currency);
  const divisor = currency === 'GBp' ? 100 : 1;
  const val = v / divisor;
  return `${sym}${val.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}
