'use client';

import { useRouter } from 'next/navigation';
import { Shield, PlusCircle, Upload, Link as LinkIcon } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';

export default function SifAddPage() {
  const router = useRouter();

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: 'rgba(27,42,74,0.08)' }}>
          <Shield className="w-5 h-5" style={{ color: '#1B2A4A' }} />
        </div>
        <div>
          <h1 className="font-display text-xl font-semibold" style={{ color: '#1A1A2E' }}>Specialized Investment Funds (SIF)</h1>
          <p className="text-xs" style={{ color: '#9CA3AF' }}>New SEBI-regulated investment category — track your SIF holdings</p>
        </div>
      </div>

      <Tabs defaultValue="manual">
        <TabsList className="mb-5 w-full" style={{ backgroundColor: '#F7F5F0', border: '1px solid #E8E5DD' }}>
          <TabsTrigger value="manual" className="flex-1 gap-1.5 text-xs data-[state=active]:bg-white">
            <PlusCircle className="w-3.5 h-3.5" />Manual Entry
          </TabsTrigger>
          <TabsTrigger value="import" className="flex-1 gap-1.5 text-xs data-[state=active]:bg-white">
            <Upload className="w-3.5 h-3.5" />Statement Import
          </TabsTrigger>
          <TabsTrigger value="sync" className="flex-1 gap-1.5 text-xs data-[state=active]:bg-white">
            <LinkIcon className="w-3.5 h-3.5" />API Fetch
          </TabsTrigger>
        </TabsList>

        <TabsContent value="manual">
          <div className="wv-card p-8 text-center">
            <Shield className="w-12 h-12 mx-auto mb-4" style={{ color: '#C9A84C' }} />
            <h3 className="text-lg font-semibold mb-2" style={{ color: '#1B2A4A' }}>SIF Support Coming Soon</h3>
            <p className="text-sm mb-4" style={{ color: '#9CA3AF' }}>
              Specialized Investment Funds (SIFs) are a new SEBI-regulated category launched in 2025.
              As SIF schemes get listed on AMFI and NAV data becomes available, full tracking support will be enabled.
            </p>
            <p className="text-xs mb-6" style={{ color: '#9CA3AF' }}>
              SIFs will support: manual entry, live NAV tracking, SIP management, portfolio analytics, and XIRR calculations — same as Mutual Funds.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Button
                onClick={() => router.push('/portfolio/mutual-funds')}
                variant="outline"
                className="text-xs"
                style={{ borderColor: '#E8E5DD', color: '#6B7280' }}>
                View Mutual Funds Instead
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="import">
          <div className="wv-card p-8 text-center">
            <Upload className="w-10 h-10 mx-auto mb-3" style={{ color: '#E8E5DD' }} />
            <p className="text-sm font-medium mb-1" style={{ color: '#1B2A4A' }}>Statement Import — Coming Soon</p>
            <p className="text-xs" style={{ color: '#9CA3AF' }}>Import SIF holdings from eCAS statements once available</p>
          </div>
        </TabsContent>

        <TabsContent value="sync">
          <div className="wv-card p-8 text-center">
            <LinkIcon className="w-10 h-10 mx-auto mb-3" style={{ color: '#E8E5DD' }} />
            <p className="text-sm font-medium mb-1" style={{ color: '#1B2A4A' }}>API Fetch — Coming Soon</p>
            <p className="text-xs" style={{ color: '#9CA3AF' }}>Automatic SIF data fetch will be available once AMFI APIs support SIF schemes</p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
