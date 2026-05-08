## Root Cause

The RE885 template compares `origination_fees.re885_cash_at_closing_amount` (the **dollar amount** field) against the strings `"Payable to you"` / `"You Must Pay"`. That comparison can never match because:

1. The label/option is stored in a **different field**: `origination_fees.re885_cash_at_closing_option`.
2. That field stores **codes** (`payable_to_you`, `you_must_pay`), not the human labels (`Payable to you`, `You Must Pay`).
3. The `_amount` field holds a currency string (e.g. `"$1,234.00"`), so `(eq amount "Payable to you")` is always false.

UI source of truth (confirmed in `src/components/deal/RE885ProposedLoanTerms.tsx`):
```
setValue('origination_fees.re885_cash_at_closing_option',
  cashAtClosing >= 0 ? 'payable_to_you' : 'you_must_pay');
```

## Fix (edge function only — no UI / template / schema changes)

**File:** `supabase/functions/generate-document/index.ts` — extend the existing "Estimated Cash at Closing alias publisher" block (≈ lines 772–785).

Add three publications derived from `origination_fees.re885_cash_at_closing_option` (with safe fallbacks):

1. **Boolean flags** for the recommended robust template form:
   - `re885_cash_payable_to_you` → `"true"` / `"false"`
   - `re885_cash_you_must_pay` → `"true"` / `"false"`
   - dataType: `boolean`

2. **Normalized canonical labels** so the existing `(eq … "Payable to you")` and `(eq … "You Must Pay")` template conditions also work without any template edit. Publish the canonical label string to **both**:
   - `origination_fees.re885_cash_at_closing_option` (overwrite with normalized label)
   - `origination_fees.re885_cash_at_closing_amount_label` (new sibling alias for templates that want to keep `_amount`-prefixed naming)

   Mapping:
   - `payable_to_you` / `payable to you` / `payabletoyou` → `"Payable to you"`
   - `you_must_pay`   / `you must pay`   / `youmustpay`   → `"You Must Pay"`
   - anything else → leave as-is (no overwrite)

3. **Debug log line**: `[generate-document] RE885 CashAtClosingType raw="<raw>" canonical="<label>" payable=<bool> mustPay=<bool>`

### Pseudocode (inserted right after the existing ECAC block)
```ts
const rawOpt = String(
  fieldValues.get("origination_fees.re885_cash_at_closing_option")?.rawValue ?? ""
).trim();
const norm = rawOpt.toLowerCase().replace(/[\s_-]+/g, "");
let canonical = "";
if (norm === "payabletoyou")      canonical = "Payable to you";
else if (norm === "youmustpay")   canonical = "You Must Pay";

const isPayable = canonical === "Payable to you";
const isMustPay = canonical === "You Must Pay";

fieldValues.set("re885_cash_payable_to_you", { rawValue: isPayable ? "true" : "false", dataType: "boolean" });
fieldValues.set("re885_cash_you_must_pay",   { rawValue: isMustPay ? "true" : "false", dataType: "boolean" });

if (canonical) {
  fieldValues.set("origination_fees.re885_cash_at_closing_option",      { rawValue: canonical, dataType: "text" });
  fieldValues.set("origination_fees.re885_cash_at_closing_amount_label",{ rawValue: canonical, dataType: "text" });
}
console.log(`[generate-document] RE885 CashAtClosingType raw="${rawOpt}" canonical="${canonical}" payable=${isPayable} mustPay=${isMustPay}`);
```

## Template Recommendation (optional, for the doc author — NOT a code change)

Switch the two checkbox tags from string-eq to boolean checks for robustness:
```
{{#if re885_cash_payable_to_you}}☑{{else}}☐{{/if}}
{{#if re885_cash_you_must_pay}}☑{{else}}☐{{/if}}
```
The existing `(eq origination_fees.re885_cash_at_closing_amount …)` form will also start working because we now publish the canonical label into the option field and a new `_amount_label` sibling — but the eq path is using the wrong field name; templates should be updated to use either the new boolean flags **or** the option / `_amount_label` field.

## Mutual Exclusivity & Edge Cases
- Only one of `isPayable` / `isMustPay` can ever be true (driven by a single radio in the UI).
- Empty / unknown selection → both booleans `"false"`, both checkboxes render `☐`.
- Whitespace, casing, and underscore/space variants all normalize to the same canonical label.

## Out of Scope
- No UI changes.
- No DOCX template layout changes (template author may optionally adopt the new boolean tags).
- No DB schema / dictionary changes.
- Backward compatible: existing `_amount` currency value is untouched; existing aliases continue to publish.