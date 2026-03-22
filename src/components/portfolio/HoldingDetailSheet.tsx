'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  TrendingUp, TrendingDown, Loader2, X,
  ChevronDown, ChevronUp, BarChart3, Plus, Trash2, Edit, RefreshCw, AlertCircle,
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
  Equity:      { bg: 'rgba(27,42,74,0.10)',   text: '#1B2A4A' },
  ELSS:        { bg: '#F5EDD6',               text: '#C9A84C' },
  Hybrid:      { bg: 'rgba(46,139,139,0.10)', text: '#2E8B8B' },
  Debt:        { bg: 'rgba(5,150,105,0.10)',  text: '#059669' },
  Liquid:      { bg: 'rgba(5,150,105,0.10)',  text: '#059669' },
  Gilt:        { bg: 'rgba(5,150,105,0.10)',  text: '#059669' },
  'Index/ETF': { bg: 'rgba(27,42,74,0.10)',   text: '#1B2A4A' },
};
function catStyle(cat: string) { return CAT_COLORS[cat] ?? { bg: '#F3F4F6', text: '#6B7280' }; }

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

function RedemptionForm({
  holdingId, maxUnits, currentNav, onSuccess, onCancel,
}: {
  holdingId: string; maxUnits: number; currentNav: number | null;
  onSuccess: () => void; onCancel: () => void;
}) {
  const supabase = createClient();
  const [units,    setUnits]    = useState('');
  const [sellNav,  setSellNav]  = useState(currentNav?.toFixed(4) ?? '');
  const [sellDate, setSellDate] = useState(new Date().toISOString().split('T')[0]);
  const [reason,   setReason]   = useState('');
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState('');

  async function submit() {
    const u = parseFloat(units), n = parseFloat(sellNav);
    if (!u || u <= 0 || u > maxUnits) { setErr(`Enter up to ${maxUnits.toFixed(4)} units`); return; }
    if (!n || n <= 0)                  { setErr('Enter a valid sell NAV'); return; }
    setSaving(true); setErr('');
    const { error } = await supabase.from('transactions').insert({
      holding_id: holdingId, type: 'sell', quantity: u, price: n, date: sellDate, fees: 0,
      notes: reason || null,
    });
    if (error) { setErr(error.message); setSaving(false); return; }
    await supabase.from('holdings').update({ quantity: maxUnits - u }).eq('id', holdingId);
    onSuccess();
  }

  return (
    <div className="rounded-xl border p-4 space-y-3"
      style={{ borderColor: 'rgba(220,38,38,0.25)', backgroundColor: 'rgba(220,38,38,0.02)' }}>
      <p className="text-xs font-semibold" style={{ color: '#DC2626' }}>Record Redemption</p>
      {err && <p className="text-[11px]" style={{ color: '#DC2626' }}>{err}</p>}
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px]" style={{ color: '#6B7280' }}>Units</Label>
          <Input value={units} onChange={e => setUnits(e.target.value)}
            placeholder={`Max ${maxUnits.toFixed(4)}`} type="number" step="0.0001" className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px]" style={{ color: '#6B7280' }}>Sell NAV (₹)</Label>
          <Input value={sellNav} onChange={e => setSellNav(e.target.value)}
            type="number" step="0.0001" className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px]" style={{ color: '#6B7280' }}>Date</Label>
          <Input value={sellDate} onChange={e => setSellDate(e.target.value)}
            type="date" className="h-8 text-xs" max={new Date().toISOString().split('T')[0]} />
        </div>
      </div>
      <Input value={reason} onChange={e => setReason(e.target.value)}
        placeholder="Reason (optional)" className="h-8 text-xs" />
      {units && sellNav && (
        <p className="text-[11px]" style={{ color: '#6B7280' }}>
          Value: <strong>{formatLargeINR(parseFloat(units) * parseFloat(sellNav))}</strong>
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={submit} disabled={saving} className="flex-1 h-8 text-xs"
          style={{ backgroundColor: '#DC2626', color: 'white' }}>
          {saving && <Loader2 className="w-3 h-3 animate-spin mr-1" />}Confirm Redemption
        </Button>
        <Button variant="outline" onClick={onCancel} className="h-8 text-xs"
          style={{ borderColor: '#E8E5DD', color: '#6B7280' }}>Cancel</Button>
      </div>
    </div>
  );
}

// ─── Main Sheet ───────────────────────────────────────────────────────────────

type RecalcState = 'idle' | 'loading' | 'confirm' | 'saving' | 'done';

export function HoldingDetailSheet({
  holding, open, onClose, onDeleted, onHoldingChanged,
}: {
  holding: HoldingDetail | null; open: boolean;
  onClose: () => void; onDeleted: (id: string) => void; onHoldingChanged: () => void;
}) {
  const router   = useRouter();
  const supabase = createClient();

  const [showHolder,  setShowHolder]  = useState(false);
  const [showRedeem,  setShowRedeem]  = useState(false);
  const [deleting,    setDeleting]    = useState(false);
  const [redeemDone,  setRedeemDone]  = useState(false);
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

  useEffect(() => {
    if (!open) { setView('detail'); setTxnDeleteConfirmId(null); setTxnDeleteError(''); }
  }, [open]);

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
      cum = Math.max(0, cum + sign * Number(t.quantity));
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

  // ── Summary stats ───────────────────────────────────────────────────────────
  const buyTxns        = h.transactions.filter(t => t.type === 'buy' || t.type === 'sip');
  const sellTxns       = h.transactions.filter(t => t.type === 'sell');
  const totalBuyAmt    = buyTxns.reduce((s, t) => s + Number(t.quantity) * Number(t.price), 0);
  const totalSellAmt   = sellTxns.reduce((s, t) => s + Number(t.quantity) * Number(t.price), 0);
  const totalStampDuty = buyTxns.reduce((s, t) => s + Number(t.fees ?? 0), 0);
  const totalBuyUnits  = buyTxns.reduce((s, t) => s + Number(t.quantity), 0);

  // ── Delete holding ──────────────────────────────────────────────────────────
  async function handleDelete() {
    if (!confirm(`Delete "${h.name}" and all its transactions? This cannot be undone.`)) return;
    setDeleting(true);
    await supabase.from('transactions').delete().eq('holding_id', h.id);
    await supabase.from('holdings').delete().eq('id', h.id);
    onDeleted(h.id);
    onClose();
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

  // ── Stat tiles ─────────────────────────────────────────────────────────────
  const statTiles = [
    { label: 'Total Invested', value: formatLargeINR(h.investedValue),                color: undefined },
    { label: 'Current Value',  value: h.currentValue ? formatLargeINR(h.currentValue) : '—', color: undefined },
    { label: 'Total Units',    value: Number(h.quantity).toFixed(4),                  color: undefined },
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
    { label: 'Broker',    value: h.brokers?.name ?? '—',             color: undefined },
    { label: 'Folio',     value: meta.folio ? String(meta.folio) : '—', color: undefined },
    { label: 'Portfolio', value: h.portfolios?.name ?? '—',          color: undefined },
  ];

  const hasHolderData = !!(meta.first_holder || meta.mobile || meta.email || meta.bank_name || meta.bank_last4 || meta.pan);

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
              <div className="flex items-center gap-2 mb-1.5">
                {cat && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: catStyle(cat).bg, color: catStyle(cat).text }}>{cat}</span>
                )}
                {isSIP && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: 'rgba(201,168,76,0.25)', color: '#C9A84C' }}>SIP</span>
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
          <div className="px-6 py-4 border-b" style={{ borderColor: '#E8E5DD' }}>
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
                style={{ backgroundColor: '#F7F5F0', border: '1px solid #E8E5DD' }}>
                <BarChart3 className="w-3.5 h-3.5" style={{ color: '#9CA3AF' }} />
                <span className="text-xs font-semibold" style={{ color: '#1A1A2E' }}>
                  {h.currentNav
                    ? `₹${h.currentNav.toFixed(4)}`
                    : <Loader2 className="w-3 h-3 animate-spin inline" style={{ color: '#9CA3AF' }} />}
                </span>
                {h.navDate && <span className="text-[10px]" style={{ color: '#9CA3AF' }}>NAV · {h.navDate}</span>}
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
                <div key={label} className="p-2.5 rounded-xl" style={{ backgroundColor: '#F7F5F0' }}>
                  <p className="text-[9px] uppercase tracking-wider mb-1" style={{ color: '#9CA3AF' }}>{label}</p>
                  <p className="text-[11px] font-semibold leading-tight" style={{ color: color ?? '#1A1A2E' }}>{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── SIP Summary Cards ── */}
          {isSIP && sipList.length > 0 && (
            <div className="px-6 py-4 border-b" style={{ borderColor: '#E8E5DD' }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#9CA3AF' }}>
                  Active SIPs ({sipList.length})
                </p>
                {/* Recalculate button */}
                {canRecalculate && recalcState === 'idle' && (
                  <button
                    onClick={startRecalculate}
                    className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors"
                    style={{ backgroundColor: isConsolidated ? '#FEF3C7' : '#F7F5F0',
                             color: isConsolidated ? '#B45309' : '#9CA3AF',
                             border: `1px solid ${isConsolidated ? '#FDE68A' : '#E8E5DD'}` }}>
                    <RefreshCw className="w-3 h-3" />
                    {isConsolidated ? 'Expand SIP History' : 'Recalculate Transactions'}
                  </button>
                )}
                {recalcState === 'loading' && (
                  <span className="flex items-center gap-1 text-[10px]" style={{ color: '#9CA3AF' }}>
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
                          className="px-3 py-1 rounded-lg text-[11px]" style={{ color: '#6B7280' }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {recalcState === 'saving' && (
                <div className="mb-3 flex items-center gap-2 text-[11px]" style={{ color: '#9CA3AF' }}>
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

              {/* SIP cards (clickable to filter) */}
              <div className={`grid gap-2 ${sipList.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {sipList.map((sip, i) => {
                  const filterKey = `sip-${i + 1}`;
                  const grp       = sipGroups.find(g => g.sipNum === i + 1);
                  const grpUnits  = grp ? grp.txns.reduce((s, t) => s + Number(t.quantity), 0) : sip.units;
                  const grpInvested = grp ? grp.txns.reduce((s, t) => s + Number(t.quantity) * Number(t.price), 0) : (sip.amount * sip.installments);
                  const grpCount  = grp?.txns.length ?? sip.installments;
                  const grpAvgNav = grpUnits > 0 ? grpInvested / grpUnits : 0;
                  const isActive  = activeFilter === filterKey;

                  return (
                    <button
                      key={i}
                      onClick={() => { setActiveFilter(isActive ? 'all' : filterKey); setVisibleCount(20); }}
                      className="text-left p-3 rounded-xl border transition-all"
                      style={{
                        borderColor: isActive ? 'rgba(201,168,76,0.5)' : '#E8E5DD',
                        backgroundColor: isActive ? 'rgba(201,168,76,0.08)' : 'rgba(27,42,74,0.01)',
                        boxShadow: isActive ? '0 0 0 2px rgba(201,168,76,0.2)' : 'none',
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold" style={{ color: '#C9A84C' }}>
                          SIP #{i + 1} — {formatLargeINR(sip.amount)}/month on {sip.date}
                        </span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                          style={{ backgroundColor: 'rgba(5,150,105,0.1)', color: '#059669' }}>Active</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-[10px]">
                        <div>
                          <p style={{ color: '#9CA3AF' }}>Started</p>
                          <p className="font-semibold mt-0.5" style={{ color: '#1A1A2E' }}>{fmtDate(sip.start_date)}</p>
                        </div>
                        <div>
                          <p style={{ color: '#9CA3AF' }}>Installments</p>
                          <p className="font-semibold mt-0.5" style={{ color: '#1A1A2E' }}>{grpCount}</p>
                        </div>
                        <div>
                          <p style={{ color: '#9CA3AF' }}>Units</p>
                          <p className="font-semibold mt-0.5" style={{ color: '#1A1A2E' }}>{grpUnits.toFixed(4)}</p>
                        </div>
                        <div>
                          <p style={{ color: '#9CA3AF' }}>Invested</p>
                          <p className="font-semibold mt-0.5" style={{ color: '#1A1A2E' }}>{formatLargeINR(grpInvested)}</p>
                        </div>
                        <div>
                          <p style={{ color: '#9CA3AF' }}>Avg NAV</p>
                          <p className="font-semibold mt-0.5" style={{ color: '#1A1A2E' }}>₹{grpAvgNav.toFixed(4)}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Transaction History ── */}
          <div className="px-6 py-4 border-b" style={{ borderColor: '#E8E5DD' }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#9CA3AF' }}>
                Transaction History ({txnsFiltered.length} of {h.transactions.length})
              </p>
              {meta.import === 'cas' && (
                <span className="text-[9px] px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: '#F7F5F0', color: '#9CA3AF' }}>CAS Import</span>
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
                      border: `1px solid ${activeFilter === key ? '#1B2A4A' : '#E8E5DD'}`,
                    }}>
                    {label}
                  </button>
                ))}
              </div>
            )}

            {h.transactions.length === 0 ? (
              <p className="text-xs py-4 text-center" style={{ color: '#9CA3AF' }}>No transactions recorded yet</p>
            ) : txnsFiltered.length === 0 ? (
              <p className="text-xs py-4 text-center" style={{ color: '#9CA3AF' }}>No transactions match this filter</p>
            ) : (
              <>
                <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#E8E5DD' }}>
                  <div className="overflow-x-auto">
                    <table className="w-full" style={{ fontSize: 11 }}>
                      <thead>
                        <tr style={{ backgroundColor: '#F7F5F0', borderBottom: '1px solid #E8E5DD' }}>
                          {['Date', 'Type', 'Amount (₹)', 'NAV (₹)', 'Units', 'Stamp Duty', 'Running Units'].map(col => (
                            <th key={col} className="px-3 py-2 text-left font-semibold whitespace-nowrap"
                              style={{ color: '#6B7280' }}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {txnsVisible.map(t => {
                          const cfg    = TXN_CONFIG[t.type] ?? { label: t.type, bg: '#F3F4F6', text: '#6B7280', sign: 1 };
                          const isBuy  = cfg.sign > 0;
                          const amount = Number(t.quantity) * Number(t.price);
                          const label  = txnLabel(t);
                          return (
                            <tr key={t.id} style={{ borderBottom: '1px solid #F7F5F0' }}>
                              <td className="px-3 py-2 whitespace-nowrap" style={{ color: '#6B7280' }}>
                                {fmtDate(t.date)}
                              </td>
                              <td className="px-3 py-2">
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold whitespace-nowrap"
                                  style={{ backgroundColor: cfg.bg, color: cfg.text }}>
                                  {label}
                                </span>
                              </td>
                              <td className="px-3 py-2 font-semibold whitespace-nowrap"
                                style={{ color: isBuy ? '#059669' : '#DC2626' }}>
                                {isBuy ? '+' : '−'}{formatLargeINR(amount)}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap" style={{ color: '#6B7280' }}>
                                {Number(t.price).toFixed(4)}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap font-medium"
                                style={{ color: isBuy ? '#059669' : '#DC2626' }}>
                                {isBuy ? '+' : '−'}{Number(t.quantity).toFixed(4)}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap" style={{ color: '#9CA3AF' }}>
                                {Number(t.fees) > 0 ? `₹${Number(t.fees).toFixed(2)}` : '—'}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap font-semibold" style={{ color: '#1A1A2E' }}>
                                {(runningMap[t.id] ?? 0).toFixed(4)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Summary footer */}
                  <div className="px-4 py-2.5 flex items-center gap-5 flex-wrap"
                    style={{ backgroundColor: '#F7F5F0', borderTop: '1px solid #E8E5DD' }}>
                    <span className="text-[10px]" style={{ color: '#6B7280' }}>
                      Buy txns: <strong style={{ color: '#1A1A2E' }}>{buyTxns.length}</strong>
                    </span>
                    <span className="text-[10px]" style={{ color: '#6B7280' }}>
                      Total invested: <strong style={{ color: '#1A1A2E' }}>{formatLargeINR(totalBuyAmt)}</strong>
                    </span>
                    <span className="text-[10px]" style={{ color: '#6B7280' }}>
                      Units accumulated: <strong style={{ color: '#1A1A2E' }}>{totalBuyUnits.toFixed(4)}</strong>
                    </span>
                    {sellTxns.length > 0 && (
                      <span className="text-[10px]" style={{ color: '#6B7280' }}>
                        Redeemed: <strong style={{ color: '#DC2626' }}>{formatLargeINR(totalSellAmt)}</strong>
                      </span>
                    )}
                    {totalStampDuty > 0 && (
                      <span className="text-[10px]" style={{ color: '#6B7280' }}>
                        Stamp duty: <strong style={{ color: '#9CA3AF' }}>₹{totalStampDuty.toFixed(2)}</strong>
                      </span>
                    )}
                  </div>
                </div>

                {/* Load more */}
                {hasMore && (
                  <button
                    onClick={() => setVisibleCount(v => v + 20)}
                    className="w-full mt-3 py-2 rounded-xl text-xs font-medium transition-colors"
                    style={{ backgroundColor: '#F7F5F0', color: '#6B7280', border: '1px solid #E8E5DD' }}>
                    Load more ({txnsFiltered.length - visibleCount} remaining)
                  </button>
                )}

                {/* Note for old consolidated holdings */}
                {isConsolidated && recalcState !== 'done' && (
                  <p className="text-[10px] mt-2 px-1" style={{ color: '#9CA3AF' }}>
                    Showing consolidated SIP entry. Click &quot;Expand SIP History&quot; above to generate individual monthly rows.
                  </p>
                )}
              </>
            )}
          </div>

          {/* ── Holder Details (collapsible) ── */}
          {hasHolderData && (
            <div className="border-b" style={{ borderColor: '#E8E5DD' }}>
              <button
                onClick={() => setShowHolder(!showHolder)}
                className="w-full flex items-center justify-between px-6 py-3 text-left hover:bg-gray-50 transition-colors"
              >
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#9CA3AF' }}>
                  Holder &amp; Contact Details
                </p>
                {showHolder
                  ? <ChevronUp className="w-3.5 h-3.5" style={{ color: '#9CA3AF' }} />
                  : <ChevronDown className="w-3.5 h-3.5" style={{ color: '#9CA3AF' }} />}
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
                        <span className="text-[10px]" style={{ color: '#9CA3AF' }}>{label}</span>
                        <span className="text-[11px] font-medium" style={{ color: '#1A1A2E' }}>{value}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* ── Redemption form ── */}
          {showRedeem && (
            <div className="px-6 py-4 border-b" style={{ borderColor: '#E8E5DD' }}>
              <RedemptionForm
                holdingId={h.id} maxUnits={Number(h.quantity)} currentNav={h.currentNav}
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
        </div>

        {/* ── Edit Transactions view ───────────────────────────────────────────── */}
        {view === 'edit-transactions' && (
          <div className="flex-1 overflow-y-auto">
            <div className="px-6 py-4 border-b" style={{ borderColor: '#E8E5DD' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#9CA3AF' }}>
                Edit Transactions ({h.transactions.length} total)
              </p>
              <p className="text-[11px]" style={{ color: '#6B7280' }}>
                Pencil edits a single transaction · Trash deletes it permanently
              </p>
              {txnDeleteError && (
                <p className="text-[11px] mt-1 font-medium" style={{ color: '#DC2626' }}>{txnDeleteError}</p>
              )}
            </div>
            <div>
              {(h.transactions ?? []).length === 0 ? (
                <p className="px-6 py-8 text-xs text-center" style={{ color: '#9CA3AF' }}>No transactions found</p>
              ) : [...(h.transactions ?? [])]
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .map(t => {
                  const cfg        = TXN_CONFIG[t.type] ?? { label: t.type, bg: '#F3F4F6', text: '#6B7280', sign: 1 };
                  const amt        = Number(t.quantity) * Number(t.price);
                  const lbl        = txnLabel(t);
                  const isEditable = t.type === 'buy' || t.type === 'sip';
                  const isConfirming = txnDeleteConfirmId === t.id;
                  const isDeleting   = deletingTxnId === t.id;
                  return (
                    <div key={t.id} className="border-b px-6 py-3" style={{ borderColor: '#F7F5F0' }}>
                      {isConfirming ? (
                        <div className="rounded-xl border p-3 space-y-2"
                          style={{ borderColor: 'rgba(220,38,38,0.25)', backgroundColor: 'rgba(220,38,38,0.02)' }}>
                          <p className="text-[11px] font-semibold" style={{ color: '#DC2626' }}>
                            Delete this {lbl} transaction from {fmtDate(t.date)} for {formatLargeINR(amt)}?
                          </p>
                          <div className="flex gap-2">
                            <Button onClick={() => handleDeleteTransaction(t.id)} disabled={isDeleting}
                              className="h-7 px-3 text-[11px]"
                              style={{ backgroundColor: '#DC2626', color: 'white' }}>
                              {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Delete'}
                            </Button>
                            <Button variant="outline" onClick={() => setTxnDeleteConfirmId(null)} disabled={isDeleting}
                              className="h-7 px-3 text-[11px]" style={{ borderColor: '#E8E5DD', color: '#6B7280' }}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] flex-shrink-0 w-24" style={{ color: '#6B7280' }}>
                            {fmtDate(t.date)}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold whitespace-nowrap flex-shrink-0"
                            style={{ backgroundColor: cfg.bg, color: cfg.text }}>{lbl}</span>
                          <span className="text-[11px] font-semibold flex-1 text-right" style={{ color: '#1A1A2E' }}>
                            {formatLargeINR(amt)}
                          </span>
                          <span className="text-[11px] flex-shrink-0 w-20 text-right" style={{ color: '#9CA3AF' }}>
                            ₹{Number(t.price).toFixed(4)}
                          </span>
                          <span className="text-[11px] flex-shrink-0 w-16 text-right" style={{ color: '#6B7280' }}>
                            {Number(t.quantity).toFixed(4)}
                          </span>
                          {isEditable && (
                            <button
                              onClick={() => { router.push(`/add-assets/mutual-funds?edit_transaction=${t.id}`); onClose(); }}
                              className="flex-shrink-0 p-1.5 rounded-lg transition-colors"
                              style={{ backgroundColor: 'rgba(27,42,74,0.06)', color: '#1B2A4A' }}
                              title="Edit transaction"
                            >
                              <Edit className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            onClick={() => { setTxnDeleteConfirmId(t.id); setTxnDeleteError(''); }}
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
          style={{ borderColor: '#E8E5DD', backgroundColor: '#FAFAF8' }}>
          {view === 'edit-transactions' ? (
            <Button variant="outline" onClick={() => setView('detail')} className="w-full h-9 text-[11px]"
              style={{ borderColor: '#E8E5DD', color: '#6B7280' }}>
              ← Back to Overview
            </Button>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-2">
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
                <Button variant="outline" onClick={() => { setRedeemDone(false); setShowRedeem(!showRedeem); }}
                  className="h-9 text-[11px]" style={{ borderColor: '#E8E5DD', color: '#6B7280' }}>
                  {showRedeem ? 'Cancel' : 'Redeem'}
                </Button>
                <Button variant="outline"
                  onClick={() => setView('edit-transactions')}
                  className="h-9 text-[11px]" style={{ borderColor: '#E8E5DD', color: '#6B7280' }}>
                  <Edit className="w-3 h-3 mr-1" />Edit
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
      </SheetContent>
    </Sheet>
  );
}
