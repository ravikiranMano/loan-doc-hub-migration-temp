# Project Session Context — Consolidated from Past Chats

**Branch:** `migration_v1`  
**Updated:** 2026-06-06  
**Purpose:** Carry forward decisions, fixes, and open work from prior Cursor sessions into current work.

---

## 1. Migration Overview

**Goal:** Replace Lovable/Supabase direct calls with NestJS + Prisma + cookie JWT auth, while keeping Supabase Postgres (host) and Supabase Storage (via backend proxy).

| Layer | Status |
|-------|--------|
| Auth | ✅ NestJS JWT (httpOnly cookies). Supabase Auth removed from frontend. |
| DB queries | ✅ All 5 domains via Node API (`VITE_USE_NODE_API="system,admin,contacts,documents,deals"`) |
| Storage | ✅ Frontend → NestJS `StorageService` → Supabase Storage (service_role) |
| Realtime | ✅ SSE polling (3 channels). Supabase channels removed. |
| Edge functions | ⚠️ 5/6 migrated to NestJS. **`generate-document` edge still used** via `generate-edge` proxy. |
| Prisma | ✅ 30 models in `backend/prisma/schema.prisma`. Generate after schema changes. |

**Frontend env (required):**
```
VITE_USE_NODE_API="system,admin,contacts,documents,deals"
VITE_NODE_API_URL="http://localhost:3000/api"
```

**Backend must be running** on `:3000` for all deal/contact/document flows.

---

## 2. Document Generation — Three Active Paths

| Route | Engine | Persists | Use |
|-------|--------|----------|-----|
| `POST /deals/:id/documents/generate` | docxtemplater (NestJS) | ✅ | Primary production path |
| `POST /deals/:id/documents/generate-edge` | Deno edge (proxy) | ✅ | Same logic as Lovable main; Node only proxies with service_role |
| `POST /deals/:id/documents/generate-v2` | docxtemplater (NestJS) | ❌ streams only | Dev/test; Inspect + Generate buttons enabled on Deal Documents page |
| `GET /deals/:id/documents/field-data-v2?templateId=` | — | — | Preview merge payload for v2 |

**Removed / in progress:**
- `generate-api` (raw XML `GenerationService`) — **being dropped** in current uncommitted changes (controller + module + service method removed).

**Edge vs Node:** Production edge function logic **matches Lovable `origin/main`** except minor auth header changes for NestJS proxy. Replacing edge entirely with Node requires full regression on RE885-style templates (conditionals, `_N` columns, checkbox glyphs, lien tables).

**v2 limitations:** No XML repair. Templates must use unbroken `{{field_key}}` tags typed in Word. RE885-specific publishers partially ported in `deal-field-values.loader.ts`.

---

## 3. Field Key Mapping — Critical Architectural Gap

Three naming layers that **do not auto-connect**:

```
DOCX tag {{br_p_fullName}}
    ↕ (assumed equal — often wrong)
field_dictionary.field_key  (br_p_fullName, UUID in DB)
    ↕ (UUID lookup + bridges)
deal_section_values.field_values JSONB  (keys are UUIDs or prefix::uuid, NOT field_key strings)
```

**Findings:**
- Bulk-imported **36 templates** have **0 `template_field_maps` rows**
- Folder name "Templates created with field key mapping" means tags are field keys **in the DOCX**, not DB mapping rows
- `br_p_fullName` often **not stored** under that key — resolved via participant loop, indexed_key, or loan_terms.details_borrower_name bridges
- Edge function has extensive auto-compute for `br_p_fullName`; v2 loader has simplified mirror in `deal-field-values.loader.ts`

**Key files:**
- `backend/src/modules/documents/deal-field-values.loader.ts`
- `backend/src/modules/documents/document-data.service.ts`
- `src/lib/legacyKeyMap.ts`
- `supabase/functions/generate-document/index.ts` (reference for edge resolution)

---

## 4. Enter File Data — Fixes Applied (May 30)

Reported: loan/property not saving, funding/LTV/CLTV wrong, contact tabs broken.

**Root causes:** migration changed read/write path; not formula engine bugs.

**Fixes completed:**
1. **`useDealFields`** — hydration: wait for field dictionary cache; remove gates that blocked binding; `dealLoadKeyRef` instead of `hasLoadedRef`
2. **`deals.repository upsertSection`** — **merge** incoming `field_values` with existing JSONB (was full replace → data loss)
3. **`LoanTermsFundingForm`** — removed `directPersistFundingField()` dual-write; single path via `onValueChange` + `saveDraft`
4. **LTV/CLTV** — shared helpers in `src/lib/loanPropertyCalculations.ts`
5. **Portfolio grids** — composite key parsing via `src/lib/sectionFieldValues.ts` (`prefix::uuid`)

**Known remaining issue:** Multi-deal workspace tabs → `useDealFields` load lifecycle race ("Failed to load deal fields" toast when several deals open).

**Test deal:** DL-2026-0015 (218 stored keys; was showing empty UI before hydration fix). Use `csr1@deltoro.test` for editable access.

---

## 5. RE885 / Template v2 Work

**Completed:**
- `re885-1_vDT` converted v1 conditionals → docxtemplater v2 syntax
- RE885 alias publishers added to v2 loader
- Output: `backend/scripts/docx/output/re885-1_vDT-v2.docx`
- Scripts: `npm run docx:convert-re885`, `docx:analyze-re885`, `docx:test-re885` (from `backend/`)

**Not yet done:**
- `RE851D-V18.1_vDT` — analyzed, conversion planned but not executed
- 4 unmapped RE885 tags: `bk_p_company`, `broker.first_name`, `broker.last_name`, `of_re_vfullyIndexedRate` (typo; aliased in loader)

**Production `re885-1` (v1)** intentionally unchanged for edge generation.

---

## 6. Other Fixes & Decisions

| Topic | Outcome |
|-------|---------|
| Deal file search | Fixed — was client-side on current page only; now uses API `search` param |
| Generate v2 + Inspect buttons | Unhidden on Deal Documents page (were inside `hidden` dev block) |
| ESLint backend | 69 errors → 0 (Prisma types, escape fixes, no `as any`) |
| Supabase cleanup session | Deleted frontend Supabase client, 23 dead edge functions, root prisma schema, `fieldValueResolver.ts`, `supabase/migrations/` |
| Auth bridge | Supabase JWT fallback in `JwtAuthGuard` **not needed** for current config — safe to remove; keep Bearer for Nest JWT |
| Users DB cleanup | Only `admin@deltoro.test` and `csr1@deltoro.test` remain |
| Template storage replace | Can remove packets; generation history is separate (`generated_documents` / `generation_jobs`) |
| `DistributionOtherSelect` | Hard Node API dependency; broker/lender contact fetch — issues if API down |
| Event journal | Was not tracking post-migration — compare with main branch (chat a9854c97) |
| `ld_p_lenderType` | Field mapping says lenders section but UI visibility unclear |
| OriginationFeesForm | Side-by-side layout fix at lines 951–967 |
| Prisma setup | Multi-schema pull from Supabase; only subset of 61 models actually used |

---

## 7. Current Uncommitted Work

```
backend/src/modules/documents/documents.controller.ts  — remove generate-api route
backend/src/modules/documents/documents.module.ts      — drop GenerationModule import
backend/src/modules/documents/documents.service.ts     — remove generateDocumentApi()
```

**Generate v2 is NOT affected** — still intact end-to-end.

---

## 8. Open / Pending Work (Priority Order)

1. Populate `template_field_maps` for bulk-imported templates (or accept loader bridges only)
2. Fix `useDealFields` multi-tab race when workspace has several deals open
3. Complete event journal tracking via Node API (if still broken)
4. Decide: drop `generate-edge` entirely → full Node doc generation + regression test RE885/re885-1
5. Convert remaining `_vDT` templates — see `docs/DOCXTEMPLATER_TEMPLATE_CONVERSION.md` (RE885 + RE851D done; 34 bulk-imported pending)
6. Remove Supabase JWT fallback from `JwtAuthGuard` (optional cleanup)
7. Update `docs/MIGRATION_STATUS.md` — references deleted Supabase frontend files
8. `ld_p_lenderType` — locate or add in deal edit UI

---

## 9. Key File Map

| Area | Path |
|------|------|
| Node API client | `src/services/node-api/client.ts` |
| Deal fields hook | `src/hooks/useDealFields.ts` |
| Section values API | `src/services/deals/section-values.service.ts` |
| Doc generation (FE) | `src/services/documents/generation.service.ts` |
| Deal Documents UI | `src/pages/csr/DealDocumentsPage.tsx` |
| Documents controller | `backend/src/modules/documents/documents.controller.ts` |
| Docxtemplater v2 | `backend/src/modules/documents/docxtemplater.service.ts` |
| Field value loader | `backend/src/modules/documents/deal-field-values.loader.ts` |
| Edge generate (reference) | `supabase/functions/generate-document/index.ts` |
| Calculation engine | `src/lib/calculationEngine.ts` |
| Loan/property calcs | `src/lib/loanPropertyCalculations.ts` |
| Knowledge base | `docs/LOAN_SYSTEM_KNOWLEDGE_BASE.md` |
| Calculations review | `docs/LOAN_TERMS_AND_CALCULATIONS_REVIEW.md` |
| **Template v1 → v2 conversion** | `docs/DOCXTEMPLATER_TEMPLATE_CONVERSION.md` |
| Cursor rule (conversion) | `.cursor/rules/docxtemplater-template-conversion.mdc` |

---

## 10. Remaining Transcripts (30 chats)

Kept after cleanup. Most relevant IDs:

| ID | Topic |
|----|-------|
| `b6b9c67c` | Field key mapping gap report |
| `da0ef96b` | Bulk template import (36 DOCX) |
| `1f98bc49` | Enter file data main vs migration comparison |
| `0fcabf8a` | Save/calc/contact tab fixes |
| `e958df56` | RE885 vDT v2 conversion |
| `56224d5a` | br_p_fullName in generate-v2 |
| `02b77d71` | Generate edge vs Node analysis |
| `efa1fc8d` | Migration status / Supabase cleanup |
| `7a2b8e69` | ESLint fixes + user cleanup |
| `cfd686f0` | This session (chat management) |

Transcripts live at:  
`.cursor/projects/.../agent-transcripts/<uuid>/<uuid>.jsonl`
