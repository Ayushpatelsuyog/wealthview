import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ParsedTransaction {
  date: string;        // yyyy-mm-dd
  type: string;        // SIP, Lump Sum, NFO, Redemption
  grossAmount: number;
  stampDuty: number;
  netAmount: number;
  nav: number;
  pricePerUnit: number;
  units: number;
  balanceUnits: number;
  installmentNumber: string; // e.g. "1/60"
  distributor: string;
}

interface AccountDetails {
  folioNumber: string;
  statementDate: string;
  holderName: string;
  pan: string;
  secondHolder: string;
  thirdHolder: string;
  nominee: string;
  nomineeDOB: string;
  nomineeShare: string;
  bankAccount: string;
  distributorName: string;
  arn: string;
  email: string;
  mobile: string;
}

interface FundSection {
  fundCode: string;       // e.g. "XXXX"
  fundName: string;       // e.g. "HDFC Focused Fund - Growth"
  isin: string;
  transactions: ParsedTransaction[];
  closingUnits: number;
  closingNav: number;
  closingValue: number;
  sipCancelled: boolean;
}

interface ComparisonField {
  entered: number | string;
  statement: number | string;
  match: boolean;
  diff?: number | string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseNumber(s: string): number {
  return parseFloat(s.replace(/,/g, '').replace(/\s/g, '')) || 0;
}

function parseDate(s: string): string {
  // dd/mm/yyyy → yyyy-mm-dd
  const m1 = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m1) return `${m1[3]}-${m1[2]}-${m1[1]}`;
  // dd-Mon-yyyy → yyyy-mm-dd
  const months: Record<string, string> = {
    jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
    jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12',
  };
  const m2 = s.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (m2) {
    const mm = months[m2[2].toLowerCase()];
    if (mm) return `${m2[3]}-${mm}-${m2[1].padStart(2, '0')}`;
  }
  return s;
}

function datesClose(a: string, b: string, toleranceDays = 2): boolean {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (isNaN(da) || isNaN(db)) return false;
  return Math.abs(da - db) <= toleranceDays * 86400000;
}

function numbersClose(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

// ─── HDFC-specific parser ────────────────────────────────────────────────────

function extractAccountDetails(text: string): AccountDetails {
  const details: AccountDetails = {
    folioNumber: '', statementDate: '', holderName: '', pan: '',
    secondHolder: '', thirdHolder: '', nominee: '', nomineeDOB: '',
    nomineeShare: '', bankAccount: '', distributorName: '', arn: '',
    email: '', mobile: '',
  };

  // Folio number: "Folio No . :   23906911   /   97" (pdfjs adds spaces)
  const folioMatch = text.match(/Folio\s*No\s*\.?\s*:?\s*([\d\s\/]+)/i);
  if (folioMatch) details.folioNumber = folioMatch[1].replace(/\s+/g, '').trim();

  // Statement date: "Account Summary as on DD-MMM-YYYY"
  const stmtDateMatch = text.match(/Account\s*Summary\s*as\s*on\s+(\d{1,2}-[A-Za-z]{3}-\d{4})/i);
  if (stmtDateMatch) details.statementDate = parseDate(stmtDateMatch[1]);

  // PAN: look for pattern XXXXX9999X near "1st Unit Holder"
  const panMatch = text.match(/(?:1st\s*Unit\s*Holder|PAN[\s\/]*PEKRN)\s*[:\s]*([A-Z]{5}\d{4}[A-Z])/i);
  if (panMatch) details.pan = panMatch[1];
  if (!details.pan) {
    const panAlt = text.match(/\b([A-Z]{5}\d{4}[A-Z])\b/);
    if (panAlt) details.pan = panAlt[1];
  }

  // Nominee: from nominee table - "1 NAME DD-Mon-YYYY ... 100%"
  const nomineeMatch = text.match(/Nominee\s*(?:Name|Details)[\s\S]*?\d+\s+([A-Z][A-Z\s]+?)\s+(\d{2}-[A-Za-z]{3}-\d{4})/i);
  if (nomineeMatch) {
    details.nominee = nomineeMatch[1].trim();
    details.nomineeDOB = parseDate(nomineeMatch[2]);
  }
  const nomineeShareMatch = text.match(/(\d+)\s*%/);
  if (nomineeShareMatch && details.nominee) details.nomineeShare = nomineeShareMatch[1] + '%';

  // Bank account: "Primary Bank Account : SB XXXX / Bank Name"
  const bankMatch = text.match(/Primary\s*Bank\s*Account\s*:\s*(.+?)(?:\n|$)/i);
  if (bankMatch) details.bankAccount = bankMatch[1].trim();

  // Distributor: "MFD*/Intermediary : ARN-XXXX / Distributor Name"
  const distMatch = text.match(/MFD\*?\/?\s*Intermediary\s*:\s*(ARN-\d+)\s*\/\s*(.+?)(?:;|\n|$)/i);
  if (distMatch) {
    details.arn = distMatch[1].trim();
    details.distributorName = distMatch[2].trim();
  }

  // Email
  const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) details.email = emailMatch[1];

  // Mobile
  const mobileMatch = text.match(/\+?\d{10,12}/);
  if (mobileMatch) details.mobile = mobileMatch[0];

  return details;
}

function extractFundSections(text: string): FundSection[] {
  const sections: FundSection[] = [];

  const fullText = text;

  // Find fund section headers
  // In pdfjs output: "4018   /   HDFC Focused Fund   -   Regular Plan   -   Growth * -   INF 179 K 01574   UCC   :   MFHDFC 0038"
  // Pattern: CODE / FUND_NAME ... Growth/Dividend ... INF/INE (ISIN fragments) ... UCC
  const fundStarts: { index: number; code: string; name: string; isin: string }[] = [];

  // Primary pattern: "NNNN / Fund Name ... Growth|Dividend ... UCC"
  // Require the number to be followed by " / " and a fund house name to avoid false positives
  const fundHeaderPattern = /(\d{4,5})\s*\/\s*((?:HDFC|SBI|ICICI|Axis|Mirae|Kotak|Nippon|DSP|UTI|Tata|Aditya|Franklin|Motilal|Bandhan|Quant|PPFAS|Invesco|HSBC|Baroda|Canara|IDFC)\s.+?(?:Growth|Dividend|Direct|Regular)[^U]*?)UCC/gi;
  let hMatch;
  while ((hMatch = fundHeaderPattern.exec(fullText)) !== null) {
    const code = hMatch[1].trim();
    // Clean up the fund name: remove extra spaces, asterisks, ISIN fragments
    let rawName = hMatch[2].trim()
      .replace(/\s*\*\s*/g, ' ')
      .replace(/\s*-\s*INF\s+\d+\s+[A-Z]\s+\d+\s*/i, '')
      .replace(/\s*-\s*INE\s+\d+\s+[A-Z]\s+\d+\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    // Remove trailing " -" or " - "
    rawName = rawName.replace(/\s*-\s*$/, '').trim();

    // Try to extract ISIN from the surrounding text
    const around = fullText.slice(hMatch.index, hMatch.index + 300);
    const isinMatch = around.match(/INF\s*(\d{3})\s*([A-Z])\s*(\d{5})/i) ?? around.match(/INE\s*(\d{3})\s*([A-Z])\s*(\d{5})/i);
    const isin = isinMatch ? `IN${isinMatch[0].replace(/\s/g, '')}`.slice(0, 12) : '';

    fundStarts.push({ index: hMatch.index, code, name: rawName, isin });
  }

  // Fallback: look for "HDFC ... Fund ... Growth" pattern without the CODE/ prefix
  if (fundStarts.length === 0) {
    const altPattern = /(?:HDFC|SBI|ICICI|Axis|Mirae|Kotak|Nippon|DSP|UTI|Tata)\s+[\w\s]+(?:Fund)[\w\s-]*(?:Growth|Dividend|Direct|Regular)/gi;
    let am;
    while ((am = altPattern.exec(fullText)) !== null) {
      fundStarts.push({ index: am.index, code: '', name: am[0].replace(/\s+/g, ' ').trim(), isin: '' });
    }
  }

  const netPurchaseCount = (fullText.match(/Net\s+Purchase/g) || []).length;
  console.log(`[Verify Statement] Found ${fundStarts.length} fund headers, ${netPurchaseCount} "Net Purchase" in text`);
  fundStarts.forEach((f, i) => console.log(`[Verify Statement]   Fund ${i}: "${f.name.substring(0, 60)}" @pos ${f.index}`));

  for (let fi = 0; fi < fundStarts.length; fi++) {
    const start = fundStarts[fi];
    const endPos = fi + 1 < fundStarts.length ? fundStarts[fi + 1].index : fullText.length;
    const sectionText = fullText.slice(start.index, endPos);

    const section: FundSection = {
      fundCode: start.code,
      fundName: start.name,
      isin: start.isin,
      transactions: [],
      closingUnits: 0,
      closingNav: 0,
      closingValue: 0,
      sipCancelled: sectionText.includes('SIP Cancelled'),
    };

    // Parse transactions using regex on the FULL section text (not line-by-line)
    // pdfjs-dist concatenates everything with spaces, so we match patterns in the stream

    // Pattern: "DD/MM/YYYY  NAV  NetAmt  Price  Units  Balance  Net Purchase"
    // In the actual extracted text from pdfjs, it appears as:
    // "28/08/2023   150.958   4,999.75   150.9580   33.120   33.120 Net Purchase"
    // preceded by: "5,000.00 Gross SIP Purchase Instalment No - 1 Distributor/X1 0.25 Less: Stamp Duty"

    // Strategy: find all "Net Purchase" occurrences and extract numbers before each one
    const netPurchaseRegex = /(\d{2}\/\d{2}\/\d{4})\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+Net\s+Purchase/g;
    let npm;
    while ((npm = netPurchaseRegex.exec(sectionText)) !== null) {
      const date = parseDate(npm[1]);
      const nav = parseNumber(npm[2]);
      const netAmount = parseNumber(npm[3]);
      const price = parseNumber(npm[4]);
      const units = parseNumber(npm[5]);
      const balance = parseNumber(npm[6]);

      // Look backwards from this match for "Gross SIP/NFO Purchase" and "Less: Stamp Duty"
      const before = sectionText.substring(Math.max(0, npm.index - 300), npm.index);

      let grossAmount = netAmount;
      let stampDuty = 0;
      let type = 'Purchase';
      let instalment = '';
      let distributor = '';

      // Gross amount: number right before "Gross SIP/NFO Purchase"
      const grossSipBefore = before.match(/([\d,]+\.\d{2})\s+Gross\s+SIP\s+Purchase\s+Instalment\s+No\s*-\s*(\S+)\s+Distributor\/(\S+)/i);
      if (grossSipBefore) {
        grossAmount = parseNumber(grossSipBefore[1]);
        instalment = grossSipBefore[2];
        distributor = grossSipBefore[3];
        type = 'SIP';
      }

      const grossNfoBefore = before.match(/([\d,]+\.\d{2})\s+Gross\s+NFO\s+Purchase/i);
      if (grossNfoBefore) {
        grossAmount = parseNumber(grossNfoBefore[1]);
        type = 'NFO';
        const distM = before.match(/Distributor\/(\S+)/i);
        if (distM) distributor = distM[1];
      }

      const grossLumpBefore = before.match(/([\d,]+\.\d{2})\s+Gross\s+Purchase/i);
      if (grossLumpBefore && !grossSipBefore && !grossNfoBefore) {
        grossAmount = parseNumber(grossLumpBefore[1]);
        type = 'Lump Sum';
      }

      // Stamp duty
      const stampBefore = before.match(/([\d,.]+)\s+Less:\s*Stamp\s*Duty/i);
      if (stampBefore) stampDuty = parseNumber(stampBefore[1]);

      // Fallback for grossAmount: if we didn't find it, use netAmount + stampDuty or units*nav
      if (grossAmount <= 0 && netAmount > 0) grossAmount = netAmount + stampDuty;
      if (grossAmount <= 0 && units > 0 && nav > 0) grossAmount = Math.round(units * nav * 100) / 100;

      section.transactions.push({
        date, type, grossAmount, stampDuty, netAmount, nav,
        pricePerUnit: price, units, balanceUnits: balance,
        installmentNumber: instalment, distributor,
      });
    }

    console.log(`[Verify Statement] Fund "${section.fundName}": ${section.transactions.length} transactions found`);
    if (section.transactions.length > 0) {
      const first = section.transactions[0];
      console.log(`[Verify Statement]   Sample: date=${first.date} gross=${first.grossAmount} net=${first.netAmount} nav=${first.nav} units=${first.units}`);
    }

    // Also try: "DD/MM/YYYY  Net Redemption/Switch" pattern
    const redeemRegex = /(\d{2}\/\d{2}\/\d{4})\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+(?:Net\s+)?(?:Redemption|Switch\s*Out)/g;
    let rm;
    while ((rm = redeemRegex.exec(sectionText)) !== null) {
      section.transactions.push({
        date: parseDate(rm[1]), type: 'Redemption',
        grossAmount: parseNumber(rm[3]), stampDuty: 0, netAmount: parseNumber(rm[3]),
        nav: parseNumber(rm[2]), pricePerUnit: parseNumber(rm[4]),
        units: parseNumber(rm[5]), balanceUnits: parseNumber(rm[6]),
        installmentNumber: '', distributor: '',
      });
    }

    // Extract closing balance: "Market Value of Balance Units at NAV of XX.XXX on DD/MM/YYYY (INR) : XXX,XXX.XX"
    const closingMatch = sectionText.match(/Market\s*Value.*?NAV\s*of\s*([\d,.]+)\s*on\s*(\d{2}\/\d{2}\/\d{4}).*?:\s*([\d,.]+)/i);
    if (closingMatch) {
      section.closingNav = parseNumber(closingMatch[1]);
      section.closingValue = parseNumber(closingMatch[3]);
    }

    // Available units: "Available Units to Redeem : XXX.XXX"
    const unitsMatch = sectionText.match(/Available\s*Units\s*to\s*Redeem\s*:\s*([\d,.]+)/i);
    if (unitsMatch) section.closingUnits = parseNumber(unitsMatch[1]);
    else if (section.transactions.length > 0) {
      section.closingUnits = section.transactions[section.transactions.length - 1].balanceUnits;
    }

    if (section.transactions.length > 0) {
      sections.push(section);
    }
  }

  // Fallback: generic transaction parsing if no HDFC-style sections found
  if (sections.length === 0) {
    const genericTxns = extractGenericTransactions(text);
    if (genericTxns.length > 0) {
      sections.push({
        fundCode: '', fundName: extractFundNameGeneric(text), isin: '',
        transactions: genericTxns, closingUnits: 0, closingNav: 0, closingValue: 0, sipCancelled: false,
      });
    }
  }

  // ── Post-process: filter out false positives and merge duplicates ──

  // 1. Filter out sections with garbage names (contain bank/address text, no "Fund" keyword)
  const validSections = sections.filter(s => {
    const name = s.fundName.toLowerCase();
    if (name.includes('bank ltd') || name.includes('baroda') || name.includes('intermediary')) return false;
    if (name.includes('load structure') || name.includes('exit load')) return false;
    if (!name.includes('fund') && !name.includes('growth') && !name.includes('dividend')) return false;
    return true;
  });

  // 2. Merge sections with same/similar fund names
  function normalizeFundName(name: string): string {
    return name.toLowerCase().replace(/\s+/g, ' ').replace(/[*-]/g, '').replace(/regular plan/i, '').replace(/direct plan/i, '').trim();
  }

  const mergedMap = new Map<string, FundSection>();
  for (const s of validSections) {
    const key = normalizeFundName(s.fundName);
    const existing = mergedMap.get(key);
    if (existing) {
      // Merge transactions, keep max closing values
      existing.transactions.push(...s.transactions);
      if (s.closingUnits > existing.closingUnits) existing.closingUnits = s.closingUnits;
      if (s.closingNav > existing.closingNav) existing.closingNav = s.closingNav;
      if (s.closingValue > existing.closingValue) existing.closingValue = s.closingValue;
      if (s.sipCancelled) existing.sipCancelled = true;
      // Use the longer/more complete fund name
      if (s.fundName.length > existing.fundName.length) existing.fundName = s.fundName;
    } else {
      mergedMap.set(key, { ...s, transactions: [...s.transactions] });
    }
  }

  // Sort transactions within each section by date
  const merged = Array.from(mergedMap.values());
  for (const s of merged) {
    s.transactions.sort((a, b) => a.date.localeCompare(b.date));
  }

  console.log(`[Verify Statement] After merge: ${merged.length} funds, ${merged.reduce((s, f) => s + f.transactions.length, 0)} total transactions`);

  return merged;
}

// Fallback generic parser for non-HDFC statements
function extractGenericTransactions(text: string): ParsedTransaction[] {
  const txns: ParsedTransaction[] = [];
  const datePattern = /\d{1,2}[\-\/][A-Za-z]{3}[\-\/]\d{4}|\d{1,2}[\-\/]\d{1,2}[\-\/]\d{4}/g;
  const lines = text.split('\n');

  for (const line of lines) {
    const dateMatch = line.match(datePattern);
    if (!dateMatch) continue;
    const date = parseDate(dateMatch[0]);
    const nums = line.match(/[\d,]+\.\d{2,4}/g);
    if (!nums || nums.length < 2) continue;

    const descLower = line.toLowerCase();
    let type = 'Purchase';
    if (descLower.includes('sip')) type = 'SIP';
    else if (descLower.includes('redemption') || descLower.includes('redeem')) type = 'Redemption';
    else if (descLower.includes('nfo')) type = 'NFO';

    const parsedNums = nums.map(parseNumber);
    if (parsedNums.length >= 4) {
      txns.push({
        date, type,
        grossAmount: parsedNums[0], stampDuty: 0, netAmount: parsedNums[0],
        nav: parsedNums.length >= 4 && parsedNums[2] < parsedNums[0] ? parsedNums[2] : parsedNums[1],
        pricePerUnit: 0,
        units: parsedNums.length >= 4 ? parsedNums[3] : parsedNums[2],
        balanceUnits: parsedNums.length >= 5 ? parsedNums[4] : 0,
        installmentNumber: '', distributor: '',
      });
    }
  }
  return txns;
}

function extractFundNameGeneric(text: string): string {
  const m = text.match(/((?:HDFC|SBI|ICICI|Axis|Mirae|Kotak|Nippon|DSP|UTI|Tata|Aditya|Canara|IDFC|Franklin|Motilal|Bandhan|Quant|Invesco|HSBC|Baroda|PPFAS|Quantum|Groww|Navi)\s+[^\n]{10,80}(?:Growth|Dividend|Direct|Regular|Fund|Plan)[^\n]*)/i);
  return m ? m[1].trim().slice(0, 120) : '';
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const password = formData.get('password') as string ?? '';

    // User's entered transaction data
    const enteredDate = formData.get('date') as string ?? '';
    const enteredAmount = parseFloat(formData.get('amount') as string ?? '0');
    const enteredNav = parseFloat(formData.get('nav') as string ?? '0');
    const enteredUnits = parseFloat(formData.get('units') as string ?? '0');
    const enteredStampDuty = parseFloat(formData.get('stampDuty') as string ?? '0');
    const enteredFolio = formData.get('folio') as string ?? '';
    const enteredFundName = formData.get('fundName') as string ?? '';

    if (!file) {
      return NextResponse.json({ parsed: false, error: 'No file uploaded' }, { status: 400 });
    }

    const arrayBuf = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const fileSize = buffer.length;

    if (fileSize < 10 || buffer.slice(0, 5).toString('ascii') !== '%PDF-') {
      return NextResponse.json({ parsed: false, error: 'Not a valid PDF file.' });
    }

    console.log(`[Verify Statement] File: ${file.name}, size: ${fileSize}, password: ${password ? 'yes' : 'no'}`);

    // ─── PDF text extraction via standalone Node.js script ───────────────────
    // Uses pdfjs-dist in a child process to avoid Next.js webpack bundling issues
    let pdfText = '';
    const ts = Date.now();
    const inputPath = join(tmpdir(), `wv-verify-${ts}.pdf`);
    const outputPath = join(tmpdir(), `wv-verify-${ts}.txt`);
    const scriptPath = join(process.cwd(), 'src/lib/utils/pdf-extract.mjs');

    const passwordVariants = [
      password,
      password?.toUpperCase(),
      password?.toLowerCase(),
      '',
    ].filter((v, i, a) => v !== undefined && a.indexOf(v) === i);

    try {
      writeFileSync(inputPath, buffer);

      for (const pw of passwordVariants) {
        if (pdfText) break;
        try {
          const pwArg = pw ? `"${pw.replace(/"/g, '\\"')}"` : '';
          const cmd = `node "${scriptPath}" "${inputPath}" "${outputPath}" ${pwArg}`;
          const result = execSync(cmd, { timeout: 30000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
          console.log(`[Verify Statement] Script output (pw=${pw ? '***' : 'none'}): ${result.trim()}`);

          try {
            const text = readFileSync(outputPath, 'utf-8');
            if (text.length > 50) {
              pdfText = text;
              break;
            }
          } catch { /* output file not created */ }
        } catch (err) {
          const stderr = (err as { stderr?: string }).stderr ?? (err as Error).message ?? '';
          console.log(`[Verify Statement] Script failed (pw=${pw ? '***' : 'none'}): ${stderr.slice(0, 150)}`);
        }
      }
    } finally {
      try { unlinkSync(inputPath); } catch { /* ignore */ }
      try { unlinkSync(outputPath); } catch { /* ignore */ }
    }

    if (!pdfText) {
      return NextResponse.json({
        parsed: false,
        error: `Could not extract text from this PDF (${Math.round(fileSize / 1024)}KB). The password may be incorrect (usually your PAN in uppercase).`,
      });
    }

    console.log(`[Verify Statement] Extracted ${pdfText.length} chars`);
    console.log('=== RAW PDF TEXT START (first 3000 chars) ===');
    console.log(pdfText.substring(0, 3000));
    console.log('=== RAW PDF TEXT END ===');

    // Store raw text for debug response
    const rawTextPreview = pdfText.substring(0, 8000);

    // Extract all data
    const accountDetails = extractAccountDetails(pdfText);
    const fundSections = extractFundSections(pdfText);

    console.log(`[Verify Statement] Account: folio=${accountDetails.folioNumber}, pan=${accountDetails.pan}`);
    console.log(`[Verify Statement] Found ${fundSections.length} fund sections with ${fundSections.reduce((s, f) => s + f.transactions.length, 0)} total transactions`);

    // Find the fund section matching what the user is entering
    let matchedSection: FundSection | null = null;
    if (enteredFundName && fundSections.length > 0) {
      const enteredLower = enteredFundName.toLowerCase();
      matchedSection = fundSections.find(s =>
        s.fundName.toLowerCase().includes(enteredLower) ||
        enteredLower.includes(s.fundName.toLowerCase().slice(0, 20))
      ) ?? fundSections[0]; // fallback to first section
    } else if (fundSections.length === 1) {
      matchedSection = fundSections[0];
    } else if (fundSections.length > 1) {
      matchedSection = fundSections[0]; // default to first
    }

    // Match the user's entered transaction
    let matchedTxn: ParsedTransaction | null = null;
    if (matchedSection) {
      for (const txn of matchedSection.transactions) {
        if (enteredDate && datesClose(txn.date, enteredDate)) {
          if (enteredAmount > 0 && (numbersClose(txn.grossAmount, enteredAmount, 50) || numbersClose(txn.netAmount, enteredAmount, 50))) {
            matchedTxn = txn;
            break;
          }
          if (enteredUnits > 0 && numbersClose(txn.units, enteredUnits, 1)) {
            matchedTxn = txn;
            break;
          }
        }
      }
    }

    // Build comparison
    let matchedTransaction = null;
    if (matchedTxn) {
      const comparison: Record<string, ComparisonField> = {};

      if (enteredDate) {
        comparison.date = { entered: enteredDate, statement: matchedTxn.date, match: matchedTxn.date === enteredDate };
      }
      if (enteredAmount > 0) {
        const grossMatch = numbersClose(enteredAmount, matchedTxn.grossAmount, 1);
        const netMatch = numbersClose(enteredAmount, matchedTxn.netAmount, 1);
        comparison.grossAmount = {
          entered: enteredAmount, statement: matchedTxn.grossAmount,
          match: grossMatch, diff: grossMatch ? undefined : Math.round((matchedTxn.grossAmount - enteredAmount) * 100) / 100,
        };
        if (matchedTxn.stampDuty > 0) {
          comparison.stampDuty = {
            entered: enteredStampDuty || 0, statement: matchedTxn.stampDuty,
            match: numbersClose(enteredStampDuty || 0, matchedTxn.stampDuty, 0.1),
          };
          comparison.netAmount = {
            entered: enteredAmount - (enteredStampDuty || 0), statement: matchedTxn.netAmount,
            match: netMatch, diff: netMatch ? undefined : Math.round((matchedTxn.netAmount - (enteredAmount - (enteredStampDuty || 0))) * 100) / 100,
          };
        }
      }
      if (enteredNav > 0) {
        const match = numbersClose(enteredNav, matchedTxn.nav, 0.01);
        comparison.nav = {
          entered: enteredNav, statement: matchedTxn.nav,
          match, diff: match ? undefined : Math.round((matchedTxn.nav - enteredNav) * 10000) / 10000,
        };
      }
      if (enteredUnits > 0) {
        const match = numbersClose(enteredUnits, matchedTxn.units, 0.01);
        comparison.units = {
          entered: enteredUnits, statement: matchedTxn.units,
          match, diff: match ? undefined : Math.round((matchedTxn.units - enteredUnits) * 10000) / 10000,
        };
      }
      if (enteredFolio && accountDetails.folioNumber) {
        const match = accountDetails.folioNumber.includes(enteredFolio) || enteredFolio.includes(accountDetails.folioNumber.replace(/\s/g, ''));
        comparison.folio = { entered: enteredFolio, statement: accountDetails.folioNumber, match };
      }
      if (matchedTxn.balanceUnits > 0) {
        comparison.balanceUnits = { entered: 'N/A', statement: matchedTxn.balanceUnits, match: true };
      }

      matchedTransaction = { found: true, comparison };
    } else if (enteredDate || enteredAmount > 0) {
      matchedTransaction = { found: false, comparison: {} };
    }

    // Unmatched transactions
    const allTxns = matchedSection?.transactions ?? [];
    const unmatchedTransactions = matchedTxn
      ? allTxns.filter(t => t !== matchedTxn)
      : allTxns;

    // Build all fund groups with their transactions
    const safeTxn = (t: ParsedTransaction) => ({
      date: t.date,
      type: t.type,
      grossAmount: isFinite(t.grossAmount) ? t.grossAmount : 0,
      stampDuty: isFinite(t.stampDuty) ? t.stampDuty : 0,
      netAmount: isFinite(t.netAmount) ? t.netAmount : 0,
      nav: isFinite(t.nav) ? t.nav : 0,
      units: isFinite(t.units) ? t.units : 0,
      balanceUnits: isFinite(t.balanceUnits) ? t.balanceUnits : 0,
      installmentNumber: t.installmentNumber || '',
    });

    const allFundGroups = fundSections.map(s => ({
      fundName: s.fundName || 'Unknown Fund',
      fundCode: s.fundCode,
      isin: s.isin,
      isMatchedFund: s === matchedSection,
      closingUnits: s.closingUnits,
      closingNav: s.closingNav,
      closingValue: s.closingValue,
      sipCancelled: s.sipCancelled,
      transactions: s.transactions.map(safeTxn),
    }));

    const totalTxns = fundSections.reduce((s, f) => s + f.transactions.length, 0);
    console.log(`[Verify Statement] Parsed ${totalTxns} transactions across ${fundSections.length} funds`);

    return NextResponse.json({
      parsed: true,
      accountDetails,
      matchedFund: matchedSection ? {
        fundCode: matchedSection.fundCode,
        fundName: matchedSection.fundName,
        isin: matchedSection.isin,
        closingUnits: matchedSection.closingUnits,
        closingNav: matchedSection.closingNav,
        closingValue: matchedSection.closingValue,
        sipCancelled: matchedSection.sipCancelled,
      } : null,
      matchedTransaction,
      unmatchedTransactions: unmatchedTransactions.map(safeTxn),
      allFundGroups,
      totalTransactionsInStatement: totalTxns,
      totalInMatchedFund: allTxns.length,
      totalUnmatched: unmatchedTransactions.length,
      rawText: rawTextPreview,
      rawTextLength: pdfText.length,
    });
  } catch (err) {
    console.error('[Verify Statement]', err);
    return NextResponse.json({
      parsed: false,
      error: 'An unexpected error occurred while processing the statement.',
    });
  }
}
