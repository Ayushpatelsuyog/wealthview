'use client';

import { useEffect } from 'react';
import { AlertCircle, RefreshCw, ArrowLeft } from 'lucide-react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[DashboardError]', error);
  }, [error]);

  return (
    <div className="p-6 flex items-center justify-center" style={{ minHeight: '60vh' }}>
      <div className="text-center max-w-md">
        <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(220,38,38,0.08)' }}>
          <AlertCircle className="w-7 h-7" style={{ color: '#DC2626' }} />
        </div>
        <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--wv-text)' }}>Something went wrong</h2>
        <p className="text-sm mb-5" style={{ color: 'var(--wv-text-secondary)' }}>{error.message || 'An unexpected error occurred.'}</p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 text-xs font-semibold px-4 py-2.5 rounded-lg"
            style={{ backgroundColor: '#1B2A4A', color: 'white' }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Try Again
          </button>
          <button
            onClick={() => { window.location.href = '/dashboard'; }}
            className="inline-flex items-center gap-2 text-xs font-semibold px-4 py-2.5 rounded-lg border"
            style={{ borderColor: 'var(--wv-border)', color: 'var(--wv-text)' }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
