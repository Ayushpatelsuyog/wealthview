/**
 * Shared invested-INR calculation for global stocks.
 * Used by BOTH dashboard (portfolio-service.ts) and portfolio page.
 * Ensures consistent numbers across the app.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>;

interface _HoldingInput {
  quantity: number | string;
  avg_buy_price: number | string;
  metadata?: AnyRow | null;
  transactions?: AnyRow[];
}

/**
 * Calculate invested amount in INR for a global stock holding.
 *
 * Uses FIFO when possible (no splits/bonuses), falls back to
 * qty × avg_buy_price × weightedAvgFx when splits exist.
 *
 * @param h - Holding with transactions
 * @param fallbackFxRate - FX rate to use when transaction metadata has none (e.g. current rate)
 * @returns { investedLocal, investedINR }
 */
export function calcGlobalStockInvestedINR(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  h: any,
  fallbackFxRate?: number | null,
): { investedLocal: number; investedINR: number } {
  const qty = Number(h.quantity);
  const avgBuy = Number(h.avg_buy_price);
  const meta = (h.metadata ?? {}) as Record<string, unknown>;
  const metaFx = Number(meta.fx_rate ?? 0);
  const defaultFx = fallbackFxRate ?? (metaFx || 1);

  const allTxns: AnyRow[] = (h.transactions ?? []) as AnyRow[];

  const hasSplitOrBonus = allTxns.some(t => {
    const n = (t.notes ?? '').toLowerCase();
    return n.includes('split') || n.includes('bonus');
  });

  // Filter real buy transactions (exclude split/bonus informational records)
  const buyTxns = allTxns.filter(t => {
    if (t.type !== 'buy' && t.type !== 'sip') return false;
    const n = (t.notes ?? '').toLowerCase();
    return !n.includes('split') && !n.includes('bonus');
  }).sort((a, b) => String(a).localeCompare(String(b))); // date sort handled by caller if needed

  const sellTxns = allTxns.filter(t => t.type === 'sell');
  const totalSold = sellTxns.reduce((sum, t) => sum + Number(t.quantity), 0);

  let investedLocal = 0;
  let investedINR = 0;

  // Case 1: Splits/bonuses exist or no buy txns → use holding's adjusted avg_buy_price
  if (hasSplitOrBonus || buyTxns.length === 0) {
    investedLocal = qty * avgBuy;

    if (buyTxns.length > 0) {
      // Weighted average FX from buy transactions
      const totalBuyCost = buyTxns.reduce((s, t) => s + Number(t.quantity) * Number(t.price), 0);
      const totalBuyINR = buyTxns.reduce((s, t) => {
        const txFx = Number((t.metadata as Record<string, unknown>)?.fx_rate ?? defaultFx);
        return s + Number(t.quantity) * Number(t.price) * txFx;
      }, 0);
      const avgFx = totalBuyCost > 0 ? totalBuyINR / totalBuyCost : defaultFx;
      investedINR = investedLocal * avgFx;
    } else {
      investedINR = investedLocal * defaultFx;
    }
  }
  // Case 2: No splits, has buy transactions → FIFO
  else if (buyTxns.length > 0) {
    const lots = buyTxns.map(t => {
      const q = Number(t.quantity);
      return {
        qty: q,
        origQty: q,
        price: Number(t.price),
        fees: Number(t.fees) || 0,
        fxRate: Number((t.metadata as Record<string, unknown>)?.fx_rate ?? defaultFx),
      };
    });

    // FIFO: deduct sold shares from earliest lots
    let soldRemaining = totalSold;
    for (const lot of lots) {
      if (soldRemaining <= 0) break;
      const consumed = Math.min(soldRemaining, lot.qty);
      lot.qty -= consumed;
      soldRemaining -= consumed;
    }

    // Sum remaining lots
    for (const lot of lots) {
      if (lot.qty <= 0) continue;
      const feePerShare = lot.origQty > 0 ? lot.fees / lot.origQty : 0;
      const tLocal = lot.qty * lot.price + lot.qty * feePerShare;
      investedLocal += tLocal;
      investedINR += tLocal * lot.fxRate;
    }
  }

  return { investedLocal, investedINR };
}
