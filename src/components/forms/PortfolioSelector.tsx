'use client';

import { useState, useEffect } from 'react';
import { Plus, X, Loader2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DbPortfolio {
  id: string;
  name: string;
  type: string;
  logo_color?: string;
}

interface PortfolioSelectorProps {
  familyId: string | null;
  memberId: string;
  selectedPortfolioName: string;
  onChange: (name: string) => void;
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

function portfolioLetter(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PortfolioSelector({ familyId, memberId, selectedPortfolioName, onChange, error }: PortfolioSelectorProps) {
  const supabase = createClient();

  const [portfolios, setPortfolios] = useState<DbPortfolio[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [hoveredId,  setHoveredId]  = useState<string | null>(null);

  // Add modal
  const [showAdd,  setShowAdd]  = useState(false);
  const [addName,  setAddName]  = useState('');
  const [addColor, setAddColor] = useState('#1B2A4A');
  const [addSaving, setAddSaving] = useState(false);
  const [addError,  setAddError]  = useState<string | null>(null);

  // Edit modal
  const [editTarget, setEditTarget] = useState<DbPortfolio | null>(null);
  const [editName,   setEditName]   = useState('');
  const [editColor,  setEditColor]  = useState('#1B2A4A');
  const [editSaving, setEditSaving] = useState(false);
  const [editError,  setEditError]  = useState<string | null>(null);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<DbPortfolio | null>(null);
  const [deleteError,  setDeleteError]  = useState<string | null>(null);
  const [deleting,     setDeleting]     = useState(false);

  // ── Load portfolios ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!familyId) return;
    setLoading(true);
    let query = supabase
      .from('portfolios')
      .select('id, name, type, logo_color')
      .eq('family_id', familyId);
    if (memberId) query = query.eq('user_id', memberId);
    query
      .order('created_at')
      .then(({ data }) => {
        setPortfolios(data ?? []);
        setLoading(false);
      });
  }, [familyId, memberId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Add portfolio ─────────────────────────────────────────────────────────
  async function handleAdd() {
    if (!addName.trim()) { setAddError('Portfolio name is required'); return; }
    if (!familyId) { setAddError('Set up your family first'); return; }
    setAddSaving(true);
    setAddError(null);

    const { data, error: err } = await supabase
      .from('portfolios')
      .insert({
        user_id:   memberId,
        family_id: familyId,
        name:      addName.trim(),
        type:      'personal',
        logo_color: addColor,
      })
      .select('id, name, type, logo_color')
      .single();

    setAddSaving(false);
    if (err || !data) {
      setAddError(err?.message ?? 'Failed to save portfolio');
      return;
    }
    setPortfolios(prev => [...prev, data]);
    onChange(data.name);
    setShowAdd(false);
    setAddName('');
    setAddColor('#1B2A4A');
  }

  // ── Edit portfolio ──────────────────────────────────────────────────────
  async function handleEdit() {
    if (!editTarget || !editName.trim()) { setEditError('Portfolio name is required'); return; }
    setEditSaving(true);
    setEditError(null);

    const oldName = editTarget.name;
    const { error: err } = await supabase
      .from('portfolios')
      .update({ name: editName.trim(), logo_color: editColor })
      .eq('id', editTarget.id);

    setEditSaving(false);
    if (err) { setEditError(err.message); return; }

    setPortfolios(prev => prev.map(p =>
      p.id === editTarget.id ? { ...p, name: editName.trim(), logo_color: editColor } : p
    ));
    if (selectedPortfolioName === oldName) onChange(editName.trim());
    setEditTarget(null);
  }

  // ── Delete portfolio ──────────────────────────────────────────────────────
  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);

    const { count } = await supabase
      .from('holdings')
      .select('*', { count: 'exact', head: true })
      .eq('portfolio_id', deleteTarget.id)
      .gt('quantity', 0);

    if (count && count > 0) {
      setDeleteError(`Portfolio has ${count} active holding${count > 1 ? 's' : ''}. Remove or reassign holdings first.`);
      setDeleting(false);
      return;
    }

    const { error: err } = await supabase
      .from('portfolios')
      .delete()
      .eq('id', deleteTarget.id);

    setDeleting(false);
    if (err) { setDeleteError(err.message); return; }

    setPortfolios(prev => prev.filter(p => p.id !== deleteTarget.id));
    if (selectedPortfolioName === deleteTarget.name) onChange('');
    setDeleteTarget(null);
  }

  // ── Color picker (shared between add and edit) ─────────────────────────
  function ColorPicker({ value, onSelect }: { value: string; onSelect: (hex: string) => void }) {
    return (
      <div className="flex gap-2 flex-wrap">
        {PRESET_COLORS.map(c => (
          <button
            key={c.hex}
            type="button"
            onClick={() => onSelect(c.hex)}
            className="w-7 h-7 rounded-full transition-transform"
            style={{
              backgroundColor: c.hex,
              outline: value === c.hex ? `2px solid ${c.hex}` : 'none',
              outlineOffset: '2px',
              transform: value === c.hex ? 'scale(1.15)' : 'scale(1)',
            }}
            title={c.label}
          />
        ))}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {error && <p className="text-[10px] mb-1.5" style={{ color: '#DC2626' }}>{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 py-3">
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--wv-text-muted)' }} />
          <span className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>Loading portfolios…</span>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {portfolios.map((p) => {
            const isSelected = selectedPortfolioName === p.name;
            const isHovered  = hoveredId === p.id;
            const color = p.logo_color || '#1B2A4A';
            return (
              <div
                key={p.id}
                className="relative"
                onMouseEnter={() => setHoveredId(p.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <button
                  type="button"
                  onClick={() => onChange(p.name)}
                  className="w-full flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all"
                  style={{
                    borderColor:     isSelected ? '#C9A84C' : 'var(--wv-border)',
                    backgroundColor: isSelected ? 'rgba(201,168,76,0.08)' : 'var(--wv-surface)',
                    boxShadow:       isSelected ? '0 0 0 1px #C9A84C' : 'none',
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                    style={{ backgroundColor: color }}
                  >
                    {portfolioLetter(p.name)}
                  </div>
                  <span className="text-[10px] font-medium text-center leading-tight" style={{ color: 'var(--wv-text-secondary)' }}>
                    {p.name}
                  </span>
                </button>

                {/* Edit & Delete — shown on hover */}
                {isHovered && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditTarget(p);
                        setEditName(p.name);
                        setEditColor(p.logo_color || '#1B2A4A');
                        setEditError(null);
                      }}
                      className="absolute top-1 left-1 w-4 h-4 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: 'rgba(27,42,74,0.12)', color: '#1B2A4A' }}
                      title={`Edit ${p.name}`}
                    >
                      <Pencil className="w-2 h-2" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(p);
                        setDeleteError(null);
                      }}
                      className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: 'rgba(220,38,38,0.12)', color: '#DC2626' }}
                      title={`Remove ${p.name}`}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </>
                )}
              </div>
            );
          })}

          {/* Add Portfolio card */}
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
              Add Portfolio
            </span>
          </button>
        </div>
      )}

      {/* ── Add Portfolio Modal ── */}
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
            <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--wv-text)' }}>Add Portfolio</h3>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Portfolio Name *</Label>
                <Input
                  value={addName}
                  onChange={e => setAddName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAdd()}
                  placeholder="e.g. Long-term Growth, Retirement"
                  className="h-9 text-xs"
                  style={addError && !addName ? { borderColor: '#DC2626' } : {}}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Color</Label>
                <ColorPicker value={addColor} onSelect={setAddColor} />
              </div>

              {/* Preview */}
              <div className="flex items-center gap-3 p-3 rounded-xl" style={{ backgroundColor: 'var(--wv-surface-2)' }}>
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold"
                  style={{ backgroundColor: addColor }}
                >
                  {portfolioLetter(addName || 'P')}
                </div>
                <span className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>
                  {addName || 'Portfolio Name'}
                </span>
              </div>

              {addError && <p className="text-[11px]" style={{ color: '#DC2626' }}>{addError}</p>}
            </div>

            <div className="flex gap-2 mt-5">
              <Button variant="outline" className="flex-1 h-9 text-xs" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
              <Button
                className="flex-1 h-9 text-xs text-white"
                style={{ backgroundColor: '#1B2A4A' }}
                onClick={handleAdd}
                disabled={addSaving}
              >
                {addSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save Portfolio'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Portfolio Modal ── */}
      {editTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
          onClick={() => setEditTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6 shadow-xl"
            style={{ backgroundColor: 'var(--wv-surface)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--wv-text)' }}>Edit Portfolio</h3>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Portfolio Name *</Label>
                <Input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleEdit()}
                  placeholder="e.g. Long-term Growth"
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Color</Label>
                <ColorPicker value={editColor} onSelect={setEditColor} />
              </div>

              {/* Preview */}
              <div className="flex items-center gap-3 p-3 rounded-xl" style={{ backgroundColor: 'var(--wv-surface-2)' }}>
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold"
                  style={{ backgroundColor: editColor }}
                >
                  {portfolioLetter(editName || 'P')}
                </div>
                <span className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>
                  {editName || 'Portfolio Name'}
                </span>
              </div>

              {editError && <p className="text-[11px]" style={{ color: '#DC2626' }}>{editError}</p>}
            </div>

            <div className="flex gap-2 mt-5">
              <Button variant="outline" className="flex-1 h-9 text-xs" onClick={() => setEditTarget(null)}>
                Cancel
              </Button>
              <Button
                className="flex-1 h-9 text-xs text-white"
                style={{ backgroundColor: '#1B2A4A' }}
                onClick={handleEdit}
                disabled={editSaving}
              >
                {editSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save Changes'}
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
              This cannot be undone. The portfolio will be removed from your list.
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
