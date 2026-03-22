'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Input }  from '@/components/ui/input';
import { Label }  from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  TrendingUp, TrendingDown, Loader2, AlertCircle, Check,
  BarChart3, User, Building2, RefreshCw, X,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Transaction {
  id: string; date: string; price: number; quantity: number;
  type: string; fees: number;
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

interface Props {
  holding: HoldingDetail | null;
  open: boolean;
  onClose: () => void;
  onDeleted: (id: string) => void;
  onHoldingChanged: () => void;
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-widest mt-5 mb-2" style={{ color: '#9CA3AF' }}>
      {children}
    </p>
  );
}

function Row({ label, value, valueColor }: { label: string; value: React.ReactNode; valueColor?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: '#F7F5F0' }}>
      <span className="text-xs" style={{ color: '#6B7280' }}>{label}</span>
      <span className="text-xs font-medium" style={{ color: valueColor ?? '#1A1A2E' }}>{value}</span>
    </div>
  );
}

// ─── Redemption mini-form ─────────────────────────────────────────────────────

function RedemptionForm({
  holdingId, maxUnits, currentNav,
  onSuccess, onCancel,
}: {
  holdingId: string;
  maxUnits: number;
  currentNav: number | null;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const supabase = createClient();
  const [units, setUnits] = useState('');
  const [sellNav, setSellNav] = useState(currentNav?.toFixed(4) ?? '');
  const [sellDate, setSellDate] = useState(new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    const u = parseFloat(units);
    const n = parseFloat(sellNav);
    if (!u || u <= 0 || u > maxUnits) { setErr(`Enter units between 0 and ${maxUnits.toFixed(4)}`); return; }
    if (!n || n <= 0) { setErr('Enter sell NAV'); return; }
    if (!sellDate) { setErr('Enter sell date'); return; }
    setSaving(true);
    setErr('');
    const { error } = await supabase.from('transactions').insert({
      holding_id: holdingId,
      type: 'sell',
      quantity: u,
      price: n,
      date: sellDate,
      fees: 0,
    });
    if (error) { setErr(error.message); setSaving(false); return; }
    // Update holding quantity
    await supabase.from('holdings')
      .update({ quantity: maxUnits - u })
      .eq('id', holdingId);
    onSuccess();
  }

  return (
    <div className="rounded-xl border p-4 space-y-3 mt-3"
      style={{ borderColor: '#E8E5DD', backgroundColor: 'rgba(220,38,38,0.02)' }}>
      <p className="text-xs font-semibold" style={{ color: '#DC2626' }}>Record Redemption / Sell</p>
      {err && <p className="text-[11px]" style={{ color: '#DC2626' }}>{err}</p>}
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label className="text-xs" style={{ color: '#6B7280' }}>Units to Sell</Label>
          <Input value={units} onChange={(e) => setUnits(e.target.value)}
            placeholder={`Max ${maxUnits.toFixed(4)}`} type="number" step="0.0001" className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" style={{ color: '#6B7280' }}>Sell NAV (₹)</Label>
          <Input value={sellNav} onChange={(e) => setSellNav(e.target.value)}
            placeholder="54.12" type="number" step="0.0001" className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" style={{ color: '#6B7280' }}>Sell Date</Label>
          <Input value={sellDate} onChange={(e) => setSellDate(e.target.value)}
            type="date" className="h-8 text-xs" max={new Date().toISOString().split('T')[0]} />
        </div>
      </div>
      {units && sellNav && (
        <p className="text-[11px]" style={{ color: '#6B7280' }}>
          Redemption value: <strong>{formatLargeINR(parseFloat(units) * parseFloat(sellNav))}</strong>
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={submit} disabled={saving} className="h-8 text-xs flex-1"
          style={{ backgroundColor: '#DC2626', color: 'white' }}>
          {saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
          Record Redemption
        </Button>
        <Button variant="outline" onClick={onCancel} className="h-8 text-xs"
          style={{ borderColor: '#E8E5DD', color: '#6B7280' }}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function HoldingDetailSheet({ holding, open, onClose, onDeleted, onHoldingChanged }: Props) {
  const router   = useRouter();
  const supabase = createClient();

  const [showRedeem, setShowRedeem] = useState(false);
  const [deleting,   setDeleting]   = useState(false);
  const [redeemDone, setRedeemDone] = useState(false);

  if (!holding) return null;

  const h   = holding;
  const meta = h.metadata ?? {};
  const isSIP = !!meta.is_sip;

  const gainOk = h.gainLoss !== null;

  async function handleDelete() {
    if (!confirm(`Delete "${h.name}" and all its transactions? This cannot be undone.`)) return;
    setDeleting(true);
    await supabase.from('transactions').delete().eq('holding_id', h.id);
    await supabase.from('holdings').delete().eq('id', h.id);
    onDeleted(h.id);
    onClose();
  }

  function goAddMore() {
    router.push(`/add-assets/mutual-funds?fund=${h.symbol}&name=${encodeURIComponent(h.name)}`);
    onClose();
  }

  function goEdit() {
    router.push(`/add-assets/mutual-funds?edit=${h.id}`);
    onClose();
  }

  // SIP breakdown from metadata
  const sipList = Array.isArray(meta.sips) ? (meta.sips as Array<Record<string, unknown>>) : null;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col" style={{ maxWidth: 560 }}>
        {/* ── Header ── */}
        <SheetHeader className="px-6 py-5 border-b flex-shrink-0" style={{ borderColor: '#E8E5DD' }}>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: 'rgba(46,139,139,0.1)' }}>
              <BarChart3 className="w-5 h-5" style={{ color: '#2E8B8B' }} />
            </div>
            <div className="flex-1 min-w-0 pr-6">
              <SheetTitle className="text-sm font-semibold leading-tight" style={{ color: '#1A1A2E' }}>
                {h.name}
              </SheetTitle>
              <div className="flex items-center gap-2 mt-1">
                {isSIP && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                    style={{ backgroundColor: '#F5EDD6', color: '#C9A84C' }}>SIP</span>
                )}
                <span className="text-[11px]" style={{ color: '#9CA3AF' }}>AMFI {h.symbol}</span>
                {String(meta.category ?? '') && (
                  <span className="text-[10px]" style={{ color: '#9CA3AF' }}>· {String(meta.category)}</span>
                )}
              </div>
            </div>
          </div>
        </SheetHeader>

        {/* ── Body (scrollable) ── */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">

          {/* Current Status */}
          <SectionHead>Current Status</SectionHead>
          <div className="grid grid-cols-3 gap-3 mb-1">
            <div className="p-3 rounded-xl text-center" style={{ backgroundColor: '#F7F5F0' }}>
              <p className="text-[10px] mb-1" style={{ color: '#9CA3AF' }}>Current NAV</p>
              <p className="text-sm font-bold" style={{ color: '#1A1A2E' }}>
                {h.currentNav ? `₹${h.currentNav.toFixed(4)}` : <Loader2 className="w-3 h-3 animate-spin inline" />}
              </p>
              {h.navDate && <p className="text-[9px] mt-0.5" style={{ color: '#D1D5DB' }}>{h.navDate}</p>}
            </div>
            <div className="p-3 rounded-xl text-center" style={{ backgroundColor: '#F7F5F0' }}>
              <p className="text-[10px] mb-1" style={{ color: '#9CA3AF' }}>Current Value</p>
              <p className="text-sm font-bold" style={{ color: '#1A1A2E' }}>
                {h.currentValue ? formatLargeINR(h.currentValue) : '—'}
              </p>
            </div>
            <div className="p-3 rounded-xl text-center"
              style={{ backgroundColor: gainOk
                ? (h.gainLoss! >= 0 ? 'rgba(5,150,105,0.06)' : 'rgba(220,38,38,0.06)')
                : '#F7F5F0' }}>
              <p className="text-[10px] mb-1" style={{ color: '#9CA3AF' }}>P&amp;L</p>
              {gainOk ? (
                <>
                  <p className="text-sm font-bold"
                    style={{ color: h.gainLoss! >= 0 ? '#059669' : '#DC2626' }}>
                    {h.gainLoss! >= 0 ? <TrendingUp className="w-3.5 h-3.5 inline" /> : <TrendingDown className="w-3.5 h-3.5 inline" />}
                    {' '}{formatLargeINR(Math.abs(h.gainLoss!))}
                  </p>
                  <p className="text-[10px]" style={{ color: h.gainLossPct! >= 0 ? '#059669' : '#DC2626' }}>
                    {h.gainLossPct! >= 0 ? '+' : ''}{h.gainLossPct!.toFixed(2)}%
                  </p>
                </>
              ) : <p className="text-sm font-bold" style={{ color: '#9CA3AF' }}>—</p>}
            </div>
          </div>

          {/* Investment Summary */}
          <SectionHead>Investment Summary</SectionHead>
          <Row label="Total Invested"     value={formatLargeINR(h.investedValue)} />
          <Row label="Total Units"        value={Number(h.quantity).toFixed(4)} />
          <Row label="Average NAV"        value={`₹${Number(h.avg_buy_price).toFixed(4)}`} />
          {h.xirr !== null && (
            <Row label="XIRR" value={`${(h.xirr * 100).toFixed(2)}%`}
              valueColor={h.xirr >= 0 ? '#059669' : '#DC2626'} />
          )}
          {meta.folio ? <Row label="Folio Number" value={String(meta.folio)} /> : null}
          {meta.plan_type ? <Row label="Plan Type" value={String(meta.plan_type)} /> : null}

          {/* Fund Info */}
          <SectionHead>Fund Information</SectionHead>
          {meta.fund_house ? <Row label="Fund House" value={String(meta.fund_house)} /> : null}
          {meta.category ? <Row label="Category" value={String(meta.category)} /> : null}
          {meta.amfi_code ? <Row label="AMFI Code" value={String(meta.amfi_code)} /> : null}

          {/* Broker & Portfolio */}
          <SectionHead>Broker &amp; Portfolio</SectionHead>
          <Row label="Broker"    value={h.brokers?.name ?? '—'} />
          <Row label="Platform"  value={h.brokers?.platform_type ?? '—'} />
          <Row label="Portfolio" value={h.portfolios?.name ?? '—'} />
          <Row label="Member"    value={h.memberName || '—'} />

          {/* Holder Details (from metadata) */}
          {!!(meta.first_holder || meta.mobile || meta.email || meta.bank_name || meta.bank_last4) ? (
            <>
              <SectionHead>Holder &amp; Contact</SectionHead>
              {meta.first_holder  ? <Row label="First Holder"  value={String(meta.first_holder)}  /> : null}
              {meta.second_holder ? <Row label="Second Holder" value={String(meta.second_holder)} /> : null}
              {meta.nominee       ? <Row label="Nominee"       value={String(meta.nominee)}       /> : null}
              {meta.mobile        ? <Row label="Mobile"        value={String(meta.mobile)}        /> : null}
              {meta.email         ? <Row label="Email"         value={String(meta.email)}         /> : null}
              {(meta.bank_name || meta.bank_last4) ? (
                <Row label="Bank"
                  value={[
                    meta.bank_name ? String(meta.bank_name) : '',
                    meta.bank_last4 ? `****${String(meta.bank_last4)}` : '',
                  ].filter(Boolean).join(' - ')} />
              ) : null}
              {meta.pan           ? <Row label="PAN"           value={`XXXXX${String(meta.pan).slice(-4)}`} /> : null}
            </>
          ) : null}

          {/* SIP Details */}
          {isSIP && sipList && sipList.length > 0 && (
            <>
              <SectionHead>SIP Details</SectionHead>
              {sipList.map((sip, i) => (
                <div key={i} className="mb-2 p-3 rounded-lg" style={{ backgroundColor: '#F7F5F0' }}>
                  <p className="text-[10px] font-semibold mb-1" style={{ color: '#C9A84C' }}>SIP {i + 1}</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div><p className="text-[9px]" style={{ color: '#9CA3AF' }}>Amount</p><p className="text-xs font-medium">₹{Number(sip.amount).toLocaleString('en-IN')}</p></div>
                    <div><p className="text-[9px]" style={{ color: '#9CA3AF' }}>Date</p><p className="text-xs font-medium">{String(sip.date)} of month</p></div>
                    <div><p className="text-[9px]" style={{ color: '#9CA3AF' }}>Started</p><p className="text-xs font-medium">{String(sip.start_date ?? '—')}</p></div>
                    <div><p className="text-[9px]" style={{ color: '#9CA3AF' }}>Instalments</p><p className="text-xs font-medium">{String(sip.installments ?? '—')}</p></div>
                    <div><p className="text-[9px]" style={{ color: '#9CA3AF' }}>Units</p><p className="text-xs font-medium">{Number(sip.units ?? 0).toFixed(4)}</p></div>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Import Source */}
          {meta.import === 'cas' && (
            <>
              <SectionHead>Import Source</SectionHead>
              <Row label="Source" value="CAS / Bulk Import" />
            </>
          )}

          {/* Transaction History */}
          <SectionHead>Transaction History</SectionHead>
          {h.transactions.length === 0 ? (
            <p className="text-xs py-3" style={{ color: '#9CA3AF' }}>No transactions recorded</p>
          ) : (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#E8E5DD' }}>
              <table className="w-full text-[11px]">
                <thead>
                  <tr style={{ backgroundColor: '#F7F5F0', borderBottom: '1px solid #E8E5DD' }}>
                    {['Date','Type','Units','NAV','Amount'].map((c) => (
                      <th key={c} className="px-3 py-1.5 text-left font-semibold" style={{ color: '#6B7280' }}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...h.transactions]
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                    .map((t) => (
                      <tr key={t.id} style={{ borderBottom: '1px solid #F7F5F0' }}>
                        <td className="px-3 py-1.5" style={{ color: '#6B7280' }}>
                          {new Date(t.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="px-3 py-1.5">
                          <span className="uppercase text-[9px] font-semibold px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: t.type === 'sell' ? 'rgba(220,38,38,0.08)' : 'rgba(5,150,105,0.08)',
                                     color: t.type === 'sell' ? '#DC2626' : '#059669' }}>
                            {t.type}
                          </span>
                        </td>
                        <td className="px-3 py-1.5" style={{ color: '#1A1A2E' }}>{Number(t.quantity).toFixed(4)}</td>
                        <td className="px-3 py-1.5" style={{ color: '#6B7280' }}>₹{Number(t.price).toFixed(4)}</td>
                        <td className="px-3 py-1.5 font-medium" style={{ color: '#1A1A2E' }}>
                          {formatLargeINR(Number(t.quantity) * Number(t.price))}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Redemption form */}
          {showRedeem && !redeemDone && (
            <RedemptionForm
              holdingId={h.id}
              maxUnits={Number(h.quantity)}
              currentNav={h.currentNav}
              onSuccess={() => { setRedeemDone(true); setShowRedeem(false); onHoldingChanged(); }}
              onCancel={() => setShowRedeem(false)}
            />
          )}
          {redeemDone && (
            <div className="flex items-center gap-2 mt-3 p-3 rounded-xl text-xs"
              style={{ backgroundColor: 'rgba(5,150,105,0.08)', color: '#059669' }}>
              <Check className="w-4 h-4" /> Redemption recorded successfully.
            </div>
          )}
        </div>

        {/* ── Action footer ── */}
        <div className="flex-shrink-0 px-6 py-4 border-t space-y-2" style={{ borderColor: '#E8E5DD' }}>
          <div className="grid grid-cols-3 gap-2">
            <Button onClick={goEdit} variant="outline" className="h-8 text-xs"
              style={{ borderColor: '#E8E5DD', color: '#1A1A2E' }}>
              Edit Entry
            </Button>
            <Button onClick={goAddMore} variant="outline" className="h-8 text-xs"
              style={{ borderColor: '#E8E5DD', color: '#1A1A2E' }}>
              Add Units
            </Button>
            <Button onClick={() => setShowRedeem(!showRedeem)} variant="outline" className="h-8 text-xs"
              style={{ borderColor: '#E8E5DD', color: '#6B7280' }}>
              {showRedeem ? 'Cancel' : 'Redeem'}
            </Button>
          </div>
          <Button onClick={handleDelete} disabled={deleting}
            className="w-full h-8 text-xs"
            style={{ backgroundColor: 'rgba(220,38,38,0.08)', color: '#DC2626', border: '1px solid rgba(220,38,38,0.2)' }}>
            {deleting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <X className="w-3 h-3 mr-1" />}
            Delete Holding
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
