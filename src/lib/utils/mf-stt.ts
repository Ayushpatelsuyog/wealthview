/**
 * MF STT (Securities Transaction Tax) constants and helpers.
 *
 * STT on mutual fund redemptions:
 * - Rate: 0.001% (multiplier 0.00001) on equity-oriented MF sell value
 * - Applies only to equity-oriented funds (>65% equity allocation)
 * - Does NOT apply to debt, liquid, gilt, international FoFs, commodity, etc.
 * - Effective from 1 Oct 2004; rate reduced from 0.025% to 0.001% on 1 Oct 2024.
 */

/** STT rate for equity-oriented mutual fund redemptions: 0.001% */
export const STT_RATE_EQUITY_MF = 0.00001;

/**
 * Determine if a fund category is equity-oriented for STT purposes.
 *
 * Returns true for categories where the fund is expected to have >65% equity allocation.
 *
 * NOTE: Index/ETF is excluded because the category is ambiguous — could be an equity
 * index fund (Nifty 50 ETF) or a debt/gold ETF. If subcategories are added later
 * (e.g., "Equity Index", "Debt ETF", "Gold ETF"), revisit this gating.
 */
export function isEquityOrientedForSTT(category: string | null | undefined): boolean {
  if (!category) return false;
  const equityCategories = new Set([
    'Equity',
    'ELSS',
    'Hybrid',
    'Sectoral/Thematic',
    'Arbitrage',
  ]);
  return equityCategories.has(category);
}
