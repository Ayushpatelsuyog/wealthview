'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AssetPageShell } from '@/components/forms/AssetPageShell';
import { Wallet, Check, AlertCircle, X, Loader2, ShieldCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

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

const ACCOUNT_TYPES = ['Savings', 'Current', 'Salary', 'NRE', 'NRO', 'Joint'];
const DEFAULT_RATE = '3.5';

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
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountType, setAccountType] = useState('Savings');
  const [currentBalance, setCurrentBalance] = useState('');
  const [interestRate, setInterestRate] = useState(DEFAULT_RATE);
  const [ifscCode, setIfscCode] = useState('');
  const [branch, setBranch] = useState('');
  const [isEmergencyFund, setIsEmergencyFund] = useState(false);
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

  // ── Masked account display ────────────────────────────────────────────────

  const maskedAccount = accountNumber.length > 4
    ? '****' + accountNumber.slice(-4)
    : accountNumber;

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!bankName || !currentBalance) return;

    setSaving(true);
    setToast(null);

    try {
      const res = await fetch('/api/manual-assets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_type: 'savings_account',
          name: `${bankName} ${accountType}`,
          current_value: parseFloat(currentBalance),
          memberId: member,
          metadata: {
            bank: bankName,
            account_number: accountNumber,
            account_type: accountType,
            rate: parseFloat(interestRate) || 3.5,
            ifsc: ifscCode,
            branch,
            is_emergency_fund: isEmergencyFund,
            notes,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');

      setToast({ type: 'success', message: 'Savings account saved successfully!' });
      setTimeout(() => router.push('/portfolio/savings-accounts'), 1200);
    } catch (err) {
      setToast({ type: 'error', message: err instanceof Error ? err.message : 'Something went wrong' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AssetPageShell
      title="Savings Accounts"
      description="Add savings account details"
      icon={Wallet}
      iconColor="#0891b2"
      iconBg="#ecfeff"
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

        {/* Account details */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Bank Name *</Label>
            <Input
              required
              placeholder="e.g. SBI, HDFC, ICICI"
              value={bankName}
              onChange={e => setBankName(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Account Number</Label>
            <Input
              placeholder="e.g. 1234567890"
              value={accountNumber}
              onChange={e => setAccountNumber(e.target.value)}
              className="h-9 text-sm"
            />
            {accountNumber.length > 4 && (
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--wv-text-muted)' }}>
                Display: {maskedAccount}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Account Type</Label>
            <Select value={accountType} onValueChange={setAccountType}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACCOUNT_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Current Balance (&#8377;) *</Label>
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
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Interest Rate (% p.a.)</Label>
            <Input
              type="number"
              min="0"
              max="15"
              step="0.01"
              placeholder="3.5"
              value={interestRate}
              onChange={e => setInterestRate(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>IFSC Code</Label>
            <Input
              placeholder="e.g. SBIN0001234"
              value={ifscCode}
              onChange={e => setIfscCode(e.target.value.toUpperCase())}
              className="h-9 text-sm uppercase"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Branch</Label>
          <Input
            placeholder="e.g. Koramangala, Bangalore"
            value={branch}
            onChange={e => setBranch(e.target.value)}
            className="h-9 text-sm"
          />
        </div>

        {/* Emergency fund toggle */}
        <label className="flex items-center gap-3 py-2 px-3 rounded-lg cursor-pointer select-none"
          style={{ backgroundColor: isEmergencyFund ? 'rgba(5,150,105,0.06)' : '#F7F5F0',
                   border: `1px solid ${isEmergencyFund ? 'rgba(5,150,105,0.2)' : 'var(--wv-border)'}` }}>
          <input
            type="checkbox"
            checked={isEmergencyFund}
            onChange={e => setIsEmergencyFund(e.target.checked)}
            className="w-4 h-4 rounded accent-emerald-600"
          />
          <ShieldCheck className="w-4 h-4" style={{ color: isEmergencyFund ? '#059669' : '#9CA3AF' }} />
          <div>
            <span className="text-sm font-medium" style={{ color: isEmergencyFund ? '#059669' : '#374151' }}>
              Emergency Fund
            </span>
            <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
              Mark this account as part of your emergency corpus
            </p>
          </div>
        </label>

        <div className="space-y-1.5">
          <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Notes (optional)</Label>
          <Input
            placeholder="Add any notes..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="h-9 text-sm"
          />
        </div>

        <Button
          type="submit"
          disabled={saving}
          className="w-full text-white"
          style={{ backgroundColor: '#1B2A4A' }}
        >
          {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save Savings Account'}
        </Button>
      </form>
    </AssetPageShell>
  );
}
