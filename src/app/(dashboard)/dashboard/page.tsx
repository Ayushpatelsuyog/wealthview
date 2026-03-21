import { NetWorthHero } from '@/components/dashboard/NetWorthHero';
import { StatCards } from '@/components/dashboard/StatCards';
import { AssetAllocationChart } from '@/components/dashboard/AssetAllocationChart';
import { FamilyMembers } from '@/components/dashboard/FamilyMembers';
import { NetWorthTimeline } from '@/components/dashboard/NetWorthTimeline';
import { BenchmarkComparison } from '@/components/dashboard/BenchmarkComparison';
import { CashFlows } from '@/components/dashboard/CashFlows';
import { ProjectionEngine } from '@/components/dashboard/ProjectionEngine';

export default function DashboardPage() {
  return (
    <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">
      {/* Net Worth Hero */}
      <NetWorthHero />

      {/* 12 Stat Cards */}
      <StatCards />

      {/* Row: Asset Allocation + Family Members */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AssetAllocationChart />
        <FamilyMembers />
      </div>

      {/* Row: Net Worth Timeline (full width) */}
      <NetWorthTimeline />

      {/* Row: Benchmark Comparison + Cash Flows */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <BenchmarkComparison />
        <CashFlows />
      </div>

      {/* Projection Engine */}
      <ProjectionEngine />
    </div>
  );
}
