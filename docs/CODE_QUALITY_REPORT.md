# Code Quality & Structure Report
**Branch:** `migration_v1` | **Date:** 2026-06-05 | **Scope:** `src/` (382 files, ~98k lines) + `backend/src/` (120 files)

---

## 1. Lint Summary

Total: **752 problems — 532 errors / 220 warnings**  
Run: `npx eslint src/`

| Rule                                       | Count | Severity | Category                   |
| --------------------------------------------| -------| ----------| ----------------------------|
| `@typescript-eslint/no-explicit-any`       | 477   | Error    | Type safety                |
| `react-hooks/exhaustive-deps`              | 198   | Warning  | React correctness          |
| `no-useless-escape`                        | 20    | Error    | Code quality               |
| `@typescript-eslint/no-unused-expressions` | 10    | Error    | Code quality               |
| `prefer-const`                             | 9     | Error    | Code quality               |
| `no-case-declarations`                     | 5     | Error    | Code quality               |
| `react-hooks/rules-of-hooks`               | 4     | Error    | **Critical** — React rules |
| `no-extra-boolean-cast`                    | 2     | Error    | Code quality               |
| `@typescript-eslint/no-empty-object-type`  | 2     | Error    | Type safety                |
| `no-restricted-imports`                    | 1     | Error    | Architecture               |
| `no-empty`                                 | 1     | Error    | Code quality               |
| `@typescript-eslint/prefer-as-const`       | 1     | Error    | Type safety                |

### 1.1 Critical: `react-hooks/rules-of-hooks` (4 errors)

**File:** `src/services/system/event-journal.service.ts`

A plain utility function is named `useNodeJournal()`, which ESLint interprets as a React hook call inside non-component functions. This is a naming violation — the function is not a hook, it calls no hooks.

```ts
// WRONG — naming triggers rules-of-hooks violations
function useNodeJournal(): boolean {
  return isNodeApiEnabled('deals') || isNodeApiEnabled('system');
}
```

**Fix:** Rename to `isNodeJournalEnabled()` (no `use` prefix).

### 1.2 High: `react-hooks/exhaustive-deps` (198 warnings)

Most heavily affected files:
- `DealDocumentsPage.tsx` — 4 violations (missing `fetchDataInitial`, `debouncedBackgroundRefresh`, `refreshDataInBackground`, `getCreatorName`, `getDocTemplateName`)
- `DealOverviewPage.tsx` — 1 violation (missing `fetchDealData`, `fetchParticipants`)
- `DealsPage.tsx` — 1 violation (missing `cachedState`)
- `DocumentsPage.tsx`, `UsersPage.tsx` — similar patterns

Stale closures caused by missing deps can result in fetches running against outdated state (wrong page, wrong filter). These are not just style warnings — they can cause silent data bugs.

**Fix pattern:** Either add the missing dep, or if intentionally fire-once, use `// eslint-disable-next-line react-hooks/exhaustive-deps` with a comment explaining why.

### 1.3 Medium: `@typescript-eslint/no-explicit-any` (477 errors)

Concentrated in large page files:
- `DealDocumentsPage.tsx` — 5 occurrences
- `DealOverviewPage.tsx` — 10+ occurrences
- `DealsPage.tsx`, `ContactLendersPage.tsx`, `CreateContactModal.tsx` etc.

This is a side-effect of TypeScript being configured with `strict: false` and `noImplicitAny: false` (see §3). The `any` casts mask real typing gaps, especially around API response shapes.

### 1.4 Medium: `no-useless-escape` (20 errors)

Regex patterns contain unnecessary backslashes (e.g., `[\-]` instead of `[-]`, `[\/]` instead of `[/]`). Auto-fixable: `npx eslint src/ --fix` resolves 12 of these.

### 1.5 Low: `no-case-declarations` (5 errors)

Variables declared inside `case` blocks without braces. Found in calculation/transform files. Wrap case body in `{}` to scope the declaration.

---

## 2. TypeScript Configuration

**File:** `tsconfig.json` / `tsconfig.app.json`

| Flag | Current Value | Recommended |
|---|---|---|
| `strict` | `false` | `true` |
| `noImplicitAny` | `false` | `true` |
| `noUnusedLocals` | `false` | `true` |
| `noUnusedParameters` | `false` | `true` |
| `strictNullChecks` | `false` | `true` |
| `skipLibCheck` | `true` | `true` (OK) |

All safety flags are disabled. This is the root cause of the 477 `any` errors — TypeScript allows them by default. Enabling `strict: true` would surface a significant number of type errors that currently fail silently at runtime.

**Recommendation:** Enable flags incrementally:
1. `strictNullChecks: true` first (catches null dereferences)
2. `noImplicitAny: true` (forces explicit types on all parameters)
3. `noUnusedLocals: true` + `noUnusedParameters: true` (dead code)

---

## 3. File Size / Component Complexity

Files exceeding 1000 lines are candidates for splitting. Current oversized files:

| File | Lines | Issue |
|---|---|---|
| `DealDocumentsPage.tsx` | 2004 | One page doing fetch, polling, PDF viewer, document list, generate, preview, print — should split into sub-components |
| `AddFundingModal.tsx` | 1799 | Single modal with full funding grid, tabs, validation — overly monolithic |
| `integrations/supabase/types.ts` | 1779 | Auto-generated — acceptable |
| `LenderCharges.tsx` | 1363 | Charges table, add/edit modal, filtering all in one file |
| `TemplateManagementPage.tsx` | 1304 | Mix of template list, upload, field map editor, validation |
| `DealDataEntryPage.tsx` | 1264 | Tab routing, form orchestration, save logic — needs sub-page extraction |
| `RE885ProposedLoanTerms.tsx` | 1263 | Complex form but domain-cohesive — borderline acceptable |
| `LoanTermsBalancesForm.tsx` | 1261 | Form-only, dense field layout — borderline |

**Rule of thumb:** Forms with >400 lines should be reviewed for sub-section extraction. Pages >600 lines should extract fetch logic to hooks.

---

## 4. Direct Supabase Calls — Migration Gaps

These service files still import and call `supabase` directly (not through the Node API). They work because the Supabase fallback branches are still present:

| File | Supabase Tables / Functions Used | Migration Status |
|---|---|---|
| `services/documents/generation.service.ts` | `generated_documents`, `generation_jobs` | Partially proxied — generate route proxied, list routes have fallback |
| `services/documents/templates.service.ts` | `templates` | Supabase fallback active |
| `services/documents/packets.service.ts` | `packets`, `packet_templates` | Supabase fallback active |
| `services/documents/template-field-maps.service.ts` | `template_field_maps` | Supabase fallback active |
| `services/documents/merge-tag-aliases.service.ts` | `merge_tag_aliases` | Supabase fallback active |
| `services/system/event-journal.service.ts` | `event_journal` | Supabase fallback active |
| `services/deals/deal-attachments.service.ts` | `deal_attachments` | Supabase fallback active |

Additionally, two component files make direct Supabase calls outside the service layer:
- `components/deal/DistributionOtherSelect.tsx` — queries `contacts` directly
- `components/deal/LoanTermsServicingForm.tsx` — queries `deal_participants` directly

These bypass the service layer entirely and will break if Supabase direct access is removed.

**ESLint guard:** `no-restricted-imports` is configured to block `@/integrations/supabase/client` from non-service files. This guard currently only catches 1 violation (`src/services/supabase/client.ts` — which re-exports from integrations). Components that use `@/services/supabase/client` are not caught.

---

## 5. Debug Code Left in Production

### console.log statements

```
src/components/deal/DealFieldInput.tsx:457   console.log('Template clicked:', field.field_key)
src/components/deal/DealFieldInput.tsx:472   console.log('Action clicked:', field.field_key)
src/components/deal/LoanTermsBalancesForm.tsx:1103   console.log('Recast Payment clicked')
```

These are debug logs that should be removed or replaced with a proper logger before production.

### TODO / Unimplemented Features

| File | Line | Comment |
|---|---|---|
| `LoanTermsBalancesForm.tsx` | 1103 | `/* TODO: confirm Recast Payment workflow with client */` — button is wired to `console.log` only |

---

## 6. Code Quality Patterns

### 6.1 Good Patterns (keep)

- **`DirtyFieldWrapper`** — clean context-based dirty-field highlighting; consistently applied across deal forms
- **`isNodeApiEnabled(domain)`** — single feature flag source of truth for API routing
- **`apiFetch` + auto-refresh on 401** — correct token refresh pattern; session expired error typed as `SessionExpiredError` sentinel class
- **`parseDurationMs()`** — correctly parses `1h`, `15m`, `7d` from env vars; avoids hardcoded millisecond literals
- **`storageDownloadUrl()`** — per-segment URL encoding; correct approach for paths with special characters
- **Prisma migrations only** — all schema changes via `backend/prisma/migrations/`; no raw SQL executed directly
- **`computeBorrowerScheduledPayment()`** — single calculation source shared between Loan tab and RE 885 Section VII

### 6.2 Anti-patterns (fix)

- **`as any` casts** — 477 occurrences; masks missing type definitions on API responses. Fix: define response interfaces for each API route.
- **Module-level mutable cache** — `DistributionOtherSelect.tsx` uses module-scoped `let cachedOptions` and `let inflight`. These variables never reset across navigations in the same session. Acceptable for read-only lookup data, but can serve stale data after a contact is added.
- **`useNodeJournal` naming** — plain function named as a hook (see §1.1).
- **Inline render functions** — `renderFeeRow`, `renderInsuranceRow`, `renderSimpleRow` defined inside the component body of `OriginationFeesForm`. Recreated every render; should be extracted as sub-components or memoized.
- **Long inline JSX chains** — single-line `Input` elements with 8+ props concatenated (`onKeyDown`, `onPaste`, `onBlur`, `onFocus`, etc.) in `OriginationFeesForm`. Reduce readability and make diffing hard.

---

## 7. Comments Quality

### Over-commented (noise)
Some utility files have JSDoc-style multi-line block comments on every function that merely describe the function name. Per project convention, comments should only explain **why** (a hidden constraint, workaround, non-obvious invariant), not **what**.

### Under-commented (needs explanation)
- `src/lib/calculationEngine.ts` — complex financial formula derivations with no inline math references
- `src/lib/borrowerPaymentFormula.ts` — balloon payment edge cases are not annotated
- `backend/src/common/helpers/supabase-jwt.ts` — the difference between `mintSupabaseAccessToken()` (HS256, legacy key) and the project's current ECC key is not documented inline; this distinction has caused confusion before

### Stale comments
- `src/lib/supabasePagination.ts:1` — `@deprecated` marker without a removal date or migration-complete condition
- `src/services/documents/generation.service.ts:29–31` — comment says "keep unchanged" for Supabase fallback branches that will eventually be removed

---

## 8. Deprecated / Dead Files

| File | Status |
|---|---|
| `src/services/supabase/auth.ts` | Legacy — uses old Supabase Auth. Auth is now NestJS. Safe to delete after confirming no remaining callers. |
| `src/lib/supabasePagination.ts` | Marked `@deprecated` — re-exports from `@/services/supabase/pagination`. Delete; update any remaining imports. |
| `src/services/index.ts` | Re-exports Supabase utilities (storage, realtime, functions, auth). As services migrate this becomes misleading. |

---

## 9. Backend-Specific Issues

### 9.1 Body Size Limit — Fixed
`main.ts` now sets `json({ limit: '10mb' })`. Previously the 100kb Express default caused silent 413 errors on large deal JSONB saves.

### 9.2 Cookie SameSite — Fixed
Changed from `strict` in prod to always `lax`. Cross-port dev setup (`:8080` SPA / `:3000` API) required `lax`. Note: `lax` means the refresh cookie is sent on top-level navigations from other sites; this is acceptable for a private web app but worth revisiting if this becomes a public SaaS.

### 9.3 Refresh Cookie Path — Fixed
`COOKIE_REFRESH_PATH` changed from `/api/auth/refresh` to `/api/auth`. The more permissive path ensures the refresh cookie is sent on any auth route, not just the specific refresh endpoint.

### 9.4 Missing `SUPABASE_JWT_SECRET`
`backend/.env` (not committed) is missing `SUPABASE_JWT_SECRET`. This prevents `mintSupabaseAccessToken()` from minting short-lived Supabase JWTs for edge function calls. Current workaround: service_role key used directly as Bearer token. This works once the edge function is redeployed with the X-User-Id trusted proxy path.

### 9.5 JWT_SECRET Strength
Current dev `JWT_SECRET` is a UUID (36 chars, low entropy). Must be replaced with a 64-char random hex before production:
```
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## 10. Uncommitted / Unstaged Items

| Item | Type | Action Needed |
|---|---|---|
| `src/components/deal/OriginationFeesForm.tsx` | Modified (this session) | Commit — adds individual DirtyFieldWrapper to broker/APR/paidToCompany/others/months/perMonth fields |
| `scripts/LOAN_SYSTEM_KNOWLEDGE_BASE.md` | Deleted, not staged | Stage deletion or restore |
| `scripts/LOAN_TERMS_AND_CALCULATIONS_REVIEW.md` | Deleted, not staged | Stage deletion or restore |
| `docs/` | Untracked | Add to git (`git add docs/`) |

---

## 11. Priority Fix List

### P0 — Fix before next release
1. **Rename `useNodeJournal`** → `isNodeJournalEnabled` in `event-journal.service.ts` (breaks ESLint rules-of-hooks; conceptually wrong)
2. **Remove `console.log` debug statements** from `DealFieldInput.tsx` and `LoanTermsBalancesForm.tsx`
3. **Replace `JWT_SECRET` UUID** with 64-char random hex in `backend/.env`
4. **Deploy updated `generate-document` edge function** (`supabase functions deploy generate-document`) — current deployed version lacks X-User-Id trusted proxy path

### P1 — Fix this sprint
5. **Add `SUPABASE_JWT_SECRET`** to `backend/.env` (get Legacy JWT Secret from Supabase Dashboard → Project Settings → API)
6. **Move `DistributionOtherSelect` Supabase query** into the contacts service layer (currently bypasses `isNodeApiEnabled` guard)
7. **Move `deal_participants` fetch** in `LoanTermsServicingForm` into a proper service call
8. **Fix 5 `no-case-declarations`** errors — add braces around case blocks
9. **Fix 9 `prefer-const`** errors — auto-fixable: `npx eslint src/ --fix`
10. **Fix 20 `no-useless-escape`** errors — auto-fixable: `npx eslint src/ --fix`

### P2 — Backlog / technical debt
11. Enable `strictNullChecks: true` in tsconfig (incremental — will surface real null bugs)
12. Split `DealDocumentsPage.tsx` (2004 lines) — extract polling hook, document list, viewer sub-components
13. Extract inline render functions from `OriginationFeesForm.tsx` into proper sub-components
14. Delete `src/services/supabase/auth.ts` (legacy, unused post-auth migration)
15. Delete `src/lib/supabasePagination.ts` (deprecated re-export)
16. Proxy remaining 5 Supabase edge functions through NestJS (see migration status doc)
17. Address `react-hooks/exhaustive-deps` warnings systematically (198 — risk of stale closure bugs)

---

## 12. Architecture Health (Migration Progress)

| Layer | Status |
|---|---|
| Auth | ✅ Fully migrated — NestJS JWT, httpOnly cookies |
| Database — all 5 domains | ✅ Proxied through NestJS + Prisma |
| Storage | ✅ Proxied through NestJS |
| `generate-document` edge function | ⚠️ Proxied in code — needs `supabase functions deploy` to activate |
| 5 other edge functions | ❌ Still called directly from frontend |
| Realtime | ❌ Still using `subscribePostgresChanges()` — architecture decision pending |
| Document service files | ⚠️ Supabase fallback branches still present — not yet Node API-only |
