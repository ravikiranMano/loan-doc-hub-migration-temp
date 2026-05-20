# Fix: `{{bk_p_licenseeNameIfEntity}}` Empty in Generated Documents

## Root cause

In `supabase/functions/generate-document/index.ts` (line 928), the broker injection block reads the company value as:

```ts
const company = cd.company || cr.company || "";
```

The Broker profile UI was renamed from **Broker Company** to **Licensee Name If Entity**, and it now persists into `contact_data.licensee_name_if_entity` (see `ContactBrokersPage.tsx` line 51 and `ContactBrokerDetailLayout.tsx` line 138, which already reads both keys).

Because `generate-document` never looks at `licensee_name_if_entity`, any broker whose value was entered via the new field has an empty `company` → `forceSet("bk_p_licenseeNameIfEntity", "")` → the tag renders blank in `Addendum_to_LPDS` and every other template.

The previous template tag replacement (`{{bk_p_company}}` → `{{bk_p_licenseeNameIfEntity}}`) was correct and is not the problem; the missing piece is the data payload mapping.

## Fix (single, surgical change)

Update the broker injection in `supabase/functions/generate-document/index.ts` around line 928 to prefer the new field, falling back to the legacy one for older records:

```ts
const company =
  cd.licensee_name_if_entity ||
  cd["licensee_name_if_entity"] ||
  cd.company ||
  cr.company ||
  "";
```

This single `company` variable already feeds:
- `bk_p_company` (legacy / backward-compat)
- `bk_p_licenseeNameIfEntity` (new tag)
- `bk_p_brokerName`

so fixing it here propagates to **every** template that uses any of those tags — including `Addendum_to_LPDS` and the other ~127 templates updated previously.

## Out of scope (no changes needed)

- `legacyKeyMap.ts` — already maps both `broker.company` and `broker.licensee_name_if_entity` to `bk_p_licenseeNameIfEntity`.
- `field_dictionary` — already migrated.
- Template `.docx` files — tag replacement already completed in prior batches.
- UI form (`BrokerInfoForm.tsx`) — already saving to the correct key.

## Verification

1. Open a Broker whose **Licensee Name If Entity** is set (e.g. `BR-00009 → BR-NM-Star Enterprises`).
2. Regenerate `Addendum_to_LPDS` for a deal that uses this broker.
3. Confirm the `{{bk_p_licenseeNameIfEntity}}` position renders `BR-NM-Star Enterprises` instead of a blank.
4. Spot-check one legacy broker whose value lives in `contact_data.company` to confirm the fallback still works.

## Remaining template batch

The prior task left ~115 templates still to scan/replace for the `{{bk_p_company}}` → `{{bk_p_licenseeNameIfEntity}}` tag rename. After approval, I will also re-run `replace-broker-company-tag` to finish those batches so every template uses the new tag name consistently.
