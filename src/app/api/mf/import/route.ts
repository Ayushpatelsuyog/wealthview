import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const PORTFOLIO_TYPE_MAP: Record<string, string> = {
  'Long-term Growth': 'personal',
  'Retirement':       'retirement',
  'Tax Saving':       'tax_saving',
  'Joint':            'joint',
  'Trading':          'trading',
};

interface ImportTransaction {
  date: string;
  type: 'buy' | 'sip' | 'sell' | 'dividend' | 'switch';
  amount: number;
  units: number;
  nav: number;
}

interface ImportFund {
  schemeName: string;
  schemeCode: number | null;
  folio: string;
  totalUnits: number;
  avgNav: number;
  transactions: ImportTransaction[];
  currentNav: number | null;
  brokerId: string | null;
  portfolioName: string;
  userId: string;       // family member to assign
}

interface ImportRequest {
  funds: ImportFund[];
  sourceFilename?: string;
  sourceType?: string;
  familyId?: string;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body: ImportRequest = await req.json();
  const { funds, sourceFilename = 'manual', sourceType = 'manual_csv' } = body;
  if (!Array.isArray(funds) || funds.length === 0) {
    return NextResponse.json({ error: 'No funds provided' }, { status: 400 });
  }

  // ── Get family_id ─────────────────────────────────────────────────────────
  const { data: profile } = await supabase
    .from('users')
    .select('family_id, name')
    .eq('id', user.id)
    .single();

  let familyId: string = body.familyId || profile?.family_id;
  if (!familyId) {
    const { data: newFamily, error: famErr } = await supabase
      .from('families')
      .insert({ name: `${profile?.name ?? 'My'} Family`, created_by: user.id })
      .select('id')
      .single();
    if (famErr) return NextResponse.json({ error: famErr.message }, { status: 500 });
    familyId = newFamily.id;
    await supabase.from('users').update({ family_id: familyId }).eq('id', user.id);
  }

  // ── Portfolio cache ────────────────────────────────────────────────────────
  const portfolioCache = new Map<string, string>(); // "userId:portfolioName" → id

  async function getOrCreatePortfolio(userId: string, portfolioName: string): Promise<string | null> {
    const cacheKey = `${userId}:${portfolioName}`;
    if (portfolioCache.has(cacheKey)) return portfolioCache.get(cacheKey)!;

    const { data: existing } = await supabase
      .from('portfolios')
      .select('id')
      .eq('family_id', familyId)
      .eq('name', portfolioName)
      .maybeSingle();

    if (existing) {
      portfolioCache.set(cacheKey, existing.id);
      return existing.id;
    }

    const pType = PORTFOLIO_TYPE_MAP[portfolioName] ?? 'personal';
    const { data: created, error } = await supabase
      .from('portfolios')
      .insert({ user_id: userId, family_id: familyId, name: portfolioName, type: pType })
      .select('id')
      .single();
    if (error) return null;
    portfolioCache.set(cacheKey, created.id);
    return created.id;
  }

  // ── Create import batch record ─────────────────────────────────────────────
  const { data: batch, error: batchErr } = await supabase
    .from('import_batches')
    .insert({
      family_id:       familyId,
      user_id:         user.id,
      source_filename: sourceFilename,
      source_type:     sourceType,
      funds_count:     funds.length,
      total_invested:  0,   // updated at end
    })
    .select('id')
    .single();
  if (batchErr || !batch) {
    return NextResponse.json({ error: batchErr?.message ?? 'Could not create import batch' }, { status: 500 });
  }
  const batchId = batch.id;

  // ── Import each fund ───────────────────────────────────────────────────────
  let imported = 0;
  let totalInvested = 0;
  let totalCurrentValue = 0;
  const importErrors: string[] = [];

  for (const fund of funds) {
    try {
      const targetUserId = fund.userId || user.id;
      const portfolioId = await getOrCreatePortfolio(targetUserId, fund.portfolioName || 'Imported Portfolio');
      if (!portfolioId) {
        importErrors.push(`${fund.schemeName}: could not create portfolio`);
        continue;
      }

      // Create holding
      const { data: holding, error: hErr } = await supabase
        .from('holdings')
        .insert({
          portfolio_id:    portfolioId,
          broker_id:       fund.brokerId ?? null,
          asset_type:      'mutual_fund',
          import_batch_id: batchId,
          symbol:          fund.schemeCode ? fund.schemeCode.toString() : fund.schemeName.slice(0, 20).replace(/\s+/g, '_'),
          name:          fund.schemeName,
          quantity:      fund.totalUnits,
          avg_buy_price: fund.avgNav,
          currency:      'INR',
          metadata: {
            folio:       fund.folio || null,
            amfi_code:   fund.schemeCode ?? null,
            current_nav: fund.currentNav ?? null,
            is_sip:      fund.transactions.some(t => t.type === 'sip'),
            import:      'cas',
          },
        })
        .select('id')
        .single();

      if (hErr || !holding) {
        importErrors.push(`${fund.schemeName}: ${hErr?.message ?? 'insert failed'}`);
        continue;
      }

      // Create all transactions
      const txnRows = fund.transactions.map(t => ({
        holding_id: holding.id,
        type:       t.type === 'buy' ? 'buy' : t.type,
        quantity:   t.units,
        price:      t.nav,
        date:       t.date,
        fees:       t.type === 'buy' || t.type === 'sip' ? parseFloat((t.amount * 0.00005).toFixed(2)) : 0,
        notes:      fund.folio ? `Folio: ${fund.folio}` : null,
      }));

      if (txnRows.length > 0) {
        const { error: tErr } = await supabase.from('transactions').insert(txnRows);
        if (tErr) importErrors.push(`${fund.schemeName} transactions: ${tErr.message}`);
      }

      // Accumulate totals
      const invested = fund.transactions
        .filter(t => t.type === 'buy' || t.type === 'sip')
        .reduce((s, t) => s + t.amount, 0);
      const currentVal = fund.currentNav ? fund.totalUnits * fund.currentNav : invested;
      totalInvested    += invested;
      totalCurrentValue += currentVal;
      imported++;
    } catch (e) {
      importErrors.push(`${fund.schemeName}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── Update batch with actual totals ───────────────────────────────────────
  await supabase
    .from('import_batches')
    .update({ funds_count: imported, total_invested: totalInvested })
    .eq('id', batchId);

  return NextResponse.json({
    batchId,
    imported,
    totalFunds: funds.length,
    totalInvested,
    totalCurrentValue,
    errors: importErrors,
  });
}
