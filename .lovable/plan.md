## Problem

The RE851D `.docx` now uploads as `success` but Google Docs / Word can't open it ("File could not open"). Inspecting the latest generated file (`v64`) confirms `word/document.xml` is malformed — at byte 656,876 (and again at 701,064) the XML contains:

```
<w:rPr><w:rFonts w:ascii="Time<w:r w:rsidDel="00000000" ...><w:rPr><w:rtl w:val="0"/></w:rPr></w:r></w:p></w:tc>
```

In the working `v62`, the same location was a complete `<w:rFonts w:ascii="Times New Roman" .../></w:rPr></w:pPr><w:r ...>...`. A chunk of XML was overwritten mid-attribute, leaving an unclosed `<w:rFonts w:ascii="Time…` and stray `</w:r></w:p></w:tc>` tags. This breaks XML well-formedness, which is why every viewer rejects the file.

## Root cause

The recent CPU-fix in `supabase/functions/generate-document/index.ts` made `__xmlSet` *lazy*: when the new XML length equals the previous length, it keeps `__visProjCache` and `__xmlLowerCache`:

```ts
// lines 5193-5200
const __xmlSet = (filename: string, xml: string): Uint8Array => {
  const prev = __xmlStrCache[filename];
  __xmlStrCache[filename] = xml;
  __xmlDirty.add(filename);
  if (prev === undefined || prev.length !== xml.length) {
    delete __visProjCache[filename];
    delete __xmlLowerCache[filename];
  }
  ...
};
```

`__visProjCache` stores a segment table (`xmlStart`, `txtStart`, `segLen`) and a binary-search-backed `proj.map[i]` that maps a visible-text index → an XML byte offset. Length-preserving mutations (e.g. glyph swaps, same-length `<w:t>` replacements) **do not change byte offsets**, but they **do change the visible-text content** at those offsets. Subsequent post-render safety passes therefore:

1. Find an anchor in the stale `proj.txt`.
2. Binary-search the (still valid by length) segment table for the corresponding XML offset.
3. The XML at that offset no longer contains what the pass thinks it does — it now sits inside an attribute (`w:ascii="Times New Roman"`).
4. `__xmlSet` replaces the wrong range with the new content, slicing through `Times` → `Time` and into the next paragraph, leaving stray `</w:r></w:p></w:tc>` tags.

The corruption is reproducible and consistent — both occurrences of the bad fragment in `v64` look identical, so the same buggy pass fires twice.

## Fix

Revert the lazy invalidation in `__xmlSet` so the visible-text projection and lowercase caches are always dropped whenever any pass mutates the XML. Correctness > the small CPU savings of cache reuse — and the prior CPU/memory work (single render pass, lazy `__getVisProj`, anchor-presence guards, dictionary scoping, stale/concurrent job guards) all stay in place and cover the original CPU/timeout problem.

Concretely, in `supabase/functions/generate-document/index.ts` (~lines 5193-5204):

```ts
const __xmlSet = (filename: string, xml: string): Uint8Array => {
  __xmlStrCache[filename] = xml;
  __xmlDirty.add(filename);
  // Always invalidate dependent caches on any mutation. Length-preserving
  // glyph/text swaps still change visible-text content at the same byte
  // offsets, which makes the cached projection's txt → xml map stale and
  // causes follow-up safety passes to overwrite the wrong byte range
  // (corrupted RE851D output: malformed <w:rFonts w:ascii="Time…</w:tc>).
  delete __visProjCache[filename];
  delete __xmlLowerCache[filename];
  return (__re851dPassCache && __re851dPassCache[filename]) || new Uint8Array(0);
};
```

Update the surrounding comment block (lines 5182-5192) to remove the "length-preserving glyph swaps reuse caches" claim and document the correctness reason instead.

No other files, no schema changes, no UI changes, no other RE851D logic touched.

## Verification

1. Deploy `generate-document`.
2. Generate RE851D for deal `db7517e9-f124-4031-98c8-3e0f33caf889` / template `43492f94-60ad-44c3-a8c2-24dabf36eac7`.
3. Wait for `generation_jobs.status = success`.
4. Download the new `.docx` and confirm:
   - `python3 -c "import xml.etree.ElementTree as ET; ET.parse('word/document.xml')"` parses cleanly (no "not well-formed" error).
   - `grep -c '<w:rFonts w:ascii="Time<' word/document.xml` returns `0`.
5. Open the file in Google Docs / Word — it loads instead of showing "File could not open."
6. Spot-check that previously-fixed RE851D content is still correct: encumbrance grid, Owner Occupied YES/NO, multi-property checkboxes, addendum YES/NO.

## Out of scope

- Any further CPU/memory tuning. If timeouts return, that will be a follow-up; for now the priority is producing a non-corrupt file.
- Any change to the deal/document UI, storage, or job tables.
