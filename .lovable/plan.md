## Problem

In the latest RE851D generation, the "NAME OF PROSPECTIVE LENDER/PURCHASER" cell renders the literal text:

```
ld_p_vesting     k
```

instead of the lender's vesting value (e.g. `JOHN K SMITH, TRUSTEE OF ...`). The tag is being printed verbatim — the merge engine never replaces it. Every other tag in the same line (first / middle / last name) renders normally, which is why a stray "k" (initial) survives next to the unresolved identifier.

## Root cause

1. The data pipeline IS publishing `ld_p_vesting` correctly:
   - `supabase/functions/generate-document/index.ts` L860–870 sets `ld_p_vesting`, `ld_p_vestin`, `lender.vesting`, `lender1.vesting` from `lcd.vesting`.
   - L4817–4836 then normalizes it (adds trailing space for entity types, mirrors to truncated alias `ld_p_vestin`).
   - `ld_p_vesting` is present in `field_dictionary` (`aab82127-…`), so `validFieldKeys` accepts it.

2. The RE851D V12.1 template authored the lender‑vesting placeholder with malformed braces around the identifier. Earlier post‑processing landed several known‑bad variants: `{ld_p_vestin`, `{ld_p_vestin}`, `{{ld_p_vestin}`. A targeted repair pass exists at `supabase/functions/generate-document/index.ts` L5952–5968:

```ts
xml = xml.replace(
  /(<w:t(?:\s[^>]*)?>)([^<]*ld_p_vestin[^<]*)(<\/w:t>)/g,
  (_m, open, body, close) => {
    const repaired = body.replace(
      /\{\{?\s*ld_p_vesting?\s*\}?\}?/g,
      "{{ld_p_vestin}}",
    );
    return `${open}${repaired}${close}`;
  },
);
```

The inner regex `\{\{?\s*ld_p_vesting?\s*\}?\}?` REQUIRES at least one literal `{` (the leading `\{` is mandatory). In the current template the identifier text run no longer carries ANY brace — the opening `{{` lives in a previous run that was stripped/separated during normalize, and the trailing `}}` lives in a later run. After `normalizeWordXml` merged runs, what survives in the single `<w:t>` body is just:

```
ld_p_vesting
```

with no braces. The repair regex therefore does not match, the body is returned unchanged, Handlebars sees no tag, and the post‑render unresolved scanner (L10805, `/\{+\s*ld_p_vestin(?:g)?\s*\}*/g`) also requires `{`, so it logs `unresolved: none` even though the bare identifier is leaking to the rendered document.

This is why the bug regressed silently — every guard in the pipeline is keyed on the presence of `{`.

## Fix (minimal, additive, RE851D‑only)

### `supabase/functions/generate-document/index.ts`

1. **Broaden repair (h) at L5952–5968** to also rewrite a bare `ld_p_vesting` / `ld_p_vestin` identifier (no braces) into `{{ld_p_vestin}}`, but only when it is NOT already adjacent to a `{` (so we never double‑wrap a tag that the existing branch already fixed). Scope stays limited to a single `<w:t>` body and only fires for this exact identifier — no other prose can be affected because `ld_p_vesting` cannot legitimately appear as document text.

   Concretely, after the existing inner replace, add a second pass on the same body:
   ```ts
   const repaired2 = repaired.replace(
     /(^|[^{A-Za-z0-9_])ld_p_vestin(?:g)?(?![A-Za-z0-9_}])/g,
     "$1{{ld_p_vestin}}",
   );
   ```
   This converts a bare leading/standalone identifier into the canonical `{{ld_p_vestin}}` tag, which the existing Handlebars resolver then renders from the already‑published `ld_p_vestin` value.

2. **Tighten the post‑render unresolved scanner at L10805** so it also catches a bare identifier (no braces) and logs it. Replace:
   ```ts
   const vestingHits = xml.match(/\{+\s*ld_p_vestin(?:g)?\s*\}*/g) || [];
   ```
   with:
   ```ts
   const vestingHits = xml.match(/(?:\{+\s*)?ld_p_vestin(?:g)?(?:\s*\}+)?/g) || [];
   ```
   so future regressions surface in the logs instead of being silently uploaded.

No changes to: data publishers (L840–870, L4817–4836), the template, the field dictionary, the field map, RLS, UI, or any other template/pipeline. Repair stays scoped to the literal identifier `ld_p_vestin[g]` inside `<w:t>` bodies that already match the existing guard.

## Validation

1. Regenerate RE851D for deal `a4eefafb-cd04-4bf5-adb8-f432d79e0e65` → the "NAME OF PROSPECTIVE LENDER/PURCHASER" cell now shows the lender's vesting value followed by the name, with no literal `ld_p_vesting` text.
2. Edge function logs print `RE851D unresolved Remaining placeholders before upload/PDF: none` after the run (or, if it doesn't, the new scanner will print the offending identifier so we can keep narrowing).
3. No regression on RE851D documents whose templates already use clean `{{ld_p_vesting}}` / `{{ld_p_vestin}}` — the new branch is a no‑op for those because braces are already present and adjacent to the identifier.

## Out of scope

- Field dictionary, RLS, packets, templates table, template storage — no changes.
- RE851A, RE851D, RE885 logic unrelated to the vesting tag — untouched.
- UI, styling, validation — no changes.
