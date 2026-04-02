import { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * Ensure a public.users row exists for the given auth user.
 * After a full DB reset, auth.users survives but public.users is wiped.
 * This function auto-creates the missing row so the app doesn't 404.
 *
 * Returns the user profile row (existing or newly created).
 */
export async function ensureUserProfile(
  supabase: SupabaseClient,
  authUser: User,
): Promise<{ id: string; family_id: string | null } | null> {
  const { data: existing } = await supabase
    .from('users')
    .select('id, family_id')
    .eq('id', authUser.id)
    .maybeSingle();

  if (existing) return existing;

  // Auto-create from auth metadata
  const name = authUser.user_metadata?.name
    ?? authUser.email?.split('@')[0]
    ?? 'User';

  const { data: created, error } = await supabase
    .from('users')
    .insert({
      id: authUser.id,
      email: authUser.email ?? '',
      name,
    })
    .select('id, family_id')
    .single();

  if (error) {
    console.error('[ensureUserProfile] insert failed:', error.message);
    return null;
  }

  return created;
}
