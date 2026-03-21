'use client';

import { Bell, Search } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';

export function Header() {
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
          <span
            className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 flex items-center justify-center text-[9px] font-bold text-white rounded-full"
            style={{ backgroundColor: '#C9A84C' }}
          >
            3
          </span>
        </button>

        <div className="flex items-center gap-2.5 pl-3" style={{ borderLeft: '1px solid #E8E5DD' }}>
          <div className="text-right hidden sm:block">
            <p className="text-xs font-semibold leading-none" style={{ color: '#1A1A2E' }}>Rajesh Shah</p>
            <p className="text-[10px] mt-0.5" style={{ color: '#9CA3AF' }}>Admin · Shah Family</p>
          </div>
          <Avatar className="w-7 h-7">
            <AvatarFallback
              className="text-white text-[10px] font-bold"
              style={{ backgroundColor: '#1B2A4A' }}
            >
              RS
            </AvatarFallback>
          </Avatar>
        </div>
      </div>
    </header>
  );
}
