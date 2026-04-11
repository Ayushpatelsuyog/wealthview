/**
 * Shared Mutual Fund calculations.
 * Realized P&L uses FIFO matching of sell transactions against buy lots.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTxn = Record<string, any>;

/**
 * Calculate realized P&L for a mutual fund holding using FIFO lot matching.
 *
 * For each sell/redeem transaction, match it against the earliest buy lots
 * and compute: (sell_price × qty) - (buy_price × qty) per matched unit.
 *
 * Returns total realized gain/loss across all sell transactions.
 *
 * @param transactions - All transactions for the holding (buys and sells)
 * @returns { realized: total realized P&L, realizedCostBasis: cost basis of sold units, realizedProceeds: total sell proceeds }
 */
export function calcMFRealizedPnL(transactions: AnyTxn[] | null | undefined): {
  realized: number;
  realizedCostBasis: number;
  realizedProceeds: number;
} {
  if (!transactions || transactions.length === 0) {
    return { realized: 0, realizedCostBasis: 0, realizedProceeds: 0 };
  }

  // Filter real buys (exclude split/bonus informational records) and real sells
  const buys = transactions
    .filter(t => {
      if (t.type !== 'buy' && t.type !== 'sip') return false;
      const n = (t.notes ?? '').toString().toLowerCase();
      return !n.includes('split') && !n.includes('bonus');
    })
    .sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')));

  const sells = transactions
    .filter(t => t.type === 'sell' || t.type === 'redeem')
    .sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')));

  if (sells.length === 0) {
    return { realized: 0, realizedCostBasis: 0, realizedProceeds: 0 };
  }

  // Build mutable lots array from buys
  const lots = buys.map(t => ({
    qty: Number(t.quantity) || 0,
    price: Number(t.price) || 0,
    fees: Number(t.fees) || 0,
    origQty: Number(t.quantity) || 0,
  }));

  let totalRealized = 0;
  let totalCostBasis = 0;
  let totalProceeds = 0;

  // Process each sell in chronological order, consuming lots FIFO
  for (const sell of sells) {
    let remainingToSell = Number(sell.quantity) || 0;
    const sellPrice = Number(sell.price) || 0;
    const sellFee = Number(sell.fees) || 0;

    for (const lot of lots) {
      if (remainingToSell <= 0) break;
      if (lot.qty <= 0) continue;

      const matched = Math.min(remainingToSell, lot.qty);
      // Per-unit fee allocation from the original buy transaction
      const feePerUnit = lot.origQty > 0 ? lot.fees / lot.origQty : 0;
      const costPerUnit = lot.price + feePerUnit;

      const costBasis = matched * costPerUnit;
      const proceeds = matched * sellPrice;

      totalCostBasis += costBasis;
      totalProceeds += proceeds;
      totalRealized += (proceeds - costBasis);

      lot.qty -= matched;
      remainingToSell -= matched;
    }

    // Subtract sell-side fees proportionally from realized
    totalRealized -= sellFee;
    totalProceeds -= sellFee;
  }

  return {
    realized: Math.round(totalRealized * 100) / 100,
    realizedCostBasis: Math.round(totalCostBasis * 100) / 100,
    realizedProceeds: Math.round(totalProceeds * 100) / 100,
  };
}
