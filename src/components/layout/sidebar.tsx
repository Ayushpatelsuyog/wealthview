'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  TrendingUp,
  Globe,
  BarChart3,
  Layers,
  Building2,
  Bitcoin,
  DollarSign,
  FileText,
  Landmark,
  Leaf,
  UserCheck,
  PiggyBank,
  Shield,
  Heart,
  Car,
  Home,
  Wallet,
  Gem,
  Building,
  Settings,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useState } from 'react';

interface NavItem {
  label: string;
  href?: string;
  icon: React.ElementType;
  children?: NavItem[];
}

const navGroups: { title: string; items: NavItem[] }[] = [
  {
    title: 'EQUITY & FUNDS',
    items: [
      { label: 'Indian Stocks', href: '/add-assets/indian-stocks', icon: TrendingUp },
      { label: 'Global Stocks', href: '/add-assets/global-stocks', icon: Globe },
      { label: 'Mutual Funds', href: '/add-assets/mutual-funds', icon: BarChart3 },
      { label: 'PMS', href: '/add-assets/pms', icon: Layers },
      { label: 'AIF', href: '/add-assets/aif', icon: Building2 },
    ],
  },
  {
    title: 'CRYPTO & FOREX',
    items: [
      { label: 'Crypto', href: '/add-assets/crypto', icon: Bitcoin },
      { label: 'Forex', href: '/add-assets/forex', icon: DollarSign },
    ],
  },
  {
    title: 'FIXED INCOME',
    items: [
      { label: 'Bonds', href: '/add-assets/bonds', icon: FileText },
      { label: 'Fixed Deposits', href: '/add-assets/fixed-deposits', icon: Landmark },
      { label: 'PPF', href: '/add-assets/ppf', icon: Leaf },
      { label: 'EPF / VPF', href: '/add-assets/epf-vpf', icon: UserCheck },
      { label: 'Gratuity', href: '/add-assets/gratuity', icon: PiggyBank },
      { label: 'NPS', href: '/add-assets/nps', icon: Shield },
    ],
  },
  {
    title: 'INSURANCE',
    items: [
      {
        label: 'Life & Health',
        icon: Heart,
        children: [
          { label: 'Life Term', href: '/add-assets/insurance?type=life_term', icon: Shield },
          { label: 'Life Guaranteed', href: '/add-assets/insurance?type=life_guaranteed', icon: Shield },
          { label: 'Life ULIP', href: '/add-assets/insurance?type=life_ulip', icon: Shield },
          { label: 'Health', href: '/add-assets/insurance?type=health', icon: Heart },
          { label: 'Vehicle', href: '/add-assets/insurance?type=vehicle', icon: Car },
          { label: 'Property', href: '/add-assets/insurance?type=property', icon: Home },
        ],
      },
    ],
  },
  {
    title: 'CASH & SAVINGS',
    items: [
      { label: 'Savings Accounts', href: '/add-assets/savings-accounts', icon: Wallet },
    ],
  },
  {
    title: 'PHYSICAL ASSETS',
    items: [
      { label: 'Gold & Jewelry', href: '/add-assets/gold', icon: Gem },
      { label: 'Real Estate', href: '/add-assets/real-estate', icon: Building },
    ],
  },
];

function NavItemRow({ item, depth = 0 }: { item: NavItem; depth?: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = item.href && pathname === item.href;

  if (item.children) {
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className={cn(
            'w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md text-sm transition-colors',
            'text-white/60 hover:text-white hover:bg-white/5'
          )}
          style={{ paddingLeft: `${12 + depth * 12}px` }}
        >
          <div className="flex items-center gap-3">
            <item.icon className="w-4 h-4 flex-shrink-0" />
            <span>{item.label}</span>
          </div>
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        {open && (
          <div className="mt-0.5">
            {item.children.map((child) => (
              <NavItemRow key={child.label} item={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
      href={item.href!}
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
        isActive
          ? 'text-white font-medium'
          : 'text-white/60 hover:text-white hover:bg-white/5'
      )}
      style={{
        paddingLeft: `${12 + depth * 12}px`,
        backgroundColor: isActive ? 'rgba(201, 168, 76, 0.15)' : undefined,
      }}
    >
      <item.icon className={cn('w-4 h-4 flex-shrink-0', isActive && 'text-[#C9A84C]')} />
      <span>{item.label}</span>
      {isActive && <div className="ml-auto w-1 h-4 rounded-full bg-[#C9A84C]" />}
    </Link>
  );
}

export function Sidebar() {
  return (
    <aside
      className="w-64 flex-shrink-0 flex flex-col h-screen overflow-y-auto"
      style={{ backgroundColor: '#1B2A4A' }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: '#C9A84C' }}
        >
          <TrendingUp className="w-4 h-4 text-white" />
        </div>
        <div>
          <p className="text-white font-semibold text-sm leading-none">WealthView</p>
          <p className="text-white/40 text-xs mt-0.5">Family Wealth</p>
        </div>
      </div>

      {/* Dashboard link */}
      <div className="px-3 pt-4 pb-2">
        <Link
          href="/dashboard"
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors"
        >
          <Home className="w-4 h-4" />
          <span>Dashboard</span>
        </Link>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 px-3 pb-4 space-y-5">
        {navGroups.map((group) => (
          <div key={group.title}>
            <p className="text-[10px] font-semibold tracking-widest text-white/30 px-3 mb-1.5">
              {group.title}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavItemRow key={item.label} item={item} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom settings */}
      <div className="px-3 py-4 border-t border-white/10">
        <Link
          href="/settings"
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors"
        >
          <Settings className="w-4 h-4" />
          <span>Settings</span>
        </Link>
      </div>
    </aside>
  );
}
