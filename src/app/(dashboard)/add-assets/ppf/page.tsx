'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AssetPageShell } from '@/components/forms/AssetPageShell';
import { Leaf, Check, AlertCircle, X, Loader2, Calculator } from 'lucide-react';
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

const PPF_INTEREST_RATE = 7.1;
const PPF_TENURE_YEARS = 15;
const SECTION_80C_LIMIT = 150000;

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
  const [accountNumber, setAccountNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [openingDate, setOpeningDate] = useState('');
  const [currentBalance, setCurrentBalance] = useState('');
  const [fyContribution, setFyContribution] = useState('');
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

  const maturityDate = openingDate
    ? (() => {
        const d = new Date(openingDate);
        d.setFullYear(d.getFullYear() + PPF_TENURE_YEARS);
        return d;
      })()
    : null;

  const yearsRemaining = maturityDate
    ? Math.max(0, parseFloat(((maturityDate.getTime() - Date.now()) / (365.25 * 24 * 60 * 60 * 1000)).toFixed(1)))
    : null;

  const fyAmount = parseFloat(fyContribution) || 0;
  const eligible80C = Math.min(fyAmount, SECTION_80C_LIMIT);

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentBalance || !openingDate) return;

    setSaving(true);
    setToast(null);

    try {
      const matDate = maturityDate ? maturityDate.toISOString().slice(0, 10) : '';

      const res = await fetch('/api/manual-assets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_type: 'ppf',
          name: `PPF - ${bankName || 'Account'}`,
          current_value: parseFloat(currentBalance),
          memberId: member,
          metadata: {
            account_number: accountNumber,
            bank: bankName,
            opening_date: openingDate,
            current_balance: parseFloat(currentBalance),
            fy_contribution: fyAmount,
            interest_rate: PPF_INTEREST_RATE,
            maturity_date: matDate,
            notes,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');

      setToast({ type: 'success', message: 'PPF account saved successfully!' });
      setTimeout(() => router.push('/portfolio/ppf'), 1200);
    } catch (err) {
      setToast({ type: 'error', message: err instanceof Error ? err.message : 'Something went wrong' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AssetPageShell
      title="PPF"
      description="Add Public Provident Fund details"
      icon={Leaf}
      iconColor="#059669"
      iconBg="#ecfdf5"
    >
      {toast && <ToastBanner toast={toast} onClose={() => setToast(null)} />}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Family member selector */}
        {members.length > 1 && (
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>Family Member</Label>
            <Select value={member} onValueChange={setMember}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {members.map(m => <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Account details */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>PPF Account Number</Label>
            <Input
              placeholder="e.g. 1234567890"
              value={accountNumber}
              onChange={e => setAccountNumber(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>Bank / Post Office Name</Label>
            <Input
              placeholder="e.g. SBI, Post Office"
              value={bankName}
              onChange={e => setBankName(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>Account Opening Date *</Label>
            <Input
              type="date"
              required
              value={openingDate}
              onChange={e => setOpeningDate(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>Current Balance (&#8377;) *</Label>
            <Input
              type="number"
              required
              min="0"
              step="0.01"
              placeholder="0.00"
              value={currentBalance}
              onChange={e => setCurrentBalance(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs" style={{ color: '#6B7280' }}>Current FY Contribution (&#8377;)</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="Deposit in current financial year"
            value={fyContribution}
            onChange={e => setFyContribution(e.target.value)}
            className="h-9 text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs" style={{ color: '#6B7280' }}>Notes (optional)</Label>
          <Input
            placeholder="Add any notes..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="h-9 text-sm"
          />
        </div>

        {/* Auto-calculated summary */}
        {openingDate && (
          <div className="rounded-xl p-4 space-y-2"
            style={{ backgroundColor: '#F7F5F0', border: '1px solid #E8E5DD' }}>
            <div className="flex items-center gap-2 mb-2">
              <Calculator className="w-4 h-4" style={{ color: '#C9A84C' }} />
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#6B7280' }}>
                Auto-calculated Summary
              </span>
            </div>
            <div className="grid grid-cols-2 gap-y-2 gap-x-6 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Interest Rate</span>
                <span className="font-medium" style={{ color: '#1B2A4A' }}>{PPF_INTEREST_RATE}% p.a.</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Maturity Date</span>
                <span className="font-medium" style={{ color: '#1B2A4A' }}>
                  {maturityDate ? maturityDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '--'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Years Remaining</span>
                <span className="font-medium" style={{ color: yearsRemaining && yearsRemaining > 0 ? '#059669' : '#DC2626' }}>
                  {yearsRemaining !== null ? (yearsRemaining > 0 ? `${yearsRemaining} yrs` : 'Matured') : '--'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">80C Eligible</span>
                <span className="font-medium" style={{ color: '#C9A84C' }}>
                  {fyAmount > 0 ? formatCurrency(eligible80C) : '--'}
                  {fyAmount > SECTION_80C_LIMIT && (
                    <span className="text-[10px] ml-1 text-gray-400">(max &#8377;1.5L)</span>
                  )}
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
          {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save PPF Account'}
        </Button>
      </form>
    </AssetPageShell>
  );
}
