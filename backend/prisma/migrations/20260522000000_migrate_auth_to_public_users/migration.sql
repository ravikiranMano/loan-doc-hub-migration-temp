-- Migration: Replace Supabase Auth with custom public.users table
-- All existing auth.users data is preserved (UUIDs and bcrypt hashes copied).
-- FK constraints are migrated from auth.users → public.users.
-- profiles and user_roles tables are merged into public.users and dropped.

-- ─── 1. Create public.users ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.users (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT        NOT NULL UNIQUE,
  password_hash   TEXT        NOT NULL DEFAULT '',
  full_name       TEXT,
  phone           TEXT,
  company         TEXT,
  license_number  TEXT,
  user_type       TEXT        NOT NULL DEFAULT 'internal',
  role            app_role    NOT NULL DEFAULT 'other',
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  last_sign_in_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 2. Migrate data from auth.users + profiles + user_roles ─────────────────
-- encrypted_password from auth.users is a bcrypt hash compatible with bcryptjs.
-- Users can log in immediately with their existing Supabase passwords.

INSERT INTO public.users (
  id, email, password_hash,
  full_name, phone, company, license_number,
  user_type, role, is_active,
  last_sign_in_at, created_at, updated_at
)
SELECT
  au.id,
  au.email,
  COALESCE(au.encrypted_password, '')                                      AS password_hash,
  COALESCE(p.full_name, au.raw_user_meta_data->>'full_name')               AS full_name,
  p.phone,
  p.company,
  p.license_number,
  COALESCE(p.user_type, 'internal')                                        AS user_type,
  COALESCE(ur.role, 'other'::app_role)                                     AS role,
  true                                                                     AS is_active,
  au.last_sign_in_at,
  au.created_at,
  COALESCE(p.updated_at, au.updated_at, au.created_at)                    AS updated_at
FROM auth.users au
LEFT JOIN public.profiles p ON p.id = au.id
LEFT JOIN LATERAL (
  SELECT role
  FROM public.user_roles
  WHERE user_id = au.id
  ORDER BY CASE role::text
    WHEN 'admin'    THEN 1
    WHEN 'csr'      THEN 2
    WHEN 'borrower' THEN 3
    WHEN 'broker'   THEN 4
    WHEN 'lender'   THEN 5
    ELSE 6
  END
  LIMIT 1
) ur ON true
WHERE au.deleted_at IS NULL
ON CONFLICT (id) DO NOTHING;

-- ─── 3. Drop FK constraints pointing to auth.users ───────────────────────────
-- Use dynamic SQL to find and drop all public-schema FKs that reference auth.users.
-- This is safer than hardcoding constraint names.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      tc.table_name,
      tc.constraint_name
    FROM information_schema.table_constraints  tc
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name
      AND rc.constraint_schema = tc.table_schema
    JOIN information_schema.table_constraints tc2
      ON tc2.constraint_name = rc.unique_constraint_name
      AND tc2.constraint_schema = rc.unique_constraint_schema
    WHERE tc.table_schema  = 'public'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND tc2.table_schema = 'auth'
      AND tc2.table_name   = 'users'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
      r.table_name,
      r.constraint_name
    );
  END LOOP;
END $$;

-- ─── 4. Add FK constraints pointing to public.users ──────────────────────────

ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE public.deal_field_values
  ADD CONSTRAINT deal_field_values_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES public.users(id) ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE public.deal_participants
  ADD CONSTRAINT deal_participants_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE NO ACTION;

ALTER TABLE public.deals
  ADD CONSTRAINT deals_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE public.packets
  ADD CONSTRAINT packets_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE public.templates
  ADD CONSTRAINT templates_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE NO ACTION ON DELETE NO ACTION;

-- ─── 5. Create indexes on public.users ───────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_users_email    ON public.users (email);
CREATE INDEX IF NOT EXISTS idx_users_role     ON public.users (role);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON public.users (is_active);

-- ─── 6. Create public.refresh_tokens ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.refresh_tokens (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL,
  token_hash     TEXT        NOT NULL UNIQUE,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at     TIMESTAMPTZ,
  replaced_by_id UUID,
  user_agent     TEXT,
  ip_address     TEXT,
  CONSTRAINT refresh_tokens_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id   ON public.refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON public.refresh_tokens (expires_at);

-- ─── 7. Drop old tables (data already migrated) ──────────────────────────────

DROP TABLE IF EXISTS public.user_roles CASCADE;
DROP TABLE IF EXISTS public.profiles   CASCADE;

-- ─── 8. Drop RLS policies on public tables ───────────────────────────────────
-- NestJS connects as postgres (BYPASSRLS) so RLS is already bypassed,
-- but clean up orphaned policies to avoid confusion.

DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      pol.policyname,
      pol.tablename
    );
  END LOOP;
END $$;
