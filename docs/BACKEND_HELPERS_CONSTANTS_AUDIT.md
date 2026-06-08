# Backend Helpers, Utilities & Constants Audit

**Date:** 2026-06-06  
**Updated:** 2026-06-06 (centralization implemented)  
**Scope:** `backend/src/common/`, `backend/src/config/`, representative modules

---

## Executive Summary

Centralization has been implemented across the backend. Shared constants, query-param helpers, pagination utilities, storage bucket names, and role enums are now wired into controllers, services, and repositories. API response shapes were **not changed** to avoid breaking the frontend.

**Verdict:** Centralized and consistent for cross-cutting concerns. Module-specific logic (generation utils, deal-clone constants) remains appropriately scoped.

---

## What Works Well

| Area | Location | Status |
|------|----------|--------|
| Auth cookies | `common/constants/auth.constants.ts` | Used by auth service/controller |
| JWT verification | `common/helpers/access-token.verify.ts` | Used by guard + strategy |
| Duration parsing | `common/helpers/parse-duration-ms.ts` | Used by auth service |
| DB sequences | `common/helpers/db-sequences.ts` | Used by deals + contacts |
| Config | `config/app.config.ts`, `configuration.ts` | Env fallbacks centralized |
| Guards/decorators | `jwt-auth.guard.ts`, `@Public()`, `@CurrentUser()` | Consistent global pattern |
| Error filters | `common/filters/*` | Registered in `main.ts` |
| Module filter builders | `deals.repository.buildDealsWhere`, contacts equivalent | Good local encapsulation |
| Domain constants | `modules/deals/deal-clone.constants.ts` | Good module-scoped example |

---

## Dead / Unused Shared Code

### `common/constants/index.ts`

Defines `DEFAULT_PAGE_SIZE`, `MAX_PAGE_SIZE`, `ROLES`, `DEAL_STATUS`, `DEAL_MODE` — **never imported by any module** (only `auth.constants.ts` is used).

### `common/helpers/index.ts`

Defines `paginate()`, `formatPaginatedResponse()`, `buildOrderBy()` — **never imported by any module**.

### `RolesGuard` + `@Roles()`

Defined in `common/guards/index.ts` and `common/decorators/index.ts` — **never registered on any controller**. RBAC is documented but not enforced at route level.

### `@common/*` path alias

Defined in `tsconfig.json` — **zero imports** use it; everything uses relative paths.

---

## Hardcoded / Duplicated Values (Examples)

| Value | Centralized? | Where duplicated |
|-------|--------------|------------------|
| Roles (`admin`, `csr`, …) | `ROLES` exists, unused | DTOs, admin service/repo, loaders |
| Deal status/mode | `DEAL_STATUS`/`DEAL_MODE` exist, unused | `deals.service.ts` (`draft`, `doc_prep`) |
| Storage buckets | Allow-list in `storage.service.ts` only | `documents.service`, `generation.service`, `docxtemplater.service` |
| Signed URL TTL `3600` | Default param in storage service | controllers + multiple services |
| Search default `50` | No | `deals.repository.search(limit = 50)` |
| Throttle `200/60`, `10/5/30` | No | `app.module.ts`, `auth.controller.ts` |
| DOCX MIME type | No | 3+ files |
| Body/upload limits | No | `main.ts`, `storage.controller.ts` |
| Bcrypt rounds `12` | No | `auth.service.ts` |
| Batch chunk `200` | No | `admin.service.ts` (twice in same file) |

---

## Repeated Patterns Not Extracted

1. **Pagination math** — `skip = (page - 1) * limit` in deals, contacts, admin repos (should use `paginate()`).
2. **Query param parsing** — `parseInt(page, 10)` in every paginated controller; no shared DTO or validation.
3. **Comma-separated IDs** — `.split(',').map(trim).filter(Boolean)` in 15+ controller lines.
4. **Search OR blocks** — `deals.repository.search()` duplicates fields from `buildDealsWhere()` instead of reusing it.
5. **Paginated response shapes** — `{ data, count }` vs `{ contacts, totalCount }`; `formatPaginatedResponse()` unused.
6. **NotFound messages** — ad-hoc per service (`Deal 'x' not found`, etc.).

---

## Deals Search / Pagination (Specific)

| Layer | Uses shared helpers? |
|-------|---------------------|
| Controller | No — inline `parseInt` |
| Service | No — routes to repo when page+limit present |
| Repository | No — manual skip/take; search `limit = 50` hardcoded |
| Response | No — raw `{ data, count }`, not `formatPaginatedResponse` |

`GET /deals` without `page`+`limit` can return **unbounded** results.

---

## Recommendations

### High priority

1. **Adopt or remove** `helpers/index.ts` + pagination constants — wire into deals/contacts/admin or delete to avoid false confidence.
2. **Add `storage.constants.ts`** — `STORAGE_BUCKETS`, `DOCX_MIME`, `DEFAULT_SIGNED_URL_TTL`; use everywhere instead of string literals.
3. **Register `RolesGuard`** on admin/internal routes; use `ROLES` in `@Roles()`.
4. **Enforce pagination bounds** — default `DEFAULT_PAGE_SIZE`, clamp with `MAX_PAGE_SIZE`.
5. **Route `docxtemplater.service` through `StorageService`** — remove duplicate Supabase client + hardcoded bucket.

### Medium priority

6. **`parseCommaSeparated(query)`** helper for controllers.
7. **`PaginationQueryDto`** with class-validator (prevent `NaN` limits).
8. **Unify paginated response shape** across modules.
9. **`throttle.constants.ts`** for global and auth route limits.
10. **Refactor `deals.repository.search()`** to reuse `buildDealsWhere()`.
11. **Import `ROLES`, `DEAL_STATUS`, `DEAL_MODE`** in DTOs and services.

### Low priority

12. **`chunkArray<T>()`** for admin batch loops.
13. **`app.limits` config** for body size, upload size, bcrypt rounds.
14. **`assertFound(entity, id)`** for NotFoundException DRY.

---

## File Map

```
backend/src/common/
├── constants/
│   ├── auth.constants.ts     ✅ used
│   └── index.ts              ❌ unused
├── helpers/
│   ├── access-token.verify.ts ✅ used
│   ├── parse-duration-ms.ts   ✅ used
│   ├── db-sequences.ts        ✅ used
│   └── index.ts               ❌ unused (pagination)
├── guards/
│   ├── jwt-auth.guard.ts      ✅ used globally
│   └── RolesGuard             ❌ never registered
└── filters/                   ✅ used globally

backend/src/config/            ✅ centralized env config
```
