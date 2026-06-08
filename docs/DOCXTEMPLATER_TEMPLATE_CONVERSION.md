# Docxtemplater Template Conversion Guide

**Extracted from:** past Cursor sessions (May–Jun 2026), RE885/RE851D conversion work, bulk template import analysis  
**Updated:** 2026-06-06  
**Audience:** Anyone converting v1 (Edge) DOCX templates to docxtemplater v2 for local testing.

**Cursor rule:** `.cursor/rules/docxtemplater-template-conversion.mdc`

---

## 0. Standard workflow (any template name or ID)

User names a template from Template Management — **by name or UUID**. No special suffix required.

| Step | Action |
|------|--------|
| 1 | Resolve **source** row in `templates` (user name or ID); derive `vdtName = {baseName}_vDT` |
| 2 | If `_vDT` row **exists** → **ask permission** before updating storage/DB; if **missing** → create `{baseName}_vDT` row + upload after local validation |
| 3 | Download source DOCX → save under `backend/scripts/docx/output/{template-slug}/` |
| 4 | Convert v1 syntax → v2; apply **content-preserving alignment** (§2) |
| 5 | Validate with docxtemplater InspectModule (parse must succeed) |
| 6 | Deliver **local `{slug}-v2.docx`** + optional mapping report JSON |
| 7 | Register/update **`_vDT` in storage + DB** per step 2 — never touch production source blob |

**Default objective:** local copy for testing; `_vDT` row is the in-app v2 target. Production template stays on Edge v1.

---

## 1. Two engines — do not mix

| | **v1 — `generate-edge`** | **v2 — `generate` / `generate-v2`** |
|---|--------------------------|-------------------------------------|
| **Engine** | Deno `generate-document` + `tag-parser` + `docx-processor` | NestJS `DocxtemplaterService` + angular-expressions |
| **Conditionals** | `{{#if field}}`, `{{#if (eq field "X")}}`, `{{else}}`, `{{/if}}` | `{{#expr}}`, `{{^expr}}`, `{{/expr}}` |
| **XML repair** | Split runs, MERGEFIELD, checkbox glyphs, `_N` rewrite | **None** — tags must be clean in Word |
| **Indexed properties** | `_N` suffix rewritten to `_1`, `_2`, … at render | Native `{{#properties}}` loops + `properties[]` array |
| **Typical use** | Production — Edge v1 (`generate-edge`) | Local / test — docxtemplater v2 |

**Rule:** Do not overwrite the production storage blob. v2 uploads target the **`_vDT` sibling row** only.

### `_vDT` naming and create vs update

```text
baseName = source.name without trailing _vDT / _vdt
vdtName  = {baseName}_vDT
```

| `_vDT` row exists? | Action |
|--------------------|--------|
| **Yes** | **Ask user permission** before updating that row’s storage or DB. Until approved, deliver local `-v2.docx` only. |
| **No** | **Create** `{baseName}_vDT` in Template Management (new `templates` row + storage upload). Copy `state` / `product_type` from source. |

If the user already named a `_vDT` template, treat it as the v2 target — still ask before overwriting.

**Field-map inheritance:** If `_vDT` has no `template_field_maps`, v2 may inherit maps from the parent name (`document-data.service.ts` strips `_vDT`).

---

## 2. Content-preserving alignment

Conversion improves **tag structure and parse reliability** — it is not content editing.

### Allowed (alignment)

- Merge split XML runs within one tag
- Trim spaces inside `{{…}}`
- Rewrite conditionals to v2 while keeping **all branches** (if/else text unchanged)
- Collapse **duplicate equivalent blocks** into loops (e.g. five identical PROPERTY sections → one `{{#properties}}` block with the same labels/fields per row)
- One LTV table row wrapped in a loop instead of five `_N` rows
- Fix tag typos when renaming to an existing `field_dictionary.field_key` (log in report)

### Forbidden (content removal)

- No deleting paragraphs, clauses, labels, headers, footers, or static instructional text
- No removing table rows/columns/sections (loops replace **duplicate template copies**, not user-visible rows)
- No dropping else branches, optional blocks, or merge fields
- No removing “unused-looking” boilerplate

If a region cannot be converted without deletion, **leave it as-is**, document it in the report, and continue elsewhere.

---

## 3. v1 → v2 syntax translation

### Simple placeholders

| v1 (OK in both if clean) | v2 requirement |
|--------------------------|----------------|
| `{{br_p_fullName}}` | Same — must be **one unbroken run** in Word XML |
| `{{ of_re_initialFeesPage1 }}` | Trim spaces → `{{of_re_initialFeesPage1}}` |

### Conditionals

| v1 (Edge / Handlebars-style) | v2 (docxtemplater + angular-expressions) |
|------------------------------|------------------------------------------|
| `{{#if field}}…{{/if}}` | `{{#field}}…{{/field}}` |
| `{{#if field}}…{{else}}…{{/if}}` | `{{#field}}…{{/field}}{{^field}}…{{/field}}` |
| `{{#if (eq ld_p_lenderType "Individual")}}` | `{{#ld_p_lenderType == 'Individual'}}` |
| `{{#unless field}}` | `{{^field}}` |
| `{{#each borrowers}}` | `{{#borrowers}}…{{/borrowers}}` (needs array in payload) |

**Closers:** Each `{{#…}}` and `{{^…}}` needs its own `{{/…}}` or `{{/expr}}`. Parse errors show in the **backend terminal** when running Inspect or Generate (v2).

### Lender individual vs entity (common pattern)

**v1:**
```text
{{#if (eq ld_p_lenderType "Individual")}}
  {{ld_p_firstIfEntityUse}} {{ld_p_middle}}{{ld_p_last}}
{{else}}
  {{ld_p_vesting}}
{{/if}}
```

**v2:**
```text
{{#ld_p_lenderType == 'Individual'}}
  {{ld_p_firstIfEntityUse}} {{ld_p_middle}}{{ld_p_last}}
{{/ld_p_lenderType == 'Individual'}}
{{^ld_p_lenderType == 'Individual'}}
  {{ld_p_vesting}}
{{/ld_p_lenderType == 'Individual'}}
```

For **multiple lenders**, use `{{#lenders}}…{{/lenders}}` with `lenders[]` from `lenders.builder.ts` — not a single flat `ld_p_*` block.

### Boolean checkboxes (yes/no rows)

**v1 (glyph pick at render):**
```text
{{#if ln_p_subordinationProvision}}☑{{else}}☐{{/if}} Yes
{{#if ln_p_subordinationProvision}}☐{{else}}☑{{/if}} No
```

**v2 options:**
1. Use transform `checkbox` / `checkbox_x` on a boolean field and a single `{{field}}` placeholder, **or**
2. Convert to `{{#field}}☑{{/field}}{{^field}}☐{{/field}}` pairs

RE885 v2 uses backend bridges in `applyRe885Bridges()` to publish boolean aliases (`of_fe_estimatedCashPayableToYou`, etc.).

### Multi-property templates (`_N` suffix)

**v1:** Tags like `{{pr_p_address_N}}`; engine rewrites `_N` → `_1`, `_2`, … by occurrence order in PROPERTY # regions.

**v2 (idiomatic):** Native loops — **do not** stamp `_1`, `_2` in the template.

**LTV table (one row loops):**
```text
{{#properties}}
  {{property_number}}  {{ln_p_remainingEncumbrance}}  {{ln_p_expectedEncumbrance}}  ...
{{/properties}}
```
Place loop markers in first/last cell of a **single** table row (`paragraphLoop: true` duplicates the row).

**Property detail blocks:**
```text
{{#properties}}
  PROPERTY #{{property_number}}
  {{pr_p_address}}
  {{pr_p_ownerName}}
{{/properties}}
```
Delete duplicate PROPERTY #2–#5 blocks; wrap **one** block in the loop. Everything between `{{#properties}}` and `{{/properties}}` must be **contiguous in `word/document.xml`**.

**Backend:** `buildRe851dPropertiesArray()` in `re851d-properties.builder.ts` builds `properties[]`.

---

## 4. Merge tag naming (`{{field_key}}`)

Use **`field_dictionary.field_key`** values — not legacy UI keys.

### Prefix convention

```
{section}_{form}_{field}
```

| Prefix | Section |
|--------|---------|
| `br_p_` | Borrower primary |
| `ln_p_` | Loan terms |
| `ld_p_` | Lender |
| `pr_p_` | Property |
| `bk_p_` | Broker |
| `cb_p_` | Co-borrower |
| `of_re_`, `of_fe_`, `of_int_` | Origination / RE885 short aliases |

Dot notation works when nested objects are built (`broker.first_name` → `data.broker.first_name` via `buildNestedObjects()`).

### Tags that are **not** dictionary rows

| Tag | Source |
|-----|--------|
| `ld_p_firstIfEntityUse` | Computed from lender contact first name (document alias) |
| `br_p_fullName` | Participant contact injection (edge) or section JSON + bridges (v2) |
| `of_re_*` short aliases | RE885 publishers in edge / `applyRe885Bridges()` |
| `pr_p_address_1`, `pr_p_address_N` | v1 runtime aliases — replace with loop fields in v2 |

Run **`POST /templates/:id/validate`** or **Inspect field data** to list mapped vs unmapped tags against `field_dictionary`.

---

## 5. Word authoring requirements (v2)

docxtemplater v2 has **no XML repair**. Fix in Word before upload:

1. **Type each tag as one continuous string** — do not paste from PDF/email (causes split runs: `{{` + ` br_p_fullName` + `}}`).
2. **No Word MERGEFIELD** mixed with visible `{{…}}` duplicates.
3. **No `_N` index rewriting** — use loops instead.
4. **Balanced closers** — every section opener has a matching closer.
5. **Trim spaces inside tags:** `{{field}}` not `{{ field }}`.

If Inspect fails, read the **NestJS backend terminal** (`npm run start:dev`) for `[v2 template inspect] PARSE FAILED` with tag-level errors.

---

## 6. Conversion workflow (checklist)

### A. Prepare

- [ ] User provides **template name or ID**.
- [ ] Download original DOCX from `templates` bucket → `{slug}-original.docx`.
- [ ] Run tag inventory (InspectModule or XML scan).

### B. Convert DOCX (local output)

- [ ] Apply §2 alignment rules — structure only, no content removal.
- [ ] Rewrite v1 conditionals → v2 expressions (see §3).
- [ ] Replace `_N` duplicate regions with loops where equivalent (see §3).
- [ ] Fix tag typos when mapping to `field_dictionary` (log renames).
- [ ] Write **`backend/scripts/docx/output/{slug}/{slug}-v2.docx`**.
- [ ] Write optional `field-mapping-report.json`.

### C. Backend data layer (if needed)

v2 reads `deal_section_values` first, then applies bridges. Compare with edge `generate-document/index.ts` for parity.

| Template family | Backend module | What it adds |
|-----------------|----------------|--------------|
| RE885 | `applyRe885Bridges()` in `deal-field-values.loader.ts` | Fee aliases, checkbox booleans, loan term/rate flags |
| RE851D | `re851d-properties.builder.ts` | `properties[]`, indexed property keys, LTV rollups |
| Lenders | `lenders.builder.ts` | `lenders[]`, `ld_p_*` from participant contacts |
| Borrowers | **Gap** — not fully ported | Edge uses `injectContact()` for primary borrower → `br_p_fullName` |

Add bridges **only** in the v2 path (`DealFieldValuesLoader` / `DocumentDataService`) — do not change Edge unless intentionally syncing both.

### D. Field maps (optional but recommended)

Bulk-imported templates (36 DOCX) have **tags in the file** but often **zero `template_field_maps` rows**.

For each template:
- [ ] Scan DOCX tags → match `field_dictionary.field_key`
- [ ] Insert `template_field_maps` with `required_flag`, `transform_rule`
- [ ] Enables CSR required-field progress and transform formatting

### E. Verify

```text
1. InspectModule parse on local -v2.docx (must pass)
2. Optional: restart backend; upload/register test copy if user wants in-app test
3. Inspect field data → templateTagKeys, templateConditions, matchesCompare
4. Generate (v2) on a deal with realistic data
5. Optional: compare to generate-edge on original v1 blob
```

**Test deals used in past sessions:** DL-2026-0014 (RE885 smoke), DL-2026-0015 (hydration), DL-2026-0001 (lender Individual/vesting), DL-2026-0296 (entity borrower / empty br_p_fullName on v2).

---

## 7. Templates converted in past sessions

| Template | v2 status | Backend bridges | Notes |
|----------|-----------|-----------------|-------|
| `re885-1_vDT` | ✅ Converted | `applyRe885Bridges()` | 133 tags; 129 mapped; 4 unmapped typos/aliases |
| `RE851D-V18.1_vDT` | ✅ Converted | `re851d-properties.builder.ts` | 3× `{{#properties}}` loops; 394 tags |
| Remaining 34 bulk-imported | ❌ Not converted | Dictionary keys only | Use Edge v1 or convert per this guide |

**Not converted (Edge-only rewrites in repo history):** `RE851D-V12.1`, `RE870`, investor questionnaire — separate Edge one-shot scripts, not `_vDT` v2.

---

## 8. Inspect & validate API behavior

| Endpoint | Purpose |
|----------|---------|
| `GET /deals/:id/documents/field-data-v2?templateId=` | Scoped merge payload + condition evaluation |
| `POST /templates/:id/validate` | Tag inventory vs `field_dictionary` |
| `DocxtemplaterService.inspectFromFilePath()` | Parses DOCX via InspectModule |

Inspect returns:
- `metadata.templateTagKeys` — flat merge fields
- `metadata.templateConditions` — expressions with `driverValue`, `matchesCompare`
- `data` — resolved values for those tags only

Condition driver example: `ld_p_lenderType == 'Individual'` with nested field keys under that branch.

---

## 9. Transform rules (formatting at merge time)

Set on `template_field_maps.transform_rule` (or inferred from `data_type`):

| Rule | Example output |
|------|----------------|
| `currency` | `$500,000.00` |
| `currency_words` | `Five Hundred Thousand and 00/100 Dollars` |
| `date_long` | `June 6, 2026` |
| `date_mmddyyyy` | `06/06/2026` |
| `percentage` | `7.500%` |
| `checkbox` / `checkbox_x` | `☑` / `☐` or `X` / empty |
| `phone`, `ssn_masked` | Formatted PII |

Implementation: `DocumentDataService.applyTransform()`.

---

## 10. Known gaps (when converting)

| Gap | Workaround |
|-----|------------|
| `br_p_fullName` empty on v2 | Add borrower participant injection (mirror edge `injectContact`) |
| Lender fields on contact, not in sections | `lenders.builder.ts` + primary lender contact load |
| `ld_p_firstIfEntityUse` not in CSR UI | Computed from contact first name in loader |
| Individual → clear vesting | Business rule in loader (matches edge) |
| Empty `template_field_maps` | Tags work if in dictionary + loader bridges; required-field UI won't gate |
| v1 `_glyph` checkbox tags | Use boolean field + transform, or v2 conditional glyphs |
| Part 3 content between property blocks | Ensure loop wraps contiguous XML range only |

---

## 11. Tooling (past sessions — may be gitignored)

Conversion scripts were consolidated under `backend/scripts/docx/` during RE885/RE851D work:

```text
backend/scripts/docx/
├── lib/docx-v2-convert.ts      # generic v1 → v2 XML conversion
├── convert-re885-vdt-once.ts
├── convert-re851d-vdt-once.ts
├── analyze-re885-vdt-once.ts
├── test-re885-vdt-generate-once.ts
└── output/                     # gitignored artifacts
```

Planned npm scripts (from sessions):

```bash
npm run docx:convert-re885
npm run docx:analyze-re885
npm run docx:test-re885
npm run docx:convert-re851d
npm run docx:test-re851d
```

If scripts are missing from the repo, recreate from `DocxtemplaterService` + conversion rules in §3, or re-run conversion manually in Word following this guide.

---

## 12. Key code references

| File | Role |
|------|------|
| `backend/src/modules/documents/docxtemplater.service.ts` | Render, inspect, angular parser |
| `backend/src/modules/documents/document-data.service.ts` | Payload + transforms + inspect scoping |
| `backend/src/modules/documents/deal-field-values.loader.ts` | JSONB → field_key + bridges |
| `backend/src/modules/documents/re851d-properties.builder.ts` | RE851D `properties[]` |
| `backend/src/modules/documents/lenders.builder.ts` | Lender loops + aliases |
| `backend/src/modules/documents/template-inspect.util.ts` | Condition parsing |
| `supabase/functions/generate-document/index.ts` | v1 reference for parity |
| `supabase/functions/_shared/tag-parser.ts` | v1 conditional/checkbox/_N behavior |

---

## Related docs

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — deal sections, calculations, template pipeline
- [`LOAN_SYSTEM_KNOWLEDGE_BASE.md`](./LOAN_SYSTEM_KNOWLEDGE_BASE.md) — field keys, merge tag resolution chain
- [`PROJECT_SESSION_CONTEXT.md`](./PROJECT_SESSION_CONTEXT.md) — migration + session decisions
