import { Card } from '@/components/ui/card';
import { LucideIcon } from 'lucide-react';

interface AssetPageShellProps {
  title: string;
  description: string;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  children: React.ReactNode;
}

export function AssetPageShell({
  title,
  description,
  icon: Icon,
  iconColor,
  iconBg,
  children,
}: AssetPageShellProps) {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: iconBg }}
        >
          <Icon className="w-6 h-6" style={{ color: iconColor }} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">{title}</h1>
          <p className="text-sm text-gray-500">{description}</p>
        </div>
      </div>
      <Card className="p-6 border-0 shadow-sm">
        {children}
      </Card>
    </div>
  );
}
