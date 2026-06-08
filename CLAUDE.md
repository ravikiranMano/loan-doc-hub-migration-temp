# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Repository Layout

Frontend-only repository. The NestJS backend is a separate deployment — this repo contains only the React app and Supabase edge functions.

| Path | Purpose |
|---|---|
| `/` | React 18 + Vite frontend (port 8080) |
| `/supabase/functions/` | Deno edge functions — `generate-document` only |
| `/src/services/` | All API calls to the NestJS backend |
| `/src/lib/` | Pure utilities — calculation engine, cn helper |
| `/src/contexts/` | React contexts — auth, theme |
| `/src/hooks/` | Custom hooks |
| `/src/components/` | UI components (shadcn-based) |
| `/src/pages/` | Route-level page components |

---

## Commands

### Frontend (run from repo root)
```bash
npm run dev             # Vite dev server → http://localhost:8080
npm run build           # Production build
npm run lint            # ESLint (typescript-eslint + react-hooks)
npm run test            # Vitest unit tests (single run)
npm run test:watch      # Vitest watch mode
```

### Type checking
```bash
npx tsc --noEmit
```

### Edge functions
```bash
supabase functions deploy generate-document   # Redeploy after any change to supabase/functions/generate-document/
```

---

## Environment

Single env file at repo root consumed by Vite.

| File | Consumed by |
|---|---|
| `.env` (root) | Vite frontend — `VITE_NODE_API_URL` only |

`VITE_NODE_API_URL` points to the NestJS API base URL (e.g. `http://localhost:3000/api` in development).

**Hard security rules:**
- Backend secrets (`DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc.) must never appear in this repo or root `.env`
- `credentials: 'include'` is used on every API call — `Access-Control-Allow-Origin: *` is forbidden on authenticated endpoints
- httpOnly cookies with `secure: true` in production, `sameSite: lax`

---

## Architecture

### Overview

```
Browser (React/Vite :8080)
  └── apiClient (src/services/client.ts)
        └── NestJS API (:3000)
              ├── Prisma ORM → PostgreSQL (Supabase-hosted)
              ├── StorageService → Supabase Storage (service_role)
              └── fetch() → Supabase Edge Functions (generate-document)
```

The Supabase browser client (`src/integrations/supabase/`) is fully decommissioned. All traffic goes through the NestJS API.

### Authentication

The backend issues its own JWT — **not Supabase Auth**.

**Token lifecycle:**
- Access token: HS256, 1h TTL, stored in `access_token` httpOnly cookie
- Refresh token: opaque random, 7-day TTL, stored in `refresh_token` httpOnly cookie scoped to `/api/auth`

**Frontend auth** (`src/contexts/AuthContext.tsx`):
- `AuthProvider` restores session on mount via `getMe()`
- Refreshes token on tab focus (min 60s between refreshes)
- On 401, `apiClient` automatically attempts one token refresh before throwing `SessionExpiredError`
- Roles: `EXTERNAL_ROLES = ['borrower', 'broker', 'lender']`, `INTERNAL_ROLES = ['admin', 'csr']`

### Frontend API Client

`src/services/client.ts` — the only HTTP transport layer:
- All requests include `credentials: 'include'` (httpOnly cookie auth — no Authorization header)
- 401 response triggers automatic token refresh via a shared promise (prevents parallel refresh races)
- `SessionExpiredError` is thrown when refresh also fails — `AuthContext` catches this and redirects to `/auth`
- `apiClient.get<T>()`, `.post<T>()`, `.patch<T>()`, `.put<T>()`, `.delete<T>()` are the standard wrappers
- `uploadFile(bucket, path, file)` for multipart uploads to `/storage/{bucket}/upload`

### Services Layout

```
src/services/
  client.ts          # Core HTTP client — apiClient, apiFetch, uploadFile, SessionExpiredError
  realtime.ts        # SSE subscription wrapper (subscribeToChanges)
  auth-service/
    auth.service.ts  # login, register, logout, getMe, updateMe
  contacts/          # CRUD + attachments
  deals/             # Deals, participants, field values, loan history
  documents/         # Templates, packets, field maps, generation
  admin/             # Field dictionary, users, permissions
  system/            # Settings, activity log, event journal, messages
  storage/           # File upload/download via NestJS proxy
```

**ESLint enforces this**: importing from `@/integrations/supabase/client` in UI code is a lint error. Always import from `@/services/`.

### Realtime

Supabase Postgres Changes are replaced with NestJS SSE. `src/services/realtime.ts` manages subscriptions for three channels: deal list updates, deal participant changes, and document generation events. Components call `subscribeToChanges()` and get an `{ unsubscribe }` handle back.

### Storage

All file operations go through the NestJS storage proxy (never directly to Supabase from the browser). Active buckets: `contact-attachments`, `templates`, `generated-docs`.

- Upload: `uploadFile(bucket, path, file)` from `src/services/client.ts`
- Download / signed URLs: via `src/services/storage/index.ts`

### Document Generation

Three generation endpoints on the backend — frontend calls these via `src/services/documents/generation.service.ts`:

| Route | Engine | Persists DB records |
|---|---|---|
| `POST /deals/:id/documents/generate` | docxtemplater | Yes (job + generated_doc) |
| `POST /deals/:id/documents/generate-edge` | Deno edge function (proxy) | Yes |
| `POST /deals/:id/documents/generate-v2` | docxtemplater, streams DOCX | No |

Supporting endpoints:
- `GET /deals/:id/documents/field-data-v2` — returns resolved field data object (useful for debugging)
- `POST /templates/:id/validate` — inspects DOCX for unmapped merge tags

**Template requirements for v2/docxtemplater**: placeholders must be clean `{{field_key}}` syntax — no split runs, no Word MERGEFIELD markup.

### Role-Based Access

`RoleGuard` component wraps routes in `src/App.tsx`. Reads `user.role` and `user.user_type` from `AuthContext`.

Roles: `admin`, `csr` (internal); `borrower`, `broker`, `lender` (external, restricted to their own deal data).

### Loan Calculation Engine

`src/lib/calculationEngine.ts` — pure TypeScript, no dependencies. Contains all loan fee and payment calculations. Used by deal data forms. Changes here require re-testing affected deal section forms manually.

---

## TypeScript Conventions

- **No `as any`** — use `as unknown as T` double-cast where needed
- **`[key: string]: unknown`** not `[key: string]: any` for index signatures
- **Comments**: only when the WHY is non-obvious (hidden constraint, workaround, invariant). Never describe what the code does
- Frontend path alias: `@/` → `src/`
- `cn(...classes)` from `src/lib/utils.ts` — use for all Tailwind class merging (wraps `clsx` + `twMerge`)

---

## Workflow Rules

- **Analyze before modifying**: produce a written plan or report first — do not edit files until explicitly approved
- **Type check after changes**: run `npx tsc --noEmit` from repo root after any frontend change
- **Database access**: use the Supabase MCP server (`mcp__supabase__execute_sql`) — not CLI Bash commands
- **Scope discipline**: only modify files explicitly in scope; list intended changes before applying them
