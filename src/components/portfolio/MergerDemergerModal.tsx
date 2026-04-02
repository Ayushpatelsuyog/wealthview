'use client';

import { useState } from 'react';
import { X, Loader2, ArrowRight, AlertCircle, Check, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { formatLargeINR } from '@/lib/utils/formatters';
import { holdingsCacheClearAll } from '@/lib/utils/holdings-cache';

// ─── Types ────────────────────────────────────────────────────────────────────

interface HoldingInfo {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  avgBuyPrice: number;
  assetType: string;
  currency?: string;
  exchange?: string;
}

interface Props {
  holding: HoldingInfo;
  mode: 'merger' | 'demerger';
  onClose: () => void;
  onComplete: () => void;
  /** 'indian_stock' | 'global_stock' */
  stockType?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MergerDemergerModal({ holding, mode, onClose, onComplete, stockType }: Props) {
  const isGlobal = stockType === 'global_stock' || holding.assetType === 'global_stock';
  const isMerger = mode === 'merger';

  // Common
  const [recordDate, setRecordDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Target/New company
  const [targetSymbol, setTargetSymbol] = useState('');
  const [targetName, setTargetName] = useState('');
  const [targetExchange, setTargetExchange] = useState(isGlobal ? 'NYSE' : 'NSE');

  // Merger
  const [sharesReceived, setSharesReceived] = useState('');
  const [exchangeRatio, setExchangeRatio] = useState('');
  const [cashPerShare, setCashPerShare] = useState('');
  const [useRatio, setUseRatio] = useState(false);

  // Demerger
  const [demergerShares, setDemergerShares] = useState('');
  const [costSplitPct, setCostSplitPct] = useState('30'); // % going to new company

  // Global extras
  const [targetCurrency, setTargetCurrency] = useState(holding.currency ?? 'USD');
  const [fxRate, setFxRate] = useState('');

  // Computed
  const totalCost = holding.quantity * holding.avgBuyPrice;
  const mergerSharesNum = useRatio && exchangeRatio
    ? holding.quantity * parseFloat(exchangeRatio)
    : parseFloat(sharesReceived) || 0;
  const cashComp = (parseFloat(cashPerShare) || 0) * holding.quantity;
  const transferredCost = totalCost - cashComp;
  const mergerNewAvg = mergerSharesNum > 0 ? transferredCost / mergerSharesNum : 0;

  const demergerSharesNum = parseFloat(demergerShares) || 0;
  const splitRatio = (parseFloat(costSplitPct) || 0) / 100;
  const costToNew = totalCost * splitRatio;
  const costRemaining = totalCost * (1 - splitRatio);
  const parentNewAvg = holding.quantity > 0 ? costRemaining / holding.quantity : 0;
  const childNewAvg = demergerSharesNum > 0 ? costToNew / demergerSharesNum : 0;

  async function handleSubmit() {
    setError('');

    // Validation
    if (!targetSymbol.trim()) { setError('Enter the stock symbol'); return; }
    if (!targetName.trim()) { setError('Enter the company name'); return; }
    if (!recordDate) { setError('Enter the record date'); return; }

    if (isMerger) {
      if (mergerSharesNum <= 0) { setError('Enter valid shares received or exchange ratio'); return; }
    } else {
      if (demergerSharesNum <= 0) { setError('Enter shares received in new company'); return; }
      if (splitRatio <= 0 || splitRatio >= 1) { setError('Cost split must be between 1% and 99%'); return; }
    }

    setSaving(true);

    try {
      const payload: Record<string, unknown> = {
        action: mode,
        sourceHoldingId: holding.id,
        recordDate,
        assetType: holding.assetType,
      };

      if (isMerger) {
        payload.targetStockSymbol = targetSymbol.trim().toUpperCase();
        payload.targetStockName = targetName.trim();
        payload.targetExchange = targetExchange;
        payload.sharesReceived = mergerSharesNum;
        payload.cashPerShare = parseFloat(cashPerShare) || 0;
        payload.transferCostBasis = true;
        if (isGlobal) {
          payload.targetCurrency = targetCurrency;
          payload.fxRate = parseFloat(fxRate) || 1;
          payload.targetCountry = '';
          payload.targetSector = '';
        }
      } else {
        payload.newStockSymbol = targetSymbol.trim().toUpperCase();
        payload.newStockName = targetName.trim();
        payload.newExchange = targetExchange;
        payload.sharesReceived = demergerSharesNum;
        payload.costSplitRatio = splitRatio;
        if (isGlobal) {
          payload.newCurrency = targetCurrency;
          payload.fxRate = parseFloat(fxRate) || 1;
          payload.newCountry = '';
          payload.newSector = '';
        }
      }

      const res = await fetch('/api/stocks/corporate-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed');

      holdingsCacheClearAll();
      setSuccess(true);
      setTimeout(() => { onComplete(); onClose(); }, 1500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const cSymbol = isGlobal ? (holding.currency === 'GBP' ? '£' : holding.currency === 'EUR' ? '€' : '$') : '₹';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(27,42,74,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--wv-surface, #fff)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between" style={{ backgroundColor: '#1B2A4A' }}>
          <div>
            <h2 className="text-sm font-semibold text-white">
              {isMerger ? 'Merger / Acquisition' : 'Demerger / Spin-off'}
            </h2>
            <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {holding.name} ({holding.symbol})
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10">
            <X className="w-4 h-4 text-white" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">

          {/* Source holding info */}
          <div className="p-3 rounded-xl" style={{ backgroundColor: 'var(--wv-surface-2)', border: '1px solid var(--wv-border)' }}>
            <p className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--wv-text-muted)' }}>
              {isMerger ? 'Stock Being Acquired' : 'Parent Company'}
            </p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--wv-text)' }}>{holding.name}</p>
                <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{holding.symbol} · {holding.quantity} shares · Avg {cSymbol}{holding.avgBuyPrice.toFixed(2)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(totalCost)}</p>
                <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>Total cost</p>
              </div>
            </div>
          </div>

          {/* Arrow */}
          <div className="flex justify-center">
            <ArrowRight className="w-5 h-5" style={{ color: '#C9A84C' }} />
          </div>

          {/* Target company search */}
          <div className="space-y-3">
            <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#C9A84C' }}>
              {isMerger ? 'Acquiring Company' : 'New / Demerged Company'}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Symbol *</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3" style={{ color: 'var(--wv-text-muted)' }} />
                  <Input
                    value={targetSymbol}
                    onChange={e => setTargetSymbol(e.target.value)}
                    placeholder={isGlobal ? 'e.g. CDE' : 'e.g. RELIANCE'}
                    className="h-9 text-xs pl-7"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Exchange</Label>
                <Input
                  value={targetExchange}
                  onChange={e => setTargetExchange(e.target.value)}
                  placeholder={isGlobal ? 'NYSE' : 'NSE'}
                  className="h-9 text-xs"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Company Name *</Label>
              <Input
                value={targetName}
                onChange={e => setTargetName(e.target.value)}
                placeholder={isMerger ? 'e.g. Coeur Mining Inc' : 'e.g. NewCo Ltd'}
                className="h-9 text-xs"
              />
            </div>
          </div>

          {/* Merger-specific fields */}
          {isMerger && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 mb-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={!useRatio} onChange={() => setUseRatio(false)} className="w-3 h-3" style={{ accentColor: '#1B2A4A' }} />
                  <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Enter shares received</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={useRatio} onChange={() => setUseRatio(true)} className="w-3 h-3" style={{ accentColor: '#1B2A4A' }} />
                  <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Enter exchange ratio</span>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {useRatio ? (
                  <div className="space-y-1">
                    <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Exchange Ratio</Label>
                    <Input
                      type="number" step="0.0001" min="0.0001"
                      value={exchangeRatio}
                      onChange={e => setExchangeRatio(e.target.value)}
                      placeholder="0.8011"
                      className="h-9 text-xs"
                    />
                    <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                      Shares of acquirer per 1 share held
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Shares Received *</Label>
                    <Input
                      type="number" step="0.0001" min="0.0001"
                      value={sharesReceived}
                      onChange={e => setSharesReceived(e.target.value)}
                      placeholder="80.11"
                      className="h-9 text-xs"
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Cash per Share ({cSymbol})</Label>
                  <Input
                    type="number" step="0.01" min="0"
                    value={cashPerShare}
                    onChange={e => setCashPerShare(e.target.value)}
                    placeholder="0.00"
                    className="h-9 text-xs"
                  />
                  <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>If M&A includes cash + shares</p>
                </div>
              </div>
            </div>
          )}

          {/* Demerger-specific fields */}
          {!isMerger && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Shares Received *</Label>
                  <Input
                    type="number" step="0.0001" min="0.0001"
                    value={demergerShares}
                    onChange={e => setDemergerShares(e.target.value)}
                    placeholder="50"
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Cost to New Company (%)</Label>
                  <Input
                    type="number" step="1" min="1" max="99"
                    value={costSplitPct}
                    onChange={e => setCostSplitPct(e.target.value)}
                    placeholder="30"
                    className="h-9 text-xs"
                  />
                  <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                    {costSplitPct ? `${100 - parseFloat(costSplitPct)}% stays with ${holding.name}` : 'As announced by the company'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Global: currency + FX */}
          {isGlobal && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Currency of New Stock</Label>
                <Input
                  value={targetCurrency}
                  onChange={e => setTargetCurrency(e.target.value)}
                  placeholder="USD"
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>FX Rate to INR</Label>
                <Input
                  type="number" step="0.01" min="0.01"
                  value={fxRate}
                  onChange={e => setFxRate(e.target.value)}
                  placeholder="83.92"
                  className="h-9 text-xs"
                />
              </div>
            </div>
          )}

          {/* Record date */}
          <div className="space-y-1">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Record Date *</Label>
            <Input
              type="date"
              value={recordDate}
              onChange={e => setRecordDate(e.target.value)}
              className="h-9 text-xs w-48"
            />
          </div>

          {/* Preview */}
          {(isMerger ? mergerSharesNum > 0 : demergerSharesNum > 0) && targetName && (
            <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(27,42,74,0.04)', border: '1px solid rgba(27,42,74,0.10)' }}>
              <p className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--wv-text-muted)' }}>Preview</p>
              {isMerger ? (
                <div className="space-y-1">
                  <p className="text-xs" style={{ color: 'var(--wv-text)' }}>
                    <strong>{holding.quantity}</strong> shares of {holding.name} → <strong>{mergerSharesNum.toFixed(4)}</strong> shares of {targetName}
                  </p>
                  <p className="text-[10px]" style={{ color: 'var(--wv-text-secondary)' }}>
                    Cost basis: {formatLargeINR(transferredCost)} transferred · New avg: {cSymbol}{mergerNewAvg.toFixed(2)}/share
                  </p>
                  {cashComp > 0 && (
                    <p className="text-[10px]" style={{ color: '#059669' }}>
                      Cash received: {cSymbol}{cashComp.toFixed(2)}
                    </p>
                  )}
                  <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                    {holding.name} will be closed. A new {targetName} holding will be created.
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-xs" style={{ color: 'var(--wv-text)' }}>
                    {holding.name}: <strong>{holding.quantity}</strong> shares retained · Avg adjusted to {cSymbol}{parentNewAvg.toFixed(2)}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--wv-text)' }}>
                    {targetName}: <strong>{demergerSharesNum}</strong> new shares · Avg {cSymbol}{childNewAvg.toFixed(2)}
                  </p>
                  <p className="text-[10px]" style={{ color: 'var(--wv-text-secondary)' }}>
                    Cost split: {formatLargeINR(costRemaining)} stays ({(100 - splitRatio * 100).toFixed(0)}%) · {formatLargeINR(costToNew)} transferred ({(splitRatio * 100).toFixed(0)}%)
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
              style={{ backgroundColor: 'rgba(220,38,38,0.06)', color: '#DC2626' }}>
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Success */}
          {success && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
              style={{ backgroundColor: 'rgba(5,150,105,0.06)', color: '#059669' }}>
              <Check className="w-3.5 h-3.5 flex-shrink-0" />
              {isMerger ? 'Merger recorded successfully!' : 'Demerger recorded successfully!'}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex gap-3" style={{ borderTop: '1px solid var(--wv-border)' }}>
          <Button variant="outline" onClick={onClose} className="flex-1 h-9 text-xs"
            style={{ borderColor: 'var(--wv-border)', color: 'var(--wv-text)' }}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving || success} className="flex-1 h-9 text-xs text-white"
            style={{ backgroundColor: '#1B2A4A' }}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
            {saving ? 'Processing...' : success ? 'Done!' : isMerger ? 'Confirm Merger' : 'Confirm Demerger'}
          </Button>
        </div>
      </div>
    </div>
  );
}
