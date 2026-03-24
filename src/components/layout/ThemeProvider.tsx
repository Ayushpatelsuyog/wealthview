'use client';

import { useEffect } from 'react';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const stored = localStorage.getItem('wv-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = stored === 'dark' || (!stored && prefersDark);
    document.documentElement.classList.toggle('dark', isDark);
  }, []);

  return <>{children}</>;
}
