'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AssetPageShell } from '@/components/forms/AssetPageShell';
import { Shield, Check, AlertCircle, X, Loader2, Calculator } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/utils/formatters';

// ─── Types ──────────────────────────────────────────────────────────────────

interface FamilyMember { id: string; name: string }
interface Toast { type: 'success' | 'error'; message: string }

// ─── Toast banner ───────────────────────────────────────────────────────────

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

// ─── Constants ──────────────────────────────────────────────────────────────

const FUND_MANAGERS = [
  'SBI Pension Fund',
  'LIC Pension Fund',
  'HDFC Pension Fund',
  'ICICI Prudential Pension Fund',
  'Kotak Pension Fund',
  'Aditya Birla Sun Life Pension Fund',
  'UTI Retirement Solutions',
];

const SECTION_80CCD_1_LIMIT = 150000;
const SECTION_80CCD_1B_LIMIT = 50000;

// ─── Page ───────────────────────────────────────────────────────────────────

export default function Page() {
  const supabase = createClient();
  const router = useRouter();

  // UI state
  const [toast, setToast] = useState<Toast | null>(null);
  const [saving, setSaving] = useState(false);

  // Members
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [member, setMember] = useState('');

  // Form fields
  const [pran, setPran] = useState('');
  const [tier, setTier] = useState('I');
  const [fundManager, setFundManager] = useState('');
  const [totalContribution, setTotalContribution] = useState('');
  const [currentValue, setCurrentValue] = useState('');
  const [employerContribution, setEmployerContribution] = useState('');
  const [notes, setNotes] = useState('');

  // ── Load user & family members ──────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.push('/login'); return; }
      const { data: profile } = await supabase
        .from('users').select('id, name, family_id').eq('id', user.id).single();
      if (!profile) return;
      setMember(profile.id);

      const fid = profile.family_id;
      if (fid) {
        const { data: fUsers } = await supabase
          .from('users').select('id, name').eq('family_id', fid);
        if (fUsers && fUsers.length > 0) {
          setMembers(fUsers);
        } else {
          setMembers([{ id: profile.id, name: profile.name }]);
        }
      } else {
        setMembers([{ id: profile.id, name: profile.name }]);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-calculations ─────────────────────────────────────────────────────

  const contribution = parseFloat(totalContribution) || 0;
  const value = parseFloat(currentValue) || 0;
  const empContrib = parseFloat(employerContribution) || 0;

  const calcs = useMemo(() => {
    const returns = value - contribution;
    const returnsPercent = contribution > 0 ? (returns / contribution) * 100 : 0;
    const selfContribution = contribution - empContrib;
    const eligible80CCD1 = Math.min(selfContribution, SECTION_80CCD_1_LIMIT);
    const eligible80CCD1B = Math.min(
      Math.max(selfContribution - SECTION_80CCD_1_LIMIT, 0),
      SECTION_80CCD_1B_LIMIT
    );

    return {
      returns,
      returnsPercent,
      selfContribution,
      eligible80CCD1,
      eligible80CCD1B,
    };
  }, [contribution, value, empContrib]);

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pran || !fundManager || !totalContribution || !currentValue) return;

    setSaving(true);
    setToast(null);

    try {
      const res = await fetch('/api/manual-assets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_type: 'nps',
          name: `NPS - ${fundManager}`,
          current_value: value,
          memberId: member,
          metadata: {
            pran,
            tier,
            fund_manager: fundManager,
            total_contribution: contribution,
            current_value: value,
            employer_contribution: empContrib,
            self_contribution: calcs.selfContribution,
            returns: calcs.returns,
            returns_percent: calcs.returnsPercent,
            eligible_80ccd1: calcs.eligible80CCD1,
            eligible_80ccd1b: calcs.eligible80CCD1B,
            notes,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');

      setToast({ type: 'success', message: 'NPS account saved successfully!' });
      setTimeout(() => router.push('/portfolio/nps'), 1200);
    } catch (err) {
      setToast({ type: 'error', message: err instanceof Error ? err.message : 'Something went wrong' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AssetPageShell
      title="NPS"
      description="Add National Pension System details"
      icon={Shield}
      iconColor="#dc2626"
      iconBg="#fef2f2"
    >
      {toast && <ToastBanner toast={toast} onClose={() => setToast(null)} />}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Family member selector */}
        {members.length > 1 && (
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Family Member</Label>
            <Select value={member} onValueChange={setMember}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {members.map(m => <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Account Details */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>PRAN *</Label>
            <Input
              placeholder="e.g. 110012345678"
              required
              value={pran}
              onChange={e => setPran(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>NPS Tier *</Label>
            <Select value={tier} onValueChange={setTier}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="I" className="text-xs">Tier I</SelectItem>
                <SelectItem value="II" className="text-xs">Tier II</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Fund Manager *</Label>
            <Select value={fundManager} onValueChange={setFundManager}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select fund manager" /></SelectTrigger>
              <SelectContent>
                {FUND_MANAGERS.map(fm => <SelectItem key={fm} value={fm} className="text-xs">{fm}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Total Contribution (&#8377;) *</Label>
            <Input
              type="number"
              required
              min="0"
              step="0.01"
              placeholder="0.00"
              value={totalContribution}
              onChange={e => setTotalContribution(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Current Value (&#8377;) *</Label>
            <Input
              type="number"
              required
              min="0"
              step="0.01"
              placeholder="0.00"
              value={currentValue}
              onChange={e => setCurrentValue(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Employer Contribution (&#8377;, optional)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={employerContribution}
              onChange={e => setEmployerContribution(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Notes (optional)</Label>
          <Input
            placeholder="Add any notes..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="h-9 text-sm"
          />
        </div>

        {/* Auto-calculated summary */}
        {contribution > 0 && value > 0 && (
          <div className="rounded-xl p-4 space-y-2"
            style={{ backgroundColor: 'var(--wv-surface-2)', border: '1px solid var(--wv-border)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Calculator className="w-4 h-4" style={{ color: '#C9A84C' }} />
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-secondary)' }}>
                Auto-calculated Summary
              </span>
            </div>
            <div className="grid grid-cols-2 gap-y-2 gap-x-6 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Returns</span>
                <span className="font-bold" style={{ color: calcs.returns >= 0 ? '#059669' : '#DC2626' }}>
                  {formatCurrency(calcs.returns)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Returns %</span>
                <span className="font-bold" style={{ color: calcs.returnsPercent >= 0 ? '#059669' : '#DC2626' }}>
                  {calcs.returnsPercent >= 0 ? '+' : ''}{calcs.returnsPercent.toFixed(2)}%
                </span>
              </div>
              {empContrib > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Self Contribution</span>
                  <span className="font-medium" style={{ color: 'var(--wv-text)' }}>{formatCurrency(calcs.selfContribution)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Sec 80CCD(1)</span>
                <span className="font-medium" style={{ color: '#C9A84C' }}>
                  {formatCurrency(calcs.eligible80CCD1)}
                  <span className="text-[10px] ml-1 text-gray-400">(max &#8377;1.5L)</span>
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Sec 80CCD(1B)</span>
                <span className="font-medium" style={{ color: '#C9A84C' }}>
                  {formatCurrency(calcs.eligible80CCD1B)}
                  <span className="text-[10px] ml-1 text-gray-400">(extra &#8377;50K)</span>
                </span>
              </div>
            </div>
          </div>
        )}

        <Button
          type="submit"
          disabled={saving}
          className="w-full text-white"
          style={{ backgroundColor: '#1B2A4A' }}
        >
          {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save NPS Account'}
        </Button>
      </form>
    </AssetPageShell>
  );
}
