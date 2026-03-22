-- ============================================================
-- WealthView RLS Patch — Fix infinite recursion on users table
-- Run this entire file in the Supabase SQL Editor
-- ============================================================

-- ── STEP 1: Drop every policy that touches users.family_id ──────────────────

DROP POLICY IF EXISTS "users_select"                   ON users;
DROP POLICY IF EXISTS "families_select"                ON families;
DROP POLICY IF EXISTS "families_update"                ON families;
DROP POLICY IF EXISTS "portfolios_family_access"       ON portfolios;
DROP POLICY IF EXISTS "brokers_family_access"          ON brokers;
DROP POLICY IF EXISTS "holdings_portfolio_access"      ON holdings;
DROP POLICY IF EXISTS "transactions_holding_access"    ON transactions;
DROP POLICY IF EXISTS "manual_assets_portfolio_access" ON manual_assets;
DROP POLICY IF EXISTS "insurance_family_access"        ON insurance_policies;
DROP POLICY IF EXISTS "advisory_family_access"         ON advisory_logs;
DROP POLICY IF EXISTS "audit_log_admin_access"         ON audit_log;

-- ── STEP 2: SECURITY DEFINER helper — reads users bypassing RLS ─────────────
--
-- WHY THIS WORKS:
--   Policies run with the invoking user's privileges, so any subquery inside a
--   policy on `users` that queries `users` again re-triggers the same policy →
--   infinite recursion.
--
--   A SECURITY DEFINER function executes with the privileges of its *owner*
--   (the superuser/postgres role), which bypasses RLS completely.  Calling
--   get_my_family_id() from inside any RLS policy is therefore safe.

CREATE OR REPLACE FUNCTION get_my_family_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT family_id FROM users WHERE id = auth.uid();
$$;

-- ── STEP 3: Recreate all policies using the helper ──────────────────────────

-- ── users ───────────────────────────────────────────────────────────────────
-- Own row is always visible (first branch — no subquery, no recursion).
-- Family members visible via the SECURITY DEFINER lookup (second branch).
CREATE POLICY "users_select" ON users
  FOR SELECT USING (
    id = auth.uid()
    OR family_id = get_my_family_id()
  );

-- users_insert and users_update already safe — kept as-is:
--   INSERT: id = auth.uid()   (the trigger sets this on signup)
--   UPDATE: id = auth.uid()   (can only update your own profile)

-- ── families ────────────────────────────────────────────────────────────────
CREATE POLICY "families_select" ON families
  FOR SELECT USING (
    created_by = auth.uid()
    OR id = get_my_family_id()
  );

-- INSERT is unchanged: created_by = auth.uid()

-- Admin-only update: must be the admin of this specific family
CREATE POLICY "families_update" ON families
  FOR UPDATE USING (
    id = get_my_family_id()
    AND EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ── portfolios ──────────────────────────────────────────────────────────────
CREATE POLICY "portfolios_family_access" ON portfolios
  FOR ALL USING (
    family_id = get_my_family_id()
  );

-- ── brokers ─────────────────────────────────────────────────────────────────
CREATE POLICY "brokers_family_access" ON brokers
  FOR ALL USING (
    family_id = get_my_family_id()
  );

-- ── holdings ────────────────────────────────────────────────────────────────
CREATE POLICY "holdings_portfolio_access" ON holdings
  FOR ALL USING (
    portfolio_id IN (
      SELECT id FROM portfolios
      WHERE family_id = get_my_family_id()
    )
  );

-- ── transactions ────────────────────────────────────────────────────────────
CREATE POLICY "transactions_holding_access" ON transactions
  FOR ALL USING (
    holding_id IN (
      SELECT h.id
      FROM holdings h
      JOIN portfolios p ON h.portfolio_id = p.id
      WHERE p.family_id = get_my_family_id()
    )
  );

-- ── manual_assets ───────────────────────────────────────────────────────────
CREATE POLICY "manual_assets_portfolio_access" ON manual_assets
  FOR ALL USING (
    portfolio_id IN (
      SELECT id FROM portfolios
      WHERE family_id = get_my_family_id()
    )
  );

-- ── insurance_policies ──────────────────────────────────────────────────────
CREATE POLICY "insurance_family_access" ON insurance_policies
  FOR ALL USING (
    family_id = get_my_family_id()
  );

-- ── advisory_logs ───────────────────────────────────────────────────────────
CREATE POLICY "advisory_family_access" ON advisory_logs
  FOR ALL USING (
    family_id = get_my_family_id()
  );

-- ── audit_log ───────────────────────────────────────────────────────────────
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

-- ── Verify ──────────────────────────────────────────────────────────────────
-- After running, test with:
--   SELECT get_my_family_id();        -- should return your family UUID or NULL
--   SELECT * FROM users LIMIT 5;      -- should NOT error or recurse
--   SELECT * FROM families LIMIT 5;   -- should NOT error or recurse
