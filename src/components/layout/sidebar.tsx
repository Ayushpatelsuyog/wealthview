'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  TrendingUp, Globe, BarChart3, Layers, Building2,
  Bitcoin, DollarSign, FileText, Landmark, Leaf,
  UserCheck, PiggyBank, Shield, Heart, Car, Home,
  Wallet, Gem, Building, Settings, ChevronDown,
  ChevronRight, LayoutDashboard, Activity, PieChart,
} from 'lucide-react';
import { useState } from 'react';

interface NavItem {
  label: string;
  href?: string;
  icon: React.ElementType;
  badge?: string;
  children?: NavItem[];
}

const navGroups: { title: string; items: NavItem[] }[] = [
  {
    title: 'EQUITY & FUNDS',
    items: [
      { label: 'Indian Stocks',  href: '/add-assets/indian-stocks',  icon: TrendingUp, badge: '12' },
      { label: 'Global Stocks',  href: '/add-assets/global-stocks',  icon: Globe },
      { label: 'Mutual Funds',   href: '/add-assets/mutual-funds',   icon: BarChart3,  badge: '8' },
      { label: 'PMS',            href: '/add-assets/pms',            icon: Layers },
      { label: 'AIF',            href: '/add-assets/aif',            icon: Building2 },
    ],
  },
  {
    title: 'CRYPTO & FOREX',
    items: [
      { label: 'Crypto', href: '/add-assets/crypto', icon: Bitcoin, badge: '4' },
      { label: 'Forex',  href: '/add-assets/forex',  icon: DollarSign },
    ],
  },
  {
    title: 'FIXED INCOME',
    items: [
      { label: 'Bonds',         href: '/add-assets/bonds',         icon: FileText },
      { label: 'Fixed Deposits',href: '/add-assets/fixed-deposits',icon: Landmark,   badge: '3' },
      { label: 'PPF',           href: '/add-assets/ppf',           icon: Leaf },
      { label: 'EPF / VPF',     href: '/add-assets/epf-vpf',       icon: UserCheck },
      { label: 'Gratuity',      href: '/add-assets/gratuity',      icon: PiggyBank },
      { label: 'NPS',           href: '/add-assets/nps',           icon: Shield },
    ],
  },
  {
    title: 'INSURANCE',
    items: [
      {
        label: 'Life & Health', icon: Heart,
        children: [
          { label: 'Life Term',       href: '/add-assets/insurance?type=life_term',       icon: Shield },
          { label: 'Life Guaranteed', href: '/add-assets/insurance?type=life_guaranteed', icon: Shield },
          { label: 'Life ULIP',       href: '/add-assets/insurance?type=life_ulip',       icon: Shield },
          { label: 'Health',          href: '/add-assets/insurance?type=health',          icon: Heart },
          { label: 'Vehicle',         href: '/add-assets/insurance?type=vehicle',         icon: Car },
          { label: 'Property',        href: '/add-assets/insurance?type=property',        icon: Home },
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
      { label: 'Gold & Jewelry', href: '/add-assets/gold',        icon: Gem },
      { label: 'Real Estate',    href: '/add-assets/real-estate', icon: Building },
    ],
  },
];

function NavItemRow({ item, depth = 0 }: { item: NavItem; depth?: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = item.href ? pathname === item.href || pathname.startsWith(item.href.split('?')[0]) : false;

  if (item.children) {
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors text-white/55 hover:text-white/90 hover:bg-white/5"
          style={{ paddingLeft: `${12 + depth * 10}px` }}
        >
          <div className="flex items-center gap-2.5">
            <item.icon className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="font-medium">{item.label}</span>
          </div>
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        {open && (
          <div className="mt-0.5 space-y-0.5">
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
        'flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg text-xs transition-all',
        isActive
          ? 'text-white font-semibold'
          : 'text-white/55 hover:text-white/90 hover:bg-white/5'
      )}
      style={{
        paddingLeft: `${12 + depth * 10}px`,
        borderLeft: isActive ? '2px solid #C9A84C' : '2px solid transparent',
        backgroundColor: isActive ? 'rgba(201,168,76,0.1)' : undefined,
      }}
    >
      <div className="flex items-center gap-2.5">
        <item.icon className={cn('w-3.5 h-3.5 flex-shrink-0', isActive ? 'text-gold' : '')} style={{ color: isActive ? '#C9A84C' : undefined }} />
        <span>{item.label}</span>
      </div>
      {item.badge && (
        <span
          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
          style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}
        >
          {item.badge}
        </span>
      )}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="w-60 flex-shrink-0 flex flex-col h-screen overflow-y-auto"
      style={{ backgroundColor: '#1B2A4A' }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-5 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#C9A84C' }}>
          <TrendingUp className="w-4 h-4 text-white" />
        </div>
        <div>
          <p className="text-white font-display font-semibold text-sm leading-none">WealthView</p>
          <p className="text-white/35 text-[10px] mt-0.5 font-sans">Private Wealth</p>
        </div>
      </div>

      {/* Dashboard link */}
      <div className="px-3 pt-3 pb-1">
        <Link
          href="/dashboard"
          className={cn(
            'flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-all',
            pathname === '/dashboard'
              ? 'text-white font-semibold'
              : 'text-white/55 hover:text-white/90 hover:bg-white/5'
          )}
          style={{
            borderLeft: pathname === '/dashboard' ? '2px solid #C9A84C' : '2px solid transparent',
            backgroundColor: pathname === '/dashboard' ? 'rgba(201,168,76,0.1)' : undefined,
          }}
        >
          <LayoutDashboard className="w-3.5 h-3.5" style={{ color: pathname === '/dashboard' ? '#C9A84C' : undefined }} />
          <span>Dashboard</span>
        </Link>
        <Link
          href="/prices"
          className={cn(
            'flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-all',
            pathname === '/prices'
              ? 'text-white font-semibold'
              : 'text-white/55 hover:text-white/90 hover:bg-white/5'
          )}
          style={{
            borderLeft: pathname === '/prices' ? '2px solid #C9A84C' : '2px solid transparent',
            backgroundColor: pathname === '/prices' ? 'rgba(201,168,76,0.1)' : undefined,
          }}
        >
          <Activity className="w-3.5 h-3.5" style={{ color: pathname === '/prices' ? '#C9A84C' : undefined }} />
          <span>Live Prices</span>
        </Link>
        <Link
          href="/portfolio"
          className={cn(
            'flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-all',
            pathname === '/portfolio'
              ? 'text-white font-semibold'
              : 'text-white/55 hover:text-white/90 hover:bg-white/5'
          )}
          style={{
            borderLeft: pathname === '/portfolio' ? '2px solid #C9A84C' : '2px solid transparent',
            backgroundColor: pathname === '/portfolio' ? 'rgba(201,168,76,0.1)' : undefined,
          }}
        >
          <PieChart className="w-3.5 h-3.5" style={{ color: pathname === '/portfolio' ? '#C9A84C' : undefined }} />
          <span>Portfolio</span>
        </Link>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 px-3 pb-4 space-y-4 overflow-y-auto">
        {navGroups.map((group) => (
          <div key={group.title}>
            <p className="text-[9px] font-semibold tracking-widest px-3 mb-1 mt-3" style={{ color: 'rgba(255,255,255,0.25)' }}>
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

      {/* Settings */}
      <div className="px-3 py-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <Link
          href="/settings"
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors"
        >
          <Settings className="w-3.5 h-3.5" />
          <span>Settings</span>
        </Link>
      </div>
    </aside>
  );
}
