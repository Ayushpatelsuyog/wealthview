'use client';

import { useEffect, useState } from 'react';
import { Bell, Search, Sun, Moon, LogOut } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';
import { useTheme } from '@/lib/hooks/use-theme';
import { useRouter } from 'next/navigation';

interface UserProfile { name: string; role: string; familyName: string | null; initials: string }

function getInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

export function Header() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const { isDark, toggle } = useTheme();
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      let { data: u } = await supabase
        .from('users')
        .select('name, role, family_id, families(name)')
        .eq('id', user.id)
        .single();

      // Auto-create users row if missing (DB reset scenario)
      if (!u) {
        const name = user.user_metadata?.name ?? user.email?.split('@')[0] ?? 'User';
        await supabase.from('users').insert({
          id: user.id,
          email: user.email ?? '',
          name,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        u = { name, role: 'member', family_id: null, families: null } as any;
      }
      if (!u) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const familyRecord = u.families as any;
      const familyName = (familyRecord && !Array.isArray(familyRecord)) ? (familyRecord.name as string) : null;
      setProfile({ name: u.name, role: u.role, familyName, initials: getInitials(u.name) });
    });
  }, []);

  const displayName  = profile?.name ?? '…';
  const displayRole  = profile ? `${profile.role.charAt(0).toUpperCase() + profile.role.slice(1)}${profile.familyName ? ' · ' + profile.familyName : ''}` : '';
  const initials     = profile?.initials ?? '?';

  return (
    <header
      className="h-14 flex items-center justify-between px-6 flex-shrink-0"
      style={{ backgroundColor: 'var(--wv-header-bg)', borderBottom: '1px solid var(--wv-border)' }}
    >
      <div className="flex items-center gap-3 flex-1 max-w-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--wv-text-muted)' }} />
          <Input
            placeholder="Search holdings, funds..."
            className="pl-8 h-8 text-xs focus-visible:ring-gold"
            style={{ backgroundColor: 'var(--wv-input-bg)', borderColor: 'var(--wv-border)', color: 'var(--wv-text)' }}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Theme toggle */}
        <button
          onClick={toggle}
          className="relative p-1.5 rounded-lg transition-colors"
          style={{ color: 'var(--wv-text-secondary)' }}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        <button className="relative p-1.5 rounded-lg transition-colors" style={{ color: 'var(--wv-text-secondary)' }}>
          <Bell className="w-4 h-4" />
        </button>

        {/* Logout button */}
        <button
          onClick={handleLogout}
          className="relative p-1.5 rounded-lg transition-colors hover:bg-red-500/10"
          style={{ color: 'var(--wv-text-secondary)' }}
          title="Logout"
        >
          <LogOut className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2.5 pl-3" style={{ borderLeft: '1px solid var(--wv-border)' }}>
          <div className="text-right hidden sm:block">
            <p className="text-xs font-semibold leading-none" style={{ color: 'var(--wv-text)' }}>{displayName}</p>
            {displayRole && <p className="text-[10px] mt-0.5" style={{ color: 'var(--wv-text-muted)' }}>{displayRole}</p>}
          </div>
          <Avatar className="w-7 h-7">
            <AvatarFallback className="text-white text-[10px] font-bold" style={{ backgroundColor: '#1B2A4A' }}>
              {initials}
            </AvatarFallback>
          </Avatar>
        </div>
      </div>
    </header>
  );
}
