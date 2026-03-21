import { create } from 'zustand';
import { Portfolio, Holding, ManualAsset, InsurancePolicy, ProjectionParams } from '@/lib/types';

interface WealthState {
  portfolios: Portfolio[];
  holdings: Holding[];
  manualAssets: ManualAsset[];
  insurancePolicies: InsurancePolicy[];
  totalNetWorth: number;
  projectionParams: ProjectionParams;
  setPortfolios: (portfolios: Portfolio[]) => void;
  setHoldings: (holdings: Holding[]) => void;
  setManualAssets: (assets: ManualAsset[]) => void;
  setInsurancePolicies: (policies: InsurancePolicy[]) => void;
  setTotalNetWorth: (value: number) => void;
  updateProjectionParams: (params: Partial<ProjectionParams>) => void;
}

export const useWealthStore = create<WealthState>((set) => ({
  portfolios: [],
  holdings: [],
  manualAssets: [],
  insurancePolicies: [],
  totalNetWorth: 0,
  projectionParams: {
    equityReturn: 12,
    debtReturn: 7,
    goldReturn: 8,
    annualSIP: 15,
  },
  setPortfolios: (portfolios) => set({ portfolios }),
  setHoldings: (holdings) => set({ holdings }),
  setManualAssets: (manualAssets) => set({ manualAssets }),
  setInsurancePolicies: (insurancePolicies) => set({ insurancePolicies }),
  setTotalNetWorth: (totalNetWorth) => set({ totalNetWorth }),
  updateProjectionParams: (params) =>
    set((state) => ({
      projectionParams: { ...state.projectionParams, ...params },
    })),
}));
