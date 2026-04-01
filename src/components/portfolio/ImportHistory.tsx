'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ChevronDown, ChevronUp, Trash2, Loader2, Check, AlertCircle,
  FileText, X, Minus,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ImportBatch {
  id: string;
  source_filename: string;
  source_type: string;
  funds_count: number;
  total_invested: number;
  imported_at: string;
  status: 'active' | 'undone';
  undone_at: string | null;
  user_id: string;
}

interface BatchHolding {
  id: string;
  name: string;
  quantity: number;
  avg_buy_price: number;
  symbol: string;
  metadata: Record<string, unknown>;
}

interface Toast { type: 'success' | 'error'; message: string }

interface ImportHistoryProps {
  memberNames: Record<string, string>;
  onHoldingsChanged: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  cams_csv:      'CAMS CAS',
  kfintech_csv:  'KFintech CAS',
  template_csv:  'Template CSV',
  manual_csv:    'CSV Import',
  manual_entry:  'Manual',
};

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' · '
    + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ImportHistory({ memberNames, onHoldingsChanged }: ImportHistoryProps) {
  const supabase = createClient();

  const [batches,      setBatches]      = useState<ImportBatch[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [expandedId,   setExpandedId]   = useState<string | null>(null);
  const [batchHoldings,setBatchHoldings]= useState<Record<string, BatchHolding[]>>({});
  const [loadingBatch, setLoadingBatch] = useState<string | null>(null);

  // Confirm modals
  const [undoConfirm,   setUndoConfirm]   = useState<ImportBatch | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<{ holdingId: string; name: string; batchId: string } | null>(null);

  // Undo/remove in-progress
  const [undoing,   setUndoing]   = useState(false);
  const [removing,  setRemoving]  = useState(false);

  // Toast
  const [toast, setToast] = useState<Toast | null>(null);

  // ── Load batches ──────────────────────────────────────────────────────────
  const loadBatches = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('import_batches')
      .select('*')
      .order('imported_at', { ascending: false });
    setBatches((data ?? []) as ImportBatch[]);
    setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadBatches(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-hide toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Expand batch → load holdings ──────────────────────────────────────────
  async function toggleExpand(batchId: string) {
    if (expandedId === batchId) { setExpandedId(null); return; }
    setExpandedId(batchId);
    if (batchHoldings[batchId]) return; // already loaded

    setLoadingBatch(batchId);
    const { data } = await supabase
      .from('holdings')
      .select('id, name, quantity, avg_buy_price, symbol, metadata')
      .eq('import_batch_id', batchId)
      .order('created_at');
    setBatchHoldings(prev => ({ ...prev, [batchId]: (data ?? []) as BatchHolding[] }));
    setLoadingBatch(null);
  }

  // ── Undo entire batch ─────────────────────────────────────────────────────
  async function handleUndo() {
    if (!undoConfirm) return;
    setUndoing(true);

    const batchId = undoConfirm.id;
    const holdings = batchHoldings[batchId];

    // If holdings not loaded, load them first to get IDs
    let toDelete: string[] = holdings?.map(h => h.id) ?? [];
    if (!holdings) {
      const { data } = await supabase
        .from('holdings')
        .select('id')
        .eq('import_batch_id', batchId);
      toDelete = (data ?? []).map(h => h.id);
    }

    // Transactions CASCADE on holdings delete, so just delete holdings
    const { error: hErr } = await supabase
      .from('holdings')
      .delete()
      .eq('import_batch_id', batchId);

    if (hErr) {
      setToast({ type: 'error', message: hErr.message });
      setUndoing(false);
      return;
    }

    // Mark batch as undone
    await supabase
      .from('import_batches')
      .update({ status: 'undone', undone_at: new Date().toISOString() })
      .eq('id', batchId);

    // Update local state
    setBatches(prev => prev.map(b =>
      b.id === batchId ? { ...b, status: 'undone', undone_at: new Date().toISOString() } : b
    ));
    setBatchHoldings(prev => ({ ...prev, [batchId]: [] }));
    setUndoConfirm(null);
    setUndoing(false);
    setToast({ type: 'success', message: `Import undone. ${toDelete.length} fund${toDelete.length !== 1 ? 's' : ''} removed.` });
    onHoldingsChanged();
  }

  // ── Remove individual holding ─────────────────────────────────────────────
  async function handleRemoveHolding() {
    if (!removeConfirm) return;
    setRemoving(true);

    const { holdingId, batchId } = removeConfirm;

    // Transactions CASCADE
    const { error } = await supabase
      .from('holdings')
      .delete()
      .eq('id', holdingId);

    if (error) {
      setToast({ type: 'error', message: error.message });
      setRemoving(false);
      return;
    }

    // Update batch funds_count in DB
    const newCount = (batchHoldings[batchId]?.length ?? 1) - 1;
    await supabase
      .from('import_batches')
      .update({ funds_count: newCount })
      .eq('id', batchId);

    // Update local state
    setBatchHoldings(prev => ({
      ...prev,
      [batchId]: (prev[batchId] ?? []).filter(h => h.id !== holdingId),
    }));
    setBatches(prev => prev.map(b =>
      b.id === batchId ? { ...b, funds_count: Math.max(0, b.funds_count - 1) } : b
    ));
    setRemoveConfirm(null);
    setRemoving(false);
    setToast({ type: 'success', message: `${removeConfirm.name.split(' - ')[0]} removed.` });
    onHoldingsChanged();
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6">
        <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#C9A84C' }} />
        <span className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>Loading import history…</span>
      </div>
    );
  }

  if (batches.length === 0) {
    return (
      <div className="text-center py-10">
        <FileText className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--wv-border)' }} />
        <p className="text-sm" style={{ color: 'var(--wv-text-muted)' }}>No bulk imports yet</p>
        <p className="text-xs mt-1" style={{ color: '#D1D5DB' }}>CAS statement imports will appear here</p>
      </div>
    );
  }

  return (
    <>
      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium"
          style={{
            backgroundColor: toast.type === 'success' ? 'rgba(5,150,105,0.95)' : 'rgba(220,38,38,0.95)',
            color: 'white',
            backdropFilter: 'blur(4px)',
          }}
        >
          {toast.type === 'success'
            ? <Check className="w-4 h-4 flex-shrink-0" />
            : <AlertCircle className="w-4 h-4 flex-shrink-0" />
          }
          {toast.message}
          <button onClick={() => setToast(null)}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Batch list */}
      <div className="space-y-2">
        {batches.map((batch) => {
          const isExpanded = expandedId === batch.id;
          const isUndone   = batch.status === 'undone';
          const memberName = memberNames[batch.user_id] ?? 'Unknown';
          const holdings   = batchHoldings[batch.id];

          return (
            <div
              key={batch.id}
              className="rounded-xl border overflow-hidden"
              style={{
                borderColor: 'var(--wv-border)',
                opacity: isUndone ? 0.65 : 1,
              }}
            >
              {/* Batch header row */}
              <div
                className="flex items-center gap-3 px-4 py-3"
                style={{ backgroundColor: isUndone ? '#F7F5F0' : 'white' }}
              >
                {/* File icon */}
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: isUndone ? 'var(--wv-border)' : 'rgba(201,168,76,0.1)' }}
                >
                  <FileText className="w-4 h-4" style={{ color: isUndone ? '#D1D5DB' : '#C9A84C' }} />
                </div>

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p
                      className="text-xs font-semibold"
                      style={{
                        color: 'var(--wv-text)',
                        textDecoration: isUndone ? 'line-through' : 'none',
                        wordBreak: 'break-all',
                      }}
                    >
                      {batch.source_filename}
                    </p>
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor: isUndone ? 'var(--wv-border)' : 'rgba(5,150,105,0.1)',
                        color:           isUndone ? '#9CA3AF' : '#059669',
                      }}
                    >
                      {isUndone ? 'Undone' : 'Active'}
                    </span>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: 'var(--wv-surface-2)', color: 'var(--wv-text-muted)' }}
                    >
                      {SOURCE_LABELS[batch.source_type] ?? batch.source_type}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                    <span>{fmtDateTime(batch.imported_at)}</span>
                    <span>·</span>
                    <span>{batch.funds_count} fund{batch.funds_count !== 1 ? 's' : ''}</span>
                    <span>·</span>
                    <span>{formatLargeINR(batch.total_invested)}</span>
                    <span>·</span>
                    <span>{memberName}</span>
                    {isUndone && batch.undone_at && (
                      <>
                        <span>·</span>
                        <span>Undone {fmtDateTime(batch.undone_at)}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {!isUndone && (
                    <button
                      onClick={() => { setUndoConfirm(batch); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors hover:bg-red-50"
                      style={{ borderColor: '#DC2626', color: '#DC2626' }}
                    >
                      <Trash2 className="w-3 h-3" />
                      Undo Import
                    </button>
                  )}
                  <button
                    onClick={() => toggleExpand(batch.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors"
                    style={{ borderColor: 'var(--wv-border)', color: 'var(--wv-text-secondary)', backgroundColor: 'var(--wv-surface-2)' }}
                  >
                    {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {isExpanded ? 'Hide' : 'View Details'}
                  </button>
                </div>
              </div>

              {/* Expanded: holdings list */}
              {isExpanded && (
                <div style={{ borderTop: '1px solid #F0EDE6', backgroundColor: '#FAFAF8' }}>
                  {loadingBatch === batch.id ? (
                    <div className="flex items-center gap-2 px-4 py-3">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--wv-text-muted)' }} />
                      <span className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>Loading funds…</span>
                    </div>
                  ) : !holdings || holdings.length === 0 ? (
                    <p className="px-4 py-3 text-xs" style={{ color: 'var(--wv-text-muted)' }}>
                      {isUndone ? 'All funds from this import have been removed.' : 'No holdings found for this import.'}
                    </p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--wv-border)' }}>
                          {['Fund', 'Units', 'Avg NAV', 'Invested', ''].map(h => (
                            <th key={h} className="text-left px-4 py-2 font-medium" style={{ color: 'var(--wv-text-muted)' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {holdings.map(h => {
                          const invested = Number(h.quantity) * Number(h.avg_buy_price);
                          return (
                            <tr key={h.id} style={{ borderBottom: '1px solid #F7F5F0' }}>
                              <td className="px-4 py-2.5">
                                <p className="font-medium" style={{ color: 'var(--wv-text)', whiteSpace: 'normal', wordBreak: 'break-word' }}>{h.name}</p>
                                {h.metadata?.folio ? (
                                  <p className="text-[10px] mt-0.5" style={{ color: '#D1D5DB' }}>
                                    Folio: {String(h.metadata.folio)}
                                  </p>
                                ) : null}
                              </td>
                              <td className="px-4 py-2.5 font-mono" style={{ color: 'var(--wv-text-secondary)' }}>
                                {Number(h.quantity).toFixed(3)}
                              </td>
                              <td className="px-4 py-2.5" style={{ color: 'var(--wv-text-secondary)' }}>
                                ₹{Number(h.avg_buy_price).toFixed(4)}
                              </td>
                              <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--wv-text)' }}>
                                {formatLargeINR(invested)}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                {!isUndone && (
                                  <button
                                    onClick={() => setRemoveConfirm({ holdingId: h.id, name: h.name, batchId: batch.id })}
                                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] border ml-auto transition-colors hover:bg-red-50"
                                    style={{ borderColor: '#FCA5A5', color: '#DC2626' }}
                                  >
                                    <Minus className="w-2.5 h-2.5" />
                                    Remove
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Undo confirmation modal ── */}
      {undoConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
          onClick={() => setUndoConfirm(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6 shadow-xl"
            style={{ backgroundColor: 'var(--wv-surface)' }}
            onClick={e => e.stopPropagation()}
          >
            <div
              className="w-11 h-11 rounded-full flex items-center justify-center mb-4"
              style={{ backgroundColor: 'rgba(220,38,38,0.1)' }}
            >
              <Trash2 className="w-5 h-5" style={{ color: '#DC2626' }} />
            </div>
            <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--wv-text)' }}>
              Undo this import?
            </h3>
            <p className="text-xs mb-4 leading-relaxed" style={{ color: 'var(--wv-text-secondary)' }}>
              This will remove all <strong>{undoConfirm.funds_count} fund{undoConfirm.funds_count !== 1 ? 's' : ''}</strong> and
              their transactions imported from{' '}
              <strong>{undoConfirm.source_filename}</strong> on{' '}
              {new Date(undoConfirm.imported_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}.
              {' '}This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                className="flex-1 h-9 rounded-lg text-xs font-medium border transition-colors"
                style={{ borderColor: 'var(--wv-border)', color: 'var(--wv-text-secondary)' }}
                onClick={() => setUndoConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="flex-1 h-9 rounded-lg text-xs font-semibold text-white flex items-center justify-center gap-2 transition-colors"
                style={{ backgroundColor: '#DC2626' }}
                onClick={handleUndo}
                disabled={undoing}
              >
                {undoing
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <><Trash2 className="w-3 h-3" /> Yes, Undo Import</>
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Remove holding confirmation modal ── */}
      {removeConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
          onClick={() => setRemoveConfirm(null)}
        >
          <div
            className="w-full max-w-xs rounded-2xl p-5 shadow-xl"
            style={{ backgroundColor: 'var(--wv-surface)' }}
            onClick={e => e.stopPropagation()}
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center mb-3"
              style={{ backgroundColor: 'rgba(220,38,38,0.1)' }}
            >
              <Minus className="w-5 h-5" style={{ color: '#DC2626' }} />
            </div>
            <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--wv-text)' }}>Remove this fund?</h3>
            <p className="text-xs mb-1" style={{ color: 'var(--wv-text-secondary)' }}>
              <strong>{removeConfirm.name.split(' - ')[0]}</strong>
            </p>
            <p className="text-xs mb-4" style={{ color: 'var(--wv-text-muted)' }}>
              The holding and all its transactions will be deleted permanently.
            </p>
            <div className="flex gap-2">
              <button
                className="flex-1 h-9 rounded-lg text-xs font-medium border transition-colors"
                style={{ borderColor: 'var(--wv-border)', color: 'var(--wv-text-secondary)' }}
                onClick={() => setRemoveConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="flex-1 h-9 rounded-lg text-xs font-semibold text-white flex items-center justify-center gap-2"
                style={{ backgroundColor: '#DC2626' }}
                onClick={handleRemoveHolding}
                disabled={removing}
              >
                {removing
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : 'Remove'
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
