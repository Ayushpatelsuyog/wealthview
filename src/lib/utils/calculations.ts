import { ProjectionDataPoint, ProjectionParams } from '@/lib/types';

/**
 * Calculate XIRR using Newton-Raphson method
 */
export function calculateXIRR(
  cashFlows: number[],
  dates: Date[],
  guess: number = 0.1
): number {
  const maxIterations = 100;
  const tolerance = 1e-6;
  let rate = guess;

  for (let i = 0; i < maxIterations; i++) {
    let npv = 0;
    let dnpv = 0;
    const firstDate = dates[0];

    for (let j = 0; j < cashFlows.length; j++) {
      const years = (dates[j].getTime() - firstDate.getTime()) / (365.25 * 24 * 3600 * 1000);
      const factor = Math.pow(1 + rate, years);
      npv += cashFlows[j] / factor;
      dnpv -= (years * cashFlows[j]) / (factor * (1 + rate));
    }

    if (Math.abs(dnpv) < tolerance) break;
    const newRate = rate - npv / dnpv;
    if (Math.abs(newRate - rate) < tolerance) return newRate;
    rate = newRate;
  }

  return rate;
}

/**
 * Calculate CAGR
 */
export function calculateCAGR(
  startValue: number,
  endValue: number,
  years: number
): number {
  if (startValue <= 0 || years <= 0) return 0;
  return Math.pow(endValue / startValue, 1 / years) - 1;
}

/**
 * Calculate portfolio projection over time
 */
export function calculateProjection(
  currentValue: number,
  params: ProjectionParams,
  years: number = 10,
  allocationRatios: { equity: number; debt: number; gold: number; other: number } = {
    equity: 0.6,
    debt: 0.2,
    gold: 0.1,
    other: 0.1,
  }
): ProjectionDataPoint[] {
  const points: ProjectionDataPoint[] = [];
  let value = currentValue;

  const blendedReturn =
    allocationRatios.equity * (params.equityReturn / 100) +
    allocationRatios.debt * (params.debtReturn / 100) +
    allocationRatios.gold * (params.goldReturn / 100) +
    allocationRatios.other * 0.07;

  for (let year = 0; year <= years; year++) {
    points.push({ year, value: Math.round(value) });
    value = value * (1 + blendedReturn) + params.annualSIP * 100000;
  }

  return points;
}

/**
 * Calculate asset allocation percentages
 */
export function calculateAllocationPercentages(
  values: Record<string, number>
): Record<string, number> {
  const total = Object.values(values).reduce((sum, v) => sum + v, 0);
  if (total === 0) return {};

  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, (value / total) * 100])
  );
}

/**
 * Calculate gain/loss
 */
export function calculatePnL(
  currentValue: number,
  investedValue: number
): { absolute: number; percentage: number } {
  const absolute = currentValue - investedValue;
  const percentage = investedValue > 0 ? (absolute / investedValue) * 100 : 0;
  return { absolute, percentage };
}

/**
 * Calculate SIP value (future value of recurring investment)
 */
export function calculateSIPValue(
  monthlyAmount: number,
  annualReturnRate: number,
  months: number
): number {
  const r = annualReturnRate / 12 / 100;
  if (r === 0) return monthlyAmount * months;
  return monthlyAmount * ((Math.pow(1 + r, months) - 1) / r) * (1 + r);
}
