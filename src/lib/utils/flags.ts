/** Country code → ISO 3166-1 alpha-2 (lowercase) for flagcdn.com */
const COUNTRY_TO_ISO: Record<string, string> = {
  US: 'us', CA: 'ca', UK: 'gb', GB: 'gb', DE: 'de', FR: 'fr',
  JP: 'jp', HK: 'hk', AU: 'au', SG: 'sg', CN: 'cn', KR: 'kr',
  NL: 'nl', SE: 'se', IT: 'it', ES: 'es', IE: 'ie', CH: 'ch',
  BR: 'br', AE: 'ae', IN: 'in', TW: 'tw', MX: 'mx', IL: 'il',
  ZA: 'za', NZ: 'nz', DK: 'dk', NO: 'no', FI: 'fi', TH: 'th',
  MY: 'my', KZ: 'kz', PL: 'pl', CZ: 'cz', HU: 'hu', RU: 'ru',
  TR: 'tr', SA: 'sa', PH: 'ph', ID: 'id', VN: 'vn',
};

export function getCountryISO(country: string): string | null {
  return COUNTRY_TO_ISO[country] ?? COUNTRY_TO_ISO[country?.toUpperCase()] ?? null;
}

export function getFlagUrl(country: string, width = 40): string {
  const iso = getCountryISO(country);
  if (!iso) return '';
  return `https://flagcdn.com/w${width}/${iso}.png`;
}
