'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import {
  TrendingUp, TrendingDown, X, ChevronDown, ChevronUp, Loader2,
  BarChart3, Plus, Trash2, RefreshCw, AlertCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Transaction {
  id: string;
  date: string;
  price: number;
  quantity: number;
  type: string;
  fees: number;
  notes?: string;
}

export interface StockHoldingDetail {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  avg_buy_price: number;
  metadata: Record<string, unknown>;
  portfolios: { id: string; name: string; type: string; user_id: string } | null;
  brokers: { id: string; name: string; platform_type: string } | null;
  transactions: Transaction[];
  currentPrice: number | null;
  priceLoading: boolean;
  investedValue: number;
  currentValue: number | null;
  gainLoss: number | null;
  gainLossPct: number | null;
  xirr: number | null;
  memberName: string;
}

// ─── Transaction config ────────────────────────────────────────────────────────

const TXN_CONFIG: Record<string, { label: string; bg: string; text: string; sign: number }> = {
  buy:      { label: 'Buy',      bg: 'rgba(27,42,74,0.10)',   text: '#1B2A4A', sign:  1 },
  sell:     { label: 'Sell',     bg: 'rgba(220,38,38,0.10)',  text: '#DC2626', sign: -1 },
  dividend: { label: 'Dividend', bg: 'rgba(5,150,105,0.10)',  text: '#059669', sign:  1 },
  sip:      { label: 'Buy',      bg: 'rgba(59,130,246,0.12)', text: '#2563EB', sign:  1 },
};

function txnLabel(txn: Transaction): string {
  const notes = txn.notes?.toLowerCase() ?? '';
  if (notes.includes('bonus'))  return 'Bonus';
  if (notes.includes('split'))  return 'Split';
  if (notes.includes('rights')) return 'Rights';
  return TXN_CONFIG[txn.type]?.label ?? txn.type;
}
function txnBg(txn: Transaction): string {
  const notes = txn.notes?.toLowerCase() ?? '';
  if (notes.includes('bonus'))  return 'rgba(201,168,76,0.12)';
  if (notes.includes('split'))  return 'rgba(99,102,241,0.10)';
  if (notes.includes('rights')) return 'rgba(46,139,139,0.10)';
  return TXN_CONFIG[txn.type]?.bg ?? '#F3F4F6';
}
function txnColor(txn: Transaction): string {
  const notes = txn.notes?.toLowerCase() ?? '';
  if (notes.includes('bonus'))  return '#C9A84C';
  if (notes.includes('split'))  return '#4338CA';
  if (notes.includes('rights')) return '#2E8B8B';
  return TXN_CONFIG[txn.type]?.text ?? '#6B7280';
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function holdingPeriodStr(buyDate: string): string {
  const ms = Date.now() - new Date(buyDate).getTime();
  const days = Math.floor(ms / (1000 * 86400));
  if (days < 30)  return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}m`;
  const yrs = Math.floor(days / 365);
  const rem = Math.floor((days % 365) / 30);
  return rem > 0 ? `${yrs}y ${rem}m` : `${yrs}y`;
}

// ─── STCG / LTCG split from buy lots ─────────────────────────────────────────

function computeTaxSplit(transactions: Transaction[]) {
  const buyLots = transactions
    .filter(t => (t.type === 'buy' || t.type === 'sip') && Number(t.quantity) > 0)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const now = new Date();
  let stcgQty = 0, ltcgQty = 0;
  let stcgInvested = 0, ltcgInvested = 0;

  for (const lot of buyLots) {
    const msPerYear = 365.25 * 24 * 3600 * 1000;
    const yearsHeld = (now.getTime() - new Date(lot.date).getTime()) / msPerYear;
    if (yearsHeld >= 1) {
      ltcgQty      += Number(lot.quantity);
      ltcgInvested += Number(lot.quantity) * Number(lot.price);
    } else {
      stcgQty      += Number(lot.quantity);
      stcgInvested += Number(lot.quantity) * Number(lot.price);
    }
  }

  return { stcgQty, ltcgQty, stcgInvested, ltcgInvested };
}

// ─── Component ────────────────────────────────────────────────────────────────

interface StockDetailSheetProps {
  holding: StockHoldingDetail | null;
  open: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
  onRefreshPrice?: (symbol: string) => void;
}

export function StockDetailSheet({
  holding, open, onClose, onDelete, onRefreshPrice,
}: StockDetailSheetProps) {
  const router   = useRouter();
  const _supabase = createClient();
  const [showAllTxns, setShowAllTxns] = useState(false);
  const [deleting,    setDeleting]    = useState<string | null>(null);

  const sorted: Transaction[] = useMemo(
    () => [...(holding?.transactions ?? [])].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [holding?.transactions]
  );

  const visible = showAllTxns ? sorted : sorted.slice(0, 5);

  const taxSplit: { stcgQty: number; ltcgQty: number; stcgInvested: number; ltcgInvested: number } | null
    = holding ? computeTaxSplit(holding.transactions) : null;

  async function deleteTxn(txn: Transaction) {
    if (!holding) return;
    if (!confirm(`Delete this ${txnLabel(txn)} transaction?`)) return;
    setDeleting(txn.id);
    try {
      const res = await fetch(
        `/api/stocks/delete-transaction?txn_id=${txn.id}&holding_id=${holding.id}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.holdingDeleted) {
        onClose();
        onDelete(holding.id);
      } else {
        // Remove from local transactions
        holding.transactions = holding.transactions.filter(t => t.id !== txn.id);
      }
    } catch (e) {
      alert((e as Error).message);
    }
    setDeleting(null);
  }

  if (!holding) return null;

  const investedValue  = holding.investedValue;
  const currentValue   = holding.currentValue ?? investedValue;
  const gainLoss       = holding.gainLoss ?? 0;
  const gainLossPct    = holding.gainLossPct ?? 0;
  const isGain         = gainLoss >= 0;
  const sector         = String(holding.metadata?.sector ?? '');
  const demat          = String(holding.metadata?.demat ?? '');
  const isin           = String(holding.metadata?.isin ?? '');
  const exchange       = String(holding.metadata?.exchange ?? 'NSE');
  const bseCode        = taxSplit !== null && holding.metadata?.bse_code != null
    ? String(holding.metadata.bse_code) : '';

  return (
    <Sheet open={open} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 overflow-y-auto"
        style={{ backgroundColor: '#F7F5F0', border: 'none' }}>

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
              <span className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: '#A0AEC0' }}>
                {exchange}
              </span>
            </div>
            {sector && (
              <p className="text-xs mt-0.5" style={{ color: '#A0AEC0' }}>{sector}</p>
            )}
            {/* Live price */}
            {holding.priceLoading ? (
              <div className="flex items-center gap-1 mt-1">
                <Loader2 className="w-3 h-3 animate-spin text-white/60" />
                <span className="text-[10px] text-white/60">Fetching price…</span>
              </div>
            ) : holding.currentPrice ? (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-lg font-bold text-white">
                  ₹{holding.currentPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
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

          {/* Summary stats */}
          <div className="wv-card p-4 grid grid-cols-2 gap-4">
            {[
              { label: 'Invested',     value: formatLargeINR(investedValue) },
              { label: 'Current Value',value: formatLargeINR(currentValue) },
              { label: 'P&L',
                value: `${isGain ? '+' : ''}${formatLargeINR(gainLoss)}`,
                color: isGain ? '#059669' : '#DC2626' },
              { label: 'Returns',
                value: `${isGain ? '+' : ''}${gainLossPct.toFixed(2)}%`,
                color: isGain ? '#059669' : '#DC2626' },
              { label: 'Shares Held',  value: Number(holding.quantity).toLocaleString('en-IN', { maximumFractionDigits: 4 }) },
              { label: 'Avg Buy Price',value: `₹${Number(holding.avg_buy_price).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` },
              { label: 'Broker',       value: holding.brokers?.name ?? '—' },
              { label: 'Portfolio',    value: holding.portfolios?.name ?? '—' },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <p className="text-[10px]" style={{ color: '#9CA3AF' }}>{label}</p>
                <p className="text-sm font-bold mt-0.5" style={{ color: color ?? '#1A1A2E' }}>{value}</p>
              </div>
            ))}
          </div>

          {taxSplit !== null && (taxSplit.stcgQty > 0 || taxSplit.ltcgQty > 0) ? (
            <div className="wv-card p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: '#9CA3AF' }}>
                Tax Position
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.12)' }}>
                  <p className="text-[10px] font-bold" style={{ color: '#DC2626' }}>STCG (&lt;1 yr)</p>
                  <p className="text-sm font-bold mt-1" style={{ color: '#1A1A2E' }}>
                    {taxSplit.stcgQty.toLocaleString('en-IN')} shares
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: '#9CA3AF' }}>
                    Cost: {formatLargeINR(taxSplit.stcgInvested)}
                  </p>
                </div>
                <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(5,150,105,0.06)', border: '1px solid rgba(5,150,105,0.12)' }}>
                  <p className="text-[10px] font-bold" style={{ color: '#059669' }}>LTCG (≥1 yr)</p>
                  <p className="text-sm font-bold mt-1" style={{ color: '#1A1A2E' }}>
                    {taxSplit.ltcgQty.toLocaleString('en-IN')} shares
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: '#9CA3AF' }}>
                    Cost: {formatLargeINR(taxSplit.ltcgInvested)}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {/* Additional info */}
          {(isin || demat || bseCode) ? (
            <div className="wv-card p-4 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#9CA3AF' }}>Details</p>
              {isin ? (
                <div className="flex justify-between">
                  <span className="text-xs" style={{ color: '#6B7280' }}>ISIN</span>
                  <span className="text-xs font-mono" style={{ color: '#1A1A2E' }}>{isin}</span>
                </div>
              ) : null}
              {demat ? (
                <div className="flex justify-between">
                  <span className="text-xs" style={{ color: '#6B7280' }}>Demat / DP ID</span>
                  <span className="text-xs font-mono" style={{ color: '#1A1A2E' }}>{demat}</span>
                </div>
              ) : null}
              {bseCode ? (
                <div className="flex justify-between">
                  <span className="text-xs" style={{ color: '#6B7280' }}>BSE Code</span>
                  <span className="text-xs" style={{ color: '#1A1A2E' }}>{bseCode}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Transaction history */}
          <div className="wv-card">
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#F0EDE6' }}>
              <p className="text-xs font-semibold" style={{ color: '#1B2A4A' }}>
                Transaction History
                <span className="ml-2 text-[10px] font-normal" style={{ color: '#9CA3AF' }}>
                  {sorted.length} record{sorted.length !== 1 ? 's' : ''}
                </span>
              </p>
              <BarChart3 className="w-3.5 h-3.5" style={{ color: '#9CA3AF' }} />
            </div>

            {sorted.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <AlertCircle className="w-5 h-5 mx-auto mb-2" style={{ color: '#9CA3AF' }} />
                <p className="text-xs" style={{ color: '#9CA3AF' }}>No transactions yet</p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: '#F7F5F0' }}>
                {/* Running balance tracker */}
                {(() => {
                  let running = 0;
                  // compute balances forwards
                  const withBalance = [...sorted].reverse().map(t => {
                    const sign = t.type === 'sell' ? -1 : 1;
                    running += sign * Number(t.quantity);
                    return { ...t, _runningBalance: running };
                  }).reverse();

                  return visible.map(t => {
                    const wb = withBalance.find(x => x.id === t.id);
                    const label  = txnLabel(t);
                    const bg     = txnBg(t);
                    const color  = txnColor(t);
                    const amt    = Number(t.quantity) * Number(t.price);
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
                            <span className="text-xs font-semibold" style={{ color: '#1A1A2E' }}>
                              {Number(t.quantity).toLocaleString('en-IN', { maximumFractionDigits: 4 })} shares
                            </span>
                            {!isBonus && Number(t.price) > 0 && (
                              <span className="text-[10px]" style={{ color: '#6B7280' }}>
                                @ ₹{Number(t.price).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                              </span>
                            )}
                            {amt > 0 && !isBonus && (
                              <span className="text-[10px] font-medium" style={{ color: '#1A1A2E' }}>
                                = {formatLargeINR(amt + Number(t.fees || 0))}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-[10px]" style={{ color: '#9CA3AF' }}>{fmtDate(t.date)}</span>
                            {Number(t.fees) > 0 && (
                              <span className="text-[10px]" style={{ color: '#9CA3AF' }}>
                                charges: ₹{Number(t.fees).toFixed(2)}
                              </span>
                            )}
                            {wb && (
                              <span className="text-[10px]" style={{ color: '#9CA3AF' }}>
                                bal: {wb._runningBalance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                              </span>
                            )}
                            {label === 'Buy' && (
                              <span className="text-[10px]" style={{ color: '#9CA3AF' }}>
                                held: {holdingPeriodStr(t.date)}
                              </span>
                            )}
                          </div>
                          {t.notes && !t.notes.startsWith('Buy') && !t.notes.startsWith('Sell at') && (
                            <p className="text-[10px] mt-0.5 truncate" style={{ color: '#9CA3AF' }}>{t.notes}</p>
                          )}
                        </div>
                        <button
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 transition-all flex-shrink-0"
                          onClick={() => deleteTxn(t)}
                          disabled={deleting === t.id}>
                          {deleting === t.id
                            ? <Loader2 className="w-3 h-3 animate-spin" style={{ color: '#DC2626' }} />
                            : <Trash2 className="w-3 h-3" style={{ color: '#DC2626' }} />}
                        </button>
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
                style={{ borderColor: '#F0EDE6', color: '#6B7280' }}>
                {showAllTxns
                  ? <><ChevronUp className="w-3 h-3" /> Show less</>
                  : <><ChevronDown className="w-3 h-3" /> Show all {sorted.length} transactions</>}
              </button>
            )}
          </div>

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              className="h-9 text-xs gap-1.5"
              style={{ backgroundColor: '#1B2A4A', color: 'white' }}
              onClick={() => { onClose(); router.push(`/add-assets/indian-stocks`); }}>
              <Plus className="w-3.5 h-3.5" />Add More Shares
            </Button>
            <Button variant="outline" className="h-9 text-xs gap-1.5"
              style={{ borderColor: '#E8E5DD', color: '#6B7280' }}
              onClick={() => { onClose(); router.push(`/add-assets/indian-stocks`); }}>
              Record Corporate Action
            </Button>
            <Button variant="outline" className="h-9 text-xs gap-1.5 col-span-2"
              style={{ borderColor: 'rgba(220,38,38,0.2)', color: '#DC2626' }}
              onClick={() => { if (confirm('Delete this holding and all its transactions?')) { onDelete(holding.id); onClose(); } }}>
              <Trash2 className="w-3.5 h-3.5" />Delete Holding
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
