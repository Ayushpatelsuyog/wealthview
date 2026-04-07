-- Add extra member fields to users table
-- Run this in Supabase SQL Editor

ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS relationship TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS karta_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cin TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS llpin TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_relationship TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS country_of_residence TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS nri_status TEXT;
