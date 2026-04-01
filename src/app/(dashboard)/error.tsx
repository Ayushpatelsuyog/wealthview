'use client';

import { useEffect } from 'react';

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
    <div className="p-6 flex items-center justify-center min-h-64">
      <div className="text-center max-w-md">
        <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--wv-text)' }}>Something went wrong</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--wv-text-secondary)' }}>{error.message}</p>
        <button
          onClick={reset}
          className="text-xs font-semibold px-4 py-2 rounded-lg"
          style={{ backgroundColor: '#1B2A4A', color: 'white' }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
