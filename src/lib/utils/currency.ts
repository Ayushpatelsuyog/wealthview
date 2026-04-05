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

/**
 * Sub-unit currencies: Yahoo Finance reports prices in sub-units for some exchanges.
 * Map: sub-unit code → { major currency code, divisor }
 */
const SUB_UNIT_CURRENCIES: Record<string, { major: string; divisor: number }> = {
  GBp: { major: 'GBP', divisor: 100 },  // LSE pence → pounds
  GBx: { major: 'GBP', divisor: 100 },
  GBX: { major: 'GBP', divisor: 100 },
  ILA: { major: 'ILS', divisor: 100 },  // Tel Aviv agorot → shekel
  ZAc: { major: 'ZAR', divisor: 100 },  // JSE cents → rand
  ZAC: { major: 'ZAR', divisor: 100 },
};

/**
 * Normalize a sub-unit currency to its major unit.
 * Returns { currency, divisor } where divisor > 1 means price needs dividing.
 */
export function normalizeSubUnit(currency: string): { currency: string; divisor: number } {
  const sub = SUB_UNIT_CURRENCIES[currency];
  if (sub) return { currency: sub.major, divisor: sub.divisor };
  return { currency, divisor: 1 };
}

export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? CURRENCY_SYMBOLS[currency?.toUpperCase()] ?? currency ?? '$';
}

/**
 * Format a local-currency amount with the correct symbol.
 * Handles GBp (pence) → GBP conversion.
 */
export function fmtLocalCurrency(v: number, currency: string): string {
  const { currency: major, divisor } = normalizeSubUnit(currency);
  const sym = getCurrencySymbol(major);
  const val = v / divisor;
  return `${sym}${val.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}
