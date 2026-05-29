## Problem

The template uses `{{ld_ap_primaryResidenceAddr}}` (truncated form), but the document generator only publishes the longer-named `ld_ap_primaryResidenceAddress` alias for the Lender → Authorized Party full address. Because the exact tag the template asks for is never written to the field-value map, the merge tag stays unrendered.

Confirmed in `supabase/functions/generate-document/index.ts` lines 1136–1145 — the address publisher emits:
- `authorized_signer.primary_residence_address`
- `ld_ap_primaryResidenceAddress` ← long form only
- `lender.authorized_party.address.full`
- plus the street/city/state/zip canonical keys

The underlying data (concatenated `street, city state zip` from the Lender Authorized Party form) is already being assembled correctly into `apFullAddress`; only the alias key is missing.

## Fix (single, surgical edit)

In `supabase/functions/generate-document/index.ts`, inside the `if (apFullAddress) { … }` block (~line 1139), add the truncated alias next to the existing one:

```ts
forceSet("ld_ap_primaryResidenceAddress", apFullAddress);
forceSet("ld_ap_primaryResidenceAddr", apFullAddress); // template-compatible short form
```

No other code paths, templates, schema, or UI need to change. The edge function will redeploy automatically.

## Verification

1. Regenerate the "Borrower Certification of Loan Purpose, Occupancy, and Material Facts - Integrated" document for a deal whose Lender Authorized Party has a populated address.
2. Confirm the sentence "The Authorized Signer's principal residence is located at: …" renders the full `Street, City State Zip` string.
3. Confirm the existing `{{authorized_signer.primary_residence_address}}` and `{{ld_ap_primaryResidenceAddress}}` tags still render (backward compatibility preserved).
