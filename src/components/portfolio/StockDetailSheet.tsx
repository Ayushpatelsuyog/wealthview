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

export interface ConsolidatedEntry {
  id: string;
  quantity: number;
  portfolioName: string;
  brokerName: string;
}

export interface StockHoldingDetail {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  avg_buy_price: number;
  metadata: Record<string, unknown>;
  portfolios: { id: string; name: string; type: string; user_id: string; family_id: string } | null;
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
  _consolidatedEntries?: ConsolidatedEntry[];
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
  if (notes.includes('bonus'))    return 'Bonus';
  if (notes.includes('split'))    return 'Split';
  if (notes.includes('rights'))   return 'Rights';
  if (notes.includes('merger'))   return 'Merger';
  if (notes.includes('demerger')) return 'Demerger';
  if (notes.includes('buyback'))  return 'Buyback';
  return TXN_CONFIG[txn.type]?.label ?? txn.type;
}
function txnBg(txn: Transaction): string {
  const notes = txn.notes?.toLowerCase() ?? '';
  if (notes.includes('bonus'))    return 'rgba(201,168,76,0.12)';
  if (notes.includes('split'))    return 'rgba(99,102,241,0.10)';
  if (notes.includes('rights'))   return 'rgba(46,139,139,0.10)';
  if (notes.includes('merger'))   return 'rgba(147,51,234,0.10)';
  if (notes.includes('demerger')) return 'rgba(147,51,234,0.10)';
  if (notes.includes('buyback'))  return 'rgba(234,88,12,0.10)';
  return TXN_CONFIG[txn.type]?.bg ?? 'var(--wv-border)';
}
function txnColor(txn: Transaction): string {
  const notes = txn.notes?.toLowerCase() ?? '';
  if (notes.includes('bonus'))    return '#C9A84C';
  if (notes.includes('split'))    return '#4338CA';
  if (notes.includes('rights'))   return '#2E8B8B';
  if (notes.includes('merger'))   return '#7C3AED';
  if (notes.includes('demerger')) return '#7C3AED';
  if (notes.includes('buyback'))  return '#EA580C';
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
  onHoldingChanged?: () => void;
}

export function StockDetailSheet({
  holding, open, onClose, onDelete, onRefreshPrice, onHoldingChanged,
}: StockDetailSheetProps) {
  const router   = useRouter();
  const supabase = createClient();
  const [showAllTxns, setShowAllTxns] = useState(false);
  const [deleting,    setDeleting]    = useState<string | null>(null);
  const [editingSector, setEditingSector] = useState(false);
  const [sectorValue, setSectorValue] = useState('');
  const [entryPickerAction, setEntryPickerAction] = useState<string | null>(null);

  const SECTORS = ['IT', 'Banking', 'Pharma', 'Auto', 'FMCG', 'Energy', 'Metals', 'Chemicals',
    'Industrials', 'Infrastructure', 'Real Estate', 'Media', 'Telecom', 'Textiles', 'Healthcare',
    'Consumer Durables', 'Financial Services', 'Cement', 'Fertilizers', 'Oil & Gas', 'Power',
    'Mining', 'Logistics', 'Defence', 'Insurance', 'Capital Goods', 'Retail', 'Other'];

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
        // Notify parent to refresh holdings from DB
        onHoldingChanged?.();
      }
    } catch (e) {
      alert((e as Error).message);
    }
    setDeleting(null);
  }

  if (!holding) return null;
  const isConsolidated = holding.id.startsWith('consolidated:');

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
              <span className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: '#A0AEC0' }}>
                {exchange}
              </span>
            </div>
            {/* Editable sector */}
            <div className="flex items-center gap-1.5 mt-1 relative">
              {editingSector ? (
                <div className="flex items-center gap-1 flex-wrap">
                  <select
                    autoFocus
                    value={sectorValue}
                    onChange={e => { const v = e.target.value; if (v === '__custom__') return; setSectorValue(v); saveSector(v); }}
                    onBlur={() => setEditingSector(false)}
                    className="h-6 text-[10px] rounded px-1 border-none outline-none"
                    style={{ backgroundColor: 'rgba(255,255,255,0.15)', color: 'white' }}>
                    <option value="" style={{ color: 'var(--wv-text)' }}>Select sector…</option>
                    {SECTORS.map(s => <option key={s} value={s} style={{ color: 'var(--wv-text)' }}>{s}</option>)}
                  </select>
                </div>
              ) : sector ? (
                <button
                  onClick={() => { setSectorValue(sector); setEditingSector(true); }}
                  className="text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1 transition-colors hover:bg-white/20"
                  style={{ backgroundColor: 'rgba(201,168,76,0.20)', color: '#F6E27A' }}>
                  <Tag className="w-2.5 h-2.5" />{sector}
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
                <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{label}</p>
                <p className="text-sm font-bold mt-0.5" style={{ color: color ?? '#1A1A2E' }}>{value}</p>
              </div>
            ))}
          </div>

          {taxSplit !== null && (taxSplit.stcgQty > 0 || taxSplit.ltcgQty > 0) ? (
            <div className="wv-card p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--wv-text-muted)' }}>
                Tax Position
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.12)' }}>
                  <p className="text-[10px] font-bold" style={{ color: '#DC2626' }}>STCG (&lt;1 yr)</p>
                  <p className="text-sm font-bold mt-1" style={{ color: 'var(--wv-text)' }}>
                    {taxSplit.stcgQty.toLocaleString('en-IN')} shares
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--wv-text-muted)' }}>
                    Cost: {formatLargeINR(taxSplit.stcgInvested)}
                  </p>
                </div>
                <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(5,150,105,0.06)', border: '1px solid rgba(5,150,105,0.12)' }}>
                  <p className="text-[10px] font-bold" style={{ color: '#059669' }}>LTCG (≥1 yr)</p>
                  <p className="text-sm font-bold mt-1" style={{ color: 'var(--wv-text)' }}>
                    {taxSplit.ltcgQty.toLocaleString('en-IN')} shares
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--wv-text-muted)' }}>
                    Cost: {formatLargeINR(taxSplit.ltcgInvested)}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {/* Additional info */}
          {(isin || demat || bseCode) ? (
            <div className="wv-card p-4 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--wv-text-muted)' }}>Details</p>
              {isin ? (
                <div className="flex justify-between">
                  <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>ISIN</span>
                  <span className="text-xs font-mono" style={{ color: 'var(--wv-text)' }}>{isin}</span>
                </div>
              ) : null}
              {demat ? (
                <div className="flex justify-between">
                  <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Demat / DP ID</span>
                  <span className="text-xs font-mono" style={{ color: 'var(--wv-text)' }}>{demat}</span>
                </div>
              ) : null}
              {bseCode ? (
                <div className="flex justify-between">
                  <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>BSE Code</span>
                  <span className="text-xs" style={{ color: 'var(--wv-text)' }}>{bseCode}</span>
                </div>
              ) : null}
            </div>
          ) : null}

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
                            <span className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>
                              {Number(t.quantity).toLocaleString('en-IN', { maximumFractionDigits: 4 })} shares
                            </span>
                            {!isBonus && Number(t.price) > 0 && (
                              <span className="text-[10px]" style={{ color: 'var(--wv-text-secondary)' }}>
                                @ ₹{Number(t.price).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                              </span>
                            )}
                            {amt > 0 && !isBonus && (
                              <span className="text-[10px] font-medium" style={{ color: 'var(--wv-text)' }}>
                                = {formatLargeINR(amt + Number(t.fees || 0))}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{fmtDate(t.date)}</span>
                            {Number(t.fees) > 0 && (
                              <span className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                                charges: ₹{Number(t.fees).toFixed(2)}
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
                          </div>
                          {t.notes && !t.notes.startsWith('Buy') && !t.notes.startsWith('Sell at') && (
                            <p className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--wv-text-muted)' }}>{t.notes}</p>
                          )}
                        </div>
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
                              router.push(`/add-assets/indian-stocks?edit_txn=${t.id}&holding_id=${holding.id}`);
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
              function navToEntry(action: string, hid: string) {
                if (h.portfolios?.family_id) sessionStorage.setItem('wv_prefill_family', h.portfolios.family_id);
                if (h.portfolios?.user_id) sessionStorage.setItem('wv_prefill_member', h.portfolios.user_id);
                if (h.portfolios?.family_id || h.portfolios?.user_id) sessionStorage.setItem('wv_prefill_active', 'true');
                onClose();
                router.push(`/add-assets/indian-stocks?${action}=${hid}`);
              }
              function handleAction(action: string) {
                if (isConsolidated && entries && entries.length > 1) {
                  setEntryPickerAction(action);
                } else {
                  navToEntry(action, entries?.[0]?.id ?? h.id);
                }
              }
              return (<>
                <Button className="h-9 text-xs gap-1.5" style={{ backgroundColor: '#1B2A4A', color: 'white' }}
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
                <Trash2 className="w-3.5 h-3.5" />Delete Holding
              </Button>
            )}
          </div>

          {/* Entry picker for consolidated actions */}
          {entryPickerAction && holding && holding._consolidatedEntries && (() => {
            const h = holding;
            const act = entryPickerAction;
            return (
              <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
                style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
                onClick={() => setEntryPickerAction(null)}>
                <div className="w-full max-w-sm rounded-2xl p-5 shadow-xl"
                  style={{ backgroundColor: 'var(--wv-surface)' }}
                  onClick={e => e.stopPropagation()}>
                  <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--wv-text)' }}>
                    {act === 'sell' ? 'Sell from which holding?' : act === 'add_to' ? 'Add shares to which holding?' : 'Record for which holding?'}
                  </h3>
                  <p className="text-xs mb-4" style={{ color: 'var(--wv-text-muted)' }}>{h.name} ({h.symbol})</p>
                  <div className="space-y-2">
                    {h._consolidatedEntries!.map(entry => (
                      <button
                        key={entry.id}
                        className="w-full flex items-center gap-3 p-3 rounded-xl border transition-colors hover:bg-[#FAFAF8]"
                        style={{ borderColor: 'var(--wv-border)' }}
                        onClick={() => {
                          setEntryPickerAction(null);
                          if (h.portfolios?.family_id) sessionStorage.setItem('wv_prefill_family', h.portfolios.family_id);
                          if (h.portfolios?.user_id) sessionStorage.setItem('wv_prefill_member', h.portfolios.user_id);
                          if (h.portfolios?.family_id || h.portfolios?.user_id) sessionStorage.setItem('wv_prefill_active', 'true');
                          onClose();
                          router.push(`/add-assets/indian-stocks?${act}=${entry.id}`);
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
            );
          })()}
        </div>
      </SheetContent>
    </Sheet>
  );
}
