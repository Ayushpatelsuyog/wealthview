import { NetWorthHero }        from '@/components/dashboard/NetWorthHero';
import { StatCards }            from '@/components/dashboard/StatCards';
import { AssetAllocationChart } from '@/components/dashboard/AssetAllocationChart';
import { FamilyMembers }        from '@/components/dashboard/FamilyMembers';
import { NetWorthTimeline }     from '@/components/dashboard/NetWorthTimeline';
import { BenchmarkComparison }  from '@/components/dashboard/BenchmarkComparison';
import { CashFlows }            from '@/components/dashboard/CashFlows';
import { ProjectionEngine }     from '@/components/dashboard/ProjectionEngine';
import { AICta }                from '@/components/dashboard/AICta';

export default function DashboardPage() {
  return (
    <div className="p-6 space-y-5 max-w-screen-2xl mx-auto">
      <NetWorthHero />
      <StatCards />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AssetAllocationChart />
        <FamilyMembers />
      </div>
      <NetWorthTimeline />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <BenchmarkComparison />
        <CashFlows />
      </div>
      <ProjectionEngine />
      <AICta />
    </div>
  );
}
