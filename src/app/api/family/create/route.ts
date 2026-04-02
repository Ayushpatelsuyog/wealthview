import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ensureUserProfile } from '@/lib/supabase/ensure-user';

export async function POST(req: NextRequest) {
  try {
    const { familyName } = await req.json();
    if (!familyName?.trim()) {
      return NextResponse.json({ error: 'Family name is required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Create the family
    const { data: family, error: familyErr } = await supabase
      .from('families')
      .insert({ name: familyName.trim(), created_by: user.id, currency_default: 'INR' })
      .select('id')
      .single();

    if (familyErr || !family) {
      return NextResponse.json({ error: familyErr?.message ?? 'Could not create family' }, { status: 500 });
    }

    // Ensure user row exists (may be missing after DB reset)
    await ensureUserProfile(supabase, user);

    // Link user to the family as admin
    const { error: userErr } = await supabase
      .from('users')
      .update({ family_id: family.id, role: 'admin' })
      .eq('id', user.id);

    if (userErr) {
      return NextResponse.json({ error: userErr.message }, { status: 500 });
    }

    return NextResponse.json({ familyId: family.id });
  } catch (err) {
    console.error('[api/family/create]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
