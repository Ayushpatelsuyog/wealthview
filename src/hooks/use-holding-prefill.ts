'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HoldingPrefill {
  schemeCode:    number;
  schemeName:    string;
  category:      string;
  fundHouse:     string | null;
  portfolioName: string;
  portfolioId:   string | null;
  familyId:      string | null;
  memberId:      string | null;
  brokerId:      string | null;
  isSIP:         boolean;
  folio:         string;
  // Lump sum fields
  purchaseDate:  string;
  purchaseNav:   number;
  investedAmount: number;
  existingUnits:  number;
  // SIP groups (already manual-override ready)
  sipGroups: Array<{
    sipAmount:          string;
    sipDate:            string;
    sipStart:           string;
    sipStatus:          string;
    sipStop:            string;
    manualInstallments: string;
    manualTotalUnits:   string;
    manualAvgNav:       string;
  }>;
  // Holder details
  holder: {
    firstHolder:  string;
    secondHolder: string;
    nominee:      string;
    mobile:       string;
    email:        string;
    bankName:     string;
    bankLast4:    string;
    pan:          string;
  };
}

interface RawTransaction {
  type:     string;
  quantity: number;
  price:    number;
  date:     string;
  fees:     number;
  notes?:   string;
}

interface SipMeta {
  amount:       number;
  date:         string;
  start_date:   string;
  status?:      string;
  stop_date?:   string | null;
  installments: number;
  units:        number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useHoldingPrefill(holdingId: string | null): {
  prefill: HoldingPrefill | null;
  loading: boolean;
  error:   string | null;
} {
  const [prefill, setPrefill] = useState<HoldingPrefill | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!holdingId) { setPrefill(null); setLoading(false); setError(null); return; }

    const supabase = createClient();
    setLoading(true);
    setError(null);

    (async () => {
      const { data, error: dbErr } = await supabase
        .from('holdings')
        .select(`
          id, symbol, name, quantity, avg_buy_price, metadata,
          portfolios(id, name, user_id, family_id),
          brokers(id),
          transactions(id, type, quantity, price, date, fees, notes)
        `)
        .eq('id', holdingId)
        .single();

      if (dbErr || !data) {
        setError(dbErr?.message ?? 'Holding not found');
        setLoading(false);
        return;
      }

      const meta   = (data.metadata ?? {}) as Record<string, unknown>;
      const isSIP  = !!(meta.is_sip);
      const avgNav = Number(data.avg_buy_price);
      const qty    = Number(data.quantity);

      // All buy/sip transactions sorted oldest-first
      const allTxns = (data.transactions as RawTransaction[]);
      const buyTxns = allTxns
        .filter((t) => t.type === 'buy' || t.type === 'sip')
        .sort((a, b) => a.date.localeCompare(b.date));

      // ── Build SIP groups ──────────────────────────────────────────────────
      const sipsMeta = Array.isArray(meta.sips) ? (meta.sips as SipMeta[]) : [];

      let sipGroups: HoldingPrefill['sipGroups'] = sipsMeta.map((s) => ({
        sipAmount:          s.amount.toString(),
        sipDate:            s.date,
        sipStart:           s.start_date,
        sipStatus:          s.status ?? 'active',
        sipStop:            s.stop_date ?? '',
        manualInstallments: s.installments.toString(),
        manualTotalUnits:   s.units.toFixed(3),
        manualAvgNav:       avgNav.toFixed(4),
      }));

      // Fallback: synthesise one SIP group from transactions if metadata.sips missing
      if (isSIP && sipGroups.length === 0 && buyTxns.length > 0) {
        const totalUnits = buyTxns.reduce((s, t) => s + Number(t.quantity), 0);
        const firstTxn   = buyTxns[0];
        sipGroups = [{
          sipAmount:          String(Math.round((qty * avgNav) / buyTxns.length)),
          sipDate:            '1st',
          sipStart:           firstTxn.date,
          sipStatus:          'active',
          sipStop:            '',
          manualInstallments: buyTxns.length.toString(),
          manualTotalUnits:   totalUnits.toFixed(3),
          manualAvgNav:       avgNav.toFixed(4),
        }];
      }

      // ── Resolve portfolio / broker ────────────────────────────────────────
      type PortfolioRow = { id: string; name: string; user_id: string; family_id: string } | null;
      type BrokerRow    = { id: string } | null;
      const portfolioRow = data.portfolios as unknown as PortfolioRow;
      const brokerRow    = data.brokers    as unknown as BrokerRow;

      setPrefill({
        schemeCode:    parseInt(data.symbol, 10) || 0,
        schemeName:    data.name,
        category:      String(meta.category ?? ''),
        fundHouse:     meta.fund_house ? String(meta.fund_house) : null,
        portfolioName: portfolioRow?.name ?? 'Long-term Growth',
        portfolioId:   portfolioRow?.id ?? null,
        familyId:      portfolioRow?.family_id ?? null,
        memberId:      portfolioRow?.user_id ?? null,
        brokerId:      brokerRow?.id ?? null,
        isSIP,
        folio:         meta.folio ? String(meta.folio) : '',
        purchaseDate:  buyTxns[0]?.date ?? '',
        purchaseNav:   avgNav,
        investedAmount: qty * avgNav,
        existingUnits:  qty,
        sipGroups,
        holder: {
          firstHolder:  String(meta.first_holder  ?? ''),
          secondHolder: String(meta.second_holder ?? ''),
          nominee:      String(meta.nominee        ?? ''),
          mobile:       String(meta.mobile         ?? ''),
          email:        String(meta.email          ?? ''),
          bankName:     String(meta.bank_name      ?? ''),
          bankLast4:    String(meta.bank_last4      ?? ''),
          pan:          String(meta.pan            ?? ''),
        },
      });

      setLoading(false);
    })();
  }, [holdingId]);

  return { prefill, loading, error };
}
