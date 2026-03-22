-- ============================================================
-- WealthView Migration: Import Batches
-- Run this in the Supabase SQL Editor
-- ============================================================

-- ── 1. Create import_batches table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS import_batches (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id      UUID        NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id        UUID        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  source_filename TEXT        NOT NULL DEFAULT 'manual',
  source_type    TEXT        NOT NULL DEFAULT 'manual_csv',
    -- cams_csv | kfintech_csv | manual_csv | template_csv
  funds_count    INTEGER     NOT NULL DEFAULT 0,
  total_invested NUMERIC(20,4) NOT NULL DEFAULT 0,
  imported_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status         TEXT        NOT NULL DEFAULT 'active',
    -- active | undone
  undone_at      TIMESTAMPTZ,
  metadata       JSONB       DEFAULT '{}'
);

-- ── 2. Enable RLS ─────────────────────────────────────────────────────────────
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

-- ── 3. RLS policy (uses the same SECURITY DEFINER helper) ────────────────────
CREATE POLICY "import_batches_family_access" ON import_batches
  FOR ALL USING (family_id = get_my_family_id());

-- ── 4. Add import_batch_id column to holdings ─────────────────────────────────
ALTER TABLE holdings
  ADD COLUMN IF NOT EXISTS import_batch_id UUID
    REFERENCES import_batches(id) ON DELETE SET NULL;

-- ── 5. Index for fast batch lookups ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_holdings_import_batch_id
  ON holdings(import_batch_id)
  WHERE import_batch_id IS NOT NULL;

-- ── Verify ───────────────────────────────────────────────────────────────────
-- After running, test with:
--   SELECT * FROM import_batches LIMIT 5;
--   SELECT import_batch_id FROM holdings LIMIT 5;
