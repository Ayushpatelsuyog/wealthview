'use client';

import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { TrendingUp } from 'lucide-react';

const members = [
  {
    name: 'Rajesh Shah',
    initials: 'RS',
    role: 'Admin',
    netWorth: 41300000,
    change: 1.42,
    color: '#1B2A4A',
  },
  {
    name: 'Priya Shah',
    initials: 'PS',
    role: 'Member',
    netWorth: 21800000,
    change: 0.98,
    color: '#C9A84C',
  },
  {
    name: 'Arjun Shah',
    initials: 'AS',
    role: 'Member',
    netWorth: 15700000,
    change: 1.65,
    color: '#2A3F6F',
  },
  {
    name: 'Mehul Joshi',
    initials: 'MJ',
    role: 'Advisor',
    netWorth: null,
    change: null,
    color: '#6B7280',
  },
];

function formatINR(amount: number): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)} L`;
  return `₹${amount.toLocaleString('en-IN')}`;
}

export function FamilyMembers() {
  return (
    <Card className="p-5 border-0 shadow-sm bg-white">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-900">Family Members</h3>
          <p className="text-xs text-gray-500 mt-0.5">Individual wealth overview</p>
        </div>
        <button
          className="text-xs font-medium px-3 py-1.5 rounded-md transition-colors hover:opacity-90"
          style={{ backgroundColor: '#1B2A4A', color: 'white' }}
        >
          Manage
        </button>
      </div>

      <div className="space-y-3">
        {members.map((member) => (
          <div
            key={member.name}
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
          >
            <Avatar className="w-10 h-10 flex-shrink-0">
              <AvatarFallback
                className="text-white text-xs font-semibold"
                style={{ backgroundColor: member.color }}
              >
                {member.initials}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-gray-900 truncate">{member.name}</p>
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 h-4 flex-shrink-0"
                  style={{
                    borderColor: member.role === 'Admin' ? '#1B2A4A' : undefined,
                    color: member.role === 'Admin' ? '#1B2A4A' : undefined,
                  }}
                >
                  {member.role}
                </Badge>
              </div>
              {member.netWorth ? (
                <p className="text-xs text-gray-500 mt-0.5">{formatINR(member.netWorth)}</p>
              ) : (
                <p className="text-xs text-gray-400 mt-0.5">View-only access</p>
              )}
            </div>

            {member.change !== null && (
              <div className="flex items-center gap-1 text-green-600">
                <TrendingUp className="w-3 h-3" />
                <span className="text-xs font-medium">+{member.change}%</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
