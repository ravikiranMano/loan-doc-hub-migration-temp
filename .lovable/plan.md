I found two likely causes for the RE851A `{{#if or_p_isBrkBorrower}}...{{else}}...{{/if}}` failure:

1. The generator currently writes `or_p_isBrkBorrower` as the strings `"true"` / `"false"`. The custom parser treats those correctly, but any remaining native/standard Handlebars-style evaluation can treat non-empty `"false"` as truthy.
2. The shared RE851A broker-capacity safety pass is still active after conditional rendering and its comments/tests are internally inconsistent with the intended row behavior. Based on your template snippets, the intended result is:
   - Yes / true: A. Agent = unchecked, B. Principal as borrower = checked
   - No / false: A. Agent = checked, B. Principal as borrower = unchecked

Plan:

1. Update the broker-borrower publisher in `supabase/functions/generate-document/index.ts` so `or_p_isBrkBorrower`, `or_p_brkCapacityAgent`, and `or_p_brkCapacityPrincipal` are stored as real booleans, not string booleans, while keeping glyph aliases unchanged.
2. Remove the later overwrite risk from the duplicate `or_p_isBrokerAlsoBorrower` derivation by making it respect the borrower dropdown/source-of-truth value instead of defaulting to false when only the dropdown is present.
3. Correct the RE851A broker-capacity post-render safety pass in `supabase/functions/_shared/tag-parser.ts` so it enforces the same intended mapping as your inline conditionals:
   - `or_p_isBrkBorrower=true` → A `☐`, B `☑`
   - `or_p_isBrkBorrower=false` → A `☑`, B `☐`
4. Add/update focused regression tests for:
   - direct inline conditional blocks with `or_p_isBrkBorrower=true/false`
   - static A/B label fallback safety pass with true/false
   - soft-break A/B paragraph case

No schema/UI changes are needed.