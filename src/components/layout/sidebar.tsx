'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  TrendingUp, Globe, BarChart3, Layers, Building2,
  Bitcoin, DollarSign, FileText, Landmark, Leaf,
  UserCheck, PiggyBank, Shield, Heart,
  Wallet, Gem, Building, Settings, ChevronDown,
  ChevronRight, LayoutDashboard, Activity, PieChart, ArrowLeft, Plus,
} from 'lucide-react';
import { useState } from 'react';

// ─── Nav data ──────────────────────────────────────────────────────────────────

interface NavItem {
  label: string;
  href?: string;
  icon: React.ElementType;
  addHref?: string;   // optional "+" link shown next to the item
  children?: NavItem[];
}

const navGroups: { title: string; items: NavItem[] }[] = [
  {
    title: 'EQUITY & FUNDS',
    items: [
      { label: 'Indian Stocks',  href: '/portfolio/indian-stocks',  icon: TrendingUp, addHref: '/add-assets/indian-stocks' },
      { label: 'Global Stocks',  href: '/add-assets/global-stocks', icon: Globe },
      { label: 'Mutual Funds',   href: '/portfolio/mutual-funds',   icon: BarChart3,  addHref: '/add-assets/mutual-funds' },
      { label: 'PMS',            href: '/add-assets/pms',           icon: Layers },
      { label: 'AIF',            href: '/add-assets/aif',           icon: Building2 },
    ],
  },
  {
    title: 'CRYPTO & FOREX',
    items: [
      { label: 'Crypto', href: '/add-assets/crypto', icon: Bitcoin    },
      { label: 'Forex',  href: '/add-assets/forex',  icon: DollarSign },
    ],
  },
  {
    title: 'FIXED INCOME',
    items: [
      { label: 'Bonds',          href: '/add-assets/bonds',          icon: FileText },
      { label: 'Fixed Deposits', href: '/add-assets/fixed-deposits', icon: Landmark  },
      { label: 'PPF',            href: '/add-assets/ppf',            icon: Leaf },
      { label: 'EPF / VPF',      href: '/add-assets/epf-vpf',        icon: UserCheck },
      { label: 'Gratuity',       href: '/add-assets/gratuity',       icon: PiggyBank },
      { label: 'NPS',            href: '/add-assets/nps',            icon: Shield },
    ],
  },
  {
    title: 'INSURANCE',
    items: [
      { label: 'Life & Health', href: '/add-assets/insurance', icon: Heart },
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
      { label: 'Gold & Jewelry', href: '/add-assets/gold',        icon: Gem      },
      { label: 'Real Estate',    href: '/add-assets/real-estate', icon: Building },
    ],
  },
];

// ─── Nav row ───────────────────────────────────────────────────────────────────

function NavRow({ item, depth = 0 }: { item: NavItem; depth?: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const hrefBase  = item.href?.split('?')[0] ?? '';
  const isActive  = item.href
    ? pathname === item.href || (hrefBase !== '/' && pathname.startsWith(hrefBase))
    : false;

  const paddingLeft = 16 + depth * 10;

  const rowStyle: React.CSSProperties = {
    display:         'flex',
    alignItems:      'center',
    width:           '100%',
    paddingTop:      7,
    paddingBottom:   7,
    paddingLeft,
    paddingRight:    14,
    borderLeft:      isActive ? '3px solid #C9A84C' : '3px solid transparent',
    backgroundColor: isActive ? 'rgba(201,168,76,0.10)' : 'transparent',
    color:           isActive ? '#ffffff' : 'rgba(255,255,255,0.50)',
    fontSize:        12,
    fontWeight:      isActive ? 500 : 400,
    transition:      'background-color 0.15s, color 0.15s',
    cursor:          'pointer',
    textDecoration:  'none',
    boxSizing:       'border-box',
  };

  const iconStyle: React.CSSProperties = {
    width:      16,
    height:     16,
    flexShrink: 0,
    opacity:    isActive ? 1 : 0.5,
    marginRight: 8,
    color:      isActive ? '#C9A84C' : 'currentColor',
  };

  const labelStyle: React.CSSProperties = {
    flex:           1,
    whiteSpace:     'nowrap',
    overflow:       'hidden',
    textOverflow:   'ellipsis',
    lineHeight:     1.4,
  };

  const plusStyle: React.CSSProperties = {
    width:           18,
    height:          18,
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'center',
    borderRadius:    4,
    backgroundColor: 'rgba(255,255,255,0.06)',
    color:           'rgba(255,255,255,0.35)',
    marginLeft:      'auto',
    flexShrink:      0,
    textDecoration:  'none',
    transition:      'background-color 0.15s, color 0.15s',
  };

  if (item.children) {
    const anyChildActive = item.children.some(
      (c) => c.href && (pathname === c.href || pathname.startsWith(c.href.split('?')[0]))
    );

    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          style={{
            ...rowStyle,
            borderLeft: anyChildActive ? '3px solid #C9A84C' : '3px solid transparent',
            backgroundColor: anyChildActive ? 'rgba(201,168,76,0.08)' : 'transparent',
            color: open || anyChildActive ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.50)',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = anyChildActive ? 'rgba(201,168,76,0.10)' : 'rgba(255,255,255,0.04)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = anyChildActive ? 'rgba(201,168,76,0.08)' : 'transparent'; }}
        >
          <item.icon style={{ ...iconStyle, opacity: open || anyChildActive ? 0.85 : 0.5, color: anyChildActive ? '#C9A84C' : 'currentColor' }} />
          <span style={labelStyle}>{item.label}</span>
          {open
            ? <ChevronDown  style={{ width: 11, height: 11, opacity: 0.4, flexShrink: 0 }} />
            : <ChevronRight style={{ width: 11, height: 11, opacity: 0.4, flexShrink: 0 }} />
          }
        </button>
        {open && (
          <div>
            {item.children.map((child) => (
              <NavRow key={child.label} item={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
      href={item.href!}
      style={rowStyle}
      onMouseEnter={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'rgba(255,255,255,0.04)';
          (e.currentTarget as HTMLAnchorElement).style.color = 'rgba(255,255,255,0.80)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'transparent';
          (e.currentTarget as HTMLAnchorElement).style.color = 'rgba(255,255,255,0.50)';
        }
      }}
    >
      <item.icon style={iconStyle} />
      <span style={labelStyle}>{item.label}</span>
      {item.addHref && (
        <button
          style={plusStyle}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(item.addHref!); }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(201,168,76,0.20)'; (e.currentTarget as HTMLButtonElement).style.color = '#C9A84C'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.35)'; }}
          title="Add new"
        >
          <Plus style={{ width: 10, height: 10 }} />
        </button>
      )}
    </Link>
  );
}

// ─── Sidebar ───────────────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname();

  const quickLinks = [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { href: '/prices',    icon: Activity,         label: 'Prices'    },
    { href: '/portfolio', icon: PieChart,          label: 'Portfolio' },
  ];

  return (
    <aside style={{
      width:           230,
      minWidth:        230,
      height:          '100vh',
      backgroundColor: '#1B2A4A',
      display:         'flex',
      flexDirection:   'column',
      overflowY:       'auto',
      flexShrink:      0,
    }}>

      {/* ── Logo ─────────────────────────────────────────────────────────── */}
      <div style={{
        display:      'flex',
        alignItems:   'center',
        gap:          10,
        padding:      '18px 16px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        flexShrink:   0,
      }}>
        <div style={{
          width:           30,
          height:          30,
          borderRadius:    8,
          backgroundColor: '#C9A84C',
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          flexShrink:      0,
        }}>
          <TrendingUp style={{ width: 15, height: 15, color: '#fff' }} />
        </div>
        <div>
          <p style={{ color: '#fff', fontSize: 13, fontWeight: 600, lineHeight: 1.2, fontFamily: 'var(--font-playfair, serif)' }}>WealthView</p>
          <p style={{ color: 'rgba(255,255,255,0.30)', fontSize: 10, marginTop: 2 }}>Private Wealth</p>
        </div>
      </div>

      {/* ── Quick nav pills ───────────────────────────────────────────────── */}
      <div style={{
        display:      'flex',
        gap:          6,
        padding:      '10px 10px 8px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        flexShrink:   0,
      }}>
        {quickLinks.map(({ href, icon: Icon, label }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              style={{
                flex:            1,
                display:         'flex',
                flexDirection:   'column',
                alignItems:      'center',
                justifyContent:  'center',
                gap:             4,
                paddingTop:      8,
                paddingBottom:   8,
                borderRadius:    8,
                textDecoration:  'none',
                backgroundColor: active ? 'rgba(201,168,76,0.12)' : 'rgba(255,255,255,0.04)',
                border:          active ? '1px solid rgba(201,168,76,0.30)' : '1px solid transparent',
                color:           active ? '#C9A84C' : 'rgba(255,255,255,0.38)',
                transition:      'all 0.15s',
              }}
            >
              <Icon style={{ width: 14, height: 14 }} />
              <span style={{ fontSize: 9, lineHeight: 1, textAlign: 'center' }}>{label}</span>
            </Link>
          );
        })}
      </div>

      {/* ── Asset nav groups ──────────────────────────────────────────────── */}
      <nav style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
        {navGroups.map((group) => (
          <div key={group.title}>
            {/* Section header */}
            <p style={{
              fontSize:      8,
              fontWeight:    700,
              letterSpacing: '1.5px',
              textTransform: 'uppercase',
              color:         'rgba(255,255,255,0.25)',
              padding:       '14px 16px 5px',
            }}>
              {group.title}
            </p>
            {/* Items */}
            <div>
              {group.items.map((item) => (
                <NavRow key={item.label} item={item} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* ── Bottom ────────────────────────────────────────────────────────── */}
      <div style={{
        borderTop: '1px solid rgba(255,255,255,0.07)',
        flexShrink: 0,
        paddingTop: 4,
        paddingBottom: 8,
      }}>
        <Link
          href="/settings"
          style={{
            display:         'flex',
            alignItems:      'center',
            gap:             8,
            padding:         '7px 14px',
            color:           pathname === '/settings' ? '#fff' : 'rgba(255,255,255,0.40)',
            fontSize:        12,
            textDecoration:  'none',
            borderLeft:      pathname === '/settings' ? '3px solid #C9A84C' : '3px solid transparent',
            backgroundColor: pathname === '/settings' ? 'rgba(201,168,76,0.10)' : 'transparent',
          }}
        >
          <Settings style={{ width: 15, height: 15, flexShrink: 0, opacity: 0.6 }} />
          <span>Settings</span>
        </Link>
        <Link
          href="/dashboard"
          style={{
            display:        'flex',
            alignItems:     'center',
            gap:            6,
            padding:        '6px 14px',
            color:          'rgba(255,255,255,0.28)',
            fontSize:       11,
            textDecoration: 'none',
          }}
        >
          <ArrowLeft style={{ width: 12, height: 12, flexShrink: 0 }} />
          <span>Back to Dashboard</span>
        </Link>
      </div>
    </aside>
  );
}
