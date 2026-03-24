-- WealthView Database Schema
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE user_role AS ENUM ('admin', 'member', 'advisor', 'guest');
CREATE TYPE risk_profile_type AS ENUM ('conservative', 'moderate', 'aggressive', 'very_aggressive');
CREATE TYPE portfolio_type AS ENUM ('personal', 'joint', 'retirement', 'tax_saving', 'trading');
CREATE TYPE platform_type AS ENUM ('zerodha', 'groww', 'upstox', 'angel', 'icicidirect', 'hdfc_securities', 'motilal', 'kotak', 'paytm_money', 'coin', 'other');
CREATE TYPE asset_type AS ENUM ('indian_stock', 'global_stock', 'mutual_fund', 'crypto', 'forex', 'commodity', 'bond', 'pms', 'aif');
CREATE TYPE transaction_type AS ENUM ('buy', 'sell', 'dividend', 'sip', 'switch');
CREATE TYPE manual_asset_type AS ENUM ('real_estate', 'fd', 'ppf', 'epf', 'gratuity', 'nps', 'gold', 'savings_account');
CREATE TYPE insurance_category AS ENUM ('life_term', 'life_guaranteed', 'life_ulip', 'health', 'vehicle', 'property');
CREATE TYPE premium_frequency_type AS ENUM ('monthly', 'quarterly', 'half_yearly', 'yearly', 'single');
CREATE TYPE advisory_status AS ENUM ('pending', 'accepted', 'rejected');

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  currency_default TEXT NOT NULL DEFAULT 'INR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  family_id UUID REFERENCES families(id) ON DELETE SET NULL,
  role user_role NOT NULL DEFAULT 'member',
  risk_profile risk_profile_type DEFAULT 'moderate',
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE portfolios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type portfolio_type NOT NULL DEFAULT 'personal',
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE brokers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platform_type platform_type NOT NULL DEFAULT 'other',
  logo_color TEXT DEFAULT '#1B2A4A',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- If updating an existing database, run:
-- ALTER TABLE brokers ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

CREATE TABLE import_batches (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id      UUID          NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id        UUID          NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  source_filename TEXT         NOT NULL DEFAULT 'manual',
  source_type    TEXT          NOT NULL DEFAULT 'manual_csv',
  funds_count    INTEGER       NOT NULL DEFAULT 0,
  total_invested NUMERIC(20,4) NOT NULL DEFAULT 0,
  imported_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  status         TEXT          NOT NULL DEFAULT 'active',
  undone_at      TIMESTAMPTZ,
  metadata       JSONB         DEFAULT '{}'
);

CREATE TABLE holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  broker_id UUID REFERENCES brokers(id) ON DELETE SET NULL,
  asset_type asset_type NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  quantity NUMERIC(20, 6) NOT NULL DEFAULT 0,
  avg_buy_price NUMERIC(20, 4) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  metadata JSONB DEFAULT '{}',
  import_batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  holding_id UUID NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
  type transaction_type NOT NULL,
  quantity NUMERIC(20, 6) NOT NULL,
  price NUMERIC(20, 4) NOT NULL,
  date DATE NOT NULL,
  fees NUMERIC(20, 4) DEFAULT 0,
  notes TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- If updating an existing database, run:
-- ALTER TABLE transactions ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

CREATE TABLE manual_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  asset_type manual_asset_type NOT NULL,
  name TEXT NOT NULL,
  current_value NUMERIC(20, 4) NOT NULL DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  last_updated DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE insurance_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  category insurance_category NOT NULL,
  provider TEXT NOT NULL,
  policy_name TEXT NOT NULL,
  policy_number TEXT,
  sum_assured NUMERIC(20, 4) NOT NULL,
  premium NUMERIC(20, 4) NOT NULL,
  premium_frequency premium_frequency_type NOT NULL DEFAULT 'yearly',
  start_date DATE NOT NULL,
  maturity_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE price_cache (
  symbol TEXT NOT NULL,
  price NUMERIC(20, 6) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  source TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ttl_seconds INTEGER NOT NULL DEFAULT 300,
  PRIMARY KEY (symbol, currency)
);

CREATE TABLE price_history (
  symbol TEXT NOT NULL,
  date DATE NOT NULL,
  open NUMERIC(20, 6),
  high NUMERIC(20, 6),
  low NUMERIC(20, 6),
  close NUMERIC(20, 6) NOT NULL,
  volume BIGINT,
  PRIMARY KEY (symbol, date)
);

CREATE TABLE benchmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  symbol TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'index'
);

CREATE TABLE advisory_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recommendation TEXT NOT NULL,
  status advisory_status NOT NULL DEFAULT 'pending',
  advisor_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  condition TEXT NOT NULL,
  threshold NUMERIC(20, 4),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_triggered TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  details JSONB DEFAULT '{}',
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY (enabled after all tables exist)
-- ============================================================
ALTER TABLE families ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE brokers ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE manual_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE advisory_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SECURITY DEFINER HELPER
-- Reads the current user's family_id without triggering RLS on
-- the users table, preventing infinite recursion in policies.
-- ============================================================
CREATE OR REPLACE FUNCTION get_my_family_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT family_id FROM users WHERE id = auth.uid();
$$;

-- ============================================================
-- RLS POLICIES (all tables exist by this point)
-- ============================================================

-- families
CREATE POLICY "families_select" ON families
  FOR SELECT USING (
    created_by = auth.uid()
    OR id = get_my_family_id()
  );

CREATE POLICY "families_insert" ON families
  FOR INSERT WITH CHECK (created_by = auth.uid());

-- Admin-only update: must be the admin of this specific family
CREATE POLICY "families_update" ON families
  FOR UPDATE USING (
    id = get_my_family_id()
    AND EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- users
-- Own row is always visible (no subquery, no recursion).
-- Family members visible via the SECURITY DEFINER lookup.
CREATE POLICY "users_select" ON users
  FOR SELECT USING (
    id = auth.uid()
    OR family_id = get_my_family_id()
  );

CREATE POLICY "users_insert" ON users
  FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY "users_update" ON users
  FOR UPDATE USING (id = auth.uid());

-- import_batches
CREATE POLICY "import_batches_family_access" ON import_batches
  FOR ALL USING (family_id = get_my_family_id());

-- portfolios
CREATE POLICY "portfolios_family_access" ON portfolios
  FOR ALL USING (
    family_id = get_my_family_id()
  );

-- brokers
CREATE POLICY "brokers_family_access" ON brokers
  FOR ALL USING (
    family_id = get_my_family_id()
  );

-- holdings
CREATE POLICY "holdings_portfolio_access" ON holdings
  FOR ALL USING (
    portfolio_id IN (
      SELECT id FROM portfolios
      WHERE family_id = get_my_family_id()
    )
  );

-- transactions
CREATE POLICY "transactions_holding_access" ON transactions
  FOR ALL USING (
    holding_id IN (
      SELECT h.id
      FROM holdings h
      JOIN portfolios p ON h.portfolio_id = p.id
      WHERE p.family_id = get_my_family_id()
    )
  );

-- manual_assets
CREATE POLICY "manual_assets_portfolio_access" ON manual_assets
  FOR ALL USING (
    portfolio_id IN (
      SELECT id FROM portfolios
      WHERE family_id = get_my_family_id()
    )
  );

-- insurance_policies
CREATE POLICY "insurance_family_access" ON insurance_policies
  FOR ALL USING (
    family_id = get_my_family_id()
  );

-- price_cache
CREATE POLICY "price_cache_read" ON price_cache
  FOR SELECT USING (auth.role() = 'authenticated');

-- price_history
CREATE POLICY "price_history_read" ON price_history
  FOR SELECT USING (auth.role() = 'authenticated');

-- benchmarks
CREATE POLICY "benchmarks_read" ON benchmarks
  FOR SELECT USING (auth.role() = 'authenticated');

-- advisory_logs
CREATE POLICY "advisory_family_access" ON advisory_logs
  FOR ALL USING (
    family_id = get_my_family_id()
  );

-- alerts
CREATE POLICY "alerts_owner_access" ON alerts
  FOR ALL USING (user_id = auth.uid());

-- audit_log
-- Own records always visible.
-- Admins can also see all records belonging to their family members.
CREATE POLICY "audit_log_admin_access" ON audit_log
  FOR SELECT USING (
    user_id = auth.uid()
    OR (
      EXISTS (
        SELECT 1 FROM users
        WHERE id = auth.uid() AND role = 'admin'
      )
      AND user_id IN (
        SELECT id FROM users
        WHERE family_id = get_my_family_id()
      )
    )
  );

CREATE POLICY "audit_log_insert" ON audit_log
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_import_batches_family_id ON import_batches(family_id);
CREATE INDEX idx_holdings_import_batch_id ON holdings(import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX idx_portfolios_family_id ON portfolios(family_id);
CREATE INDEX idx_holdings_portfolio_id ON holdings(portfolio_id);
CREATE INDEX idx_holdings_symbol ON holdings(symbol);
CREATE INDEX idx_transactions_holding_id ON transactions(holding_id);
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_manual_assets_portfolio_id ON manual_assets(portfolio_id);
CREATE INDEX idx_price_history_symbol_date ON price_history(symbol, date DESC);
CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at DESC);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER families_updated_at BEFORE UPDATE ON families FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER portfolios_updated_at BEFORE UPDATE ON portfolios FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER holdings_updated_at BEFORE UPDATE ON holdings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER manual_assets_updated_at BEFORE UPDATE ON manual_assets FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER insurance_policies_updated_at BEFORE UPDATE ON insurance_policies FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER advisory_logs_updated_at BEFORE UPDATE ON advisory_logs FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- SEED DATA
-- ============================================================
INSERT INTO benchmarks (name, symbol, type) VALUES
  ('Nifty 50', 'NIFTY50', 'index'),
  ('Sensex', 'SENSEX', 'index'),
  ('Nifty Next 50', 'NIFTYNXT50', 'index'),
  ('S&P 500', 'SPX', 'index'),
  ('NASDAQ Composite', 'IXIC', 'index'),
  ('Gold', 'GOLD', 'commodity');

-- ============================================================
-- AUTO-CREATE USER PROFILE ON SIGNUP
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
