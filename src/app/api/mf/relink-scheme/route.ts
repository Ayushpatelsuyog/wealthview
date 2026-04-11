import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const { holdingId, newSchemeCode, newSchemeName } = await req.json();
    if (!holdingId || !newSchemeCode || !newSchemeName) {
      return NextResponse.json({ error: 'holdingId, newSchemeCode, newSchemeName required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user has access to the holding (via portfolio → family RLS)
    const { data: holding } = await supabase
      .from('holdings')
      .select('id, symbol, name, portfolio_id, asset_type')
      .eq('id', holdingId)
      .single();

    if (!holding) {
      return NextResponse.json({ error: 'Holding not found' }, { status: 404 });
    }
    if (holding.asset_type !== 'mutual_fund') {
      return NextResponse.json({ error: 'Only mutual fund holdings can be re-linked' }, { status: 400 });
    }

    const { error: updateErr } = await supabase
      .from('holdings')
      .update({
        symbol: String(newSchemeCode),
        name: String(newSchemeName),
      })
      .eq('id', holdingId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      holdingId,
      oldSymbol: holding.symbol,
      oldName: holding.name,
      newSymbol: String(newSchemeCode),
      newName: String(newSchemeName),
    });
  } catch (err) {
    console.error('[api/mf/relink-scheme]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
