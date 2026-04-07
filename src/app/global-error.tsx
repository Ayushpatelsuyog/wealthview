'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', backgroundColor: '#F7F5F0', margin: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 24 }}>
          <div style={{ textAlign: 'center', maxWidth: 400 }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1B2A4A', marginBottom: 8 }}>Something went wrong</h2>
            <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 20 }}>{error.message || 'An unexpected error occurred.'}</p>
            <button
              onClick={reset}
              style={{ backgroundColor: '#1B2A4A', color: 'white', border: 'none', padding: '10px 24px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
            >
              Try Again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
