/**
 * Format MF units to 3 decimal places with consistent rounding.
 *
 * JavaScript's Number.toFixed() uses IEEE 754 "round half to even" which
 * can produce unexpected results: (142.7275).toFixed(3) = "142.727" instead of "142.728".
 *
 * This helper uses Math.round() first (which rounds 0.5 up), then toFixed() for padding.
 */
export function fmtUnits(n: number | string): string {
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (!isFinite(num)) return '0.000';
  return (Math.round(num * 1000) / 1000).toFixed(3);
}
