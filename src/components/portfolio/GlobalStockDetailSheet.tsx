'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import {
  TrendingUp, TrendingDown, X, ChevronDown, ChevronUp, Loader2,
  BarChart3, Plus, Trash2, RefreshCw, AlertCircle, Pencil, Tag,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';
import { CountryFlag } from '@/components/shared/CountryFlag';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Transaction {
  id: string;
  date: string;
  price: number;
  quantity: number;
  type: string;
  fees: number;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface ConsolidatedEntry {
  id: string;
  quantity: number;
  portfolioName: string;
  brokerName: string;
}

export interface GlobalStockHoldingDetail {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  avg_buy_price: number;
  metadata: Record<string, unknown>;
  transactions: Transaction[];
  portfolios: { id: string; name: string; type: string; user_id: string; family_id: string } | null;
  brokers: { id: string; name: string; platform_type: string } | null;
  investedValue: number;
  currentValue: number | null;
  gainLoss: number | null;
  gainLossPct: number | null;
  currentPrice: number | null;
  currency: string;
  country: string;
  fxRate: number | null;
  investedINR: number;
  currentValueINR: number | null;
  _consolidatedEntries?: ConsolidatedEntry[];
}

// ─── Country flags ────────────────────────────────────────────────────────────

const COUNTRY_FLAG: Record<string, string> = {
  US: '🇺🇸', UK: '🇬🇧', DE: '🇩🇪', FR: '🇫🇷',
  JP: '🇯🇵', HK: '🇭🇰', AU: '🇦🇺', SG: '🇸🇬',
  CA: '🇨🇦', CH: '🇨🇭', CN: '🇨🇳', KR: '🇰🇷',
  NL: '🇳🇱', SE: '🇸🇪', IT: '🇮🇹', ES: '🇪🇸',
  IE: '🇮🇪', BR: '🇧🇷', AE: '🇦🇪', IN: '🇮🇳',
};

function countryFlag(code: string): string {
  return COUNTRY_FLAG[code] ?? '🌍';
}

// ─── Transaction config ──────────────────────────────────────────────────────

const TXN_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  buy:      { label: 'Buy',      bg: 'rgba(27,42,74,0.10)',   text: '#1B2A4A' },
  sell:     { label: 'Sell',     bg: 'rgba(220,38,38,0.10)',  text: '#DC2626' },
  dividend: { label: 'Dividend', bg: 'rgba(5,150,105,0.10)',  text: '#059669' },
  sip:      { label: 'Buy',     bg: 'rgba(59,130,246,0.12)', text: '#2563EB' },
};

function txnLabel(txn: Transaction): string {
  const notes = txn.notes?.toLowerCase() ?? '';
  if (notes.includes('bonus'))  return 'Bonus';
  if (notes.includes('split'))  return 'Split';
  if (notes.includes('rights')) return 'Rights';
  if (notes.includes('merger'))   return 'Merger';
  if (notes.includes('demerger')) return 'Demerger';
  if (notes.includes('buyback'))  return 'Buyback';
  return TXN_CONFIG[txn.type]?.label ?? txn.type;
}
function txnBg(txn: Transaction): string {
  const notes = txn.notes?.toLowerCase() ?? '';
  if (notes.includes('bonus'))  return 'rgba(201,168,76,0.12)';
  if (notes.includes('split'))  return 'rgba(99,102,241,0.10)';
  if (notes.includes('rights')) return 'rgba(46,139,139,0.10)';
  if (notes.includes('merger'))   return 'rgba(147,51,234,0.10)';
  if (notes.includes('demerger')) return 'rgba(147,51,234,0.10)';
  if (notes.includes('buyback'))  return 'rgba(234,88,12,0.10)';
  return TXN_CONFIG[txn.type]?.bg ?? 'var(--wv-border)';
}
function txnColor(txn: Transaction): string {
  const notes = txn.notes?.toLowerCase() ?? '';
  if (notes.includes('bonus'))  return '#C9A84C';
  if (notes.includes('split'))  return '#4338CA';
  if (notes.includes('rights')) return '#2E8B8B';
  if (notes.includes('merger'))   return '#7C3AED';
  if (notes.includes('demerger')) return '#7C3AED';
  if (notes.includes('buyback'))  return '#EA580C';
  return TXN_CONFIG[txn.type]?.text ?? '#6B7280';
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

import { fmtLocalCurrency } from '@/lib/utils/currency';
const fmtLocal = fmtLocalCurrency;

function holdingPeriodStr(buyDate: string): string {
  const ms = Date.now() - new Date(buyDate).getTime();
  const days = Math.floor(ms / (1000 * 86400));
  if (days < 30)  return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}m`;
  const yrs = Math.floor(days / 365);
  const rem = Math.floor((days % 365) / 30);
  return rem > 0 ? `${yrs}y ${rem}m` : `${yrs}y`;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface GlobalStockDetailSheetProps {
  holding: GlobalStockHoldingDetail | null;
  open: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
  onRefreshPrice?: (symbol: string) => void;
  onHoldingChanged?: () => void;
}

export function GlobalStockDetailSheet({
  holding, open, onClose, onDelete, onRefreshPrice, onHoldingChanged,
}: GlobalStockDetailSheetProps) {
  const router    = useRouter();
  const supabase  = createClient();
  const [showAllTxns, setShowAllTxns] = useState(false);
  const [deleting,    setDeleting]    = useState<string | null>(null);
  const [editingSector, setEditingSector] = useState(false);
  const [sectorValue, setSectorValue] = useState('');
  const [entryPickerAction, setEntryPickerAction] = useState<string | null>(null);

  const SECTORS = ['Technology', 'Healthcare', 'Finance', 'Consumer', 'Energy', 'Materials',
    'Industrials', 'Communication', 'Real Estate', 'Utilities', 'ETF', 'Semiconductors',
    'Software', 'E-Commerce', 'Automotive', 'Aerospace', 'Pharmaceuticals', 'Biotech',
    'Banking', 'Insurance', 'Mining', 'Oil & Gas', 'Renewable Energy', 'Other'];

  async function saveSector(newSector: string) {
    if (!holding) return;
    const meta = { ...(holding.metadata ?? {}), sector: newSector };
    await supabase.from('holdings').update({ metadata: meta }).eq('id', holding.id);
    setEditingSector(false);
    onHoldingChanged?.();
  }

  const sorted: Transaction[] = useMemo(
    () => [...(holding?.transactions ?? [])].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [holding?.transactions]
  );

  const visible = showAllTxns ? sorted : sorted.slice(0, 5);

  async function deleteTxn(txn: Transaction) {
    if (!holding) return;
    if (!confirm(`Delete this ${txnLabel(txn)} transaction?`)) return;
    setDeleting(txn.id);
    try {
      const res = await fetch(
        `/api/stocks/global/delete-transaction?txn_id=${txn.id}&holding_id=${holding.id}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.holdingDeleted) {
        onClose();
        onDelete(holding.id);
      } else {
        onHoldingChanged?.();
      }
    } catch (e) {
      alert((e as Error).message);
    }
    setDeleting(null);
  }

  if (!holding) return null;

  const isConsolidated = holding.id.startsWith('consolidated:');
  const currency       = holding.currency;
  const fxRate         = holding.fxRate ?? 1;  // current FX rate
  const investedLocal  = holding.investedValue;  // includes fees in local currency
  const investedINR    = holding.investedINR;     // includes fees, uses purchase-time FX rates
  const currentLocal   = holding.currentValue ?? investedLocal;
  const currentINR     = holding.currentValueINR ?? investedINR;
  const exchange       = String(holding.metadata?.exchange ?? '');
  const country        = holding.country;

  // Local currency return (stock movement only, no FX impact)
  const localGainLoss  = currentLocal - investedLocal;
  const localGainPct   = investedLocal > 0 ? (localGainLoss / investedLocal) * 100 : 0;

  // INR return (includes FX impact — independently calculated)
  const gainLossINR    = currentINR - investedINR;
  const gainLossPct    = investedINR > 0 ? (gainLossINR / investedINR) * 100 : 0;
  const isGain         = gainLossINR >= 0;

  // Stock P&L at current FX (no FX impact included)
  const localGainINR   = localGainLoss * fxRate;

  // ── Realized P&L from sell transactions ─────────────────────────────────────
  const sellTxns = (holding.transactions ?? []).filter(t => t.type === 'sell');
  const totalSoldQty = sellTxns.reduce((s, t) => s + Number(t.quantity), 0);
  let realizedPnlLocal = 0;
  let totalSaleValueLocal = 0;

  for (const t of sellTxns) {
    const metaMatch = (t.notes ?? '').match(/meta:(\{[^}]+\})/);
    if (metaMatch) {
      try {
        const meta = JSON.parse(metaMatch[1]);
        realizedPnlLocal += meta.pnl_local ?? 0;
      } catch { /* skip */ }
    }
    totalSaleValueLocal += Number(t.quantity) * Number(t.price);
  }

  // FIFO cost of sold shares
  const buyTxnsSorted = [...(holding.transactions ?? [])]
    .filter(t => t.type === 'buy' || t.type === 'sip')
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  let totalSaleCostLocal = 0;
  let tempSold = totalSoldQty;
  for (const t of buyTxnsSorted) {
    if (tempSold <= 0) break;
    const fromLot = Math.min(tempSold, Number(t.quantity));
    totalSaleCostLocal += fromLot * Number(t.price);
    tempSold -= fromLot;
  }

  // Fallback if no metadata
  if (realizedPnlLocal === 0 && totalSoldQty > 0) {
    realizedPnlLocal = totalSaleValueLocal - totalSaleCostLocal;
  }
  const hasSells = totalSoldQty > 0;

  // ── FIFO lot tracking for FX impact (unrealized vs realized) ──────────────
  const fifoLots = buyTxnsSorted.map(t => ({
    date: t.date,
    qty: Number(t.quantity),
    remainingQty: Number(t.quantity),
    priceLocal: Number(t.price),
    fxRate: Number((t.metadata as Record<string, unknown>)?.fx_rate ?? fxRate),
  }));

  // Allocate sells to buy lots (FIFO) to compute realized FX
  let realizedFxPnl = 0;
  const sellTxnsSorted = [...sellTxns].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const realizedFxDetails: { sellDate: string; sellQty: number; sellFx: number; avgBuyFx: number; fxGain: number }[] = [];

  for (const sell of sellTxnsSorted) {
    let sellQty = Number(sell.quantity);
    const sellFx = Number((sell.metadata as Record<string, unknown>)?.fx_rate ?? fxRate);
    let sellFxGain = 0;
    let weightedBuyFx = 0;
    let totalAllocated = 0;

    for (const lot of fifoLots) {
      if (sellQty <= 0) break;
      if (lot.remainingQty <= 0) continue;
      const allocated = Math.min(sellQty, lot.remainingQty);
      const fxGain = allocated * lot.priceLocal * (sellFx - lot.fxRate);
      realizedFxPnl += fxGain;
      sellFxGain += fxGain;
      weightedBuyFx += lot.fxRate * allocated;
      totalAllocated += allocated;
      lot.remainingQty -= allocated;
      sellQty -= allocated;
    }

    if (totalAllocated > 0) {
      realizedFxDetails.push({
        sellDate: sell.date,
        sellQty: totalAllocated,
        sellFx,
        avgBuyFx: weightedBuyFx / totalAllocated,
        fxGain: sellFxGain,
      });
    }
  }

  // Unrealized FX = remaining lots only
  let unrealizedFxPnl = 0;
  const unrealizedFxDetails: { date: string; qty: number; remainingQty: number; priceLocal: number; purchaseFx: number; fxGain: number }[] = [];
  for (const lot of fifoLots) {
    if (lot.remainingQty > 0) {
      const fxGain = lot.remainingQty * lot.priceLocal * (fxRate - lot.fxRate);
      unrealizedFxPnl += fxGain;
      unrealizedFxDetails.push({
        date: lot.date, qty: lot.qty, remainingQty: lot.remainingQty,
        priceLocal: lot.priceLocal, purchaseFx: lot.fxRate, fxGain,
      });
    }
  }
  const totalFxImpact = unrealizedFxPnl + realizedFxPnl;

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 overflow-y-auto"
        style={{ backgroundColor: 'var(--wv-surface-2)', border: 'none' }}>

        {/* Header */}
        <div className="sticky top-0 z-10 px-5 py-4 flex items-start gap-3"
          style={{ backgroundColor: '#1B2A4A' }}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold text-white truncate">{holding.name}</h2>
              <span className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                style={{ backgroundColor: 'rgba(255,255,255,0.15)', color: 'white' }}>
                {holding.symbol}
              </span>
              {isConsolidated && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                  style={{ backgroundColor: 'rgba(201,168,76,0.25)', color: '#F6E27A' }}>
                  Consolidated
                </span>
              )}
              {exchange && (
                <span className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: '#A0AEC0' }}>
                  {exchange}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-xs flex items-center gap-1" style={{ color: '#A0AEC0' }}>
                <CountryFlag country={country} size={14} /> {country}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                style={{ backgroundColor: 'rgba(37,99,235,0.15)', color: '#93C5FD' }}>
                {currency}
              </span>
              {/* Editable sector */}
              {editingSector ? (
                <select
                  autoFocus
                  value={sectorValue}
                  onChange={e => { const v = e.target.value; setSectorValue(v); saveSector(v); }}
                  onBlur={() => setEditingSector(false)}
                  className="h-5 text-[10px] rounded px-1 border-none outline-none"
                  style={{ backgroundColor: 'rgba(255,255,255,0.15)', color: 'white' }}>
                  <option value="" style={{ color: 'var(--wv-text)' }}>Select…</option>
                  {SECTORS.map(s => <option key={s} value={s} style={{ color: 'var(--wv-text)' }}>{s}</option>)}
                </select>
              ) : String(holding.metadata?.sector ?? '') ? (
                <button
                  onClick={() => { setSectorValue(String(holding.metadata?.sector ?? '')); setEditingSector(true); }}
                  className="text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1 transition-colors hover:bg-white/20"
                  style={{ backgroundColor: 'rgba(201,168,76,0.20)', color: '#F6E27A' }}>
                  <Tag className="w-2.5 h-2.5" />{String(holding.metadata?.sector ?? '')}
                  <Pencil className="w-2 h-2 opacity-50" />
                </button>
              ) : (
                <button
                  onClick={() => { setSectorValue(''); setEditingSector(true); }}
                  className="text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1 transition-colors hover:bg-white/20"
                  style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>
                  <Plus className="w-2.5 h-2.5" />Add Sector
                </button>
              )}
            </div>
            {/* Live price */}
            {holding.currentPrice ? (
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-lg font-bold text-white">
                  {fmtLocal(holding.currentPrice, currency)}
                </span>
                <span className="text-xs text-white/60">
                  ₹{(holding.currentPrice * fxRate).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                </span>
                <span className="text-xs font-medium flex items-center gap-0.5"
                  style={{ color: isGain ? '#6EE7B7' : '#FCA5A5' }}>
                  {isGain ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {isGain ? '+' : ''}{gainLossPct.toFixed(2)}%
                </span>
              </div>
            ) : null}
          </div>
          <div className="flex gap-1">
            {onRefreshPrice && (
              <button onClick={() => onRefreshPrice(holding.symbol)}
                className="p-1.5 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
                <RefreshCw className="w-3.5 h-3.5 text-white/70" />
              </button>
            )}
            <button onClick={onClose}
              className="p-1.5 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
              <X className="w-3.5 h-3.5 text-white/70" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">

          {/* Position details */}
          <div className="wv-card p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--wv-text-muted)' }}>Position Details</p>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Shares Held', value: Number(holding.quantity).toLocaleString('en-IN', { maximumFractionDigits: 4 }) },
                { label: `Avg Price (${currency})`, value: fmtLocal(Number(holding.avg_buy_price), currency) },
                { label: 'FX Rate', value: `1 ${currency} = ₹${fxRate.toFixed(4)}` },
                { label: 'Broker', value: holding.brokers?.name ?? '—' },
                { label: 'Portfolio', value: holding.portfolios?.name ?? '—' },
                { label: 'Country', value: `${countryFlag(country)} ${country}` },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>{label}</p>
                  <p className="text-xs font-bold mt-0.5" style={{ color: 'var(--wv-text)' }}>{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Unrealized P&L */}
          <div className="wv-card p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--wv-text-muted)' }}>
              Unrealized P&L
              <span className="normal-case font-normal ml-1">({Number(holding.quantity).toLocaleString('en-IN', { maximumFractionDigits: 0 })} shares remaining)</span>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>Cost Basis ({currency})</p>
                <p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{fmtLocal(investedLocal, currency)}</p>
              </div>
              <div>
                <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>Cost Basis (INR)</p>
                <p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(investedINR)}</p>
              </div>
              <div>
                <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>Current Value ({currency})</p>
                <p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{fmtLocal(currentLocal, currency)}</p>
              </div>
              <div>
                <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>Current Value (INR)</p>
                <p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(currentINR)}</p>
              </div>
              <div>
                <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>Unrealized P&L ({currency})</p>
                <p className="text-xs font-bold" style={{ color: localGainLoss >= 0 ? '#059669' : '#DC2626' }}>
                  {localGainLoss >= 0 ? '+' : ''}{fmtLocal(localGainLoss, currency)} ({localGainPct >= 0 ? '+' : ''}{localGainPct.toFixed(1)}%)
                </p>
              </div>
              <div>
                <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>Unrealized P&L (INR)</p>
                <p className="text-xs font-bold" style={{ color: gainLossINR >= 0 ? '#059669' : '#DC2626' }}>
                  {gainLossINR >= 0 ? '+' : ''}{formatLargeINR(gainLossINR)} ({gainLossPct >= 0 ? '+' : ''}{gainLossPct.toFixed(1)}%)
                </p>
              </div>
            </div>
          </div>

          {/* Realized P&L (only if sells exist) */}
          {hasSells && (
            <div className="wv-card p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--wv-text-muted)' }}>
                Realized P&L
                <span className="normal-case font-normal ml-1">({totalSoldQty.toLocaleString('en-IN', { maximumFractionDigits: 0 })} shares sold)</span>
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>Sale Value ({currency})</p>
                  <p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{fmtLocal(totalSaleValueLocal, currency)}</p>
                </div>
                <div>
                  <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>Cost of Sold ({currency})</p>
                  <p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{fmtLocal(totalSaleCostLocal, currency)}</p>
                </div>
                <div>
                  <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>Realized Stock P&L ({currency})</p>
                  <p className="text-xs font-bold" style={{ color: realizedPnlLocal >= 0 ? '#059669' : '#DC2626' }}>
                    {realizedPnlLocal >= 0 ? '+' : ''}{fmtLocal(realizedPnlLocal, currency)}
                  </p>
                </div>
                <div>
                  <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>Realized FX Impact (INR)</p>
                  <p className="text-xs font-bold" style={{ color: realizedFxPnl >= 0 ? '#059669' : '#DC2626' }}>
                    {realizedFxPnl >= 0 ? '+' : ''}{formatLargeINR(realizedFxPnl)}
                  </p>
                </div>
                <div className="col-span-2 pt-1" style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                  <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>Total Realized P&L (INR)</p>
                  <p className="text-xs font-bold" style={{ color: (realizedPnlLocal * fxRate + realizedFxPnl) >= 0 ? '#059669' : '#DC2626' }}>
                    {(realizedPnlLocal * fxRate + realizedFxPnl) >= 0 ? '+' : ''}{formatLargeINR(realizedPnlLocal * fxRate + realizedFxPnl)}
                    <span className="text-[10px] font-normal ml-1" style={{ color: 'var(--wv-text-muted)' }}>
                      = Stock ({realizedPnlLocal >= 0 ? '+' : ''}{fmtLocal(realizedPnlLocal, currency)}) + FX ({realizedFxPnl >= 0 ? '+' : ''}{formatLargeINR(realizedFxPnl)})
                    </span>
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Total P&L (if sells exist) */}
          {hasSells && (() => {
            const totalStockLocal = localGainLoss + realizedPnlLocal;
            const totalInrPnl = localGainLoss * fxRate + unrealizedFxPnl + realizedPnlLocal * fxRate + realizedFxPnl;
            return (
              <div className="wv-card p-3" style={{ backgroundColor: 'rgba(201,168,76,0.06)' }}>
                <p className="text-[9px] font-semibold uppercase tracking-widest text-center mb-2" style={{ color: 'var(--wv-text-muted)' }}>Total P&L (Unrealized + Realized)</p>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div>
                    <p className="text-[9px]" style={{ color: 'var(--wv-text-secondary)' }}>Total Stock P&L ({currency})</p>
                    <p className="text-sm font-bold" style={{ color: totalStockLocal >= 0 ? '#059669' : '#DC2626' }}>
                      {totalStockLocal >= 0 ? '+' : ''}{fmtLocal(totalStockLocal, currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px]" style={{ color: 'var(--wv-text-secondary)' }}>Total FX Impact (INR)</p>
                    <p className="text-sm font-bold" style={{ color: totalFxImpact >= 0 ? '#059669' : '#DC2626' }}>
                      {totalFxImpact >= 0 ? '+' : ''}{formatLargeINR(totalFxImpact)}
                    </p>
                  </div>
                </div>
                <div className="mt-2 pt-2 text-center" style={{ borderTop: '1px solid rgba(201,168,76,0.15)' }}>
                  <p className="text-[9px]" style={{ color: 'var(--wv-text-secondary)' }}>Total P&L (INR)</p>
                  <p className="text-base font-bold" style={{ color: totalInrPnl >= 0 ? '#059669' : '#DC2626' }}>
                    {totalInrPnl >= 0 ? '+' : ''}{formatLargeINR(totalInrPnl)}
                  </p>
                  <p className="text-[9px] mt-0.5" style={{ color: 'var(--wv-text-muted)' }}>
                    Unrealized ({(localGainLoss * fxRate + unrealizedFxPnl) >= 0 ? '+' : ''}{formatLargeINR(localGainLoss * fxRate + unrealizedFxPnl)})
                    {' + '}Realized ({(realizedPnlLocal * fxRate + realizedFxPnl) >= 0 ? '+' : ''}{formatLargeINR(realizedPnlLocal * fxRate + realizedFxPnl)})
                  </p>
                </div>
              </div>
            );
          })()}

          {/* Returns card */}
          <div className="wv-card p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--wv-text-muted)' }}>
              Unrealized Returns Breakdown
            </p>
            {/* Two-column: Local Currency | INR */}
            <div className="grid grid-cols-2 gap-3">
              {/* Local Currency column */}
              <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(27,42,74,0.04)', border: '1px solid rgba(27,42,74,0.10)' }}>
                <p className="text-[10px] font-bold mb-2" style={{ color: 'var(--wv-text)' }}>
                  Local ({currency})
                </p>
                <div className="space-y-1.5">
                  <div>
                    <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>Invested</p>
                    <p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{fmtLocal(investedLocal, currency)}</p>
                  </div>
                  <div>
                    <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>Current Value</p>
                    <p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{fmtLocal(currentLocal, currency)}</p>
                  </div>
                  <div>
                    <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>P&L</p>
                    <p className="text-xs font-bold" style={{ color: localGainLoss >= 0 ? '#059669' : '#DC2626' }}>
                      {localGainLoss >= 0 ? '+' : ''}{fmtLocal(localGainLoss, currency)}
                      <span className="text-[10px] font-medium ml-1">
                        ({localGainPct >= 0 ? '+' : ''}{localGainPct.toFixed(1)}%)
                      </span>
                    </p>
                  </div>
                </div>
              </div>

              {/* INR column */}
              <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(201,168,76,0.04)', border: '1px solid rgba(201,168,76,0.12)' }}>
                <p className="text-[10px] font-bold mb-2" style={{ color: '#C9A84C' }}>
                  INR (after FX)
                </p>
                <div className="space-y-1.5">
                  <div>
                    <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>Invested</p>
                    <p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(investedINR)}</p>
                  </div>
                  <div>
                    <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>Current Value</p>
                    <p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(currentINR)}</p>
                  </div>
                  <div>
                    <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>P&L</p>
                    <p className="text-xs font-bold" style={{ color: gainLossINR >= 0 ? '#059669' : '#DC2626' }}>
                      {gainLossINR >= 0 ? '+' : ''}{formatLargeINR(gainLossINR)}
                      <span className="text-[10px] font-medium ml-1">
                        ({gainLossPct >= 0 ? '+' : ''}{gainLossPct.toFixed(1)}%)
                      </span>
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* FX Impact row */}
            {(() => {
              const avgBuyFxRemaining = unrealizedFxDetails.length > 0
                ? unrealizedFxDetails.reduce((s, d) => s + d.purchaseFx * d.remainingQty, 0) / unrealizedFxDetails.reduce((s, d) => s + d.remainingQty, 0)
                : (investedLocal > 0 ? investedINR / investedLocal : fxRate);
              const fxChangePct = avgBuyFxRemaining > 0 ? ((fxRate - avgBuyFxRemaining) / avgBuyFxRemaining) * 100 : 0;
              return (
                <div className="mt-3 p-3 rounded-xl" style={{ backgroundColor: unrealizedFxPnl >= 0 ? 'rgba(5,150,105,0.04)' : 'rgba(220,38,38,0.04)', border: `1px solid ${unrealizedFxPnl >= 0 ? 'rgba(5,150,105,0.10)' : 'rgba(220,38,38,0.10)'}` }}>
                  <p className="text-[10px] font-bold mb-2" style={{ color: unrealizedFxPnl >= 0 ? '#059669' : '#DC2626' }}>
                    Unrealized FX Impact <span className="font-normal">(remaining shares)</span>
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>Avg Purchase FX</p>
                      <p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>₹{avgBuyFxRemaining.toFixed(2)}/{currency}</p>
                    </div>
                    <div>
                      <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>Current FX Rate</p>
                      <p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>₹{fxRate.toFixed(2)}/{currency}</p>
                    </div>
                    <div>
                      <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>Unrealized FX</p>
                      <p className="text-xs font-bold" style={{ color: unrealizedFxPnl >= 0 ? '#059669' : '#DC2626' }}>
                        {unrealizedFxPnl >= 0 ? '+' : ''}{formatLargeINR(unrealizedFxPnl)}
                        <span className="text-[10px] font-medium ml-1">({fxChangePct >= 0 ? '+' : ''}{fxChangePct.toFixed(2)}%)</span>
                      </p>
                    </div>
                  </div>
                  {/* Per-lot unrealized FX breakdown */}
                  {unrealizedFxDetails.length > 1 && (
                    <div className="mt-2 pt-2 space-y-1" style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                      <p className="text-[9px] font-semibold" style={{ color: 'var(--wv-text-muted)' }}>Per-Lot FX (remaining shares)</p>
                      {unrealizedFxDetails.map((d, i) => (
                        <div key={i} className="flex items-center justify-between text-[10px]">
                          <span style={{ color: 'var(--wv-text-secondary)' }}>
                            {fmtDate(d.date)} · {d.remainingQty}{d.remainingQty < d.qty ? `/${d.qty}` : ''} @ ₹{d.purchaseFx.toFixed(2)}/{currency}
                          </span>
                          <span className="font-medium" style={{ color: d.fxGain >= 0 ? '#059669' : '#DC2626' }}>
                            {d.fxGain >= 0 ? '+' : ''}{formatLargeINR(d.fxGain)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Realized FX breakdown */}
                  {realizedFxDetails.length > 0 && (
                    <div className="mt-2 pt-2 space-y-1" style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                      <p className="text-[9px] font-semibold" style={{ color: 'var(--wv-text-muted)' }}>Realized FX (sold shares)</p>
                      {realizedFxDetails.map((d, i) => (
                        <div key={i} className="flex items-center justify-between text-[10px]">
                          <span style={{ color: 'var(--wv-text-secondary)' }}>
                            {fmtDate(d.sellDate)} · Sold {d.sellQty} · Buy FX ₹{d.avgBuyFx.toFixed(2)} → Sell FX ₹{d.sellFx.toFixed(2)}
                          </span>
                          <span className="font-medium" style={{ color: d.fxGain >= 0 ? '#059669' : '#DC2626' }}>
                            {d.fxGain >= 0 ? '+' : ''}{formatLargeINR(d.fxGain)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Total FX summary */}
                  {hasSells && (
                    <div className="mt-2 pt-2 flex justify-between text-[10px]" style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                      <span className="font-semibold" style={{ color: 'var(--wv-text-muted)' }}>Total FX Impact</span>
                      <span className="font-bold" style={{ color: totalFxImpact >= 0 ? '#059669' : '#DC2626' }}>
                        {totalFxImpact >= 0 ? '+' : ''}{formatLargeINR(totalFxImpact)}
                      </span>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Total P&L summary */}
            <div className="mt-2 p-2 rounded-lg text-center" style={{ backgroundColor: 'rgba(201,168,76,0.06)' }}>
              <p className="text-[10px]" style={{ color: 'var(--wv-text-secondary)' }}>
                Unrealized INR P&L:{' '}
                <span className="font-bold" style={{ color: gainLossINR >= 0 ? '#059669' : '#DC2626' }}>
                  {gainLossINR >= 0 ? '+' : ''}{formatLargeINR(gainLossINR)}
                </span>
                {' '}= Stock ({localGainINR >= 0 ? '+' : ''}{formatLargeINR(localGainINR)}) + FX ({unrealizedFxPnl >= 0 ? '+' : ''}{formatLargeINR(unrealizedFxPnl)})
              </p>
            </div>
          </div>

          {/* Transaction history */}
          <div className="wv-card">
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#F0EDE6' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>
                Transaction History
                <span className="ml-2 text-[10px] font-normal" style={{ color: 'var(--wv-text-muted)' }}>
                  {sorted.length} record{sorted.length !== 1 ? 's' : ''}
                </span>
              </p>
              <BarChart3 className="w-3.5 h-3.5" style={{ color: 'var(--wv-text-muted)' }} />
            </div>

            {sorted.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <AlertCircle className="w-5 h-5 mx-auto mb-2" style={{ color: 'var(--wv-text-muted)' }} />
                <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>No transactions yet</p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: '#F7F5F0' }}>
                {(() => {
                  let running = 0;
                  const withBalance = [...sorted].reverse().map(t => {
                    const sign = t.type === 'sell' ? -1 : 1;
                    running += sign * Number(t.quantity);
                    return { ...t, _runningBalance: running };
                  }).reverse();

                  return visible.map(t => {
                    const wb     = withBalance.find(x => x.id === t.id);
                    const label  = txnLabel(t);
                    const bg     = txnBg(t);
                    const color  = txnColor(t);
                    const amtLocal = Number(t.quantity) * Number(t.price);
                    const txnFx  = (t.metadata as Record<string, unknown>)?.fx_rate ? Number((t.metadata as Record<string, unknown>).fx_rate) : fxRate;
                    const amtINR = amtLocal * txnFx;
                    const isBonus = label === 'Bonus';
                    return (
                      <div key={t.id} className="px-4 py-3 flex items-start gap-3 hover:bg-white/50 transition-colors group">
                        <div className="flex-shrink-0 mt-0.5">
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap"
                            style={{ backgroundColor: bg, color }}>
                            {label}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>
                              {Number(t.quantity).toLocaleString('en-IN', { maximumFractionDigits: 4 })} shares
                            </span>
                            {!isBonus && Number(t.price) > 0 && (
                              <span className="text-[10px]" style={{ color: 'var(--wv-text-secondary)' }}>
                                @ {fmtLocal(Number(t.price), currency)}
                              </span>
                            )}
                          </div>
                          <div className="flex items-baseline gap-2 mt-0.5 flex-wrap">
                            {amtLocal > 0 && !isBonus && (
                              <>
                                <span className="text-[10px] font-medium" style={{ color: 'var(--wv-text)' }}>
                                  {fmtLocal(amtLocal, currency)}
                                </span>
                                <span className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                                  ≈ {formatLargeINR(amtINR)}
                                </span>
                              </>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{fmtDate(t.date)}</span>
                            {Number(t.fees) > 0 && (
                              <span className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                                fees: {fmtLocal(Number(t.fees), currency)}
                              </span>
                            )}
                            {wb && (
                              <span className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                                bal: {wb._runningBalance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                              </span>
                            )}
                            {label === 'Buy' && (
                              <span className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                                held: {holdingPeriodStr(t.date)}
                              </span>
                            )}
                            <span className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                              FX: {txnFx.toFixed(2)}
                            </span>
                            {isConsolidated && (t as unknown as { _portfolioName?: string })._portfolioName && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(201,168,76,0.10)', color: '#C9A84C' }}>
                                {(t as unknown as { _portfolioName: string })._portfolioName}
                              </span>
                            )}
                          </div>
                          {t.notes && !t.notes.startsWith('Buy') && !t.notes.startsWith('Sell at') && !t.notes.includes('meta:') && (
                            <p className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--wv-text-muted)' }}>{t.notes}</p>
                          )}
                          {t.type === 'sell' && (() => {
                            const metaMatch = (t.notes ?? '').match(/meta:(\{[^}]+\})/);
                            let pnl: number | null = null;
                            if (metaMatch) { try { pnl = JSON.parse(metaMatch[1]).pnl_local ?? null; } catch { /* skip */ } }
                            if (pnl == null) return null;
                            return (
                              <p className="text-[10px] font-semibold mt-0.5" style={{ color: pnl >= 0 ? '#059669' : '#DC2626' }}>
                                Realized: {pnl >= 0 ? '+' : ''}{fmtLocal(pnl, currency)}
                              </p>
                            );
                          })()}
                        </div>
                        {!isConsolidated && (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-blue-50 transition-all"
                              onClick={() => {
                                if (holding.portfolios) {
                                  sessionStorage.setItem('wv_prefill_family', holding.portfolios.family_id);
                                  sessionStorage.setItem('wv_prefill_member', holding.portfolios.user_id);
                                  sessionStorage.setItem('wv_prefill_active', 'true');
                                }
                                onClose();
                                router.push(`/add-assets/global-stocks?edit_txn=${t.id}&holding_id=${holding.id}`);
                              }}
                              title="Edit transaction">
                              <Pencil className="w-3 h-3" style={{ color: '#3B82F6' }} />
                            </button>
                            <button
                              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 transition-all"
                              onClick={() => deleteTxn(t)}
                              disabled={deleting === t.id}
                              title="Delete transaction">
                              {deleting === t.id
                                ? <Loader2 className="w-3 h-3 animate-spin" style={{ color: '#DC2626' }} />
                                : <Trash2 className="w-3 h-3" style={{ color: '#DC2626' }} />}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            )}

            {sorted.length > 5 && (
              <button
                onClick={() => setShowAllTxns(!showAllTxns)}
                className="w-full px-4 py-2.5 text-[11px] font-medium flex items-center justify-center gap-1 border-t"
                style={{ borderColor: '#F0EDE6', color: 'var(--wv-text-secondary)' }}>
                {showAllTxns
                  ? <><ChevronUp className="w-3 h-3" /> Show less</>
                  : <><ChevronDown className="w-3 h-3" /> Show all {sorted.length} transactions</>}
              </button>
            )}
          </div>

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-2">
            {(() => {
              const h = holding!;
              const entries = h._consolidatedEntries;
              function navTo(url: string) {
                if (h.portfolios?.family_id) sessionStorage.setItem('wv_prefill_family', h.portfolios.family_id);
                if (h.portfolios?.user_id) sessionStorage.setItem('wv_prefill_member', h.portfolios.user_id);
                if (h.portfolios?.family_id || h.portfolios?.user_id) sessionStorage.setItem('wv_prefill_active', 'true');
                onClose();
                router.push(url);
              }
              function handleAction(action: string) {
                if (isConsolidated && entries && entries.length > 1) {
                  setEntryPickerAction(action);
                } else {
                  const hid = entries?.[0]?.id ?? h.id;
                  navTo(`/add-assets/global-stocks?${action}=${hid}`);
                }
              }
              return (<>
            <Button
              className="h-9 text-xs gap-1.5"
              style={{ backgroundColor: '#1B2A4A', color: 'white' }}
              onClick={() => handleAction('add_to')}>
              <Plus className="w-3.5 h-3.5" />Add More Shares
            </Button>
            <Button variant="outline" className="h-9 text-xs gap-1.5"
              style={{ borderColor: 'var(--wv-border)', color: 'var(--wv-text-secondary)' }}
              onClick={() => handleAction('sell')}>
              Sell / Exit
            </Button>
            <Button variant="outline" className="h-9 text-xs gap-1.5"
              style={{ borderColor: 'var(--wv-border)', color: 'var(--wv-text-secondary)' }}
              onClick={() => handleAction('dividend')}>
              Record Dividend
            </Button>
              </>);
            })()}
            {!isConsolidated && (
              <Button variant="outline" className="h-9 text-xs gap-1.5"
                style={{ borderColor: 'rgba(220,38,38,0.2)', color: '#DC2626' }}
                onClick={() => { if (confirm('Delete this holding and all its transactions?')) { onDelete(holding.id); onClose(); } }}>
                <Trash2 className="w-3.5 h-3.5" />Delete
              </Button>
            )}
          </div>

          {/* Entry picker for consolidated actions */}
          {entryPickerAction && holding._consolidatedEntries && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
              style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
              onClick={() => setEntryPickerAction(null)}>
              <div className="w-full max-w-sm rounded-2xl p-5 shadow-xl"
                style={{ backgroundColor: 'var(--wv-surface)' }}
                onClick={e => e.stopPropagation()}>
                <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--wv-text)' }}>
                  {entryPickerAction === 'sell' ? 'Sell from which holding?' : entryPickerAction === 'add_to' ? 'Add shares to which holding?' : 'Record for which holding?'}
                </h3>
                <p className="text-xs mb-4" style={{ color: 'var(--wv-text-muted)' }}>{holding.name} ({holding.symbol})</p>
                <div className="space-y-2">
                  {holding._consolidatedEntries.map(entry => (
                    <button
                      key={entry.id}
                      className="w-full flex items-center gap-3 p-3 rounded-xl border transition-colors hover:bg-[#FAFAF8]"
                      style={{ borderColor: 'var(--wv-border)' }}
                      onClick={() => {
                        setEntryPickerAction(null);
                        if (holding.portfolios?.family_id) sessionStorage.setItem('wv_prefill_family', holding.portfolios.family_id);
                        if (holding.portfolios?.user_id) sessionStorage.setItem('wv_prefill_member', holding.portfolios.user_id);
                        if (holding.portfolios?.family_id || holding.portfolios?.user_id) sessionStorage.setItem('wv_prefill_active', 'true');
                        onClose();
                        router.push(`/add-assets/global-stocks?${entryPickerAction}=${entry.id}`);
                      }}>
                      <div className="flex-1 text-left">
                        <p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{entry.portfolioName}</p>
                        <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{entry.brokerName} · {entry.quantity.toLocaleString('en-IN', { maximumFractionDigits: 4 })} shares</p>
                      </div>
                    </button>
                  ))}
                </div>
                <Button variant="outline" className="w-full h-9 text-xs mt-3" onClick={() => setEntryPickerAction(null)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
