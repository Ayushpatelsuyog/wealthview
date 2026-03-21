'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter }    from 'next/navigation';
import { RefreshCw, TrendingUp, TrendingDown, PlusCircle, Loader2, AlertCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR, formatPercentage } from '@/lib/utils/formatters';
import { calculateXIRR }  from '@/lib/utils/calculations';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawHolding {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  avg_buy_price: number;
  metadata: Record<string, unknown>;
  portfolios: { name: string; type: string } | null;
  brokers:    { name: string; platform_type: string } | null;
  transactions: Array<{ date: string; price: number; quantity: number }>;
}

interface HoldingRow extends RawHolding {
  currentNav:    number | null;
  navDate:       string | null;
  navLoading:    boolean;
  investedValue: number;
  currentValue:  number | null;
  gainLoss:      number | null;
  gainLossPct:   number | null;
  xirr:          number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function PnlCell({ value, pct }: { value: number; pct: number }) {
  const up = value >= 0;
  return (
    <div>
      <p className="text-xs font-semibold" style={{ color: up ? '#059669' : '#DC2626' }}>
        {up ? '+' : ''}{formatLargeINR(value)}
      </p>
      <p className="text-[10px]" style={{ color: up ? '#059669' : '#DC2626' }}>
        {up ? <TrendingUp className="w-2.5 h-2.5 inline mr-0.5" /> : <TrendingDown className="w-2.5 h-2.5 inline mr-0.5" />}
        {formatPercentage(pct)}
      </p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const router  = useRouter();
  const supabase = createClient();

  const [holdings, setHoldings]   = useState<HoldingRow[]>([]);
  const [loading,  setLoading]    = useState(true);
  const [error,    setError]      = useState<string | null>(null);
  const [navRefreshing, setNavRefreshing] = useState(false);

  // ── Load holdings from Supabase ────────────────────────────────────────────

  const loadHoldings = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }

    const { data, error: dbErr } = await supabase
      .from('holdings')
      .select(`
        id, symbol, name, quantity, avg_buy_price, metadata,
        portfolios(name, type),
        brokers(name, platform_type),
        transactions(date, price, quantity)
      `)
      .eq('asset_type', 'mutual_fund')
      .order('created_at', { ascending: false });

    if (dbErr) { setError(dbErr.message); setLoading(false); return; }

    const rows: HoldingRow[] = (data as unknown as RawHolding[]).map((h) => {
      const invested = Number(h.quantity) * Number(h.avg_buy_price);
      return {
        ...h,
        currentNav:    null,
        navDate:       null,
        navLoading:    true,
        investedValue: invested,
        currentValue:  null,
        gainLoss:      null,
        gainLossPct:   null,
        xirr:          null,
      };
    });

    setHoldings(rows);
    setLoading(false);

    // Fetch NAVs for each unique symbol
    const uniqueSet = new Set(rows.map((r) => r.symbol));
    const unique = Array.from(uniqueSet);
    await Promise.allSettled(unique.map((symbol) => fetchNavForSymbol(symbol, rows)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchNavForSymbol(symbol: string, currentRows?: HoldingRow[]) {
    try {
      const res = await fetch(`/api/mf/nav?scheme_code=${symbol}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const navData = await res.json();
      const currentNav: number = navData.nav;
      const navDate: string    = navData.navDate;

      setHoldings((prev) => {
        const base = currentRows ?? prev;
        return base.map((h) => {
          if (h.symbol !== symbol) return { ...h, navLoading: false };
          const currentValue = Number(h.quantity) * currentNav;
          const gainLoss     = currentValue - h.investedValue;
          const gainLossPct  = h.investedValue > 0 ? (gainLoss / h.investedValue) * 100 : 0;

          // XIRR using the first transaction date
          let xirr: number | null = null;
          if (h.transactions?.length) {
            const firstTxn = h.transactions[0];
            const purchaseDate = new Date(firstTxn.date);
            const today = new Date();
            if (today > purchaseDate) {
              try {
                const rate = calculateXIRR([-h.investedValue, currentValue], [purchaseDate, today]);
                xirr = isFinite(rate) ? rate : null;
              } catch { /* skip */ }
            }
          }

          return { ...h, currentNav, navDate, navLoading: false, currentValue, gainLoss, gainLossPct, xirr };
        });
      });
    } catch {
      setHoldings((prev) => prev.map((h) =>
        h.symbol === symbol ? { ...h, navLoading: false } : h
      ));
    }
  }

  useEffect(() => { loadHoldings(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshAllNavs() {
    setNavRefreshing(true);
    await Promise.allSettled(
      Array.from(new Set(holdings.map((h) => h.symbol))).map((s) => fetchNavForSymbol(s))
    );
    setNavRefreshing(false);
  }

  // ── Totals ─────────────────────────────────────────────────────────────────

  const totalInvested     = holdings.reduce((s, h) => s + h.investedValue, 0);
  const totalCurrentValue = holdings.reduce((s, h) => s + (h.currentValue ?? h.investedValue), 0);
  const totalGainLoss     = totalCurrentValue - totalInvested;
  const totalGainLossPct  = totalInvested > 0 ? (totalGainLoss / totalInvested) * 100 : 0;

  // ── Group by portfolio name ────────────────────────────────────────────────

  const grouped: Record<string, HoldingRow[]> = {};
  holdings.forEach((h) => {
    const key = h.portfolios?.name ?? 'My Portfolio';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(h);
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#C9A84C' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="wv-card p-6 flex items-center gap-3 text-sm" style={{ color: '#DC2626' }}>
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-screen-xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold" style={{ color: '#1B2A4A' }}>Portfolio</h1>
          <p className="text-sm mt-0.5" style={{ color: '#9CA3AF' }}>Mutual fund holdings with live NAVs from mfapi.in</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={refreshAllNavs}
            disabled={navRefreshing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
            style={{ backgroundColor: '#F7F5F0', color: '#6B7280' }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${navRefreshing ? 'animate-spin' : ''}`} />
            Refresh NAVs
          </button>
          <button
            onClick={() => router.push('/add-assets/mutual-funds')}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white"
            style={{ backgroundColor: '#1B2A4A' }}
          >
            <PlusCircle className="w-3.5 h-3.5" />
            Add Fund
          </button>
        </div>
      </div>

      {/* Empty state */}
      {holdings.length === 0 && (
        <div className="wv-card p-12 text-center">
          <TrendingUp className="w-10 h-10 mx-auto mb-3" style={{ color: '#C9A84C' }} />
          <p className="font-semibold mb-1" style={{ color: '#1B2A4A' }}>No mutual fund holdings yet</p>
          <p className="text-sm mb-4" style={{ color: '#9CA3AF' }}>Add your first holding to start tracking your portfolio</p>
          <button
            onClick={() => router.push('/add-assets/mutual-funds')}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold"
            style={{ backgroundColor: '#C9A84C', color: '#1B2A4A' }}
          >
            <PlusCircle className="w-4 h-4" />
            Add First Fund
          </button>
        </div>
      )}

      {/* Summary totals */}
      {holdings.length > 0 && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Total Invested',    value: formatLargeINR(totalInvested),     sub: `${holdings.length} fund${holdings.length === 1 ? '' : 's'}` },
            { label: 'Current Value',     value: formatLargeINR(totalCurrentValue), sub: 'at live NAVs' },
            { label: 'Total P&L',         value: formatLargeINR(totalGainLoss),     pct: totalGainLossPct },
            { label: 'Absolute Return',   value: formatPercentage(totalGainLossPct), sub: 'all time' },
          ].map((card) => (
            <div key={card.label} className="wv-card p-4">
              <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#9CA3AF' }}>{card.label}</p>
              <p
                className="font-display text-lg font-semibold"
                style={{ color: card.pct !== undefined ? (card.pct >= 0 ? '#059669' : '#DC2626') : '#1B2A4A' }}
              >
                {card.value}
              </p>
              {card.sub && <p className="text-[10px] mt-0.5" style={{ color: '#9CA3AF' }}>{card.sub}</p>}
              {card.pct !== undefined && (
                <p className="text-[10px] mt-0.5" style={{ color: card.pct >= 0 ? '#059669' : '#DC2626' }}>
                  {card.pct >= 0 ? <TrendingUp className="w-2.5 h-2.5 inline mr-0.5" /> : <TrendingDown className="w-2.5 h-2.5 inline mr-0.5" />}
                  {formatPercentage(card.pct)}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Holdings grouped by portfolio */}
      {Object.entries(grouped).map(([portfolioName, rows]) => {
        const pInvested = rows.reduce((s, r) => s + r.investedValue, 0);
        const pCurrent  = rows.reduce((s, r) => s + (r.currentValue ?? r.investedValue), 0);
        const pGain     = pCurrent - pInvested;
        const pGainPct  = pInvested > 0 ? (pGain / pInvested) * 100 : 0;

        return (
          <div key={portfolioName} className="wv-card overflow-hidden">
            {/* Portfolio header */}
            <div className="flex items-center justify-between px-5 py-3" style={{ backgroundColor: '#F7F5F0', borderBottom: '1px solid #E8E5DD' }}>
              <p className="text-xs font-semibold" style={{ color: '#1B2A4A' }}>{portfolioName}</p>
              <div className="flex items-center gap-4 text-[11px]">
                <span style={{ color: '#6B7280' }}>Invested: <strong style={{ color: '#1A1A2E' }}>{formatLargeINR(pInvested)}</strong></span>
                <span style={{ color: '#6B7280' }}>Current: <strong style={{ color: '#1A1A2E' }}>{formatLargeINR(pCurrent)}</strong></span>
                <span style={{ color: pGain >= 0 ? '#059669' : '#DC2626' }}>P&L: <strong>{formatLargeINR(pGain)} ({formatPercentage(pGainPct)})</strong></span>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ borderBottom: '1px solid #E8E5DD' }}>
                    {['Fund','Units','Avg NAV','Invested','Current NAV','Current Value','P&L','XIRR','Broker'].map((h) => (
                      <th key={h} className="text-left px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: '#9CA3AF' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((h) => (
                    <tr key={h.id} style={{ borderBottom: '1px solid #F7F5F0' }} className="hover:bg-[#FAFAF8] transition-colors">
                      {/* Fund name */}
                      <td className="px-4 py-3" style={{ maxWidth: 280 }}>
                        <p className="font-medium truncate" style={{ color: '#1A1A2E' }}>{h.name}</p>
                        <p className="text-[10px] mt-0.5" style={{ color: '#9CA3AF' }}>
                          {(h.metadata?.category as string) ?? ''}
                          {h.metadata?.folio ? ` · Folio: ${h.metadata.folio}` : ''}
                        </p>
                      </td>
                      {/* Units */}
                      <td className="px-4 py-3 whitespace-nowrap" style={{ color: '#6B7280' }}>
                        {Number(h.quantity).toFixed(3)}
                      </td>
                      {/* Avg NAV */}
                      <td className="px-4 py-3 whitespace-nowrap" style={{ color: '#6B7280' }}>
                        ₹{Number(h.avg_buy_price).toFixed(4)}
                      </td>
                      {/* Invested */}
                      <td className="px-4 py-3 font-medium whitespace-nowrap" style={{ color: '#1A1A2E' }}>
                        {formatLargeINR(h.investedValue)}
                      </td>
                      {/* Current NAV */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {h.navLoading
                          ? <Loader2 className="w-3 h-3 animate-spin" style={{ color: '#9CA3AF' }} />
                          : h.currentNav
                            ? <span style={{ color: '#1A1A2E' }}>₹{h.currentNav.toFixed(4)}</span>
                            : <span style={{ color: '#9CA3AF' }}>—</span>
                        }
                      </td>
                      {/* Current Value */}
                      <td className="px-4 py-3 font-medium whitespace-nowrap" style={{ color: '#1A1A2E' }}>
                        {h.currentValue ? formatLargeINR(h.currentValue) : '—'}
                      </td>
                      {/* P&L */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {h.gainLoss !== null && h.gainLossPct !== null
                          ? <PnlCell value={h.gainLoss} pct={h.gainLossPct} />
                          : <span style={{ color: '#9CA3AF' }}>—</span>
                        }
                      </td>
                      {/* XIRR */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {h.xirr !== null
                          ? <span style={{ color: h.xirr >= 0 ? '#059669' : '#DC2626' }}>{formatPercentage(h.xirr * 100)}</span>
                          : <span style={{ color: '#9CA3AF' }}>—</span>
                        }
                      </td>
                      {/* Broker */}
                      <td className="px-4 py-3 whitespace-nowrap text-[11px]" style={{ color: '#9CA3AF' }}>
                        {h.brokers?.name ?? '—'}
                      </td>
                    </tr>
                  ))}
                  {/* Portfolio total row */}
                  <tr style={{ borderTop: '2px solid #E8E5DD', backgroundColor: '#FAFAF8' }}>
                    <td className="px-4 py-2.5 font-semibold text-xs" style={{ color: '#1B2A4A' }} colSpan={3}>Portfolio Total</td>
                    <td className="px-4 py-2.5 font-semibold text-xs" style={{ color: '#1B2A4A' }}>{formatLargeINR(pInvested)}</td>
                    <td />
                    <td className="px-4 py-2.5 font-semibold text-xs" style={{ color: '#1B2A4A' }}>{formatLargeINR(pCurrent)}</td>
                    <td className="px-4 py-2.5">
                      <PnlCell value={pGain} pct={pGainPct} />
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
