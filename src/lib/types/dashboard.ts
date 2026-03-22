export interface AllocationBucket {
  value: number;
  pct: number;
}

export interface DashboardMember {
  id: string;
  name: string;
  role: string;
  netWorth: number;
  todayChange: number;
  initials: string;
  color: string;
}

export interface DashboardCashFlow {
  description: string;
  amount: number;   // positive = inflow, negative = outflow
  date: string;     // ISO date string YYYY-MM-DD
  type: 'fd_maturity' | 'insurance_premium' | 'sip' | 'loan_emi';
}

export interface DashboardSnapshot {
  netWorth: number;
  totalInvested: number;
  totalGain: number;
  todayChange: number;
  todayChangePct: number;
  monthlyGrowth: number;

  allocation: {
    equities:      AllocationBucket;
    mutualFunds:   AllocationBucket;
    realEstate:    AllocationBucket;
    gold:          AllocationBucket;
    fixedDeposits: AllocationBucket;
    crypto:        AllocationBucket;
    others:        AllocationBucket;
  };

  overallXirr: number;
  equityDebtRatio: { equity: number; debt: number };
  emergencyFundMonths: number;
  annualDividendIncome: number;
  avgFdYield: number;
  insuranceCoverage: number;
  monthlySipOutflow: number;
  unrealizedStcg: number;
  unrealizedLtcg: number;
  loanExposure: number;
  rebalancingDrift: number;

  members: DashboardMember[];
  cashFlows: DashboardCashFlow[];

  hasRealData: boolean;
  needsOnboarding: boolean;
  lastUpdated: string;
}
