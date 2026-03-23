/**
 * eCAS Statement Parser — Server-only (used in API routes)
 * Supports CAMS and MFCentral eCAS in CSV, Excel, and PDF formats.
 */

import * as XLSX from 'xlsx';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ECASTransactionType =
  | 'purchase'
  | 'sip'
  | 'redemption'
  | 'switch_in'
  | 'switch_out'
  | 'dividend_payout'
  | 'dividend_reinvestment'
  | 'other';

export interface ECASTransaction {
  transactionDate: string;      // ISO date YYYY-MM-DD
  transactionType: ECASTransactionType;
  rawType: string;              // original string from statement
  amount: number;               // always positive
  units: number;                // negative for redemptions/switch-out
  nav: number;
  unitBalance: number;
}

export interface ECASFund {
  fundHouse: string;
  schemeName: string;
  folioNumber: string;
  isin?: string;
  transactions: ECASTransaction[];
  closingUnits?: number;
}

export interface ECASParseResult {
  funds: ECASFund[];
  statementDate?: string;
  panNumber?: string;
  parseErrors: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function parseDate(raw: string): string {
  if (!raw) return '';
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // DD-MMM-YYYY or DD MMM YYYY
  const m1 = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})$/);
  if (m1) {
    const mon = MONTH_MAP[m1[2].toLowerCase()] ?? '01';
    return `${m1[3]}-${mon}-${m1[1].padStart(2, '0')}`;
  }
  // DD/MM/YYYY or DD-MM-YYYY
  const m2 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m2) return `${m2[3]}-${m2[2].padStart(2, '0')}-${m2[1].padStart(2, '0')}`;
  return s;
}

function parseNum(raw: string | number | undefined | null): number {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === 'number') return isNaN(raw) ? 0 : raw;
  return parseFloat(raw.replace(/[₹,\s]/g, '')) || 0;
}

function normalizeType(raw: string): ECASTransactionType {
  const s = raw.toUpperCase().trim();
  if (/IDCW\s*RE\s*INVEST|DIVIDEND\s*RE\s*INVEST/.test(s)) return 'dividend_reinvestment';
  if (/IDCW\s*PAYOUT|DIVIDEND\s*PAYOUT/.test(s)) return 'dividend_payout';
  if (/SWITCH.*IN|STP.*IN/.test(s) && !/OUT/.test(s)) return 'switch_in';
  if (/SWITCH.*OUT|STP.*OUT/.test(s)) return 'switch_out';
  if (/SIP|SYSTEMATIC\s*INVEST/.test(s)) return 'sip';
  if (/REDEMPTION|REDEEM|SWP|SYSTEMATIC\s*WITH/.test(s)) return 'redemption';
  if (/PURCHASE|LUMP\s*SUM|NFO|ADDITIONAL|NEW\s*ALLOT/.test(s)) return 'purchase';
  return 'other';
}

function findColIdx(headers: string[], ...candidates: string[]): number {
  const norm = headers.map(h => h.toLowerCase().replace(/[\s_\-\/]+/g, ''));
  for (const c of candidates) {
    const idx = norm.indexOf(c.toLowerCase().replace(/[\s_\-\/]+/g, ''));
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuote = false;
  for (const c of line) {
    if (c === '"') { inQuote = !inQuote; }
    else if (c === ',' && !inQuote) { result.push(cur.trim()); cur = ''; }
    else { cur += c; }
  }
  result.push(cur.trim());
  return result;
}

// ─── CSV Parser ───────────────────────────────────────────────────────────────

export function parseCSV(csvText: string): ECASParseResult {
  const allLines = csvText.split(/\r?\n/);
  const errors: string[] = [];

  // Find header row — must contain "scheme" or "fund" AND "transaction" or "amount"
  let headerIdx = -1;
  for (let i = 0; i < Math.min(allLines.length, 15); i++) {
    const low = allLines[i].toLowerCase();
    if ((low.includes('scheme') || low.includes('fund')) &&
        (low.includes('transaction') || low.includes('amount') || low.includes('units'))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    return { funds: [], parseErrors: ['Could not find a valid header row. Check that the file is a CAMS or MFCentral eCAS export.'] };
  }

  const headers = parseCSVRow(allLines[headerIdx]);

  const iAMC     = findColIdx(headers, 'AMC', 'FundHouse', 'Fund House', 'AMCName');
  const iFolio   = findColIdx(headers, 'Folio No', 'FolioNo', 'Folio Number', 'FolioNumber', 'FOLIO');
  const iScheme  = findColIdx(headers, 'Scheme', 'SchemeName', 'Scheme Name', 'SCHEMENAME');
  const iISIN    = findColIdx(headers, 'ISIN', 'Isin');
  const iTxnType = findColIdx(headers, 'Transaction Type', 'TransactionType', 'TxnType', 'Type');
  const iDate    = findColIdx(headers, 'Transaction Date', 'TransactionDate', 'Date', 'TXN Date', 'Txn Date');
  const iAmount  = findColIdx(headers, 'Amount', 'Amount (Rs)', 'Amount (₹)', 'Amt');
  const iUnits   = findColIdx(headers, 'Units', 'Quantity', 'No of Units');
  const iNAV     = findColIdx(headers, 'NAV', 'Nav', 'Price/NAV', 'Price', 'NAV (₹)');
  const iBalance = findColIdx(headers, 'Unit Balance', 'UnitBalance', 'Balance', 'Closing Balance', 'Units Balance');

  if (iScheme === -1 || iTxnType === -1) {
    return { funds: [], parseErrors: ['Required columns (Scheme/Transaction Type) not found. Ensure this is a CAMS or MFCentral eCAS CSV.'] };
  }

  const fundMap = new Map<string, ECASFund>();

  for (let i = headerIdx + 1; i < allLines.length; i++) {
    const line = allLines[i];
    if (!line.trim()) continue;

    const cols = parseCSVRow(line);
    if (cols.length <= Math.max(iScheme, iTxnType)) continue;

    const schemeName = cols[iScheme]?.trim();
    const rawType    = cols[iTxnType]?.trim();
    if (!schemeName || !rawType) continue;

    // Skip non-transaction rows
    if (/stamp\s*duty|service\s*tax|gst|tds|surcharge/i.test(rawType)) continue;

    const fundHouse = iAMC !== -1 ? (cols[iAMC]?.trim() ?? '') : '';
    const folio     = iFolio !== -1 ? (cols[iFolio]?.trim() ?? '') : '';
    const isin      = iISIN !== -1 ? (cols[iISIN]?.trim() || undefined) : undefined;
    const dateStr   = iDate !== -1 ? parseDate(cols[iDate]?.trim() ?? '') : '';
    const amount    = iAmount !== -1 ? parseNum(cols[iAmount]) : 0;
    const units     = iUnits !== -1 ? parseNum(cols[iUnits]) : 0;
    const nav       = iNAV !== -1 ? parseNum(cols[iNAV]) : 0;
    const balance   = iBalance !== -1 ? parseNum(cols[iBalance]) : 0;

    const key = `${schemeName}::${folio}`;
    if (!fundMap.has(key)) {
      fundMap.set(key, { fundHouse, schemeName, folioNumber: folio, isin, transactions: [] });
    }

    const txnType = normalizeType(rawType);
    if (txnType === 'other' && amount === 0 && Math.abs(units) < 0.0001) continue;

    fundMap.get(key)!.transactions.push({
      transactionDate: dateStr,
      transactionType: txnType,
      rawType,
      amount: Math.abs(amount),
      units: (txnType === 'redemption' || txnType === 'switch_out') ? -Math.abs(units) : Math.abs(units),
      nav,
      unitBalance: balance,
    });
  }

  const funds = Array.from(fundMap.values()).filter(f => f.transactions.length > 0);
  for (const fund of funds) {
    fund.transactions.sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));
    const last = fund.transactions[fund.transactions.length - 1];
    if (last) fund.closingUnits = last.unitBalance;
  }

  if (funds.length === 0) errors.push('No transactions found. Check that the file contains transaction rows.');
  return { funds, parseErrors: errors };
}

// ─── Excel Parser ─────────────────────────────────────────────────────────────

export function parseExcelBuffer(buffer: Buffer): ECASParseResult {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return { funds: [], parseErrors: ['Excel file has no sheets.'] };
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    return parseCSV(csv);
  } catch (e) {
    return { funds: [], parseErrors: [`Excel parsing error: ${e instanceof Error ? e.message : String(e)}`] };
  }
}

// ─── PDF Parser ───────────────────────────────────────────────────────────────

export async function parsePDFBuffer(buffer: Buffer, password?: string): Promise<ECASParseResult> {
  try {
    // Dynamic import to avoid edge-runtime issues
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfParse = (await import('pdf-parse') as any).default ?? (await import('pdf-parse') as any);
    const opts: Record<string, unknown> = {};
    if (password) opts['password'] = password;
    const data = await pdfParse(buffer, opts);
    return parsePDFText(data.text as string);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/password|encrypt|protected/i.test(msg)) {
      return { funds: [], parseErrors: ['PDF is password-protected. Enter your PAN number as the password and try again.'] };
    }
    return {
      funds: [],
      parseErrors: [
        `PDF parsing failed. ${msg.slice(0, 120)}. Try downloading the CSV version from mfcentral.com or camsonline.com instead.`,
      ],
    };
  }
}

function parsePDFText(text: string): ECASParseResult {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const funds: ECASFund[] = [];
  const errors: string[] = [];

  let currentFundHouse = '';
  let currentFolio = '';
  let currentScheme = '';
  let currentTxns: ECASTransaction[] = [];
  let inTable = false;

  const DATE_RE = /^(\d{1,2}[-\/][A-Za-z]{3}[-\/]\d{4}|\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/;

  function saveFund() {
    if (currentScheme && currentTxns.length > 0) {
      funds.push({
        fundHouse: currentFundHouse,
        schemeName: currentScheme,
        folioNumber: currentFolio,
        transactions: [...currentTxns],
        closingUnits: currentTxns[currentTxns.length - 1]?.unitBalance,
      });
    }
    currentTxns = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fund house header — ALL CAPS ish, mentions AMC / Mutual Fund / Asset Management
    if (/MUTUAL\s*FUND|ASSET\s*MANAGEMENT|AMC/i.test(line) && line.length < 100 && !DATE_RE.test(line)) {
      saveFund();
      currentScheme = '';
      currentFundHouse = line;
      inTable = false;
      continue;
    }

    // Folio line
    const folioM = line.match(/Folio\s*(?:No\.?|Number|#)?\s*:?\s*([\d\/\s]+)/i);
    if (folioM && !DATE_RE.test(line)) {
      saveFund();
      currentScheme = '';
      currentFolio = folioM[1].trim().split(/[\s\/]/)[0];
      inTable = false;
      continue;
    }

    // Scheme name — contains plan/growth/dividend/idcw keywords
    if (
      /direct\s*plan|regular\s*plan|\bgrowth\b|dividend|idcw/i.test(line) &&
      line.length > 20 &&
      !DATE_RE.test(line) &&
      !/date.*type|amount.*units|nav.*balance/i.test(line)
    ) {
      saveFund();
      currentScheme = line;
      inTable = false;
      continue;
    }

    // Table header
    if (/date.*transaction|date.*type.*amount/i.test(line.toLowerCase())) {
      inTable = true;
      continue;
    }

    // Closing balance
    if (/closing\s*balance/i.test(line)) {
      inTable = false;
      continue;
    }

    // Transaction row
    if (inTable && DATE_RE.test(line)) {
      const parts = line.split(/\s{2,}|\t/).filter(Boolean);
      if (parts.length >= 4) {
        const dateStr  = parseDate(parts[0]);
        const rawType  = parts[1] ?? '';
        const amount   = parseNum(parts[2]);
        const units    = parseNum(parts[3]);
        const nav      = parseNum(parts[4] ?? '');
        const balance  = parseNum(parts[5] ?? '');
        const txnType  = normalizeType(rawType);

        if (dateStr && rawType && (txnType !== 'other' || amount > 0)) {
          currentTxns.push({
            transactionDate: dateStr,
            transactionType: txnType,
            rawType,
            amount: Math.abs(amount),
            units: (txnType === 'redemption' || txnType === 'switch_out') ? -Math.abs(units) : Math.abs(units),
            nav,
            unitBalance: balance,
          });
        }
      }
    }
  }

  saveFund();

  if (funds.length === 0) {
    errors.push(
      'No transactions found in the PDF. The layout may differ from what is supported. ' +
      'Try the CSV version from mfcentral.com — it parses more reliably.'
    );
  }

  return { funds, parseErrors: errors };
}
