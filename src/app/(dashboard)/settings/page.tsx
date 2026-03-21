'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Settings, User, Bell, Shield, Users } from 'lucide-react';

export default function SettingsPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#1B2A4A' }}>
          <Settings className="w-5 h-5" style={{ color: '#C9A84C' }} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500">Manage your account and preferences</p>
        </div>
      </div>

      <Tabs defaultValue="profile">
        <TabsList className="mb-6">
          <TabsTrigger value="profile" className="gap-2">
            <User className="w-3.5 h-3.5" />Profile
          </TabsTrigger>
          <TabsTrigger value="family" className="gap-2">
            <Users className="w-3.5 h-3.5" />Family
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="w-3.5 h-3.5" />Alerts
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-2">
            <Shield className="w-3.5 h-3.5" />Security
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card className="p-6 border-0 shadow-sm space-y-5">
            <h2 className="font-semibold text-gray-900">Profile Information</h2>
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Full Name</Label>
                <Input defaultValue="Rajesh Shah" />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input defaultValue="rajesh@shahfamily.com" type="email" />
              </div>
              <div className="space-y-1.5">
                <Label>Default Currency</Label>
                <Select defaultValue="INR">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INR">INR — Indian Rupee</SelectItem>
                    <SelectItem value="USD">USD — US Dollar</SelectItem>
                    <SelectItem value="EUR">EUR — Euro</SelectItem>
                    <SelectItem value="GBP">GBP — British Pound</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Risk Profile</Label>
                <Select defaultValue="moderate">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="conservative">Conservative</SelectItem>
                    <SelectItem value="moderate">Moderate</SelectItem>
                    <SelectItem value="aggressive">Aggressive</SelectItem>
                    <SelectItem value="very_aggressive">Very Aggressive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button style={{ backgroundColor: '#1B2A4A' }} className="text-white">
              Save Changes
            </Button>
          </Card>
        </TabsContent>

        <TabsContent value="family">
          <Card className="p-6 border-0 shadow-sm space-y-5">
            <h2 className="font-semibold text-gray-900">Family Settings</h2>
            <Separator />
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Family Name</Label>
                <Input defaultValue="Shah Family" />
              </div>
              <div className="space-y-1.5">
                <Label>Family Currency</Label>
                <Select defaultValue="INR">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INR">INR — Indian Rupee</SelectItem>
                    <SelectItem value="USD">USD — US Dollar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button style={{ backgroundColor: '#1B2A4A' }} className="text-white">
              Update Family
            </Button>
          </Card>
        </TabsContent>

        <TabsContent value="notifications">
          <Card className="p-6 border-0 shadow-sm space-y-5">
            <h2 className="font-semibold text-gray-900">Alert Preferences</h2>
            <Separator />
            <p className="text-sm text-gray-500">Configure price alerts, portfolio drift notifications, and more.</p>
            <div className="space-y-3">
              {['Portfolio drift &gt; 5%', 'SIP failure', 'FD maturity reminder', 'Insurance premium due'].map((alert) => (
                <div key={alert} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <span className="text-sm text-gray-700" dangerouslySetInnerHTML={{ __html: alert }} />
                  <Button variant="outline" size="sm">Enable</Button>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="security">
          <Card className="p-6 border-0 shadow-sm space-y-5">
            <h2 className="font-semibold text-gray-900">Security</h2>
            <Separator />
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Current Password</Label>
                <Input type="password" placeholder="••••••••" />
              </div>
              <div className="space-y-1.5">
                <Label>New Password</Label>
                <Input type="password" placeholder="••••••••" />
              </div>
              <div className="space-y-1.5">
                <Label>Confirm New Password</Label>
                <Input type="password" placeholder="••••••••" />
              </div>
            </div>
            <Button style={{ backgroundColor: '#1B2A4A' }} className="text-white">
              Update Password
            </Button>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
