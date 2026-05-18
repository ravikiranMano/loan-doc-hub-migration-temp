## Problem

In `supabase/functions/generate-document/index.ts` (line 131), the encumbrance rendering pipeline is gated by:

```ts
const isEncumbrancePipeline = isTemplate851D || isLienMappingTemplate;
```

This gate controls 5 sub-passes that together make `{{pr_li_rem_*_{N}_{S}}}` and `{{pr_li_ant_*_{N}_{S}}}` placeholders resolve:

1. Line ~4943 — upfront authoring-noise strip (rsid attrs, proofErr, etc.) so XML fragmentation doesn't break tag matching.
2. Line ~5150 — `{N}`/`{S}` → `_N_S` indexed-tag rewriter (turns `pr_li_rem_priority_{1}_{1}` into a concrete `pr_li_rem_priority_1_1` handlebar).
3. Line ~6616 — `effectiveValidFieldKeys` seeding so the resolver matches `pr_li_(rem|ant)_*_P[_S]` directly instead of collapsing to a bare key.
4. Line ~8964 — overflow addendum appender (3rd+ liens) + "set forth in attachment" YES checkbox.
5. (Already-running publisher at ~4000 is template-agnostic and populates `fieldValues`, but the values never reach the document because passes 1–4 don't run for RE851A.)

Because RE851A is not in the gate, all four supporting passes are skipped, and every `pr_li_rem_*` / `pr_li_ant_*` placeholder in the RE851A template renders blank — even though the publisher already produced the data (visible in the existing log line "RE851D Remaining Encumbrance data before render"). The RE851D template runs the same publisher and works correctly because the gate enables passes 1–4 for it.

The memory note `mem://features/document-generation/re851a-encumbrance-pipeline` already documents that RE851A should be enrolled in this gate, so the desired state is to restore that enrollment.

## Fix (single-line change)

In `supabase/functions/generate-document/index.ts`, line 131, extend the gate:

```ts
const isEncumbrancePipeline =
  isTemplate851D || isLienMappingTemplate || /851a/i.test(template.name || "");
```

That enables all four supporting passes for RE851A without touching the publisher, the RE851D-only multi-property/Q1–Q6/checkbox/safety passes, the template, the UI, the database, or any other behavior. The five passes are already template-agnostic in their internals — they only operate on whatever `pr_li_(rem|ant)_*` placeholders exist in the rendered document and whatever lien data the publisher already produced.

## Why this is safe (no scope creep)

- The four passes only look for the `pr_li_(rem|ant)_*_{N}_{S}` token family and known RE851D indexed bases — RE851A doesn't author conflicting tokens, so the rewriter and seeder are no-ops where nothing matches.
- The authoring-noise strip is whitespace/cosmetic XML only (rsid, proofErr, lastRenderedPageBreak, _GoBack). No structural Word elements are altered.
- The addendum appender only appends content when a property has >2 remaining or >2 anticipated liens — exactly the same overflow rule RE851D already uses.
- No change to: publisher logic, indexed publisher set, RE851D-only multi-property cloner, taxes/Q1–Q6/checkbox passes, template XML, RE851A formatting/alignment/table structure, field names, business logic, UI, schema, or any other RE851A safety pass.

## Validation

After the change, regenerate RE851A for the deals in the existing log (single-lien, multi-lien, remaining-only, anticipated-only) and confirm:

- `pr_li_rem_*_1_1`, `_1_2`, … render real values.
- `pr_li_ant_*_1_1`, `_1_2`, … render real values.
- 3rd+ liens appear in the appended addendum.
- No unresolved `{{pr_li_(rem|ant)_*}}` placeholders remain (the existing post-render log `"RE851D unresolved Remaining placeholders before upload/PDF"` will now also cover RE851A — extend its template gate to log RE851A too only if the existing check is RE851D-gated; otherwise leave alone).

## Out of scope

Template DOCX edits, publisher rewrites, new field aliases, RE851A-specific safety passes, RE851D multi-property/cloner behavior, UI, database, APIs, formatting, alignment, table structure, field names.