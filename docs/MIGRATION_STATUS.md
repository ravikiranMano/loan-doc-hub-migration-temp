# Migration Status — Lovable (Supabase) → NestJS/Prisma

**Branch:** `migration_v1`  
**Updated:** 2026-06-05  
**Goal:** Fully replace Supabase (Auth, DB, Storage, Edge Functions, Realtime) with a self-hosted NestJS + Prisma + PostgreSQL stack for compliance, auditing, and long-term control.

---

## Quick Summary

| Layer | Lovable / Original | Migration v1 Status |
|---|---|---|
| **Authentication** | Supabase Auth (JWT, magic links) | ✅ NestJS JWT + httpOnly cookies |
| **Database queries** | Supabase JS client (all domains) | ✅ NestJS/Prisma (all 5 domains flagged) |
| **Storage** | Supabase Storage (direct frontend) | ✅ NestJS proxy → Supabase Storage |
| **Document generation** | Single Supabase edge function | ✅ 4 NestJS routes (docxtemplater, XML, edge proxy, v1) |
| **Realtime** | Supabase Postgres Changes | ✅ NestJS SSE (3 polling channels) |
| **Edge functions** | 6 active functions (direct frontend) | ✅ All 6 migrated to NestJS |
| **Prisma ORM** | None (raw Supabase JS) | ✅ 30 models, 8 enums |
| **Frontend auth** | Supabase Auth SDK | ⚠️ Dual — NestJS auth exists; Supabase wrapper still present |

---

## Architecture

```
Frontend (Vite/React :8080)
        │
        ├── isNodeApiEnabled() → NestJS API (:3000)
        │       ├── Auth      → JWT cookie (15m access, 7d refresh)
        │       ├── Deals     → Prisma → PostgreSQL (Supabase DB host)
        │       ├── Documents → Prisma + DocxtemplaterService
        │       ├── Contacts  → Prisma
        │       ├── Admin     → Prisma
        │       ├── System    → Prisma
        │       └── Storage   → Supabase Storage (service_role)
        │
        └── Legacy Supabase path (still active for 5 edge functions + Realtime fallback)
                └── supabase.functions.invoke() / supabase.channel()
```

---

## What Was in Lovable (Original Supabase App)

### Authentication
- `supabase.auth.signInWithPassword()` / `signUp()` / `signOut()`
- Session stored in Supabase's anon key cookie
- Magic link participant access via `validate-magic-link` edge function
- No password hashing control — handled entirely by Supabase

### Database
- All queries via Supabase JS client `.from('table').select()` / `.insert()` / `.update()`
- RLS (Row Level Security) policies enforced by Supabase
- No ORM — raw table names and column names in every service file
- `auth.users` table for users; `profiles`, `user_roles` separate tables

### Storage
- Direct `supabase.storage.from('bucket').upload()` calls from frontend
- Frontend held service_role equivalent access (risky)
- Buckets: `contact-attachments`, `templates`, `generated-docs`

### Document Generation
- Single Deno edge function: `supabase/functions/generate-document/index.ts`
- fflate (WASM ZIP), regex merge-tag replacement
- Called directly from frontend via `invokeFunctionWithAuth()`

### Realtime
- `supabase.channel().on('postgres_changes', ...)` subscriptions
- Live in: `DealDocumentsPage`, `InviteParticipantsPanel`, `useEntryOrchestration`, `DealsPage`

### Edge Functions (all called directly from frontend)
1. `generate-document` — Document generation
2. `validate-template` — Template validation
3. `send-participant-invite` — Email invitations
4. `send-message` — Messaging
5. `complete-participant-section` — Participant data submission
6. `validate-magic-link` — Magic link verification

---

## What Migration v1 Has Delivered

### ✅ Backend — NestJS (10 Modules, 120 Files)

| Module | Description |
|---|---|
| `auth` | JWT login/register/logout/refresh, bcrypt, httpOnly cookies |
| `deals` | CRUD + SSE realtime (3 polling channels at 3s intervals) |
| `documents` | Templates, packets, field maps, merge tags, 4 generation paths |
| `generation` | Ported Supabase edge function (fflate + XML merge-tag engine) |
| `contacts` | Borrower, broker, lender contact management |
| `admin` | Admin user management |
| `system` | Field dictionary, form permissions, system settings |
| `storage` | Upload/download/delete proxy → Supabase Storage |
| `health` | Health check endpoint |

### ✅ Authentication — Fully Migrated

| Item | Detail |
|---|---|
| Access token | JWT, HS256, 15m, `JWT_SECRET` in `backend/.env` |
| Refresh token | SHA-256 hashed, 7 days, stored in `public.refresh_tokens` via Prisma |
| Cookies | httpOnly, SameSite=strict, Secure in prod |
| Users table | `public.users` replaces `auth.users` + `profiles` + `user_roles` |
| Password migration | Existing Supabase `encrypted_password` values copied — no user reset needed |
| Session expiry | `SessionExpiredError` class → redirect to `/auth` on 401 |

### ✅ Document Generation — 4 Paths

| Route | Engine | Persists | Notes |
|---|---|---|---|
| `POST /api/deals/:id/documents/generate` | DocxtemplaterService | ✅ Job + document | Primary NestJS path |
| `POST /api/deals/:id/documents/generate-api` | GenerationService (XML) | ✅ Job + document | Ported edge function |
| `POST /api/deals/:id/documents/generate-edge` | Supabase edge function (proxy) | ✅ Job + document | Fallback via service_role |
| `POST /api/generation/deals/:id/generate` | GenerationService (v1) | ✅ Job + document | Legacy v1 endpoint |

**Supporting endpoints:**
- `GET /api/deals/:id/documents/preview-payload?templateId=X` — dry-run merge preview
- `GET /api/deals/:id/documents` — list generated documents
- `GET /api/deals/:id/documents/jobs` — job history

### ✅ Realtime — SSE Polling (NestJS)

Replaced Supabase Postgres Changes with three polling SSE streams:

| Endpoint | Polls | Interval |
|---|---|---|
| `GET /api/deals/events` | `deals` table for any change | 3s |
| `GET /api/deals/:id/participants/events` | `deal_participants` for this deal | 3s |
| `GET /api/deals/:id/documents/events` | `generated_documents` + `generation_jobs` | 3s |

Frontend adapter at `src/services/node-api/realtime.ts` tries SSE first, falls back to Supabase if unrecognised.

### ✅ Prisma ORM — 30 Models, 8 Enums

**Key models:**

| Model | Purpose |
|---|---|
| `users` | Internal + external users (no Supabase auth) |
| `deals` | Core loan deal records |
| `deal_section_values` | JSONB field storage per section |
| `deal_participants` | Borrower/broker/lender external access |
| `contacts` | All contact profiles |
| `templates` / `packets` | Document templates and bundles |
| `generated_documents` | DOCX/PDF output records |
| `generation_jobs` | Per-generation task history |
| `template_field_maps` | Field → template mapping + transform rules |
| `merge_tag_aliases` | Template merge-tag resolution |
| `field_dictionary` | All field definitions and metadata |
| `magic_links` | Participant magic-link tokens |
| `refresh_tokens` | JWT refresh rotation |
| `loan_history` / `loan_history_lenders` | Payment history |
| `activity_log` / `event_journal` | Audit trails |

**Enums:** `app_role`, `deal_mode`, `deal_status`, `field_data_type` (23 types), `field_section` (38 sections), `generation_status`, `merge_tag_type`, `output_type`

### ✅ Storage — Fully Proxied

All storage calls now go through NestJS (`StorageController` → `StorageService`):
- Buckets: `contact-attachments`, `templates`, `generated-docs`
- Frontend zero-change required for S3 migration — only `StorageService` needs updating
- `src/services/supabase/storage.ts` routes entirely to Node API

---

### ✅ Edge Functions — All 6 Migrated to NestJS

All edge function wrappers in `src/services/supabase/functions.ts` are defined but **completely unused** — nothing imports them. Each function has a NestJS endpoint and the frontend calls it via `apiClient`.

| Function | NestJS Endpoint | Frontend Service |
|---|---|---|
| `send-participant-invite` | `POST /api/deals/:id/participants/:pid/invite` | `src/services/deals/participants-invite.service.ts` |
| `send-message` | `POST /api/system/messages` | `src/services/system/messages.service.ts` |
| `complete-participant-section` | `POST /api/deals/:id/participants/:pid/complete` | `useEntryOrchestration.ts` (with isNodeApiEnabled guard) |
| `validate-magic-link` | `POST /api/deals/magic-links/validate` (@Public, no auth) | `src/services/system/magic-links.service.ts` |
| `validate-template` | `POST /api/templates/:id/validate` | `src/services/documents/template-validate.service.ts` |
| `generate-document` | 4 NestJS routes (see generation section above) | `src/services/documents/generation.service.ts` |

---

## What Is Still Incomplete

### ⚠️ Frontend Auth — Dual State

The frontend still imports `src/services/supabase/auth.ts` (`supabase.auth.*`) alongside the custom NestJS auth (`src/services/node-api/auth.service.ts`). Both exist in parallel.

**What needs to happen:**
- Remove all `supabase.auth.*` calls from frontend
- Use `auth.service.ts` exclusively (already handles login/logout/me/refresh)
- Delete `src/services/supabase/auth.ts`

### ⚠️ Supabase Type Imports (Cosmetic, Non-blocking)

4 files import `Database` type from Supabase integration — runtime impact is zero but should be cleaned up:
- `src/pages/csr/DealDocumentsPage.tsx`
- `src/pages/csr/DealDataEntryPage.tsx`
- `src/pages/MagicLinkAccessPage.tsx`
- `src/components/deal/InviteParticipantsPanel.tsx`

### ⚠️ Event Journal — Supabase Direct Call

`src/services/system/event-journal.service.ts` calls `supabase.from('event_journal').insert()` without a Node API route. Needs a `POST /api/system/event-journal` endpoint.

### ⚠️ Contacts — Embedded Supabase Call

`src/services/contacts/contacts.service.ts` (~line 414, inside `updateContactWithMerge()`) calls `supabase.from('deal_participants')` directly without an `isNodeApiEnabled` guard.

---

## Configuration Reference

### Frontend `.env`
```
VITE_USE_NODE_API="system,admin,contacts,documents,deals"
VITE_NODE_API_URL="http://localhost:3000/api"
VITE_SUPABASE_PROJECT_ID="pibqnspfzqylceyonkia"
VITE_SUPABASE_URL="https://pibqnspfzqylceyonkia.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_..."
```

### Backend `backend/.env`
```
PORT=3000
CORS_ORIGIN=http://localhost:8080
JWT_SECRET="..."                        ← replace with 64-char random hex before prod
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_DAYS=7
SUPABASE_URL="https://pibqnspfzqylceyonkia.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="eyJhbGci..."
DATABASE_URL="postgresql://..."         ← pooled (pgbouncer) for runtime
DIRECT_URL="postgresql://..."          ← direct for Prisma CLI
```

**Missing (needed for `mintSupabaseAccessToken()`):**
```
SUPABASE_JWT_SECRET="..."   ← legacy HS256 secret from Supabase Dashboard → Settings → API → Legacy JWT Secret
```

---

## Remaining Work — Ordered by Priority

| Priority | Task | Effort |
|---|---|---|
| 1 | Remove `supabase.auth.*` from frontend — use NestJS auth exclusively | Medium |
| 2 | Add `POST /api/system/event-journal` endpoint | Low |
| 3 | Fix contacts `updateContactWithMerge()` to use Node API | Low |
| 4 | Add `SUPABASE_JWT_SECRET` to `backend/.env` + redeploy `generate-document` edge (for fallback) | Low |
| 5 | Strip Supabase type imports from 4 frontend files | Low |
| 6 | Strip `supabase.from()` fallback branches from service files (dead code cleanup) | Low |
| 7 | Delete `src/services/supabase/functions.ts` (all wrappers unused) | Low |
| 8 | Delete `src/services/supabase/auth.ts` (after auth frontend migration) | Low |
| 9 | Remove `VITE_SUPABASE_*` env vars (once Supabase client removed entirely) | Last |
| 10 | Replace Supabase Storage with S3 in `StorageService` | Future |

---

## Key File Locations

| Area | File |
|---|---|
| NestJS entry | `backend/src/main.ts` |
| Auth module | `backend/src/modules/auth/` |
| Documents module | `backend/src/modules/documents/` |
| Generation engine | `backend/src/modules/generation/generation.service.ts` |
| Deals + SSE | `backend/src/modules/deals/deals.controller.ts` (lines 210–252) |
| Prisma schema | `backend/prisma/schema.prisma` |
| Prisma migrations | `backend/prisma/migrations/` |
| Node API client | `src/services/node-api/client.ts` |
| Node API auth | `src/services/node-api/auth.service.ts` |
| SSE adapter | `src/services/node-api/realtime.ts` |
| Edge functions | `supabase/functions/` |
| Generation service (frontend) | `src/services/documents/generation.service.ts` |
| Storage proxy | `src/services/supabase/storage.ts` |
