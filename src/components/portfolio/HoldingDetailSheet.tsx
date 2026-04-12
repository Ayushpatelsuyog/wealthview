'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  TrendingUp, TrendingDown, Loader2, X,
  ChevronDown, ChevronUp, BarChart3, Plus, Trash2, Edit, RefreshCw, AlertCircle, Pencil,
  ArrowDownLeft, ArrowUpRight,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';
import { fmtUnits } from '@/lib/utils/format-units';
import { calcMFRealizedPnL } from '@/lib/utils/mf-calc';

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

export interface HoldingDetail {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  avg_buy_price: number;
  metadata: Record<string, unknown>;
  portfolios: { id: string; name: string; type: string; user_id: string } | null;
  brokers:    { id: string; name: string; platform_type: string } | null;
  transactions: Transaction[];
  currentNav:    number | null;
  navDate:       string | null;
  investedValue: number;
  currentValue:  number | null;
  gainLoss:      number | null;
  gainLossPct:   number | null;
  xirr:          number | null;
  memberName:    string;
}

// ─── SIP metadata from holding ───────────────────────────────────────────────

interface SipMeta {
  amount: number;
  date: string;      // '1st', '5th', etc.
  start_date: string;
  installments: number;
  units: number;
  status?: string;   // 'active' | 'inactive'
  stop_date?: string;
}

// ─── Transaction type config ─────────────────────────────────────────────────

const TXN_CONFIG: Record<string, { label: string; bg: string; text: string; sign: number }> = {
  sip:        { label: 'SIP',        bg: 'rgba(59,130,246,0.12)',  text: '#2563EB', sign:  1 },
  buy:        { label: 'Lump Sum',   bg: 'rgba(27,42,74,0.10)',    text: '#1B2A4A', sign:  1 },
  sell:       { label: 'Redemption', bg: 'rgba(220,38,38,0.10)',   text: '#DC2626', sign: -1 },
  dividend:   { label: 'Dividend',   bg: 'rgba(5,150,105,0.10)',   text: '#059669', sign:  1 },
  switch_in:  { label: 'Switch In',  bg: 'rgba(46,139,139,0.10)', text: '#2E8B8B', sign:  1 },
  switch_out: { label: 'Switch Out', bg: 'rgba(234,88,12,0.10)',  text: '#EA580C', sign: -1 },
};

const CAT_COLORS: Record<string, { bg: string; text: string }> = {
  Equity:               { bg: 'rgba(27,42,74,0.10)',    text: '#1B2A4A' },
  ELSS:                 { bg: '#F5EDD6',                text: '#C9A84C' },
  Hybrid:               { bg: 'rgba(46,139,139,0.10)',  text: '#2E8B8B' },
  Debt:                 { bg: 'rgba(5,150,105,0.10)',   text: '#059669' },
  Liquid:               { bg: 'rgba(5,150,105,0.10)',   text: '#059669' },
  Gilt:                 { bg: 'rgba(5,150,105,0.10)',   text: '#059669' },
  'Index/ETF':          { bg: 'rgba(27,42,74,0.10)',    text: '#1B2A4A' },
  Commodity:            { bg: 'rgba(201,168,76,0.20)',  text: '#92620A' },
  International:        { bg: 'rgba(99,102,241,0.12)',  text: '#4338CA' },
  'Sectoral/Thematic':  { bg: 'rgba(234,88,12,0.12)',   text: '#C2410C' },
  Arbitrage:            { bg: 'rgba(46,139,139,0.10)',  text: '#2E8B8B' },
};
function _catStyle(cat: string) { return CAT_COLORS[cat] ?? { bg: 'var(--wv-border)', text: '#6B7280' }; }

const ALL_CATEGORIES = [
  'Equity', 'Debt', 'Hybrid', 'ELSS', 'Index/ETF', 'Liquid', 'Gilt',
  'Commodity', 'International', 'Sectoral/Thematic', 'Arbitrage',
];

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtAmt(n: number): string {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)   return `₹${Math.round(n / 1000)}K`;
  return `₹${n}`;
}

// Parse "SIP #N - ₹X/month (started YYYY-MM-DD)" from transaction notes
const SIP_NOTE_RE = /^SIP #(\d+) - ₹([\d,]+)\/month \(started (.+?)\)/;

function parseSipNote(notes?: string): { sipNum: number; amount: number; start: string } | null {
  if (!notes) return null;
  const m = notes.match(SIP_NOTE_RE);
  if (!m) return null;
  return { sipNum: parseInt(m[1]), amount: parseInt(m[2].replace(/,/g, '')), start: m[3] };
}

// Label shown in the Type column for a transaction
function txnLabel(t: Transaction): string {
  if (t.type === 'buy')        return 'Lump Sum';
  if (t.type === 'sell')       return 'Redemption';
  if (t.type === 'dividend')   return 'Dividend';
  if (t.type === 'switch_in')  return 'Switch In';
  if (t.type === 'switch_out') return 'Switch Out';
  if (t.type === 'sip') {
    const parsed = parseSipNote(t.notes);
    if (parsed) return `SIP ${fmtAmt(parsed.amount)}/mo`;
    return 'SIP';
  }
  return t.type;
}

// Filter key for a transaction ('sip-1', 'sip-2', 'lump', 'sell', 'other')
function txnFilterKey(t: Transaction): string {
  if (t.type === 'buy')  return 'lump';
  if (t.type === 'sell') return 'sell';
  if (t.type === 'sip') {
    const parsed = parseSipNote(t.notes);
    return parsed ? `sip-${parsed.sipNum}` : 'sip-0';
  }
  return 'other';
}

// ─── Redemption form ─────────────────────────────────────────────────────────

// FIFO exit load: 1% on units held < 1 year
function calcExitLoad(
  redeemUnits: number,
  redeemDate: string,
  buyTxns: Transaction[],
): number {
  const redeemMs = new Date(redeemDate).getTime();
  const oneYearMs = 365 * 24 * 3600 * 1000;
  // Sort buys ascending
  const buys = [...buyTxns].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  let remaining = redeemUnits;
  let loadAmt = 0;
  for (const b of buys) {
    if (remaining <= 0) break;
    const units = Math.min(remaining, Number(b.quantity));
    const heldMs = redeemMs - new Date(b.date).getTime();
    if (heldMs < oneYearMs) loadAmt += units * Number(b.price) * 0.01;
    remaining -= units;
  }
  return loadAmt;
}

// FIFO P&L split: STCG (<1yr) and LTCG (>1yr)
function calcPnL(
  redeemUnits: number,
  sellNav: number,
  redeemDate: string,
  buyTxns: Transaction[],
): { stcg: number; ltcg: number; costBasis: number } {
  const redeemMs = new Date(redeemDate).getTime();
  const oneYearMs = 365 * 24 * 3600 * 1000;
  const buys = [...buyTxns].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  let remaining = redeemUnits;
  let stcg = 0, ltcg = 0, costBasis = 0;
  for (const b of buys) {
    if (remaining <= 0) break;
    const units = Math.min(remaining, Number(b.quantity));
    const cost  = units * Number(b.price);
    const sale  = units * sellNav;
    const gain  = sale - cost;
    const heldMs = redeemMs - new Date(b.date).getTime();
    costBasis += cost;
    if (heldMs < oneYearMs) stcg += gain; else ltcg += gain;
    remaining -= units;
  }
  return { stcg, ltcg, costBasis };
}

function RedemptionForm({
  holdingId, symbol, maxUnits, currentNav, buyTxns, editingTxn, onSuccess, onCancel,
}: {
  holdingId: string; symbol: string; maxUnits: number; currentNav: number | null;
  buyTxns: Transaction[];
  editingTxn?: Transaction | null;
  onSuccess: () => void; onCancel: () => void;
}) {
  const supabase = createClient();

  const initUnits = editingTxn ? String(editingTxn.quantity) : '';
  const initNav   = editingTxn ? String(editingTxn.price) : (currentNav?.toFixed(4) ?? '');
  const initDate  = editingTxn?.date ?? new Date().toISOString().split('T')[0];
  const initAmt   = editingTxn
    ? (Number(editingTxn.quantity) * Number(editingTxn.price)).toFixed(2)
    : '';

  const [mode,        setMode]        = useState<'units' | 'amount'>('units');
  const [units,       setUnits]       = useState(initUnits);
  const [sellNav,     setSellNav]     = useState(initNav);
  const [amount,      setAmount]      = useState(initAmt);
  const [sellDate,    setSellDate]    = useState(initDate);
  const [reason,      setReason]      = useState(editingTxn?.notes ?? '');
  const [saving,      setSaving]      = useState(false);
  const [err,         setErr]         = useState('');
  const [navFetching, setNavFetching] = useState(false);
  const [navHint,     setNavHint]     = useState('');
  // which field is currently auto-calculated (green tint)
  const [derivedField, setDerivedField] = useState<'units' | 'nav' | 'amount' | null>(
    editingTxn ? 'amount' : null
  );
  // prevent the date-change effect from running on mount when editing
  const didMount = useRef(false);

  const effectiveMaxUnits = editingTxn ? maxUnits + Number(editingTxn.quantity) : maxUnits;

  // ── Auto-fetch NAV when date changes ────────────────────────────────────────
  useEffect(() => {
    if (!symbol) return;
    // Skip initial mount when editing (NAV already pre-filled)
    if (editingTxn && !didMount.current) { didMount.current = true; return; }
    didMount.current = true;

    setNavFetching(true);
    const today = new Date().toISOString().split('T')[0];
    const url = sellDate === today
      ? `/api/mf/nav?scheme_code=${symbol}`
      : `/api/mf/nav-history?scheme_code=${symbol}&date=${sellDate}`;

    fetch(url)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.nav != null) {
          const navStr = Number(data.nav).toFixed(4);
          setSellNav(navStr);
          // Format "DD-MM-YYYY" → "DD MMM YYYY"
          let dateLabel = sellDate;
          if (data.actualDate) {
            const [d, m, y] = data.actualDate.split('-');
            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            dateLabel = `${d} ${months[parseInt(m) - 1]} ${y}`;
          }
          setNavHint(`NAV as on ${dateLabel} (auto-fetched)`);
          // Recalc the dependent field
          const n = Number(data.nav);
          const u = parseFloat(units);
          const a = parseFloat(amount);
          if (u > 0) { setAmount((u * n).toFixed(2)); setDerivedField('amount'); }
          else if (a > 0) { setUnits((a / n).toFixed(3)); setDerivedField('units'); }
        }
      })
      .catch(() => {})
      .finally(() => setNavFetching(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellDate, symbol]);

  // ── Field change handlers (any two → calc third) ─────────────────────────────
  function handleUnitsChange(val: string) {
    setUnits(val);
    const u = parseFloat(val), n = parseFloat(sellNav);
    if (u > 0 && n > 0) { setAmount((u * n).toFixed(2)); setDerivedField('amount'); }
    else { setDerivedField(null); }
  }

  function handleNavChange(val: string) {
    setSellNav(val);
    setNavHint(''); // user is overriding the auto-fetched value
    const n = parseFloat(val), u = parseFloat(units), a = parseFloat(amount);
    if (n > 0 && u > 0) { setAmount((u * n).toFixed(2)); setDerivedField('amount'); }
    else if (n > 0 && a > 0) { setUnits((a / n).toFixed(3)); setDerivedField('units'); }
    else { setDerivedField(null); }
  }

  function handleAmountChange(val: string) {
    setAmount(val);
    const a = parseFloat(val), n = parseFloat(sellNav);
    if (a > 0 && n > 0) { setUnits((a / n).toFixed(3)); setDerivedField('units'); }
    else if (a > 0 && parseFloat(units) > 0) {
      const uv = parseFloat(units);
      setSellNav((a / uv).toFixed(4)); setNavHint(''); setDerivedField('nav');
    } else { setDerivedField(null); }
  }

  // ── Derived calculations ──────────────────────────────────────────────────────
  const u = parseFloat(units) || 0;
  const n = parseFloat(sellNav) || 0;
  const redeemValue  = u * n;
  const stt          = redeemValue * 0.001;
  const exitLoad     = u > 0 && n > 0 && sellDate ? calcExitLoad(u, sellDate, buyTxns) : 0;
  const pnl          = u > 0 && n > 0 && sellDate ? calcPnL(u, n, sellDate, buyTxns) : null;
  const netProceeds  = redeemValue - stt - exitLoad;
  const isFullRedeem = u >= effectiveMaxUnits - 0.0001;

  const autoStyle = {
    backgroundColor: 'rgba(5,150,105,0.07)',
    borderColor: 'rgba(5,150,105,0.35)',
  };

  // ── Submit ────────────────────────────────────────────────────────────────────
  async function submit() {
    if (!u || u <= 0 || u > effectiveMaxUnits) { setErr(`Enter up to ${fmtUnits(effectiveMaxUnits)} units`); return; }
    if (!n || n <= 0) { setErr('Enter a valid sell NAV'); return; }
    setSaving(true); setErr('');

    if (editingTxn) {
      const delRes = await fetch('/api/mf/delete-transaction', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: editingTxn.id }),
      });
      if (!delRes.ok) { const j = await delRes.json(); setErr(j.error ?? 'Failed to update'); setSaving(false); return; }
    }

    const { error } = await supabase.from('transactions').insert({
      holding_id: holdingId, type: 'sell', quantity: u, price: n, date: sellDate,
      fees: parseFloat((stt + exitLoad).toFixed(2)),
      notes: reason || null,
    });
    if (error) { setErr(error.message); setSaving(false); return; }
    const { data: hld } = await supabase.from('holdings').select('quantity').eq('id', holdingId).single();
    const newQty = Math.max(0, Number(hld?.quantity ?? 0) - u);
    await supabase.from('holdings').update({ quantity: newQty }).eq('id', holdingId);
    onSuccess();
  }

  return (
    <div className="rounded-xl border p-4 space-y-3"
      style={{ borderColor: 'rgba(220,38,38,0.25)', backgroundColor: 'rgba(220,38,38,0.02)' }}>

      {/* Header + mode toggle */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold" style={{ color: '#DC2626' }}>
          {editingTxn ? 'Edit Redemption' : 'Record Redemption'}
        </p>
        <div className="flex gap-0.5 p-0.5 rounded-lg" style={{ backgroundColor: 'rgba(0,0,0,0.06)' }}>
          {(['units', 'amount'] as const).map(m => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className="px-2.5 py-1 rounded-md text-[10px] font-medium transition-all"
              style={mode === m
                ? { backgroundColor: '#DC2626', color: 'white' }
                : { color: 'var(--wv-text-secondary)' }}>
              {m === 'units' ? 'By Units' : 'By Amount'}
            </button>
          ))}
        </div>
      </div>

      {err && <p className="text-[11px]" style={{ color: '#DC2626' }}>{err}</p>}

      {/* Redemption Date FIRST — triggers NAV auto-fetch */}
      <div className="space-y-1">
        <Label className="text-[10px]" style={{ color: 'var(--wv-text-secondary)' }}>Redemption Date *</Label>
        <Input value={sellDate} onChange={e => setSellDate(e.target.value)}
          type="date" className="h-8 text-xs" max={new Date().toISOString().split('T')[0]} />
        <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>NAV auto-fetches when date changes</p>
      </div>

      {/* Three fields: NAV · Units · Amount */}
      <div className="grid grid-cols-3 gap-2">

        {/* Sell NAV */}
        <div className="space-y-1">
          <Label className="text-[10px] flex items-center gap-1" style={{ color: 'var(--wv-text-secondary)' }}>
            Sell NAV (₹)
            {navFetching && <Loader2 className="w-2.5 h-2.5 animate-spin" style={{ color: 'var(--wv-text-muted)' }} />}
          </Label>
          <Input value={sellNav} onChange={e => handleNavChange(e.target.value)}
            type="number" step="0.0001"
            className="h-8 text-xs" />
          {navHint && !navFetching && (
            <p className="text-[10px]" style={{ color: '#059669' }}>{navHint}</p>
          )}
        </div>

        {/* Units */}
        <div className="space-y-1">
          <Label className="text-[10px] flex items-center gap-1" style={{ color: 'var(--wv-text-secondary)' }}>
            Units to Redeem
            {derivedField === 'units' && (
              <span className="font-semibold text-[9px]" style={{ color: '#059669' }}>AUTO</span>
            )}
          </Label>
          <div className="flex gap-1">
            <Input value={units} onChange={e => handleUnitsChange(e.target.value)}
              placeholder={`Max ${fmtUnits(effectiveMaxUnits)}`}
              type="number" step="0.0001"
              className="h-8 text-xs flex-1"
              style={derivedField === 'units' ? autoStyle : {}} />
            <button type="button" onClick={() => handleUnitsChange(fmtUnits(effectiveMaxUnits))}
              className="px-2 rounded text-[10px] font-medium flex-shrink-0"
              style={{ backgroundColor: 'rgba(220,38,38,0.08)', color: '#DC2626', border: '1px solid rgba(220,38,38,0.2)' }}>
              All
            </button>
          </div>
          {derivedField === 'units' && (
            <p className="text-[10px]" style={{ color: '#059669' }}>Auto-calculated</p>
          )}
        </div>

        {/* Amount */}
        <div className="space-y-1">
          <Label className="text-[10px] flex items-center gap-1" style={{ color: 'var(--wv-text-secondary)' }}>
            {mode === 'amount' ? 'Amount Received (₹)' : 'Gross Amount (₹)'}
            {derivedField === 'amount' && (
              <span className="font-semibold text-[9px]" style={{ color: '#059669' }}>AUTO</span>
            )}
          </Label>
          <Input value={amount} onChange={e => handleAmountChange(e.target.value)}
            placeholder="Units × NAV"
            type="number" step="0.01"
            className="h-8 text-xs"
            style={derivedField === 'amount' ? autoStyle : {}} />
          {derivedField === 'amount' && (
            <p className="text-[10px]" style={{ color: '#059669' }}>Auto-calculated</p>
          )}
        </div>
      </div>

      {/* Reason */}
      <div className="space-y-1">
        <Label className="text-[10px]" style={{ color: 'var(--wv-text-secondary)' }}>Reason (optional)</Label>
        <Input value={reason} onChange={e => setReason(e.target.value)}
          placeholder="e.g. Goal completion" className="h-8 text-xs" />
      </div>

      {/* Charges & P&L breakdown */}
      {u > 0 && n > 0 && (
        <div className="rounded-lg p-3 space-y-1.5"
          style={{ backgroundColor: 'var(--wv-surface-2)', border: '1px solid var(--wv-border)' }}>
          <div className="flex justify-between text-[11px]">
            <span style={{ color: 'var(--wv-text-secondary)' }}>Gross redemption value</span>
            <span className="font-semibold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(redeemValue)}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span style={{ color: 'var(--wv-text-secondary)' }}>STT (0.001%)</span>
            <span style={{ color: '#DC2626' }}>−₹{stt.toFixed(2)}</span>
          </div>
          {exitLoad > 0 && (
            <div className="flex justify-between text-[11px]">
              <span style={{ color: 'var(--wv-text-secondary)' }}>Exit load (1% on units &lt;1yr)</span>
              <span style={{ color: '#DC2626' }}>−{formatLargeINR(exitLoad)}</span>
            </div>
          )}
          <div className="flex justify-between text-[11px] border-t pt-1.5" style={{ borderColor: 'var(--wv-border)' }}>
            <span className="font-semibold" style={{ color: 'var(--wv-text-secondary)' }}>Net proceeds</span>
            <span className="font-bold" style={{ color: '#059669' }}>{formatLargeINR(netProceeds)}</span>
          </div>
          {pnl && (
            <>
              <div className="border-t pt-1.5" style={{ borderColor: 'var(--wv-border)' }}>
                <p className="text-[10px] font-semibold mb-1" style={{ color: 'var(--wv-text-muted)' }}>TAX ESTIMATE (informational)</p>
              </div>
              {pnl.stcg !== 0 && (
                <div className="flex justify-between text-[11px]">
                  <span style={{ color: 'var(--wv-text-secondary)' }}>STCG (&lt;1yr, 20%)</span>
                  <span style={{ color: pnl.stcg >= 0 ? '#DC2626' : '#059669' }}>
                    {pnl.stcg >= 0 ? '+' : ''}{formatLargeINR(pnl.stcg)} → tax ~{formatLargeINR(Math.max(0, pnl.stcg * 0.2))}
                  </span>
                </div>
              )}
              {pnl.ltcg !== 0 && (
                <div className="flex justify-between text-[11px]">
                  <span style={{ color: 'var(--wv-text-secondary)' }}>LTCG (&gt;1yr, 12.5% above ₹1.25L)</span>
                  <span style={{ color: pnl.ltcg >= 0 ? '#DC2626' : '#059669' }}>
                    {pnl.ltcg >= 0 ? '+' : ''}{formatLargeINR(pnl.ltcg)} → tax ~{formatLargeINR(Math.max(0, (pnl.ltcg - 125000) * 0.125))}
                  </span>
                </div>
              )}
            </>
          )}
          {isFullRedeem && (
            <p className="text-[10px] pt-1" style={{ color: '#C9A84C' }}>
              Full redemption — holding will be marked as past holding.
            </p>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Button onClick={submit} disabled={saving} className="flex-1 h-8 text-xs"
          style={{ backgroundColor: '#DC2626', color: 'white' }}>
          {saving && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
          {editingTxn ? 'Save Changes' : 'Confirm Redemption'}
        </Button>
        <Button variant="outline" onClick={onCancel} className="h-8 text-xs"
          style={{ borderColor: 'var(--wv-border)', color: 'var(--wv-text-secondary)' }}>Cancel</Button>
      </div>
    </div>
  );
}

// ─── Dividend form ────────────────────────────────────────────────────────────

function DividendForm({
  holdingId, editingTxn, onSuccess, onCancel,
}: {
  holdingId: string;
  editingTxn?: Transaction | null;
  onSuccess: () => void; onCancel: () => void;
}) {
  const supabase = createClient();
  const isReinvest = editingTxn?.notes?.includes('Reinvestment') ?? false;
  const reinvestMatch = editingTxn?.notes?.match(/([\d.]+) units @ ₹([\d.]+)/);

  const [divDate,   setDivDate]   = useState(editingTxn?.date ?? new Date().toISOString().split('T')[0]);
  const [amount,    setAmount]    = useState(editingTxn ? String(editingTxn.price) : '');
  const [divType,   setDivType]   = useState<'payout' | 'reinvest'>(isReinvest ? 'reinvest' : 'payout');
  const [units,     setUnits]     = useState(reinvestMatch?.[1] ?? '');
  const [nav,       setNav]       = useState(reinvestMatch?.[2] ?? '');
  const [saving,    setSaving]    = useState(false);
  const [err,       setErr]       = useState('');

  async function submit() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setErr('Enter a valid dividend amount'); return; }
    setSaving(true); setErr('');

    // If editing: delete old transaction first (API handles unit restoration)
    if (editingTxn) {
      const delRes = await fetch('/api/mf/delete-transaction', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: editingTxn.id }),
      });
      if (!delRes.ok) { const j = await delRes.json(); setErr(j.error ?? 'Failed'); setSaving(false); return; }
    }

    if (divType === 'reinvest') {
      const u = parseFloat(units), n = parseFloat(nav);
      if (!u || u <= 0) { setErr('Enter units reinvested'); setSaving(false); return; }
      if (!n || n <= 0) { setErr('Enter NAV at reinvestment'); setSaving(false); return; }
      const { error: e1 } = await supabase.from('transactions').insert({
        holding_id: holdingId, type: 'dividend', quantity: 1, price: amt, date: divDate,
        fees: 0, notes: `IDCW Reinvestment — ${u.toFixed(3)} units @ ₹${n.toFixed(4)}`,
      });
      if (e1) { setErr(e1.message); setSaving(false); return; }
      const { data: hld } = await supabase.from('holdings').select('quantity').eq('id', holdingId).single();
      if (hld) await supabase.from('holdings').update({ quantity: Number(hld.quantity) + u }).eq('id', holdingId);
    } else {
      const { error } = await supabase.from('transactions').insert({
        holding_id: holdingId, type: 'dividend', quantity: 1, price: amt, date: divDate,
        fees: 0, notes: 'IDCW Payout',
      });
      if (error) { setErr(error.message); setSaving(false); return; }
    }
    onSuccess();
  }

  return (
    <div className="rounded-xl border p-4 space-y-3"
      style={{ borderColor: 'rgba(5,150,105,0.25)', backgroundColor: 'rgba(5,150,105,0.02)' }}>
      <p className="text-xs font-semibold" style={{ color: '#059669' }}>{editingTxn ? 'Edit Dividend' : 'Record Dividend'}</p>
      {err && <p className="text-[11px]" style={{ color: '#DC2626' }}>{err}</p>}

      {/* Type toggle */}
      <div className="flex gap-1">
        {(['payout', 'reinvest'] as const).map(t => (
          <button key={t} onClick={() => setDivType(t)}
            className="flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-colors"
            style={divType === t
              ? { backgroundColor: '#059669', color: 'white' }
              : { backgroundColor: 'var(--wv-surface-2)', color: 'var(--wv-text-secondary)', border: '1px solid var(--wv-border)' }}>
            {t === 'payout' ? 'IDCW Payout' : 'IDCW Reinvestment'}
          </button>
        ))}
      </div>

      <div className={`grid gap-2 ${divType === 'reinvest' ? 'grid-cols-2' : 'grid-cols-2'}`}>
        <div className="space-y-1">
          <Label className="text-[10px]" style={{ color: 'var(--wv-text-secondary)' }}>Dividend Amount (₹)</Label>
          <Input value={amount} onChange={e => setAmount(e.target.value)}
            type="number" step="0.01" placeholder="Total dividend received" className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px]" style={{ color: 'var(--wv-text-secondary)' }}>Date</Label>
          <Input value={divDate} onChange={e => setDivDate(e.target.value)}
            type="date" className="h-8 text-xs" max={new Date().toISOString().split('T')[0]} />
        </div>
        {divType === 'reinvest' && (
          <>
            <div className="space-y-1">
              <Label className="text-[10px]" style={{ color: 'var(--wv-text-secondary)' }}>Units Reinvested</Label>
              <Input value={units} onChange={e => setUnits(e.target.value)}
                type="number" step="0.0001" className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]" style={{ color: 'var(--wv-text-secondary)' }}>NAV at Reinvestment (₹)</Label>
              <Input value={nav} onChange={e => setNav(e.target.value)}
                type="number" step="0.0001" className="h-8 text-xs" />
            </div>
          </>
        )}
      </div>

      <div className="flex gap-2">
        <Button onClick={submit} disabled={saving} className="flex-1 h-8 text-xs"
          style={{ backgroundColor: '#059669', color: 'white' }}>
          {saving && <Loader2 className="w-3 h-3 animate-spin mr-1" />}Save Dividend
        </Button>
        <Button variant="outline" onClick={onCancel} className="h-8 text-xs"
          style={{ borderColor: 'var(--wv-border)', color: 'var(--wv-text-secondary)' }}>Cancel</Button>
      </div>
    </div>
  );
}

// ─── Main Sheet ───────────────────────────────────────────────────────────────

type RecalcState = 'idle' | 'loading' | 'confirm' | 'saving' | 'done';

export function HoldingDetailSheet({
  holding, open, initialView, onClose, onDeleted, onHoldingChanged,
}: {
  holding: HoldingDetail | null; open: boolean;
  initialView?: 'redeem';
  onClose: () => void; onDeleted: (id: string) => void; onHoldingChanged: () => void;
}) {
  const router   = useRouter();
  const supabase = createClient();

  const [showHolder,  setShowHolder]  = useState(false);
  const [showRedeem,  setShowRedeem]  = useState(false);
  const [showDividend,setShowDividend]= useState(false);
  const [deleting,    setDeleting]    = useState(false);
  const [redeemDone,  setRedeemDone]  = useState(false);
  const [dividendDone,setDividendDone]= useState(false);
  const [activeFilter,setActiveFilter] = useState<string>('all');
  const [visibleCount,setVisibleCount] = useState(20);
  const [recalcState, setRecalcState] = useState<RecalcState>('idle');
  const [recalcData,  setRecalcData]  = useState<{
    groups: Array<{ sipNum: number; amount: number; start: string; date: string; breakdown: Array<{ date: string; nav: number; units_purchased: number; stamp_duty: number }> }>;
    newCount: number; oldSipCount: number;
  } | null>(null);
  const [recalcErr, setRecalcErr] = useState('');

  const [view,               setView]               = useState<'detail' | 'edit-transactions'>('detail');
  const [txnDeleteConfirmId, setTxnDeleteConfirmId] = useState<string | null>(null);
  const [deletingTxnId,      setDeletingTxnId]      = useState<string | null>(null);
  const [txnDeleteError,     setTxnDeleteError]     = useState('');
  const [editingTxn,         setEditingTxn]         = useState<Transaction | null>(null);
  const [sipToggleIdx,       setSipToggleIdx]       = useState<number | null>(null);
  const [sipStopDate,        setSipStopDate]        = useState('');
  const [sipToggling,        setSipToggling]        = useState(false);
  const [sipToggleErr,       setSipToggleErr]       = useState('');

  // Category override
  const [editingCat,    setEditingCat]    = useState(false);
  const [savingCat,     setSavingCat]     = useState(false);

  // NFO toggle (transaction-level)
  const [nfoTogglingId, setNfoTogglingId] = useState<string | null>(null);

  // Re-link scheme dialog
  const [showRelink, setShowRelink] = useState(false);
  const [relinkQuery, setRelinkQuery] = useState('');
  const [relinkResults, setRelinkResults] = useState<Array<{ schemeCode: number; schemeName: string; category: string; latestNav?: number; latestDate?: string; daysSinceUpdate?: number; isStale?: boolean }>>([]);
  const [relinkSearching, setRelinkSearching] = useState(false);
  const [relinking, setRelinking] = useState(false);

  // STP dialogs
  const [stpMode, setStpMode] = useState<'from' | 'to' | null>(null);
  const [stpDate, setStpDate] = useState('');
  const [stpAmount, setStpAmount] = useState('');
  const [stpSourceHoldingId, setStpSourceHoldingId] = useState(''); // for "STP From": source = other fund in portfolio
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [stpSameAmcHoldings, setStpSameAmcHoldings] = useState<any[]>([]);
  const [stpDestQuery, setStpDestQuery] = useState('');
  const [stpDestResults, setStpDestResults] = useState<Array<{ schemeCode: number; schemeName: string; category: string; latestNav?: number; latestDate?: string }>>([]);
  const [stpDestSelected, setStpDestSelected] = useState<{ schemeCode: number; schemeName: string; category: string } | null>(null);
  const [stpDestSearching, setStpDestSearching] = useState(false);
  const [stpSaving, setStpSaving] = useState(false);
  const [stpError, setStpError] = useState('');

  useEffect(() => {
    if (!open) {
      setView('detail'); setTxnDeleteConfirmId(null); setTxnDeleteError('');
      setSipToggleIdx(null); setSipToggleErr('');
      setEditingTxn(null); setEditingCat(false);
      setShowRedeem(false); setShowDividend(false);
    } else {
      // If opened via "Sell / Redeem", jump straight to the redemption form
      if (initialView === 'redeem') {
        setShowRedeem(true);
        setShowDividend(false);
      }
    }
  }, [open, initialView]);

  // ── SIP groups from transactions ────────────────────────────────────────────
  const sipGroups = useMemo(() => {
    const map = new Map<string, { sipNum: number; amount: number; start: string; txns: Transaction[] }>();
    for (const t of (holding?.transactions ?? [])) {
      if (t.type !== 'sip') continue;
      const parsed = parseSipNote(t.notes);
      const key = parsed ? `sip-${parsed.sipNum}` : 'sip-0';
      if (!map.has(key)) {
        map.set(key, { sipNum: parsed?.sipNum ?? 0, amount: parsed?.amount ?? 0, start: parsed?.start ?? '', txns: [] });
      }
      map.get(key)!.txns.push(t);
    }
    return Array.from(map.values()).sort((a, b) => a.sipNum - b.sipNum);
  }, [holding?.transactions]);

  // ── Running unit map (ascending) ────────────────────────────────────────────
  const runningMap = useMemo(() => {
    const txnsAsc = [...(holding?.transactions ?? [])].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const map: Record<string, number> = {};
    let cum = 0;
    txnsAsc.forEach(t => {
      const sign = TXN_CONFIG[t.type]?.sign ?? 1;
      // Round each txn's units to 3dp before accumulating — matches what user sees per row
      const roundedQty = Math.round(Number(t.quantity) * 1000) / 1000;
      cum = Math.max(0, cum + sign * roundedQty);
      map[t.id] = cum;
    });
    return map;
  }, [holding?.transactions]);

  // ── Sorted + filtered transactions ──────────────────────────────────────────
  const txnsSorted = useMemo(() =>
    [...(holding?.transactions ?? [])].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [holding?.transactions],
  );

  const txnsFiltered = useMemo(() =>
    activeFilter === 'all' ? txnsSorted : txnsSorted.filter(t => txnFilterKey(t) === activeFilter),
    [txnsSorted, activeFilter],
  );

  // ── All hooks above — guard must come after all hooks ───────────────────────
  if (!holding) return null;

  // h is narrowed to HoldingDetail (non-null) after the guard above
  const h    = holding;
  const meta = h.metadata ?? {};
  const isSIP = !!meta.is_sip;
  const cat   = String(meta.category ?? '');
  const sipList: SipMeta[] = Array.isArray(meta.sips)
    ? (meta.sips as SipMeta[]).map(s => ({
        amount: Number(s.amount), date: String(s.date), start_date: String(s.start_date),
        installments: Number(s.installments), units: Number(s.units),
        status: String(s.status ?? 'active'),
        stop_date: s.stop_date ? String(s.stop_date) : undefined,
      }))
    : [];

  // Should show recalculate button?
  const sipTxnCount       = h.transactions.filter(t => t.type === 'sip').length;
  const expectedInstalls  = sipList.reduce((s, sip) => s + (sip.installments || 0), 0);
  const isConsolidated    = isSIP && sipList.length > 0 && sipTxnCount < Math.max(sipList.length * 2, expectedInstalls - 2);
  const canRecalculate    = isSIP && sipList.length > 0;

  // ── Filter options ──────────────────────────────────────────────────────────
  const filterOptions: { key: string; label: string }[] = [{ key: 'all', label: 'All' }];
  sipGroups.forEach(g => {
    const lbl = g.amount > 0 ? `SIP #${g.sipNum} ${fmtAmt(g.amount)}/mo` : `SIP #${g.sipNum}`;
    filterOptions.push({ key: `sip-${g.sipNum}`, label: lbl });
  });
  if (h.transactions.some(t => t.type === 'buy'))  filterOptions.push({ key: 'lump', label: 'Lump Sum' });
  if (h.transactions.some(t => t.type === 'sell')) filterOptions.push({ key: 'sell', label: 'Redemptions' });

  const txnsVisible = txnsFiltered.slice(0, visibleCount);
  const hasMore     = txnsFiltered.length > visibleCount;

  // ── Stamp duty helper — reads fees or computes from amount for historical txns ──
  const STAMP_DUTY_CUTOFF = '2020-07-01';
  function getTxnStampDuty(txn: { type: string; date: string; quantity: number; price: number; fees: number }) {
    const fees = Number(txn.fees ?? 0);
    if (fees > 0) return fees;
    // Fallback: compute for buy txns after cutoff
    if ((txn.type === 'buy' || txn.type === 'sip') && txn.date >= STAMP_DUTY_CUTOFF) {
      const amt = Number(txn.quantity) * Number(txn.price);
      return Math.round(amt * 0.00005 * 100) / 100;
    }
    return 0;
  }

  // ── Summary stats ───────────────────────────────────────────────────────────
  const buyTxns        = h.transactions.filter(t => t.type === 'buy' || t.type === 'sip');
  const sellTxns       = h.transactions.filter(t => t.type === 'sell');
  const totalBuyAmt    = buyTxns.reduce((s, t) => s + Number(t.quantity) * Number(t.price), 0);
  const totalSellAmt   = sellTxns.reduce((s, t) => s + Number(t.quantity) * Number(t.price), 0);
  const totalStampDuty = buyTxns.reduce((s, t) => s + getTxnStampDuty(t), 0);
  const totalBuyUnits  = buyTxns.reduce((s, t) => s + Math.round(Number(t.quantity) * 1000) / 1000, 0);

  // ── Delete holding ──────────────────────────────────────────────────────────
  async function handleDelete() {
    if (!confirm(`Delete "${h.name}" and all its transactions? This cannot be undone.`)) return;
    setDeleting(true);
    await supabase.from('transactions').delete().eq('holding_id', h.id);
    await supabase.from('holdings').delete().eq('id', h.id);
    onDeleted(h.id);
    onClose();
  }

  // ── Category override ───────────────────────────────────────────────────────
  async function saveCategory(newCat: string) {
    setSavingCat(true);
    await supabase
      .from('holdings')
      .update({ metadata: { ...((holding?.metadata ?? {}) as Record<string, unknown>), category: newCat } })
      .eq('id', h.id);
    setSavingCat(false);
    setEditingCat(false);
    onHoldingChanged();
  }

  // ── NFO toggle (transaction-level) ──────────────────────────────────────────
  async function toggleTxnNfo(t: Transaction) {
    setNfoTogglingId(t.id);
    const newVal = !(t.metadata?.is_nfo === true);
    const updates: Record<string, unknown> = {
      metadata: { ...(t.metadata ?? {}), is_nfo: newVal },
    };
    // If marking as NFO, lock NAV/price to ₹10
    if (newVal) updates.price = 10.0;
    await supabase.from('transactions').update(updates).eq('id', t.id);
    setNfoTogglingId(null);
    onHoldingChanged();
  }

  // ── Delete single transaction ──────────────────────────────────────────────
  async function handleDeleteTransaction(txnId: string) {
    setDeletingTxnId(txnId);
    setTxnDeleteError('');
    try {
      const res = await fetch('/api/mf/delete-transaction', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: txnId }),
      });
      const json = await res.json();
      if (!res.ok) { setTxnDeleteError(json.error ?? 'Failed to delete'); return; }
      setTxnDeleteConfirmId(null);
      if (json.holdingDeleted) { onDeleted(h.id); onClose(); } else { onHoldingChanged(); }
    } finally {
      setDeletingTxnId(null);
    }
  }

  // ── Recalculate flow ────────────────────────────────────────────────────────
  async function startRecalculate() {
    setRecalcState('loading'); setRecalcErr('');
    try {
      const groups = [];
      for (let i = 0; i < sipList.length; i++) {
        const sip = sipList[i];
        const params = new URLSearchParams({
          scheme_code: h.symbol,
          sip_amount:  String(sip.amount),
          sip_date:    sip.date,
          start_date:  sip.start_date,
        });
        if (sip.status === 'inactive' && sip.stop_date) {
          params.set('end_date', sip.stop_date);
        }
        const res = await fetch(`/api/mf/sip-calculate?${params}`);
        if (!res.ok) throw new Error(`SIP ${i + 1} calc failed`);
        const data = await res.json();
        groups.push({
          sipNum:    i + 1,
          amount:    sip.amount,
          start:     sip.start_date,
          date:      sip.date,
          breakdown: data.monthly_breakdown ?? [],
        });
      }
      const newCount    = groups.reduce((s, g) => s + g.breakdown.length, 0);
      const oldSipCount = h.transactions.filter(t => t.type === 'sip').length;
      setRecalcData({ groups, newCount, oldSipCount });
      setRecalcState('confirm');
    } catch (e: unknown) {
      setRecalcErr(e instanceof Error ? e.message : 'Calculation failed');
      setRecalcState('idle');
    }
  }

  async function confirmRecalculate() {
    if (!recalcData) return;
    setRecalcState('saving');
    try {
      await supabase.from('transactions').delete()
        .eq('holding_id', h.id).eq('type', 'sip');

      for (const sip of recalcData.groups) {
        if (sip.breakdown.length === 0) continue;
        const amtFmt = Number(sip.amount).toLocaleString('en-IN');
        const label  = `SIP #${sip.sipNum} - ₹${amtFmt}/month (started ${sip.start})`;
        const rows   = sip.breakdown.map((inst) => ({
          holding_id: h.id,
          type:       'sip',
          quantity:   inst.units_purchased,
          price:      inst.nav,
          date:       inst.date,
          fees:       inst.stamp_duty ?? 0,
          notes:      label,
        }));
        await supabase.from('transactions').insert(rows);
      }

      setRecalcState('done');
      setRecalcData(null);
      onHoldingChanged();
    } catch {
      setRecalcErr('Failed to save. Please try again.');
      setRecalcState('idle');
    }
  }

  // ── SIP toggle (activate / deactivate) ─────────────────────────────────────
  async function handleSipToggle(sipIndex: number, currentStatus: string) {
    if (currentStatus === 'inactive') {
      // Re-activate immediately (no stop date needed)
      setSipToggling(true); setSipToggleErr('');
      try {
        const res = await fetch('/api/mf/update-sip-status', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ holdingId: h.id, sipIndex, status: 'active' }),
        });
        if (!res.ok) { const j = await res.json(); setSipToggleErr(j.error ?? 'Failed'); return; }
        onHoldingChanged();
      } finally {
        setSipToggling(false);
      }
    } else {
      // Ask for a stop date before deactivating
      setSipToggleIdx(sipIndex);
      setSipStopDate(new Date().toISOString().split('T')[0]);
      setSipToggleErr('');
    }
  }

  async function confirmSipStop(sipIndex: number) {
    if (!sipStopDate) { setSipToggleErr('Please enter a stop date'); return; }
    setSipToggling(true); setSipToggleErr('');
    try {
      const res = await fetch('/api/mf/update-sip-status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holdingId: h.id, sipIndex, status: 'inactive', stop_date: sipStopDate }),
      });
      if (!res.ok) { const j = await res.json(); setSipToggleErr(j.error ?? 'Failed'); return; }
      setSipToggleIdx(null);
      onHoldingChanged();
    } finally {
      setSipToggling(false);
    }
  }

  // ── Stat tiles ─────────────────────────────────────────────────────────────
  const statTiles = [
    { label: 'Total Invested', value: formatLargeINR(h.investedValue),                color: undefined },
    { label: 'Current Value',  value: h.currentValue ? formatLargeINR(h.currentValue) : '—', color: undefined },
    { label: 'Total Units',    value: fmtUnits(h.quantity),                  color: undefined },
    { label: 'Average NAV',    value: `₹${Number(h.avg_buy_price).toFixed(4)}`,       color: undefined },
    { label: 'P&L (₹)',
      value: h.gainLoss != null ? `${h.gainLoss >= 0 ? '+' : ''}${formatLargeINR(h.gainLoss)}` : '—',
      color: h.gainLoss != null ? (h.gainLoss >= 0 ? '#059669' : '#DC2626') : undefined },
    { label: 'P&L (%)',
      value: h.gainLossPct != null ? `${h.gainLossPct >= 0 ? '+' : ''}${h.gainLossPct.toFixed(2)}%` : '—',
      color: h.gainLossPct != null ? (h.gainLossPct >= 0 ? '#059669' : '#DC2626') : undefined },
    { label: 'XIRR',
      value: h.xirr != null ? `${(h.xirr * 100) >= 0 ? '+' : ''}${(h.xirr * 100).toFixed(2)}%` : '—',
      color: h.xirr != null ? (h.xirr >= 0 ? '#059669' : '#DC2626') : undefined },
    { label: 'Distributor', value: h.brokers?.name ?? '—',           color: undefined },
    { label: 'Folio',     value: meta.folio ? String(meta.folio) : '—', color: undefined },
    { label: 'Portfolio', value: h.portfolios?.name ?? '—',          color: undefined },
  ];

  const hasHolderData = !!(meta.first_holder || meta.mobile || meta.email || meta.bank_name || meta.bank_last4 || meta.pan);

  // ── Realized P&L (FIFO matching of sells against buys) ─────────────────────
  const { realized: realizedPnl, realizedCostBasis, realizedProceeds } = calcMFRealizedPnL(h.transactions);
  const realizedPct = realizedCostBasis > 0 ? (realizedPnl / realizedCostBasis) * 100 : 0;
  const soldUnits = (h.transactions ?? []).filter(t => t.type === 'sell' || t.type === 'redeem').reduce((s, t) => s + Number(t.quantity || 0), 0);
  const hasRealized = soldUnits > 0;

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full flex flex-col p-0 overflow-hidden"
        style={{ maxWidth: '64vw', minWidth: 560 }}
      >
        {/* ── Header ──────────────────────────────────────────────────────────── */}
        <div className="px-6 py-5 border-b flex-shrink-0"
          style={{ borderColor: '#2F3E5C', backgroundColor: '#1B2A4A' }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                {/* Category badge — click pencil to override */}
                {editingCat ? (
                  <div className="flex items-center gap-1.5">
                    <Select
                      defaultValue={cat || 'Equity'}
                      onValueChange={(v) => { saveCategory(v); }}
                    >
                      <SelectTrigger
                        className="h-6 text-[10px] px-2 py-0 rounded-full border-0 font-semibold focus:ring-0"
                        style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', minWidth: 120 }}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ALL_CATEGORIES.map(c => (
                          <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {savingCat
                      ? <Loader2 className="w-3 h-3 animate-spin" style={{ color: 'rgba(255,255,255,0.6)' }} />
                      : <button onClick={() => setEditingCat(false)}
                          className="text-[11px] leading-none px-1.5 py-0.5 rounded transition-colors hover:bg-white/10"
                          style={{ color: 'rgba(255,255,255,0.6)' }}>✕</button>
                    }
                  </div>
                ) : (
                  <button
                    onClick={() => setEditingCat(true)}
                    className="flex items-center gap-1 group"
                    title="Change category"
                  >
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: 'rgba(255,255,255,0.15)', color: 'white' }}>
                      {cat || 'Uncategorised'}
                    </span>
                    <Pencil className="w-2.5 h-2.5 flex-shrink-0 transition-opacity opacity-40 group-hover:opacity-80"
                      style={{ color: 'white' }} />
                  </button>
                )}
                {isSIP && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: 'rgba(201,168,76,0.25)', color: '#C9A84C' }}>SIP</span>
                )}
                {/* NFO badge — shown if any transaction is an NFO purchase */}
                {(meta.is_nfo || h.transactions.some(t => t.metadata?.is_nfo === true)) && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    title="This holding has NFO transaction(s)"
                    style={{ backgroundColor: 'rgba(37,99,235,0.25)', color: '#93C5FD' }}>
                    NFO
                  </span>
                )}
                <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>AMFI {h.symbol}</span>
              </div>
              <h2 className="text-[15px] font-semibold leading-snug text-white">{h.name}</h2>
              {meta.fund_house ? (
                <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  {String(meta.fund_house)}
                </p>
              ) : null}
            </div>
            <button onClick={onClose}
              className="p-1.5 rounded-lg transition-colors flex-shrink-0"
              style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
              <X className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto" style={{ display: view === 'edit-transactions' ? 'none' : undefined }}>

          {/* ── Fund Summary ── */}
          <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--wv-border)' }}>
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
                style={{ backgroundColor: 'var(--wv-surface-2)', border: '1px solid var(--wv-border)' }}>
                <BarChart3 className="w-3.5 h-3.5" style={{ color: 'var(--wv-text-muted)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>
                  {h.currentNav
                    ? `₹${h.currentNav.toFixed(4)}`
                    : <Loader2 className="w-3 h-3 animate-spin inline" style={{ color: 'var(--wv-text-muted)' }} />}
                </span>
                {h.navDate && <span className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>NAV · {h.navDate}</span>}
              </div>
              {h.gainLoss != null && (
                <span className="text-xs font-semibold"
                  style={{ color: h.gainLoss >= 0 ? '#059669' : '#DC2626' }}>
                  {h.gainLoss >= 0
                    ? <TrendingUp className="w-3.5 h-3.5 inline mr-1" />
                    : <TrendingDown className="w-3.5 h-3.5 inline mr-1" />}
                  {h.gainLoss >= 0 ? '+' : ''}{formatLargeINR(h.gainLoss)}{' '}
                  ({h.gainLossPct! >= 0 ? '+' : ''}{h.gainLossPct!.toFixed(2)}%)
                </span>
              )}
            </div>

            <div className="grid grid-cols-5 gap-2">
              {statTiles.map(({ label, value, color }) => (
                <div key={label} className="p-2.5 rounded-xl" style={{ backgroundColor: 'var(--wv-surface-2)' }}>
                  <p className="text-[9px] uppercase tracking-wider mb-1" style={{ color: 'var(--wv-text-muted)' }}>{label}</p>
                  <p className="text-[11px] font-semibold leading-tight" style={{ color: color ?? '#1A1A2E' }}>{value}</p>
                </div>
              ))}
            </div>

            {/* Realized P&L (only if units have been sold/redeemed) */}
            {hasRealized && (
              <div className="mt-3 rounded-xl p-4" style={{ backgroundColor: 'var(--wv-surface-2)', border: '1px solid var(--wv-border)' }}>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--wv-text-muted)' }}>
                  Realized P&L
                  <span className="normal-case font-normal ml-1">({fmtUnits(soldUnits)} units sold)</span>
                </p>
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>Sale Proceeds</p>
                    <p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(realizedProceeds)}</p>
                  </div>
                  <div>
                    <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>Cost of Sold</p>
                    <p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(realizedCostBasis)}</p>
                  </div>
                  <div>
                    <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>Realized P&L</p>
                    <p className="text-xs font-bold" style={{ color: realizedPnl >= 0 ? '#059669' : '#DC2626' }}>
                      {realizedPnl >= 0 ? '+' : ''}{formatLargeINR(realizedPnl)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>Return %</p>
                    <p className="text-xs font-bold" style={{ color: realizedPct >= 0 ? '#059669' : '#DC2626' }}>
                      {realizedPct >= 0 ? '+' : ''}{realizedPct.toFixed(2)}%
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Scheme Info — shows stale NAV warning + Re-link button */}
            {(() => {
              const navDateStr = h.navDate || '';
              let staleDays = 0;
              if (navDateStr) {
                // navDate is in "DD-MMM-YYYY" or ISO; try parsing
                const parsed = new Date(navDateStr);
                if (!isNaN(parsed.getTime())) {
                  staleDays = Math.floor((Date.now() - parsed.getTime()) / (24 * 3600 * 1000));
                }
              }
              const isStale = staleDays > 30;
              const isVeryStale = staleDays > 180;
              return (
                <div className="mt-3 rounded-xl p-3 flex items-center justify-between" style={{
                  backgroundColor: isVeryStale ? 'rgba(220,38,38,0.06)' : isStale ? 'rgba(217,119,6,0.06)' : 'var(--wv-surface-2)',
                  border: `1px solid ${isVeryStale ? 'rgba(220,38,38,0.25)' : isStale ? 'rgba(217,119,6,0.25)' : 'var(--wv-border)'}`,
                }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--wv-text-muted)' }}>
                      Scheme Info
                      {isStale && <span className="ml-1 normal-case" style={{ color: isVeryStale ? '#DC2626' : '#D97706' }}>⚠️ {isVeryStale ? 'Very stale' : 'Stale'} NAV</span>}
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--wv-text)' }}>
                      AMFI Code: <strong>{h.symbol}</strong>
                      {navDateStr && <> · Last NAV: {navDateStr}{staleDays > 0 && ` (${staleDays}d ago)`}</>}
                    </p>
                    {isStale && (
                      <p className="text-[10px] mt-1" style={{ color: isVeryStale ? '#DC2626' : '#D97706' }}>
                        This scheme may be inactive or renamed. Click &ldquo;Re-link&rdquo; to pick the active scheme.
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => { setShowRelink(true); setRelinkQuery(h.name.split(' - ')[0] || h.name); }}
                    className="flex-shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ml-3"
                    style={{
                      backgroundColor: isStale ? '#D97706' : 'rgba(27,42,74,0.08)',
                      color: isStale ? 'white' : '#1B2A4A',
                    }}>
                    Re-link Scheme
                  </button>
                </div>
              );
            })()}
          </div>

          {/* ── SIP Summary Cards ── */}
          {isSIP && sipList.length > 0 && (
            <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--wv-border)' }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--wv-text-muted)' }}>
                  SIPs ({sipList.filter(s => s.status !== 'inactive').length} active
                  {sipList.some(s => s.status === 'inactive') ? ` / ${sipList.length} total` : ''})
                </p>
                {/* Recalculate button */}
                {canRecalculate && recalcState === 'idle' && (
                  <button
                    onClick={startRecalculate}
                    className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors"
                    style={{ backgroundColor: isConsolidated ? '#FEF3C7' : '#F7F5F0',
                             color: isConsolidated ? '#B45309' : '#9CA3AF',
                             border: `1px solid ${isConsolidated ? '#FDE68A' : 'var(--wv-border)'}` }}>
                    <RefreshCw className="w-3 h-3" />
                    {isConsolidated ? 'Expand SIP History' : 'Recalculate Transactions'}
                  </button>
                )}
                {recalcState === 'loading' && (
                  <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                    <Loader2 className="w-3 h-3 animate-spin" />Fetching NAV history…
                  </span>
                )}
              </div>

              {/* Recalculate confirmation */}
              {recalcState === 'confirm' && recalcData && (
                <div className="mb-3 p-3 rounded-xl border"
                  style={{ borderColor: '#FDE68A', backgroundColor: '#FFFBEB' }}>
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#B45309' }} />
                    <div className="flex-1">
                      <p className="text-xs font-semibold" style={{ color: '#92400E' }}>Replace transactions?</p>
                      <p className="text-[11px] mt-0.5" style={{ color: '#78350F' }}>
                        This will replace {recalcData.oldSipCount} consolidated SIP transaction{recalcData.oldSipCount !== 1 ? 's' : ''}{' '}
                        with {recalcData.newCount} individual monthly installments.
                      </p>
                      <div className="flex gap-2 mt-2">
                        <button onClick={confirmRecalculate}
                          className="px-3 py-1 rounded-lg text-[11px] font-semibold text-white"
                          style={{ backgroundColor: '#B45309' }}>
                          Confirm
                        </button>
                        <button onClick={() => { setRecalcState('idle'); setRecalcData(null); }}
                          className="px-3 py-1 rounded-lg text-[11px]" style={{ color: 'var(--wv-text-secondary)' }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {recalcState === 'saving' && (
                <div className="mb-3 flex items-center gap-2 text-[11px]" style={{ color: 'var(--wv-text-muted)' }}>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />Saving {recalcData?.newCount} transactions…
                </div>
              )}
              {recalcState === 'done' && (
                <div className="mb-3 text-[11px] font-medium" style={{ color: '#059669' }}>
                  ✓ Transaction history updated with individual installments.
                </div>
              )}
              {recalcErr && (
                <p className="mb-2 text-[11px]" style={{ color: '#DC2626' }}>{recalcErr}</p>
              )}

              {sipToggleErr && (
                <p className="mb-2 text-[11px]" style={{ color: '#DC2626' }}>{sipToggleErr}</p>
              )}

              {/* SIP cards (clickable to filter) */}
              <div className={`grid gap-2 ${sipList.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {sipList.map((sip, i) => {
                  const filterKey   = `sip-${i + 1}`;
                  const grp         = sipGroups.find(g => g.sipNum === i + 1);
                  const grpUnits    = grp ? grp.txns.reduce((s, t) => s + Number(t.quantity), 0) : sip.units;
                  const grpInvested = grp ? grp.txns.reduce((s, t) => s + Number(t.quantity) * Number(t.price), 0) : (sip.amount * sip.installments);
                  const grpCount    = grp?.txns.length ?? sip.installments;
                  const grpAvgNav   = grpUnits > 0 ? grpInvested / grpUnits : 0;
                  const isFiltered  = activeFilter === filterKey;
                  const isInactive  = sip.status === 'inactive';
                  const isTogglingThis = sipToggleIdx === i;

                  return (
                    <div
                      key={i}
                      className="p-3 rounded-xl border transition-all"
                      style={{
                        borderColor: isFiltered ? 'rgba(201,168,76,0.5)' : isInactive ? 'rgba(220,38,38,0.2)' : 'var(--wv-border)',
                        backgroundColor: isFiltered ? 'rgba(201,168,76,0.08)' : isInactive ? 'rgba(220,38,38,0.02)' : 'rgba(27,42,74,0.01)',
                        boxShadow: isFiltered ? '0 0 0 2px rgba(201,168,76,0.2)' : 'none',
                      }}
                    >
                      <div className="flex items-start justify-between mb-2 gap-2">
                        <button
                          onClick={() => { setActiveFilter(isFiltered ? 'all' : filterKey); setVisibleCount(20); }}
                          className="text-left flex-1"
                        >
                          <span className="text-[10px] font-bold block" style={{ color: isInactive ? '#9CA3AF' : '#C9A84C' }}>
                            SIP #{i + 1} — {formatLargeINR(sip.amount)}/month on {sip.date}
                          </span>
                        </button>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                            style={isInactive
                              ? { backgroundColor: 'rgba(220,38,38,0.1)', color: '#DC2626' }
                              : { backgroundColor: 'rgba(5,150,105,0.1)', color: '#059669' }}>
                            {isInactive ? 'Stopped' : 'Active'}
                          </span>
                          <button
                            onClick={() => handleSipToggle(i, sip.status ?? 'active')}
                            disabled={sipToggling}
                            className="text-[9px] px-1.5 py-0.5 rounded font-medium transition-colors"
                            style={isInactive
                              ? { backgroundColor: 'rgba(5,150,105,0.1)', color: '#059669', border: '1px solid rgba(5,150,105,0.25)' }
                              : { backgroundColor: 'rgba(220,38,38,0.08)', color: '#DC2626', border: '1px solid rgba(220,38,38,0.2)' }}>
                            {sipToggling && sipToggleIdx === i ? '…' : isInactive ? 'Re-activate' : 'Stop'}
                          </button>
                        </div>
                      </div>

                      {/* Stop date picker (shown when user clicks Stop) */}
                      {isTogglingThis && (
                        <div className="mb-2 p-2 rounded-lg space-y-1.5"
                          style={{ backgroundColor: 'rgba(220,38,38,0.04)', border: '1px solid rgba(220,38,38,0.15)' }}>
                          <p className="text-[10px]" style={{ color: '#DC2626' }}>When did this SIP stop?</p>
                          <div className="flex items-center gap-2">
                            <Input
                              type="date" value={sipStopDate} onChange={e => setSipStopDate(e.target.value)}
                              max={new Date().toISOString().split('T')[0]}
                              className="h-7 text-[11px] flex-1"
                            />
                            <button
                              onClick={() => confirmSipStop(i)} disabled={sipToggling}
                              className="h-7 px-3 rounded text-[11px] font-semibold text-white flex-shrink-0"
                              style={{ backgroundColor: '#DC2626' }}>
                              {sipToggling ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Confirm'}
                            </button>
                            <button
                              onClick={() => { setSipToggleIdx(null); setSipToggleErr(''); }}
                              className="h-7 px-2 rounded text-[11px] flex-shrink-0"
                              style={{ color: 'var(--wv-text-secondary)' }}>
                              ✕
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-3 gap-2 text-[10px]">
                        <div>
                          <p style={{ color: 'var(--wv-text-muted)' }}>Started</p>
                          <p className="font-semibold mt-0.5" style={{ color: 'var(--wv-text)' }}>{fmtDate(sip.start_date)}</p>
                        </div>
                        {isInactive && sip.stop_date ? (
                          <div>
                            <p style={{ color: 'var(--wv-text-muted)' }}>Stopped</p>
                            <p className="font-semibold mt-0.5" style={{ color: '#DC2626' }}>{fmtDate(sip.stop_date)}</p>
                          </div>
                        ) : (
                          <div>
                            <p style={{ color: 'var(--wv-text-muted)' }}>Installments</p>
                            <p className="font-semibold mt-0.5" style={{ color: 'var(--wv-text)' }}>{grpCount}</p>
                          </div>
                        )}
                        <div>
                          <p style={{ color: 'var(--wv-text-muted)' }}>Units</p>
                          <p className="font-semibold mt-0.5" style={{ color: 'var(--wv-text)' }}>{fmtUnits(grpUnits)}</p>
                        </div>
                        <div>
                          <p style={{ color: 'var(--wv-text-muted)' }}>Invested</p>
                          <p className="font-semibold mt-0.5" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(grpInvested)}</p>
                        </div>
                        <div>
                          <p style={{ color: 'var(--wv-text-muted)' }}>Avg NAV</p>
                          <p className="font-semibold mt-0.5" style={{ color: 'var(--wv-text)' }}>₹{grpAvgNav.toFixed(4)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Transaction History ── */}
          <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--wv-border)' }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--wv-text-muted)' }}>
                Transaction History ({txnsFiltered.length} of {h.transactions.length})
              </p>
              {meta.import === 'cas' && (
                <span className="text-[9px] px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: 'var(--wv-surface-2)', color: 'var(--wv-text-muted)' }}>CAS Import</span>
              )}
            </div>

            {/* Filter pills */}
            {filterOptions.length > 1 && (
              <div className="flex items-center gap-1.5 flex-wrap mb-3">
                {filterOptions.map(({ key, label }) => (
                  <button key={key}
                    onClick={() => { setActiveFilter(key); setVisibleCount(20); }}
                    className="px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors"
                    style={{
                      backgroundColor: activeFilter === key ? '#1B2A4A' : '#F7F5F0',
                      color: activeFilter === key ? 'white' : '#6B7280',
                      border: `1px solid ${activeFilter === key ? '#1B2A4A' : 'var(--wv-border)'}`,
                    }}>
                    {label}
                  </button>
                ))}
              </div>
            )}

            {h.transactions.length === 0 ? (
              <p className="text-xs py-4 text-center" style={{ color: 'var(--wv-text-muted)' }}>No transactions recorded yet</p>
            ) : txnsFiltered.length === 0 ? (
              <p className="text-xs py-4 text-center" style={{ color: 'var(--wv-text-muted)' }}>No transactions match this filter</p>
            ) : (
              <>
                <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--wv-border)' }}>
                  <div className="overflow-x-auto">
                    <table className="w-full" style={{ fontSize: 11 }}>
                      <thead>
                        <tr style={{ backgroundColor: 'var(--wv-surface-2)', borderBottom: '1px solid var(--wv-border)' }}>
                          {['Date', 'Type', 'Amount (₹)', 'NAV (₹)', 'Units', 'Stamp Duty', 'Running Units', ''].map(col => (
                            <th key={col || 'actions'} className="px-3 py-2 text-left font-semibold whitespace-nowrap"
                              style={{ color: 'var(--wv-text-secondary)' }}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {txnsVisible.map(t => {
                          const cfg    = TXN_CONFIG[t.type] ?? { label: t.type, bg: 'var(--wv-border)', text: '#6B7280', sign: 1 };
                          const isBuy  = cfg.sign > 0;
                          const amount = Number(t.quantity) * Number(t.price);
                          const label  = txnLabel(t);
                          const isDeleting = deletingTxnId === t.id;
                          return (
                            <tr key={t.id} className="group" style={{ borderBottom: '1px solid #F7F5F0' }}>
                              <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--wv-text-secondary)' }}>
                                {fmtDate(t.date)}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-1">
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold whitespace-nowrap"
                                    style={{ backgroundColor: cfg.bg, color: cfg.text }}>
                                    {label}
                                  </span>
                                  {t.metadata?.is_nfo === true && (
                                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold"
                                      style={{ backgroundColor: 'rgba(37,99,235,0.12)', color: '#2563EB' }}>
                                      NFO
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2 font-semibold whitespace-nowrap"
                                style={{ color: isBuy ? '#059669' : '#DC2626' }}>
                                {isBuy ? '+' : '−'}{formatLargeINR(amount)}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--wv-text-secondary)' }}>
                                {Number(t.price).toFixed(4)}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap font-medium"
                                style={{ color: isBuy ? '#059669' : '#DC2626' }}>
                                {isBuy ? '+' : '−'}{fmtUnits(t.quantity)}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--wv-text-muted)' }}>
                                {(() => { const sd = getTxnStampDuty(t); return sd > 0 ? `₹${sd.toFixed(2)}` : '—'; })()}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap font-semibold" style={{ color: 'var(--wv-text)' }}>
                                {fmtUnits(runningMap[t.id] ?? 0)}
                              </td>
                              <td className="px-2 py-2 whitespace-nowrap">
                                <div className="flex items-center gap-1">
                                  <button
                                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-blue-50 transition-all"
                                    onClick={() => {
                                      if ((t.metadata as Record<string, unknown> | null)?.stp_link_id) {
                                        alert('STP transactions cannot be edited directly. Please delete and recreate if changes are needed.');
                                        return;
                                      }
                                      if (t.type === 'buy' || t.type === 'sip') {
                                        if (h.portfolios) {
                                          sessionStorage.setItem('wv_prefill_family', (h.portfolios as unknown as { family_id?: string }).family_id ?? '');
                                          sessionStorage.setItem('wv_prefill_member', (h.portfolios as unknown as { user_id?: string }).user_id ?? '');
                                          sessionStorage.setItem('wv_prefill_active', 'true');
                                        }
                                        onClose();
                                        router.push(`/add-assets/mutual-funds?edit_transaction=${t.id}`);
                                      } else if (t.type === 'sell' || t.type === 'dividend') {
                                        setView('edit-transactions');
                                        setEditingTxn(t);
                                      }
                                    }}
                                    title="Edit transaction">
                                    <Pencil className="w-3 h-3" style={{ color: '#3B82F6' }} />
                                  </button>
                                  <button
                                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 transition-all"
                                    disabled={isDeleting}
                                    onClick={() => {
                                      const isStpTxn = !!(t.metadata as Record<string, unknown> | null)?.stp_link_id;
                                      const counterpart = String((t.metadata as Record<string, unknown> | null)?.stp_counterpart_scheme_name ?? '');
                                      const msg = isStpTxn
                                        ? `This is part of an STP. Deleting this will also delete the linked transaction on "${counterpart}". Both holdings will be recalculated. Continue?`
                                        : `Delete this ${label} transaction from ${fmtDate(t.date)}? The holding's quantity and average NAV will be recalculated.`;
                                      if (!confirm(msg)) return;
                                      handleDeleteTransaction(t.id);
                                    }}
                                    title="Delete transaction">
                                    {isDeleting
                                      ? <Loader2 className="w-3 h-3 animate-spin" style={{ color: '#DC2626' }} />
                                      : <Trash2 className="w-3 h-3" style={{ color: '#DC2626' }} />}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Summary footer */}
                  <div className="px-4 py-2.5 flex items-center gap-5 flex-wrap"
                    style={{ backgroundColor: 'var(--wv-surface-2)', borderTop: '1px solid var(--wv-border)' }}>
                    <span className="text-[10px]" style={{ color: 'var(--wv-text-secondary)' }}>
                      Buy txns: <strong style={{ color: 'var(--wv-text)' }}>{buyTxns.length}</strong>
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--wv-text-secondary)' }}>
                      Total invested: <strong style={{ color: 'var(--wv-text)' }}>{formatLargeINR(totalBuyAmt)}</strong>
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--wv-text-secondary)' }}>
                      Units accumulated: <strong style={{ color: 'var(--wv-text)' }}>{fmtUnits(totalBuyUnits)}</strong>
                    </span>
                    {sellTxns.length > 0 && (
                      <span className="text-[10px]" style={{ color: 'var(--wv-text-secondary)' }}>
                        Redeemed: <strong style={{ color: '#DC2626' }}>{formatLargeINR(totalSellAmt)}</strong>
                      </span>
                    )}
                    {totalStampDuty > 0 && (
                      <span className="text-[10px]" style={{ color: 'var(--wv-text-secondary)' }}>
                        Stamp duty: <strong style={{ color: 'var(--wv-text-muted)' }}>₹{totalStampDuty.toFixed(2)}</strong>
                      </span>
                    )}
                  </div>
                </div>

                {/* Load more */}
                {hasMore && (
                  <button
                    onClick={() => setVisibleCount(v => v + 20)}
                    className="w-full mt-3 py-2 rounded-xl text-xs font-medium transition-colors"
                    style={{ backgroundColor: 'var(--wv-surface-2)', color: 'var(--wv-text-secondary)', border: '1px solid var(--wv-border)' }}>
                    Load more ({txnsFiltered.length - visibleCount} remaining)
                  </button>
                )}

                {/* Note for old consolidated holdings */}
                {isConsolidated && recalcState !== 'done' && (
                  <p className="text-[10px] mt-2 px-1" style={{ color: 'var(--wv-text-muted)' }}>
                    Showing consolidated SIP entry. Click &quot;Expand SIP History&quot; above to generate individual monthly rows.
                  </p>
                )}
              </>
            )}
          </div>

          {/* ── Holder Details (collapsible) ── */}
          {hasHolderData && (
            <div className="border-b" style={{ borderColor: 'var(--wv-border)' }}>
              <button
                onClick={() => setShowHolder(!showHolder)}
                className="w-full flex items-center justify-between px-6 py-3 text-left hover:bg-gray-50 transition-colors"
              >
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--wv-text-muted)' }}>
                  Holder &amp; Contact Details
                </p>
                {showHolder
                  ? <ChevronUp className="w-3.5 h-3.5" style={{ color: 'var(--wv-text-muted)' }} />
                  : <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--wv-text-muted)' }} />}
              </button>
              {showHolder && (
                <div className="px-6 pb-4 space-y-1.5">
                  {([
                    meta.first_holder  && ['First Holder',  String(meta.first_holder)],
                    meta.second_holder && ['Second Holder', String(meta.second_holder)],
                    meta.nominee       && ['Nominee',       String(meta.nominee)],
                    meta.mobile        && ['Mobile',        String(meta.mobile)],
                    meta.email         && ['Email',         String(meta.email)],
                    (meta.bank_name || meta.bank_last4) && ['Bank',
                      [meta.bank_name ? String(meta.bank_name) : '', meta.bank_last4 ? `****${String(meta.bank_last4)}` : ''].filter(Boolean).join(' - ')],
                    meta.pan           && ['PAN',           `XXXXX${String(meta.pan).slice(-4)}`],
                  ] as Array<false | [string, string]>)
                    .filter((row): row is [string, string] => !!row)
                    .map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between py-1.5 border-b"
                        style={{ borderColor: '#F7F5F0' }}>
                        <span className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{label}</span>
                        <span className="text-[11px] font-medium" style={{ color: 'var(--wv-text)' }}>{value}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* ── Redemption form ── */}
          {showRedeem && (
            <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--wv-border)' }}>
              <RedemptionForm
                holdingId={h.id} symbol={h.symbol} maxUnits={Number(h.quantity)} currentNav={h.currentNav}
                buyTxns={h.transactions.filter(t => t.type === 'buy' || t.type === 'sip')}
                onSuccess={() => { setShowRedeem(false); setRedeemDone(true); onHoldingChanged(); }}
                onCancel={() => setShowRedeem(false)}
              />
            </div>
          )}
          {redeemDone && (
            <div className="mx-6 my-3 flex items-center gap-2 p-3 rounded-xl text-xs"
              style={{ backgroundColor: 'rgba(5,150,105,0.08)', color: '#059669' }}>
              ✓ Redemption recorded successfully.
            </div>
          )}

          {/* ── Dividend form ── */}
          {showDividend && (
            <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--wv-border)' }}>
              <DividendForm
                holdingId={h.id}
                onSuccess={() => { setShowDividend(false); setDividendDone(true); onHoldingChanged(); }}
                onCancel={() => setShowDividend(false)}
              />
            </div>
          )}
          {dividendDone && (
            <div className="mx-6 my-3 flex items-center gap-2 p-3 rounded-xl text-xs"
              style={{ backgroundColor: 'rgba(5,150,105,0.08)', color: '#059669' }}>
              ✓ Dividend recorded successfully.
            </div>
          )}
        </div>

        {/* ── Edit Transactions view ───────────────────────────────────────────── */}
        {view === 'edit-transactions' && (
          <div className="flex-1 overflow-y-auto">
            <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--wv-border)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--wv-text-muted)' }}>
                Edit Transactions ({h.transactions.length} total)
              </p>
              <p className="text-[11px]" style={{ color: 'var(--wv-text-secondary)' }}>
                Pencil edits a single transaction · Trash deletes it permanently
              </p>
              {txnDeleteError && (
                <p className="text-[11px] mt-1 font-medium" style={{ color: '#DC2626' }}>{txnDeleteError}</p>
              )}
            </div>
            <div>
              {/* Inline edit form for sell/dividend */}
              {editingTxn && editingTxn.type === 'sell' && (
                <div className="px-6 py-4 border-b" style={{ borderColor: '#FDE68A', backgroundColor: '#FFFBEB' }}>
                  <RedemptionForm
                    holdingId={h.id} symbol={h.symbol}
                    maxUnits={Number(h.quantity)}
                    currentNav={h.currentNav}
                    buyTxns={h.transactions.filter(t => t.type === 'buy' || t.type === 'sip')}
                    editingTxn={editingTxn}
                    onSuccess={() => { setEditingTxn(null); onHoldingChanged(); }}
                    onCancel={() => setEditingTxn(null)}
                  />
                </div>
              )}
              {editingTxn && editingTxn.type === 'dividend' && (
                <div className="px-6 py-4 border-b" style={{ borderColor: '#FDE68A', backgroundColor: '#FFFBEB' }}>
                  <DividendForm
                    holdingId={h.id}
                    editingTxn={editingTxn}
                    onSuccess={() => { setEditingTxn(null); onHoldingChanged(); }}
                    onCancel={() => setEditingTxn(null)}
                  />
                </div>
              )}

              {(h.transactions ?? []).length === 0 ? (
                <p className="px-6 py-8 text-xs text-center" style={{ color: 'var(--wv-text-muted)' }}>No transactions found</p>
              ) : [...(h.transactions ?? [])]
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .map(t => {
                  const cfg        = TXN_CONFIG[t.type] ?? { label: t.type, bg: 'var(--wv-border)', text: '#6B7280', sign: 1 };
                  const amt        = Number(t.quantity) * Number(t.price);
                  const lbl        = txnLabel(t);
                  const isConfirming  = txnDeleteConfirmId === t.id;
                  const isDeleting    = deletingTxnId === t.id;
                  const isBeingEdited = editingTxn?.id === t.id;
                  return (
                    <div key={t.id} className="border-b px-6 py-3"
                      style={{ borderColor: '#F7F5F0', backgroundColor: isBeingEdited ? 'rgba(201,168,76,0.05)' : undefined }}>
                      {isConfirming ? (
                        <div className="rounded-xl border p-3 space-y-2"
                          style={{ borderColor: 'rgba(220,38,38,0.25)', backgroundColor: 'rgba(220,38,38,0.02)' }}>
                          <p className="text-[11px] font-semibold" style={{ color: '#DC2626' }}>
                            Delete this {lbl} transaction from {fmtDate(t.date)} for {formatLargeINR(amt)}?
                            {t.type === 'sell' && ' (sold units will be restored)'}
                            {t.type === 'dividend' && t.notes?.includes('Reinvestment') && ' (reinvested units will be removed)'}
                          </p>
                          <div className="flex gap-2">
                            <Button onClick={() => handleDeleteTransaction(t.id)} disabled={isDeleting}
                              className="h-7 px-3 text-[11px]"
                              style={{ backgroundColor: '#DC2626', color: 'white' }}>
                              {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Delete'}
                            </Button>
                            <Button variant="outline" onClick={() => setTxnDeleteConfirmId(null)} disabled={isDeleting}
                              className="h-7 px-3 text-[11px]" style={{ borderColor: 'var(--wv-border)', color: 'var(--wv-text-secondary)' }}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] flex-shrink-0 w-24" style={{ color: 'var(--wv-text-secondary)' }}>
                            {fmtDate(t.date)}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold whitespace-nowrap flex-shrink-0"
                            style={{ backgroundColor: cfg.bg, color: cfg.text }}>{lbl}</span>
                          {/* NFO toggle (buy/sip only) */}
                          {(t.type === 'buy' || t.type === 'sip') && (
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleTxnNfo(t); }}
                              disabled={nfoTogglingId === t.id}
                              title={t.metadata?.is_nfo === true ? 'Unmark as NFO purchase' : 'Mark as NFO purchase (locks NAV to ₹10)'}
                              className="flex-shrink-0 transition-opacity hover:opacity-80"
                            >
                              {nfoTogglingId === t.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" style={{ color: '#2563EB' }} />
                              ) : (
                                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold"
                                  style={t.metadata?.is_nfo === true
                                    ? { backgroundColor: 'rgba(37,99,235,0.15)', color: '#2563EB' }
                                    : { backgroundColor: 'var(--wv-border)', color: '#D1D5DB', border: '1px dashed #E5E7EB' }}>
                                  NFO
                                </span>
                              )}
                            </button>
                          )}
                          <span className="text-[11px] font-semibold flex-1 text-right" style={{ color: 'var(--wv-text)' }}>
                            {formatLargeINR(amt)}
                          </span>
                          <span className="text-[11px] flex-shrink-0 w-20 text-right" style={{ color: 'var(--wv-text-muted)' }}>
                            ₹{Number(t.price).toFixed(4)}
                          </span>
                          <span className="text-[11px] flex-shrink-0 w-16 text-right" style={{ color: 'var(--wv-text-secondary)' }}>
                            {fmtUnits(t.quantity)}
                          </span>
                          <button
                            onClick={() => {
                              if (t.type === 'buy' || t.type === 'sip') {
                                router.push(`/add-assets/mutual-funds?edit_transaction=${t.id}`);
                                onClose();
                              } else {
                                setEditingTxn(isBeingEdited ? null : t);
                              }
                            }}
                            className="flex-shrink-0 p-1.5 rounded-lg transition-colors"
                            style={{
                              backgroundColor: isBeingEdited ? 'rgba(201,168,76,0.15)' : 'rgba(27,42,74,0.06)',
                              color: isBeingEdited ? '#C9A84C' : '#1B2A4A',
                            }}
                            title="Edit transaction"
                          >
                            <Edit className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => { setTxnDeleteConfirmId(t.id); setTxnDeleteError(''); setEditingTxn(null); }}
                            className="flex-shrink-0 p-1.5 rounded-lg transition-colors"
                            style={{ backgroundColor: 'rgba(220,38,38,0.06)', color: '#DC2626' }}
                            title="Delete transaction"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* ── Action footer ────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 px-6 py-4 border-t space-y-2"
          style={{ borderColor: 'var(--wv-border)', backgroundColor: '#FAFAF8' }}>
          {view === 'edit-transactions' ? (
            <Button variant="outline" onClick={() => setView('detail')} className="w-full h-9 text-[11px]"
              style={{ borderColor: 'var(--wv-border)', color: 'var(--wv-text-secondary)' }}>
              ← Back to Overview
            </Button>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={() => { router.push(`/add-assets/mutual-funds?add_to=${h.id}`); onClose(); }}
                  className="h-9 text-[11px] font-semibold"
                  style={{ backgroundColor: '#1B2A4A', color: 'white' }}>
                  <Plus className="w-3 h-3 mr-1" />Add Lump Sum
                </Button>
                <Button
                  onClick={() => { router.push(`/add-assets/mutual-funds?add_to=${h.id}&sip=1`); onClose(); }}
                  className="h-9 text-[11px] font-semibold"
                  style={{ backgroundColor: 'rgba(201,168,76,0.12)', color: '#B8922A', border: '1px solid rgba(201,168,76,0.35)' }}>
                  <RefreshCw className="w-3 h-3 mr-1" />Add SIP
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" onClick={() => { setRedeemDone(false); setDividendDone(false); setShowRedeem(!showRedeem); if (showDividend) setShowDividend(false); }}
                  className="h-9 text-[11px]" style={{ borderColor: 'var(--wv-border)', color: 'var(--wv-text-secondary)' }}>
                  {showRedeem ? 'Cancel' : 'Redeem'}
                </Button>
                <Button variant="outline" onClick={() => { setDividendDone(false); setRedeemDone(false); setShowDividend(!showDividend); if (showRedeem) setShowRedeem(false); }}
                  className="h-9 text-[11px]" style={{ borderColor: 'rgba(5,150,105,0.3)', color: '#059669' }}>
                  {showDividend ? 'Cancel' : 'Dividend'}
                </Button>
                <Button variant="outline"
                  onClick={() => setView('edit-transactions')}
                  className="h-9 text-[11px]" style={{ borderColor: 'var(--wv-border)', color: 'var(--wv-text-secondary)' }}>
                  <Edit className="w-3 h-3 mr-1" />Edit
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline"
                  onClick={async () => {
                    setStpMode('from');
                    setStpDate(new Date().toISOString().split('T')[0]);
                    setStpAmount('');
                    setStpSourceHoldingId('');
                    setStpError('');
                    // Fetch same-AMC holdings in user's portfolio (excluding current)
                    const currentFundHouse = String((h.metadata as Record<string, unknown> | null)?.fund_house ?? '').toLowerCase();
                    const amcKey = currentFundHouse.replace(/mutual fund|mahindra/gi, '').trim().split(/\s+/)[0];
                    const { data } = await supabase
                      .from('holdings')
                      .select('id, symbol, name, quantity, metadata')
                      .eq('asset_type', 'mutual_fund')
                      .neq('id', h.id)
                      .gt('quantity', 0);
                    const sameAmc = (data ?? []).filter(x => {
                      const fh = String((x.metadata as Record<string, unknown> | null)?.fund_house ?? '').toLowerCase();
                      return amcKey && fh.includes(amcKey);
                    });
                    setStpSameAmcHoldings(sameAmc);
                  }}
                  className="h-9 text-[11px]" style={{ borderColor: 'rgba(37,99,235,0.3)', color: '#2563EB' }}>
                  <ArrowDownLeft className="w-3 h-3 mr-1" />STP From
                </Button>
                <Button variant="outline"
                  onClick={() => {
                    setStpMode('to');
                    setStpDate(new Date().toISOString().split('T')[0]);
                    setStpAmount('');
                    setStpDestQuery('');
                    setStpDestResults([]);
                    setStpDestSelected(null);
                    setStpError('');
                  }}
                  className="h-9 text-[11px]" style={{ borderColor: 'rgba(124,58,237,0.3)', color: '#7C3AED' }}>
                  <ArrowUpRight className="w-3 h-3 mr-1" />STP To
                </Button>
              </div>
              <Button onClick={handleDelete} disabled={deleting}
                className="w-full h-9 text-[11px]"
                style={{ backgroundColor: 'rgba(220,38,38,0.06)', color: '#DC2626', border: '1px solid rgba(220,38,38,0.15)' }}>
                {deleting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Trash2 className="w-3 h-3 mr-1" />}
                Delete Holding &amp; All Transactions
              </Button>
            </>
          )}
        </div>

        {/* Re-link Scheme Dialog */}
        {showRelink && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(27,42,74,0.6)', backdropFilter: 'blur(4px)' }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-5 space-y-3 max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold" style={{ color: 'var(--wv-text)' }}>Re-link Scheme</p>
                <button onClick={() => setShowRelink(false)} className="text-gray-400 hover:text-gray-600">✕</button>
              </div>
              <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--wv-surface-2)', border: '1px solid var(--wv-border)' }}>
                <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--wv-text-muted)' }}>Current</p>
                <p className="text-xs font-semibold mt-0.5" style={{ color: 'var(--wv-text)' }}>{h.name}</p>
                <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>AMFI {h.symbol}{h.navDate && ` · Last NAV: ${h.navDate}`}</p>
              </div>
              <div>
                <Label className="text-xs">Search for active scheme</Label>
                <Input
                  value={relinkQuery}
                  onChange={async (e) => {
                    const q = e.target.value;
                    setRelinkQuery(q);
                    if (q.length < 2) { setRelinkResults([]); return; }
                    setRelinkSearching(true);
                    try {
                      const res = await fetch(`/api/mf/search?q=${encodeURIComponent(q)}`);
                      const data = await res.json();
                      setRelinkResults(data.results ?? []);
                    } finally { setRelinkSearching(false); }
                  }}
                  placeholder="e.g. Kotak Multi Asset"
                  className="h-9 text-xs mt-1"
                  autoFocus
                />
              </div>
              {relinkSearching && <p className="text-[11px]" style={{ color: 'var(--wv-text-muted)' }}>Searching...</p>}
              {relinkResults.length > 0 && (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {relinkResults.map(r => {
                    const isStale = r.isStale || (r.daysSinceUpdate != null && r.daysSinceUpdate > 90);
                    const isVeryStale = r.daysSinceUpdate != null && r.daysSinceUpdate > 365;
                    return (
                      <button key={r.schemeCode}
                        disabled={relinking || isVeryStale}
                        onClick={async () => {
                          setRelinking(true);
                          try {
                            const res = await fetch('/api/mf/relink-scheme', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ holdingId: h.id, newSchemeCode: String(r.schemeCode), newSchemeName: r.schemeName }),
                            });
                            const data = await res.json();
                            if (!res.ok) { alert(data.error || 'Failed to re-link'); return; }
                            setShowRelink(false);
                            onHoldingChanged();
                            onClose();
                          } finally { setRelinking(false); }
                        }}
                        className="w-full text-left p-2.5 rounded-lg border hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ borderColor: 'var(--wv-border)' }}>
                        <p className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>{r.schemeName}</p>
                        <p className="text-[10px] mt-0.5" style={{ color: 'var(--wv-text-muted)' }}>
                          AMFI {r.schemeCode}
                          {r.latestNav != null && <> · NAV ₹{r.latestNav.toFixed(4)}</>}
                          {r.latestDate && <> · <span style={{ color: isVeryStale ? '#DC2626' : isStale ? '#D97706' : '#059669' }}>{r.latestDate}{r.daysSinceUpdate != null && r.daysSinceUpdate > 30 ? ` (${r.daysSinceUpdate}d ago)` : ''}</span></>}
                          {isVeryStale && <span className="ml-1" style={{ color: '#DC2626' }}>(Inactive)</span>}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* STP Dialog */}
        {stpMode && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(27,42,74,0.6)', backdropFilter: 'blur(4px)' }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-5 space-y-3 max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold" style={{ color: 'var(--wv-text)' }}>
                  {stpMode === 'from' ? `STP Into ${h.name}` : `STP Out of ${h.name}`}
                </p>
                <button onClick={() => setStpMode(null)} className="text-gray-400 hover:text-gray-600">✕</button>
              </div>

              {stpError && <p className="text-xs" style={{ color: '#DC2626' }}>{stpError}</p>}

              {/* Source fund selector (STP From) */}
              {stpMode === 'from' && (
                <div className="space-y-1">
                  <Label className="text-xs">Source Fund (same AMC, from your portfolio)</Label>
                  {stpSameAmcHoldings.length === 0 ? (
                    <p className="text-[11px] p-2 rounded-lg" style={{ backgroundColor: 'rgba(217,119,6,0.06)', color: '#D97706', border: '1px solid rgba(217,119,6,0.15)' }}>
                      No other funds from the same AMC found in your portfolio.
                    </p>
                  ) : (
                    <Select value={stpSourceHoldingId} onValueChange={setStpSourceHoldingId}>
                      <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Pick source fund" /></SelectTrigger>
                      <SelectContent>
                        {stpSameAmcHoldings.map(s => (
                          <SelectItem key={s.id} value={s.id} className="text-xs">
                            {s.name} · {fmtUnits(s.quantity)} units
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {/* Destination fund search (STP To) */}
              {stpMode === 'to' && (
                <div className="space-y-1">
                  <Label className="text-xs">Destination Fund (same AMC, searches new or existing)</Label>
                  <Input
                    value={stpDestQuery}
                    onChange={async (e) => {
                      const q = e.target.value;
                      setStpDestQuery(q);
                      if (q.length < 2) { setStpDestResults([]); return; }
                      setStpDestSearching(true);
                      try {
                        const currentFundHouse = String((h.metadata as Record<string, unknown> | null)?.fund_house ?? '');
                        const res = await fetch(`/api/mf/search?q=${encodeURIComponent(q)}&amc=${encodeURIComponent(currentFundHouse)}`);
                        const data = await res.json();
                        setStpDestResults(data.results ?? []);
                      } finally { setStpDestSearching(false); }
                    }}
                    placeholder="e.g. Kotak Flexi Cap"
                    className="h-9 text-xs"
                    autoFocus
                  />
                  {stpDestSelected && (
                    <div className="p-2 rounded-lg mt-1 text-xs" style={{ backgroundColor: 'rgba(5,150,105,0.06)', border: '1px solid rgba(5,150,105,0.2)', color: '#059669' }}>
                      Selected: <strong>{stpDestSelected.schemeName}</strong> (AMFI {stpDestSelected.schemeCode})
                    </div>
                  )}
                  {!stpDestSelected && stpDestResults.length > 0 && (
                    <div className="max-h-40 overflow-y-auto border rounded-lg mt-1" style={{ borderColor: 'var(--wv-border)' }}>
                      {stpDestResults.map(r => (
                        <button key={r.schemeCode} onClick={() => setStpDestSelected(r)}
                          className="w-full text-left p-2 hover:bg-gray-50 border-b last:border-0" style={{ borderColor: 'var(--wv-border)' }}>
                          <p className="text-xs font-medium">{r.schemeName}</p>
                          <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                            AMFI {r.schemeCode}
                            {r.latestNav != null && <> · NAV ₹{r.latestNav.toFixed(4)}</>}
                            {r.latestDate && <> · {r.latestDate}</>}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                  {stpDestSearching && <p className="text-[11px]" style={{ color: 'var(--wv-text-muted)' }}>Searching...</p>}
                </div>
              )}

              {/* Date + Amount */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Date *</Label>
                  <Input type="date" value={stpDate} onChange={e => setStpDate(e.target.value)}
                    className="h-9 text-xs" max={new Date().toISOString().split('T')[0]} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Amount (₹) *</Label>
                  <Input type="number" value={stpAmount} onChange={e => setStpAmount(e.target.value)}
                    placeholder="50000" className="h-9 text-xs" />
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button
                  disabled={stpSaving ||
                    !stpDate || !stpAmount ||
                    (stpMode === 'from' && !stpSourceHoldingId) ||
                    (stpMode === 'to' && !stpDestSelected)}
                  onClick={async () => {
                    setStpSaving(true);
                    setStpError('');
                    try {
                      const body: Record<string, unknown> = {
                        date: stpDate,
                        amount: parseFloat(stpAmount),
                      };
                      if (stpMode === 'from') {
                        // Source is the other fund; destination is h
                        body.sourceHoldingId = stpSourceHoldingId;
                        body.destinationHoldingId = h.id;
                      } else {
                        // Source is h; destination is new or existing
                        body.sourceHoldingId = h.id;
                        body.destinationSchemeCode = String(stpDestSelected!.schemeCode);
                        body.destinationSchemeName = stpDestSelected!.schemeName;
                        // Pass portfolio/member/family context from h's portfolio
                        const portfolios = (h as unknown as { portfolios?: { id: string; name: string; user_id: string; family_id?: string } }).portfolios;
                        body.portfolioName = portfolios?.name;
                        body.memberId = portfolios?.user_id;
                        body.familyId = portfolios?.family_id;
                        body.brokerId = (h as unknown as { brokers?: { id: string } }).brokers?.id;
                        body.destinationFundHouse = (h.metadata as Record<string, unknown> | null)?.fund_house;
                      }

                      const res = await fetch('/api/mf/stp', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                      });
                      const data = await res.json();
                      if (!res.ok) { setStpError(data.error || 'STP failed'); return; }
                      setStpMode(null);
                      onHoldingChanged();
                      onClose();
                    } catch (err) {
                      setStpError(String(err));
                    } finally {
                      setStpSaving(false);
                    }
                  }}
                  className="flex-1 h-9 text-xs font-semibold text-white"
                  style={{ backgroundColor: '#1B2A4A' }}>
                  {stpSaving ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Processing...</> : 'Execute STP'}
                </Button>
                <Button variant="outline" onClick={() => setStpMode(null)} disabled={stpSaving}
                  className="h-9 text-xs">Cancel</Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
