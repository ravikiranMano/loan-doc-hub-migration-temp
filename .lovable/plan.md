# Fix `pr_li_balanceAfterPaydown` to aggregate across all liens

## Problem
In `supabase/functions/generate-document/index.ts` (lines ~4405–4481), the aggregated `pr_li_balanceAfterPaydown` field currently:
- When 1 lien → emits that lien's `current_balance − existing_paydown_amount`.
- When >1 liens → emits a **newline‑joined list** of per‑lien values (not a sum).

The per‑lien indexed aliases `pr_li_balanceAfterPaydown_N` are correct and unchanged.

## Change (single, surgical)
Replace the aggregated publisher so it always emits the **sum** of all per‑lien `(current_balance − existing_paydown_amount)` values:

- Iterate every lien index found (existing `orderedIdx` loop already computes each per‑lien result).
- Sum the numeric per‑lien results, skipping liens with no `current_balance` (treated as 0) and ignoring null/undefined/non‑numeric values (existing `toNum` already handles this).
- Publish:
  - `pr_li_balanceAfterPaydown` = `formatCurrency(total.toFixed(2))`, `dataType: "currency"`.
  - Per‑lien aliases `pr_li_balanceAfterPaydown_N` unchanged.
- If no liens → do not publish (matches existing "blank" behavior) — equivalent to existing standard for empty collections.

## Acceptance
- 1000 + 1500 + 500 → `$3,000.00`
- 2000 → `$2,000.00`
- 1000 + null + 500 → `$1,500.00`
- Single‑lien deals remain backward compatible (sum of one = that value).
- Per‑lien `_N` aliases still available for templates that need them.

## Scope guardrails (not changed)
- No DB schema, no field_dictionary, no UI, no merge_tag_aliases, no other calc blocks.
- `pr_li_totalLienBalance` and `li_bp_balanceAfter` blocks untouched.
- Only the aggregated publisher inside the existing `// ── Calculated field: pr_li_balanceAfterPaydown` block is modified.

## File
- `supabase/functions/generate-document/index.ts` — lines ~4454–4480 (replace newline‑join with sum).
