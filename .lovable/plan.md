
## Problem

In `Borrower_TCPA_and_E-Consent_v5.docx`:
- The **Mobile Number** cell is empty — no merge tag at all.
- The **Email Address** cell contains hardcoded `michael.carter@blueridgecap.com`.

The cell needs to render whichever phone the borrower has flagged as **Preferred** (Home / Home2 / Work / Cell).

## Good news

The edge function `supabase/functions/generate-document/index.ts` (lines 1518–1572) **already** publishes a "preferred-phone-aware" value to `br_p_cellPhone`, `br_p_mobilePhone`, and `br_p_mobileNumber`:

1. Checks `borrower1.preferred.home` → `home2` → `work` → `cell` flags.
2. Returns the phone for the flagged type.
3. Falls back to cell → mobile → home → home2 → work if nothing is flagged.

So the only fix needed is on the **template** + a new alias the user explicitly asked for.

## Changes

### 1. Patch the v5 template

Re-open `Borrower_TCPA_and_E-Consent_v5.docx` (uploaded), and:

- In the **Mobile Number** cell, insert `{{br_p_preferredPhone}}`.
- In the **Email Address** cell, replace the hardcoded `michael.carter@blueridgecap.com` with `{{br_p_emailAddres}}` (the existing canonical alias already published by the edge function at line 1514).

Upload the patched file to the `templates` storage bucket, overwriting the current TCPA template path used by the deal's packet.

### 2. Add `br_p_preferredPhone` alias (edge function)

In `supabase/functions/generate-document/index.ts`, immediately after the existing preferred-phone resolution block (line ~1572), publish the same resolved value to a new canonical key so the template tag `{{br_p_preferredPhone}}` works without depending on the legacy `cellPhone`/`mobileNumber` names:

```ts
if (publishedPhone) {
  for (const t of [...cellTargets, "br_p_preferredPhone"]) {
    fieldValues.set(t, { rawValue: publishedPhone, dataType: "text" });
  }
}
```

No new resolution logic — same `publishedPhone` already computed.

### 3. Add `br_p_emailAddress` alias (typo-tolerant)

Right after line 1514 publish the same value under the correctly-spelled key as well, so either tag works:

```ts
publishBrAlias("br_p_emailAddres",  ["borrower1.email", "borrower.email"]);
publishBrAlias("br_p_emailAddress", ["borrower1.email", "borrower.email"]);
```

### 4. Deploy

Redeploy `generate-document`. No DB migration, no field_dictionary changes (the edge function publishes these as ad-hoc aliases the same way `br_p_homePhone` is published today).

## Expected output for B-00053 (Preferred = Home)

```
Mobile Number: (213) 555-1827      ← from borrower1.phone.home (preferred=home)
Email Address: operations@sunsetequityllc.com
```

If the user later switches Preferred to Cell, the same cell automatically renders the Cell number — no template change needed.

## Out of scope

- No changes to UI, schema, field_dictionary, or any other template.
- No changes to other phone/email logic in the doc generator.
