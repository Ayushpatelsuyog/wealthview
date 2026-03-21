'use client';

import { Bell, Search } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

export function Header() {
  return (
    <header className="h-16 border-b border-gray-100 bg-white flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex items-center gap-3 flex-1 max-w-md">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search assets, holdings..."
            className="pl-9 h-9 bg-gray-50 border-0 text-sm focus-visible:ring-1"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button className="relative p-2 rounded-lg hover:bg-gray-50 transition-colors">
          <Bell className="w-5 h-5 text-gray-500" />
          <Badge
            className="absolute -top-0.5 -right-0.5 w-4 h-4 p-0 flex items-center justify-center text-[10px]"
            style={{ backgroundColor: '#C9A84C' }}
          >
            3
          </Badge>
        </button>

        <div className="flex items-center gap-2.5 pl-3 border-l border-gray-100">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium text-gray-800 leading-none">Rajesh Shah</p>
            <p className="text-xs text-gray-400 mt-0.5">Admin</p>
          </div>
          <Avatar className="w-8 h-8">
            <AvatarFallback
              className="text-white text-xs font-semibold"
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
