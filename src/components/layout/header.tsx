'use client';

import { useEffect, useState } from 'react';
import { Bell, Search } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';

interface UserProfile { name: string; role: string; familyName: string | null; initials: string }

function getInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

export function Header() {
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data: u } = await supabase
        .from('users')
        .select('name, role, family_id, families(name)')
        .eq('id', user.id)
        .single();
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
      style={{ backgroundColor: '#FFFFFF', borderBottom: '1px solid #E8E5DD' }}
    >
      <div className="flex items-center gap-3 flex-1 max-w-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" style={{ color: '#9CA3AF' }} />
          <Input
            placeholder="Search holdings, funds..."
            className="pl-8 h-8 text-xs border-border bg-bg focus-visible:ring-gold"
            style={{ backgroundColor: '#F7F5F0', borderColor: '#E8E5DD' }}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button className="relative p-1.5 rounded-lg hover:bg-bg transition-colors">
          <Bell className="w-4 h-4" style={{ color: '#6B7280' }} />
        </button>

        <div className="flex items-center gap-2.5 pl-3" style={{ borderLeft: '1px solid #E8E5DD' }}>
          <div className="text-right hidden sm:block">
            <p className="text-xs font-semibold leading-none" style={{ color: '#1A1A2E' }}>{displayName}</p>
            {displayRole && <p className="text-[10px] mt-0.5" style={{ color: '#9CA3AF' }}>{displayRole}</p>}
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
