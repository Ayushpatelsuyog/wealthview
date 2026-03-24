import type { Metadata } from 'next';
import { DM_Sans, Playfair_Display } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { ThemeProvider } from '@/components/layout/ThemeProvider';

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-dm-sans',
});

const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-playfair',
});

export const metadata: Metadata = {
  title: 'WealthView — Family Net Worth Tracker',
  description: 'Comprehensive family wealth tracking and advisory platform',
};

const themeScript = `
  (function() {
    try {
      var stored = localStorage.getItem('wv-theme');
      var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (stored === 'dark' || (!stored && prefersDark)) {
        document.documentElement.classList.add('dark');
      }
    } catch(e) {}
  })();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${playfair.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans antialiased">
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
