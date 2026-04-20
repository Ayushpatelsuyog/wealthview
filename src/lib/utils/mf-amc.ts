/**
 * AMC (Asset Management Company) matching for mutual funds.
 *
 * Used by STP flows to ensure source and destination funds belong to the same AMC.
 *
 * Strategy:
 * 1. If BOTH fund_house strings are non-empty → exact case-insensitive match
 * 2. If one is null/empty → fall back to normalized first-word match on scheme name
 * 3. If BOTH are null/empty → no match (cannot verify AMC)
 */

/** Normalize an AMC name to a short key for fuzzy matching. */
export function normalizeAmcKey(fundHouse: string): string {
  return fundHouse
    .toLowerCase()
    .replace(/\bmutual fund\b/gi, '')
    .replace(/\bmahindra\b/gi, '')
    .replace(/\bfunds management\b/gi, '')
    .replace(/\basset management\b/gi, '')
    .replace(/\blimited\b/gi, '')
    .replace(/\bamc\b/gi, '')
    .trim()
    .split(/\s+/)[0] || '';
}

/**
 * Check if two funds belong to the same AMC.
 *
 * @param sourceFundHouse - metadata.fund_house of source holding
 * @param destFundHouse - metadata.fund_house of destination holding (or from NAV API)
 * @returns { match: boolean, reason: string }
 */
export function isSameAmc(
  sourceFundHouse: string | null | undefined,
  destFundHouse: string | null | undefined,
): { match: boolean; reason: string } {
  const src = (sourceFundHouse ?? '').trim();
  const dst = (destFundHouse ?? '').trim();

  // Both populated → exact case-insensitive match
  if (src && dst) {
    if (src.toLowerCase() === dst.toLowerCase()) {
      return { match: true, reason: 'exact match' };
    }
    // Fallback: normalized key match (handles "Kotak Mahindra Mutual Fund" vs "Kotak Mahindra AMC")
    const srcKey = normalizeAmcKey(src);
    const dstKey = normalizeAmcKey(dst);
    if (srcKey && dstKey && srcKey === dstKey) {
      return { match: true, reason: 'normalized match' };
    }
    return { match: false, reason: `AMC mismatch: "${src}" vs "${dst}"` };
  }

  // One is null → cannot reliably match, allow with warning
  if (src && !dst) return { match: true, reason: 'destination AMC unknown — allowed with warning' };
  if (!src && dst) return { match: true, reason: 'source AMC unknown — allowed with warning' };

  // Both null → block
  return { match: false, reason: 'Both source and destination have unknown AMC — cannot verify' };
}
