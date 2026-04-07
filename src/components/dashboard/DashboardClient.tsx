'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { NetWorthHero }        from '@/components/dashboard/NetWorthHero';
import { StatCards }            from '@/components/dashboard/StatCards';
import { AssetAllocationChart } from '@/components/dashboard/AssetAllocationChart';
import { FamilyMembers }        from '@/components/dashboard/FamilyMembers';
import { NetWorthTimeline }     from '@/components/dashboard/NetWorthTimeline';
import { BenchmarkComparison }  from '@/components/dashboard/BenchmarkComparison';
import { CashFlows }            from '@/components/dashboard/CashFlows';
import { ProjectionEngine }     from '@/components/dashboard/ProjectionEngine';
import { AICta }                from '@/components/dashboard/AICta';
import type { DashboardSnapshot } from '@/lib/types/dashboard';
import { FamilyMemberSelector } from '@/components/shared/FamilyMemberSelector';

function SkeletonBox({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-gray-100 ${className ?? ''}`} />;
}

function DashboardSkeleton() {
  return (
    <div className="p-6 space-y-5 max-w-screen-2xl mx-auto">
      {/* Hero skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <SkeletonBox className="lg:col-span-2 h-44" />
        <div className="flex flex-col gap-4">
          <SkeletonBox className="flex-1 h-20" />
          <SkeletonBox className="flex-1 h-20" />
        </div>
      </div>
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 12 }).map((_, i) => <SkeletonBox key={i} className="h-20" />)}
      </div>
      {/* Allocation + Family */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SkeletonBox className="h-52" />
        <SkeletonBox className="h-52" />
      </div>
      {/* Timeline */}
      <SkeletonBox className="h-72" />
      {/* Benchmark + Cashflows */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SkeletonBox className="h-52" />
        <SkeletonBox className="h-52" />
      </div>
      {/* Projection */}
      <SkeletonBox className="h-80" />
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  } catch {
    return '';
  }
}

export function DashboardClient() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeMemberIds, setActiveMemberIds] = useState<string[]>([]);
  const [_activeFamilyIds, setActiveFamilyIds] = useState<string[]>([]);

  const handleSelectionChange = useCallback((memberIds: string[], familyIds: string[]) => {
    setActiveMemberIds(memberIds);
    setActiveFamilyIds(familyIds);
  }, []);

  const load = useCallback(async (force = false) => {
    if (force) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);

    try {
      // Always bypass server cache on initial load to prevent stale data
      const url = '/api/dashboard?force=1';
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 10_000); // 10s timeout
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(tid);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: DashboardSnapshot = await res.json();
      setSnapshot(data);
    } catch (e) {
      console.error('[DashboardClient]', e);
      setError('Could not load dashboard data. Please try again.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  // Build a filtered snapshot based on selected members
  const filteredSnapshot = useMemo(() => {
    if (!snapshot) return null;
    const allMembers = snapshot.members ?? [];
    if (activeMemberIds.length === 0 || activeMemberIds.length === allMembers.length) {
      return snapshot;
    }
    const selected = allMembers.filter(m => activeMemberIds.includes(m.id));
    const totalNetWorth = allMembers.reduce((s, m) => s + m.netWorth, 0);
    const selectedNetWorth = selected.reduce((s, m) => s + m.netWorth, 0);
    const ratio = totalNetWorth > 0 ? selectedNetWorth / totalNetWorth : 0;
    return {
      ...snapshot,
      netWorth: snapshot.netWorth * ratio,
      totalInvested: snapshot.totalInvested * ratio,
      totalGain: snapshot.totalGain * ratio,
      todayChange: snapshot.todayChange * ratio,
      members: selected,
    };
  }, [snapshot, activeMemberIds]);

  if (isLoading) return <DashboardSkeleton />;

  // Show welcome screen if user has no family yet — redirect to Settings
  if (snapshot?.needsOnboarding) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center" style={{ backgroundColor: '#C9A84C' }}>
            <RefreshCw className="w-8 h-8 text-white" style={{ transform: 'rotate(0deg)' }} />
          </div>
          <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--wv-text)', fontFamily: 'var(--font-playfair, serif)' }}>
            Welcome to WealthView
          </h1>
          <p className="text-sm mb-6" style={{ color: 'var(--wv-text-muted)' }}>
            Get started by creating your first family and adding members. You can then track your entire family&apos;s wealth in one place.
          </p>
          <a
            href="/settings?tab=family"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#C9A84C', color: 'var(--wv-text)' }}
          >
            Get Started
          </a>
          <p className="text-[11px] mt-4" style={{ color: 'var(--wv-text-muted)' }}>
            You can also go to Settings to create families and members.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 flex items-center justify-center min-h-64">
        <div className="text-center">
          <p className="text-sm mb-3" style={{ color: 'var(--wv-text-secondary)' }}>{error}</p>
          <button
            onClick={() => load(true)}
            className="text-xs font-semibold px-4 py-2 rounded-lg"
            style={{ backgroundColor: '#1B2A4A', color: 'white' }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const snap = filteredSnapshot ?? snapshot!;

  return (
    <div className="p-6 space-y-5 max-w-screen-2xl mx-auto">
      {/* Toolbar: last updated + refresh */}
      <div className="flex items-center justify-end gap-3">
        {snap.lastUpdated && (
          <span className="text-[11px]" style={{ color: 'var(--wv-text-muted)' }}>
            Last updated: {formatTime(snap.lastUpdated)}
          </span>
        )}
        <button
          onClick={() => load(true)}
          disabled={isRefreshing}
          className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg transition-opacity disabled:opacity-50"
          style={{ color: 'var(--wv-text-secondary)', backgroundColor: 'var(--wv-surface-2)' }}
        >
          <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <FamilyMemberSelector onSelectionChange={handleSelectionChange} />

      <NetWorthHero snapshot={snap} />
      <StatCards snapshot={snap} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AssetAllocationChart snapshot={snap} />
        <FamilyMembers snapshot={snap} />
      </div>
      <NetWorthTimeline snapshot={snap} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <BenchmarkComparison snapshot={snap} />
        <CashFlows snapshot={snap} />
      </div>
      <ProjectionEngine snapshot={snap} />
      <AICta />
    </div>
  );
}
