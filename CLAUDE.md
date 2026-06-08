# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Repository Layout

Monorepo with two independent packages — frontend at root, backend in `/backend`.

| Path | Purpose |
|---|---|
| `/` | React 18 + Vite frontend (port 8080) |
| `/backend` | NestJS API server (port 3000) |
| `/backend/prisma/` | Prisma schema + migrations |
| `/backend/src/generated/prisma/` | Generated Prisma client (gitignored — run `db:generate`) |
| `/supabase/functions/` | Deno edge functions (called via NestJS proxy only) |
| `/docs/` | Architecture docs, migration status, **docxtemplater conversion guide** |

---

## Commands

### Frontend (run from repo root)
```bash
npm run dev             # Vite dev server → http://localhost:8080
npm run build           # Production build
npm run lint            # ESLint (typescript-eslint + react-hooks)
npm run test            # Vitest unit tests (single run)
npm run test:watch      # Vitest watch mode
npm run test:e2e        # Playwright E2E — all suites
npm run test:e2e:deals  # Playwright — deals suite only
npm run test:e2e:admin  # Playwright — admin suite (chromium-admin project)
```

### Backend (run from `/backend`)
```bash
npm run start:dev       # NestJS watch mode → http://localhost:3000
npm run build           # nest build → dist/
npm run start:prod      # node dist/main (after build)
npm run lint            # ESLint --fix on src/
npm run test            # Jest
npm run test:cov        # Jest with coverage report
```

### Database (run from `/backend`)
```bash
npm run db:generate      # Regenerate Prisma client — run after any schema.prisma change
npm run db:pull          # Introspect live DB → update schema.prisma
npm run db:studio        # Prisma Studio browser UI
npm run db:migrate:dev   # Create + apply migration (dev only — prompts for name)
npm run db:migrate:deploy # Apply pending migrations (prod/CI)
```

### Type checking
```bash
# Frontend (repo root)
npx tsc --noEmit

# Backend (/backend)
npx tsc --noEmit
```

### Edge functions
```bash
supabase functions deploy generate-document   # Redeploy after any change to supabase/functions/generate-document/
```

---

## Environment

Two separate env files — they are **never** shared between frontend and backend.

| File | Consumed by |
|---|---|
| `.env` (root) | Vite frontend — `VITE_NODE_API_URL` only |
| `backend/.env` | NestJS — all server secrets |

`backend/.env.example` is the canonical reference for all backend vars:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Pooled connection (pgbouncer, port 6543) — runtime queries |
| `DIRECT_URL` | Direct connection (port 5432) — migrations only |
| `JWT_SECRET` | 64-char hex — signs NestJS-issued access tokens |
| `JWT_EXPIRES_IN` | Access token TTL (default `1h`) |
| `JWT_REFRESH_EXPIRES_DAYS` | Refresh token TTL (default `7`) |
| `SUPABASE_URL` | Project URL — storage proxy + edge function calls |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses RLS — backend only, never exposed to browser |
| `SUPABASE_JWT_SECRET` | Legacy HS256 secret — edge function auth only |
| `RESEND_API_KEY` | Transactional email |
| `CORS_ORIGIN` | Explicit allowed origin (never use `*` with credentials) |

**Hard security rules:**
- `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `DIRECT_URL` must never appear in frontend code or root `.env`
- `credentials: 'include'` is used on every API call — `Access-Control-Allow-Origin: *` is forbidden on authenticated endpoints
- httpOnly cookies with `secure: true` in production, `sameSite: lax`

---

## Architecture

### Overview

```
Browser (React/Vite :8080)
  └── apiClient (src/services/node-api/client.ts)
        └── NestJS API (:3000)
              ├── Prisma ORM → PostgreSQL (Supabase-hosted)
              ├── StorageService → Supabase Storage (service_role)
              └── fetch() → Supabase Edge Functions (generate-document)
```

The Supabase browser client (`src/integrations/supabase/`) is fully decommissioned. All traffic goes through NestJS. The `src/integrations/supabase/` directory is empty.

### Authentication

The backend uses its own JWT system — **not Supabase Auth**.

**Token lifecycle:**
- Access token: HS256, signed with `JWT_SECRET`, 1h TTL, stored in `access_token` httpOnly cookie
- Refresh token: 64-byte opaque random, SHA-256 hashed before DB storage, 7-day TTL, stored in `refresh_token` httpOnly cookie scoped to `/api/auth`
- `AuthService.issueTokens()` creates both; `AuthService.refresh()` rotates the refresh token on use

**Backend verification** (`backend/src/common/helpers/access-token.verify.ts`):
Token verification has two paths tried in order:
1. **NestJS HS256** — `JWT_SECRET`, issued by `AuthService.login()`
2. **Supabase JWKS ES256 → HS256 fallback** — for legacy tokens issued before the migration

**Frontend auth** (`src/contexts/AuthContext.tsx`):
- `AuthProvider` restores session on mount via `getMe()`
- Refreshes token on tab focus (min 60s between refreshes)
- Roles: `EXTERNAL_ROLES = ['borrower', 'broker', 'lender']`, `INTERNAL_ROLES = ['admin', 'csr']`

**Backend guard pattern** — used on every protected controller:
```ts
@Controller()
@UseGuards(JwtAuthGuard)    // validates cookie, attaches user to request
export class MyController {
  myRoute(@CurrentUser() user: JwtPayload) { ... }
}
```
- `@Public()` decorator bypasses `JwtAuthGuard` entirely
- `@Roles(...)` sets metadata for role-based guards

**Cookie constants** (`backend/src/common/constants/auth.constants.ts`):
- `COOKIE_ACCESS_TOKEN = 'access_token'`
- `COOKIE_REFRESH_TOKEN = 'refresh_token'`
- `COOKIE_REFRESH_PATH = '/api/auth'`

### Frontend API Client

`src/services/node-api/client.ts` — the only HTTP client used in the frontend:
- All requests include `credentials: 'include'` (httpOnly cookie auth — no Authorization header)
- 401 response triggers automatic token refresh via a shared promise (prevents parallel refresh races)
- `SessionExpiredError` is thrown when refresh also fails — `AuthContext` catches this and redirects to `/auth`
- `apiClient.get<T>()`, `.post<T>()`, `.patch<T>()`, `.put<T>()`, `.delete<T>()` are the standard wrappers
- `uploadFile(bucket, path, file)` for multipart uploads to `/storage/{bucket}/upload`

All feature services in `src/services/` call `apiClient` — they never call Supabase directly:

```
src/services/
  node-api/     # client.ts, auth.service.ts, realtime.ts (SSE)
  contacts/     # CRUD + attachments
  deals/        # Deals, participants, field values, loan history
  documents/    # Templates, packets, field maps, generation
  admin/        # Field dictionary, users, permissions
  system/       # Settings, activity log, event journal, messages
  storage/      # File upload/download via NestJS proxy
```

**ESLint enforces this**: importing from `@/integrations/supabase/client` in UI code is a lint error. Always import from `@/services/`.

### Backend Module Pattern

Every NestJS module follows: `controller → service → repository → Prisma`.

```
backend/src/modules/
  auth/         # Login, register, refresh, logout, magic links, getMe
  deals/        # Deal CRUD, participants, field values, loan history, event journal
  contacts/     # Contacts (borrower/lender/broker) + attachments
  documents/    # Templates, packets, field maps, merge tags, doc generation
  generation/   # Raw XML merge engine (GenerationService)
  admin/        # Field dictionary, permissions, user management
  storage/      # Supabase storage proxy (service_role key, bypasses RLS)
  system/       # App settings, messages, activity log
  health/       # GET /health
```

**Cross-cutting infrastructure** (`backend/src/common/`):
- `guards/jwt-auth.guard.ts` — JWT verification, attaches `JwtPayload` to `request.user`
- `decorators/index.ts` — `@CurrentUser()`, `@Public()`, `@Roles()`
- `filters/all-exceptions.filter.ts` — outermost catch-all (registered first in main.ts)
- `filters/http-exception.filter.ts` — inner HTTP 4xx/5xx handler
- `helpers/access-token.verify.ts` — two-path token verification logic
- `constants/auth.constants.ts` — cookie name constants

Global rate limit: 200 requests per 60 seconds (ThrottlerModule, overridable per-route with `@Throttle()`).

### Database Access

`PrismaService` (`backend/src/prisma/prisma.service.ts`) uses the `@prisma/adapter-pg` adapter with a `pg.Pool` for connection pooling. Import:

```ts
import { PrismaService } from '../../prisma/prisma.service';
// Prisma types:
import { Prisma, $Enums } from '../generated/prisma';
```

Prisma schema has 30+ models across deals, contacts, documents, users, permissions, and audit tables. The generated client lives at `backend/src/generated/prisma/` — always run `db:generate` after schema changes.

**Write patterns** (no `as any`):
```ts
// Prisma write casts
data: dto as unknown as Prisma.dealsUncheckedCreateInput

// JSONB columns
action_details: { ... } as Prisma.InputJsonValue

// Enum columns
role: value as $Enums.app_role
output_type: value as $Enums.output_type
```

`UncheckedCreateInput` / `UncheckedUpdateInput` variants accept flat scalar FK values without relation syntax — prefer them over the relation-syntax variants for direct repository writes.

### Document Generation

Three active generation routes in `DocumentsController`:

| Route | Engine | Persists DB records |
|---|---|---|
| `POST /deals/:id/documents/generate` | docxtemplater | Yes (job + generated_doc) |
| `POST /deals/:id/documents/generate-edge` | Deno edge function (proxy) | Yes |
| `POST /deals/:id/documents/generate-v2` | docxtemplater, streams DOCX | No |

**generate (docxtemplater path)** — `DocxtemplaterService.generate()`:
1. `DocumentDataService.buildTemplateData()` — load deal + template + field values
2. `enrichFieldDataFromFilePath()` — inspect DOCX structure
3. Render via docxtemplater with `AngularExpressionParser` (supports `{{#if}}`, `{{^not}}`)
4. Upload result to `generated-docs` Supabase bucket
5. Write `generation_jobs` + `generated_documents` records

**Template requirements for v2/docxtemplater**: placeholders must be clean `{{field_key}}` syntax — no split runs, no Word MERGEFIELD markup. Use `POST /templates/:id/validate` or **Inspect field data** before use.

### Converting templates v1 (Edge) → v2 (docxtemplater)

**Full guide:** `docs/DOCXTEMPLATER_TEMPLATE_CONVERSION.md`  
**Cursor rule:** `.cursor/rules/docxtemplater-template-conversion.mdc`

**Input:** template **name or ID** (source / v1 row).  
**Output:** local `{slug}-v2.docx` + **`{baseName}_vDT`** row in Template Management.

**`_vDT` policy:** If `{baseName}_vDT` already exists → **ask permission** before updating storage/DB. If not → **create** `{baseName}_vDT` and upload converted DOCX. Never overwrite the production source template.

**Content rule:** align tags and structure for v2 (split-run merge, v2 conditionals, loops for duplicate blocks) — **never remove** paragraphs, clauses, labels, table content, else branches, or merge fields.

**Engines:** v1 `generate-edge` (tag-parser, XML repair) vs v2 docxtemplater (no repair). Syntax: `#if (eq …)` → `{{#field == 'X'}}`; `_N` duplicates → `{{#properties}}` loops where equivalent.

**v2 data:** `DealFieldValuesLoader` + optional bridges (`lenders.builder`, `re851d-properties.builder`, `applyRe885Bridges`). Add bridges only when inspect shows missing fields.

**Verify:** InspectModule parse on local file; optional in-app Inspect / generate-v2; errors in backend terminal.

**generate-edge** — NestJS proxies to `supabase/functions/generate-document/index.ts`:
- Passes `X-User-Id` header (no Supabase Auth cookie); function trusts this header
- Uses `SUPABASE_SERVICE_ROLE_KEY` in Authorization header
- After any change to the edge function: `supabase functions deploy generate-document`

Supporting endpoints:
- `GET /deals/:id/documents/field-data-v2` — returns resolved field data object (useful for debugging)
- `GET /deals/:id/documents/preview-payload` — calls edge function with `previewOnly: true`
- `POST /templates/:id/validate` — inspects DOCX for unmapped merge tags

**Field resolution pipeline** (`backend/src/modules/generation/utils/`):
- `tag-parser.util.ts` — XML-level DOCX parsing, merge tag extraction (very large, ~187 KB)
- `field-resolver.util.ts` — resolves tag names to `field_dictionary.field_key` with backward-compat migrations and canonical key lookup
- `formatting.util.ts` — currency, date, percentage formatting
- `docx-processor.util.ts` — ZIP/XML manipulation pipeline

### Realtime

Supabase Postgres Changes have been replaced with NestJS SSE. The `realtime.ts` client in `src/services/node-api/` manages three polling channels. Components subscribe via the SSE endpoint and receive push events for deal updates, messages, and notifications.

### Storage

`StorageService` (`backend/src/modules/storage/storage.service.ts`) proxies all Supabase storage operations:
- Uses `service_role` key — bypasses RLS; NestJS guards enforce access control before storage calls
- `autoRefreshToken: false`, `persistSession: false` — server process, no browser session
- Allowed buckets: `contact-attachments`, `templates`, `generated-docs` (unknown bucket → 400)
- Operations: `upload()`, `download()`, `remove()`, `getSignedUrl()`

### Role-Based Access

**Frontend**: `RoleGuard` component wraps routes in `src/App.tsx`. Reads `user.role` and `user.user_type` from `AuthContext`.

**Backend**: `JwtPayload` carries `role` and `user_type`. Controllers check these directly in service methods; no dedicated `RolesGuard` is applied globally.

Roles: `admin`, `csr` (internal); `borrower`, `broker`, `lender` (external, restricted to their own deal data).

### Loan Calculation Engine

`src/lib/calculationEngine.ts` — pure TypeScript, no dependencies. Contains all loan fee and payment calculations. Used by deal data forms. Changes here require re-testing affected deal section forms manually.

---

## TypeScript Conventions

- **No `as any`** — use Prisma unchecked input types, `Prisma.InputJsonValue`, `$Enums.*`, or `as unknown as T` double-cast
- **`[key: string]: unknown`** not `[key: string]: any` for index signatures
- **`Observable<unknown>`** not `Observable<any>` for RxJS observables in interceptors
- **Comments**: only when the WHY is non-obvious (hidden constraint, workaround, invariant). Never describe what the code does
- Backend `noImplicitAny: false` but ESLint `no-explicit-any` is enforced — treat `any` as a lint error
- Frontend path alias: `@/` → `src/`; backend path alias: `@/` → `src/`, `@common/` → `src/common/`, `@modules/` → `src/modules/`
- `cn(...classes)` from `src/lib/utils.ts` — use for all Tailwind class merging (wraps `clsx` + `twMerge`)

---

## Workflow Rules

- **Analyze before modifying**: produce a written plan or report first — do not edit files until explicitly approved
- **Save deliverables to files** (`docs/*.md`) — never leave reports only in chat output
- **Schema changes**: use `prisma migrate dev` (never raw SQL). Migrations go in `backend/prisma/migrations/`
- **Build verification**: run `npx tsc --noEmit` from `/backend` after any backend change
- **Database access**: use the Supabase MCP server (`mcp__supabase__execute_sql`) — not CLI Bash commands
- **Scope discipline**: only modify files explicitly in scope; list intended changes before applying them
