# Limit `{{pr_li_lienHolder}}` to the 1st-priority lien for Formal_Request_for_Information V7

## Problem
For the **Formal_Request_for_Information V7** template, `{{pr_li_lienHolder}}` currently renders the holders of *all* liens (newline-joined by the generic lien aggregator). The template expects only the holder whose lien priority is `1st`.

## Root cause
`pr_li_lienHolder` is published by the generic lien-aggregation path (which joins every lien's `holder` value). There is already a template-scoped re-publisher for RE885 at `supabase/functions/generate-document/index.ts` line 3968 (`if (isTemplate885) { … fieldValues.set("pr_li_lienHolder", …) }`), but no equivalent for the Formal Request template, so the aggregated multi-lien string passes through.

## Fix scope — one narrow edit, no behavior changes elsewhere

### `supabase/functions/generate-document/index.ts`

1. Add a template gate alongside the existing ones at line ~143:
   ```ts
   const isTemplateFormalRequestInfo =
     /formal[_\s-]*request[_\s-]*for[_\s-]*information/i.test(template.name || "");
   ```

2. Immediately after the RE885 block (line 4084, just before the closing of the encompassing scope), add a parallel block:
   ```ts
   if (isTemplateFormalRequestInfo) {
     // Find the lien whose priority is "1st" and publish ONLY its holder
     // into pr_li_lienHolder. Falls back to the existing aggregated value
     // when no lien matches, so behavior degrades gracefully.
     const candidates: Array<{ idx: number; priority: string; holder: string }> = [];
     for (const [key, val] of fieldValues.entries()) {
       const m = key.match(/^lien(\d*)\.(.+)$/);
       if (!m) continue;
       const idx = parseInt(m[1] || "0", 10);
       const field = m[2];
       if (field !== "lien_priority_now" && field !== "priority" && field !== "lien_priority") continue;
       const prio = String(val?.rawValue ?? "").trim().toLowerCase();
       const holderVal = fieldValues.get(`lien${m[1]}.holder`)?.rawValue
                      ?? fieldValues.get(`lien${m[1]}.lienHolder`)?.rawValue
                      ?? "";
       candidates.push({ idx, priority: prio, holder: String(holderVal).trim() });
     }
     // Match "1st" (also tolerate "1", "first")
     const isFirst = (p: string) => p === "1st" || p === "1" || p === "first";
     const winner = candidates
       .filter((c) => isFirst(c.priority) && c.holder !== "")
       .sort((a, b) => a.idx - b.idx)[0];
     if (winner) {
       fieldValues.set("pr_li_lienHolder", {
         rawValue: winner.holder,
         dataType: "text",
       });
       debugLog(`[generate-document] Formal_Request_for_Information: pr_li_lienHolder restricted to 1st-priority lien (lien${winner.idx} holder="${winner.holder}")`);
     }
   }
   ```

This runs AFTER the generic aggregator has already published the joined value, so it cleanly overrides it. If no lien has priority "1st", the aggregated value is left untouched (safe fallback).

## Files NOT changed
- No schema changes, no UI changes, no template-file changes.
- All other `pr_li_*` aggregations and all other templates are unaffected (gated strictly by `isTemplateFormalRequestInfo`).

## Verification
1. Deploy `generate-document`.
2. Open a deal with multiple liens (e.g. 1st, 2nd) and generate **Formal_Request_for_Information V7**.
3. Confirm `{{pr_li_lienHolder}}` renders only the holder name of the lien marked priority `1st`.
4. Confirm other templates (RE885, RE851D, etc.) are unchanged.
