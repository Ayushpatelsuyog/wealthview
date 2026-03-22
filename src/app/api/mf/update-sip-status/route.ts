import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function PUT(req: NextRequest) {
  const supabase = await createClient();

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { holdingId, sipIndex, status, stop_date } = body;

  if (!holdingId || sipIndex === undefined || !status) {
    return NextResponse.json({ error: 'Missing holdingId, sipIndex, or status' }, { status: 400 });
  }
  if (!['active', 'inactive'].includes(status)) {
    return NextResponse.json({ error: 'status must be active or inactive' }, { status: 400 });
  }
  if (status === 'inactive' && !stop_date) {
    return NextResponse.json({ error: 'stop_date required when status is inactive' }, { status: 400 });
  }

  // Fetch holding — RLS ensures ownership
  const { data: holding, error: fetchErr } = await supabase
    .from('holdings')
    .select('id, metadata')
    .eq('id', holdingId)
    .single();

  if (fetchErr || !holding) return NextResponse.json({ error: 'Holding not found' }, { status: 404 });

  const meta = (holding.metadata ?? {}) as Record<string, unknown>;
  const sips = Array.isArray(meta.sips) ? [...(meta.sips as Record<string, unknown>[])] : [];

  if (sipIndex < 0 || sipIndex >= sips.length) {
    return NextResponse.json({ error: 'Invalid SIP index' }, { status: 400 });
  }

  // Update the specific SIP entry
  sips[sipIndex] = {
    ...sips[sipIndex],
    status,
    stop_date: status === 'inactive' ? stop_date : null,
  };

  // Recompute sip_amount from only active SIPs
  const activeSipTotal = sips.reduce((sum, s) => {
    return s.status !== 'inactive' ? sum + Number(s.amount ?? 0) : sum;
  }, 0);

  const { error: updateErr } = await supabase
    .from('holdings')
    .update({ metadata: { ...meta, sips, sip_amount: activeSipTotal } })
    .eq('id', holdingId);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ updated: true, sips, activeSipTotal });
}
