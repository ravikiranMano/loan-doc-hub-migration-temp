## Root cause

The "Lien Mapping Only" template (`templates.name = "Lien Mapping Only"`) is authored with **bare placeholder text** like

```
pr_li_rem_priority_{P}_{S}
pr_li_rem_interestRate_{P}_{S}
…
```

instead of the handlebar form `{{pr_li_rem_priority_1_1}}`. Two things go wrong as a result:

1. The merge-tag parser (`supabase/functions/_shared/tag-parser.ts`) only resolves text wrapped in `{{ … }}` (or Word merge fields). Bare text is left untouched and prints verbatim.
2. The existing indexed `_N_S` rewrite (`supabase/functions/generate-document/index.ts` lines 4350–4546) and the post-render publisher only target the indexed numeric form `_N` / `_N_S`; the literal `{P}` / `{S}` tokens never become indices, so even with the recent `isEncumbrancePipeline` gate the data publishers have nothing to bind to.

Since this template has no `PROPERTY #K` headings (it's the standalone single-property liens block) the indexed rewrite would also leave `_N` as `_N` for it.

## Fix (single, additive pre-pass for `isLienMappingTemplate` only)

All work lives inside `supabase/functions/generate-document/index.ts`. No DB schema, no template edits, no changes to the tag-parser, post-render publisher, addendum appender, or any other template's behavior.

### 1. Add a "literal `{P}` / `{S}` → handlebar tag" pre-pass

Insert a new block immediately **before** the existing indexed `_N_S` rewrite at line 4350, gated by `isLienMappingTemplate`:

- Unzip `templateBuffer` once with `fflate` (mirroring lines 4544–4547) — already needed by the next pass, so factor the unzip/repack so both passes share one round-trip.
- For `word/document.xml` (and any `header*.xml` / `footer*.xml`):
  - Run a tag-parser-style "merge adjacent runs" consolidation (reuse the existing helper from `tag-parser.ts`; it's already exported and used elsewhere) so a literal split across `<w:r>` boundaries is matched.
  - Scan each `<w:t … >…</w:t>` body for the regex
    ```
    pr_li_(rem|ant)_([A-Za-z_]+?)(?:_\{P\})?_\{S\}
    ```
    and the `_{P}` only variant
    ```
    pr_li_(rem|ant)_([A-Za-z_]+?)_\{P\}(?!_\{S\})
    ```
    Only act on `<field>` values inside the existing `ENC_REM_BASES` / `ENC_ANT_BASES` allow-list (lines 5780–5788) plus their snake_case aliases. Everything outside the allow-list is left alone.
  - For each matched literal, compute:
    - `P` = current PROPERTY index from the surrounding `PROPERTY #K` anchor (reuse `findAnchorOffsets` from line 4556) → defaults to `1` when no PROPERTY anchor exists (the standalone Lien Mapping case).
    - `S` = next slot index for `(P, family, fieldBase)`, starting at `1` and incremented per occurrence in document order. Tracked in a `Map<string, number>` keyed by `${P}|${family}|${fieldBase}`.
  - Replace the literal in place with `{{pr_li_<family>_<fieldBase>_<P>_<S>}}` (using underscored numeric form). The `<w:t>` keeps `xml:space="preserve"` and any sibling formatting runs.
  - Emit a single counter to `debugLog` for visibility.

Result: by the time control reaches the existing indexed `_N_S` rewrite, the `{P}/{S}` literals no longer exist; the tags are already concrete `{{pr_li_rem_priority_1_1}}` etc. The downstream pipeline runs unchanged:

- The indexed `_N_S` rewrite (line 4350) becomes a no-op for this template.
- The `effectiveValidFieldKeys` extension (line 5722) already seeds `pr_li_rem_<base>_<P>_<S>` / `pr_li_ant_<base>_<P>_<S>` for `P=1..5, S=1..10`, so resolver priority-1 direct match succeeds.
- The post-render publisher (already gated by `isEncumbrancePipeline`) emits per-slot values for all four collections (Remaining / Anticipated / overflow Remaining / overflow Anticipated) — no change.
- The addendum / overflow appender (line 7456, also gated) auto-appends a Page-2 block when `S > 2`, reusing the same tag families with incremented `_S`.

### 2. Balloon Yes/No/Unknown safety pass

The existing label-anchored safety pass (the "balloon glyph flip") at lines ~8047–8105 is gated by template name elsewhere. Verify it runs for `isLienMappingTemplate` (currently `isEncumbrancePipeline` is checked at lines 4275, 4350, 5722, 7456, but the balloon-glyph pass at ~8047 is checked separately). If it isn't, broaden that single gate to `isEncumbrancePipeline`. Strictly a one-line gate change, no logic change.

### 3. No new field_dictionary rows required

Every source field already exists. The `effectiveValidFieldKeys` extension at line 5772–5796 covers `_P`, `_P_S` resolution. No DB migration.

## Files touched

- `supabase/functions/generate-document/index.ts` — add the new pre-pass (~80 lines, gated by `isLienMappingTemplate`); optionally widen the balloon-glyph gate.

## Out of scope

- No changes to `_shared/tag-parser.ts`, `_shared/docx-processor.ts`, `_shared/field-resolver.ts`, or any other template.
- No DB schema, no `field_dictionary` rows, no template-file edits.
- No layout/style changes to the generated DOCX.

## Verification

1. Generate the document for a deal with the "Lien Mapping Only" template and a property that has 1 Remaining lien + 0 Anticipated → main slot `_1_1` populated; `_1_2` blank; addendum not appended.
2. Same with 3 Remaining + 2 Anticipated → main shows slots 1–2; addendum appended with `_1_3`; Anticipated slots 1–2 populated.
3. Generate RE851D for the same deal → identical output to current (regression check); the new pre-pass is gated by `isLienMappingTemplate` and is a no-op there.
4. Generate any other template (RE885, RE851A, etc.) → byte-identical to current.
