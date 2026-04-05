'use client';

const FLAG_COLORS: Record<string, string> = {
  US: '#1B2A4A', CA: '#DC2626', UK: '#2563EB', GB: '#2563EB',
  CN: '#DC2626', HK: '#EF4444', JP: '#DC2626', KR: '#1D4ED8',
  AU: '#1D4ED8', SG: '#DC2626', TW: '#1D4ED8', IN: '#F97316',
  DE: '#1F2937', FR: '#2563EB', NL: '#F97316', SE: '#2563EB',
  IT: '#059669', ES: '#DC2626', IE: '#059669', CH: '#DC2626',
  NO: '#DC2626', DK: '#DC2626', FI: '#2563EB', BR: '#059669',
  MX: '#059669', ZA: '#059669', NZ: '#1D4ED8', IL: '#2563EB',
  AE: '#059669', KZ: '#0891B2', TH: '#1D4ED8', MY: '#1D4ED8',
};

interface CountryFlagProps {
  country: string;
  size?: number;
}

export function CountryFlag({ country, size = 18 }: CountryFlagProps) {
  const code = (country ?? '').toUpperCase().substring(0, 2);
  const color = FLAG_COLORS[code] || '#6B7280';
  return (
    <span
      title={country}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: 4,
        backgroundColor: color,
        color: '#FFFFFF',
        fontSize: size * 0.45,
        fontWeight: 700,
        letterSpacing: -0.5,
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      {code || '??'}
    </span>
  );
}
