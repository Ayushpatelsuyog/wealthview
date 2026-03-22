'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Settings, User, Bell, Shield, Users, Eye, EyeOff, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  email: string;
  name: string;
  family_id: string | null;
  role: string;
  pan?: string | null;
  primary_mobile?: string | null;
  primary_email?: string | null;
}

interface FamilyRow {
  id: string;
  name: string;
  currency_default: string;
}

interface Toast {
  type: 'success' | 'error';
  message: string;
}

// ─── PAN Helpers ──────────────────────────────────────────────────────────────

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

function maskPan(pan: string): string {
  if (!pan || pan.length < 4) return pan;
  return 'X'.repeat(pan.length - 4) + pan.slice(-4);
}

// ─── Member Card ──────────────────────────────────────────────────────────────

function MemberCard({
  member,
  onSave,
}: {
  member: UserRow;
  onSave: (id: string, data: Partial<UserRow>) => Promise<void>;
}) {
  const [name, setName] = useState(member.name ?? '');
  const [pan, setPan] = useState(member.pan ?? '');
  const [mobile, setMobile] = useState(member.primary_mobile ?? '');
  const [email, setEmail] = useState(member.primary_email ?? '');
  const [panVisible, setPanVisible] = useState(false);
  const [panError, setPanError] = useState('');
  const [saving, setSaving] = useState(false);

  function handlePanChange(val: string) {
    const upper = val.toUpperCase().slice(0, 10);
    setPan(upper);
    if (upper.length > 0 && upper.length < 10) {
      setPanError('PAN must be 10 characters');
    } else if (upper.length === 10 && !PAN_REGEX.test(upper)) {
      setPanError('Invalid PAN format (e.g. ABCDE1234F)');
    } else {
      setPanError('');
    }
  }

  async function handleSave() {
    if (pan && !PAN_REGEX.test(pan)) { setPanError('Invalid PAN format'); return; }
    setSaving(true);
    await onSave(member.id, { name, pan: pan || null, primary_mobile: mobile || null, primary_email: email || null });
    setSaving(false);
  }

  return (
    <div className="border border-gray-100 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold text-white"
          style={{ backgroundColor: '#1B2A4A' }}>
          {(name || member.email).charAt(0).toUpperCase()}
        </div>
        <span className="text-xs text-gray-400 capitalize">{member.role}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Full Name</Label>
          <Input value={name} onChange={e => setName(e.target.value)} className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Primary Email</Label>
          <Input value={email} onChange={e => setEmail(e.target.value)} className="h-8 text-sm" placeholder="optional" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Primary Mobile</Label>
          <Input value={mobile} onChange={e => setMobile(e.target.value)} className="h-8 text-sm" placeholder="+91..." />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">PAN</Label>
          <div className="relative">
            <Input
              value={panVisible ? pan : (pan ? maskPan(pan) : '')}
              onChange={e => { if (panVisible) handlePanChange(e.target.value); }}
              onFocus={() => setPanVisible(true)}
              onBlur={() => setPanVisible(false)}
              maxLength={10}
              className="h-8 text-sm pr-8 font-mono"
              placeholder="ABCDE1234F"
            />
            <button
              type="button"
              onClick={() => setPanVisible(v => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {panVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          {panError && <p className="text-xs text-red-500">{panError}</p>}
        </div>
      </div>
      <Button
        size="sm"
        onClick={handleSave}
        disabled={saving || !!panError}
        className="text-white text-xs"
        style={{ backgroundColor: '#1B2A4A' }}
      >
        {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
        Save Member
      </Button>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const supabase = createClient();

  // Auth
  const [userId, setUserId] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState('');

  // Profile
  const [profileName, setProfileName] = useState('');
  const [profilePan, setProfilePan] = useState('');
  const [profileMobile, setProfileMobile] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [panVisible, setPanVisible] = useState(false);
  const [panError, setPanError] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  // Family
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [familyName, setFamilyName] = useState('');
  const [familyCurrency, setFamilyCurrency] = useState('INR');
  const [familySaving, setFamilySaving] = useState(false);
  const [members, setMembers] = useState<UserRow[]>([]);

  // UI
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast | null>(null);

  function showToast(type: 'success' | 'error', message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);
      setAuthEmail(user.email ?? '');

      // Load current user row
      let userData: UserRow | null = null;
      try {
        const { data } = await supabase
          .from('users')
          .select('*')
          .eq('id', user.id)
          .single();
        userData = data as UserRow | null;
      } catch { userData = null; }

      if (userData) {
        setProfileName(userData.name ?? '');
        setProfilePan(userData.pan ?? '');
        setProfileMobile(userData.primary_mobile ?? '');
        setProfileEmail(userData.primary_email ?? '');
        setFamilyId(userData.family_id ?? null);

        // Load family
        if (userData.family_id) {
          try {
            const { data: familyData } = await supabase
              .from('families')
              .select('*')
              .eq('id', userData.family_id)
              .single();
            if (familyData) {
              setFamilyName((familyData as FamilyRow).name ?? '');
              setFamilyCurrency((familyData as FamilyRow).currency_default ?? 'INR');
            }
          } catch { /* ignore */ }

          // Load all family members
          try {
            const { data: membersData } = await supabase
              .from('users')
              .select('*')
              .eq('family_id', userData.family_id);
            if (membersData) setMembers(membersData as UserRow[]);
          } catch { /* ignore */ }
        }
      }
      setLoading(false);
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleProfilePanChange(val: string) {
    const upper = val.toUpperCase().slice(0, 10);
    setProfilePan(upper);
    if (upper.length > 0 && upper.length < 10) {
      setPanError('PAN must be 10 characters');
    } else if (upper.length === 10 && !PAN_REGEX.test(upper)) {
      setPanError('Invalid PAN format (e.g. ABCDE1234F)');
    } else {
      setPanError('');
    }
  }

  async function saveProfile() {
    if (!userId) return;
    if (profilePan && !PAN_REGEX.test(profilePan)) { setPanError('Invalid PAN format'); return; }
    setProfileSaving(true);
    const { error } = await supabase
      .from('users')
      .update({
        name: profileName,
        pan: profilePan || null,
        primary_mobile: profileMobile || null,
        primary_email: profileEmail || null,
      })
      .eq('id', userId);
    setProfileSaving(false);
    if (error) showToast('error', error.message);
    else showToast('success', 'Profile saved successfully');
  }

  async function saveFamily() {
    if (!familyId) return;
    setFamilySaving(true);
    const { error } = await supabase
      .from('families')
      .update({ name: familyName, currency_default: familyCurrency })
      .eq('id', familyId);
    setFamilySaving(false);
    if (error) showToast('error', error.message);
    else showToast('success', 'Family settings saved');
  }

  async function saveMember(id: string, data: Partial<UserRow>) {
    const { error } = await supabase
      .from('users')
      .update({ name: data.name, pan: data.pan, primary_mobile: data.primary_mobile, primary_email: data.primary_email })
      .eq('id', id);
    if (error) showToast('error', error.message);
    else showToast('success', 'Member saved');
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#1B2A4A' }} />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto relative">
      {/* Toast Banner */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all ${
            toast.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {toast.message}
        </div>
      )}

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

        {/* ─── Profile Tab ─────────────────────────────────────────── */}
        <TabsContent value="profile">
          <Card className="p-6 border-0 shadow-sm space-y-5">
            <h2 className="font-semibold text-gray-900">Profile Information</h2>
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Full Name</Label>
                <Input value={profileName} onChange={e => setProfileName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Email <span className="text-xs text-gray-400">(from auth, read-only)</span></Label>
                <Input value={authEmail} readOnly className="bg-gray-50 text-gray-500 cursor-not-allowed" />
              </div>
              <div className="space-y-1.5">
                <Label>Primary Mobile</Label>
                <Input value={profileMobile} onChange={e => setProfileMobile(e.target.value)} placeholder="+91 98765 43210" />
              </div>
              <div className="space-y-1.5">
                <Label>PAN</Label>
                <div className="relative">
                  <Input
                    value={panVisible ? profilePan : (profilePan ? maskPan(profilePan) : '')}
                    onChange={e => { if (panVisible) handleProfilePanChange(e.target.value); }}
                    onFocus={() => setPanVisible(true)}
                    onBlur={() => setPanVisible(false)}
                    maxLength={10}
                    className="pr-8 font-mono"
                    placeholder="ABCDE1234F"
                  />
                  <button
                    type="button"
                    onClick={() => setPanVisible(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {panVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {panError && <p className="text-xs text-red-500">{panError}</p>}
              </div>
            </div>
            <Button
              onClick={saveProfile}
              disabled={profileSaving || !!panError}
              style={{ backgroundColor: '#1B2A4A' }}
              className="text-white"
            >
              {profileSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
          </Card>
        </TabsContent>

        {/* ─── Family Tab ──────────────────────────────────────────── */}
        <TabsContent value="family">
          <div className="space-y-4">
            <Card className="p-6 border-0 shadow-sm space-y-5">
              <h2 className="font-semibold text-gray-900">Family Settings</h2>
              <Separator />
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Family Name</Label>
                  <Input value={familyName} onChange={e => setFamilyName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Default Currency</Label>
                  <Select value={familyCurrency} onValueChange={setFamilyCurrency}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="INR">INR — Indian Rupee</SelectItem>
                      <SelectItem value="USD">USD — US Dollar</SelectItem>
                      <SelectItem value="EUR">EUR — Euro</SelectItem>
                      <SelectItem value="GBP">GBP — British Pound</SelectItem>
                      <SelectItem value="SGD">SGD — Singapore Dollar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                onClick={saveFamily}
                disabled={familySaving}
                style={{ backgroundColor: '#1B2A4A' }}
                className="text-white"
              >
                {familySaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Update Family
              </Button>
            </Card>

            {members.length > 0 && (
              <Card className="p-6 border-0 shadow-sm space-y-4">
                <div>
                  <h2 className="font-semibold text-gray-900">Family Members</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{members.length} member{members.length !== 1 ? 's' : ''} in this family</p>
                </div>
                <Separator />
                <div className="space-y-3">
                  {members.map(m => (
                    <MemberCard key={m.id} member={m} onSave={saveMember} />
                  ))}
                </div>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ─── Notifications Tab ───────────────────────────────────── */}
        <TabsContent value="notifications">
          <Card className="p-6 border-0 shadow-sm space-y-5">
            <h2 className="font-semibold text-gray-900">Alert Preferences</h2>
            <Separator />
            <p className="text-sm text-gray-500">Configure price alerts, portfolio drift notifications, and more.</p>
            <div className="space-y-3">
              {['Portfolio drift > 5%', 'SIP failure', 'FD maturity reminder', 'Insurance premium due'].map((alert) => (
                <div key={alert} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <span className="text-sm text-gray-700">{alert}</span>
                  <Button variant="outline" size="sm">Enable</Button>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        {/* ─── Security Tab ────────────────────────────────────────── */}
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
