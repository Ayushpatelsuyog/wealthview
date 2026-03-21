'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AssetPageShell } from '@/components/forms/AssetPageShell';
import { Building } from 'lucide-react';

export default function Page() {
  const [saved, setSaved] = useState(false);

  return (
    <AssetPageShell
      title="Real Estate"
      description="Add property details"
      icon={Building}
      iconColor="#1B2A4A"
      iconBg="#f1f5f9"
    >
      {saved ? (
        <div className="text-center py-8">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <Building className="w-6 h-6 text-green-600" />
          </div>
          <p className="font-medium text-gray-900">Asset added!</p>
          <p className="text-sm text-gray-500 mt-1">Your Real Estate holding has been saved.</p>
          <Button className="mt-4" variant="outline" onClick={() => setSaved(false)}>Add another</Button>
        </div>
      ) : (
        <form
          onSubmit={(e) => { e.preventDefault(); setSaved(true); }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Name / Symbol</Label>
              <Input placeholder="e.g. RELIANCE" required />
            </div>
            <div className="space-y-1.5">
              <Label>Quantity / Units</Label>
              <Input type="number" placeholder="0" step="0.001" required />
            </div>
            <div className="space-y-1.5">
              <Label>Buy Price / Current Value</Label>
              <Input type="number" placeholder="₹0.00" step="0.01" required />
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Input placeholder="Add any notes..." />
          </div>
          <Button
            type="submit"
            className="w-full text-white"
            style={{ backgroundColor: '#1B2A4A' }}
          >
            Save Asset
          </Button>
        </form>
      )}
    </AssetPageShell>
  );
}
