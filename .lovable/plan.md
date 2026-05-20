## Goal

Rename the Broker placeholder in the `Addendum_to_LPDS` document template from `{{bk_p_company}}` to `{{bk_p_licenseeNameIfEntity}}` to match the renamed Broker profile field ("Broker Company" → "Licensee Name If Entity"), and publish the new key from the backend so the broker's value (e.g. "Programming.com" for BR-00001) populates correctly.

No UI, schema, validation, or save flow changes — the underlying data column is unchanged, only the display label and the document tag are being aligned.

## Changes

### 1. Backend — `supabase/functions/generate-document/index.ts`

In the broker injection block (around line 937, right after the existing `forceSet("bk_p_company", company)`), add one additional publisher for the new alias so both old and new tags resolve to the same value:

```ts
forceSet("bk_p_company", company);
forceSet("bk_p_licenseeNameIfEntity", company);  // NEW: renamed UI label "Licensee Name If Entity"
```

Source of truth stays the same broker contact field (`contact_data.company` / `broker.company`), which is what the "Licensee Name If Entity" input currently writes to. The legacy `bk_p_company` alias is kept intact so any other template still using the old tag continues to render — minimal-change policy.

Then redeploy the `generate-document` edge function.

### 2. Template — `Addendum_to_LPDS.docx`

Update the uploaded template file:

- Find: `Broker: {{bk_p_company}}`
- Replace with: `Broker: {{bk_p_licenseeNameIfEntity}}`

Unpack the .docx, edit `word/document.xml` (the merge tag may be split across multiple `<w:r>` runs — merge adjacent runs first if needed), repack, and re-upload to the document templates store via Admin → Templates so the new version replaces the existing one.

## Verification

1. Open broker BR-00001 — "Licensee Name If Entity" shows `Programming.com`.
2. Generate `Addendum_to_LPDS` for a deal with BR-00001 as the broker.
3. Confirm the Broker line renders: `Broker: Programming.com`.
4. Edge function logs show `bk_p_licenseeNameIfEntity` resolved to `Programming.com`.

## Out of scope

- No changes to the Broker profile UI, field dictionary, `legacyKeyMap.ts`, `fieldKeyMap.ts`, database column, or any other template.
- The legacy `bk_p_company` alias is preserved and continues to work for all other templates.
