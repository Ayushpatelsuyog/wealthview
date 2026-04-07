// ─── IB Activity Statement CSV Parser ────────────────────────────────────────
// Parses Interactive Brokers Activity Statement CSV exports into structured data.

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IBAccount {
  name: string;
  account: string;
  baseCurrency: string;
}

export interface IBTrade {
  symbol: string;
  currency: string;
  date: string;       // YYYY-MM-DD
  type: 'buy' | 'sell';
  quantity: number;    // always positive
  price: number;
  commission: number;  // always positive (abs of fee)
  proceeds: number;    // abs value
  realizedPnl: number;
}

export interface IBHolding {
  symbol: string;
  name: string;
  currency: string;
  totalBought: number;
  totalSold: number;
  netQuantity: number;
  avgBuyPrice: number;
  totalInvested: number;
  totalCommissions: number;
  totalRealizedPnl: number;
  trades: IBTrade[];
}

export interface IBDividend {
  symbol: string;
  currency: string;
  date: string;
  amount: number;
  description: string;
}

export interface IBWithholdingTax {
  symbol: string;
  currency: string;
  date: string;
  amount: number;
  description: string;
}

export interface IBCorporateAction {
  type: 'merger' | 'split' | 'spinoff' | 'other';
  date: string;
  description: string;
  oldSymbol: string;
  oldQty: number;
  newSymbol: string;
  newQty: number;
  currency: string;
}

export interface IBParseSummary {
  totalTrades: number;
  totalStockTrades: number;
  uniqueSymbols: number;
  currencies: string[];
  totalDividends: number;
  totalWithholdingTax: number;
  totalCorporateActions: number;
}

export interface IBParseResult {
  account: IBAccount;
  trades: IBTrade[];
  holdings: IBHolding[];
  dividends: IBDividend[];
  withholdingTax: IBWithholdingTax[];
  corporateActions: IBCorporateAction[];
  summary: IBParseSummary;
}

// ─── IB to Yahoo Finance Symbol Mapping ──────────────────────────────────────

const IB_TO_YAHOO: Record<string, (symbol: string) => string> = {
  'USD': (s) => s,
  'CAD': (s) => s + '.TO',
  'GBP': (s) => s + '.L',
  'EUR': (s) => s + '.DE',
  'CHF': (s) => s + '.SW',
  'HKD': (s) => {
    // HK stocks: pad to 4 digits
    const num = s.replace(/^0+/, '');
    return num.padStart(4, '0') + '.HK';
  },
  'CNH': (s) => {
    if (s.startsWith('000') || s.startsWith('002') || s.startsWith('300')) return s + '.SZ';
    if (s.startsWith('600') || s.startsWith('601') || s.startsWith('603')) return s + '.SS';
    return s;
  },
  'AUD': (s) => s + '.AX',
};

export function ibSymbolToYahoo(ibSymbol: string, currency: string): string {
  const mapper = IB_TO_YAHOO[currency];
  return mapper ? mapper(ibSymbol) : ibSymbol;
}

// ─── CSV Parsing Helpers ─────────────────────────────────────────────────────

/** Parse a CSV line handling quoted fields (IB uses quotes around date/time fields with commas) */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/** Parse IB date/time format "YYYY-MM-DD, HH:MM:SS" → "YYYY-MM-DD" */
function parseIBDate(dateStr: string): string {
  // Handle "2025-04-07, 09:30:15" → "2025-04-07"
  const cleaned = dateStr.replace(/"/g, '').trim();
  const match = cleaned.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : cleaned;
}

/** Extract symbol from dividend description: "COPX(US22099X1028) Cash Dividend..." → "COPX" */
function parseSymbolFromDescription(desc: string): string {
  const match = desc.match(/^([A-Za-z0-9.]+)\s*\(/);
  return match ? match[1] : desc.split(' ')[0];
}

// ─── Main Parser ─────────────────────────────────────────────────────────────

export function parseIBActivityStatement(csvText: string): IBParseResult {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);

  const account: IBAccount = { name: '', account: '', baseCurrency: 'USD' };
  const trades: IBTrade[] = [];
  const dividends: IBDividend[] = [];
  const withholdingTax: IBWithholdingTax[] = [];
  const corporateActions: IBCorporateAction[] = [];

  for (const line of lines) {
    const cols = parseCSVLine(line);
    if (cols.length < 3) continue;

    const section = cols[0];
    const rowType = cols[1];

    // ── Account Information ──
    if (section === 'Account Information' && rowType === 'Data') {
      const field = cols[2];
      const value = cols[3] || '';
      if (field === 'Name') account.name = value;
      else if (field === 'Account') account.account = value;
      else if (field === 'Base Currency') account.baseCurrency = value;
    }

    // ── Trades ──
    // Filter: Trades, Data, Order, Stocks
    if (section === 'Trades' && rowType === 'Data' && cols[2] === 'Order' && cols[3] === 'Stocks') {
      const currency = cols[4] || 'USD';
      const symbol = cols[5] || '';
      const dateTime = cols[6] || '';
      const rawQty = parseFloat(cols[7]) || 0;
      const tradePrice = parseFloat(cols[8]) || 0;
      const commFee = parseFloat(cols[10]) || 0;      // negative in CSV
      const realizedPnl = parseFloat(cols[13]) || 0;

      if (!symbol || rawQty === 0) continue;

      const tradeDate = parseIBDate(dateTime);
      const isBuy = rawQty > 0;
      const absQty = Math.abs(rawQty);
      const proceeds = Math.abs(absQty * tradePrice);

      trades.push({
        symbol,
        currency,
        date: tradeDate,
        type: isBuy ? 'buy' : 'sell',
        quantity: absQty,
        price: tradePrice,
        commission: Math.abs(commFee),
        proceeds,
        realizedPnl,
      });
    }

    // ── Dividends ──
    if (section === 'Dividends' && rowType === 'Data') {
      // Skip total rows
      const currency = cols[2] || '';
      if (currency === 'Total' || currency.startsWith('Total in')) continue;

      const date = cols[3] || '';
      const description = cols[4] || '';
      const amount = parseFloat(cols[5]) || 0;
      const symbol = parseSymbolFromDescription(description);

      dividends.push({ symbol, currency, date, amount, description });
    }

    // ── Withholding Tax ──
    if (section === 'Withholding Tax' && rowType === 'Data') {
      const currency = cols[2] || '';
      if (currency === 'Total' || currency.startsWith('Total in')) continue;

      const date = cols[3] || '';
      const description = cols[4] || '';
      const amount = parseFloat(cols[5]) || 0;
      const symbol = parseSymbolFromDescription(description);

      withholdingTax.push({ symbol, currency, date, amount, description });
    }

    // ── Corporate Actions ──
    if (section === 'Corporate Actions' && rowType === 'Data' && cols[2] === 'Stocks') {
      const currency = cols[3] || 'USD';
      const date = parseIBDate(cols[4] || '');
      const dateTime = cols[5] || '';
      const description = cols[6] || '';
      const qty = parseFloat(cols[7]) || 0;

      // Parse symbol from description: "DVS(CA2568277834) Merged..."
      const descSymbol = parseSymbolFromDescription(description);

      // Determine type
      let actionType: IBCorporateAction['type'] = 'other';
      if (description.includes('Merged') || description.includes('Merger') || description.includes('Acquisition')) {
        actionType = 'merger';
      } else if (description.includes('Split')) {
        actionType = 'split';
      } else if (description.includes('Spinoff') || description.includes('Spin-off')) {
        actionType = 'spinoff';
      }

      corporateActions.push({
        type: actionType,
        date: date || parseIBDate(dateTime),
        description,
        oldSymbol: qty < 0 ? descSymbol : '',
        oldQty: qty < 0 ? qty : 0,
        newSymbol: qty > 0 ? descSymbol : '',
        newQty: qty > 0 ? qty : 0,
        currency,
      });
    }
  }

  // ── Group trades into holdings ──
  const holdingsMap = new Map<string, IBHolding>();

  for (const trade of trades) {
    const key = `${trade.symbol}__${trade.currency}`;
    let holding = holdingsMap.get(key);
    if (!holding) {
      holding = {
        symbol: trade.symbol,
        name: trade.symbol, // Will be enriched later
        currency: trade.currency,
        totalBought: 0,
        totalSold: 0,
        netQuantity: 0,
        avgBuyPrice: 0,
        totalInvested: 0,
        totalCommissions: 0,
        totalRealizedPnl: 0,
        trades: [],
      };
      holdingsMap.set(key, holding);
    }

    holding.trades.push(trade);
    holding.totalCommissions += trade.commission;

    if (trade.type === 'buy') {
      holding.totalBought += trade.quantity;
      holding.totalInvested += trade.quantity * trade.price;
    } else {
      holding.totalSold += trade.quantity;
      holding.totalRealizedPnl += trade.realizedPnl;
    }
  }

  // Calculate net quantity and avg buy price for each holding
  const holdings = Array.from(holdingsMap.values()).map(h => {
    h.netQuantity = h.totalBought - h.totalSold;
    h.avgBuyPrice = h.totalBought > 0 ? h.totalInvested / h.totalBought : 0;

    // Sort trades by date
    h.trades.sort((a, b) => a.date.localeCompare(b.date));

    // Recalculate avg buy price using FIFO for remaining shares
    if (h.totalSold > 0 && h.netQuantity > 0) {
      const buyTrades = h.trades.filter(t => t.type === 'buy').sort((a, b) => a.date.localeCompare(b.date));
      let consumed = h.totalSold;
      let remainingCost = 0;
      let remainingQty = 0;

      for (const bt of buyTrades) {
        const toConsume = Math.min(bt.quantity, consumed);
        const kept = bt.quantity - toConsume;
        if (kept > 0) {
          remainingCost += kept * bt.price;
          remainingQty += kept;
        }
        consumed -= toConsume;
        if (consumed <= 0) {
          // Include rest of buys fully
          const idx = buyTrades.indexOf(bt);
          for (let i = idx + 1; i < buyTrades.length; i++) {
            remainingCost += buyTrades[i].quantity * buyTrades[i].price;
            remainingQty += buyTrades[i].quantity;
          }
          break;
        }
      }

      if (remainingQty > 0) {
        h.avgBuyPrice = remainingCost / remainingQty;
        h.totalInvested = remainingCost;
      }
    }

    return h;
  });

  // Sort holdings: active (netQty > 0) first, then by symbol
  holdings.sort((a, b) => {
    if (a.netQuantity > 0 && b.netQuantity <= 0) return -1;
    if (a.netQuantity <= 0 && b.netQuantity > 0) return 1;
    return a.symbol.localeCompare(b.symbol);
  });

  // ── Build summary ──
  const currencies = Array.from(new Set(trades.map(t => t.currency))).sort();
  const totalDividends = dividends.reduce((s, d) => s + d.amount, 0);
  const totalWht = withholdingTax.reduce((s, w) => s + w.amount, 0);

  const summary: IBParseSummary = {
    totalTrades: trades.length,
    totalStockTrades: trades.length,
    uniqueSymbols: holdings.length,
    currencies,
    totalDividends: Math.round(totalDividends * 100) / 100,
    totalWithholdingTax: Math.round(totalWht * 100) / 100,
    totalCorporateActions: corporateActions.length,
  };

  return { account, trades, holdings, dividends, withholdingTax, corporateActions, summary };
}
