import { createClient } from '@/lib/supabase/server';
import { ensureUserProfile } from '@/lib/supabase/ensure-user';
import { calculateXIRR } from '@/lib/utils/calculations';
import { calcGlobalStockInvestedINR } from '@/lib/utils/global-stock-calc';
import type { DashboardSnapshot, DashboardMember, DashboardCashFlow } from '@/lib/types/dashboard';

const MEMBER_COLORS = ['#1B2A4A', '#2E8B8B', '#C9A84C', '#059669', '#7C3AED', '#DC2626'];

function getInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

function calcFdCurrentValue(meta: Record<string, unknown>): number {
  const principal = Number(meta.principal ?? meta.amount ?? meta.invested_amount ?? 0);
  const rate = Number(meta.interest_rate ?? meta.rate ?? 0);
  const startDate = String(meta.start_date ?? meta.date ?? '');
  const frequency = String(meta.compounding_frequency ?? 'yearly');

  if (!principal || !rate || !startDate) return principal;
  try {
    const years = (Date.now() - new Date(startDate).getTime()) / (365.25 * 24 * 3600 * 1000);
    if (years <= 0) return principal;
    const n = ({ monthly: 12, quarterly: 4, half_yearly: 2, yearly: 1 } as Record<string, number>)[frequency] ?? 1;
    return principal * Math.pow(1 + (rate / 100) / n, n * years);
  } catch {
    return principal;
  }
}

function getNextPremiumDate(startDate: string, frequency: string, ref = new Date()): Date | null {
  try {
    const monthsMap: Record<string, number> = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12, single: 0 };
    const months = monthsMap[frequency] ?? 0;
    if (months === 0) return null;
    let next = new Date(startDate);
    while (next <= ref) {
      next = new Date(next);
      next.setMonth(next.getMonth() + months);
    }
    return next;
  } catch {
    return null;
  }
}

function emptySnapshot(): DashboardSnapshot {
  return {
    netWorth: 0, totalInvested: 0, totalGain: 0,
    todayChange: 0, todayChangePct: 0, monthlyGrowth: 0,
    allocation: {
      equities:      { value: 0, pct: 0 },
      mutualFunds:   { value: 0, pct: 0 },
      realEstate:    { value: 0, pct: 0 },
      gold:          { value: 0, pct: 0 },
      fixedDeposits: { value: 0, pct: 0 },
      crypto:        { value: 0, pct: 0 },
      others:        { value: 0, pct: 0 },
    },
    overallXirr: 0, equityDebtRatio: { equity: 0, debt: 0 },
    emergencyFundMonths: 0, annualDividendIncome: 0, avgFdYield: 0,
    insuranceCoverage: 0, monthlySipOutflow: 0, activeSipCount: 0,
    unrealizedStcg: 0, unrealizedLtcg: 0, loanExposure: 0, rebalancingDrift: 0,
    members: [], cashFlows: [], hasRealData: false, needsOnboarding: false,
    lastUpdated: new Date().toISOString(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/**
 * Dashboard snapshot — DATABASE ONLY, no external API calls.
 * Uses invested values (qty * avg_buy_price) for current value.
 * Live prices are fetched lazily on the client side.
 */
export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return emptySnapshot();

    const userProfile = await ensureUserProfile(supabase, user);

    if (!userProfile?.family_id) {
      return { ...emptySnapshot(), needsOnboarding: true };
    }
    const familyId = userProfile.family_id;

    // Fetch all data in parallel — RLS scopes everything to the family
    // NO external API calls — database only for speed
    const [holdingsRes, manualRes, insuranceRes, membersRes] = await Promise.all([
      supabase
        .from('holdings')
        .select('id, portfolio_id, asset_type, symbol, name, quantity, avg_buy_price, metadata, portfolio:portfolios(id, user_id), transactions(id, type, quantity, price, date, fees)'),
      supabase
        .from('manual_assets')
        .select('id, portfolio_id, asset_type, name, current_value, metadata, portfolio:portfolios(id, user_id)'),
      supabase
        .from('insurance_policies')
        .select('id, user_id, category, provider, policy_name, sum_assured, premium, premium_frequency, start_date, maturity_date, is_active')
        .eq('family_id', familyId)
        .eq('is_active', true),
      supabase
        .from('users')
        .select('id, name, role, family_id')
        .eq('family_id', familyId),
    ]);

    const holdings: Row[] = holdingsRes.data ?? [];
    const manualAssets: Row[] = manualRes.data ?? [];
    const insurance: Row[] = insuranceRes.data ?? [];

    // Get members from ALL accessible families (not just primary)
    // Exclude the auth user — they are the admin, not a family member
    let familyMembers: Row[] = (membersRes.data ?? []).filter((m: Row) => m.id !== user.id);
    try {
      // Get families created by or membershipped to this user
      const { data: createdFams } = await supabase.from('families').select('id').eq('created_by', user.id);
      const allFamIds = [familyId];
      if (createdFams) {
        for (const f of createdFams) {
          if (!allFamIds.includes(f.id)) allFamIds.push(f.id);
        }
      }
      try {
        const { data: memberships } = await supabase.from('family_memberships').select('family_id').eq('auth_user_id', user.id);
        if (memberships) {
          for (const m of memberships) {
            if (!allFamIds.includes(m.family_id)) allFamIds.push(m.family_id);
          }
        }
      } catch { /* table may not exist */ }

      if (allFamIds.length > 1) {
        const { data: allUsers } = await supabase.from('users').select('id, name, role, family_id').in('family_id', allFamIds);
        if (allUsers) {
          const filtered = allUsers.filter((m: Row) => m.id !== user.id);
          if (filtered.length > familyMembers.length) {
            familyMembers = filtered;
          }
        }
      }
    } catch { /* fallback to primary family members */ }

    const hasRealData = holdings.length > 0 || manualAssets.length > 0;

    if (!hasRealData) {
      const members: DashboardMember[] = familyMembers.map((m, i) => ({
        id: m.id, name: m.name, role: m.role,
        netWorth: 0, todayChange: 0,
        initials: getInitials(m.name),
        color: MEMBER_COLORS[i % MEMBER_COLORS.length],
      }));
      return { ...emptySnapshot(), members, hasRealData: false };
    }

    // ── Process Holdings (using invested value as current — no live prices) ──
    const now = new Date();
    const oneYearAgo = new Date(now.getTime() - 365.25 * 24 * 3600 * 1000);

    let totalHoldingsInvested = 0;
    let totalHoldingsCurrentValue = 0;
    let stcgGains = 0;
    let ltcgGains = 0;
    let sipMonthly = 0;
    let activeSipCount = 0;
    let annualDividends = 0;

    const holdingBuckets: Record<string, { invested: number; current: number }> = {};
    const userHoldingsValue: Record<string, number> = {};
    const allCashFlows: { amount: number; date: Date }[] = [];

    for (const h of holdings) {
      const qty = Number(h.quantity);
      const avgBuy = Number(h.avg_buy_price);
      let invested = qty * avgBuy;

      // For global stocks: use shared FIFO/weighted-avg calc (same as portfolio page)
      if (h.asset_type === 'global_stock') {
        const { investedINR: gsInvINR } = calcGlobalStockInvestedINR(h);
        invested = gsInvINR;
      }

      // Use invested as current value — live prices will update this on client
      const currentValue = invested;

      totalHoldingsInvested += invested;
      totalHoldingsCurrentValue += currentValue;

      const txns: Row[] = h.transactions ?? [];
      const buyTxns = txns.filter((t: Row) => t.type === 'buy' || t.type === 'sip');

      for (const t of buyTxns) {
        allCashFlows.push({ amount: -(Number(t.quantity) * Number(t.price) + Number(t.fees ?? 0)), date: new Date(t.date) });
      }

      const pnl = currentValue - invested;
      if (pnl > 0 && buyTxns.length > 0) {
        const earliest = buyTxns.reduce((a: Row, b: Row) => new Date(a.date) < new Date(b.date) ? a : b);
        const purchaseDate = new Date(earliest.date);
        if (purchaseDate >= oneYearAgo) stcgGains += pnl;
        else ltcgGains += pnl;
      }

      const meta = h.metadata as Row ?? {};
      if (meta.is_sip) {
        if (Array.isArray(meta.sips)) {
          for (const sip of meta.sips as Array<Record<string, unknown>>) {
            if (sip.status !== 'inactive') {
              sipMonthly += Number(sip.amount ?? 0);
              activeSipCount++;
            }
          }
        } else if (meta.sip_amount) {
          sipMonthly += Number(meta.sip_amount);
          activeSipCount++;
        }
      }

      const divTxns = txns.filter((t: Row) => t.type === 'dividend');
      for (const d of divTxns) {
        if (new Date(d.date) >= oneYearAgo) annualDividends += Number(d.quantity) * Number(d.price);
      }

      const bucket = h.asset_type as string;
      if (!holdingBuckets[bucket]) holdingBuckets[bucket] = { invested: 0, current: 0 };
      holdingBuckets[bucket].invested += invested;
      holdingBuckets[bucket].current += currentValue;

      const ownerUserId = (h.portfolio as Row)?.user_id;
      if (ownerUserId) userHoldingsValue[ownerUserId] = (userHoldingsValue[ownerUserId] ?? 0) + currentValue;
    }

    // ── Process Manual Assets ──
    let totalManualValue = 0;
    let totalManualInvested = 0;
    let savingsBalance = 0;
    let loanExposure = 0;
    const fdRates: number[] = [];
    const manualBuckets: Record<string, number> = {};
    const userManualValue: Record<string, number> = {};
    const cashFlows: DashboardCashFlow[] = [];

    for (const a of manualAssets) {
      const meta = (a.metadata ?? {}) as Row;
      let currentValue = Number(a.current_value);

      if (a.asset_type === 'fd') {
        const calculated = calcFdCurrentValue(meta);
        if (calculated > 0) currentValue = calculated;
        const rate = Number(meta.interest_rate ?? meta.rate ?? 0);
        if (rate > 0) fdRates.push(rate);
        const maturityStr = String(meta.maturity_date ?? '');
        if (maturityStr) {
          const maturityDate = new Date(maturityStr);
          const daysUntil = (maturityDate.getTime() - now.getTime()) / (24 * 3600 * 1000);
          if (daysUntil >= 0 && daysUntil <= 90) {
            cashFlows.push({ description: `${a.name} Maturity`, amount: currentValue, date: maturityStr.slice(0, 10), type: 'fd_maturity' });
          }
        }
      }

      if (a.asset_type === 'savings_account') savingsBalance += currentValue;
      if (a.asset_type === 'real_estate') loanExposure += Number(meta.loan_outstanding ?? meta.loan_amount ?? 0);

      const invested = Number(meta.principal ?? meta.invested_amount ?? meta.amount ?? currentValue);
      totalManualInvested += invested;
      totalManualValue += currentValue;

      if (!manualBuckets[a.asset_type]) manualBuckets[a.asset_type] = 0;
      manualBuckets[a.asset_type] += currentValue;

      const ownerUserId = (a.portfolio as Row)?.user_id;
      if (ownerUserId) userManualValue[ownerUserId] = (userManualValue[ownerUserId] ?? 0) + currentValue;
    }

    // ── Process Insurance ──
    let insuranceCoverage = 0;
    let annualPremiumOutflow = 0;
    const freqMultiplier: Record<string, number> = { monthly: 12, quarterly: 4, half_yearly: 2, yearly: 1, single: 0 };

    for (const p of insurance) {
      insuranceCoverage += Number(p.sum_assured);
      annualPremiumOutflow += Number(p.premium) * (freqMultiplier[p.premium_frequency] ?? 1);
      const nextDue = getNextPremiumDate(p.start_date, p.premium_frequency, now);
      if (nextDue) {
        const daysUntil = (nextDue.getTime() - now.getTime()) / (24 * 3600 * 1000);
        if (daysUntil >= 0 && daysUntil <= 90) {
          cashFlows.push({
            description: `${p.policy_name ?? p.provider} Premium`,
            amount: -Number(p.premium),
            date: nextDue.toISOString().slice(0, 10),
            type: 'insurance_premium',
          });
        }
      }
    }

    if (sipMonthly > 0) {
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      cashFlows.push({ description: 'SIP Auto-debit', amount: -sipMonthly, date: nextMonth.toISOString().slice(0, 10), type: 'sip' });
    }
    cashFlows.sort((a, b) => a.date.localeCompare(b.date));

    // ── Overall XIRR ──
    let overallXirr = 0;
    if (allCashFlows.length > 0 && totalHoldingsCurrentValue > 0) {
      const cfWithFinal = [...allCashFlows, { amount: totalHoldingsCurrentValue, date: now }]
        .sort((a, b) => a.date.getTime() - b.date.getTime());
      try {
        const xirr = calculateXIRR(cfWithFinal.map(c => c.amount), cfWithFinal.map(c => c.date));
        if (isFinite(xirr) && xirr > -1 && xirr < 10) overallXirr = xirr * 100;
      } catch { /* XIRR failed */ }
    }

    // ── Totals ──
    const netWorth = totalHoldingsCurrentValue + totalManualValue;
    const totalInvested = totalHoldingsInvested + totalManualInvested;
    const totalGain = netWorth - totalInvested;

    // ── Allocation ──
    const equitiesValue = (holdingBuckets['indian_stock']?.current ?? 0) + (holdingBuckets['global_stock']?.current ?? 0);
    const mfValue       = holdingBuckets['mutual_fund']?.current ?? 0;
    const cryptoValue   = holdingBuckets['crypto']?.current ?? 0;
    const realEstateVal = manualBuckets['real_estate'] ?? 0;
    const goldValue     = (holdingBuckets['commodity']?.current ?? 0) + (manualBuckets['gold'] ?? 0);
    const fdValue       = manualBuckets['fd'] ?? 0;
    const othersValue   = Math.max(0, netWorth - equitiesValue - mfValue - cryptoValue - realEstateVal - goldValue - fdValue);
    const totalForPct   = netWorth || 1;

    const allocation = {
      equities:      { value: equitiesValue,  pct: (equitiesValue  / totalForPct) * 100 },
      mutualFunds:   { value: mfValue,         pct: (mfValue         / totalForPct) * 100 },
      realEstate:    { value: realEstateVal,   pct: (realEstateVal   / totalForPct) * 100 },
      gold:          { value: goldValue,       pct: (goldValue       / totalForPct) * 100 },
      fixedDeposits: { value: fdValue,         pct: (fdValue         / totalForPct) * 100 },
      crypto:        { value: cryptoValue,     pct: (cryptoValue     / totalForPct) * 100 },
      others:        { value: othersValue,     pct: (othersValue     / totalForPct) * 100 },
    };

    const equityTotal = equitiesValue + mfValue + cryptoValue;
    const debtTotal   = fdValue + (manualBuckets['ppf'] ?? 0) + (manualBuckets['epf'] ?? 0) + (manualBuckets['nps'] ?? 0) + (holdingBuckets['bond']?.current ?? 0);
    const edSum       = equityTotal + debtTotal || 1;
    const equityDebtRatio = { equity: Math.round((equityTotal / edSum) * 100), debt: Math.round((debtTotal / edSum) * 100) };

    const estMonthlyExpenses = (sipMonthly > 0 ? sipMonthly : 10000) + (annualPremiumOutflow > 0 ? annualPremiumOutflow / 12 : 5000);
    const emergencyFundMonths = savingsBalance > 0 ? savingsBalance / estMonthlyExpenses : 0;

    const avgFdYield      = fdRates.length > 0 ? fdRates.reduce((s, r) => s + r, 0) / fdRates.length : 0;
    const rebalancingDrift = Math.abs(equityDebtRatio.equity - 60);

    const members: DashboardMember[] = familyMembers.map((m, i) => ({
      id: m.id, name: m.name, role: m.role,
      netWorth: (userHoldingsValue[m.id] ?? 0) + (userManualValue[m.id] ?? 0),
      todayChange: 0,
      initials: getInitials(m.name),
      color: MEMBER_COLORS[i % MEMBER_COLORS.length],
    }));

    return {
      netWorth, totalInvested, totalGain,
      todayChange: 0, todayChangePct: 0, monthlyGrowth: 0,
      allocation,
      overallXirr,
      equityDebtRatio,
      emergencyFundMonths,
      annualDividendIncome: annualDividends,
      avgFdYield,
      insuranceCoverage,
      monthlySipOutflow: sipMonthly,
      activeSipCount,
      unrealizedStcg: stcgGains,
      unrealizedLtcg: ltcgGains,
      loanExposure,
      rebalancingDrift,
      members,
      cashFlows: cashFlows.slice(0, 10),
      hasRealData: true,
      needsOnboarding: false,
      lastUpdated: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[portfolio-service]', err);
    return emptySnapshot();
  }
}
