'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Bitcoin, PlusCircle, Loader2, Trash2, Pencil, RefreshCw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';
import { FamilyMemberSelector } from '@/components/shared/FamilyMemberSelector';

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

interface RawHolding {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  avg_buy_price: number;
  metadata: Record<string, unknown>;
  portfolios: { id: string; name: string; user_id: string; family_id: string } | null;
  transactions: Transaction[];
}

interface CryptoRow extends RawHolding {
  exchange: string;
  walletAddress: string;
  investedValue: number;
  currentPrice: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
  memberName: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  if (!dateStr) return '--';
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return '--';
  }
}

function formatINRFull(amount: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount);
}

function pnlColor(pnl: number): string {
  if (pnl > 0) return '#059669';
  if (pnl < 0) return '#DC2626';
  return '#6B7280';
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default function CryptoPortfolioPage() {
  const router = useRouter();
  const supabase = createClient();

  const [cryptos, setCryptos] = useState<CryptoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeMemberIds, setActiveMemberIds] = useState<string[]>([]);
  const [selectedCrypto, setSelectedCrypto] = useState<CryptoRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Inline price update state
  const [updatingPriceId, setUpdatingPriceId] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState('');

  // ── Data fetch ──────────────────────────────────────────────────────────────

  useEffect(() => {
    loadData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadData() {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('holdings')
        .select('id, symbol, name, quantity, avg_buy_price, metadata, portfolios(id, name, user_id, family_id), transactions(id, date, price, quantity, type, fees, notes)')
        .eq('asset_type', 'crypto');

      if (!data || data.length === 0) {
        setCryptos([]);
        setLoading(false);
        return;
      }

      // Resolve member names
      const userIds = Array.from(new Set((data as unknown as RawHolding[]).map(d => d.portfolios?.user_id).filter(Boolean) as string[]));
      let nameMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: users } = await supabase.from('users').select('id, name').in('id', userIds);
        if (users) nameMap = Object.fromEntries(users.map(u => [u.id, u.name || u.id.slice(0, 8)]));
      }

      const rows: CryptoRow[] = (data as unknown as RawHolding[]).map((h) => {
        const meta = h.metadata ?? {};
        const currentPrice = Number(meta.current_price ?? 0);
        const investedValue = h.avg_buy_price * h.quantity;
        const currentValue = currentPrice > 0 ? currentPrice * h.quantity : investedValue;
        const pnl = currentValue - investedValue;
        const pnlPercent = investedValue > 0 ? (pnl / investedValue) * 100 : 0;

        return {
          ...h,
          exchange: String(meta.exchange ?? '--'),
          walletAddress: String(meta.wallet_address ?? ''),
          investedValue,
          currentPrice,
          currentValue,
          pnl: currentPrice > 0 ? pnl : 0,
          pnlPercent: currentPrice > 0 ? pnlPercent : 0,
          memberName: nameMap[h.portfolios?.user_id ?? ''] ?? '',
        };
      });

      setCryptos(rows);
    } catch (err) {
      console.error('Failed to load crypto holdings:', err);
    } finally {
      setLoading(false);
    }
  }

  // ── Filtered data ───────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (activeMemberIds.length === 0) return cryptos;
    return cryptos.filter(c => activeMemberIds.includes(c.portfolios?.user_id ?? ''));
  }, [cryptos, activeMemberIds]);

  // ── Aggregates ──────────────────────────────────────────────────────────────

  const totalInvested = useMemo(() => filtered.reduce((s, c) => s + c.investedValue, 0), [filtered]);
  const totalCurrentValue = useMemo(() => filtered.reduce((s, c) => s + c.currentValue, 0), [filtered]);
  const totalPnl = useMemo(() => filtered.reduce((s, c) => s + c.pnl, 0), [filtered]);
  const coinCount = useMemo(() => filtered.length, [filtered]);

  // ── Update price handler ───────────────────────────────────────────────────

  async function handleUpdatePrice(cryptoId: string) {
    const newPrice = parseFloat(priceInput);
    if (isNaN(newPrice) || newPrice < 0) return;

    try {
      const holding = cryptos.find(c => c.id === cryptoId);
      if (!holding) return;

      const updatedMetadata = { ...holding.metadata, current_price: newPrice };
      const { error } = await supabase
        .from('holdings')
        .update({ metadata: updatedMetadata })
        .eq('id', cryptoId);

      if (error) throw error;

      // Update local state
      setCryptos(prev => prev.map(c => {
        if (c.id !== cryptoId) return c;
        const investedValue = c.avg_buy_price * c.quantity;
        const currentValue = newPrice * c.quantity;
        const pnl = currentValue - investedValue;
        const pnlPercent = investedValue > 0 ? (pnl / investedValue) * 100 : 0;
        return { ...c, currentPrice: newPrice, currentValue, pnl, pnlPercent, metadata: updatedMetadata };
      }));

      setUpdatingPriceId(null);
      setPriceInput('');
    } catch (err) {
      console.error('Price update failed:', err);
      alert('Failed to update price.');
    }
  }

  // ── Delete handler ──────────────────────────────────────────────────────────

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this crypto holding?')) return;
    setDeleting(true);
    try {
      await supabase.from('transactions').delete().eq('holding_id', id);
      const { error } = await supabase.from('holdings').delete().eq('id', id);
      if (error) throw error;
      setCryptos(prev => prev.filter(c => c.id !== id));
      setSheetOpen(false);
      setSelectedCrypto(null);
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete. Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  // ── Row click ───────────────────────────────────────────────────────────────

  function openDetail(crypto: CryptoRow) {
    setSelectedCrypto(crypto);
    setSheetOpen(true);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#f59e0b' }}>
            <Bitcoin className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--wv-text)' }}>Cryptocurrency</h1>
            <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>Track your crypto portfolio across exchanges</p>
          </div>
        </div>
        <Button
          onClick={() => router.push('/add-assets/crypto')}
          className="gap-2 text-sm font-medium"
          style={{ backgroundColor: '#1B2A4A', color: 'white' }}
        >
          <PlusCircle className="w-4 h-4" />
          Add Crypto
        </Button>
      </div>

      {/* Tax Note */}
      <div className="rounded-xl px-4 py-3 text-xs font-medium"
        style={{ backgroundColor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#92400E' }}>
        India crypto gains taxed at flat 30% + 1% TDS on sell. No set-off of losses allowed.
      </div>

      {/* Family Member Selector */}
      <div className="wv-card p-4">
        <FamilyMemberSelector
          onSelectionChange={(ids) => setActiveMemberIds(ids)}
          compact
        />
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#C9A84C' }} />
          <span className="ml-3 text-sm" style={{ color: 'var(--wv-text-muted)' }}>Loading crypto holdings...</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && cryptos.length === 0 && (
        <div className="wv-card p-12 text-center">
          <Bitcoin className="w-12 h-12 mx-auto mb-4" style={{ color: '#C9A84C' }} />
          <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--wv-text)' }}>No Crypto Holdings Yet</h3>
          <p className="text-sm mb-6" style={{ color: 'var(--wv-text-muted)' }}>Start tracking your cryptocurrency by adding your first holding.</p>
          <Button
            onClick={() => router.push('/add-assets/crypto')}
            className="gap-2"
            style={{ backgroundColor: '#1B2A4A', color: 'white' }}
          >
            <PlusCircle className="w-4 h-4" />
            Add Crypto
          </Button>
        </div>
      )}

      {/* Summary Cards + Table */}
      {!loading && filtered.length > 0 && (
        <>
          {/* ── Summary Cards ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Total Invested', value: formatLargeINR(totalInvested), color: undefined },
              { label: 'Current Value', value: formatLargeINR(totalCurrentValue), color: undefined },
              { label: 'P&L', value: `${totalPnl >= 0 ? '+' : ''}${formatLargeINR(totalPnl)}`, color: pnlColor(totalPnl) },
              { label: 'Number of Coins', value: String(coinCount), color: undefined },
            ].map((c) => (
              <div key={c.label} className="wv-card p-4">
                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--wv-text-muted)' }}>{c.label}</p>
                <p className="font-display text-lg font-semibold" style={{ color: c.color ?? '#1B2A4A' }}>{c.value}</p>
              </div>
            ))}
          </div>

          {/* ── Holdings Table ─────────────────────────────────────────────────── */}
          <div className="wv-card overflow-hidden">
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--wv-border)' }}>
                    {['Coin', 'Exchange', 'Quantity', 'Avg Buy Price', 'Invested', 'Current Price', 'Current Value', 'P&L', 'P&L%', ''].map((h) => (
                      <th key={h} className="px-4 py-3 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap" style={{ color: 'var(--wv-text-muted)' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((crypto) => (
                    <tr
                      key={crypto.id}
                      onClick={() => openDetail(crypto)}
                      className="cursor-pointer transition-colors hover:bg-gray-50"
                      style={{ borderBottom: '1px solid var(--wv-border)' }}
                    >
                      <td className="px-4 py-3">
                        <p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{crypto.symbol}</p>
                        <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{crypto.name}</p>
                        {crypto.memberName && <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{crypto.memberName}</p>}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--wv-text-secondary)' }}>{crypto.exchange}</td>
                      <td className="px-4 py-3 text-xs font-medium tabular-nums" style={{ color: 'var(--wv-text)' }}>
                        {crypto.quantity.toLocaleString('en-IN', { maximumFractionDigits: 8 })}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium tabular-nums" style={{ color: 'var(--wv-text)' }}>{formatINRFull(crypto.avg_buy_price)}</td>
                      <td className="px-4 py-3 text-xs font-medium tabular-nums" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(crypto.investedValue)}</td>
                      <td className="px-4 py-3">
                        {updatingPriceId === crypto.id ? (
                          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <Input
                              type="number"
                              value={priceInput}
                              onChange={e => setPriceInput(e.target.value)}
                              placeholder="Price"
                              step="0.01"
                              className="h-7 w-24 text-xs"
                              autoFocus
                              onKeyDown={e => { if (e.key === 'Enter') handleUpdatePrice(crypto.id); if (e.key === 'Escape') { setUpdatingPriceId(null); setPriceInput(''); } }}
                            />
                            <Button size="sm" className="h-7 px-2 text-[10px]" style={{ backgroundColor: '#1B2A4A', color: 'white' }}
                              onClick={(e) => { e.stopPropagation(); handleUpdatePrice(crypto.id); }}>
                              Save
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs font-medium tabular-nums" style={{ color: crypto.currentPrice > 0 ? '#1A1A2E' : '#9CA3AF' }}>
                            {crypto.currentPrice > 0 ? formatINRFull(crypto.currentPrice) : '--'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold tabular-nums" style={{ color: 'var(--wv-text)' }}>
                        {crypto.currentPrice > 0 ? formatLargeINR(crypto.currentValue) : '--'}
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold tabular-nums" style={{ color: pnlColor(crypto.pnl) }}>
                        {crypto.currentPrice > 0 ? `${crypto.pnl >= 0 ? '+' : ''}${formatLargeINR(crypto.pnl)}` : '--'}
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold tabular-nums" style={{ color: pnlColor(crypto.pnlPercent) }}>
                        {crypto.currentPrice > 0 ? `${crypto.pnlPercent >= 0 ? '+' : ''}${crypto.pnlPercent.toFixed(2)}%` : '--'}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={(e) => { e.stopPropagation(); setUpdatingPriceId(crypto.id); setPriceInput(crypto.currentPrice > 0 ? String(crypto.currentPrice) : ''); }}
                          className="text-[10px] font-medium px-2 py-1 rounded-lg transition-colors"
                          style={{ backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C' }}
                        >
                          <RefreshCw className="w-3 h-3 inline mr-1" />
                          Update Price
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Total footer */}
            {filtered.length > 0 && (() => {
              const totalGainLossPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
              return (
                <div className="hidden md:flex px-5 py-3 items-center justify-between" style={{ borderTop: '2px solid var(--wv-border)', backgroundColor: 'var(--wv-surface-2)' }}>
                  <span className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{filtered.length} holding{filtered.length === 1 ? '' : 's'} · Total</span>
                  <div className="flex items-center gap-6 text-xs">
                    <span style={{ color: 'var(--wv-text-secondary)' }}>Invested: <strong style={{ color: 'var(--wv-text)' }}>{formatLargeINR(totalInvested)}</strong></span>
                    <span style={{ color: 'var(--wv-text-secondary)' }}>Current: <strong style={{ color: 'var(--wv-text)' }}>{formatLargeINR(totalCurrentValue)}</strong></span>
                    <span style={{ color: totalPnl >= 0 ? '#059669' : '#DC2626' }}>P&L: <strong>{totalPnl >= 0 ? '+' : ''}{formatLargeINR(totalPnl)} ({totalGainLossPct >= 0 ? '+' : ''}{totalGainLossPct.toFixed(2)}%)</strong></span>
                  </div>
                </div>
              );
            })()}

            {/* Mobile card layout */}
            <div className="md:hidden divide-y" style={{ borderColor: 'var(--wv-border)' }}>
              {filtered.map((crypto) => (
                <div
                  key={crypto.id}
                  onClick={() => openDetail(crypto)}
                  className="p-4 cursor-pointer transition-colors hover:bg-gray-50"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-sm font-semibold" style={{ color: 'var(--wv-text)' }}>{crypto.symbol} — {crypto.name}</p>
                      <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                        {crypto.exchange} {crypto.memberName ? `· ${crypto.memberName}` : ''}
                      </p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setUpdatingPriceId(crypto.id); setPriceInput(crypto.currentPrice > 0 ? String(crypto.currentPrice) : ''); }}
                      className="text-[10px] font-medium px-2 py-1 rounded-lg"
                      style={{ backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C' }}
                    >
                      Update Price
                    </button>
                  </div>
                  {updatingPriceId === crypto.id && (
                    <div className="flex items-center gap-2 mb-3" onClick={e => e.stopPropagation()}>
                      <Input
                        type="number"
                        value={priceInput}
                        onChange={e => setPriceInput(e.target.value)}
                        placeholder="Current price"
                        step="0.01"
                        className="h-8 text-xs flex-1"
                        autoFocus
                      />
                      <Button size="sm" className="h-8 px-3 text-xs" style={{ backgroundColor: '#1B2A4A', color: 'white' }}
                        onClick={() => handleUpdatePrice(crypto.id)}>
                        Save
                      </Button>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[10px] uppercase" style={{ color: 'var(--wv-text-muted)' }}>Quantity</p>
                      <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--wv-text)' }}>{crypto.quantity.toLocaleString('en-IN', { maximumFractionDigits: 8 })}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase" style={{ color: 'var(--wv-text-muted)' }}>Avg Buy</p>
                      <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--wv-text)' }}>{formatINRFull(crypto.avg_buy_price)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase" style={{ color: 'var(--wv-text-muted)' }}>Invested</p>
                      <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(crypto.investedValue)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase" style={{ color: 'var(--wv-text-muted)' }}>Current Value</p>
                      <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--wv-text)' }}>
                        {crypto.currentPrice > 0 ? formatLargeINR(crypto.currentValue) : '--'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase" style={{ color: 'var(--wv-text-muted)' }}>P&L</p>
                      <p className="text-xs font-semibold tabular-nums" style={{ color: pnlColor(crypto.pnl) }}>
                        {crypto.currentPrice > 0 ? `${crypto.pnl >= 0 ? '+' : ''}${formatLargeINR(crypto.pnl)}` : '--'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase" style={{ color: 'var(--wv-text-muted)' }}>P&L %</p>
                      <p className="text-xs font-semibold tabular-nums" style={{ color: pnlColor(crypto.pnlPercent) }}>
                        {crypto.currentPrice > 0 ? `${crypto.pnlPercent >= 0 ? '+' : ''}${crypto.pnlPercent.toFixed(2)}%` : '--'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Detail Sheet ─────────────────────────────────────────────────────── */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          {selectedCrypto && (
            <div className="space-y-6 pt-2">
              {/* Header */}
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#f59e0b' }}>
                    <Bitcoin className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold" style={{ color: 'var(--wv-text)' }}>{selectedCrypto.symbol}</h2>
                    <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>{selectedCrypto.name}</p>
                  </div>
                </div>
                {selectedCrypto.memberName && (
                  <p className="text-xs mt-1" style={{ color: 'var(--wv-text-muted)' }}>Held by: {selectedCrypto.memberName}</p>
                )}
              </div>

              {/* Holding Details */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--wv-text-muted)' }}>Holding Details</h3>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Exchange', value: selectedCrypto.exchange },
                    { label: 'Quantity', value: selectedCrypto.quantity.toLocaleString('en-IN', { maximumFractionDigits: 8 }) },
                    { label: 'Avg Buy Price', value: formatINRFull(selectedCrypto.avg_buy_price) },
                    { label: 'Total Invested', value: formatINRFull(selectedCrypto.investedValue) },
                    { label: 'Current Price', value: selectedCrypto.currentPrice > 0 ? formatINRFull(selectedCrypto.currentPrice) : 'Not set' },
                    { label: 'Current Value', value: selectedCrypto.currentPrice > 0 ? formatINRFull(selectedCrypto.currentValue) : '--' },
                  ].map((item) => (
                    <div key={item.label}>
                      <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--wv-text-muted)' }}>{item.label}</p>
                      <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* P&L */}
              {selectedCrypto.currentPrice > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--wv-text-muted)' }}>Profit & Loss</h3>
                  <div className="wv-card p-4 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>P&L</span>
                      <span className="text-sm font-semibold tabular-nums" style={{ color: pnlColor(selectedCrypto.pnl) }}>
                        {selectedCrypto.pnl >= 0 ? '+' : ''}{formatINRFull(selectedCrypto.pnl)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center" style={{ borderTop: '1px solid var(--wv-border)', paddingTop: 12 }}>
                      <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>P&L %</span>
                      <span className="text-sm font-semibold tabular-nums" style={{ color: pnlColor(selectedCrypto.pnlPercent) }}>
                        {selectedCrypto.pnlPercent >= 0 ? '+' : ''}{selectedCrypto.pnlPercent.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Additional Details */}
              {(() => {
                const extras: { label: string; value: string }[] = [];
                if (selectedCrypto.walletAddress) extras.push({ label: 'Wallet Address', value: selectedCrypto.walletAddress });
                const buyTx = selectedCrypto.transactions?.find(t => t.type === 'buy');
                if (buyTx?.notes) extras.push({ label: 'Notes', value: buyTx.notes });
                if (extras.length === 0) return null;
                return (
                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--wv-text-muted)' }}>Additional Details</h3>
                    <div className="space-y-2">
                      {extras.map((item) => (
                        <div key={item.label} className="flex justify-between">
                          <span className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>{item.label}</span>
                          <span className="text-xs font-medium text-right max-w-[60%] break-all" style={{ color: 'var(--wv-text)' }}>{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Transaction History */}
              {selectedCrypto.transactions && selectedCrypto.transactions.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--wv-text-muted)' }}>Transactions</h3>
                  <div className="space-y-2">
                    {selectedCrypto.transactions.map((tx) => (
                      <div key={tx.id} className="flex justify-between items-center p-2 rounded-lg" style={{ backgroundColor: 'rgba(27,42,74,0.03)' }}>
                        <div>
                          <p className="text-xs font-medium capitalize" style={{ color: 'var(--wv-text)' }}>{tx.type}</p>
                          <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{formatDate(tx.date)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--wv-text)' }}>
                            {Number(tx.quantity).toLocaleString('en-IN', { maximumFractionDigits: 8 })}
                          </p>
                          <p className="text-[10px] tabular-nums" style={{ color: 'var(--wv-text-muted)' }}>@ {formatINRFull(tx.price)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2" style={{ borderTop: '1px solid var(--wv-border)' }}>
                <Button
                  onClick={() => router.push(`/add-assets/crypto?edit=${selectedCrypto.id}`)}
                  className="flex-1 gap-2 text-sm"
                  style={{ backgroundColor: '#1B2A4A', color: 'white' }}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </Button>
                <Button
                  onClick={() => handleDelete(selectedCrypto.id)}
                  variant="outline"
                  className="flex-1 gap-2 text-sm"
                  style={{ borderColor: '#DC2626', color: '#DC2626' }}
                  disabled={deleting}
                >
                  {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Delete
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
