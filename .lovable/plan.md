## Problem

In the RE851A template, the merge tag `{{br_p_address}}` renders blank (no value) even when the deal has a primary borrower with a street address.

## Root cause

The borrower-detail form writes the **street** into the deal under the UI key `borrower.address.street`, which the legacy key map (`src/lib/legacyKeyMap.ts:32`) translates to the field_dictionary entry `br_p_address`. There are three independent paths in `supabase/functions/generate-document/index.ts` that should publish `br_p_address` into the merge map:

1. **Deal section values** (lines ~366–449) — for each `field_values` row, sets `fieldValues.set(fieldDict.field_key, …)`. Works only if the deal saved a row for the `br_p_address` field_dictionary id.
2. **Participant contact injection** `injectContact(...)` (line 548–551) — sets `${shortPrefix}_address` from `cd["address.street"]` only when shortPrefix is `"br_p"` (primary borrower). Runs `setIfEmpty`, so it fills only when the section path didn't.
3. **Composite address autocompute** (lines ~2580–2595) — builds the joined `Borrower.Address` / `borrower.address` strings, but never writes back to the short key `br_p_address`.

`br_p_address` ends up empty in three real cases:
- The borrower form saved the street under a non-canonical UI key (`borrower.address.street`) but legacy resolution at save time stored it under a different composite (`borrower::<other_dict_id>`), so the load step does not produce a row keyed to the `br_p_address` dictionary id.
- The deal has no `borrower::*` section row for street yet (legacy data) and the participant contact's `contact_data["address.street"]` is missing/empty (street typed only into the deal form, not the contact card).
- A non-primary borrower contact is the source of the address, so `shortPrefix === "br_p"` injection skips it.

In all three cases, the existing `borrower.address.street` value sits in `fieldValues` (set by the section loader as a dot-notation key from the bridged composite) but is never copied to `br_p_address`, so the tag stays blank.

## Fix (scoped, backend only)

In `supabase/functions/generate-document/index.ts`, add a small **post-load publisher** for `br_p_address` immediately after the existing "Auto-compute Borrower.Address" block (~line 2595). No schema changes, no template changes, no other field touched.

```text
After the existing autocompute of borrower.address (full string):

  if (!fieldValues.get("br_p_address")?.rawValue) {
    const street =
      fieldValues.get("borrower.address.street")?.rawValue ||
      fieldValues.get("borrower1.address.street")?.rawValue ||
      fieldValues.get("borrower.street")?.rawValue ||
      fieldValues.get("br_p_street")?.rawValue ||
      // last-resort: pull from primary borrower contact_data already loaded above
      primaryBorrowerContactData?.["address.street"];
    if (street && String(street).trim() !== "") {
      fieldValues.set("br_p_address", { rawValue: String(street), dataType: "text" });
      debugLog(`[generate-document] Auto-published br_p_address = "${street}"`);
    }
  }
```

This mirrors the existing safety pattern used for `Borrower.Address` and `Lender.Address` (lines 2580–2612) but targets the short-form merge tag specifically. It runs after both the section loader and `injectContact`, so it only fires when nothing else has resolved `br_p_address`.

## Verification

1. Generate RE851A on a deal where the borrower street was entered in the deal form only → `{{br_p_address}}` renders the street.
2. Generate RE851A on a deal where the street exists only in the contact card → `{{br_p_address}}` renders the street.
3. Regression: generate RE851A on a deal that already has `br_p_address` populated via section row → output unchanged.
4. Regression: generate RE851D and any other template with `{{br_p_address}}` → identical to current behaviour for the populated case.
5. Inspect edge function logs for the new `Auto-published br_p_address` debug line to confirm which path resolved it.

## Out of scope

- No changes to `field_dictionary`, `legacyKeyMap.ts`, `field_resolver.ts`, `tag-parser.ts`, or any UI form.
- No changes to other `br_p_*` keys, `borrower.address` composite, or co-borrower address.
- No schema migration.
- No template layout/style change.

## Files to change

- `supabase/functions/generate-document/index.ts` — add ~10 lines after the existing borrower-address autocompute block.
