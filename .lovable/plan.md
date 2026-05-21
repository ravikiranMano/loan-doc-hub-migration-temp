
# Final-pass safety net for RE851D appraiser `{{#if (eq pr_p_perform*By_N "Broker")}}…{{/if}}`

## Problem

For DL‑2026‑0250 RE851D, the rendered docx still shows raw template literals:

```
NAME OF APPRAISER:    {{#if (eq pr_p_performeBy_N "Broker")}}BPO Performed by Broker{{else}}{{/if}}
ADDRESS OF APPRAISER: {{#if (eq pr_p_performeBy_N "Broker")}}N/A{{else}}{{/if}}
```

These should be:
- Property 1, Performed By = `Third Party` → both blank
- Property 1, Performed By = `Broker`     → `BPO Performed by Broker` / `N/A`

## What already exists

The pipeline in `supabase/functions/generate-document/index.ts` already does, in order:

1. `consolidateAppraiserConditional` (tag‑parser.ts) — joins fragmented runs into one canonical run per paragraph.
2. **Strict rewrite** (lines 6981‑7038) — converts `{{#if (eq pr_p_perform*By_<N|1-5> "Broker")}}PAYLOAD{{else?}}{{/if}}` to `{{pr_p_appraiserName_K}}` / `{{pr_p_appraiserAddress_K}}` keyed by property region (or pair‑counter fallback).
3. **Tolerant rewrite** (lines 7040+) — same but accepts missing `{{`/`}}` braces and missing `{{/if}}`.
4. Per‑property `pr_p_appraiserName_K` / `pr_p_appraiserAddress_K` values are pre‑published upstream from `pr_p_performedBy_K` (lines 2045‑2062).

The conditional sits inside a single `<w:p>` (verified against the uploaded template), so consolidation should succeed. The fact that the raw literal survives means **one of these three layers is silently skipping the block on this template revision**:

- the strict matcher's `isConsumed` guard is firing because an earlier indexed‑tag rewrite already claimed the `pr_p_performeBy_N` byte range, or
- the tolerant matcher's region/pair‑counter math leaves the block alone, or
- a later authoring‑noise stripper trims one of the braces after consolidation, breaking both matchers.

Without rerunning the generator we can't pinpoint which one, but **the surviving output is always one of two exact, recognizable forms.** A final, idempotent, byte‑level sanitizer that runs *after every other RE851D rewrite* can guarantee a clean result regardless of which earlier layer was bypassed.

## Fix — one narrow, idempotent post‑pass in `generate-document/index.ts`

### Change 1 — Final appraiser‑literal scrubber (RE851D only)

Insert **immediately after** the tolerant rewrite block (after line ~7100, before the next non‑appraiser rewrite). Scoped strictly to RE851D and strictly to the two recognized payloads, so nothing else can be affected:

```ts
if (isTemplate851D) {
  // Final scrubber: replace any surviving appraiser conditional literal
  // ({{#if (eq pr_p_perform*By_<N|1-5> "Broker")}}<PAYLOAD>{{else?}}{{/if}})
  // with the per-property merge tag {{pr_p_appraiserName_K}} /
  // {{pr_p_appraiserAddress_K}}. K is taken from the regions[] map; if
  // the literal sits outside any region (defensive), use a pair counter
  // tied to occurrence order, capped at 5. Idempotent.
  const Q = `(?:"|&quot;|\\u201C|\\u201D)`;
  const finalAppraiserRe = new RegExp(
    // optional opener braces, optional close after ), required payload,
    // optional {{else}}, optional {{/if}} (or single-brace variant)
    `(?:\\{\\{)?\\s*#\\s*if\\s*\\(\\s*eq\\s+pr_p_perform(?:e|ed)By_(?:N|[1-5])\\s*${Q}\\s*Broker\\s*${Q}\\s*\\)\\s*(?:\\}\\})?\\s*(BPO Performed by Broker|N\\/A)\\s*(?:\\{\\{\\s*else\\s*\\}\\}\\s*)?(?:\\{\\{\\s*\\/\\s*if\\s*\\}\\}|\\{\\{\\s*\\/\\s*if\\s*\\}(?!\\}))?`,
    "gi",
  );
  const pairCounter = { name: 0, addr: 0 };
  let scrubbed = 0;
  xml = xml.replace(finalAppraiserRe, (full, payload: string, offset: number) => {
    const isName = /^BPO Performed by Broker$/i.test(payload.trim());
    const kind = isName ? "name" : "addr";
    let k: number | null = null;
    for (const p of regions.props) {
      if (offset >= p.range[0] && offset < p.range[1]) { k = p.k; break; }
    }
    if (k === null) {
      pairCounter[kind] += 1;
      k = Math.min(Math.max(pairCounter[kind], 1), 5);
    }
    scrubbed++;
    const tagBase = isName ? "pr_p_appraiserName" : "pr_p_appraiserAddress";
    return `{{${tagBase}_${k}}}`;
  });
  if (scrubbed > 0) {
    debugLog(`[generate-document] RE851D final appraiser scrubber: ${scrubbed} literal(s) routed to pr_p_appraiserName/Address_K`);
  }
}
```

Key safety properties:
- **RE851D‑only** (`isTemplate851D` gate).
- Matches only the two literal payloads (`BPO Performed by Broker`, `N/A`) — no risk of consuming unrelated conditionals.
- Idempotent: after one run the literal is gone, second run is a no‑op.
- Region‑aware first, pair‑counter fallback second — preserves the same K‑assignment semantics as the existing strict/tolerant passes.
- Operates on the post‑rewrite XML, so it sweeps up *anything* the earlier two passes missed (consumed‑range conflicts, brace damage, etc.).

### Change 2 — Tighten the consumed‑range guard so strict/tolerant passes actually fire

In the strict block at line 7001 (`if (isConsumed(fullStart, fullEnd)) continue;`), the appraiser block can be marked consumed by an earlier `pr_p_performeBy_N` token rewrite that touched only the inner identifier. Replace `isConsumed(fullStart, fullEnd)` with a stricter "fully contained" check so the appraiser block is rewritten as long as its `{{#if ... {{/if}}` envelope isn't *entirely* claimed:

```ts
// Replace the existing single line:
if (isConsumed(fullStart, fullEnd)) continue;
// with:
const innerOnlyConsumed = consumed.some(
  ([s, e]) => s >= fullStart && e <= fullEnd && (e - s) < (fullEnd - fullStart),
);
if (!innerOnlyConsumed && isConsumed(fullStart, fullEnd)) continue;
```

Apply the same shape to the tolerant pass guard. This unblocks the *normal* rewrite path while Change 1 acts as a safety net.

### Change 3 — Update the project memory note

Add a one‑line memory entry under `mem://features/document-generation/re851d-appraiser-final-scrubber` so future agents see the post‑pass exists and don't reintroduce the literal.

## Files NOT changed

- No schema/UI changes.
- No `.docx` template edits.
- No changes to `field-resolver.ts` (the upstream `pr_p_appraiserName_K` / `pr_p_appraiserAddress_K` publisher at index.ts lines 2045‑2062 already produces the per‑property values).
- No changes to the consolidator regex in `tag-parser.ts` — left as the first line of defense.

## Verification

1. Deploy `generate-document`.
2. **DL‑2026‑0250 / RE851D**, Property 1 `Performed By = "Third Party"`:
   - Expected: NAME OF APPRAISER blank, ADDRESS OF APPRAISER blank.
3. Same deal, change Property 1 to `Broker`, regenerate:
   - Expected: NAME = `BPO Performed by Broker`, ADDRESS = `N/A`.
4. Regenerate any other RE851D deal — confirm no behavior change.
5. Regenerate a non‑RE851D template (RE885, Formal Request) — confirm untouched (gated by `isTemplate851D`).

