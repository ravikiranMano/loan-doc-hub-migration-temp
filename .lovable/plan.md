## Goal

Make multi-lender document generation work the way the spec describes:
- All lenders associated with a deal (not just the first) get their own data in the output.
- Templates can use either a `{{#each lenders}}…{{/each}}` repeater **or** indexed `{{lender_N_*}}` tags wrapped in `{{#if lender_N_exists}}`.
- Per-lender conditional `{{#if isIndividual}}…{{else}}…{{/if}}` decides between name fields and vesting.

This supersedes the older `ld_p_*` lien-style plan in `.lovable/plan.md` for the indexed/repeater branch, but **keeps backward compatibility**: existing templates that use the bare `ld_p_firstName`, `ld_p_vesting`, etc. continue to render Lender 1 exactly as today.

## Scope (what I will and will not touch)

In scope:
- `supabase/functions/generate-document/index.ts` — publish new indexed `lender_N_*` keys and assemble a `lenders` array on the data context.
- `supabase/functions/_shared/tag-parser.ts` — add `{{#each lenders}}`, `{{#if …}}{{else}}{{/if}}`, and cleanup pass for unresolved `lender_N_*` / `{{#each lenders}}` when empty.
- `supabase/functions/_shared/types.ts` — add `LenderData` interface.
- `field_dictionary` — insert any of the 5 listed canonical lender rows that are missing (`ld_p_lenderType`, `ld_p_vesting`, `ld_p_firstIfEntityUse`, `ld_p_middle`, `ld_p_last`). Existing rows untouched.

Explicitly NOT in scope:
- No UI changes to the Lenders form, validations, schema, RLS, auth, or session.
- No changes to existing `ld_p_*` primary-lender resolution, lien publishers, RE851A/D passes, or any other generation step.
- No edits to `.docx` templates as part of this task — the spec describes the syntax authors will use; updating individual templates is a separate task once the engine supports it.
- The older `ld1..ld5` flat field_dictionary rows from a prior turn (if still present) are left in place — removing them is out of scope here.

## Implementation

### 1. Resolve lender participants and build per-lender data

In `generate-document/index.ts`, where lenders are currently ordered (`orderedLenderParticipants` by `sequence_order`, then `created_at`):

For each lender N (1-based), pull its scoped section values using the existing `lenderN::<field_dictionary_id>` composite-key pattern already used by the storage model. From those, extract:
- `type` ← `ld_p_lenderType` dropdown value
- `vesting` ← `ld_p_vesting`
- `firstName` ← `ld_p_firstIfEntityUse`
- `middle` ← `ld_p_middle`
- `last` ← `ld_p_last`

Derive:
- `isIndividual` = `type.trim().toLowerCase() === "individual"`
- `displayName`:
  - if `isIndividual`: `[firstName, middle, last].filter(Boolean).join(" ")` (collapses double spaces when middle is blank)
  - else: `vesting`
- `exists` = true for every present lender

### 2. Publish indexed keys onto `fieldValues`

For every lender N, write these keys into the resolved value map (string values, matching how other indexed keys like `pr_li_lienHolder_N` are published):

```
lender_N_type
lender_N_vesting
lender_N_firstName
lender_N_middle
lender_N_last
lender_N_displayName
lender_N_isIndividual    // "true" | "false"
lender_N_exists          // "true"
```

Plus a single scalar:

```
lender_count             // "<N>"
```

These flow through the normal tag resolution pipeline, so `{{lender_2_displayName}}` etc. resolve like any other merge tag without further parser changes.

Backward compat: bare `ld_p_*` keys keep their current behavior (Lender 1's values), so old templates render unchanged.

### 3. Expose `lenders` array on the parser data context

Pass a `lenders: LenderData[]` collection through to `tag-parser.ts` alongside the existing `fieldValues` map. Used only by the `{{#each lenders}}` block; ignored by all existing tag resolution.

### 4. `{{#each lenders}}…{{/each}}` repeater in `tag-parser.ts`

Run **before** normal merge-tag resolution. Operate on the raw `word/document.xml`:

1. Locate `{{#each lenders}}` and matching `{{/each}}`. These may be split across runs — normalize the surrounding text first (the parser already has helpers for tag-text reassembly used by other passes).
2. Expand the block to the enclosing `<w:p>` boundaries on each side so the cloned unit is whole-paragraph(s). If the open/close tags share a paragraph with other content, abort the expansion for that block and log a warning (don't corrupt layout).
3. For each lender in the `lenders` array, clone the paragraph range and within the clone:
   - Resolve unindexed tags (`{{firstName}}`, `{{middle}}`, `{{last}}`, `{{vesting}}`, `{{type}}`, `{{displayName}}`, `{{isIndividual}}`, `{{index}}`) against that lender's object.
   - Evaluate `{{#if isIndividual}}…{{else}}…{{/if}}` (and `{{#if exists}}`) using truthy semantics: non-empty string and not literal `"false"`.
4. Concatenate clones and replace the original block.
5. If `lenders` is empty, delete the block entirely (no raw `{{#each}}` left behind) and log a warning if any `lender_*` tags were present in the source.

### 5. `{{#if lender_N_exists}}…{{/if}}` for indexed templates

Add a small conditional pass that handles `{{#if <key>}}…{{else}}…{{/if}}` against `fieldValues` (truthy = non-empty, not `"false"`). This is the same evaluator used inside `{{#each}}`, just lifted to the top level so indexed templates work without a repeater. Scope: only recognize `{{#if …}}` / `{{else}}` / `{{/if}}` — no other Handlebars features, to keep blast radius small.

### 6. Cleanup safety pass

After all resolution:
- Strip any remaining `{{lender_N_*}}` tags (lender N not present).
- Strip any orphan `{{#each lenders}}` / `{{/each}}` / `{{#if lender_*_exists}}` / `{{/if}}` markers.
- Log a console warning when `lender_count === 0` but lender tags were detected in the template.

### 7. `field_dictionary` rows

Insert only the rows that don't already exist (idempotent `ON CONFLICT (field_key) DO NOTHING`):

| field_key                | label                       | section | data_type | form_type |
|--------------------------|-----------------------------|---------|-----------|-----------|
| `ld_p_lenderType`        | Lender Type                 | lender  | dropdown  | primary   |
| `ld_p_vesting`           | Vesting                     | lender  | text      | primary   |
| `ld_p_firstIfEntityUse`  | First Name (If Entity Use)  | lender  | text      | primary   |
| `ld_p_middle`            | Middle Name                 | lender  | text      | primary   |
| `ld_p_last`              | Last Name                   | lender  | text      | primary   |

No deletions, no edits to existing rows.

### 8. Types

Add to `_shared/types.ts`:

```ts
export interface LenderData {
  index: number;
  type: string;
  isIndividual: boolean;
  vesting: string;
  firstName: string;
  middle: string;
  last: string;
  displayName: string;
  exists: true;
  [key: string]: any;
}
```

## Files changed

- `supabase/functions/generate-document/index.ts` — build `lenders[]`, publish `lender_N_*` + `lender_count`.
- `supabase/functions/_shared/tag-parser.ts` — `{{#each lenders}}` repeater, `{{#if}}` evaluator, cleanup pass.
- `supabase/functions/_shared/types.ts` — `LenderData` interface.
- DB: 5 idempotent inserts into `field_dictionary`.

## Validation

Test on a deal with 2 lenders (one Individual, one LLC):
1. Template using `{{#each lenders}}` repeater renders two signature blocks; Individual shows name parts, LLC shows vesting.
2. Template using indexed `{{lender_1_displayName}}` / `{{lender_2_displayName}}` with `{{#if lender_N_exists}}` renders both, and `{{#if lender_3_exists}}` block is removed.
3. Existing template using only bare `ld_p_firstName` / `ld_p_vesting` still renders Lender 1 exactly as before (backward compat).
4. Deal with 0 lenders: repeater block disappears; no raw `{{…}}` left; warning logged.
