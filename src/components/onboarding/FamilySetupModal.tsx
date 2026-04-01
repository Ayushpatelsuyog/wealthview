'use client';

import { useState } from 'react';
import { Users, TrendingUp, Shield, BarChart3, Loader2 } from 'lucide-react';

interface Props {
  onComplete: () => void;
}

export function FamilySetupModal({ onComplete }: Props) {
  const [familyName, setFamilyName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate() {
    const name = familyName.trim();
    if (!name) { setError('Please enter a family name'); return; }
    setIsLoading(true);
    setError('');

    try {
      const res = await fetch('/api/family/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyName: name }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Failed to create family'); return; }
      onComplete();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(27,42,74,0.6)', backdropFilter: 'blur(4px)' }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div
          className="p-7 text-center relative overflow-hidden"
          style={{ background: 'linear-gradient(135deg, #1B2A4A 0%, #243559 100%)' }}
        >
          <div className="absolute -top-6 -right-6 w-32 h-32 rounded-full opacity-10" style={{ backgroundColor: '#C9A84C' }} />
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center relative z-10" style={{ backgroundColor: '#C9A84C' }}>
            <TrendingUp className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-1 relative z-10" style={{ fontFamily: 'var(--font-playfair, serif)' }}>
            Welcome to WealthView
          </h2>
          <p className="text-sm relative z-10" style={{ color: 'rgba(255,255,255,0.6)' }}>
            Set up your family to start tracking your wealth
          </p>
        </div>

        {/* Features */}
        <div className="px-7 pt-6 pb-4">
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[
              { icon: BarChart3, label: 'Track all assets' },
              { icon: Users,     label: 'Family members' },
              { icon: Shield,    label: 'Secure & private' },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex flex-col items-center gap-1.5 p-3 rounded-xl text-center" style={{ backgroundColor: 'var(--wv-surface-2)' }}>
                <Icon className="w-4 h-4" style={{ color: '#C9A84C' }} />
                <span className="text-[11px] font-medium" style={{ color: 'var(--wv-text-secondary)' }}>{label}</span>
              </div>
            ))}
          </div>

          {/* Family name input */}
          <div className="space-y-2 mb-4">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--wv-text-muted)' }}>
              Family Name
            </label>
            <input
              type="text"
              value={familyName}
              onChange={(e) => { setFamilyName(e.target.value); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              placeholder="e.g. Shah Family, The Mehtas"
              className="w-full px-4 py-2.5 rounded-xl text-sm outline-none transition-all"
              style={{
                border: `1.5px solid ${error ? '#DC2626' : 'var(--wv-border)'}`,
                backgroundColor: 'var(--wv-surface-2)',
                color: 'var(--wv-text)',
              }}
              autoFocus
            />
            {error && <p className="text-xs" style={{ color: '#DC2626' }}>{error}</p>}
            <p className="text-[11px]" style={{ color: 'var(--wv-text-muted)' }}>
              You can rename this later in settings. Your data is private and never shared.
            </p>
          </div>

          <button
            onClick={handleCreate}
            disabled={isLoading || !familyName.trim()}
            className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-opacity disabled:opacity-60"
            style={{ backgroundColor: '#C9A84C', color: 'var(--wv-text)' }}
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {isLoading ? 'Setting up…' : 'Create Family & Continue'}
          </button>
        </div>

        <p className="text-center text-[11px] pb-5" style={{ color: '#D1D5DB' }}>
          You can add more family members after setup
        </p>
      </div>
    </div>
  );
}
