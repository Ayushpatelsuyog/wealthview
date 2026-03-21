// ============================================================
// ENUMS
// ============================================================

export type UserRole = 'admin' | 'member' | 'advisor' | 'guest';
export type RiskProfile = 'conservative' | 'moderate' | 'aggressive' | 'very_aggressive';
export type PortfolioType = 'personal' | 'joint' | 'retirement' | 'tax_saving' | 'trading';
export type AssetType = 'indian_stock' | 'global_stock' | 'mutual_fund' | 'crypto' | 'forex' | 'commodity' | 'bond' | 'pms' | 'aif';
export type ManualAssetType = 'real_estate' | 'fd' | 'ppf' | 'epf' | 'gratuity' | 'nps' | 'gold' | 'savings_account';
export type InsuranceCategory = 'life_term' | 'life_guaranteed' | 'life_ulip' | 'health' | 'vehicle' | 'property';
export type TransactionType = 'buy' | 'sell' | 'dividend' | 'sip' | 'switch';
export type AdvisoryStatus = 'pending' | 'accepted' | 'rejected';
export type PremiumFrequency = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly' | 'single';

// ============================================================
// DATABASE MODELS
// ============================================================

export interface Family {
  id: string;
  name: string;
  created_by: string;
  currency_default: string;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  family_id: string | null;
  role: UserRole;
  risk_profile: RiskProfile | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Portfolio {
  id: string;
  user_id: string;
  family_id: string;
  name: string;
  type: PortfolioType;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Broker {
  id: string;
  family_id: string;
  name: string;
  platform_type: string;
  logo_color: string;
  is_active: boolean;
  created_at: string;
}

export interface Holding {
  id: string;
  portfolio_id: string;
  broker_id: string | null;
  asset_type: AssetType;
  symbol: string;
  name: string;
  quantity: number;
  avg_buy_price: number;
  currency: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  holding_id: string;
  type: TransactionType;
  quantity: number;
  price: number;
  date: string;
  fees: number;
  notes: string | null;
  created_at: string;
}

export interface ManualAsset {
  id: string;
  portfolio_id: string;
  asset_type: ManualAssetType;
  name: string;
  current_value: number;
  metadata: Record<string, unknown>;
  last_updated: string;
  created_at: string;
  updated_at: string;
}

export interface InsurancePolicy {
  id: string;
  user_id: string;
  family_id: string;
  category: InsuranceCategory;
  provider: string;
  policy_name: string;
  policy_number: string | null;
  sum_assured: number;
  premium: number;
  premium_frequency: PremiumFrequency;
  start_date: string;
  maturity_date: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PriceCache {
  symbol: string;
  price: number;
  currency: string;
  source: string | null;
  fetched_at: string;
  ttl_seconds: number;
}

export interface PriceHistory {
  symbol: string;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

export interface Benchmark {
  id: string;
  name: string;
  symbol: string;
  type: string;
}

export interface AdvisoryLog {
  id: string;
  family_id: string;
  user_id: string;
  recommendation: string;
  status: AdvisoryStatus;
  advisor_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Alert {
  id: string;
  user_id: string;
  type: string;
  condition: string;
  threshold: number | null;
  is_active: boolean;
  last_triggered: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
}

// ============================================================
// UI / DASHBOARD TYPES
// ============================================================

export interface FamilyMember {
  id: string;
  name: string;
  role: UserRole;
  netWorth: number;
  avatarColor: string;
  initials: string;
}

export interface AssetAllocationItem {
  name: string;
  value: number;
  color: string;
  percentage: number;
}

export interface NetWorthDataPoint {
  date: string;
  portfolio: number;
  nifty: number;
}

export interface CashFlowItem {
  date: string;
  description: string;
  amount: number;
  type: 'inflow' | 'outflow';
}

export interface ProjectionParams {
  equityReturn: number;
  debtReturn: number;
  goldReturn: number;
  annualSIP: number;
}

export interface ProjectionDataPoint {
  year: number;
  value: number;
}
