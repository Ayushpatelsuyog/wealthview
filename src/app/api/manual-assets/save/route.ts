import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const {
    id,               // optional — if provided, update existing
    asset_type,       // 'fd' | 'ppf' | 'savings_account'
    name,
    current_value,
    metadata = {},
    memberId,         // target user_id (family member)
    portfolioName = 'My Portfolio',
  } = body;

  if (!asset_type || !name || current_value == null) {
    return NextResponse.json({ error: 'asset_type, name, current_value are required' }, { status: 400 });
  }

  // Get user profile
  const { data: profile } = await supabase
    .from('users').select('id, family_id').eq('id', user.id).single();
  if (!profile?.family_id) return NextResponse.json({ error: 'No family found' }, { status: 400 });

  const targetUserId = memberId || profile.id;
  const familyId = profile.family_id;

  // Find or create portfolio
  const { data: existingPortfolio } = await supabase
    .from('portfolios').select('id')
    .eq('family_id', familyId).eq('name', portfolioName).eq('user_id', targetUserId)
    .maybeSingle();

  let portfolioId: string;
  if (existingPortfolio) {
    portfolioId = existingPortfolio.id;
  } else {
    const { data: newPortfolio, error: portErr } = await supabase
      .from('portfolios')
      .insert({ user_id: targetUserId, family_id: familyId, name: portfolioName, type: 'personal' })
      .select('id').single();
    if (portErr) return NextResponse.json({ error: portErr.message }, { status: 500 });
    portfolioId = newPortfolio.id;
  }

  if (id) {
    // Update existing manual asset
    const { error: updateErr } = await supabase
      .from('manual_assets')
      .update({
        name,
        current_value: parseFloat(current_value),
        metadata,
        last_updated: new Date().toISOString(),
      })
      .eq('id', id);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
    return NextResponse.json({ id, updated: true });
  }

  // Create new manual asset
  const { data: inserted, error: insertErr } = await supabase
    .from('manual_assets')
    .insert({
      portfolio_id: portfolioId,
      asset_type,
      name,
      current_value: parseFloat(current_value),
      metadata,
      last_updated: new Date().toISOString(),
    })
    .select('id').single();
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  return NextResponse.json({ id: inserted.id, created: true });
}
