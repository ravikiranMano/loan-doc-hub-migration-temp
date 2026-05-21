I found two concrete issues:

1. The latest generation reused a cached output (`Cache HIT`), so it did not run the updated merge logic.
2. The active `Investor Questionnaire` template debug lookup is still detecting the `CO-INVESTOR NAME` cell first, and this template’s layout differs from the prior `re870/test` templates. The rewriter needs to target the real `INVESTOR NAME` cell for this template specifically.

Plan:

1. Update `generate-document` to bypass the 5-minute cache for RE870 / Investor Questionnaire templates, the same way it already bypasses cache for RE851D/RE851A/guaranty templates. This ensures document regeneration always uses the latest lender payload and template rewrite.
2. Update `rewrite-re870-multi-lender` cell detection so it ignores `CO-INVESTOR NAME` and finds the exact non-co-investor `INVESTOR NAME` cell in the `Investor Questionnaire` template layout.
3. Run the rewriter with `force: true` for the active `Investor Questionnaire` template only.
4. Verify by checking backend logs/data that the deal has 4 lender participants and that generation no longer reports `Cache HIT` for the RE870 template.

No schema changes, no UI changes, and no changes to any fields except the RE870 `INVESTOR NAME` output behavior.