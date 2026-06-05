# Services layer

All API access lives under `src/services/`. UI code (pages, components, hooks) must call these services instead of reaching into `@/integrations/` directly.

## Layout

| Path | Responsibility |
|------|----------------|
| `node-api/` | NestJS API client (`apiClient`), auth refresh, SSE realtime |
| `storage/` | File upload/download/delete — proxied through NestJS backend |
| `contacts/` | Contacts CRUD, attachments |
| `deals/` | Deals, participants, section values, loan history, assignments |
| `documents/` | Templates, packets, field maps, generation |
| `admin/` | Field dictionary, permissions, users, profiles, form permissions |
| `system/` | Settings, magic links, activity log, event journal, messages |

## Import rules

- Domain types: import from `@/types` (enums, row shapes)
- Storage helpers: import from `@/services/storage`
- API client: import from `@/services/node-api/client`
- All other services: import from `@/services/<domain>/...`

## What's gone

The `src/services/supabase/` folder has been removed. All data access goes through the NestJS backend. When the S3 migration happens, only `backend/src/storage/storage.service.ts` changes.
