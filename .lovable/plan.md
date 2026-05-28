# Fix: `{{#if (eq br_p_borrowerType "Individual")}}…{{else}}…{{/if}}` not switching branches

## Findings

- The data round-trips correctly:
  - `br_p_borrowerType` is stored in `deal_section_values` as composite key `borrower1::a1db9dcd-…` with `indexed_key: "borrower1.borrower_type"` and text values like `"Individual"`, `"Joint"`, `"Family Trust"`. The loader in `generate-document/index.ts` (≈ L448-491) publishes both `borrower1.borrower_type` and the canonical `br_p_borrowerType` into `fieldValues`.
  - `br_p_fullName` already has a publisher (≈ L3565-3596 in `index.ts`).
  - `br_p_vesting` already has a bridge (≈ L3628-3657) that mirrors `br_p_vesting` ↔ `br_p_vestin` ↔ `borrower1.vesting`. Stored value carries `indexed_key: "borrower1.capacity"` (canonical `br_p_capacity`), so the loader also publishes the canonical `br_p_vesting`.
- The Handlebars eq evaluator (`evaluateEqExpression`, `supabase/functions/_shared/tag-parser.ts` L1662-1696) and the `{{#if (eq …)}}…{{else}}…{{/if}}` rewriter (L2024-2054) look correct in isolation — case-insensitive eq, proper else handling, paragraph cleanup.
- Root cause is the Word XML. The existing fragmentation consolidators (L581-619) reassemble simple `{{#if KEY}}` / `{{/if}}` openers that Word splits across multiple `<w:r>` runs, **but there is no consolidator for the parenthesized `{{#if (eq FIELD "LIT")}}` form**. Word's autocorrect routinely splits this opener around the space before `(`, between `eq` and the field key, and especially around the straight or smart quotes. When that happens, the `eqIfPattern` regex at L2024 cannot match, the block never rewrites, both branches fall through to the simple-`#if` matcher with the wrong opener, and the output ends up blank or shows raw template literals.

## Fix

Edit `supabase/functions/_shared/tag-parser.ts` only. Two small additions:

1. **`#if (eq …)` opener consolidator** — add a new fragmentation pass alongside the existing simple-#if consolidator (just below L595). It matches a fragmented `{{ … #if … ( … eq … FIELD … LITERAL … ) … }}` opener — tolerating arbitrary `<…>` XML runs and whitespace between tokens, and accepting `"`, `'`, `&quot;`, and smart quotes `“ ” ‘ ’` around the literal — and rewrites it back to a single clean `{{#if (eq FIELD "LIT")}}` (or `{{#unless (eq FIELD "LIT")}}`) text token. Same pass also normalizes `{{#if (ne …)}}` / `{{#unless (ne …)}}`. This mirrors how the existing simple-#if consolidator works at L581-595 and produces input the L2024 `eqIfPattern` can already handle.

2. **Conditional alias fallback** — extend `getConditionalAliasCandidates` (L1558-1610) to add:

   ```text
   br_p_borrowertype → [br_p_borrowerType, borrower1.borrower_type, borrower.borrower_type]
   ```

   So even if the canonical key publish is ever missed (multi-borrower edge cases, legacy deals stored only under the indexed key), the eq evaluator falls back to the indexed key and the comparison still succeeds.

No template edits, no DB migration, no UI changes, no behavioral change for any other conditional — the new consolidator is gated on the `#if`/`#unless` `(eq` / `(ne` token shape and is a strict pure-text rewrite.

## Verification

1. Redeploy `generate-document`.
2. Generate `Borrower’s_Certification_of_Facts` (template `1822831a-…`) against three test deals:
   - Borrower type = `"Individual"` (e.g. deal `4d068cfa-…`) → output must show the full name, not the vesting value.
   - Borrower type = `"Joint"` (e.g. `8a4d9ab1-…`) → output must show the vesting value, not the name.
   - Borrower type = `"Family Trust"` (e.g. the `2026-03-16` row) → must show the vesting value.
3. Tail `supabase--edge_function_logs generate-document` and confirm log lines `[tag-parser] Consolidated fragmented {{#if (eq br_p_borrowerType "Individual")}}` and `[tag-parser] Conditional {{#if (eq br_p_borrowerType "Individual")}} = true|false` appear with the expected booleans.
4. Regression check: regenerate one RE851A and one RE851D template that already use `{{#if (eq …)}}` (e.g. the `pr_p_performeBy_N "Broker"` conditionals) — they must continue to render identically.

## Files touched

- `supabase/functions/_shared/tag-parser.ts` — ~25 new lines total (one consolidator regex + one alias-candidate branch). No other files.

## Open clarification

If the user is seeing a *different* symptom (e.g. both branches printing, or the `#if` line printing literally) on a template **other than `Borrower’s_Certification_of_Facts V1 - Entity1`**, please share the template filename so this fix can be validated against it before rollout.
