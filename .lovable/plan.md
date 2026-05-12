## Plan

Fix the RE851D lien detail tables so **Amount Owing** is populated in the correct column for both sections shown in the screenshot:

- **Other Liens** table: `Amount Owing` should use each matching lien’s current amount/balance.
- **Liens that will remain or are anticipated** table: `Amount Owing` should use the correct remaining/anticipated amount for that row, aligned with the same lien holder and priority.

## Targeted code change

Update only `supabase/functions/generate-document/index.ts`.

1. Add RE851D amount-owing aliases to the existing lien row publisher:
   - `pr_li_rem_amountOwing_<propertyIndex>_<slot>`
   - `pr_li_rem_amountOwing_<propertyIndex>`
   - `pr_li_ant_amountOwing_<propertyIndex>_<slot>`
   - `pr_li_ant_amountOwing_<propertyIndex>`
   - plus template-friendly variants like `amountOwing`, `amount_owing`, `amount`, and `owing` if needed by the authored DOCX.

2. Source values without changing existing lien logic:
   - Remaining rows: prefer `current_balance/currentBalance`; for paydown-style rows fall back to the relevant remaining/paydown amount only if current balance is blank.
   - Anticipated rows: prefer `new_remaining_balance/newRemainingBalance`; fall back to `anticipated_amount/anticipatedAmount`, then `original_balance/originalBalance` only if those are blank.

3. Add these new aliases to the RE851D `_N` rewrite allowlist and `effectiveValidFieldKeys` seed list so the DOCX resolver can match them directly and will not fall back to the wrong field.

4. Extend the existing RE851D post-render label-anchored pass to recognize the visible table header/label **Amount Owing** and write the resolved amount into the Amount Owing cell only when that cell is blank. This is needed because the screenshot indicates the template’s value cells may not contain usable merge tags in the correct place.

5. Keep existing mappings intact:
   - Do not alter Amount of Equity / Equity Securing Loan logic.
   - Do not alter UI, database schema, template records, or document upload flow.
   - Do not change holder/priority placement.

## Validation

After implementation:

- Deploy `generate-document`.
- Regenerate RE851D for the current deal.
- Check function logs for row-level mapping showing holder, amount owing, and priority for each row.
- Confirm the generated output has Amount Owing values under the middle column as shown in the screenshot, not shifted into holder or priority columns.