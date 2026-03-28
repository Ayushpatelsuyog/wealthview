'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { FamilySetupModal } from '@/components/onboarding/FamilySetupModal';
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
import { useFamilyStore } from '@/lib/stores/familyStore';

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
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const { setFamilies: setStoreFamilies, setMembers: setStoreMembers } = useFamilyStore();

  const load = useCallback(async (force = false) => {
    if (force) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);

    try {
      const url = force ? '/api/dashboard?force=1' : '/api/dashboard';
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 10_000); // 10s timeout
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(tid);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: DashboardSnapshot = await res.json();
      setSnapshot(data);
      // Sync to family store for cross-page persistence
      if (data.families?.length) {
        setStoreFamilies(data.families);
      }
      if (data.members?.length) {
        setStoreMembers(data.members.map(m => ({ id: m.id, name: m.name, role: m.role })));
      }
      // Initialize all members as selected
      if (data.members?.length) {
        setSelectedMembers(new Set(data.members.map(m => m.id)));
      }
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
    if (selectedMembers.size === allMembers.length || allMembers.length === 0) {
      return snapshot; // no filtering needed
    }
    const selected = allMembers.filter(m => selectedMembers.has(m.id));
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
  }, [snapshot, selectedMembers]);

  if (isLoading) return <DashboardSkeleton />;

  // Show onboarding modal if user has no family yet
  if (snapshot?.needsOnboarding) {
    return (
      <>
        <DashboardSkeleton />
        <FamilySetupModal onComplete={() => load(true)} />
      </>
    );
  }

  if (error) {
    return (
      <div className="p-6 flex items-center justify-center min-h-64">
        <div className="text-center">
          <p className="text-sm mb-3" style={{ color: '#6B7280' }}>{error}</p>
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
  const allMembers = snapshot?.members ?? [];

  return (
    <div className="p-6 space-y-5 max-w-screen-2xl mx-auto">
      {/* Toolbar: last updated + refresh */}
      <div className="flex items-center justify-end gap-3">
        {snap.lastUpdated && (
          <span className="text-[11px]" style={{ color: '#9CA3AF' }}>
            Last updated: {formatTime(snap.lastUpdated)}
          </span>
        )}
        <button
          onClick={() => load(true)}
          disabled={isRefreshing}
          className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg transition-opacity disabled:opacity-50"
          style={{ color: '#6B7280', backgroundColor: '#F7F5F0' }}
        >
          <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Member filter row */}
      {allMembers.length > 1 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-xs font-medium" style={{ color: '#6B7280' }}>Showing:</span>
          <button
            onClick={() => setSelectedMembers(new Set(allMembers.map(m => m.id)))}
            className="px-3 py-1 rounded-full text-[11px] font-medium transition-colors"
            style={{
              backgroundColor: selectedMembers.size === allMembers.length ? '#1B2A4A' : '#F7F5F0',
              color: selectedMembers.size === allMembers.length ? 'white' : '#6B7280',
              border: `1px solid ${selectedMembers.size === allMembers.length ? '#1B2A4A' : '#E8E5DD'}`,
            }}>
            All Family
          </button>
          {allMembers.map(m => (
            <button key={m.id}
              onClick={() => {
                const next = new Set(selectedMembers);
                if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
                setSelectedMembers(next);
              }}
              className="px-3 py-1 rounded-full text-[11px] font-medium transition-colors"
              style={{
                backgroundColor: selectedMembers.has(m.id) ? '#C9A84C' : '#F7F5F0',
                color: selectedMembers.has(m.id) ? 'white' : '#6B7280',
                border: `1px solid ${selectedMembers.has(m.id) ? '#C9A84C' : '#E8E5DD'}`,
              }}>
              {m.name}
            </button>
          ))}
        </div>
      )}

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
