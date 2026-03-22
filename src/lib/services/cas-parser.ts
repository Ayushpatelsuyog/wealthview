// ─── CAS Statement Parser ─────────────────────────────────────────────────────
// Parses CAMS / KFintech Consolidated Account Statement (CAS) CSV/text files
// and a simple template CSV for bulk entry.

export interface ParsedTransaction {
  date: string;        // YYYY-MM-DD
  type: 'buy' | 'sip' | 'sell' | 'dividend' | 'switch';
  amount: number;      // always positive ₹
  units: number;       // always positive
  nav: number;
}

export interface ParsedFund {
  id: string;          // local key for React
  rawName: string;
  folio: string;
  investorPan?: string;
  transactions: ParsedTransaction[];
  // Calculated totals
  totalUnits: number;
  investedAmount: number;
  avgNav: number;
  // AMFI matching (filled after search)
  matchedSchemeCode: number | null;
  matchedSchemeName: string | null;
  status: 'ready' | 'needs_review';
}

export interface ParseResult {
  funds: ParsedFund[];
  investorName?: string;
  investorPan?: string;
  format: 'cams_cas' | 'kfintech_cas' | 'template_csv' | 'unknown';
  errors: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, string> = {
  Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
  Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12',
};

function parseDate(raw: string): string {
  if (!raw) return '';
  raw = raw.trim().replace(/"/g, '');

  // YYYY-MM-DD (already correct)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // DD-MM-YYYY or DD/MM/YYYY
  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;

  // DD-Mon-YYYY (CAMS format: 01-Jan-2023)
  const dmonY = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (dmonY) {
    const m = MONTH_MAP[dmonY[2]] ?? '01';
    return `${dmonY[3]}-${m}-${dmonY[1].padStart(2,'0')}`;
  }

  return raw;
}

function parseTxnType(desc: string): ParsedTransaction['type'] {
  const d = desc.toLowerCase();
  if (d.includes('sip') || d.includes('systematic')) return 'sip';
  if (d.includes('redemption') || d.includes('withdrawal') || d.includes('switch out')) return 'sell';
  if (d.includes('dividend')) return 'dividend';
  if (d.includes('switch in')) return 'switch';
  return 'buy';
}

function calcTotals(txns: ParsedTransaction[]): Pick<ParsedFund,'totalUnits'|'investedAmount'|'avgNav'> {
  let totalUnits = 0;
  let investedAmount = 0;
  for (const t of txns) {
    if (t.type === 'buy' || t.type === 'sip') {
      totalUnits += t.units;
      investedAmount += t.amount;
    } else if (t.type === 'sell') {
      totalUnits -= t.units;
    }
  }
  totalUnits = Math.max(0, totalUnits);
  const avgNav = totalUnits > 0 ? investedAmount / totalUnits : 0;
  return { totalUnits, investedAmount, avgNav };
}

let _idCounter = 0;
function uid(): string { return `pf_${Date.now()}_${_idCounter++}`; }

// ─── Format detection ─────────────────────────────────────────────────────────

function detectFormat(content: string): ParseResult['format'] {
  const head = content.slice(0, 2000).toLowerCase();
  if (head.includes('kfintech') || head.includes('karvy')) return 'kfintech_cas';
  if (head.includes('cams') || head.includes('consolidated account statement') || head.includes('folio no:')) return 'cams_cas';
  const firstLine = content.split('\n')[0].toLowerCase();
  if (firstLine.includes('scheme_name') || firstLine.includes('transaction_date')) return 'template_csv';
  // heuristic: if first non-empty line looks like a CSV header row
  if (/scheme|folio|transaction|units|nav/i.test(firstLine)) return 'template_csv';
  return 'unknown';
}

// ─── Template CSV parser ──────────────────────────────────────────────────────
// Expected columns (order flexible): scheme_name, folio_number, transaction_date,
//   transaction_type, amount, units, nav

function parseTemplateCsv(content: string): ParseResult {
  const errors: string[] = [];
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    return { funds: [], format: 'template_csv', errors: ['File appears empty or has only a header row'] };
  }

  // Parse header
  const header = parseCsvRow(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'));
  const idx = {
    name:  header.indexOf('scheme_name'),
    folio: header.indexOf('folio_number'),
    date:  header.indexOf('transaction_date'),
    type:  header.indexOf('transaction_type'),
    amt:   header.indexOf('amount'),
    units: header.indexOf('units'),
    nav:   header.indexOf('nav'),
  };

  if (idx.name < 0 || idx.date < 0 || idx.amt < 0) {
    errors.push('Header must include at least: scheme_name, transaction_date, amount');
    return { funds: [], format: 'template_csv', errors };
  }

  // Group rows by scheme_name + folio_number
  const groups = new Map<string, { name: string; folio: string; txns: ParsedTransaction[] }>();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    const name  = idx.name  >= 0 ? (cols[idx.name]  ?? '').trim() : '';
    const folio = idx.folio >= 0 ? (cols[idx.folio] ?? '').trim() : '';
    if (!name) continue;

    const key = `${name}||${folio}`;
    if (!groups.has(key)) groups.set(key, { name, folio, txns: [] });

    const dateRaw = idx.date >= 0 ? (cols[idx.date] ?? '') : '';
    const typeRaw = idx.type >= 0 ? (cols[idx.type] ?? 'purchase') : 'purchase';
    const amt     = Math.abs(parseFloat(idx.amt   >= 0 ? (cols[idx.amt]   ?? '0') : '0') || 0);
    const units   = Math.abs(parseFloat(idx.units >= 0 ? (cols[idx.units] ?? '0') : '0') || 0);
    const nav     = Math.abs(parseFloat(idx.nav   >= 0 ? (cols[idx.nav]   ?? '0') : '0') || 0);

    if (!dateRaw || (!amt && !units)) continue;

    groups.get(key)!.txns.push({
      date:   parseDate(dateRaw),
      type:   parseTxnType(typeRaw),
      amount: amt,
      units:  units || (nav > 0 ? amt / nav : 0),
      nav:    nav   || (units > 0 ? amt / units : 0),
    });
  }

  const funds: ParsedFund[] = [];
  for (const { name, folio, txns } of Array.from(groups.values())) {
    if (txns.length === 0) continue;
    const totals = calcTotals(txns);
    funds.push({
      id:  uid(),
      rawName: name,
      folio,
      transactions: txns,
      ...totals,
      matchedSchemeCode: null,
      matchedSchemeName: null,
      status: 'needs_review',
    });
  }

  return { funds, format: 'template_csv', errors };
}

// ─── CAMS CAS parser ──────────────────────────────────────────────────────────

function parseCamsCas(content: string): ParseResult {
  const errors: string[] = [];
  const funds: ParsedFund[] = [];
  const lines = content.split('\n');

  let investorName: string | undefined;
  let investorPan: string | undefined;

  // Extract investor info
  for (const line of lines.slice(0, 20)) {
    const clean = line.replace(/"/g, '').trim();
    const nameMatch = clean.match(/Investor\s*[:=]\s*(.+?)(?:\s{2,}|Pan|$)/i);
    if (nameMatch) investorName = nameMatch[1].trim();
    const panMatch  = clean.match(/PAN\s*[:=]\s*([A-Z]{5}[0-9]{4}[A-Z])/i);
    if (panMatch) investorPan = panMatch[1];
  }

  let currentFund: { name: string; folio: string; pan?: string } | null = null;
  let inTxnBlock = false;
  const txnsByFund = new Map<string, ParsedTransaction[]>();
  const fundMeta   = new Map<string, { name: string; folio: string; pan?: string }>();

  for (const rawLine of lines) {
    const line  = rawLine.replace(/"/g, '').trim();
    const lower = line.toLowerCase();

    // Folio line
    const folioMatch = line.match(/Folio\s+No\.?\s*:?\s*(\S+)\s*\/?\s*(.*)/i);
    if (folioMatch) {
      const folio  = folioMatch[1].trim();
      const panM   = line.match(/PAN\s*:\s*([A-Z]{5}\d{4}[A-Z])/i);
      currentFund  = { name: '', folio, pan: panM?.[1] };
      inTxnBlock   = false;
      continue;
    }

    // Scheme line
    if (currentFund && /^Scheme\s*:/i.test(line)) {
      currentFund.name = line.replace(/^Scheme\s*:\s*/i, '').trim();
      const key = `${currentFund.name}||${currentFund.folio}`;
      if (!txnsByFund.has(key)) {
        txnsByFund.set(key, []);
        fundMeta.set(key, { ...currentFund });
      }
      continue;
    }

    // Transaction header row
    if (lower.includes('date') && lower.includes('transaction') && lower.includes('amount') && lower.includes('units')) {
      inTxnBlock = currentFund !== null;
      continue;
    }

    // Transaction data row — date-starting lines
    if (inTxnBlock && currentFund) {
      const key = `${currentFund.name}||${currentFund.folio}`;
      const txn = parseCamsTxnLine(line);
      if (txn) {
        txnsByFund.get(key)?.push(txn);
      } else if (line.length > 0 && !/^-+$/.test(line) && !/Closing/i.test(line) && !lower.includes('total')) {
        // Non-empty, non-separator line that's not a transaction → end of block
        if (!/^\d/.test(line)) inTxnBlock = false;
      }
    }
  }

  for (const [key, txns] of Array.from(txnsByFund.entries())) {
    if (txns.length === 0) continue;
    const meta = fundMeta.get(key)!;
    const totals = calcTotals(txns);
    funds.push({
      id: uid(),
      rawName: meta.name,
      folio: meta.folio,
      investorPan: meta.pan ?? investorPan,
      transactions: txns,
      ...totals,
      matchedSchemeCode: null,
      matchedSchemeName: null,
      status: 'needs_review',
    });
  }

  if (funds.length === 0) errors.push('No fund data found — make sure this is a CAMS CAS file.');

  return { funds, investorName, investorPan, format: 'cams_cas', errors };
}

function parseCamsTxnLine(line: string): ParsedTransaction | null {
  // Expect: Date,Description,Amount,Units,NAV,Balance,Value
  const cols = parseCsvRow(line);
  if (cols.length < 4) return null;

  const dateStr = parseDate(cols[0]);
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;

  const desc   = cols[1] ?? '';
  const amount = Math.abs(parseFloat(cols[2]) || 0);
  const units  = Math.abs(parseFloat(cols[3]) || 0);
  const nav    = Math.abs(parseFloat(cols[4]) || 0);

  if (amount === 0 && units === 0) return null;

  return { date: dateStr, type: parseTxnType(desc), amount, units, nav };
}

// ─── KFintech CAS parser ──────────────────────────────────────────────────────
// KFintech format is similar to CAMS but with slightly different labels.

function parseKfintechCas(content: string): ParseResult {
  // KFintech uses similar structure; try CAMS parser first then fix format label
  const result = parseCamsCas(content);
  return { ...result, format: 'kfintech_cas' };
}

// ─── CSV row parser (handles quoted fields) ───────────────────────────────────

function parseCsvRow(line: string): string[] {
  const cols: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cols.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cols.push(current.trim());
  return cols;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function parseCasFile(content: string, filename: string): ParseResult {
  const format = detectFormat(content);

  try {
    switch (format) {
      case 'template_csv':  return parseTemplateCsv(content);
      case 'kfintech_cas':  return parseKfintechCas(content);
      case 'cams_cas':      return parseCamsCas(content);
      default: {
        // Try template CSV first, then CAMS
        const tcResult = parseTemplateCsv(content);
        if (tcResult.funds.length > 0) return { ...tcResult, format: 'template_csv' };
        const caResult = parseCamsCas(content);
        if (caResult.funds.length > 0) return caResult;
        return {
          funds: [],
          format: 'unknown',
          errors: [`Could not parse "${filename}". Please use the template CSV format or a CAMS/KFintech CAS statement.`],
        };
      }
    }
  } catch (e) {
    return {
      funds: [],
      format,
      errors: [`Parse error: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
}

// ─── Template CSV for download ────────────────────────────────────────────────

export const TEMPLATE_CSV_CONTENT = `scheme_name,folio_number,transaction_date,transaction_type,amount,units,nav
"HDFC Mid-Cap Opportunities Fund - Direct Plan Growth",12345678,2023-01-01,purchase,50000,952.381,52.50
"HDFC Mid-Cap Opportunities Fund - Direct Plan Growth",12345678,2023-02-01,sip,5000,88.235,56.70
"Axis Bluechip Fund - Direct Plan Growth",87654321,2022-06-15,purchase,100000,1503.759,66.50
`;
