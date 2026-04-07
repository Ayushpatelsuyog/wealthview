'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Settings, User, Bell, Shield, Users, Eye, EyeOff, Loader2, Building2, ChevronDown, ChevronUp, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  email: string;
  name: string;
  family_id: string | null;
  role: string;
  member_type?: string | null;
  pan?: string | null;
  primary_mobile?: string | null;
  primary_email?: string | null;
  date_of_birth?: string | null;
  relationship?: string | null;
  karta_name?: string | null;
  cin?: string | null;
  llpin?: string | null;
}

const MEMBER_TYPES = [
  { value: 'individual',   label: 'Individual' },
  { value: 'huf',          label: 'HUF' },
  { value: 'company',      label: 'Company' },
  { value: 'partnership',  label: 'Partnership Firm' },
  { value: 'llp',          label: 'LLP' },
  { value: 'trust',        label: 'Trust' },
  { value: 'society',      label: 'Society' },
  { value: 'aop_boi',      label: 'AOP/BOI' },
  { value: 'nri',          label: 'NRI Individual' },
  { value: 'minor',        label: 'Minor' },
];

const MEMBER_TYPE_LABEL: Record<string, string> = Object.fromEntries(MEMBER_TYPES.map(t => [t.value, t.label]));

interface FamilyRow {
  id: string;
  name: string;
  currency_default: string;
}

interface BrokerRow {
  id: string;
  name: string;
  platform_type: string;
  logo_color: string;
  metadata: Record<string, unknown> | null;
}

interface CmlFields {
  dp_id: string;
  client_id: string;
  bo_id: string;
  trading_account: string;
  first_holder: string;
  second_holder: string;
  nominee: string;
  mobile: string;
  email: string;
  bank_name: string;
  bank_last4: string;
  ifsc: string;
  address: string;
  depository: string;
}

const BLANK_CML: CmlFields = {
  dp_id: '', client_id: '', bo_id: '', trading_account: '',
  first_holder: '', second_holder: '', nominee: '',
  mobile: '', email: '', bank_name: '', bank_last4: '',
  ifsc: '', address: '', depository: 'CDSL',
};

const INDIAN_BANKS_CML = [
  'State Bank of India', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Kotak Mahindra Bank',
  'Punjab National Bank', 'Bank of Baroda', 'Canara Bank', 'Union Bank of India',
  'IndusInd Bank', 'Yes Bank', 'IDFC First Bank', 'Federal Bank', 'South Indian Bank', 'Other',
];

interface Toast {
  type: 'success' | 'error';
  message: string;
}

// ─── PAN Helpers ──────────────────────────────────────────────────────────────

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

function maskPan(pan: string): string {
  if (!pan || pan.length < 4) return pan;
  return pan.slice(0, 4) + '***' + pan.slice(-3);
}

// ─── Member Card ──────────────────────────────────────────────────────────────

function MemberCard({
  member,
  onSave,
  onDelete,
  canDelete,
}: {
  member: UserRow;
  onSave: (id: string, data: Partial<UserRow>) => Promise<void>;
  onDelete: (member: UserRow) => void;
  canDelete: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(member.name ?? '');
  const [pan, setPan] = useState(member.pan ?? '');
  const [mobile, setMobile] = useState(member.primary_mobile ?? '');
  const [email, setEmail] = useState(member.primary_email ?? '');
  const [dob, setDob] = useState(member.date_of_birth ?? '');
  const [relationship, setRelationship] = useState(member.relationship ?? '');
  const [kartaName, setKartaName] = useState(member.karta_name ?? '');
  const [cin, setCin] = useState(member.cin ?? '');
  const [llpin, setLlpin] = useState(member.llpin ?? '');
  const [panVisible, setPanVisible] = useState(false);
  const [panError, setPanError] = useState('');
  const [saving, setSaving] = useState(false);

  const memberType = member.member_type || 'individual';
  const isIndividual = memberType === 'individual' || memberType === 'nri' || memberType === 'minor';

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
    await onSave(member.id, {
      name,
      pan: pan || null,
      primary_mobile: mobile || null,
      primary_email: email || null,
      date_of_birth: dob || null,
      relationship: relationship || null,
      karta_name: kartaName || null,
      cin: cin || null,
      llpin: llpin || null,
    });
    setSaving(false);
    setEditing(false);
  }

  // ── Display mode ──
  if (!editing) {
    return (
      <div className="border rounded-lg p-4 relative" style={{ borderColor: 'var(--wv-border)' }}>
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold text-white flex-shrink-0"
            style={{ backgroundColor: '#1B2A4A' }}>
            {(name || member.email).charAt(0).toUpperCase()}
          </div>

          <div className="flex-1 min-w-0">
            {/* Name + badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold" style={{ color: 'var(--wv-text)' }}>{name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C' }}>
                {MEMBER_TYPE_LABEL[memberType] ?? 'Individual'}
              </span>
            </div>

            {/* Detail fields */}
            <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1">
              {pan && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-medium" style={{ color: 'var(--wv-text-muted)' }}>PAN:</span>
                  <span className="text-xs font-mono" style={{ color: 'var(--wv-text-secondary)' }}>{maskPan(pan)}</span>
                </div>
              )}
              {mobile && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-medium" style={{ color: 'var(--wv-text-muted)' }}>Mobile:</span>
                  <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>{mobile}</span>
                </div>
              )}
              {email && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-medium" style={{ color: 'var(--wv-text-muted)' }}>Email:</span>
                  <span className="text-xs truncate" style={{ color: 'var(--wv-text-secondary)' }}>{email}</span>
                </div>
              )}
              {isIndividual && dob && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-medium" style={{ color: 'var(--wv-text-muted)' }}>DOB:</span>
                  <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>{dob}</span>
                </div>
              )}
              {relationship && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-medium" style={{ color: 'var(--wv-text-muted)' }}>Relation:</span>
                  <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>{relationship}</span>
                </div>
              )}
              {memberType === 'huf' && kartaName && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-medium" style={{ color: 'var(--wv-text-muted)' }}>Karta:</span>
                  <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>{kartaName}</span>
                </div>
              )}
              {memberType === 'company' && cin && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-medium" style={{ color: 'var(--wv-text-muted)' }}>CIN:</span>
                  <span className="text-xs font-mono" style={{ color: 'var(--wv-text-secondary)' }}>{cin}</span>
                </div>
              )}
              {memberType === 'llp' && llpin && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-medium" style={{ color: 'var(--wv-text-muted)' }}>LLPIN:</span>
                  <span className="text-xs font-mono" style={{ color: 'var(--wv-text-secondary)' }}>{llpin}</span>
                </div>
              )}
            </div>

            {/* Action buttons — always visible */}
            <div className="mt-2.5 flex items-center gap-3">
              <button onClick={() => setEditing(true)}
                className="text-[10px] font-semibold underline-offset-2 hover:underline" style={{ color: '#C9A84C' }}>
                Edit
              </button>
              {canDelete && (
                <button onClick={() => onDelete(member)}
                  className="flex items-center gap-1 text-[10px] font-semibold underline-offset-2 hover:underline" style={{ color: '#DC2626' }}>
                  <Trash2 className="w-3 h-3" />Delete
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Edit mode ──
  return (
    <div className="border rounded-lg p-4 space-y-3" style={{ borderColor: '#C9A84C', backgroundColor: '#FDFBF5' }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold text-white"
          style={{ backgroundColor: '#1B2A4A' }}>
          {(name || member.email).charAt(0).toUpperCase()}
        </div>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
          style={{ backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C' }}>
          {MEMBER_TYPE_LABEL[memberType] ?? 'Individual'}
        </span>
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
        {isIndividual && (
          <>
            <div className="space-y-1">
              <Label className="text-xs">Date of Birth</Label>
              <Input type="date" value={dob} onChange={e => setDob(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Relationship</Label>
              <Input value={relationship} onChange={e => setRelationship(e.target.value)} className="h-8 text-sm" placeholder="e.g. Self, Spouse, Son" />
            </div>
          </>
        )}
        {memberType === 'huf' && (
          <div className="space-y-1">
            <Label className="text-xs">Karta Name</Label>
            <Input value={kartaName} onChange={e => setKartaName(e.target.value)} className="h-8 text-sm" placeholder="Full name of Karta" />
          </div>
        )}
        {memberType === 'company' && (
          <div className="space-y-1">
            <Label className="text-xs">CIN</Label>
            <Input value={cin} onChange={e => setCin(e.target.value)} className="h-8 text-sm" placeholder="Corporate Identity Number" />
          </div>
        )}
        {memberType === 'llp' && (
          <div className="space-y-1">
            <Label className="text-xs">LLPIN</Label>
            <Input value={llpin} onChange={e => setLlpin(e.target.value)} className="h-8 text-sm" placeholder="LLP Identification Number" />
          </div>
        )}
      </div>
      <div className="flex gap-2">
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
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setEditing(false)}
          className="text-xs text-gray-500"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Delete Confirmation Modal ────────────────────────────────────────────────

function DeleteMemberModal({
  member,
  holdingsCount,
  onConfirm,
  onCancel,
  deleting,
}: {
  member: UserRow;
  holdingsCount: number;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(27,42,74,0.6)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(220,38,38,0.1)' }}>
            <AlertTriangle className="w-5 h-5" style={{ color: '#DC2626' }} />
          </div>
          <div>
            <p className="text-sm font-bold" style={{ color: 'var(--wv-text)' }}>Delete {member.name}?</p>
            <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>This cannot be undone.</p>
          </div>
        </div>

        <p className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>
          This will remove all their holdings, transactions, portfolios, and data permanently.
        </p>

        {holdingsCount > 0 && (
          <div className="p-3 rounded-lg flex items-center gap-2" style={{ backgroundColor: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.15)' }}>
            <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: '#DC2626' }} />
            <p className="text-xs font-medium" style={{ color: '#DC2626' }}>
              This member has {holdingsCount} active holding{holdingsCount !== 1 ? 's' : ''}. All data will be lost.
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            onClick={onConfirm}
            disabled={deleting}
            size="sm"
            className="flex-1 text-white text-xs"
            style={{ backgroundColor: '#DC2626' }}
          >
            {deleting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Trash2 className="w-3 h-3 mr-1" />}
            Delete Permanently
          </Button>
          <Button
            onClick={onCancel}
            disabled={deleting}
            size="sm"
            variant="outline"
            className="text-xs"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

function SettingsContent() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const urlTab = searchParams.get('tab');
  const urlFamilyId = searchParams.get('family_id');

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
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberType, setNewMemberType] = useState('individual');
  const [newMemberPan, setNewMemberPan] = useState('');
  const [newMemberMobile, setNewMemberMobile] = useState('');
  const [newMemberDob, setNewMemberDob] = useState('');
  const [newMemberRelationship, setNewMemberRelationship] = useState('');
  const [newMemberKartaName, setNewMemberKartaName] = useState('');
  const [newMemberCin, setNewMemberCin] = useState('');
  const [newMemberLlpin, setNewMemberLlpin] = useState('');
  const [addingMember, setAddingMember] = useState(false);

  // Delete member
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [deleteHoldingsCount, setDeleteHoldingsCount] = useState(0);
  const [deletingMember, setDeletingMember] = useState(false);

  // Multi-Family
  const [allFamilies, setAllFamilies] = useState<{id: string; name: string; created_by: string}[]>([]);
  const [selectedFamilyTab, setSelectedFamilyTab] = useState<string>('');
  const [showCreateFamily, setShowCreateFamily] = useState(false);
  const [newFamilyName, setNewFamilyName] = useState('');
  const [creatingFamily, setCreatingFamily] = useState(false);

  // Delete family
  const [showDeleteFamily, setShowDeleteFamily] = useState(false);
  const [deletingFamily, setDeletingFamily] = useState(false);

  // Distributors/Brokers
  const [brokers, setBrokers] = useState<BrokerRow[]>([]);
  const [brokerCml, setBrokerCml] = useState<Record<string, CmlFields>>({});
  const [brokerSaving, setBrokerSaving] = useState<Record<string, boolean>>({});
  const [expandedBroker, setExpandedBroker] = useState<string | null>(null);

  // UI
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast | null>(null);
  const [defaultTab, setDefaultTab] = useState(urlTab === 'family' ? 'family' : urlTab === 'distributors' ? 'distributors' : 'profile');

  function showToast(type: 'success' | 'error', message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam) setDefaultTab(tabParam);
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);
      setAuthEmail(user.email ?? '');

      let userData: UserRow | null = null;
      try {
        const { data } = await supabase.from('users').select('*').eq('id', user.id).single();
        userData = data as UserRow | null;
      } catch { userData = null; }

      if (userData) {
        setProfileName(userData.name ?? '');
        setProfilePan(userData.pan ?? '');
        setProfileMobile(userData.primary_mobile ?? '');
        setProfileEmail(userData.primary_email ?? '');
        setFamilyId(userData.family_id ?? null);

        if (userData.family_id) {
          try {
            const { data: familyData } = await supabase.from('families').select('*').eq('id', userData.family_id).single();
            if (familyData) {
              setFamilyName((familyData as FamilyRow).name ?? '');
              setFamilyCurrency((familyData as FamilyRow).currency_default ?? 'INR');
            }
          } catch { /* ignore */ }

          try {
            const { data: membersData } = await supabase.from('users').select('*').eq('family_id', userData.family_id);
            console.log('=== MEMBERS LOADED (init) ===', {
              authUserId: user.id,
              familyId: userData.family_id,
              rawFromDb: membersData?.map((m: UserRow) => ({ id: m.id, name: m.name, email: m.email })),
              count: membersData?.length,
            });
            // Show all family members EXCEPT the auth user's own profile row
            if (membersData) {
              const visible = (membersData as UserRow[]).filter(m => m.id !== user.id);
              console.log('=== VISIBLE MEMBERS ===', visible.map(m => ({ id: m.id, name: m.name })));
              setMembers(visible);
            }
          } catch (e) { console.error('Members load error:', e); }

          try {
            const { data: brokersData } = await supabase
              .from('brokers').select('id, name, platform_type, logo_color, metadata')
              .eq('family_id', userData.family_id).eq('is_active', true).order('name');
            if (brokersData) {
              const rows = brokersData as BrokerRow[];
              setBrokers(rows);
              const cmlMap: Record<string, CmlFields> = {};
              rows.forEach(b => {
                const m = (b.metadata ?? {}) as Record<string, string>;
                cmlMap[b.id] = {
                  dp_id: m.dp_id ?? '', client_id: m.client_id ?? '', bo_id: m.bo_id ?? '',
                  trading_account: m.trading_account ?? '', first_holder: m.first_holder ?? '',
                  second_holder: m.second_holder ?? '', nominee: m.nominee ?? '',
                  mobile: m.mobile ?? '', email: m.email ?? '', bank_name: m.bank_name ?? '',
                  bank_last4: m.bank_last4 ?? '', ifsc: m.ifsc ?? '', address: m.address ?? '',
                  depository: m.depository ?? 'CDSL',
                };
              });
              setBrokerCml(cmlMap);
            }
          } catch { /* ignore */ }
        }

        const famList: {id: string; name: string; created_by: string}[] = [];
        if (userData.family_id) {
          try {
            const { data: primaryFamily } = await supabase.from('families').select('id, name, created_by').eq('id', userData.family_id).single();
            if (primaryFamily) famList.push(primaryFamily as {id: string; name: string; created_by: string});
          } catch { /* ignore */ }
        }
        try {
          const { data: membershipFamilies } = await supabase.from('family_memberships').select('family_id, role, families(id, name, created_by)').eq('auth_user_id', user.id);
          if (membershipFamilies) {
            for (const m of membershipFamilies) {
              const f = (m as Record<string, unknown>).families as {id: string; name: string; created_by: string} | null;
              if (f && !famList.find(x => x.id === f.id)) famList.push(f);
            }
          }
        } catch { /* family_memberships table may not exist yet */ }

        setAllFamilies(famList);
        if (famList.length > 0 && !selectedFamilyTab) {
          const targetFam = urlFamilyId && famList.find(f => f.id === urlFamilyId) ? urlFamilyId : famList[0].id;
          setSelectedFamilyTab(targetFam);
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
    if (upper.length > 0 && upper.length < 10) setPanError('PAN must be 10 characters');
    else if (upper.length === 10 && !PAN_REGEX.test(upper)) setPanError('Invalid PAN format (e.g. ABCDE1234F)');
    else setPanError('');
  }

  async function saveProfile() {
    if (!userId) return;
    if (profilePan && !PAN_REGEX.test(profilePan)) { setPanError('Invalid PAN format'); return; }
    setProfileSaving(true);
    const { error } = await supabase
      .from('users')
      .update({ name: profileName, pan: profilePan || null, primary_mobile: profileMobile || null, primary_email: profileEmail || null })
      .eq('id', userId);
    setProfileSaving(false);
    if (error) showToast('error', error.message);
    else showToast('success', 'Profile saved successfully');
  }

  async function saveFamily() {
    if (!familyId) return;
    setFamilySaving(true);
    const { error } = await supabase.from('families').update({ name: familyName, currency_default: familyCurrency }).eq('id', familyId);
    setFamilySaving(false);
    if (error) showToast('error', error.message);
    else showToast('success', 'Family settings saved');
  }

  async function createFamily() {
    if (!newFamilyName.trim()) return;
    setCreatingFamily(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setCreatingFamily(false); return; }

    const { data: newFamily, error } = await supabase
      .from('families').insert({ name: newFamilyName.trim(), created_by: user.id })
      .select('id, name, created_by').single();

    if (error) {
      showToast('error', error.message);
    } else if (newFamily) {
      const fam = newFamily as {id: string; name: string; created_by: string};

      try {
        await supabase.from('family_memberships').insert({ auth_user_id: user.id, family_id: fam.id, role: 'admin' });
      } catch { /* table may not exist yet */ }

      // Always link auth user to this family (for RLS access)
      await supabase.from('users').update({ family_id: fam.id, role: 'admin' }).eq('id', user.id);
      setFamilyId(fam.id);

      setAllFamilies(prev => [...prev, fam]);
      setSelectedFamilyTab(fam.id);
      setFamilyName(fam.name);
      setFamilyCurrency('INR');
      setMembers([]); // New family has no members yet
      setNewFamilyName('');
      setShowCreateFamily(false);
      showToast('success', `Family "${fam.name}" created successfully`);
    }
    setCreatingFamily(false);
  }

  async function saveMember(id: string, data: Partial<UserRow>) {
    const { error } = await supabase
      .from('users')
      .update({
        name: data.name, pan: data.pan, primary_mobile: data.primary_mobile,
        primary_email: data.primary_email, date_of_birth: data.date_of_birth,
        relationship: data.relationship, karta_name: data.karta_name,
        cin: data.cin, llpin: data.llpin,
      })
      .eq('id', id);
    if (error) showToast('error', error.message);
    else {
      // Refresh member list
      const targetFamily = selectedFamilyTab || familyId;
      if (targetFamily) {
        const { data: refreshed } = await supabase.from('users').select('*').eq('family_id', targetFamily);
        console.log('=== MEMBERS REFRESHED (saveMember) ===', refreshed?.length);
        if (refreshed) setMembers((refreshed as UserRow[]).filter(m => m.id !== userId));
      }
      showToast('success', 'Member saved');
    }
  }

  function resetAddMemberForm() {
    setNewMemberName(''); setNewMemberEmail(''); setNewMemberType('individual');
    setNewMemberPan(''); setNewMemberMobile(''); setNewMemberDob('');
    setNewMemberRelationship(''); setNewMemberKartaName('');
    setNewMemberCin(''); setNewMemberLlpin('');
  }

  async function addFamilyMember() {
    const targetFamily = selectedFamilyTab || familyId;
    if (!targetFamily || !newMemberName.trim()) return;
    if (addingMember) return;
    setAddingMember(true);
    const email = newMemberEmail.trim() || `${newMemberName.trim().toLowerCase().replace(/\s+/g, '.')}@family.local`;

    const existing = members.find(m => m.email === email || m.primary_email === email);
    if (existing) {
      showToast('error', `A member with email "${email}" already exists in this family.`);
      setAddingMember(false);
      return;
    }

    const { data: newId, error } = await supabase.rpc('add_family_member', {
      target_family_id: targetFamily,
      member_name: newMemberName.trim(),
      member_email: email,
      member_role: 'member',
    });
    if (error) {
      setAddingMember(false);
      const msg = error.message.includes('duplicate key') || error.message.includes('unique constraint')
        ? 'A member with this email already exists.'
        : error.message;
      showToast('error', msg);
      return;
    }
    if (newId) {
      // Update extra fields on the newly created member
      // Split into two updates: safe columns first, then optional columns that may not exist
      const safeFields: Record<string, unknown> = {};
      if (newMemberType !== 'individual') safeFields.member_type = newMemberType;
      if (newMemberPan) safeFields.pan = newMemberPan.toUpperCase();
      if (newMemberMobile) safeFields.primary_mobile = newMemberMobile;
      if (newMemberEmail.trim()) safeFields.primary_email = newMemberEmail.trim();

      if (Object.keys(safeFields).length > 0) {
        const { error: safeErr } = await supabase.from('users').update(safeFields).eq('id', newId);
        if (safeErr) console.warn('[addMember] safe fields update error:', safeErr.message);
      }

      // Optional columns that may not exist in the schema yet
      const optionalFields: Record<string, unknown> = {};
      if (newMemberDob) optionalFields.date_of_birth = newMemberDob;
      if (newMemberRelationship) optionalFields.relationship = newMemberRelationship;
      if (newMemberKartaName) optionalFields.karta_name = newMemberKartaName;
      if (newMemberCin) optionalFields.cin = newMemberCin;
      if (newMemberLlpin) optionalFields.llpin = newMemberLlpin;

      if (Object.keys(optionalFields).length > 0) {
        const { error: optErr } = await supabase.from('users').update(optionalFields).eq('id', newId);
        if (optErr) console.warn('[addMember] optional fields update error (columns may not exist):', optErr.message);
      }

      // Ensure auth user's family_id matches target (so RLS allows query)
      if (familyId !== targetFamily) {
        await supabase.from('users').update({ family_id: targetFamily }).eq('id', userId);
        setFamilyId(targetFamily);
      }

      // Refresh members list
      const { data: refreshed, error: refreshErr } = await supabase.from('users').select('*').eq('family_id', targetFamily);
      console.log('=== MEMBERS REFRESHED (addFamilyMember) ===', {
        count: refreshed?.length,
        authUserId: userId,
        newMemberId: newId,
        allIds: refreshed?.map((r: UserRow) => ({ id: r.id, name: r.name })),
        refreshErr,
      });
      if (refreshed) {
        const visible = (refreshed as UserRow[]).filter(m => m.id !== userId);
        console.log('=== VISIBLE AFTER ADD ===', visible.map(m => ({ id: m.id, name: m.name })));
        setMembers(visible);
      }

      resetAddMemberForm();
      setShowAddMember(false);
      showToast('success', `${newMemberName.trim()} added to the family`);
    }
    setAddingMember(false);
  }

  async function handleDeleteMemberClick(member: UserRow) {
    // Check for active holdings
    const { data: portfolios } = await supabase.from('portfolios').select('id').eq('user_id', member.id);
    let holdingsCount = 0;
    if (portfolios && portfolios.length > 0) {
      const portIds = portfolios.map(p => p.id);
      const { count } = await supabase.from('holdings').select('id', { count: 'exact', head: true }).in('portfolio_id', portIds);
      holdingsCount = count ?? 0;
    }

    setDeleteHoldingsCount(holdingsCount);
    setDeleteTarget(member);
  }

  async function confirmDeleteMember() {
    if (!deleteTarget) return;
    setDeletingMember(true);

    try {
      const res = await fetch('/api/family/delete-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: deleteTarget.id }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        showToast('error', data.error || 'Failed to delete member');
      } else {
        setMembers(prev => prev.filter(m => m.id !== deleteTarget.id));
        showToast('success', `${deleteTarget.name} has been removed`);
      }
    } catch (err) {
      showToast('error', 'Failed to delete member: ' + (err as Error).message);
    }

    setDeletingMember(false);
    setDeleteTarget(null);
  }

  async function confirmDeleteFamily() {
    const targetFam = selectedFamilyTab || familyId;
    if (!targetFam) return;
    setDeletingFamily(true);

    try {
      const res = await fetch('/api/family/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyId: targetFam }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        showToast('error', data.error || 'Failed to delete family');
      } else {
        // Remove from families list
        setAllFamilies(prev => prev.filter(f => f.id !== targetFam));
        setMembers([]);
        setBrokers([]);
        setShowDeleteFamily(false);

        // Switch to another family or show empty state
        const remaining = allFamilies.filter(f => f.id !== targetFam);
        if (remaining.length > 0) {
          setSelectedFamilyTab(remaining[0].id);
          setFamilyId(remaining[0].id);
          setFamilyName(remaining[0].name);
        } else {
          setSelectedFamilyTab('');
          setFamilyId(null);
          setFamilyName('');
        }
        showToast('success', `Family "${data.deletedFamily}" deleted`);
      }
    } catch (err) {
      showToast('error', 'Failed to delete family: ' + (err as Error).message);
    }

    setDeletingFamily(false);
  }

  async function saveBrokerCml(brokerId: string) {
    const cml = brokerCml[brokerId];
    if (!cml) return;
    setBrokerSaving(s => ({ ...s, [brokerId]: true }));
    const { error } = await supabase.from('brokers').update({ metadata: cml as unknown as Record<string, unknown> }).eq('id', brokerId);
    setBrokerSaving(s => ({ ...s, [brokerId]: false }));
    if (error) showToast('error', error.message);
    else showToast('success', 'Distributor details saved');
  }

  function updateCml(brokerId: string, field: keyof CmlFields, value: string) {
    setBrokerCml(prev => ({
      ...prev,
      [brokerId]: { ...(prev[brokerId] ?? BLANK_CML), [field]: value },
    }));
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--wv-text)' }} />
      </div>
    );
  }

  // ── No families yet: show welcome / create family prompt ──
  const noFamilies = allFamilies.length === 0 && !familyId;

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

      {/* Delete modal */}
      {deleteTarget && (
        <DeleteMemberModal
          member={deleteTarget}
          holdingsCount={deleteHoldingsCount}
          onConfirm={confirmDeleteMember}
          onCancel={() => { setDeleteTarget(null); setDeletingMember(false); }}
          deleting={deletingMember}
        />
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

      <Tabs defaultValue={noFamilies ? 'family' : defaultTab} key={noFamilies ? 'family' : defaultTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="profile" className="gap-2">
            <User className="w-3.5 h-3.5" />Profile
          </TabsTrigger>
          <TabsTrigger value="family" className="gap-2">
            <Users className="w-3.5 h-3.5" />Family
          </TabsTrigger>
          <TabsTrigger value="distributors" className="gap-2">
            <Building2 className="w-3.5 h-3.5" />Distributors
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
                  <button type="button" onClick={() => setPanVisible(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {panVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {panError && <p className="text-xs text-red-500">{panError}</p>}
              </div>
            </div>
            <Button onClick={saveProfile} disabled={profileSaving || !!panError} style={{ backgroundColor: '#1B2A4A' }} className="text-white">
              {profileSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
          </Card>
        </TabsContent>

        {/* ─── Family Tab ──────────────────────────────────────────── */}
        <TabsContent value="family">
          <div className="space-y-4">
            {/* No families prompt */}
            {noFamilies && !showCreateFamily && (
              <Card className="p-8 border-0 shadow-sm text-center space-y-4">
                <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center" style={{ backgroundColor: 'rgba(201,168,76,0.1)' }}>
                  <Users className="w-8 h-8" style={{ color: '#C9A84C' }} />
                </div>
                <div>
                  <h2 className="text-lg font-bold" style={{ color: 'var(--wv-text)' }}>No families yet</h2>
                  <p className="text-sm mt-1" style={{ color: 'var(--wv-text-muted)' }}>Create your first family to start tracking wealth.</p>
                </div>
                <Button
                  onClick={() => setShowCreateFamily(true)}
                  className="text-white"
                  style={{ backgroundColor: '#C9A84C' }}
                >
                  <Plus className="w-4 h-4 mr-2" />Create Family
                </Button>
              </Card>
            )}

            {/* Create family inline form (for no-family state or additional families) */}
            {showCreateFamily && noFamilies && (
              <Card className="p-6 border-0 shadow-sm space-y-4">
                <h2 className="font-semibold text-gray-900">Create Your Family</h2>
                <Separator />
                <div className="space-y-1.5">
                  <Label>Family Name</Label>
                  <Input
                    value={newFamilyName}
                    onChange={e => setNewFamilyName(e.target.value)}
                    placeholder="e.g. Desai Family, The Sharmas"
                    onKeyDown={e => { if (e.key === 'Enter') createFamily(); }}
                    autoFocus
                  />
                </div>
                <div className="flex gap-2">
                  <Button onClick={createFamily} disabled={creatingFamily || !newFamilyName.trim()}
                    className="text-white" style={{ backgroundColor: '#1B2A4A' }}>
                    {creatingFamily ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Create Family
                  </Button>
                  <Button variant="ghost" onClick={() => { setShowCreateFamily(false); setNewFamilyName(''); }}>Cancel</Button>
                </div>
              </Card>
            )}

            {/* Family selector (when families exist) */}
            {!noFamilies && (
              <>
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                  {allFamilies.map(f => (
                    <button key={f.id}
                      onClick={async () => {
                        setSelectedFamilyTab(f.id);
                        // Switch auth user's family_id for RLS access
                        await supabase.from('users').update({ family_id: f.id }).eq('id', userId);
                        setFamilyId(f.id);
                        const { data } = await supabase.from('users').select('*').eq('family_id', f.id);
                        console.log('=== MEMBERS LOADED (tab switch) ===', { familyId: f.id, count: data?.length, ids: data?.map((m: UserRow) => ({ id: m.id, name: m.name })) });
                        if (data) setMembers((data as UserRow[]).filter(m => m.id !== userId));
                        supabase.from('families').select('*').eq('id', f.id).single().then(({ data }) => {
                          if (data) {
                            setFamilyName((data as FamilyRow).name ?? '');
                            setFamilyCurrency((data as FamilyRow).currency_default ?? 'INR');
                            setFamilyId(f.id);
                          }
                        });
                      }}
                      className="px-4 py-2 rounded-lg text-sm font-medium transition-all border"
                      style={{
                        backgroundColor: selectedFamilyTab === f.id ? '#1B2A4A' : 'white',
                        color: selectedFamilyTab === f.id ? 'white' : '#374151',
                        borderColor: selectedFamilyTab === f.id ? '#1B2A4A' : '#E5E7EB',
                      }}>
                      {f.name}
                    </button>
                  ))}
                  {!showCreateFamily ? (
                    <button
                      onClick={() => setShowCreateFamily(true)}
                      className="px-4 py-2 rounded-lg text-sm font-medium border transition-all flex items-center gap-1.5"
                      style={{ borderColor: '#C9A84C', color: '#C9A84C' }}>
                      <Plus className="w-3.5 h-3.5" />New Family
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input value={newFamilyName} onChange={e => setNewFamilyName(e.target.value)}
                        placeholder="Family name..." className="h-9 px-3 text-sm border rounded-lg" style={{ borderColor: '#E5E7EB' }}
                        onKeyDown={e => { if (e.key === 'Enter') createFamily(); }} autoFocus />
                      <button onClick={createFamily} disabled={creatingFamily}
                        className="px-3 py-1.5 rounded-lg text-sm font-medium text-white" style={{ backgroundColor: '#1B2A4A' }}>
                        {creatingFamily ? 'Creating...' : 'Create'}
                      </button>
                      <button onClick={() => { setShowCreateFamily(false); setNewFamilyName(''); }}
                        className="text-gray-400 hover:text-gray-600 text-sm">Cancel</button>
                    </div>
                  )}
                </div>

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
                        <SelectTrigger><SelectValue /></SelectTrigger>
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
                  <div className="flex items-center gap-3">
                    <Button onClick={saveFamily} disabled={familySaving} style={{ backgroundColor: '#1B2A4A' }} className="text-white">
                      {familySaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                      Update Family
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setShowDeleteFamily(true)}
                      className="text-xs gap-1.5"
                      style={{ borderColor: 'rgba(220,38,38,0.3)', color: '#DC2626' }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />Delete Family
                    </Button>
                  </div>
                </Card>

                {/* Delete Family Confirmation */}
                {showDeleteFamily && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{ backgroundColor: 'rgba(27,42,74,0.6)', backdropFilter: 'blur(4px)' }}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(220,38,38,0.1)' }}>
                          <AlertTriangle className="w-5 h-5" style={{ color: '#DC2626' }} />
                        </div>
                        <div>
                          <p className="text-sm font-bold" style={{ color: 'var(--wv-text)' }}>Delete {familyName}?</p>
                          <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>This cannot be undone.</p>
                        </div>
                      </div>
                      <p className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>
                        This will permanently delete all members, portfolios, distributors, holdings, and transactions under this family.
                      </p>
                      <div className="flex gap-2">
                        <Button onClick={confirmDeleteFamily} disabled={deletingFamily} size="sm" className="flex-1 text-white text-xs" style={{ backgroundColor: '#DC2626' }}>
                          {deletingFamily ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Trash2 className="w-3 h-3 mr-1" />}
                          Delete Permanently
                        </Button>
                        <Button onClick={() => setShowDeleteFamily(false)} disabled={deletingFamily} size="sm" variant="outline" className="text-xs">
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                <Card className="p-6 border-0 shadow-sm space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="font-semibold text-gray-900">Family Members</h2>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {members.length} member{members.length !== 1 ? 's' : ''} in this family
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setShowAddMember(v => !v)}
                      className="text-xs gap-1.5" style={{ borderColor: '#C9A84C', color: '#C9A84C' }}>
                      <Plus className="w-3.5 h-3.5" />Add Member
                    </Button>
                  </div>
                  <Separator />

                  {/* Add Member inline form — NO role dropdown */}
                  {showAddMember && (() => {
                    const isInd = newMemberType === 'individual' || newMemberType === 'nri' || newMemberType === 'minor';
                    return (
                      <div className="border rounded-lg p-4 space-y-3" style={{ borderColor: '#C9A84C', backgroundColor: '#FDFBF5' }}>
                        <p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>New Family Member</p>
                        <div className="grid grid-cols-2 gap-3">
                          {/* Row 1: Type + Name */}
                          <div className="space-y-1">
                            <Label className="text-xs">Member Type</Label>
                            <Select value={newMemberType} onValueChange={v => { setNewMemberType(v); }}>
                              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {MEMBER_TYPES.map(t => (
                                  <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">{isInd ? 'Full Name' : 'Entity Name'} <span className="text-red-400">*</span></Label>
                            <Input value={newMemberName} onChange={e => setNewMemberName(e.target.value)}
                              placeholder={newMemberType === 'huf' ? 'e.g. Sharma HUF' : newMemberType === 'company' ? 'e.g. ABC Pvt Ltd' : 'e.g. Priya Sharma'}
                              className="h-8 text-sm" />
                          </div>

                          {/* Row 2: PAN + Mobile */}
                          <div className="space-y-1">
                            <Label className="text-xs">{newMemberType === 'huf' ? 'HUF PAN' : 'PAN'}</Label>
                            <Input value={newMemberPan} onChange={e => setNewMemberPan(e.target.value.toUpperCase().slice(0, 10))}
                              placeholder="ABCDE1234F" className="h-8 text-sm font-mono" maxLength={10} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">{newMemberType === 'huf' ? 'Karta Mobile' : 'Mobile'}</Label>
                            <Input value={newMemberMobile} onChange={e => setNewMemberMobile(e.target.value)}
                              placeholder="+91 98765 43210" className="h-8 text-sm" />
                          </div>

                          {/* Row 3: Email + DOB/Relationship */}
                          <div className="space-y-1">
                            <Label className="text-xs">{newMemberType === 'huf' ? 'Karta Email' : 'Email'}</Label>
                            <Input value={newMemberEmail} onChange={e => setNewMemberEmail(e.target.value)}
                              placeholder={isInd ? 'priya@example.com' : 'info@company.com'} className="h-8 text-sm" />
                          </div>

                          {isInd && (
                            <div className="space-y-1">
                              <Label className="text-xs">Date of Birth</Label>
                              <Input type="date" value={newMemberDob} onChange={e => setNewMemberDob(e.target.value)} className="h-8 text-sm" />
                            </div>
                          )}

                          {/* Type-specific fields */}
                          {isInd && (
                            <div className="space-y-1">
                              <Label className="text-xs">Relationship</Label>
                              <Select value={newMemberRelationship} onValueChange={setNewMemberRelationship}>
                                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select..." /></SelectTrigger>
                                <SelectContent>
                                  {['Self', 'Spouse', 'Father', 'Mother', 'Son', 'Daughter', 'Brother', 'Sister', 'Other'].map(r => (
                                    <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}

                          {newMemberType === 'huf' && (
                            <div className="space-y-1">
                              <Label className="text-xs">Karta Name</Label>
                              <Input value={newMemberKartaName} onChange={e => setNewMemberKartaName(e.target.value)}
                                placeholder="Full name of Karta" className="h-8 text-sm" />
                            </div>
                          )}

                          {newMemberType === 'company' && (
                            <div className="space-y-1">
                              <Label className="text-xs">CIN</Label>
                              <Input value={newMemberCin} onChange={e => setNewMemberCin(e.target.value)}
                                placeholder="Corporate Identity Number" className="h-8 text-sm" />
                            </div>
                          )}

                          {newMemberType === 'llp' && (
                            <div className="space-y-1">
                              <Label className="text-xs">LLPIN</Label>
                              <Input value={newMemberLlpin} onChange={e => setNewMemberLlpin(e.target.value)}
                                placeholder="LLP Identification Number" className="h-8 text-sm" />
                            </div>
                          )}

                          {newMemberType === 'nri' && (
                            <div className="space-y-1">
                              <Label className="text-xs">NRI Status</Label>
                              <Select value="" onValueChange={() => {}}>
                                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="NRO / NRE" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="NRO" className="text-xs">NRO</SelectItem>
                                  <SelectItem value="NRE" className="text-xs">NRE</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )}

                          {newMemberType === 'minor' && (
                            <>
                              <div className="space-y-1">
                                <Label className="text-xs">Guardian Name</Label>
                                <Input placeholder="Full name of guardian" className="h-8 text-sm" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Guardian Relationship</Label>
                                <Select value="" onValueChange={() => {}}>
                                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select..." /></SelectTrigger>
                                  <SelectContent>
                                    {['Father', 'Mother', 'Legal Guardian'].map(r => (
                                      <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={addFamilyMember} disabled={addingMember || !newMemberName.trim()}
                            className="text-white text-xs" style={{ backgroundColor: '#1B2A4A' }}>
                            {addingMember ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                            Save Member
                          </Button>
                          <Button size="sm" variant="ghost"
                            onClick={() => { setShowAddMember(false); resetAddMemberForm(); }}
                            className="text-xs text-gray-500">
                            Cancel
                          </Button>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="space-y-3">
                    {members.map(m => (
                      <MemberCard
                        key={m.id}
                        member={m}
                        onSave={saveMember}
                        onDelete={handleDeleteMemberClick}
                        canDelete={true}
                      />
                    ))}
                    {members.length === 0 && (
                      <p className="text-sm text-gray-400 text-center py-4">No family members yet. Click &ldquo;Add Member&rdquo; to get started.</p>
                    )}
                  </div>
                </Card>
              </>
            )}
          </div>
        </TabsContent>

        {/* ─── Distributors Tab ────────────────────────────────────── */}
        <TabsContent value="distributors">
          <div className="space-y-4">
            <Card className="p-6 border-0 shadow-sm space-y-4">
              <div>
                <h2 className="font-semibold text-gray-900">Distributor / Broker CML Details</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Store your Client Master List (CML) data per broker/distributor.
                </p>
              </div>
              <Separator />
              {brokers.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No distributors added yet. Add brokers from the Add Assets pages.</p>
              ) : (
                <div className="space-y-3">
                  {brokers.map(broker => {
                    const cml = brokerCml[broker.id] ?? BLANK_CML;
                    const isExpanded = expandedBroker === broker.id;
                    const isSaving = brokerSaving[broker.id] ?? false;
                    return (
                      <div key={broker.id} className="border rounded-xl overflow-hidden" style={{ borderColor: 'var(--wv-border)' }}>
                        <button className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                          onClick={() => setExpandedBroker(isExpanded ? null : broker.id)}>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                              style={{ backgroundColor: broker.logo_color || '#1B2A4A' }}>
                              {broker.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="text-left">
                              <p className="text-sm font-medium text-gray-900">{broker.name}</p>
                              <p className="text-xs text-gray-400 capitalize">{broker.platform_type.replace(/_/g, ' ')}</p>
                            </div>
                          </div>
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                        </button>
                        {isExpanded && (
                          <div className="px-4 pb-4 space-y-4 border-t" style={{ borderColor: '#F0EDE6' }}>
                            <div className="mt-4">
                              <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--wv-text-muted)' }}>Demat Account</p>
                              <div className="grid grid-cols-2 gap-3">
                                {[
                                  { key: 'dp_id' as keyof CmlFields, label: 'DP ID', ph: 'e.g. IN301549' },
                                  { key: 'client_id' as keyof CmlFields, label: 'Client ID / Demat No.', ph: 'e.g. 12345678' },
                                  { key: 'bo_id' as keyof CmlFields, label: 'BO ID', ph: '16-digit BO ID' },
                                  { key: 'trading_account' as keyof CmlFields, label: 'Trading Account', ph: 'Trading account no.' },
                                ].map(f => (
                                  <div key={f.key} className="space-y-1">
                                    <Label className="text-xs">{f.label}</Label>
                                    <Input value={cml[f.key]} onChange={e => updateCml(broker.id, f.key, e.target.value)} placeholder={f.ph} className="h-8 text-xs" />
                                  </div>
                                ))}
                                <div className="space-y-1">
                                  <Label className="text-xs">Depository</Label>
                                  <div className="flex gap-3 mt-1">
                                    {['CDSL', 'NSDL'].map(dep => (
                                      <label key={dep} className="flex items-center gap-1.5 cursor-pointer">
                                        <input type="radio" name={`dep_${broker.id}`} value={dep} checked={cml.depository === dep}
                                          onChange={() => updateCml(broker.id, 'depository', dep)} className="w-3.5 h-3.5" />
                                        <span className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>{dep}</span>
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--wv-text-muted)' }}>Holder Details</p>
                              <div className="grid grid-cols-2 gap-3">
                                {[
                                  { key: 'first_holder' as keyof CmlFields, label: 'First Holder', ph: 'Full name' },
                                  { key: 'second_holder' as keyof CmlFields, label: 'Second Holder', ph: 'optional' },
                                  { key: 'nominee' as keyof CmlFields, label: 'Nominee', ph: 'Full name' },
                                  { key: 'mobile' as keyof CmlFields, label: 'Mobile', ph: '9XXXXXXXXX' },
                                  { key: 'email' as keyof CmlFields, label: 'Email', ph: 'email@example.com' },
                                ].map(f => (
                                  <div key={f.key} className="space-y-1">
                                    <Label className="text-xs">{f.label}</Label>
                                    <Input value={cml[f.key]} onChange={e => updateCml(broker.id, f.key, e.target.value)} placeholder={f.ph} className="h-8 text-xs" />
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--wv-text-muted)' }}>Bank Details</p>
                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <Label className="text-xs">Bank Name</Label>
                                  <Select value={cml.bank_name || ''} onValueChange={v => updateCml(broker.id, 'bank_name', v)}>
                                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select bank" /></SelectTrigger>
                                    <SelectContent>
                                      {INDIAN_BANKS_CML.map(b => <SelectItem key={b} value={b} className="text-xs">{b}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                </div>
                                {[
                                  { key: 'bank_last4' as keyof CmlFields, label: 'Last 4 Digits', ph: '1234' },
                                  { key: 'ifsc' as keyof CmlFields, label: 'IFSC Code', ph: 'SBIN0001234' },
                                ].map(f => (
                                  <div key={f.key} className="space-y-1">
                                    <Label className="text-xs">{f.label}</Label>
                                    <Input value={cml[f.key]} onChange={e => updateCml(broker.id, f.key, e.target.value)} placeholder={f.ph} className="h-8 text-xs" />
                                  </div>
                                ))}
                                <div className="space-y-1 col-span-2">
                                  <Label className="text-xs">Correspondence Address</Label>
                                  <Input value={cml.address} onChange={e => updateCml(broker.id, 'address', e.target.value)} placeholder="Full address" className="h-8 text-xs" />
                                </div>
                              </div>
                            </div>
                            <Button onClick={() => saveBrokerCml(broker.id)} disabled={isSaving}
                              size="sm" className="text-white text-xs" style={{ backgroundColor: '#1B2A4A' }}>
                              {isSaving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                              Save CML Details
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
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
              <div className="space-y-1.5"><Label>Current Password</Label><Input type="password" placeholder="••••••••" /></div>
              <div className="space-y-1.5"><Label>New Password</Label><Input type="password" placeholder="••••••••" /></div>
              <div className="space-y-1.5"><Label>Confirm New Password</Label><Input type="password" placeholder="••••••••" /></div>
            </div>
            <Button style={{ backgroundColor: '#1B2A4A' }} className="text-white">Update Password</Button>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-6"><div className="animate-pulse h-96 rounded-xl bg-gray-100" /></div>}>
      <SettingsContent />
    </Suspense>
  );
}
