# Supabase services layer

All client-side Supabase access lives under `src/services/`. UI code (pages, components, hooks) must call these services instead of importing `@/integrations/supabase/client`.

## Layout

| Path | Responsibility |
|------|----------------|
| `supabase/` | Client re-export, auth, RPC, storage, edge functions, realtime, pagination |
| `contacts/` | Contacts CRUD, `getContactContactData` / `patchContactData`, attachments |
| `deals/` | Deals, participants, section values, loan history, assignments |
| `documents/` | Templates, packets, field maps, generation |
| `admin/` | Field dictionary, permissions, users, profiles, form permissions |
| `system/` | Settings, magic links, activity log, event journal, messages |

## Import rules

- Allowed: `@/services/...`, `@/services/supabase/types` for types
- Forbidden outside services: `@/integrations/supabase/client`

## Deprecated

- `@/lib/supabasePagination` — use `@/services/supabase/pagination`
