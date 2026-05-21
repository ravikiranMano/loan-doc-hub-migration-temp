-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Replace Supabase Auth with public.users
--
-- Run order:
--   1. Create public.users (consolidated: auth.users + profiles + user_roles)
--   2. Create public.refresh_tokens
--   3. Migrate data
--   4. Re-point all FKs from auth.users → public.users
--   5. Drop obsolete tables (profiles, user_roles)
--   6. Drop all RLS policies and auth helper functions
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1. Create public.users ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.users (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT        NOT NULL UNIQUE,
  password_hash   TEXT        NOT NULL,
  full_name       TEXT,
  phone           TEXT,
  company         TEXT,
  license_number  TEXT,
  user_type       TEXT        NOT NULL DEFAULT 'internal',
  role            app_role    NOT NULL DEFAULT 'other',
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  last_sign_in_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email      ON public.users (email);
CREATE INDEX IF NOT EXISTS idx_users_role       ON public.users (role);
CREATE INDEX IF NOT EXISTS idx_users_user_type  ON public.users (user_type);
CREATE INDEX IF NOT EXISTS idx_users_is_active  ON public.users (is_active);

-- ─── 2. Create public.refresh_tokens ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.refresh_tokens (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash     TEXT        NOT NULL UNIQUE,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at     TIMESTAMPTZ,
  replaced_by_id UUID        REFERENCES public.refresh_tokens(id),
  user_agent     TEXT,
  ip_address     TEXT
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id    ON public.refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON public.refresh_tokens (expires_at);

-- ─── 3. Migrate data from auth.users + profiles + user_roles ─────────────────
-- Takes the highest-priority role per user (admin > csr > borrower > broker > lender > other).
-- Passwords are preserved as-is (bcrypt hashes from Supabase GoTrue).

INSERT INTO public.users (
  id, email, password_hash, full_name, phone, company,
  license_number, user_type, role, is_active, last_sign_in_at, created_at, updated_at
)
SELECT
  au.id,
  au.email,
  COALESCE(au.encrypted_password, '') AS password_hash,
  COALESCE(p.full_name, (au.raw_user_meta_data->>'full_name')::TEXT) AS full_name,
  p.phone,
  p.company,
  p.license_number,
  COALESCE(p.user_type, 'internal')   AS user_type,
  COALESCE(primary_role.role, 'other'::app_role) AS role,
  CASE
    WHEN au.banned_until IS NOT NULL AND au.banned_until > NOW() THEN FALSE
    WHEN au.deleted_at IS NOT NULL THEN FALSE
    ELSE TRUE
  END AS is_active,
  au.last_sign_in_at,
  COALESCE(au.created_at, NOW())      AS created_at,
  COALESCE(au.updated_at, NOW())      AS updated_at
FROM auth.users au
LEFT JOIN public.profiles p ON p.user_id = au.id
LEFT JOIN LATERAL (
  SELECT role FROM public.user_roles
  WHERE user_id = au.id
  ORDER BY
    CASE role
      WHEN 'admin'    THEN 1
      WHEN 'csr'      THEN 2
      WHEN 'borrower' THEN 3
      WHEN 'broker'   THEN 4
      WHEN 'lender'   THEN 5
      ELSE                 6
    END
  LIMIT 1
) primary_role ON TRUE
ON CONFLICT (id) DO NOTHING;

-- ─── 4a. contacts.created_by ─────────────────────────────────────────────────

ALTER TABLE public.contacts
  DROP CONSTRAINT IF EXISTS contacts_created_by_fkey;

ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ─── 4b. deal_field_values.updated_by ────────────────────────────────────────

ALTER TABLE public.deal_field_values
  DROP CONSTRAINT IF EXISTS deal_field_values_updated_by_fkey;

ALTER TABLE public.deal_field_values
  ADD CONSTRAINT deal_field_values_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ─── 4c. deal_participants.user_id ───────────────────────────────────────────

ALTER TABLE public.deal_participants
  DROP CONSTRAINT IF EXISTS deal_participants_user_id_fkey;

ALTER TABLE public.deal_participants
  ADD CONSTRAINT deal_participants_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- ─── 4d. deals.created_by ────────────────────────────────────────────────────

ALTER TABLE public.deals
  DROP CONSTRAINT IF EXISTS deals_created_by_fkey;

ALTER TABLE public.deals
  ADD CONSTRAINT deals_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ─── 4e. packets.created_by ──────────────────────────────────────────────────

ALTER TABLE public.packets
  DROP CONSTRAINT IF EXISTS packets_created_by_fkey;

ALTER TABLE public.packets
  ADD CONSTRAINT packets_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ─── 4f. templates.created_by ────────────────────────────────────────────────

ALTER TABLE public.templates
  DROP CONSTRAINT IF EXISTS templates_created_by_fkey;

ALTER TABLE public.templates
  ADD CONSTRAINT templates_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ─── 5. Drop obsolete tables ──────────────────────────────────────────────────

-- Remove profile FK first so drop cascades cleanly
ALTER TABLE public.profiles    DROP CONSTRAINT IF EXISTS profiles_user_id_fkey;
ALTER TABLE public.user_roles  DROP CONSTRAINT IF EXISTS user_roles_user_id_fkey;

DROP TABLE IF EXISTS public.profiles;
DROP TABLE IF EXISTS public.user_roles;

-- ─── 6. Drop RLS policies ─────────────────────────────────────────────────────
-- All authorization is now handled at the NestJS API layer.

-- contacts
DROP POLICY IF EXISTS "Users can view their own contacts"      ON public.contacts;
DROP POLICY IF EXISTS "Admins and CSRs can view all contacts"  ON public.contacts;
DROP POLICY IF EXISTS "Admins and CSRs can manage contacts"    ON public.contacts;

-- deals
DROP POLICY IF EXISTS "Users can view accessible deals"        ON public.deals;
DROP POLICY IF EXISTS "CSRs and Admins can manage deals"       ON public.deals;

-- deal_participants
DROP POLICY IF EXISTS "CSRs and Admins can view all"           ON public.deal_participants;
DROP POLICY IF EXISTS "External users can view their own"      ON public.deal_participants;
DROP POLICY IF EXISTS "CSRs and Admins can manage"             ON public.deal_participants;

-- deal_assignments
DROP POLICY IF EXISTS "CSRs and Admins can view all"           ON public.deal_assignments;
DROP POLICY IF EXISTS "CSRs and Admins can manage"             ON public.deal_assignments;
DROP POLICY IF EXISTS "CSRs and Admins can update"             ON public.deal_assignments;
DROP POLICY IF EXISTS "CSRs and Admins can delete"             ON public.deal_assignments;
DROP POLICY IF EXISTS "External users can view their own"      ON public.deal_assignments;

-- deal_field_values
DROP POLICY IF EXISTS "Users can view accessible field values" ON public.deal_field_values;
DROP POLICY IF EXISTS "Users can edit accessible field values" ON public.deal_field_values;

-- field_permissions
DROP POLICY IF EXISTS "Anyone authenticated can view"          ON public.field_permissions;
DROP POLICY IF EXISTS "Admins can manage"                      ON public.field_permissions;

-- magic_links
DROP POLICY IF EXISTS "CSRs and Admins can view magic links"   ON public.magic_links;
DROP POLICY IF EXISTS "CSRs and Admins can create magic links" ON public.magic_links;
DROP POLICY IF EXISTS "CSRs and Admins can update magic links" ON public.magic_links;
DROP POLICY IF EXISTS "CSRs and Admins can delete magic links" ON public.magic_links;

-- system_settings
DROP POLICY IF EXISTS "Admins can manage settings"             ON public.system_settings;
DROP POLICY IF EXISTS "Anyone authenticated can view settings"  ON public.system_settings;

-- user_form_permissions
DROP POLICY IF EXISTS "Users can view their own permissions"    ON public.user_form_permissions;
DROP POLICY IF EXISTS "Admins can manage all permissions"       ON public.user_form_permissions;

-- user_permission_levels
DROP POLICY IF EXISTS "Users can view their own level"          ON public.user_permission_levels;
DROP POLICY IF EXISTS "Admins can manage permission levels"     ON public.user_permission_levels;

-- ─── 7. Drop auth helper functions ───────────────────────────────────────────

DROP FUNCTION IF EXISTS public.has_role(UUID, TEXT);
DROP FUNCTION IF EXISTS public.has_role(UUID, app_role);
DROP FUNCTION IF EXISTS public.get_user_role(UUID);
DROP FUNCTION IF EXISTS public.has_deal_access(UUID, UUID);
DROP FUNCTION IF EXISTS public.can_view_field(UUID, UUID);
DROP FUNCTION IF EXISTS public.can_edit_field(UUID, UUID);
DROP FUNCTION IF EXISTS public.is_external_role(UUID);

-- ─── 8. Drop Supabase auth triggers ──────────────────────────────────────────

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- ─── 9. Disable RLS on all public tables (NestJS enforces access) ─────────────

ALTER TABLE public.contacts             DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals                DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_participants    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_assignments     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_field_values    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_section_values  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_permissions    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_permissions     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.magic_links          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_form_permissions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_permission_levels DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_journal        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates            DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.packets              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_documents  DISABLE ROW LEVEL SECURITY;

COMMIT;
