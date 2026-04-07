-- Fix add_family_member RPC: cast role to user_role enum type
-- Run this in Supabase SQL Editor

CREATE OR REPLACE FUNCTION add_family_member(
  target_family_id UUID,
  member_name TEXT,
  member_email TEXT,
  member_role TEXT DEFAULT 'member',
  member_pan TEXT DEFAULT NULL,
  member_mobile TEXT DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  new_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM family_memberships WHERE auth_user_id = auth.uid() AND family_id = target_family_id
  ) AND NOT EXISTS (
    SELECT 1 FROM families WHERE id = target_family_id AND created_by = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND family_id = target_family_id
  ) THEN
    RAISE EXCEPTION 'You do not have access to this family';
  END IF;

  new_id := gen_random_uuid();

  INSERT INTO users (id, email, name, family_id, role, pan, primary_mobile, primary_email)
  VALUES (new_id, member_email, member_name, target_family_id, member_role::user_role, member_pan, member_mobile, member_email);

  RETURN new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
