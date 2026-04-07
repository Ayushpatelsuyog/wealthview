import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const { memberId } = await req.json();
    if (!memberId) {
      return NextResponse.json({ error: 'memberId is required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify caller has access to this member's family
    const { data: callerProfile } = await supabase
      .from('users').select('family_id').eq('id', user.id).single();
    const { data: targetMember } = await supabase
      .from('users').select('id, name, family_id').eq('id', memberId).single();

    if (!callerProfile || !targetMember) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }
    if (callerProfile.family_id !== targetMember.family_id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Prevent deleting yourself (the auth user)
    if (memberId === user.id) {
      return NextResponse.json({ error: 'Cannot delete your own admin account' }, { status: 400 });
    }

    // Cascade delete: transactions → holdings → portfolios → brokers → user
    const { data: portfolios } = await supabase
      .from('portfolios').select('id').eq('user_id', memberId);

    if (portfolios && portfolios.length > 0) {
      const portIds = portfolios.map(p => p.id);

      // Get holdings
      const { data: holdings } = await supabase
        .from('holdings').select('id').in('portfolio_id', portIds);

      if (holdings && holdings.length > 0) {
        const holdingIds = holdings.map(h => h.id);
        // Delete transactions
        await supabase.from('transactions').delete().in('holding_id', holdingIds);
        // Delete holdings
        await supabase.from('holdings').delete().in('portfolio_id', portIds);
      }

      // Delete portfolios
      await supabase.from('portfolios').delete().eq('user_id', memberId);
    }

    // Delete brokers belonging to this member
    if (targetMember.family_id) {
      await supabase.from('brokers').delete()
        .eq('family_id', targetMember.family_id)
        .eq('user_id', memberId);
    }

    // Delete the user record
    const { error: delErr } = await supabase.from('users').delete().eq('id', memberId);
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, deletedName: targetMember.name });
  } catch (err) {
    console.error('[api/family/delete-member]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
