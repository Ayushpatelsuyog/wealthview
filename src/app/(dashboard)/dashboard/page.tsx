import { DashboardClient } from '@/components/dashboard/DashboardClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function DashboardPage() {
  return <DashboardClient />;
}
