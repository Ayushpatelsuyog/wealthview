'use client';

import { useState, useEffect } from 'react';
import { Plus, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createClient } from '@/lib/supabase/client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DbBroker {
  id: string;
  name: string;
  platform_type: string;
  logo_color: string;
}

interface BrokerSelectorProps {
  familyId: string | null;
  memberId?: string;
  selectedBrokerId: string | null;
  onChange: (id: string) => void;
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  { label: 'Navy',   hex: '#1B2A4A' },
  { label: 'Teal',   hex: '#2E8B8B' },
  { label: 'Green',  hex: '#059669' },
  { label: 'Purple', hex: '#5C6BC0' },
  { label: 'Orange', hex: '#EA580C' },
  { label: 'Red',    hex: '#DC2626' },
  { label: 'Blue',   hex: '#3B82F6' },
  { label: 'Gold',   hex: '#C9A84C' },
];

const PLATFORM_OPTIONS = [
  { label: 'MF Platform',      value: 'mf_platform' },
  { label: 'Stock Broker',     value: 'stock_broker' },
  { label: 'Crypto Exchange',  value: 'crypto_exchange' },
  { label: 'Bank',             value: 'bank' },
  { label: 'Insurance',        value: 'insurance' },
  { label: 'Other',            value: 'other' },
];

function brokerLetter(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BrokerSelector({ familyId, memberId, selectedBrokerId, onChange, error }: BrokerSelectorProps) {
  const supabase = createClient();

  const [brokers,    setBrokers]    = useState<DbBroker[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [hoveredId,  setHoveredId]  = useState<string | null>(null);

  // Add modal
  const [showAdd,    setShowAdd]    = useState(false);
  const [addName,    setAddName]    = useState('');
  const [addPlatform,setAddPlatform]= useState('other');
  const [addColor,   setAddColor]   = useState('#1B2A4A');
  const [addSaving,  setAddSaving]  = useState(false);
  const [addError,   setAddError]   = useState<string | null>(null);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<DbBroker | null>(null);
  const [deleteError,  setDeleteError]  = useState<string | null>(null);
  const [deleting,     setDeleting]     = useState(false);

  // ── Load brokers ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!familyId) return;
    setLoading(true);
    let query = supabase
      .from('brokers')
      .select('id, name, platform_type, logo_color')
      .eq('family_id', familyId)
      .eq('is_active', true);
    if (memberId) query = query.eq('user_id', memberId);
    query
      .order('created_at')
      .then(({ data }) => {
        setBrokers(data ?? []);
        setLoading(false);
      });
  }, [familyId, memberId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Add broker ─────────────────────────────────────────────────────────────
  async function handleAdd() {
    if (!addName.trim()) { setAddError('Distributor name is required'); return; }
    if (!familyId) { setAddError('Set up your family first'); return; }
    setAddSaving(true);
    setAddError(null);

    const { data, error: err } = await supabase
      .from('brokers')
      .insert({
        family_id:     familyId,
        user_id:       memberId || null,
        name:          addName.trim(),
        platform_type: (['zerodha','groww','upstox','angel','icicidirect','hdfc_securities','motilal','kotak','paytm_money','coin'].includes(addPlatform) ? addPlatform : 'other') as string,
        logo_color:    addColor,
      })
      .select('id, name, platform_type, logo_color')
      .single();

    setAddSaving(false);
    if (err || !data) {
      setAddError(err?.message ?? 'Failed to save distributor');
      return;
    }
    setBrokers(prev => [...prev, data]);
    onChange(data.id);
    setShowAdd(false);
    setAddName('');
    setAddColor('#1B2A4A');
    setAddPlatform('other');
  }

  // ── Delete broker ──────────────────────────────────────────────────────────
  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);

    // Check for linked holdings
    const { count } = await supabase
      .from('holdings')
      .select('*', { count: 'exact', head: true })
      .eq('broker_id', deleteTarget.id);

    if (count && count > 0) {
      setDeleteError(`This distributor has ${count} active holding${count > 1 ? 's' : ''}. Remove or reassign holdings first.`);
      setDeleting(false);
      return;
    }

    const { error: err } = await supabase
      .from('brokers')
      .update({ is_active: false })
      .eq('id', deleteTarget.id);

    setDeleting(false);
    if (err) { setDeleteError(err.message); return; }

    setBrokers(prev => prev.filter(b => b.id !== deleteTarget.id));
    if (selectedBrokerId === deleteTarget.id) onChange('');
    setDeleteTarget(null);
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {error && <p className="text-[10px] mb-1.5" style={{ color: '#DC2626' }}>{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 py-3">
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--wv-text-muted)' }} />
          <span className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>Loading distributors…</span>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {brokers.map((b) => {
            const isSelected = selectedBrokerId === b.id;
            const isHovered  = hoveredId === b.id;
            return (
              <div
                key={b.id}
                className="relative"
                onMouseEnter={() => setHoveredId(b.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <button
                  type="button"
                  onClick={() => onChange(b.id)}
                  className="w-full flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all"
                  style={{
                    borderColor:     isSelected ? b.logo_color : 'var(--wv-border)',
                    backgroundColor: isSelected ? `${b.logo_color}12` : 'var(--wv-surface)',
                    boxShadow:       isSelected ? `0 0 0 1px ${b.logo_color}` : 'none',
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                    style={{ backgroundColor: b.logo_color }}
                  >
                    {brokerLetter(b.name)}
                  </div>
                  <span className="text-[10px] font-medium text-center leading-tight" style={{ color: 'var(--wv-text-secondary)' }}>
                    {b.name}
                  </span>
                </button>

                {/* Delete X — only shown on hover, only if NOT the selected broker */}
                {isHovered && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(b);
                      setDeleteError(null);
                    }}
                    className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: 'rgba(220,38,38,0.12)', color: '#DC2626' }}
                    title={`Remove ${b.name}`}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            );
          })}

          {/* Add Broker card */}
          <button
            type="button"
            onClick={() => { setShowAdd(true); setAddError(null); }}
            className="flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 border-dashed transition-all hover:border-gold"
            style={{ borderColor: 'var(--wv-border)' }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'var(--wv-surface-2)' }}
            >
              <Plus className="w-4 h-4" style={{ color: '#C9A84C' }} />
            </div>
            <span className="text-[10px] font-medium text-center leading-tight" style={{ color: '#C9A84C' }}>
              Add Distributor
            </span>
          </button>
        </div>
      )}

      {/* ── Add Broker Modal ── */}
      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
          onClick={() => setShowAdd(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6 shadow-xl"
            style={{ backgroundColor: 'var(--wv-surface)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--wv-text)' }}>Add Distributor / Platform</h3>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Distributor Name *</Label>
                <Input
                  value={addName}
                  onChange={e => setAddName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAdd()}
                  placeholder="e.g. Zerodha, Kuvera, Paytm Money"
                  className="h-9 text-xs"
                  style={addError && !addName ? { borderColor: '#DC2626' } : {}}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Platform Type</Label>
                <Select value={addPlatform} onValueChange={setAddPlatform}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLATFORM_OPTIONS.map(opt => (
                      <SelectItem key={opt.label} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Brand Color</Label>
                <div className="flex gap-2 flex-wrap">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setAddColor(c.hex)}
                      className="w-7 h-7 rounded-full transition-transform"
                      style={{
                        backgroundColor: c.hex,
                        outline: addColor === c.hex ? `2px solid ${c.hex}` : 'none',
                        outlineOffset: '2px',
                        transform: addColor === c.hex ? 'scale(1.15)' : 'scale(1)',
                      }}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div className="flex items-center gap-3 p-3 rounded-xl" style={{ backgroundColor: 'var(--wv-surface-2)' }}>
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold"
                  style={{ backgroundColor: addColor }}
                >
                  {brokerLetter(addName || 'B')}
                </div>
                <span className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>
                  {addName || 'Distributor Name'}
                </span>
              </div>

              {addError && <p className="text-[11px]" style={{ color: '#DC2626' }}>{addError}</p>}
            </div>

            <div className="flex gap-2 mt-5">
              <Button
                variant="outline"
                className="flex-1 h-9 text-xs"
                onClick={() => setShowAdd(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 h-9 text-xs text-white"
                style={{ backgroundColor: '#1B2A4A' }}
                onClick={handleAdd}
                disabled={addSaving}
              >
                {addSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save Distributor'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Modal ── */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="w-full max-w-xs rounded-2xl p-5 shadow-xl"
            style={{ backgroundColor: 'var(--wv-surface)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center mb-3"
              style={{ backgroundColor: 'rgba(220,38,38,0.1)' }}
            >
              <X className="w-5 h-5" style={{ color: '#DC2626' }} />
            </div>
            <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--wv-text)' }}>
              Remove {deleteTarget.name}?
            </h3>
            <p className="text-xs mb-4" style={{ color: 'var(--wv-text-secondary)' }}>
              This cannot be undone. The distributor will be removed from your list.
            </p>

            {deleteError && (
              <p className="text-[11px] mb-3 p-2.5 rounded-lg" style={{ backgroundColor: 'rgba(220,38,38,0.08)', color: '#DC2626' }}>
                {deleteError}
              </p>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 h-9 text-xs"
                onClick={() => { setDeleteTarget(null); setDeleteError(null); }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 h-9 text-xs text-white"
                style={{ backgroundColor: '#DC2626' }}
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Remove'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
