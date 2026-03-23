'use client';

import { useState, useRef, useEffect, useCallback, useLayoutEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input }    from '@/components/ui/input';
import { Label }    from '@/components/ui/label';
import { Button }   from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  BarChart3, Upload, Link as LinkIcon, Check, ChevronDown, ChevronUp,
  Loader2, AlertCircle, X, TrendingUp, TrendingDown, Plus, Trash2,
  User, ChevronRight, History,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';
import { calculateXIRR }  from '@/lib/utils/calculations';
import { BrokerSelector } from '@/components/forms/BrokerSelector';
import { CASImporter }    from '@/components/forms/CASImporter';
import { ECASImporter }   from '@/components/forms/ECASImporter';
import { ImportHistory }  from '@/components/portfolio/ImportHistory';
import { useHoldingPrefill } from '@/hooks/use-holding-prefill';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SearchResult { schemeCode: number; schemeName: string; category: string }
interface NavData      { nav: number; navDate: string; fundName: string; fundHouse: string; category: string }
interface FamilyMember { id: string; name: string }
interface Portfolio    { id: string; name: string; type: string }
interface Toast        { type: 'success' | 'error'; message: string }

interface SipBlock {
  id: string;
  sipAmount: string;
  sipDate: string;   // "1st","5th", etc.
  sipStart: string;  // YYYY-MM-DD
  // auto-calculated
  isCalculating: boolean;
  installments: number | null;
  totalUnits: number | null;
  avgNav: number | null;
  totalInvested: number | null;
  currentValue: number | null;
  pnl: number | null;
  xirr: number | null;
  breakdown: { date: string; nav: number; units_purchased: number; amount: number; stamp_duty: number; effective_amount: number }[];
  showBreakdown: boolean;
  manualOverride: boolean;
  // manual overrides
  manualInstallments: string;
  manualTotalUnits: string;
  manualAvgNav: string;
  errors: Record<string, string>;
}

interface HolderFields {
  firstHolder: string;
  secondHolder: string;
  nominee: string;
  mobile: string;
  email: string;
  bankName: string;
  bankLast4: string;
}

interface SipCalcResult {
  installments_completed: number;
  total_units: number;
  total_invested: number;
  average_nav: number;
  current_nav: number;
  current_value: number;
  pnl: number;
  xirr: number | null;
  monthly_breakdown: { date: string; nav: number; units_purchased: number; amount: number; stamp_duty: number; effective_amount: number }[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PORTFOLIOS = ['Long-term Growth', 'Retirement', 'Tax Saving'];
const SIP_DATES = ['1st','5th','10th','15th','20th','25th','28th'];

const CAT_COLORS: Record<string, { bg: string; text: string }> = {
  Equity:               { bg: 'rgba(27,42,74,0.08)',    text: '#1B2A4A' },
  ELSS:                 { bg: '#F5EDD6',                text: '#C9A84C' },
  Hybrid:               { bg: 'rgba(46,139,139,0.08)',  text: '#2E8B8B' },
  Debt:                 { bg: 'rgba(5,150,105,0.08)',   text: '#059669' },
  Liquid:               { bg: 'rgba(5,150,105,0.08)',   text: '#059669' },
  Gilt:                 { bg: 'rgba(5,150,105,0.08)',   text: '#059669' },
  'Index/ETF':          { bg: 'rgba(27,42,74,0.08)',    text: '#1B2A4A' },
  Commodity:            { bg: 'rgba(201,168,76,0.15)',  text: '#92620A' },
  International:        { bg: 'rgba(99,102,241,0.10)',  text: '#4338CA' },
  'Sectoral/Thematic':  { bg: 'rgba(234,88,12,0.10)',   text: '#C2410C' },
  Arbitrage:            { bg: 'rgba(46,139,139,0.08)',  text: '#2E8B8B' },
};

function getCatStyle(cat: string) { return CAT_COLORS[cat] ?? { bg: '#F3F4F6', text: '#6B7280' }; }

// Refine AMFI API category using fund name keywords
// Order matters: more specific checks before generic fallbacks
function detectCategory(schemeName: string, apiCategory: string): string {
  const n = schemeName.toUpperCase();

  // ── Tax-saving ──────────────────────────────────────────────────────────────
  if (/\bELSS\b|TAX\s*SAVER|TAX\s*SAVING|\b80C\b/.test(n)) return 'ELSS';

  // ── Commodity (Gold / Silver / Precious Metals) — before Index/ETF ─────────
  if (/\bGOLD\b|\bSILVER\b|\bCOMMODIT|\bPRECIOUS\s*METAL|\bGOLD\s*BEES\b|\bGOLD\s*ETF\b|\bGOLD\s*FUND\b|\bGOLD\s*SAVINGS\b/.test(n)) return 'Commodity';

  // ── International / Global / Feeder funds ──────────────────────────────────
  if (/\bINTERNATIONAL\b|\bGLOBAL\b|\bUS\s*EQUITY\b|\bNASDAQ\b|\bNAVDAQ\b|\bS&P\b|\bFEEDER\b|\bFOF\b|\bFUND\s*OF\s*FUND/.test(n)) return 'International';

  // ── Index / Passive (after Gold & International so "Gold BeES" doesn't hit here) ──
  if (/\bINDEX\b|\bNIFTY\b|\bSENSEX\b|\bETF\b/.test(n)) return 'Index/ETF';

  // ── Sectoral / Thematic ─────────────────────────────────────────────────────
  if (/\bSECTORAL\b|\bTHEMATIC\b|\bINFRASTRUCTUR|\bPHARMA\b|\bHEALTH(CARE)?\b|\bIT\s*FUND\b|\bTECHNOLOG|\bCONSUMPTION\b|\bESG\b|\bPSU\b|\bBSE\s*PSEB|\bENERGY\b|\bAUTO\b|\bBANKING\s*FUND\b|\bINNOVATION\b|\bMANUFACTURING\b/.test(n)) return 'Sectoral/Thematic';

  // ── Debt sub-types ──────────────────────────────────────────────────────────
  if (/\bOVERNIGHT\b/.test(n))                                    return 'Debt';
  if (/\bLIQUID\b|\bMONEY\s*MARKET\b/.test(n))                    return 'Liquid';
  if (/\bGILT\b|\bG-?SEC\b|\bSOVEREIGN\b/.test(n))               return 'Gilt';
  if (/\bDEBT\b|\bBOND\b|\bCREDIT\s*RISK\b|\bDURATION\b|\bINCOME\b|\bCORPORATE\s*BOND\b|\bFIXED\s*INCOME\b|\bBANKING\s*&?\s*PSU\b|\bULTRA\s*SHORT\b|\bLOW\s*DURATION\b|\bSHORT\s*DURATION\b|\bMEDIUM\s*DURATION\b|\bLONG\s*DURATION\b/.test(n)) return 'Debt';

  // ── Hybrid ──────────────────────────────────────────────────────────────────
  if (/\bHYBRID\b|\bBALANCED\b|\bAGGRESSIVE\b|\bCONSERVATIVE\b|\bARBITRAGE\b|\bBAF\b|\bDAA\b|\bMULTI\s*ASSET\b/.test(n)) return 'Hybrid';

  // ── Fall back to normalised API category ───────────────────────────────────
  const ac = apiCategory.toUpperCase();
  if (ac.includes('GOLD') || ac.includes('SILVER') || ac.includes('COMMODITY') || ac.includes('PRECIOUS METAL')) return 'Commodity';
  if (ac.includes('INTERNATIONAL') || ac.includes('GLOBAL') || ac.includes('OVERSEAS') || ac.includes('FEEDER') || ac.includes('FOF')) return 'International';
  if (ac.includes('ELSS'))                                             return 'ELSS';
  if (ac.includes('INDEX') || ac.includes('ETF'))                     return 'Index/ETF';
  if (ac.includes('SECTORAL') || ac.includes('THEMATIC'))             return 'Sectoral/Thematic';
  if (ac.includes('OVERNIGHT') || ac.includes('LIQUID') || ac.includes('MONEY MARKET')) return 'Liquid';
  if (ac.includes('GILT') || ac.includes('G-SEC') || ac.includes('SOVEREIGN')) return 'Gilt';
  if (ac.includes('DEBT') || ac.includes('BOND') || ac.includes('INCOME') || ac.includes('CREDIT') || ac.includes('DURATION') || ac.includes('CORPORATE') || ac.includes('BANKING AND PSU') || ac.includes('BANKING & PSU')) return 'Debt';
  if (ac.includes('HYBRID') || ac.includes('BALANCED') || ac.includes('ARBITRAGE') || ac.includes('MULTI ASSET')) return 'Hybrid';

  return 'Equity';
}

function fmtNavDate(raw: string): string {
  if (!raw) return '';
  const [d, m, y] = raw.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(d)} ${months[parseInt(m)-1]} ${y}`;
}

function newSipBlock(): SipBlock {
  return {
    id: crypto.randomUUID(),
    sipAmount: '', sipDate: '1st', sipStart: '',
    isCalculating: false,
    installments: null, totalUnits: null, avgNav: null,
    totalInvested: null, currentValue: null, pnl: null, xirr: null,
    breakdown: [], showBreakdown: false, manualOverride: false,
    manualInstallments: '', manualTotalUnits: '', manualAvgNav: '',
    errors: {},
  };
}

const BLANK_HOLDER: HolderFields = {
  firstHolder: '', secondHolder: '', nominee: '',
  mobile: '', email: '', bankName: '', bankLast4: '',
};

const INDIAN_BANKS = [
  'HDFC Bank', 'SBI', 'ICICI Bank', 'Kotak Mahindra', 'Axis Bank',
  'Bank of Baroda', 'PNB', 'IndusInd', 'Yes Bank', 'IDFC First',
  'Federal Bank', 'Canara Bank', 'Union Bank', 'Indian Bank', 'Bank of India',
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function ToastBanner({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const ok = toast.type === 'success';
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl mb-4 text-sm font-medium"
      style={{ backgroundColor: ok ? 'rgba(5,150,105,0.08)' : 'rgba(220,38,38,0.08)',
               border: `1px solid ${ok ? 'rgba(5,150,105,0.2)' : 'rgba(220,38,38,0.2)'}`,
               color: ok ? '#059669' : '#DC2626' }}>
      {ok ? <Check className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
      <span className="flex-1">{toast.message}</span>
      <button onClick={onClose}><X className="w-3.5 h-3.5" /></button>
    </div>
  );
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-[10px] mt-0.5" style={{ color: '#DC2626' }}>{msg}</p>;
}

function AutoTag({ label }: { label: string }) {
  return (
    <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
      style={{ backgroundColor: 'rgba(5,150,105,0.1)', color: '#059669' }}>
      {label}
    </span>
  );
}

// ─── Holder Fields Collapsible ────────────────────────────────────────────────

function HolderSection({
  holder, onChange, memberName, familyId,
}: {
  holder: HolderFields;
  onChange: (h: HolderFields) => void;
  memberName: string;
  familyId: string | null;
}) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [customBanks, setCustomBanks] = useState<string[]>([]);
  // Explicit flag — true when "Other" is selected or existing holding has a custom bank
  const [showCustomInput, setShowCustomInput] = useState(() =>
    !!holder.bankName && !INDIAN_BANKS.includes(holder.bankName)
  );
  const customInputRef = useRef<HTMLInputElement>(null);

  const set = (k: keyof HolderFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...holder, [k]: e.target.value });

  // Load custom bank names saved in any family holding's metadata
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('holdings').select('metadata');
      const names = (data ?? [])
        .map(h => (h.metadata as Record<string, unknown> | null)?.bank_name as string | undefined)
        .filter((b): b is string => !!b && !INDIAN_BANKS.includes(b));
      setCustomBanks(Array.from(new Set(names)));
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-focus the custom input whenever it becomes visible
  useEffect(() => {
    if (showCustomInput && open) {
      const t = setTimeout(() => customInputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [showCustomInput, open]);

  const allStandardBanks = [...INDIAN_BANKS, ...customBanks];
  // "Other" is shown in dropdown if the bank doesn't match any known bank
  const selectBankValue = showCustomInput ? 'Other' : holder.bankName;

  function handleBankSelect(v: string) {
    if (v === 'Other') {
      setShowCustomInput(true);
      onChange({ ...holder, bankName: '' });
    } else {
      setShowCustomInput(false);
      onChange({ ...holder, bankName: v });
    }
  }

  return (
    <div className="mt-4 border rounded-xl" style={{ borderColor: '#E8E5DD' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-xs font-medium hover:bg-gray-50 transition-colors"
        style={{ color: '#6B7280' }}
      >
        <span className="flex items-center gap-2">
          <User className="w-3.5 h-3.5" />
          Holder &amp; Contact Details
          {(holder.firstHolder || holder.mobile) && (
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#059669' }} />
          )}
        </span>
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
      {open && (
        <div className="px-4 pb-4 border-t" style={{ borderColor: '#E8E5DD' }}>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="space-y-1">
              <Label className="text-xs" style={{ color: '#6B7280' }}>First Holder Name</Label>
              <Input value={holder.firstHolder || memberName} onChange={set('firstHolder')}
                placeholder={memberName || 'Full legal name'} className="h-9 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs" style={{ color: '#6B7280' }}>Second Holder (optional)</Label>
              <Input value={holder.secondHolder} onChange={set('secondHolder')}
                placeholder="Joint holder" className="h-9 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs" style={{ color: '#6B7280' }}>Nominee Name</Label>
              <Input value={holder.nominee} onChange={set('nominee')}
                placeholder="Nominee" className="h-9 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs" style={{ color: '#6B7280' }}>Mobile</Label>
              <Input value={holder.mobile} onChange={set('mobile')}
                placeholder="+91 9876543210" type="tel" className="h-9 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs" style={{ color: '#6B7280' }}>Email</Label>
              <Input value={holder.email} onChange={set('email')}
                placeholder="email@example.com" type="email" className="h-9 text-xs" />
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs" style={{ color: '#6B7280' }}>Bank Name</Label>
              <Select value={selectBankValue} onValueChange={handleBankSelect}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select bank" /></SelectTrigger>
                <SelectContent>
                  {INDIAN_BANKS.map((b) => (
                    <SelectItem key={b} value={b} className="text-xs">{b}</SelectItem>
                  ))}
                  {customBanks.map((b) => (
                    <SelectItem key={b} value={b} className="text-xs">{b}</SelectItem>
                  ))}
                  <SelectItem value="Other" className="text-xs">Other…</SelectItem>
                </SelectContent>
              </Select>
              {showCustomInput && (
                <Input
                  ref={customInputRef}
                  value={holder.bankName}
                  onChange={set('bankName')}
                  placeholder="Enter your bank name"
                  className="h-9 text-xs mt-1"
                />
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs" style={{ color: '#6B7280' }}>Last 4 Digits</Label>
              <Input
                value={holder.bankLast4}
                onChange={(e) => onChange({ ...holder, bankLast4: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                placeholder="8149" maxLength={4} inputMode="numeric" className="h-9 text-xs" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SIP Block Card ───────────────────────────────────────────────────────────

function SipBlockCard({
  block, index, totalBlocks, schemeCode,
  onChange, onRemove,
}: {
  block: SipBlock;
  index: number;
  totalBlocks: number;
  schemeCode: number | null;
  onChange: (updated: SipBlock) => void;
  onRemove: () => void;
}) {
  const calcTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  function update(patch: Partial<SipBlock>) {
    onChange({ ...block, ...patch });
  }

  // Trigger auto-calculate when amount + date + start are all set
  function triggerCalc(patch: Partial<SipBlock>) {
    const merged = { ...block, ...patch };
    onChange(merged);
    if (!schemeCode || !merged.sipAmount || !merged.sipDate || !merged.sipStart) return;
    if (merged.manualOverride) return;
    clearTimeout(calcTimeoutRef.current);
    calcTimeoutRef.current = setTimeout(() => autoCalc(merged, schemeCode), 600);
  }

  async function autoCalc(b: SipBlock, code: number) {
    onChange({ ...b, isCalculating: true });
    try {
      const params = new URLSearchParams({
        scheme_code: code.toString(),
        sip_amount:  b.sipAmount,
        sip_date:    b.sipDate,
        start_date:  b.sipStart,
      });
      const res = await fetch(`/api/mf/sip-calculate?${params}`);
      if (!res.ok) throw new Error('Calc failed');
      const data: SipCalcResult = await res.json();
      onChange({
        ...b,
        isCalculating:     false,
        installments:      data.installments_completed,
        totalUnits:        data.total_units,
        avgNav:            data.average_nav,
        totalInvested:     data.total_invested,
        currentValue:      data.current_value,
        pnl:               data.pnl,
        xirr:              data.xirr,
        breakdown:         data.monthly_breakdown,
        manualInstallments: '',
        manualTotalUnits:  '',
        manualAvgNav:      '',
      });
    } catch {
      onChange({ ...b, isCalculating: false });
    }
  }

  const effectiveInstallments = block.manualOverride
    ? (parseInt(block.manualInstallments) || 0)
    : (block.installments ?? 0);
  const effectiveUnits = block.manualOverride
    ? (parseFloat(block.manualTotalUnits) || 0)
    : (block.totalUnits ?? 0);
  const _effectiveAvgNav = block.manualOverride
    ? (parseFloat(block.manualAvgNav) || 0)
    : (block.avgNav ?? 0);
  const effectiveInvested = block.manualOverride
    ? (parseFloat(block.sipAmount) || 0) * effectiveInstallments
    : (block.totalInvested ?? 0);

  const hasResult = effectiveInstallments > 0 && effectiveUnits > 0;

  return (
    <div className="relative rounded-xl border p-4 space-y-3"
      style={{ borderColor: '#E8E5DD', backgroundColor: 'rgba(27,42,74,0.01)' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#C9A84C' }}>
          SIP {index + 1}
        </span>
        {totalBlocks > 1 && (
          <button onClick={onRemove} className="p-1 rounded hover:bg-red-50 transition-colors">
            <Trash2 className="w-3.5 h-3.5" style={{ color: '#DC2626' }} />
          </button>
        )}
      </div>

      {/* Inputs row 1 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs" style={{ color: '#6B7280' }}>SIP Amount (₹)</Label>
          <Input
            value={block.sipAmount}
            onChange={(e) => { update({ sipAmount: e.target.value, errors: { ...block.errors, sipAmount: '' } }); triggerCalc({ sipAmount: e.target.value }); }}
            placeholder="5000" type="number" className="h-9 text-xs"
            style={block.errors.sipAmount ? { borderColor: '#DC2626' } : {}}
          />
          <FieldError msg={block.errors.sipAmount} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" style={{ color: '#6B7280' }}>Monthly SIP Date</Label>
          <Select value={block.sipDate} onValueChange={(v) => triggerCalc({ sipDate: v })}>
            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{SIP_DATES.map((d) => <SelectItem key={d} value={d} className="text-xs">{d} of month</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs" style={{ color: '#6B7280' }}>SIP Start Date</Label>
          <Input type="date" value={block.sipStart}
            onChange={(e) => triggerCalc({ sipStart: e.target.value })}
            className="h-9 text-xs"
            style={block.errors.sipStart ? { borderColor: '#DC2626' } : {}}
            max={new Date().toISOString().split('T')[0]}
          />
          <FieldError msg={block.errors.sipStart} />
        </div>
      </div>

      {/* Auto-calc status */}
      {block.isCalculating && (
        <div className="flex items-center gap-2 text-xs" style={{ color: '#9CA3AF' }}>
          <Loader2 className="w-3 h-3 animate-spin" />Calculating from NAV history…
        </div>
      )}

      {/* Calculated fields */}
      {!block.isCalculating && (
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1" style={{ color: '#6B7280' }}>
              Instalments
              {!block.manualOverride && block.installments !== null && <AutoTag label="auto" />}
            </Label>
            <Input
              value={block.manualOverride ? block.manualInstallments : (block.installments?.toString() ?? '')}
              onChange={(e) => update({ manualInstallments: e.target.value })}
              readOnly={!block.manualOverride}
              placeholder="—"
              className="h-9 text-xs"
              style={!block.manualOverride ? { backgroundColor: block.installments !== null ? 'rgba(5,150,105,0.04)' : '#F7F5F0' } : {}}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1" style={{ color: '#6B7280' }}>
              Total Units
              {!block.manualOverride && block.totalUnits !== null && <AutoTag label="auto" />}
            </Label>
            <Input
              value={block.manualOverride ? block.manualTotalUnits : (block.totalUnits?.toFixed(3) ?? '')}
              onChange={(e) => update({ manualTotalUnits: e.target.value })}
              readOnly={!block.manualOverride}
              placeholder="—"
              className="h-9 text-xs"
              style={!block.manualOverride ? { backgroundColor: block.totalUnits !== null ? 'rgba(5,150,105,0.04)' : '#F7F5F0' } : {}}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1" style={{ color: '#6B7280' }}>
              Avg NAV
              {!block.manualOverride && block.avgNav !== null && <AutoTag label="auto" />}
            </Label>
            <Input
              value={block.manualOverride ? block.manualAvgNav : (block.avgNav?.toFixed(4) ?? '')}
              onChange={(e) => update({ manualAvgNav: e.target.value })}
              readOnly={!block.manualOverride}
              placeholder="—"
              className="h-9 text-xs"
              style={!block.manualOverride ? { backgroundColor: block.avgNav !== null ? 'rgba(5,150,105,0.04)' : '#F7F5F0' } : {}}
            />
          </div>
        </div>
      )}

      {/* Manual override toggle */}
      {!block.isCalculating && (
        <button
          type="button"
          onClick={() => update({ manualOverride: !block.manualOverride })}
          className="text-[11px] underline"
          style={{ color: '#C9A84C' }}
        >
          {block.manualOverride ? 'Use auto-calculated values' : 'Edit manually'}
        </button>
      )}

      {/* Mini summary */}
      {hasResult && !block.isCalculating && (
        <div className="grid grid-cols-4 gap-2 pt-2 border-t" style={{ borderColor: '#E8E5DD' }}>
          <div>
            <p className="text-[10px]" style={{ color: '#9CA3AF' }}>Invested</p>
            <p className="text-xs font-semibold" style={{ color: '#1A1A2E' }}>{formatLargeINR(effectiveInvested)}</p>
          </div>
          {block.currentValue !== null && !block.manualOverride && (
            <>
              <div>
                <p className="text-[10px]" style={{ color: '#9CA3AF' }}>Current</p>
                <p className="text-xs font-semibold" style={{ color: '#1A1A2E' }}>{formatLargeINR(block.currentValue)}</p>
              </div>
              <div>
                <p className="text-[10px]" style={{ color: '#9CA3AF' }}>P&L</p>
                <p className="text-xs font-semibold flex items-center gap-0.5"
                  style={{ color: (block.pnl ?? 0) >= 0 ? '#059669' : '#DC2626' }}>
                  {(block.pnl ?? 0) >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {formatLargeINR(Math.abs(block.pnl ?? 0))}
                </p>
              </div>
              <div>
                <p className="text-[10px]" style={{ color: '#9CA3AF' }}>XIRR</p>
                <p className="text-xs font-semibold" style={{ color: (block.xirr ?? 0) >= 0 ? '#059669' : '#DC2626' }}>
                  {block.xirr !== null ? `${(block.xirr * 100).toFixed(1)}%` : '—'}
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Breakdown toggle */}
      {block.breakdown.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => update({ showBreakdown: !block.showBreakdown })}
            className="flex items-center gap-1 text-[11px]"
            style={{ color: '#6B7280' }}
          >
            <ChevronRight className={`w-3 h-3 transition-transform ${block.showBreakdown ? 'rotate-90' : ''}`} />
            View SIP installment details ({block.breakdown.length} months)
          </button>
          {block.showBreakdown && (
            <div className="mt-2 rounded-lg border overflow-auto max-h-48" style={{ borderColor: '#E8E5DD' }}>
              <table className="w-full text-[11px]">
                <thead>
                  <tr style={{ backgroundColor: '#F7F5F0' }}>
                    <th className="px-3 py-1.5 text-left font-semibold" style={{ color: '#6B7280' }}>Date</th>
                    <th className="px-3 py-1.5 text-right font-semibold" style={{ color: '#6B7280' }}>NAV</th>
                    <th className="px-3 py-1.5 text-right font-semibold" style={{ color: '#6B7280' }}>Stamp Duty</th>
                    <th className="px-3 py-1.5 text-right font-semibold" style={{ color: '#6B7280' }}>Eff. Amount</th>
                    <th className="px-3 py-1.5 text-right font-semibold" style={{ color: '#6B7280' }}>Units (4dp)</th>
                    <th className="px-3 py-1.5 text-right font-semibold" style={{ color: '#6B7280' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {block.breakdown.map((row, i) => {
                    const r = row as typeof row & { stamp_duty?: number; effective_amount?: number };
                    return (
                      <tr key={i} className="border-t" style={{ borderColor: '#F0EDE6' }}>
                        <td className="px-3 py-1.5" style={{ color: '#1A1A2E' }}>{row.date}</td>
                        <td className="px-3 py-1.5 text-right" style={{ color: '#1A1A2E' }}>₹{row.nav.toFixed(4)}</td>
                        <td className="px-3 py-1.5 text-right" style={{ color: '#9CA3AF' }}>
                          {r.stamp_duty ? `₹${r.stamp_duty.toFixed(2)}` : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right" style={{ color: '#6B7280' }}>
                          {r.effective_amount ? `₹${r.effective_amount.toFixed(2)}` : `₹${row.amount.toLocaleString('en-IN')}`}
                        </td>
                        <td className="px-3 py-1.5 text-right font-medium" style={{ color: '#1A1A2E' }}>{row.units_purchased.toFixed(4)}</td>
                        <td className="px-3 py-1.5 text-right" style={{ color: '#1A1A2E' }}>₹{row.amount.toLocaleString('en-IN')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Search Params Reader (isolated Suspense boundary) ───────────────────────
// Keeps useSearchParams() in its own tiny component so the main page can
// render fully on the server without being wrapped in Suspense itself.

function SearchParamsReader({
  onParams,
}: {
  onParams: (edit: string | null, addTo: string | null, sip: boolean, editTxn: string | null) => void;
}) {
  const searchParams = useSearchParams();
  const cbRef = useRef(onParams);
  cbRef.current = onParams;
  useLayoutEffect(() => {
    cbRef.current(
      searchParams.get('edit'),
      searchParams.get('add_to'),
      searchParams.get('sip') === '1',
      searchParams.get('edit_transaction'),
    );
  }, [searchParams]);
  return null;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MutualFundsPage() {
  const router  = useRouter();
  const supabase = createClient();

  // ── Mode (new / edit / add_to) ─────────────────────────────────────────────
  const [editHoldingId,  setEditHoldingId]  = useState<string | null>(null);
  const [addToHoldingId, setAddToHoldingId] = useState<string | null>(null);
  const [forceSipMode,   setForceSipMode]   = useState(false);
  const mode      = editHoldingId ? 'edit' : addToHoldingId ? 'add_to' : 'new';
  const prefillId = editHoldingId ?? addToHoldingId;
  const { prefill, loading: prefillLoading, error: prefillError } = useHoldingPrefill(prefillId);

  // ── Auth & family data ─────────────────────────────────────────────────────
  const [familyId,    setFamilyId]    = useState<string | null>(null);
  const [members,     setMembers]     = useState<FamilyMember[]>([]);
  const [dbPortfolios, setDbPortfolios] = useState<Portfolio[]>([]);
  const [member,      setMember]      = useState('');
  const [memberName,  setMemberName]  = useState('');

  // ── Step 1 ─────────────────────────────────────────────────────────────────
  const [portfolio,   setPortfolio]   = useState('Long-term Growth');
  const [broker,      setBroker]      = useState('');

  // ── Step 2 — fund search ───────────────────────────────────────────────────
  const [query,        setQuery]       = useState('');
  const [showDrop,     setShowDrop]    = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching,  setIsSearching] = useState(false);
  const [selectedFund, setSelectedFund] = useState<SearchResult | null>(null);
  const [navData,      setNavData]     = useState<NavData | null>(null);
  const [isNavLoading, setIsNavLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const dropRef     = useRef<HTMLDivElement>(null);

  // ── Step 3 — mode toggle ───────────────────────────────────────────────────
  const [isSIP, setIsSIP] = useState(false);

  // ── Lump sum fields ────────────────────────────────────────────────────────
  const [amount,       setAmount]       = useState('');
  const [nav,          setNav]          = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [histNavHint,  setHistNavHint]  = useState<{ nav: number; date: string } | null>(null);
  const [isHistLoading, setIsHistLoading] = useState(false);
  const [folio,        setFolio]        = useState('');
  // ── Multi-SIP blocks ───────────────────────────────────────────────────────
  const [sipBlocks, setSipBlocks] = useState<SipBlock[]>([newSipBlock()]);

  // ── Holder details ─────────────────────────────────────────────────────────
  const [holder,          setHolder]          = useState<HolderFields>({ ...BLANK_HOLDER });
  const [savedHolder,     setSavedHolder]     = useState<HolderFields | null>(null);
  const [showReuseHolder, setShowReuseHolder] = useState(false);

  // ── UI ─────────────────────────────────────────────────────────────────────
  const [errors,   setErrors]   = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [toast,    setToast]    = useState<Toast | null>(null);
  const [importHistoryKey, setImportHistoryKey] = useState(0);

  // ── Edit single transaction mode ───────────────────────────────────────────
  const [editTxnId,      setEditTxnId]      = useState<string | null>(null);
  const [editTxnLoading, setEditTxnLoading] = useState(false);
  const [editTxnError,   setEditTxnError]   = useState('');
  const [editTxnData,    setEditTxnData]    = useState<{
    fundName: string; txnType: string; folio: string;
  } | null>(null);

  // ── Load user + family ─────────────────────────────────────────────────────
  useEffect(() => {
    async function loadUser() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }

      const { data: profile } = await supabase
        .from('users').select('id, name, family_id').eq('id', user.id).single();
      if (!profile) return;
      setMember(profile.id);
      setMemberName(profile.name ?? '');
      if (profile.family_id) setFamilyId(profile.family_id);

      if (profile.family_id) {
        const { data: familyUsers } = await supabase
          .from('users').select('id, name').eq('family_id', profile.family_id);
        setMembers(familyUsers ?? [{ id: profile.id, name: profile.name }]);
      } else {
        setMembers([{ id: profile.id, name: profile.name }]);
      }

      const { data: portfolios } = await supabase
        .from('portfolios').select('id, name, type').eq('user_id', user.id);
      if (portfolios?.length) {
        setDbPortfolios(portfolios);
        setPortfolio(portfolios[0].name);
      }
    }
    loadUser();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update memberName when member changes
  useEffect(() => {
    const m = members.find((x) => x.id === member);
    if (m) setMemberName(m.name);
  }, [member, members]);

  // ── Close dropdown ─────────────────────────────────────────────────────────
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setShowDrop(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Apply prefill when entering edit / add_to mode ─────────────────────────
  useEffect(() => {
    if (!prefill) return;
    setSelectedFund({ schemeCode: prefill.schemeCode, schemeName: prefill.schemeName, category: detectCategory(prefill.schemeName, prefill.category) });
    setQuery(prefill.schemeName);
    setPortfolio(prefill.portfolioName);
    if (prefill.brokerId) setBroker(prefill.brokerId);
    setFolio(prefill.folio);
    setIsSIP(forceSipMode || prefill.isSIP);
    setHolder(prefill.holder);
    if (prefill.isSIP) {
      setSipBlocks(prefill.sipGroups.length > 0
        ? prefill.sipGroups.map((g) => ({
            ...newSipBlock(),
            sipAmount: g.sipAmount, sipDate: g.sipDate, sipStart: g.sipStart,
            manualOverride: true,
            manualInstallments: g.manualInstallments,
            manualTotalUnits:   g.manualTotalUnits,
            manualAvgNav:       g.manualAvgNav,
          }))
        : [newSipBlock()]);
    } else {
      setAmount(prefill.investedAmount.toFixed(2));
      setNav(prefill.purchaseNav.toFixed(4));
      setPurchaseDate(prefill.purchaseDate);
    }
    setIsNavLoading(true);
    fetch(`/api/mf/nav?scheme_code=${prefill.schemeCode}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: NavData | null) => { if (data) setNavData(data); })
      .finally(() => setIsNavLoading(false));
  }, [prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load single transaction for edit_transaction mode ──────────────────────
  useEffect(() => {
    if (!editTxnId) { setEditTxnData(null); setEditTxnError(''); return; }
    setEditTxnLoading(true);
    setEditTxnError('');
    (async () => {
      try {
        const { data: txn, error: txnErr } = await supabase
          .from('transactions')
          .select('id, type, price, quantity, date, fees, holding_id')
          .eq('id', editTxnId)
          .single();
        if (txnErr || !txn) { setEditTxnError('Transaction not found'); setEditTxnLoading(false); return; }
        const { data: holding, error: holdingErr } = await supabase
          .from('holdings')
          .select('id, symbol, name, metadata')
          .eq('id', txn.holding_id)
          .single();
        if (holdingErr || !holding) { setEditTxnError('Holding not found'); setEditTxnLoading(false); return; }
        const meta = (holding.metadata ?? {}) as Record<string, unknown>;
        // Pre-fill form fields: invested amount ≈ price × quantity + fees
        setAmount(String(Math.round(Number(txn.price) * Number(txn.quantity) + Number(txn.fees ?? 0))));
        setPurchaseDate(txn.date);
        setNav(String(txn.price));
        setFolio(meta.folio ? String(meta.folio) : '');
        setEditTxnData({
          fundName: holding.name,
          txnType:  txn.type,
          folio:    meta.folio ? String(meta.folio) : '',
        });
        setEditTxnLoading(false);
      } catch (e) {
        setEditTxnError(e instanceof Error ? e.message : 'Failed to load transaction');
        setEditTxnLoading(false);
      }
    })();
  }, [editTxnId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fund search ────────────────────────────────────────────────────────────
  function handleQueryChange(val: string) {
    setQuery(val);
    setSelectedFund(null);
    setNavData(null);
    clearTimeout(debounceRef.current);
    if (val.length < 2) { setSearchResults([]); setShowDrop(false); return; }
    setIsSearching(true);
    setShowDrop(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/mf/search?q=${encodeURIComponent(val)}`);
        const json = await res.json();
        setSearchResults(json.results ?? []);
      } finally { setIsSearching(false); }
    }, 300);
  }

  const selectFund = useCallback(async (fund: SearchResult) => {
    const refinedFund = { ...fund, category: detectCategory(fund.schemeName, fund.category) };
    setSelectedFund(refinedFund);
    setQuery(fund.schemeName);
    setShowDrop(false);
    setNavData(null);
    setIsNavLoading(true);
    try {
      const res = await fetch(`/api/mf/nav?scheme_code=${fund.schemeCode}`);
      if (res.ok) {
        const data: NavData = await res.json();
        setNavData(data);
        if (!nav) setNav(data.nav.toString());
      }
    } finally { setIsNavLoading(false); }
  }, [nav]);

  // ── Historical NAV ─────────────────────────────────────────────────────────
  async function handleDateChange(date: string) {
    setPurchaseDate(date);
    setHistNavHint(null);
    if (!selectedFund || !date) return;
    setIsHistLoading(true);
    try {
      const res = await fetch(`/api/mf/nav-history?scheme_code=${selectedFund.schemeCode}&date=${date}`);
      if (res.ok) {
        const data = await res.json();
        setHistNavHint({ nav: data.nav, date: data.actualDate });
        setNav(data.nav.toString());
      }
    } finally { setIsHistLoading(false); }
  }

  // ── Lump-sum calculations ──────────────────────────────────────────────────
  // Stamp duty (0.005%) applied only for purchase dates on/after 2020-07-01
  const STAMP_DUTY_CUTOFF = '2020-07-01';
  const applyStampDuty = !!purchaseDate && purchaseDate >= STAMP_DUTY_CUTOFF;
  const stampDutyAmt   = amount ? parseFloat((parseFloat(amount) * 0.00005).toFixed(2)) : 0;
  const effectiveAmount = amount
    ? parseFloat(amount) - (applyStampDuty ? stampDutyAmt : 0)
    : 0;
  const units   = amount && nav
    ? (effectiveAmount / parseFloat(nav)).toFixed(4)
    : '';
  const currVal = navData && units
    ? (parseFloat(units) * navData.nav).toFixed(2)
    : '';
  const returns = currVal && amount
    ? ((parseFloat(currVal) - parseFloat(amount)) / parseFloat(amount) * 100).toFixed(2)
    : '';
  const canCalc = !!(amount && nav && selectedFund && navData);

  // ── Combined SIP totals ────────────────────────────────────────────────────
  const sipTotals = sipBlocks.reduce(
    (acc, b) => {
      const inst = b.manualOverride ? (parseInt(b.manualInstallments) || 0) : (b.installments ?? 0);
      const u    = b.manualOverride ? (parseFloat(b.manualTotalUnits) || 0) : (b.totalUnits ?? 0);
      const inv  = b.manualOverride
        ? (parseFloat(b.sipAmount) || 0) * inst
        : (b.totalInvested ?? 0);
      const cv   = b.manualOverride && navData ? u * navData.nav : (b.currentValue ?? 0);
      return { units: acc.units + u, invested: acc.invested + inv, currentValue: acc.currentValue + cv };
    },
    { units: 0, invested: 0, currentValue: 0 },
  );
  const sipCombinedAvgNav = sipTotals.units > 0 ? sipTotals.invested / sipTotals.units : 0;
  const sipCombinedPnL    = sipTotals.currentValue - sipTotals.invested;
  const sipCombinedPnLPct = sipTotals.invested > 0 ? (sipCombinedPnL / sipTotals.invested) * 100 : 0;
  const sipCanShowSummary = sipTotals.invested > 0 && sipTotals.units > 0;

  // Combined XIRR across all SIP blocks
  let sipCombinedXIRR: number | null = null;
  if (sipCanShowSummary && sipTotals.currentValue > 0) {
    try {
      const allFlows: number[] = [];
      const allDates: Date[]   = [];
      for (const b of sipBlocks) {
        if (b.breakdown.length > 0) {
          for (const row of b.breakdown) {
            allFlows.push(-row.amount);
            allDates.push(new Date(row.date));
          }
        }
      }
      if (allFlows.length > 0) {
        allFlows.push(sipTotals.currentValue);
        allDates.push(new Date());
        sipCombinedXIRR = calculateXIRR(allFlows, allDates);
      }
    } catch { sipCombinedXIRR = null; }
  }

  // ── Validate ───────────────────────────────────────────────────────────────
  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!selectedFund) errs.fund = 'Please select a fund';
    if (isSIP) {
      let sipOk = true;
      const updatedBlocks = sipBlocks.map((b) => {
        const be: Record<string, string> = {};
        if (!b.sipAmount || parseFloat(b.sipAmount) <= 0) { be.sipAmount = 'Enter SIP amount'; sipOk = false; }
        if (!b.sipStart) { be.sipStart = 'Enter start date'; sipOk = false; }
        if (!b.installments && !b.manualInstallments) { be.installments = 'Calc or enter instalments'; sipOk = false; }
        return { ...b, errors: be };
      });
      setSipBlocks(updatedBlocks);
      if (!sipOk) errs.sip = 'Fix SIP errors above';
    } else {
      if (!amount || parseFloat(amount) <= 0) errs.amount = 'Enter invested amount';
      if (!nav || parseFloat(nav) <= 0) errs.nav = 'Enter NAV at purchase';
      if (!purchaseDate) errs.purchaseDate = 'Enter purchase date';
    }
    if (!broker) errs.broker = 'Select a platform';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave(andAnother = false) {
    if (!validate()) return;
    setIsSaving(true);
    setToast(null);

    const holderMeta = {
      first_holder:  holder.firstHolder || memberName,
      second_holder: holder.secondHolder || null,
      nominee:       holder.nominee      || null,
      mobile:        holder.mobile       || null,
      email:         holder.email        || null,
      bank_name:     holder.bankName     || null,
      bank_last4:    holder.bankLast4    || null,
    };

    let payload: Record<string, unknown>;
    if (isSIP) {
      payload = {
        schemeCode:     selectedFund!.schemeCode,
        schemeName:     selectedFund!.schemeName,
        category:       selectedFund!.category,
        fundHouse:      navData?.fundHouse,
        purchaseDate:   sipBlocks[0].sipStart,
        purchaseNav:    sipCombinedAvgNav,
        investedAmount: sipTotals.invested,
        units:          sipTotals.units,
        folio,
        isSIP:          true,
        portfolioName:  portfolio,
        brokerId:       broker || undefined,
        currentNav:     navData?.nav,
        sipMetadata: {
          is_sip: true,
          sips: sipBlocks.map((b) => {
            const inst = b.manualOverride ? parseInt(b.manualInstallments) : (b.installments ?? 0);
            const u    = b.manualOverride ? parseFloat(b.manualTotalUnits)  : (b.totalUnits ?? 0);
            return { amount: parseFloat(b.sipAmount), date: b.sipDate, start_date: b.sipStart, installments: inst, units: u };
          }),
        },
        holderDetails: holderMeta,
        // Per-SIP structured breakdown for individual transaction rows
        sipMonthlyBreakdown: sipBlocks.some(b => b.breakdown.length > 0)
          ? sipBlocks.map((b, i) => ({
              sipNumber: i + 1,
              sipAmount: parseFloat(b.sipAmount),
              sipDate:   b.sipDate,
              sipStart:  b.sipStart,
              breakdown: b.breakdown,
            }))
          : undefined,
      };
    } else {
      payload = {
        schemeCode:     selectedFund!.schemeCode,
        schemeName:     selectedFund!.schemeName,
        category:       selectedFund!.category,
        fundHouse:      navData?.fundHouse,
        purchaseDate,
        purchaseNav:    parseFloat(nav),
        investedAmount: parseFloat(amount),
        units:          parseFloat(units || '0'),
        folio,
        isSIP:          false,
        portfolioName:  portfolio,
        brokerId:       broker || undefined,
        currentNav:     navData?.nav,
        holderDetails:  holderMeta,
      };
    }

    try {
      const endpoint    = mode === 'add_to' ? '/api/mf/add-units'
                        : mode === 'edit'   ? '/api/mf/update'
                        :                    '/api/mf/save';
      const httpMethod  = mode === 'edit' ? 'PUT' : 'POST';
      const finalPayload = mode === 'new' ? payload : { ...payload, holdingId: prefillId };
      const res = await fetch(endpoint, {
        method: httpMethod,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalPayload),
      });
      const json = await res.json();
      if (!res.ok) { setToast({ type: 'error', message: json.error ?? 'Save failed' }); return; }

      const fundShortName = selectedFund!.schemeName.split(' - ')[0];
      const successMsg = json.consolidated
        ? `Units added to existing ${fundShortName} holding!`
        : `${fundShortName} saved!`;
      setToast({ type: 'success', message: successMsg });

      if (andAnother) {
        setSavedHolder({ ...holder });
        setShowReuseHolder(true);
        setQuery(''); setSelectedFund(null); setNavData(null);
        setAmount(''); setNav(''); setPurchaseDate(''); setHistNavHint(null);
        setFolio(''); setSipBlocks([newSipBlock()]); setErrors({});
        setHolder({ ...BLANK_HOLDER });
      } else {
        setTimeout(() => router.push('/portfolio/mutual-funds'), 1200);
      }
    } catch (e) {
      setToast({ type: 'error', message: String(e) });
    } finally {
      setIsSaving(false); }
  }

  // ── Save a single transaction (edit_transaction mode) ─────────────────────
  async function handleSaveTransaction() {
    const errs: Record<string, string> = {};
    if (!amount || parseFloat(amount) <= 0) errs.amount = 'Enter invested amount';
    if (!nav    || parseFloat(nav)    <= 0) errs.nav    = 'Enter NAV at purchase';
    if (!purchaseDate)                      errs.purchaseDate = 'Enter purchase date';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setIsSaving(true);
    setToast(null);
    const n     = parseFloat(nav);
    const applySD = purchaseDate >= '2020-07-01';
    const sd    = applySD ? parseFloat((parseFloat(amount) * 0.00005).toFixed(2)) : 0;
    const effAmt = parseFloat(amount) - sd;
    const u     = parseFloat((effAmt / n).toFixed(6));

    try {
      const res = await fetch('/api/mf/update-transaction', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: editTxnId, price: n, quantity: u, date: purchaseDate, fees: sd }),
      });
      const json = await res.json();
      if (!res.ok) { setToast({ type: 'error', message: json.error ?? 'Update failed' }); return; }
      setToast({ type: 'success', message: 'Transaction updated' });
      setTimeout(() => router.push('/portfolio/mutual-funds'), 1200);
    } catch (e) {
      setToast({ type: 'error', message: String(e) });
    } finally {
      setIsSaving(false);
    }
  }

  // ── Update a single SIP block ──────────────────────────────────────────────
  function updateSipBlock(id: string, updated: SipBlock) {
    setSipBlocks((prev) => prev.map((b) => b.id === id ? updated : b));
  }

  const allPortfolios = dbPortfolios.length > 0 ? dbPortfolios.map((p) => p.name) : DEFAULT_PORTFOLIOS;

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Isolated Suspense for search params — does not affect page SSR */}
      <Suspense>
        <SearchParamsReader onParams={(edit, addTo, sip, editTxn) => {
          setEditHoldingId(edit);
          setAddToHoldingId(addTo);
          setForceSipMode(sip);
          setEditTxnId(editTxn);
        }} />
      </Suspense>

      <div className="flex items-center gap-4 mb-6">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(46,139,139,0.1)' }}>
          <BarChart3 className="w-5 h-5" style={{ color: '#2E8B8B' }} />
        </div>
        <div>
          <h1 className="font-display text-xl font-semibold" style={{ color: '#1A1A2E' }}>
            {editTxnId ? 'Edit Transaction'
              : mode === 'edit' ? 'Edit Holding'
              : mode === 'add_to' ? 'Add More Units'
              : 'Mutual Funds'}
          </h1>
          <p className="text-xs" style={{ color: '#9CA3AF' }}>
            {editTxnId ? (editTxnData?.fundName ?? '…')
              : mode === 'edit'   ? 'Update the details for this holding'
              : mode === 'add_to' ? 'Add more units to an existing holding'
              : 'Add and manage your mutual fund holdings'}
          </p>
        </div>
      </div>

      {toast && <ToastBanner toast={toast} onClose={() => setToast(null)} />}

      {/* ── Edit Transaction mode ──────────────────────────────────────────── */}
      {editTxnId ? (
        <>
          {editTxnLoading && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl mb-4 text-xs"
              style={{ backgroundColor: 'rgba(27,42,74,0.06)', border: '1px solid rgba(27,42,74,0.15)', color: '#1B2A4A' }}>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />Loading transaction data…
            </div>
          )}
          {editTxnError && !editTxnLoading && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl mb-4 text-xs"
              style={{ backgroundColor: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', color: '#DC2626' }}>
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{editTxnError}
              <button onClick={() => router.push('/portfolio/mutual-funds')} className="ml-auto underline flex-shrink-0">Back to portfolio</button>
            </div>
          )}
          {editTxnData && !editTxnLoading && !editTxnError && (
            <div className="wv-card p-5 space-y-4">
              {/* Locked banner */}
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                style={{ backgroundColor: 'rgba(27,42,74,0.04)', border: '1px solid rgba(27,42,74,0.08)' }}>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold"
                  style={{ backgroundColor: editTxnData.txnType === 'sip' ? 'rgba(59,130,246,0.12)' : 'rgba(27,42,74,0.10)',
                           color: editTxnData.txnType === 'sip' ? '#2563EB' : '#1B2A4A' }}>
                  {editTxnData.txnType === 'sip' ? 'SIP' : 'Lump Sum'}
                </span>
                <span className="text-xs font-semibold flex-1" style={{ color: '#1A1A2E' }}>{editTxnData.fundName}</span>
                <span className="text-[10px]" style={{ color: '#9CA3AF' }}>Fund &amp; portfolio locked</span>
              </div>

              {/* Editable fields */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Invested Amount (₹)</Label>
                  <Input value={amount} onChange={(e) => { setAmount(e.target.value); setErrors(er => ({ ...er, amount: '' })); }}
                    placeholder="50000" className="h-9 text-xs" type="number"
                    style={errors.amount ? { borderColor: '#DC2626' } : {}} />
                  <FieldError msg={errors.amount} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>
                    Purchase Date
                    {isHistLoading && <Loader2 className="w-2.5 h-2.5 inline ml-1 animate-spin" style={{ color: '#9CA3AF' }} />}
                  </Label>
                  <Input type="date" value={purchaseDate}
                    onChange={(e) => { handleDateChange(e.target.value); setErrors(er => ({ ...er, purchaseDate: '' })); }}
                    className="h-9 text-xs" max={new Date().toISOString().split('T')[0]}
                    style={errors.purchaseDate ? { borderColor: '#DC2626' } : {}} />
                  <FieldError msg={errors.purchaseDate} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>NAV at Purchase</Label>
                  {histNavHint && (
                    <p className="text-[10px]" style={{ color: '#059669' }}>
                      NAV on {fmtNavDate(histNavHint.date)}: ₹{histNavHint.nav.toFixed(4)} (auto-filled)
                    </p>
                  )}
                  <Input value={nav} onChange={(e) => { setNav(e.target.value); setErrors(er => ({ ...er, nav: '' })); }}
                    placeholder="54.1200" className="h-9 text-xs" type="number" step="0.0001"
                    style={errors.nav ? { borderColor: '#DC2626' } : {}} />
                  <FieldError msg={errors.nav} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>
                    Units Allotted
                    {applyStampDuty && <span className="ml-1 text-[10px]" style={{ color: '#059669' }}>after stamp duty</span>}
                  </Label>
                  <Input value={units} readOnly placeholder="= (Amount − Stamp Duty) ÷ NAV" className="h-9 text-xs"
                    style={{ backgroundColor: units ? 'rgba(5,150,105,0.04)' : undefined }} />
                  {applyStampDuty && units && (
                    <p className="text-[10px]" style={{ color: '#9CA3AF' }}>
                      Stamp duty ₹{stampDutyAmt.toFixed(2)} · effective ₹{effectiveAmount.toFixed(2)}
                    </p>
                  )}
                </div>
                {editTxnData.folio && (
                  <div className="space-y-1.5">
                    <Label className="text-xs" style={{ color: '#6B7280' }}>Folio</Label>
                    <Input value={editTxnData.folio} readOnly className="h-9 text-xs"
                      style={{ backgroundColor: '#F7F5F0' }} />
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <Button onClick={handleSaveTransaction} disabled={isSaving}
                  className="flex-1 h-9 text-xs font-semibold"
                  style={{ backgroundColor: '#C9A84C', color: '#1B2A4A' }}>
                  {isSaving
                    ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</>
                    : 'Update Transaction'}
                </Button>
                <Button variant="outline" onClick={() => router.push('/portfolio/mutual-funds')}
                  className="h-9 text-xs" style={{ borderColor: '#E8E5DD', color: '#6B7280' }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
      <>

      {/* Prefill loading / error / mode banners */}
      {prefillLoading && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl mb-4 text-xs"
          style={{ backgroundColor: 'rgba(27,42,74,0.06)', border: '1px solid rgba(27,42,74,0.15)', color: '#1B2A4A' }}>
          <Loader2 className="w-3.5 h-3.5 animate-spin" />Loading holding data…
        </div>
      )}
      {prefillError && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl mb-4 text-xs"
          style={{ backgroundColor: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', color: '#DC2626' }}>
          <AlertCircle className="w-3.5 h-3.5" />{prefillError}
        </div>
      )}
      {mode === 'add_to' && !prefillLoading && (
        <div className="flex items-center justify-between px-4 py-3 rounded-xl mb-4 text-xs"
          style={{ backgroundColor: 'rgba(5,150,105,0.06)', border: '1px solid rgba(5,150,105,0.2)', color: '#059669' }}>
          <span className="flex flex-col gap-0.5">
            <span className="font-semibold">
              <TrendingUp className="w-3.5 h-3.5 inline mr-1.5" />
              Adding units to: {prefill?.schemeName ?? '…'}
            </span>
            {prefill && (
              <span style={{ color: '#6B7280' }}>
                Existing: {prefill.existingUnits.toFixed(4)} units · Invested: {formatLargeINR(prefill.investedAmount)}
              </span>
            )}
          </span>
          <button onClick={() => router.push('/portfolio/mutual-funds')} className="underline ml-4 flex-shrink-0" style={{ color: '#6B7280' }}>Cancel</button>
        </div>
      )}
      {mode === 'edit' && !prefillLoading && (
        <div className="flex items-center justify-between px-4 py-3 rounded-xl mb-4 text-xs"
          style={{ backgroundColor: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.2)', color: '#C9A84C' }}>
          <span>Editing holding — existing buy/SIP transactions will be replaced on save</span>
          <button onClick={() => router.push('/portfolio/mutual-funds')} className="underline" style={{ color: '#6B7280' }}>Cancel</button>
        </div>
      )}

      {/* Reuse holder banner */}
      {showReuseHolder && savedHolder && (
        <div className="flex items-center justify-between px-4 py-3 rounded-xl mb-4 text-xs"
          style={{ backgroundColor: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)' }}>
          <span style={{ color: '#C9A84C' }}>Use same holder &amp; contact details for this entry?</span>
          <div className="flex gap-2">
            <button onClick={() => { setHolder({ ...savedHolder }); setShowReuseHolder(false); }}
              className="px-3 py-1 rounded-lg text-xs font-semibold"
              style={{ backgroundColor: '#C9A84C', color: '#1B2A4A' }}>Yes</button>
            <button onClick={() => setShowReuseHolder(false)}
              className="px-3 py-1 rounded-lg text-xs" style={{ color: '#6B7280' }}>No</button>
          </div>
        </div>
      )}

      <Tabs defaultValue="manual">
        <TabsList className="mb-5 w-full" style={{ backgroundColor: '#F7F5F0', border: '1px solid #E8E5DD' }}>
          <TabsTrigger value="manual"  className="flex-1 gap-1.5 text-xs data-[state=active]:bg-white"><BarChart3 className="w-3.5 h-3.5" />Manual Entry</TabsTrigger>
          <TabsTrigger value="import"  className="flex-1 gap-1.5 text-xs data-[state=active]:bg-white"><Upload   className="w-3.5 h-3.5" />CSV / Statement</TabsTrigger>
          <TabsTrigger value="api"     className="flex-1 gap-1.5 text-xs data-[state=active]:bg-white"><LinkIcon className="w-3.5 h-3.5" />API Fetch</TabsTrigger>
        </TabsList>

        {/* ─── Tab 1: Manual Entry ─── */}
        <TabsContent value="manual" className="space-y-4">

          {/* Step 1 — Portfolio & Broker */}
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>Step 1 — Portfolio &amp; Broker</p>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Family Member</Label>
                  <Select value={member} onValueChange={setMember}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Loading…" /></SelectTrigger>
                    <SelectContent>
                      {members.length > 0
                        ? members.map((m) => <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>)
                        : <SelectItem value="loading" className="text-xs" disabled>Loading…</SelectItem>
                      }
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Portfolio</Label>
                <div className="flex flex-wrap gap-2">
                  {allPortfolios.map((p) => (
                    <button key={p} onClick={() => setPortfolio(p)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
                      style={{ backgroundColor: portfolio === p ? '#1B2A4A' : 'transparent',
                               color: portfolio === p ? 'white' : '#6B7280',
                               borderColor: portfolio === p ? '#1B2A4A' : '#E8E5DD' }}>
                      {p}
                    </button>
                  ))}
                  <button
                    onClick={() => { const n = prompt('Portfolio name:'); if (n?.trim()) setPortfolio(n.trim()); }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border-dashed border transition-colors"
                    style={{ color: '#C9A84C', borderColor: '#C9A84C' }}>+ New</button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Platform / Broker</Label>
                <BrokerSelector familyId={familyId} selectedBrokerId={broker}
                  onChange={(id) => { setBroker(id); setErrors((e) => ({ ...e, broker: '' })); }}
                  error={errors.broker} />
              </div>
            </div>
          </div>

          {/* Step 2 — Fund Search */}
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>Step 2 — Fund Search</p>
            <FieldError msg={errors.fund} />
            <div className="relative" ref={dropRef}>
              <div className="relative">
                <Input value={query}
                  onChange={(e) => handleQueryChange(e.target.value)}
                  onFocus={() => { if (searchResults.length > 0) setShowDrop(true); }}
                  placeholder="Type fund name (min 2 chars)…"
                  className="h-9 text-xs pr-8"
                  disabled={mode === 'add_to'}
                  style={errors.fund ? { borderColor: '#DC2626' } : {}} />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {isSearching
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: '#9CA3AF' }} />
                    : <ChevronDown className="w-3.5 h-3.5" style={{ color: '#9CA3AF' }} />}
                </div>
              </div>

              {showDrop && searchResults.length > 0 && (
                <div className="absolute top-full mt-1 left-0 right-0 rounded-xl border overflow-hidden bg-white"
                  style={{ borderColor: '#E8E5DD', zIndex: 9999, boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
                  {searchResults.map((f) => {
                    const cc = getCatStyle(f.category);
                    return (
                      <button key={f.schemeCode}
                        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 text-left border-b last:border-0 transition-colors"
                        style={{ borderColor: '#F0EDE6' }}
                        onMouseDown={(e) => { e.preventDefault(); selectFund(f); }}>
                        <div className="min-w-0 flex-1 mr-3">
                          <p className="text-xs font-medium truncate" style={{ color: '#1A1A2E' }}>{f.schemeName}</p>
                          <p className="text-[10px] mt-0.5" style={{ color: '#9CA3AF' }}>AMFI {f.schemeCode}</p>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0"
                          style={{ backgroundColor: cc.bg, color: cc.text }}>{f.category}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {selectedFund && (
              <div className="mt-3 p-3 rounded-xl flex items-start gap-3"
                style={{ backgroundColor: 'rgba(5,150,105,0.06)', border: '1px solid rgba(5,150,105,0.2)' }}>
                {isNavLoading
                  ? <Loader2 className="w-4 h-4 mt-0.5 flex-shrink-0 animate-spin" style={{ color: '#059669' }} />
                  : <Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#059669' }} />}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate" style={{ color: '#1A1A2E' }}>{selectedFund.schemeName}</p>
                  {navData ? (
                    <div className="flex items-center gap-3 mt-1">
                      <p className="text-[10px]" style={{ color: '#6B7280' }}>
                        Latest NAV: <strong style={{ color: '#1A1A2E' }}>₹{navData.nav.toFixed(4)}</strong>
                        {' · '}{fmtNavDate(navData.navDate)}
                      </p>
                      {navData.fundHouse && <p className="text-[10px]" style={{ color: '#9CA3AF' }}>{navData.fundHouse}</p>}
                    </div>
                  ) : isNavLoading ? (
                    <p className="text-[10px] mt-0.5" style={{ color: '#9CA3AF' }}>Fetching live NAV…</p>
                  ) : (
                    <p className="text-[10px] mt-0.5" style={{ color: '#DC2626' }}>NAV unavailable — enter manually</p>
                  )}
                </div>
                {navData && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0"
                    style={{ backgroundColor: getCatStyle(selectedFund.category).bg, color: getCatStyle(selectedFund.category).text }}>
                    {selectedFund.category}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Step 3 — Transaction Details */}
          <div className="wv-card p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#9CA3AF' }}>Step 3 — Transaction Details</p>
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: '#6B7280' }}>SIP</span>
                <button onClick={() => setIsSIP(!isSIP)}
                  className="relative w-10 h-5 rounded-full transition-colors"
                  style={{ backgroundColor: isSIP ? '#C9A84C' : '#E8E5DD' }}>
                  <div className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform"
                    style={{ transform: isSIP ? 'translateX(22px)' : 'translateX(2px)' }} />
                </button>
                <span className="text-xs font-semibold" style={{ color: isSIP ? '#C9A84C' : '#9CA3AF' }}>
                  {isSIP ? 'ON' : 'OFF'}
                </span>
              </div>
            </div>

            {isSIP ? (
              /* ── SIP blocks ── */
              <div className="space-y-3">
                {sipBlocks.map((block, idx) => (
                  <SipBlockCard
                    key={block.id}
                    block={block}
                    index={idx}
                    totalBlocks={sipBlocks.length}
                    schemeCode={selectedFund?.schemeCode ?? null}
                    onChange={(updated) => updateSipBlock(block.id, updated)}
                    onRemove={() => setSipBlocks((prev) => prev.filter((b) => b.id !== block.id))}
                  />
                ))}

                <button
                  type="button"
                  onClick={() => setSipBlocks((prev) => [...prev, newSipBlock()])}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed text-xs font-medium transition-colors hover:bg-yellow-50"
                  style={{ borderColor: '#C9A84C', color: '#C9A84C' }}>
                  <Plus className="w-3.5 h-3.5" />Add another SIP
                </button>

                {/* Folio for SIP */}
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1">
                    <Label className="text-xs" style={{ color: '#6B7280' }}>Folio Number</Label>
                    <Input value={folio} onChange={(e) => setFolio(e.target.value)} placeholder="123456789" className="h-9 text-xs" />
                  </div>
                </div>

                {/* Combined summary */}
                {sipCanShowSummary && (
                  <div className="p-3 rounded-xl grid grid-cols-4 gap-3"
                    style={{ backgroundColor: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.2)' }}>
                    <div>
                      <p className="text-[10px]" style={{ color: '#9CA3AF' }}>Total Invested</p>
                      <p className="text-xs font-bold" style={{ color: '#1A1A2E' }}>{formatLargeINR(sipTotals.invested)}</p>
                    </div>
                    <div>
                      <p className="text-[10px]" style={{ color: '#9CA3AF' }}>Current Value</p>
                      <p className="text-xs font-bold" style={{ color: '#1A1A2E' }}>{formatLargeINR(sipTotals.currentValue)}</p>
                    </div>
                    <div>
                      <p className="text-[10px]" style={{ color: '#9CA3AF' }}>P&amp;L</p>
                      <p className="text-xs font-bold flex items-center gap-0.5"
                        style={{ color: sipCombinedPnL >= 0 ? '#059669' : '#DC2626' }}>
                        {sipCombinedPnL >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {formatLargeINR(Math.abs(sipCombinedPnL))}
                        <span className="text-[10px]">({sipCombinedPnLPct >= 0 ? '+' : ''}{sipCombinedPnLPct.toFixed(1)}%)</span>
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px]" style={{ color: '#9CA3AF' }}>XIRR</p>
                      <p className="text-xs font-bold"
                        style={{ color: (sipCombinedXIRR ?? 0) >= 0 ? '#059669' : '#DC2626' }}>
                        {sipCombinedXIRR !== null ? `${(sipCombinedXIRR * 100).toFixed(1)}%` : '—'}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* ── Lump sum ── */
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Invested Amount (₹)</Label>
                  <Input value={amount} onChange={(e) => { setAmount(e.target.value); setErrors((er) => ({ ...er, amount: '' })); }}
                    placeholder="50000" className="h-9 text-xs" type="number"
                    style={errors.amount ? { borderColor: '#DC2626' } : {}} />
                  <FieldError msg={errors.amount} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>
                    Purchase Date
                    {isHistLoading && <Loader2 className="w-2.5 h-2.5 inline ml-1 animate-spin" style={{ color: '#9CA3AF' }} />}
                  </Label>
                  <Input type="date" value={purchaseDate}
                    onChange={(e) => { handleDateChange(e.target.value); setErrors((er) => ({ ...er, purchaseDate: '' })); }}
                    className="h-9 text-xs" max={new Date().toISOString().split('T')[0]}
                    style={errors.purchaseDate ? { borderColor: '#DC2626' } : {}} />
                  <FieldError msg={errors.purchaseDate} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>
                    NAV at Purchase
                    {navData && <span className="text-[10px] ml-1" style={{ color: '#C9A84C' }}>Today: ₹{navData.nav.toFixed(4)}</span>}
                  </Label>
                  {histNavHint && (
                    <p className="text-[10px]" style={{ color: '#059669' }}>
                      NAV on {fmtNavDate(histNavHint.date)}: ₹{histNavHint.nav.toFixed(4)} (auto-filled)
                    </p>
                  )}
                  <Input value={nav} onChange={(e) => { setNav(e.target.value); setErrors((er) => ({ ...er, nav: '' })); }}
                    placeholder="54.1200" className="h-9 text-xs" type="number" step="0.0001"
                    style={errors.nav ? { borderColor: '#DC2626' } : {}} />
                  <FieldError msg={errors.nav} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>
                    Units Allotted (4dp)
                    {applyStampDuty && <span className="ml-1 text-[10px]" style={{ color: '#059669' }}>after stamp duty</span>}
                  </Label>
                  <Input value={units} readOnly placeholder="= (Amount − Stamp Duty) ÷ NAV" className="h-9 text-xs"
                    style={{ backgroundColor: units ? 'rgba(5,150,105,0.04)' : undefined }} />
                  {applyStampDuty && units && (
                    <p className="text-[10px]" style={{ color: '#9CA3AF' }}>
                      Stamp duty ₹{stampDutyAmt.toFixed(2)} deducted · effective amount ₹{effectiveAmount.toFixed(2)}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Folio Number</Label>
                  <Input value={folio} onChange={(e) => setFolio(e.target.value)} placeholder="123456789" className="h-9 text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>
                    Stamp Duty (₹) — 0.005%
                    {!applyStampDuty && purchaseDate && <span className="ml-1 text-[10px]" style={{ color: '#9CA3AF' }}>not applicable (pre Jul 2020)</span>}
                  </Label>
                  <Input value={applyStampDuty ? stampDutyAmt.toFixed(2) : '0.00'} readOnly placeholder="0.00" className="h-9 text-xs" style={{ backgroundColor: '#F7F5F0' }} />
                </div>

                {/* Lump-sum summary strip */}
                {canCalc && (
                  <div className="col-span-2 p-3 rounded-xl grid grid-cols-4 gap-3"
                    style={{ backgroundColor: 'rgba(27,42,74,0.04)', border: '1px solid rgba(27,42,74,0.08)' }}>
                    <div>
                      <p className="text-[10px]" style={{ color: '#9CA3AF' }}>Invested</p>
                      <p className="text-xs font-bold" style={{ color: '#1A1A2E' }}>{formatLargeINR(parseFloat(amount))}</p>
                    </div>
                    <div>
                      <p className="text-[10px]" style={{ color: '#9CA3AF' }}>Current Est.</p>
                      <p className="text-xs font-bold" style={{ color: '#1A1A2E' }}>{formatLargeINR(parseFloat(currVal!))}</p>
                    </div>
                    <div>
                      <p className="text-[10px]" style={{ color: '#9CA3AF' }}>Returns</p>
                      <p className="text-xs font-bold flex items-center gap-0.5"
                        style={{ color: parseFloat(returns!) >= 0 ? '#059669' : '#DC2626' }}>
                        {parseFloat(returns!) >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {parseFloat(returns!) >= 0 ? '+' : ''}{returns}%
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px]" style={{ color: '#9CA3AF' }}>Units</p>
                      <p className="text-xs font-bold" style={{ color: '#1A1A2E' }}>{units}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Holder & Contact Details (both modes) */}
            <HolderSection holder={holder} onChange={setHolder} memberName={memberName} familyId={familyId} />

            {/* Action buttons */}
            <div className="flex items-center gap-3 mt-5">
              <Button onClick={() => handleSave(false)} disabled={isSaving}
                className="flex-1 h-9 text-xs font-semibold"
                style={{ backgroundColor: '#C9A84C', color: '#1B2A4A' }}>
                {isSaving
                  ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</>
                  : mode === 'edit'   ? 'Update Holding'
                  : mode === 'add_to' ? 'Add Units'
                  : 'Save entry'}
              </Button>
              {mode === 'new' && (
                <Button onClick={() => handleSave(true)} disabled={isSaving}
                  className="flex-1 h-9 text-xs font-semibold text-white"
                  style={{ backgroundColor: '#1B2A4A' }}>
                  Save &amp; add another
                </Button>
              )}
              <Button variant="outline" className="h-9 text-xs"
                style={{ borderColor: '#E8E5DD', color: '#6B7280' }}
                onClick={() => router.push('/portfolio/mutual-funds')}>
                Cancel
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* ─── Tab 2: CSV / Statement Import ─── */}
        <TabsContent value="import">
          {/* ── eCAS Statement Import (primary) ── */}
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#9CA3AF' }}>eCAS Statement Import</p>
            <p className="text-xs mb-5" style={{ color: '#6B7280' }}>Full transaction history — PDF, CSV, or Excel from CAMS or MFCentral</p>
            <ECASImporter
              familyId={familyId}
              members={members}
              portfolios={dbPortfolios}
              memberId={member}
              onImported={() => setImportHistoryKey(k => k + 1)}
            />
          </div>

          {/* ── Legacy CAS / Holdings-only Import (collapsed) ── */}
          <details className="wv-card p-5 mt-4 group">
            <summary className="flex items-center gap-2 cursor-pointer list-none select-none">
              <span className="text-xs font-semibold" style={{ color: '#6B7280' }}>Legacy CAS / Holdings-only Import</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: '#F7F5F0', color: '#9CA3AF' }}>Current balance only, no transaction history</span>
            </summary>
            <div className="mt-4">
              <CASImporter
                familyId={familyId}
                members={members}
                portfolios={dbPortfolios}
                memberId={member}
                onImported={() => setImportHistoryKey(k => k + 1)}
              />
            </div>
          </details>

          {/* ── Previous Imports ── */}
          <div className="wv-card p-5 mt-4">
            <div className="flex items-center gap-2 mb-4">
              <History className="w-4 h-4" style={{ color: '#9CA3AF' }} />
              <h3 className="text-sm font-semibold" style={{ color: '#1B2A4A' }}>Previous Imports</h3>
            </div>
            <ImportHistory
              key={importHistoryKey}
              memberNames={Object.fromEntries(members.map(m => [m.id, m.name]))}
              onHoldingsChanged={() => {}}
            />
          </div>
        </TabsContent>

        {/* ─── Tab 3: API Fetch ─── */}
        <TabsContent value="api">
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>Connect Platform APIs</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { name: 'MFCentral',       color: '#1B2A4A', letter: 'M', desc: 'Fetch from MFCentral portal' },
                { name: 'Kuvera',          color: '#5C6BC0', letter: 'K', desc: 'Import via Kuvera account'   },
                { name: 'Coin by Zerodha', color: '#2E8B8B', letter: 'C', desc: 'Zerodha Coin integration'    },
                { name: 'Groww',           color: '#00D09C', letter: 'G', desc: 'Groww mutual funds sync'     },
              ].map((api) => (
                <div key={api.name} className="p-4 rounded-xl border" style={{ borderColor: '#E8E5DD' }}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold"
                      style={{ backgroundColor: api.color }}>{api.letter}</div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: '#F5EDD6', color: '#C9A84C' }}>Coming Soon</span>
                  </div>
                  <p className="text-xs font-semibold mb-0.5" style={{ color: '#1A1A2E' }}>{api.name}</p>
                  <p className="text-[11px] mb-1" style={{ color: '#9CA3AF' }}>{api.desc}</p>
                  <p className="text-[10px] mb-3" style={{ color: '#D1D5DB' }}>Requires licensed AA integration</p>
                  <Button disabled className="w-full h-7 text-[11px]" style={{ backgroundColor: '#F7F5F0', color: '#9CA3AF' }}>
                    Coming Soon
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      </>
      )}
    </div>
  );
}
