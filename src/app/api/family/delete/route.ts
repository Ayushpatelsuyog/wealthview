import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const { familyId } = await req.json();
    if (!familyId) {
      return NextResponse.json({ error: 'familyId is required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify caller is the admin/creator of this family
    const { data: family } = await supabase
      .from('families').select('id, name, created_by').eq('id', familyId).single();

    if (!family) {
      return NextResponse.json({ error: 'Family not found' }, { status: 404 });
    }

    // Get all portfolios in this family
    const { data: portfolios } = await supabase
      .from('portfolios').select('id').eq('family_id', familyId);

    if (portfolios && portfolios.length > 0) {
      const portIds = portfolios.map(p => p.id);

      // Get all holdings
      const { data: holdings } = await supabase
        .from('holdings').select('id').in('portfolio_id', portIds);

      if (holdings && holdings.length > 0) {
        const holdingIds = holdings.map(h => h.id);
        // Delete all transactions
        await supabase.from('transactions').delete().in('holding_id', holdingIds);
        // Delete all holdings
        await supabase.from('holdings').delete().in('portfolio_id', portIds);
      }

      // Delete all portfolios
      await supabase.from('portfolios').delete().eq('family_id', familyId);
    }

    // Delete manual assets
    try {
      const { data: maPorts } = await supabase
        .from('portfolios').select('id').eq('family_id', familyId);
      if (maPorts && maPorts.length > 0) {
        await supabase.from('manual_assets').delete().in('portfolio_id', maPorts.map(p => p.id));
      }
    } catch { /* table might not have data */ }

    // Delete insurance policies
    try {
      await supabase.from('insurance_policies').delete().eq('family_id', familyId);
    } catch { /* ignore */ }

    // Delete brokers
    await supabase.from('brokers').delete().eq('family_id', familyId);

    // Delete import batches
    try {
      await supabase.from('import_batches').delete().eq('family_id', familyId);
    } catch { /* ignore */ }

    // Delete family_memberships
    try {
      await supabase.from('family_memberships').delete().eq('family_id', familyId);
    } catch { /* table may not exist */ }

    // Unlink all users from this family (set family_id to null), except don't delete them
    // Only delete non-auth members (those without auth accounts)
    const { data: familyMembers } = await supabase
      .from('users').select('id').eq('family_id', familyId);

    if (familyMembers) {
      for (const member of familyMembers) {
        if (member.id === user.id) {
          // Auth user: just unlink from family
          await supabase.from('users').update({ family_id: null }).eq('id', member.id);
        } else {
          // Non-auth member: delete the user record
          await supabase.from('users').delete().eq('id', member.id);
        }
      }
    }

    // Delete the family record
    const { error: famErr } = await supabase.from('families').delete().eq('id', familyId);
    if (famErr) {
      return NextResponse.json({ error: famErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, deletedFamily: family.name });
  } catch (err) {
    console.error('[api/family/delete]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
