
## Root cause

In `supabase/functions/generate-document/index.ts` (lines 4102–4131), the bare `pr_li_lienCurrenBalanc` alias is computed as the SUM of `current_balance` across **every** entry in `lienFieldCollector["current_balance"]`.

The collector contains both the **legacy `lien.*` mirror (index 0)** and the **indexed `lien1.*`, `lien2.*`, …** entries. The per-lien cell publisher right above (line 4060) explicitly dedupes by dropping index‑0 whenever any indexed lien exists:

```ts
const hasIndexed = entries.some(e => e.index >= 1);
const dedupedEntries = hasIndexed ? entries.filter(e => e.index >= 1) : entries;
```

…but the SUM block on lines 4106–4117 uses `cbEntries` **without** that dedup, so the legacy mirror is added on top of the indexed lien — producing $50,000 from a single $25,000 lien on DL‑2026‑0266.

The same bug affects all aliases the block publishes:
- `pr_li_lienCurrenBalanc`
- `pr_p_currentBalanc`
- `li_p_currentBalance`
- `li_lt_currentBalance`

## Fix

Apply the identical dedup rule to the SUM block. Change lines 4106–4117 so the loop iterates over `dedupedCbEntries` instead of `cbEntries`:

```ts
const cbEntries = lienFieldCollector["current_balance"];
if (cbEntries && cbEntries.length > 0) {
  // Match the per-lien dedup above: drop legacy lien.* (index 0) when any
  // indexed lien (lien1.*, lien2.*, …) is present, so the mirror isn't
  // double-counted into the aggregated SUM aliases.
  const hasIndexed = cbEntries.some(e => e.index >= 1);
  const dedupedCbEntries = hasIndexed ? cbEntries.filter(e => e.index >= 1) : cbEntries;

  let sum = 0;
  let contributing = 0;
  for (const e of dedupedCbEntries) {
    if (e.value === null || e.value === undefined || String(e.value).trim() === "") continue;
    const n = parseFloat(String(e.value).replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(n)) { sum += n; contributing++; }
  }
  // …rest unchanged (aliases, fieldValues.set, debugLog)
  debugLog(`[generate-document] Aggregated current_balance SUM across ${contributing}/${dedupedCbEntries.length} lien(s) (deduped from ${cbEntries.length}) for aliases […]: ${formatted}`);
}
```

No change to data type, formatting, alias list, or any other field.

## Verification

After deploy, regenerate RE851a for DL‑2026‑0266 and confirm:

| Tag | Before | After |
|---|---|---|
| `{{pr_li_lienCurrenBalanc}}` | $50,000.00 | **$25,000.00** |
| `{{pr_p_currentBalanc}}` | $50,000.00 | **$25,000.00** |
| `{{pr_netPropertyValue}}` (depends on this) | 450,000 | **475,000** (500,000 − 0 − 25,000 − 25,000 anticipated) |

Also spot-check a multi-lien deal (e.g. 2 indexed liens of $10k + $15k) to confirm the SUM still returns $25,000 — dedup only fires when index‑0 coexists with indexed entries.

## Scope

- Single file: `supabase/functions/generate-document/index.ts` (~lines 4102–4131).
- Redeploy `generate-document`.
- No DB migration, no schema change, no template change.
