'use client';

import { useState, useCallback } from 'react';
import { RefreshCw, TrendingUp, TrendingDown, Clock, Wifi, WifiOff } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StockPrice {
  symbol: string; name: string; exchange: string;
  price: number; change: number; changePct: number;
  high52w: number; low52w: number; source: string;
}

interface CryptoPrice {
  id: string; symbol: string; name: string; image: string;
  priceInr: number; change24h: number; marketCap: number; source: string;
}

interface MFPrice {
  schemeCode: number; name: string; nav: number;
  date: string; category: string; source: string;
}

interface ForexRate {
  pair: string; base: string; quote: string;
  rate: number; changePct24h: number; source: string;
}

interface SectionState<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  cachedAgo: number | null;
  fromCache: boolean;
  lastFetched: Date | null;
}

function initSection<T>(): SectionState<T> {
  return { data: [], loading: false, error: null, cachedAgo: null, fromCache: false, lastFetched: null };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtInr(v: number, decimals = 2) {
  if (v >= 10_000_000) return `₹${(v / 10_000_000).toFixed(2)}Cr`;
  if (v >= 100_000)    return `₹${(v / 100_000).toFixed(2)}L`;
  if (v >= 1_000)      return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: decimals })}`;
  return `₹${v.toFixed(decimals)}`;
}

function Change({ pct, abs, absPrefix = '' }: { pct: number; abs?: number; absPrefix?: string }) {
  const up = pct >= 0;
  return (
    <span className="flex items-center gap-0.5 text-xs font-semibold" style={{ color: up ? '#059669' : '#DC2626' }}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {abs !== undefined && `${absPrefix}${up ? '+' : ''}${abs.toFixed(2)} `}
      ({up ? '+' : ''}{pct.toFixed(2)}%)
    </span>
  );
}

function CacheTag({ fromCache, cachedAgo }: { fromCache: boolean; cachedAgo: number | null }) {
  if (cachedAgo === null) return null;
  return (
    <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
      {fromCache ? <Clock className="w-3 h-3" /> : <Wifi className="w-3 h-3" />}
      {fromCache ? `cached ${cachedAgo}s ago` : 'live'}
    </span>
  );
}

function SectionHeader({
  title, icon, children, loading, onRefresh, fromCache, cachedAgo,
}: {
  title: string; icon: React.ReactNode; children?: React.ReactNode;
  loading: boolean; onRefresh: () => void; fromCache: boolean; cachedAgo: number | null;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="font-semibold text-sm" style={{ color: 'var(--wv-text)' }}>{title}</h2>
        <CacheTag fromCache={fromCache} cachedAgo={cachedAgo} />
      </div>
      <div className="flex items-center gap-3">
        {children}
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          style={{ backgroundColor: 'var(--wv-surface-2)', color: 'var(--wv-text-secondary)' }}
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Fetching…' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 p-3 rounded-lg mb-3 text-xs" style={{ backgroundColor: '#FEF2F2', color: '#DC2626' }}>
      <WifiOff className="w-3.5 h-3.5 flex-shrink-0" />
      {msg}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-12 rounded-lg animate-pulse" style={{ backgroundColor: '#F0EDE6' }} />
      ))}
    </div>
  );
}

// ─── Sub-sections ─────────────────────────────────────────────────────────────

function StockTable({ rows, currency = '₹' }: { rows: StockPrice[]; currency?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--wv-border)' }}>
            {['Symbol', 'Name', 'Price', '24h Change', '52w High', '52w Low', 'Source'].map((h) => (
              <th key={h} className="text-left pb-2 font-medium" style={{ color: 'var(--wv-text-muted)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.symbol} style={{ borderBottom: '1px solid #F7F5F0' }}>
              <td className="py-2.5 font-semibold" style={{ color: 'var(--wv-text)' }}>
                {s.symbol}
                <span className="ml-1 text-[10px] font-normal" style={{ color: 'var(--wv-text-muted)' }}>{s.exchange}</span>
              </td>
              <td className="py-2.5" style={{ color: 'var(--wv-text-secondary)' }}>{s.name}</td>
              <td className="py-2.5 font-semibold" style={{ color: 'var(--wv-text)' }}>
                {currency}{s.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </td>
              <td className="py-2.5"><Change pct={s.changePct} abs={s.change} absPrefix={currency} /></td>
              <td className="py-2.5" style={{ color: 'var(--wv-text-secondary)' }}>{currency}{s.high52w.toLocaleString('en-IN')}</td>
              <td className="py-2.5" style={{ color: 'var(--wv-text-secondary)' }}>{currency}{s.low52w.toLocaleString('en-IN')}</td>
              <td className="py-2.5 text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{s.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CryptoTable({ rows }: { rows: CryptoPrice[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--wv-border)' }}>
            {['#', 'Coin', 'Price (INR)', '24h Change', 'Market Cap', 'Source'].map((h) => (
              <th key={h} className="text-left pb-2 font-medium" style={{ color: 'var(--wv-text-muted)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => (
            <tr key={c.id} style={{ borderBottom: '1px solid #F7F5F0' }}>
              <td className="py-2.5" style={{ color: 'var(--wv-text-muted)' }}>{i + 1}</td>
              <td className="py-2.5">
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.image} alt={c.name} className="w-5 h-5 rounded-full" />
                  <span className="font-semibold" style={{ color: 'var(--wv-text)' }}>{c.name}</span>
                  <span className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{c.symbol}</span>
                </div>
              </td>
              <td className="py-2.5 font-semibold" style={{ color: 'var(--wv-text)' }}>{fmtInr(c.priceInr)}</td>
              <td className="py-2.5"><Change pct={c.change24h} /></td>
              <td className="py-2.5" style={{ color: 'var(--wv-text-secondary)' }}>{fmtInr(c.marketCap, 0)}</td>
              <td className="py-2.5 text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{c.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MFTable({ rows }: { rows: MFPrice[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--wv-border)' }}>
            {['Scheme', 'Category', 'NAV', 'As of Date', 'Source'].map((h) => (
              <th key={h} className="text-left pb-2 font-medium" style={{ color: 'var(--wv-text-muted)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.schemeCode} style={{ borderBottom: '1px solid #F7F5F0' }}>
              <td className="py-2.5 font-medium" style={{ color: 'var(--wv-text)', maxWidth: 320 }}>{m.name}</td>
              <td className="py-2.5" style={{ color: 'var(--wv-text-secondary)' }}>{m.category || '—'}</td>
              <td className="py-2.5 font-semibold" style={{ color: 'var(--wv-text)' }}>
                {m.nav > 0 ? `₹${m.nav.toFixed(4)}` : '—'}
              </td>
              <td className="py-2.5" style={{ color: 'var(--wv-text-secondary)' }}>{m.date || '—'}</td>
              <td className="py-2.5 text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{m.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ForexTable({ rows }: { rows: ForexRate[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--wv-border)' }}>
            {['Pair', 'Rate (INR)', '24h Change', 'Source'].map((h) => (
              <th key={h} className="text-left pb-2 font-medium" style={{ color: 'var(--wv-text-muted)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.pair} style={{ borderBottom: '1px solid #F7F5F0' }}>
              <td className="py-2.5 font-semibold" style={{ color: 'var(--wv-text)' }}>
                {r.pair}
                <span className="ml-2 text-[10px] font-normal px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--wv-surface-2)', color: 'var(--wv-text-secondary)' }}>
                  1 {r.base}
                </span>
              </td>
              <td className="py-2.5 font-semibold" style={{ color: 'var(--wv-text)' }}>
                ₹{r.rate.toFixed(r.rate < 10 ? 4 : 2)}
              </td>
              <td className="py-2.5"><Change pct={r.changePct24h} /></td>
              <td className="py-2.5 text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{r.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PricesPage() {
  const [indian,  setIndian]  = useState<SectionState<StockPrice>>(initSection());
  const [global,  setGlobal]  = useState<SectionState<StockPrice>>(initSection());
  const [mf,      setMf]      = useState<SectionState<MFPrice>>(initSection());
  const [crypto,  setCrypto]  = useState<SectionState<CryptoPrice>>(initSection());
  const [forex,   setForex]   = useState<SectionState<ForexRate>>(initSection());

  // ── fetchers ────────────────────────────────────────────────────────────────

  const fetchStocks = useCallback(async (force = false) => {
    setIndian((s) => ({ ...s, loading: true, error: null }));
    setGlobal((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch(`/api/prices/stocks${force ? '?force=1' : ''}`);
      const json = await res.json();
      const meta = { loading: false, cachedAgo: json.cachedAgo, fromCache: json.fromCache, lastFetched: new Date(), error: null };
      setIndian((s) => ({ ...s, ...meta, data: json.indian ?? [] }));
      setGlobal((s) => ({ ...s, ...meta, data: json.global ?? [] }));
    } catch (e) {
      const err = String(e);
      setIndian((s) => ({ ...s, loading: false, error: err }));
      setGlobal((s) => ({ ...s, loading: false, error: err }));
    }
  }, []);

  const fetchMF = useCallback(async (force = false) => {
    setMf((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch(`/api/prices/mf${force ? '?force=1' : ''}`);
      const json = await res.json();
      setMf({ data: json.prices ?? [], loading: false, error: null, cachedAgo: json.cachedAgo, fromCache: json.fromCache, lastFetched: new Date() });
    } catch (e) { setMf((s) => ({ ...s, loading: false, error: String(e) })); }
  }, []);

  const fetchCrypto = useCallback(async (force = false) => {
    setCrypto((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch(`/api/prices/crypto${force ? '?force=1' : ''}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setCrypto({ data: json.prices ?? [], loading: false, error: null, cachedAgo: json.cachedAgo, fromCache: json.fromCache, lastFetched: new Date() });
    } catch (e) { setCrypto((s) => ({ ...s, loading: false, error: String(e) })); }
  }, []);

  const fetchForex = useCallback(async (force = false) => {
    setForex((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch(`/api/prices/forex${force ? '?force=1' : ''}`);
      const json = await res.json();
      setForex({ data: json.rates ?? [], loading: false, error: null, cachedAgo: json.cachedAgo, fromCache: json.fromCache, lastFetched: new Date() });
    } catch (e) { setForex((s) => ({ ...s, loading: false, error: String(e) })); }
  }, []);

  const fetchAll = useCallback((force = false) => {
    fetchStocks(force);
    fetchMF(force);
    fetchCrypto(force);
    fetchForex(force);
  }, [fetchStocks, fetchMF, fetchCrypto, fetchForex]);

  const anyLoading = indian.loading || mf.loading || crypto.loading || forex.loading;

  // ── render ──────────────────────────────────────────────────────────────────

  const hasAnyData = indian.data.length > 0 || mf.data.length > 0 || crypto.data.length > 0 || forex.data.length > 0;

  return (
    <div className="p-6 space-y-5 max-w-screen-2xl mx-auto">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold" style={{ color: 'var(--wv-text)' }}>Live Prices</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--wv-text-muted)' }}>
            Real-time & simulated market data — Indian Stocks, Global Stocks, Mutual Funds, Crypto, Forex
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!hasAnyData && (
            <button
              onClick={() => fetchAll(false)}
              disabled={anyLoading}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#C9A84C', color: 'var(--wv-text)' }}
            >
              <Wifi className="w-4 h-4" />
              {anyLoading ? 'Fetching…' : 'Load All Prices'}
            </button>
          )}
          {hasAnyData && (
            <button
              onClick={() => fetchAll(true)}
              disabled={anyLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
              style={{ backgroundColor: 'var(--wv-surface-2)', color: 'var(--wv-text-secondary)' }}
            >
              <RefreshCw className={`w-4 h-4 ${anyLoading ? 'animate-spin' : ''}`} />
              Refresh All
            </button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {!hasAnyData && !anyLoading && (
        <div className="wv-card p-12 text-center">
          <Wifi className="w-10 h-10 mx-auto mb-3" style={{ color: '#C9A84C' }} />
          <p className="font-semibold mb-1" style={{ color: 'var(--wv-text)' }}>No data loaded yet</p>
          <p className="text-sm" style={{ color: 'var(--wv-text-muted)' }}>
            Click &ldquo;Load All Prices&rdquo; above to fetch market data from live APIs.
          </p>
        </div>
      )}

      {/* Indian Stocks */}
      {(indian.data.length > 0 || indian.loading || indian.error) && (
        <div className="wv-card p-5">
          <SectionHeader
            title="Indian Stocks (NSE)"
            icon={<span className="text-lg">🇮🇳</span>}
            loading={indian.loading}
            onRefresh={() => fetchStocks(true)}
            fromCache={indian.fromCache}
            cachedAgo={indian.cachedAgo}
          />
          {indian.error && <ErrorBanner msg={indian.error} />}
          {indian.loading ? <Skeleton /> : <StockTable rows={indian.data} />}
        </div>
      )}

      {/* Global Stocks */}
      {(global.data.length > 0 || global.loading || global.error) && (
        <div className="wv-card p-5">
          <SectionHeader
            title="Global Stocks (NASDAQ / NYSE)"
            icon={<span className="text-lg">🌐</span>}
            loading={global.loading}
            onRefresh={() => fetchStocks(true)}
            fromCache={global.fromCache}
            cachedAgo={global.cachedAgo}
          />
          {global.error && <ErrorBanner msg={global.error} />}
          {global.loading ? <Skeleton /> : <StockTable rows={global.data} currency="$" />}
        </div>
      )}

      {/* Mutual Funds */}
      {(mf.data.length > 0 || mf.loading || mf.error) && (
        <div className="wv-card p-5">
          <SectionHeader
            title="Mutual Funds — Latest NAVs"
            icon={<span className="text-lg">📈</span>}
            loading={mf.loading}
            onRefresh={() => fetchMF(true)}
            fromCache={mf.fromCache}
            cachedAgo={mf.cachedAgo}
          >
            <span className="text-[10px] px-2 py-1 rounded-full" style={{ backgroundColor: '#F0FDF4', color: '#059669' }}>
              Source: mfapi.in (real)
            </span>
          </SectionHeader>
          {mf.error && <ErrorBanner msg={mf.error} />}
          {mf.loading ? <Skeleton /> : <MFTable rows={mf.data} />}
        </div>
      )}

      {/* Crypto */}
      {(crypto.data.length > 0 || crypto.loading || crypto.error) && (
        <div className="wv-card p-5">
          <SectionHeader
            title="Cryptocurrency"
            icon={<span className="text-lg">₿</span>}
            loading={crypto.loading}
            onRefresh={() => fetchCrypto(true)}
            fromCache={crypto.fromCache}
            cachedAgo={crypto.cachedAgo}
          >
            <span className="text-[10px] px-2 py-1 rounded-full" style={{ backgroundColor: '#F0FDF4', color: '#059669' }}>
              Source: CoinGecko (real)
            </span>
          </SectionHeader>
          {crypto.error && <ErrorBanner msg={crypto.error} />}
          {crypto.loading ? <Skeleton /> : <CryptoTable rows={crypto.data} />}
        </div>
      )}

      {/* Forex */}
      {(forex.data.length > 0 || forex.loading || forex.error) && (
        <div className="wv-card p-5">
          <SectionHeader
            title="Foreign Exchange (vs INR)"
            icon={<span className="text-lg">💱</span>}
            loading={forex.loading}
            onRefresh={() => fetchForex(true)}
            fromCache={forex.fromCache}
            cachedAgo={forex.cachedAgo}
          />
          {forex.error && <ErrorBanner msg={forex.error} />}
          {forex.loading ? <Skeleton /> : <ForexTable rows={forex.data} />}
        </div>
      )}

    </div>
  );
}
