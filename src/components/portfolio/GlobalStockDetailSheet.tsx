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
  metadata?: Record<string, unknown>;
}

export interface GlobalStockHoldingDetail {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  avg_buy_price: number;
  metadata: Record<string, unknown>;
  transactions: Transaction[];
  portfolios: { id: string; name: string; type: string; user_id: string } | null;
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
  return TXN_CONFIG[txn.type]?.label ?? txn.type;
}
function txnBg(txn: Transaction): string {
  const notes = txn.notes?.toLowerCase() ?? '';
  if (notes.includes('bonus')) return 'rgba(201,168,76,0.12)';
  if (notes.includes('split')) return 'rgba(99,102,241,0.10)';
  return TXN_CONFIG[txn.type]?.bg ?? '#F3F4F6';
}
function txnColor(txn: Transaction): string {
  const notes = txn.notes?.toLowerCase() ?? '';
  if (notes.includes('bonus')) return '#C9A84C';
  if (notes.includes('split')) return '#4338CA';
  return TXN_CONFIG[txn.type]?.text ?? '#6B7280';
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtLocal(v: number, currency: string): string {
  const sym = currency === 'GBP' || currency === 'GBp' ? '£' : currency === 'EUR' ? '€' : currency === 'JPY' ? '¥' : '$';
  const divisor = currency === 'GBp' ? 100 : 1;
  const val = v / divisor;
  return `${sym}${val.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
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

  const currency       = holding.currency;
  const fxRate         = holding.fxRate ?? 1;
  const investedLocal  = holding.investedValue;
  const investedINR    = holding.investedINR;
  const currentLocal   = holding.currentValue ?? investedLocal;
  const currentINR     = holding.currentValueINR ?? investedINR;
  const gainLossINR    = holding.gainLoss ?? 0;
  const gainLossPct    = holding.gainLossPct ?? 0;
  const isGain         = gainLossINR >= 0;
  const exchange       = String(holding.metadata?.exchange ?? '');
  const country        = holding.country;

  // FX impact estimation: compare local P&L with INR P&L
  const localGainLoss  = currentLocal - investedLocal;
  const localGainINR   = localGainLoss * fxRate; // P&L from stock movement alone
  const fxImpact       = gainLossINR - localGainINR; // P&L from currency movement

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
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
              {exchange && (
                <span className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: '#A0AEC0' }}>
                  {exchange}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-xs" style={{ color: '#A0AEC0' }}>
                {countryFlag(country)} {country}
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
                  <option value="" style={{ color: '#1A1A2E' }}>Select…</option>
                  {SECTORS.map(s => <option key={s} value={s} style={{ color: '#1A1A2E' }}>{s}</option>)}
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

          {/* Summary stats */}
          <div className="wv-card p-4 grid grid-cols-2 gap-4">
            {[
              { label: `Invested (${currency})`, value: fmtLocal(investedLocal, currency) },
              { label: 'Invested (INR)',          value: formatLargeINR(investedINR) },
              { label: `Value (${currency})`,     value: fmtLocal(currentLocal, currency) },
              { label: 'Value (INR)',             value: formatLargeINR(currentINR) },
              { label: 'P&L (INR)',
                value: `${isGain ? '+' : ''}${formatLargeINR(gainLossINR)}`,
                color: isGain ? '#059669' : '#DC2626' },
              { label: 'Returns',
                value: `${isGain ? '+' : ''}${gainLossPct.toFixed(2)}%`,
                color: isGain ? '#059669' : '#DC2626' },
              { label: 'Shares Held',  value: Number(holding.quantity).toLocaleString('en-IN', { maximumFractionDigits: 4 }) },
              { label: `Avg Price (${currency})`, value: fmtLocal(Number(holding.avg_buy_price), currency) },
              { label: 'FX Rate',     value: `1 ${currency} = ₹${fxRate.toFixed(4)}` },
              { label: 'Broker',      value: holding.brokers?.name ?? '—' },
              { label: 'Portfolio',   value: holding.portfolios?.name ?? '—' },
              { label: 'Country',     value: `${countryFlag(country)} ${country}` },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <p className="text-[10px]" style={{ color: '#9CA3AF' }}>{label}</p>
                <p className="text-sm font-bold mt-0.5" style={{ color: color ?? '#1A1A2E' }}>{value}</p>
              </div>
            ))}
          </div>

          {/* FX Impact section */}
          <div className="wv-card p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: '#9CA3AF' }}>
              FX Impact Breakdown
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(27,42,74,0.06)', border: '1px solid rgba(27,42,74,0.12)' }}>
                <p className="text-[10px] font-bold" style={{ color: '#1B2A4A' }}>Stock Movement</p>
                <p className="text-sm font-bold mt-1" style={{ color: localGainINR >= 0 ? '#059669' : '#DC2626' }}>
                  {localGainINR >= 0 ? '+' : ''}{formatLargeINR(localGainINR)}
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: '#9CA3AF' }}>
                  {localGainLoss >= 0 ? '+' : ''}{fmtLocal(localGainLoss, currency)} in local
                </p>
              </div>
              <div className="p-3 rounded-xl" style={{ backgroundColor: fxImpact >= 0 ? 'rgba(5,150,105,0.06)' : 'rgba(220,38,38,0.06)', border: `1px solid ${fxImpact >= 0 ? 'rgba(5,150,105,0.12)' : 'rgba(220,38,38,0.12)'}` }}>
                <p className="text-[10px] font-bold" style={{ color: fxImpact >= 0 ? '#059669' : '#DC2626' }}>Currency Impact</p>
                <p className="text-sm font-bold mt-1" style={{ color: fxImpact >= 0 ? '#059669' : '#DC2626' }}>
                  {fxImpact >= 0 ? '+' : ''}{formatLargeINR(fxImpact)}
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: '#9CA3AF' }}>
                  {currency}/INR movement
                </p>
              </div>
            </div>
            <div className="mt-3 p-2 rounded-lg text-center" style={{ backgroundColor: 'rgba(201,168,76,0.06)' }}>
              <p className="text-[10px]" style={{ color: '#6B7280' }}>
                Total P&L:{' '}
                <span className="font-bold" style={{ color: gainLossINR >= 0 ? '#059669' : '#DC2626' }}>
                  {gainLossINR >= 0 ? '+' : ''}{formatLargeINR(gainLossINR)}
                </span>
                {' '}= Stock ({localGainINR >= 0 ? '+' : ''}{formatLargeINR(localGainINR)}) + FX ({fxImpact >= 0 ? '+' : ''}{formatLargeINR(fxImpact)})
              </p>
            </div>
          </div>

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
                            <span className="text-xs font-semibold" style={{ color: '#1A1A2E' }}>
                              {Number(t.quantity).toLocaleString('en-IN', { maximumFractionDigits: 4 })} shares
                            </span>
                            {!isBonus && Number(t.price) > 0 && (
                              <span className="text-[10px]" style={{ color: '#6B7280' }}>
                                @ {fmtLocal(Number(t.price), currency)}
                              </span>
                            )}
                          </div>
                          <div className="flex items-baseline gap-2 mt-0.5 flex-wrap">
                            {amtLocal > 0 && !isBonus && (
                              <>
                                <span className="text-[10px] font-medium" style={{ color: '#1A1A2E' }}>
                                  {fmtLocal(amtLocal, currency)}
                                </span>
                                <span className="text-[10px]" style={{ color: '#9CA3AF' }}>
                                  ≈ {formatLargeINR(amtINR)}
                                </span>
                              </>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-[10px]" style={{ color: '#9CA3AF' }}>{fmtDate(t.date)}</span>
                            {Number(t.fees) > 0 && (
                              <span className="text-[10px]" style={{ color: '#9CA3AF' }}>
                                fees: {fmtLocal(Number(t.fees), currency)}
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
                            <span className="text-[10px]" style={{ color: '#9CA3AF' }}>
                              FX: {txnFx.toFixed(2)}
                            </span>
                          </div>
                          {t.notes && !t.notes.startsWith('Buy') && !t.notes.startsWith('Sell at') && (
                            <p className="text-[10px] mt-0.5 truncate" style={{ color: '#9CA3AF' }}>{t.notes}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-blue-50 transition-all"
                            onClick={() => {
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
              onClick={() => { onClose(); router.push(`/add-assets/global-stocks?add_to=${holding.id}`); }}>
              <Plus className="w-3.5 h-3.5" />Add More Shares
            </Button>
            <Button variant="outline" className="h-9 text-xs gap-1.5"
              style={{ borderColor: '#E8E5DD', color: '#6B7280' }}
              onClick={() => { onClose(); router.push(`/add-assets/global-stocks?sell=${holding.id}`); }}>
              Sell / Exit
            </Button>
            <Button variant="outline" className="h-9 text-xs gap-1.5"
              style={{ borderColor: '#E8E5DD', color: '#6B7280' }}
              onClick={() => { onClose(); router.push(`/add-assets/global-stocks?dividend=${holding.id}`); }}>
              Record Dividend
            </Button>
            <Button variant="outline" className="h-9 text-xs gap-1.5"
              style={{ borderColor: 'rgba(220,38,38,0.2)', color: '#DC2626' }}
              onClick={() => { if (confirm('Delete this holding and all its transactions?')) { onDelete(holding.id); onClose(); } }}>
              <Trash2 className="w-3.5 h-3.5" />Delete
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
