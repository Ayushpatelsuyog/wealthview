import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // WealthView brand
        navy:       '#1B2A4A',
        gold:       '#C9A84C',
        'gold-light': '#F5EDD6',
        teal:       '#2E8B8B',
        gain:       '#059669',
        loss:       '#DC2626',
        // Page / surface
        bg:         '#F7F5F0',
        surface:    '#FFFFFF',
        border:     '#E8E5DD',
        // Text
        'text-primary':   '#1A1A2E',
        'text-secondary': '#6B7280',
        'text-muted':     '#9CA3AF',
        // shadcn tokens
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: { DEFAULT: 'hsl(var(--destructive))' },
        input:  'hsl(var(--input))',
        ring:   'hsl(var(--ring))',
      },
      fontFamily: {
        sans:    ['var(--font-dm-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-playfair)', 'Georgia', 'serif'],
      },
      borderRadius: {
        lg:   '12px',
        md:   '8px',
        sm:   '6px',
        xl:   '16px',
        '2xl':'20px',
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.08)',
        gold: '0 0 0 2px #C9A84C',
      },
    },
  },
  plugins: [],
};

export default config;
