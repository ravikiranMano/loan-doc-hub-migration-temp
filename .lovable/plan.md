## Plan

Fix the RE851D lender vesting merge field with the smallest backend-only change in `supabase/functions/generate-document/index.ts`.

## Findings

- The template currently uses `{{ld_p_vestin}}`.
- The active field dictionary key is `ld_p_vesting` with canonical key `lender.vesting`.
- The UI saves the CSR/Lender Information “Vesting” field through `lender.vesting`.
- The contact/deal injection path currently publishes `ld_p_vesting`, but not the truncated legacy template key `ld_p_vestin`, so `{{ld_p_vestin}}` can remain unresolved or blank.
- There is also a naming mismatch in current aliases: `lender.vesting` maps to `ld_p_vestin` in frontend legacy mapping, while the backend field dictionary uses `ld_p_vesting`.

## Implementation

1. In the lender participant injection block, publish the same authoritative CSR Lender Vesting value to all relevant aliases:
   - `ld_p_vesting`
   - `ld_p_vestin`
   - `lender.vesting`
   - `lender1.vesting`
2. Preserve existing Investor Questionnaire behavior that clears/spacing-normalizes `ld_p_vesting` by mirroring its final value into `ld_p_vestin`, so templates using either spelling render consistently.
3. Keep the change scoped to document generation only; no schema, UI, template, or layout changes.
4. Deploy the updated `generate-document` backend function.

## Validation

- Use DL-2026-0250 as the data check: the ordered primary lender is `Adwait Verma`, with Lender Vesting value `Vesting123`.
- Regenerate RE851D and verify the `NAME OF PROSPECTIVE LENDER/PURCHASER` line renders the vesting value instead of `{{ld_p_vestin}}` or blank text.
- Confirm no impact to the earlier RE851D encumbrance/balloon-payment fixes.