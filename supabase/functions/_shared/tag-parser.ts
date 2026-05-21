/**
 * Merge Tag Parsing Utilities
 * 
 * Handles detection and parsing of merge tags from DOCX XML content,
 * including Word merge fields, curly brace placeholders, and label-based patterns.
 */

import type { ParsedMergeTag, FieldValueData, LabelMapping } from "./types.ts";
import { applyTransform, formatByDataType, formatCheckbox } from "./formatting.ts";
import { resolveFieldKeyWithMap, getFieldData } from "./field-resolver.ts";

const DOC_GEN_DEBUG = Deno.env.get("DOC_GEN_DEBUG") === "true";
const debugLog = (...args: unknown[]) => {
  if (DOC_GEN_DEBUG) {
    console.log(...args);
  }
};

/**
 * Flatten Word MERGEFIELD structures into plain «fieldName» text runs.
 * 
 * Word templates using Mail Merge store fields as complex XML structures:
 *   Pattern A (complex fields): <w:fldChar begin/> + <w:instrText> + <w:fldChar separate/> + display run + <w:fldChar end/>
 *   Pattern B (simple fields): <w:fldSimple w:instr="MERGEFIELD ...">inner runs</w:fldSimple>
 * 
 * This function converts both patterns into a single <w:r> with «fieldName» text,
 * preserving the display run's formatting (<w:rPr>).
 */
function flattenMergeFieldStructures(xml: string): string {
  // Process paragraph-by-paragraph to avoid catastrophic regex backtracking
  // on large documents (628KB+). MERGEFIELD structures are always within a single <w:p>.
  let totalComplexCount = 0;
  let totalSimpleCount = 0;
  let totalNoSeparateCount = 0;
  let totalInstrFallbackCount = 0;
  let totalOrphanedFldCharCount = 0;

  const result = processParaByPara(xml, (para) => {
    // Quick skip: only process paragraphs that contain fldChar or fldSimple
    if (!para.includes('w:fldChar') && !para.includes('w:fldSimple') && !para.includes('w:instrText')) {
      return para;
    }

    let p = para;

    // Pattern A: Complex MERGEFIELD structures spanning multiple <w:r> elements.
    const complexFieldPattern = /<w:r\b[^>]*>\s*(?:<w:rPr>[\s\S]*?<\/w:rPr>\s*)?<w:fldChar\s+[^>]*?w:fldCharType="begin"[^>]*(?:\/>|><\/w:fldChar>)\s*<\/w:r>([\s\S]*?)<w:r\b[^>]*>\s*(?:<w:rPr>[\s\S]*?<\/w:rPr>\s*)?<w:fldChar\s+[^>]*?w:fldCharType="separate"[^>]*(?:\/>|><\/w:fldChar>)\s*<\/w:r>([\s\S]*?)<w:r\b[^>]*>\s*(?:<w:rPr>[\s\S]*?<\/w:rPr>\s*)?<w:fldChar\s+[^>]*?w:fldCharType="end"[^>]*(?:\/>|><\/w:fldChar>)\s*<\/w:r>/g;

    p = p.replace(complexFieldPattern, (fullMatch, instrSection, displaySection) => {
      const instrMatch = instrSection.match(/MERGEFIELD\s+"?([A-Za-z0-9_.]+)"?/i);
      let fieldName: string | null = null;
      let useCurlySyntax = false;

      if (instrMatch) {
        fieldName = instrMatch[1];
      } else {
        const instrText = instrSection.match(/<w:instrText[^>]*>([\s\S]*?)<\/w:instrText>/i);
        if (instrText) {
          const curlyMatch = instrText[1].match(/\{\{([A-Za-z0-9_.]+)\}\}/);
          if (curlyMatch) {
            fieldName = curlyMatch[1];
            useCurlySyntax = true;
          } else {
            const bareMatch = instrText[1].trim().match(/^([A-Za-z][A-Za-z0-9_.]+)$/);
            if (bareMatch) {
              fieldName = bareMatch[1];
            }
          }
        }
      }

      if (!fieldName) return fullMatch;

      const rPrMatch = displaySection.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
      const rPr = rPrMatch ? `<w:rPr>${rPrMatch[1]}</w:rPr>` : '';

      totalComplexCount++;
      const tagText = useCurlySyntax ? `{{${fieldName}}}` : `\u00AB${fieldName}\u00BB`;
      return `<w:r>${rPr}<w:t>${tagText}</w:t></w:r>`;
    });

    // Pattern C: Field codes WITHOUT a `separate` marker: begin → instrText → end.
    const noSeparatePattern = /<w:r\b[^>]*>\s*(?:<w:rPr>([\s\S]*?)<\/w:rPr>\s*)?<w:fldChar\s+[^>]*?w:fldCharType="begin"[^>]*(?:\/>|><\/w:fldChar>)\s*<\/w:r>([\s\S]*?)<w:r\b[^>]*>\s*(?:<w:rPr>[\s\S]*?<\/w:rPr>\s*)?<w:fldChar\s+[^>]*?w:fldCharType="end"[^>]*(?:\/>|><\/w:fldChar>)\s*<\/w:r>/g;

    p = p.replace(noSeparatePattern, (fullMatch, beginRPr, middleSection) => {
      if (/w:fldCharType="separate"/.test(middleSection)) return fullMatch;

      const allInstrText = (middleSection.match(/<w:instrText[^>]*>([\s\S]*?)<\/w:instrText>/g) || [])
        .map((m: string) => m.replace(/<\/?w:instrText[^>]*>/g, ''))
        .join('');

      let fieldName: string | null = null;
      let useCurly = false;

      const mergeMatch = allInstrText.match(/MERGEFIELD\s+"?([A-Za-z0-9_.]+)"?/i);
      const curlyMatch = allInstrText.match(/\{\{([A-Za-z0-9_.]+)\}\}/);
      const bareMatch = allInstrText.trim().match(/^([A-Za-z][A-Za-z0-9_.]{2,})$/);

      if (curlyMatch) { fieldName = curlyMatch[1]; useCurly = true; }
      else if (mergeMatch) { fieldName = mergeMatch[1]; }
      else if (bareMatch) { fieldName = bareMatch[1]; }

      if (!fieldName) return fullMatch;

      totalNoSeparateCount++;
      const rPr = '';
      const tagText = useCurly ? `{{${fieldName}}}` : `{{${fieldName}}}`;
      return `<w:r>${rPr}<w:t>${tagText}</w:t></w:r>`;
    });

    // Pattern B: Simple field wrappers
    const simpleFieldPattern = /<w:fldSimple\s+[^>]*w:instr="[^"]*MERGEFIELD\s+"?([A-Za-z0-9_.]+)"?[^"]*"[^>]*>([\s\S]*?)<\/w:fldSimple>/g;

    p = p.replace(simpleFieldPattern, (fullMatch, fieldName, innerContent) => {
      const rPrMatch = innerContent.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
      const rPr = rPrMatch ? `<w:rPr>${rPrMatch[1]}</w:rPr>` : '';
      totalSimpleCount++;
      return `<w:r>${rPr}<w:t>\u00AB${fieldName}\u00BB</w:t></w:r>`;
    });

    // Fallback pass: convert remaining instrText containing merge tags
    const instrTextFallbackPattern = /<w:r\b[^>]*>\s*(?:<w:rPr>([\s\S]*?)<\/w:rPr>\s*)?<w:instrText[^>]*>([\s\S]*?)<\/w:instrText>\s*<\/w:r>/g;
    p = p.replace(instrTextFallbackPattern, (fullMatch, rPrContent, instrContent) => {
      const curlyMatch = instrContent.match(/\{\{([A-Za-z0-9_.]+)\}\}/);
      const mergeMatch = instrContent.match(/MERGEFIELD\s+"?([A-Za-z0-9_.]+)"?/i);
      const bareMatch = instrContent.trim().match(/^([A-Za-z][A-Za-z0-9_.]{2,})$/);

      let fieldName: string | null = null;
      let useCurly = false;
      if (curlyMatch) { fieldName = curlyMatch[1]; useCurly = true; }
      else if (mergeMatch) { fieldName = mergeMatch[1]; }
      else if (bareMatch) { fieldName = bareMatch[1]; }

      if (!fieldName) return fullMatch;

      totalInstrFallbackCount++;
      const rPr = rPrContent ? `<w:rPr>${rPrContent}</w:rPr>` : '';
      const tagText = useCurly ? `{{${fieldName}}}` : `\u00AB${fieldName}\u00BB`;
      return `<w:r>${rPr}<w:t>${tagText}</w:t></w:r>`;
    });

    // Orphaned fldChar cleanup
    const orphanedFldCharPattern = /<w:r\b[^>]*>\s*(?:<w:rPr>[\s\S]*?<\/w:rPr>\s*)?<w:fldChar\s+[^>]*?w:fldCharType="begin"[^>]*(?:\/>|><\/w:fldChar>)\s*<\/w:r>(\s*(?:<w:r\b[^>]*>\s*(?:<w:rPr>[\s\S]*?<\/w:rPr>\s*)?<w:t[^>]*>[^<]*<\/w:t>\s*<\/w:r>\s*)*)<w:r\b[^>]*>\s*(?:<w:rPr>[\s\S]*?<\/w:rPr>\s*)?<w:fldChar\s+[^>]*?w:fldCharType="end"[^>]*(?:\/>|><\/w:fldChar>)\s*<\/w:r>/g;
    p = p.replace(orphanedFldCharPattern, (fullMatch, betweenContent) => {
      if (/<w:instrText/.test(betweenContent) || /w:fldCharType="separate"/.test(betweenContent)) {
        return fullMatch;
      }
      totalOrphanedFldCharCount++;
      return betweenContent.trim();
    });

    return p;
  });

  if (totalComplexCount > 0 || totalSimpleCount > 0) {
    debugLog(`[tag-parser] Flattened MERGEFIELD structures: ${totalComplexCount} complex, ${totalSimpleCount} simple`);
  }
  if (totalNoSeparateCount > 0) {
    debugLog(`[tag-parser] Pattern C flattened ${totalNoSeparateCount} field codes without separate marker`);
  }
  if (totalInstrFallbackCount > 0) {
    debugLog(`[tag-parser] instrText fallback converted ${totalInstrFallbackCount} hidden merge tags to visible text`);
  }
  if (totalOrphanedFldCharCount > 0) {
    debugLog(`[tag-parser] Removed ${totalOrphanedFldCharCount} orphaned fldChar begin/end pairs`);
  }

  return result;
}

/**
 * Efficiently iterate over <w:p>...</w:p> paragraphs using indexOf
 * instead of regex to avoid catastrophic backtracking on large documents (600KB+).
 */
function processParaByPara(xml: string, fn: (para: string) => string): string {
  const chunks: string[] = [];
  let pos = 0;

  while (pos < xml.length) {
    // Find next <w:p> or <w:p ...> (skip <w:pPr>, <w:proofErr>, etc.)
    let pStart = -1;
    let searchFrom = pos;
    while (searchFrom < xml.length) {
      const idx = xml.indexOf('<w:p', searchFrom);
      if (idx === -1) break;
      const next = xml[idx + 4];
      if (next === '>' || next === ' ' || next === '/' || next === undefined) {
        pStart = idx;
        break;
      }
      searchFrom = idx + 4;
    }

    if (pStart === -1) {
      chunks.push(xml.substring(pos));
      break;
    }

    if (pStart > pos) {
      chunks.push(xml.substring(pos, pStart));
    }

    const pEnd = xml.indexOf('</w:p>', pStart);
    if (pEnd === -1) {
      chunks.push(xml.substring(pStart));
      break;
    }

    const paraEnd = pEnd + 6; // '</w:p>'.length
    const para = xml.substring(pStart, paraEnd);
    chunks.push(fn(para));
    pos = paraEnd;
  }

  return chunks.join('');
}

function hasFragmentedMergeTagCandidates(xml: string): boolean {
  const hasXmlInsideDelimitedTag = (open: string, close: string, maxSpan: number): boolean => {
    let start = xml.indexOf(open);
    while (start !== -1) {
      const end = xml.indexOf(close, start + open.length);
      if (end === -1) return false;
      if (end - start <= maxSpan && xml.indexOf('<', start + open.length) !== -1 && xml.indexOf('<', start + open.length) < end) {
        return true;
      }
      start = xml.indexOf(open, end + close.length);
    }
    return false;
  };

  return hasXmlInsideDelimitedTag('{{', '}}', 800) ||
    hasXmlInsideDelimitedTag('\u00AB', '\u00BB', 500) ||
    // Detect truly split delimiters only when the gap contains markup/space
    // and no meaningful text. The prior loose delimiter-pair scan falsely
    // treated two normal complete tags near each other as fragmentation on
    // dense templates like RE885, forcing the 5s normalization path.
    /\{(?:\s|<[^>]+>)+\{/.test(xml) ||
    /\}(?:\s|<[^>]+>)+\}/.test(xml);
}

function consolidateFragmentedSimpleTagsFast(xml: string): string {
  const consolidateDelimited = (input: string, open: string, close: string, maxSpan: number): string => {
    let output = '';
    let pos = 0;

    while (pos < input.length) {
      const start = input.indexOf(open, pos);
      if (start === -1) {
        output += input.substring(pos);
        break;
      }

      const end = input.indexOf(close, start + open.length);
      if (end === -1 || end - start > maxSpan) {
        output += input.substring(pos, start + open.length);
        pos = start + open.length;
        continue;
      }

      const raw = input.substring(start, end + close.length);
      if (!raw.includes('<')) {
        output += input.substring(pos, end + close.length);
        pos = end + close.length;
        continue;
      }

      const inner = raw.substring(open.length, raw.length - close.length);
      const clean = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim();
      const isSimpleField = /^[A-Za-z0-9_.]+(?:\|[A-Za-z0-9_]+)?$/.test(clean);
      if (!isSimpleField) {
        output += input.substring(pos, end + close.length);
        pos = end + close.length;
        continue;
      }

      output += input.substring(pos, start) + open + clean + close;
      pos = end + close.length;
    }

    return output;
  };

  return processParaByPara(xml, (para) => {
    if (!para.includes('{{') && !para.includes('\u00AB')) return para;
    let p = consolidateDelimited(para, '{{', '}}', 800);
    p = consolidateDelimited(p, '\u00AB', '\u00BB', 500);
    return p;
  });
}

/**
 * Normalize Word XML by consolidating fragmented text runs.
 * Word often splits text across multiple <w:t> elements.
 */
export function normalizeWordXml(xmlContent: string, templateName = ""): string {
  const __nwxStart = Date.now();
  const __nwxLog = (label: string, t0: number) => {
    if (xmlContent.length > 200_000) {
      console.log(`[tag-parser] normalizeWordXml.${label}=${Date.now() - t0}ms (size=${xmlContent.length}B)`);
    }
  };

  const tCheck = Date.now();
  const hasFieldCodeStructures = xmlContent.includes('w:fldChar') || xmlContent.includes('w:fldSimple') || xmlContent.includes('w:instrText');
  const hasFragmentedCandidates = hasFragmentedMergeTagCandidates(xmlContent);
  __nwxLog('preCheck', tCheck);
  if (!hasFieldCodeStructures && !hasFragmentedCandidates) {
    if (xmlContent.length > 200_000) {
      console.log(`[tag-parser] normalizeWordXml fast-path: skipped fragmented-run normalization (${xmlContent.length}B)`);
    }
    return xmlContent;
  }

  // First: flatten Word MERGEFIELD structures into plain «fieldName» text runs
  const tFlatten = Date.now();
  let result = flattenMergeFieldStructures(xmlContent);
  __nwxLog('flattenMergeFieldStructures', tFlatten);

  // If the template only had field-code structures (or already-intact tags),
  // flattening is sufficient. Skip the expensive fragmented-run regex suite
  // unless real XML-split delimiters remain after flattening.
  if (!hasFragmentedCandidates && !hasFragmentedMergeTagCandidates(result)) {
    if (xmlContent.length > 200_000) {
      console.log(`[tag-parser] normalizeWordXml fast-path: flattened field codes only, skipped fragmented-run normalization (${xmlContent.length}B)`);
    }
    return result;
  }

  if (/885/i.test(templateName) && xmlContent.length > 200_000) {
    const tFastSimple = Date.now();
    result = consolidateFragmentedSimpleTagsFast(result);
    __nwxLog('fastSimpleFragmentedTags', tFastSimple);
    console.log(
      `[tag-parser] normalizeWordXml RE885 fast-path: skipped heavy fragmented suite (${xmlContent.length}B, total=${Date.now() - __nwxStart}ms)`
    );
    return result;
  }

  // CPU-budget guard for very large templates (e.g. RE885 HUD-1, ~635KB).
  // The downstream paragraph-scoped fragmented-run normalization suite is
  // gated per-paragraph by hasFragmentedMergeTagCandidates(), so when the
  // ONLY signal that fired at the document level was the loose split-brace
  // detector (`\{(?:\s|<[^>]+>)+\{` / `\}(?:\s|<[^>]+>)+\}`) — which can
  // match intact-but-adjacent tags in dense templates — we can verify
  // whether real per-paragraph fragmentation exists before paying the
  // full document-scoped cleanup cost. If no paragraph individually
  // qualifies, skip the heavy regex suite. Intact `{{tag}}` placeholders
  // continue to be replaced normally downstream.
  if (xmlContent.length > 200_000 && hasFragmentedCandidates && !hasFieldCodeStructures) {
    const tProbe = Date.now();
    let anyParaFragmented = false;
    const probeResult = result;
    let pos = 0;
    let probeCount = 0;
    while (pos < probeResult.length) {
      const pStart = probeResult.indexOf('<w:p', pos);
      if (pStart === -1) break;
      const pEnd = probeResult.indexOf('</w:p>', pStart);
      if (pEnd === -1) break;
      const para = probeResult.substring(pStart, pEnd + 6);
      pos = pEnd + 6;
      if (!para.includes('{') && !para.includes('\u00AB')) continue;
      probeCount++;
      if (para.includes('instrText') || hasFragmentedMergeTagCandidates(para)) {
        anyParaFragmented = true;
        break;
      }
    }
    __nwxLog(`paragraphProbe(scanned=${probeCount}, fragmented=${anyParaFragmented})`, tProbe);
    if (!anyParaFragmented) {
      console.log(
        `[tag-parser] normalizeWordXml fast-path: large template with no per-paragraph fragmentation — skipped heavy normalization (${xmlContent.length}B, total=${Date.now() - __nwxStart}ms)`
      );
      return result;
    }
  }
  
  // Strip proofErr, lastRenderedPageBreak, and bookmark elements ONLY inside
  // paragraphs that contain merge-tag delimiters. This preserves page layout,
  // bookmarks, and structural XML in all non-tag paragraphs.
  const tStrip = Date.now();
  result = processParaByPara(result, (para) => {
    // Only strip in paragraphs that contain merge tag delimiters
    if (!para.includes('{') && !para.includes('\u00AB') && !para.includes('\u00BB')) {
      return para;
    }
    let cleaned = para;
    cleaned = cleaned.replace(/<w:proofErr[^/]*\/>/g, '');
    cleaned = cleaned.replace(/<w:lastRenderedPageBreak\/>/g, '');
    cleaned = cleaned.replace(/<w:bookmarkStart[^/]*\/>/g, '');
    cleaned = cleaned.replace(/<w:bookmarkEnd[^/]*\/>/g, '');
    return cleaned;
  });
  __nwxLog('stripProofBookmarks', tStrip);
  
  // NOTE: We intentionally preserve <w:rPr> blocks (run properties) which contain
  // font names, sizes, bold, italic, colors, etc. Stripping them would collapse
  // formatted documents to default styling. The run-consolidation regex below
  // handles skipping over <w:rPr> blocks between adjacent runs.
  
  
  // Handle fragmented merge fields, braces, conditionals — all paragraph-scoped
  // to avoid catastrophic backtracking on large documents (628KB+).
  const tFragSuite = Date.now();
  result = processParaByPara(result, (para) => {
    // Quick skip: only process paragraphs with potential merge tag delimiters
    if (!para.includes('{') && !para.includes('\u00AB') && !para.includes('\u00BB') && !para.includes('instrText')) {
      return para;
    }
    // Large templates can contain hundreds of intact tags. They do not need
    // the expensive fragmented-run regex suite; only paragraphs with actual
    // XML-split delimiters or remaining instrText do.
    if (!para.includes('instrText') && !hasFragmentedMergeTagCandidates(para)) {
      return para;
    }

    let p = para;

    // Handle fragmented merge fields
    const fragmentedPattern = /«((?:<(?!\/w:p>|w:p[\s>\/])[^>]*>|\s)*?)([A-Za-z0-9_.]+)((?:<(?!\/w:p>|w:p[\s>\/])[^>]*>|\s)*?)»/g;
    p = p.replace(fragmentedPattern, (match, pre, fieldName, post) => {
      if (pre.includes("<") || post.includes("<")) {
        debugLog(`[tag-parser] Found fragmented merge field: ${fieldName}`);
      }
      return `«${fieldName}»`;
    });

    // Handle XML-fragmented chevron patterns
    const leftChevronFragmented = /«((?:\s*<\/w:t>\s*<\/w:r>\s*<w:r(?:[^>]*)>\s*<w:t(?:[^>]*)>)+)/g;
    p = p.replace(leftChevronFragmented, () => "«");

    const rightChevronFragmented = /((?:\s*<\/w:t>\s*<\/w:r>\s*<w:r(?:[^>]*)>\s*<w:t(?:[^>]*)>)+)»/g;
    p = p.replace(rightChevronFragmented, () => "»");

    // Handle split opening braces
    // Guard: reject if intermediate runs contain meaningful text (letters/digits),
    // which indicates two separate tags rather than a single fragmented brace pair.
    const splitOpenBraces = /\{((?:\s*<\/w:t>\s*<\/w:r>\s*<w:r[^>]*>(?:\s*<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<w:t[^>]*>)+)\{/g;
    p = p.replace(splitOpenBraces, (match, runBreak) => {
      if (/<\/w:p>/.test(runBreak) || /<w:p[\s>]/.test(runBreak)) {
        return match;
      }
      // Reject if any intermediate <w:t> contains actual text content (not just whitespace/braces)
      if (/<w:t[^>]*>[^<]*[A-Za-z0-9$#@!%^&*][^<]*<\/w:t>/.test(runBreak)) {
        return match;
      }
      return '{{';
    });

    // Handle split closing braces
    // Guard: reject if intermediate runs contain meaningful text content,
    // preventing cross-tag matching in paragraphs with multiple merge tags.
    const splitCloseBraces = /\}((?:\s*<\/w:t>\s*<\/w:r>\s*<w:r[^>]*>(?:\s*<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<w:t[^>]*>)+)\}/g;
    p = p.replace(splitCloseBraces, (match, runBreak) => {
      if (/<\/w:p>/.test(runBreak) || /<w:p[\s>]/.test(runBreak)) {
        return match;
      }
      // Reject if any intermediate <w:t> contains actual text content (not just whitespace/braces)
      if (/<w:t[^>]*>[^<]*[A-Za-z0-9$#@!%^&*][^<]*<\/w:t>/.test(runBreak)) {
        return match;
      }
      return '}}';
    });

    // Consolidate adjacent <w:instrText> elements
    const instrTextConsolidate = /(<w:instrText[^>]*>)([\s\S]*?)(<\/w:instrText>)\s*<\/w:r>\s*<w:r[^>]*>\s*(?:<w:rPr>[\s\S]*?<\/w:rPr>\s*)?<w:instrText[^>]*>([\s\S]*?)(<\/w:instrText>)/g;
    let prevInstr = p;
    do {
      prevInstr = p;
      p = p.replace(instrTextConsolidate, '$1$2$4$3');
    } while (p !== prevInstr);

    // Handle fragmented curly brace patterns {{...}}
    const curlyFragmentedPattern = /\{\{((?:[A-Za-z0-9_.| ]|<(?!\/w:p>|w:p[\s>\/])[^>]*>|\s)*?)\}\}/g;
    p = p.replace(curlyFragmentedPattern, (match, innerContent) => {
      const cleanText = innerContent.replace(/<[^>]*>/g, '').replace(/\s+/g, '').trim();
      if (!cleanText) return match;
      if (/^[#/]/.test(cleanText) || cleanText === 'else') return match;

      const pipeIdx = cleanText.indexOf('|');
      if (pipeIdx > 0) {
        const fieldName = cleanText.substring(0, pipeIdx);
        const transform = cleanText.substring(pipeIdx + 1);
        if (/^[A-Za-z0-9_.]+$/.test(fieldName) && /^[A-Za-z0-9_]+$/.test(transform)) {
          if (innerContent.includes('<')) {
            debugLog(`[tag-parser] Found fragmented curly tag with transform, consolidating: {{${fieldName}|${transform}}}`);
          }
          return `{{${fieldName}|${transform}}}`;
        }
      }

      if (/^[A-Za-z0-9_.]+$/.test(cleanText)) {
        if (innerContent.includes('<')) {
          debugLog(`[tag-parser] Found fragmented curly tag, consolidating: {{${cleanText}}}`);
        }
        return `{{${cleanText}}}`;
      }

      return match;
    });

    // Pre-pass: consolidate fragmented inline checkbox conditionals of the form
    //   {{#if KEY}}☑{{else}}☐{{/if}}  (or any combination of ☑ / ☒ / ☐)
    // Word frequently splits the inline #if/else//if blocks across multiple
    // <w:r>/<w:t> runs in a single table cell (notably the RE851A YES/NO rows
    // such as Balloon Payment), which can prevent the downstream Mustache
    // evaluator from seeing a clean block. We rewrite the entire triplet into
    // a single clean expression. Scoped strictly to checkbox-glyph payloads so
    // it never touches unrelated conditionals.
    const CHECKBOX_GLYPHS = "\u2610\u2611\u2612"; // ☐ ☑ ☒
    const checkboxIfElsePattern = new RegExp(
      // {{ ... #if ... KEY ... }}
      "\\{\\{(?:<[^>]*>|\\s)*?#if(?:<[^>]*>|\\s)+([A-Za-z0-9_.]+)(?:<[^>]*>|\\s)*?\\}\\}" +
      // arbitrary XML runs, then a single checkbox glyph (possibly wrapped)
      "([\\s\\S]*?)([" + CHECKBOX_GLYPHS + "])([\\s\\S]*?)" +
      // {{ ... else ... }}
      "\\{\\{(?:<[^>]*>|\\s)*?else(?:<[^>]*>|\\s)*?\\}\\}" +
      // arbitrary XML runs, then second checkbox glyph
      "([\\s\\S]*?)([" + CHECKBOX_GLYPHS + "])([\\s\\S]*?)" +
      // {{ ... /if ... }}
      "\\{\\{(?:<[^>]*>|\\s)*?\\/(?:<[^>]*>|\\s)*?if(?:<[^>]*>|\\s)*?\\}\\}",
      "g"
    );
    p = p.replace(
      checkboxIfElsePattern,
      (match, fieldName, midA, glyphTrue, midB, midC, glyphFalse, midD) => {
        // Safety guards: never cross paragraph boundaries.
        if (/<\/w:p>|<w:p[\s>\/]/.test(match)) return match;
        // Validate per-branch: each of the 4 inter-marker segments
        // (midA: #if→glyphTrue, midB: glyphTrue→else, midC: else→glyphFalse,
        // midD: glyphFalse→/if) must contain NO Handlebars control tags
        // and NO additional checkbox glyphs. Plain value merge tags like
        // {{br_p_fullName}} appearing outside the branches are fine and a
        // sibling row's control tag captured by greedy regex no longer
        // forces a bail-out, so the RE851A B-line rewrite succeeds.
        const controlTagRe = /\{\{\s*(?:#if\b|#unless\b|#each\b|else\b|\/if\b|\/unless\b|\/each\b)/;
        const extraGlyphRe = new RegExp(`[${CHECKBOX_GLYPHS}]`);
        for (const seg of [midA, midB, midC, midD]) {
          const segNoXml = String(seg ?? "").replace(/<[^>]*>/g, "");
          if (controlTagRe.test(segNoXml)) return match;
          if (extraGlyphRe.test(segNoXml)) return match;
        }
        debugLog(
          `[tag-parser] Consolidated fragmented checkbox conditional for ${fieldName} (true=${glyphTrue}, false=${glyphFalse})`
        );
        return `{{#if ${fieldName}}}${glyphTrue}{{else}}${glyphFalse}{{/if}}`;
      }
    );

    // Defensive fallback: after the strict consolidator, if a paragraph still
    // contains a checkbox-glyph #if/else/#if triplet for the SAME field that
    // is interleaved with arbitrary inline XML (Word run wrappers), rewrite
    // it into the canonical clean form. Scoped to the exact shape:
    //   {{#if KEY}} ...xml... GLYPH ...xml... {{else}} ...xml... GLYPH ...xml... {{/if}}
    // where each branch contains exactly one checkbox glyph and no nested
    // control tags. This catches the RE851A B-line shape when the strict
    // pattern's per-branch greedy capture would otherwise leave the block
    // un-consolidated and the orphan-strip would drop the #if branch glyph.
    const checkboxFallbackPattern = new RegExp(
      "\\{\\{\\s*#if\\s+([A-Za-z0-9_.]+)\\s*\\}\\}" +
      "((?:(?!\\{\\{)[\\s\\S])*?)([" + CHECKBOX_GLYPHS + "])((?:(?!\\{\\{)[\\s\\S])*?)" +
      "\\{\\{\\s*else\\s*\\}\\}" +
      "((?:(?!\\{\\{)[\\s\\S])*?)([" + CHECKBOX_GLYPHS + "])((?:(?!\\{\\{)[\\s\\S])*?)" +
      "\\{\\{\\s*\\/if\\s*\\}\\}",
      "g"
    );
    p = p.replace(
      checkboxFallbackPattern,
      (match, fieldName, _a, glyphTrue, _b, _c, glyphFalse, _d) => {
        if (/<\/w:p>|<w:p[\s>\/]/.test(match)) return match;
        debugLog(
          `[tag-parser] Fallback-consolidated checkbox conditional for ${fieldName} (true=${glyphTrue}, false=${glyphFalse})`
        );
        return `{{#if ${fieldName}}}${glyphTrue}{{else}}${glyphFalse}{{/if}}`;
      }
    );

    // Handle fragmented conditional block tags
    // Also tolerate control tags that Word has split into separate <w:t> runs,
    // e.g. "{{#if" + " ln_p_balloonPayment" + "}}".
    const ifFragmented = /\{\{((?:<[^>]*>|\s)*?)#if\s*((?:<[^>]*>|\s)*?)([A-Za-z0-9_.]+)((?:<[^>]*>|\s)*?)\}\}/g;
    p = p.replace(ifFragmented, (_match, pre, mid, fieldName, post) => {
      if (pre.includes("<") || mid.includes("<") || post.includes("<")) {
        debugLog(`[tag-parser] Consolidated fragmented {{#if ${fieldName}}}`);
      }
      return `{{#if ${fieldName}}}`;
    });

    const ifOpenFragmented = /\{\{#if((?:<[^>]*>|\s)+)([A-Za-z0-9_.]+)((?:<[^>]*>|\s)*)\}\}/g;
    p = p.replace(ifOpenFragmented, (_match, mid, fieldName, post) => {
      if (mid.includes("<") || post.includes("<")) {
        debugLog(`[tag-parser] Consolidated split-open {{#if ${fieldName}}}`);
      }
      return `{{#if ${fieldName}}}`;
    });

    const unlessFragmented = /\{\{((?:<[^>]*>|\s)*?)#unless\s*((?:<[^>]*>|\s)*?)([A-Za-z0-9_.]+)((?:<[^>]*>|\s)*?)\}\}/g;
    p = p.replace(unlessFragmented, (_match, pre, mid, fieldName, post) => {
      if (pre.includes("<") || mid.includes("<") || post.includes("<")) {
        debugLog(`[tag-parser] Consolidated fragmented {{#unless ${fieldName}}}`);
      }
      return `{{#unless ${fieldName}}}`;
    });

    const unlessOpenFragmented = /\{\{#unless((?:<[^>]*>|\s)+)([A-Za-z0-9_.]+)((?:<[^>]*>|\s)*)\}\}/g;
    p = p.replace(unlessOpenFragmented, (_match, mid, fieldName, post) => {
      if (mid.includes("<") || post.includes("<")) {
        debugLog(`[tag-parser] Consolidated split-open {{#unless ${fieldName}}}`);
      }
      return `{{#unless ${fieldName}}}`;
    });

    const endIfFragmented = /\{\{((?:<[^>]*>|\s)*?)\/((?:<[^>]*>|\s)*?)if((?:<[^>]*>|\s)*?)\}\}/g;
    p = p.replace(endIfFragmented, (_match, pre, mid, post) => {
      if (pre.includes("<") || mid.includes("<") || post.includes("<")) {
        debugLog(`[tag-parser] Consolidated fragmented {{/if}}`);
      }
      return `{{/if}}`;
    });

    const endUnlessFragmented = /\{\{((?:<[^>]*>|\s)*?)\/((?:<[^>]*>|\s)*?)unless((?:<[^>]*>|\s)*?)\}\}/g;
    p = p.replace(endUnlessFragmented, (_match, pre, mid, post) => {
      if (pre.includes("<") || mid.includes("<") || post.includes("<")) {
        debugLog(`[tag-parser] Consolidated fragmented {{/unless}}`);
      }
      return `{{/unless}}`;
    });

    // Handle fragmented {{else}} tags
    const elseFragmented = /\{\{((?:<[^>]*>|\s)*?)else((?:<[^>]*>|\s)*?)\}\}/g;
    p = p.replace(elseFragmented, (_match, pre, post) => {
      if (pre.includes("<") || post.includes("<")) {
        debugLog(`[tag-parser] Consolidated fragmented {{else}}`);
      }
      return `{{else}}`;
    });

    const elseOpenFragmented = /\{\{((?:<[^>]*>|\s)+)else((?:<[^>]*>|\s)*)\}\}/g;
    p = p.replace(elseOpenFragmented, (_match, pre, post) => {
      if (pre.includes("<") || post.includes("<")) {
        debugLog(`[tag-parser] Consolidated split-open {{else}}`);
      }
      return `{{else}}`;
    });

    // Handle fragmented {{#each ...}} tags
    const eachFragmented = /\{\{((?:<[^>]*>|\s)*?)#each\s*((?:<[^>]*>|\s)*?)([A-Za-z0-9_.]+)((?:<[^>]*>|\s)*?)\}\}/g;
    p = p.replace(eachFragmented, (_match, pre, mid, collectionName, post) => {
      if (pre.includes("<") || mid.includes("<") || post.includes("<")) {
        debugLog(`[tag-parser] Consolidated fragmented {{#each ${collectionName}}}`);
      }
      return `{{#each ${collectionName}}}`;
    });

    // Handle fragmented {{/each}} tags
    const endEachFragmented = /\{\{((?:<[^>]*>|\s)*?)\/((?:<[^>]*>|\s)*?)each((?:<[^>]*>|\s)*?)\}\}/g;
    p = p.replace(endEachFragmented, (_match, pre, mid, post) => {
      if (pre.includes("<") || mid.includes("<") || post.includes("<")) {
        debugLog(`[tag-parser] Consolidated fragmented {{/each}}`);
      }
      return `{{/each}}`;
    });

    // Final pass: consolidate any remaining fragmented chevron tags
    const chevronFragmented = /«((?:[^»<]|<(?!\/w:p>|w:p[\s>\/])[^>]*>)*)»/g;
    p = p.replace(chevronFragmented, (match, inner) => {
      const cleanText = inner.replace(/<[^>]*>/g, '').replace(/\s+/g, '').trim();
      if (/^[A-Za-z0-9_.]+$/.test(cleanText)) {
        if (inner.includes('<')) {
          debugLog(`[tag-parser] Consolidated fragmented chevron tag: «${cleanText}»`);
        }
        return `«${cleanText}»`;
      }
      return match;
    });

    return p;
  });
  __nwxLog('fragmentedSuite', tFragSuite);

  // Diagnostic: count tags BEFORE paragraph-level consolidation
  const preConsolidationCurly = (result.match(/\{\{[A-Za-z0-9_.| ]+\}\}/g) || []).length;
  const preConsolidationChevron = (result.match(/\u00AB[A-Za-z0-9_.]+\u00BB/g) || []).length;
  debugLog(`[tag-parser] Before paragraph consolidation: ${preConsolidationCurly} curly tags, ${preConsolidationChevron} chevron tags`);

  // Safety-net: paragraph-level consolidation for tags that span multiple
  // <w:t> runs. Skip it when the earlier passes prove no fragmented
  // delimiters remain; intact tags already parse correctly.
  const tConsolidate = Date.now();
  if (hasFragmentedMergeTagCandidates(result)) {
    result = consolidateFragmentedTagsInParagraphs(result);
  }
  __nwxLog('paraConsolidation', tConsolidate);

  if (xmlContent.length > 200_000) {
    console.log(`[tag-parser] normalizeWordXml total=${Date.now() - __nwxStart}ms (size=${xmlContent.length}B)`);
  }
  return result;
}

/**
 * Paragraph-level safety net for fragmented merge tags.
 * 
 * For each <w:p> paragraph, extracts text from all <w:t> elements,
 * joins them, and checks if the joined text reveals complete merge tags
 * that don't exist in any single <w:t> element. If so, consolidates
 * all text into the first <w:t> element to make tags parseable.
 * 
 * This handles ANY fragmentation pattern that the regex-based
 * normalization above might miss (e.g., unusual whitespace, nested
 * formatting, or Word-specific XML structures).
 */
function consolidateFragmentedTagsInParagraphs(xml: string): string {
  let parasWithBraces = 0;
  let parasConsolidated = 0;
  let parasSkippedComplete = 0;
  let parasSkippedNoTags = 0;

  // Use indexOf-based paragraph scanning instead of regex /<w:p[\s>\/][\s\S]*?<\/w:p>/g
  // to avoid catastrophic backtracking on large documents (600KB+)
  const result = processParaByPara(xml, (para) => {
    // Quick check: skip paragraphs without potential merge tags
    if (!para.includes('{') && !para.includes('\u00AB')) return para;
    parasWithBraces++;

    // Extract text content from each <w:t> element
    const tTexts: string[] = [];
    para.replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g, (_, text) => {
      tTexts.push(text);
      return '';
    });

    if (tTexts.length < 2) return para; // Single or no text runs — no cross-run fragmentation

    const joined = tTexts.join('');

    // Find complete merge tags in the joined text
    const tagPattern = /\{\{[A-Za-z0-9_.#/| ]+\}\}|\u00AB[A-Za-z0-9_.]+\u00BB/g;
    const joinedTags = joined.match(tagPattern) || [];

    if (joinedTags.length === 0) { parasSkippedNoTags++; return para; }

    // Check if every found tag already exists completely within a single <w:t> element
    const allTagsComplete = joinedTags.every(tag =>
      tTexts.some(t => t.includes(tag))
    );

    if (allTagsComplete) { parasSkippedComplete++; return para; }

    // Tags are fragmented across runs — proceed to consolidation
    parasConsolidated++;
    debugLog(`[tag-parser] Paragraph-level consolidation: "${joined.substring(0, 120)}${joined.length > 120 ? '...' : ''}"`);

    let isFirst = true;
    return para.replace(/<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g, (match, attrs, _text) => {
      if (isFirst) {
        isFirst = false;
        return `<w:t xml:space="preserve">${joined}</w:t>`;
      }
      return `<w:t${attrs || ''}></w:t>`;
    });
  });

  debugLog(`[tag-parser] Paragraph consolidation stats: ${parasWithBraces} paragraphs with braces, ${parasConsolidated} consolidated, ${parasSkippedComplete} already complete, ${parasSkippedNoTags} no tags in joined text`);
  return result;
}

/**
 * Parse Word merge fields from XML content
 * Supports: «field_name», {{field_name}}, {{field_name|transform}}, MERGEFIELD instructions
 */
export function parseWordMergeFields(content: string): ParsedMergeTag[] {
  const tags: ParsedMergeTag[] = [];
  const seenTags = new Set<string>();
  let match;

  if (content.includes('«') && content.includes('»')) {
    const unicodePattern = /«([^»<]+)»/g;
    while ((match = unicodePattern.exec(content)) !== null) {
      const tagName = match[1].trim();
      if (!seenTags.has(match[0])) {
        seenTags.add(match[0]);
        tags.push({
          fullMatch: match[0],
          tagName,
          inlineTransform: null,
        });
      }
    }
  }

  if (content.includes('{{') && content.includes('}}')) {
    const curlyPattern = /\{\{([^{}<|]+)(?:\s*\|\s*([^{}<]+))?\}\}/g;
    while ((match = curlyPattern.exec(content)) !== null) {
      const tagName = match[1].trim();
      // Skip conditional/control tags — these are handled by processConditionalBlocks
      if (/^#if\s|^#unless\s|^#each\s|^\/if$|^\/unless$|^\/each$|^else$/.test(tagName)) {
        continue;
      }
      if (!seenTags.has(match[0])) {
        seenTags.add(match[0]);
        tags.push({
          fullMatch: match[0],
          tagName,
          inlineTransform: match[2]?.trim() || null,
        });
      }
    }
  }

  if (content.includes('MERGEFIELD')) {
    const mergeFieldPattern = /MERGEFIELD\s+"?([A-Za-z0-9_.]+)"?/gi;
    while ((match = mergeFieldPattern.exec(content)) !== null) {
      const fieldName = match[1].trim();
      const syntheticTag = `«${fieldName}»`;
      if (!seenTags.has(syntheticTag)) {
        seenTags.add(syntheticTag);
        tags.push({
          fullMatch: syntheticTag,
          tagName: fieldName,
          inlineTransform: null,
        });
      }
    }
  }

  debugLog(`[tag-parser] Found ${tags.length} merge tags: ${tags.map(t => t.tagName).join(", ")}`);

  return tags;
}

function getLabelQuickNeedle(label: string, mapping: LabelMapping): string {
  if (mapping.replaceNext) return mapping.replaceNext.toLowerCase();
  if (label === "as of _") return "as of";
  if (label.endsWith(':')) return label.slice(0, -1).toLowerCase();
  return label.toLowerCase();
}

/**
 * Build a native Word SDT (Structured Document Tag) checkbox XML block.
 * This produces an interactive, clickable checkbox in Word — matching the
 * appearance and behaviour of existing SDT checkboxes in the template.
 *
 * @param isChecked  Whether the checkbox should be in the checked state
 * @param rPr        Optional run-property XML string to preserve font/size styling
 */
function buildSdtCheckboxXml(isChecked: boolean, rPr?: string): string {
  const checkedVal = isChecked ? '1' : '0';
  const displayChar = isChecked ? '\u2611' : '\u2610'; // ☑ or ☐

  // Normalize the run-property block so the rendered checkbox glyph in the
  // SDT's display run matches the template's expected size and font (MS
  // Gothic). Without this, glyphs constructed from static template ☐/☑
  // runs render visibly smaller than the template's native SDT checkboxes
  // because:
  //   - the body default font (Arial/Times) provides a thinner ☐/☑ glyph
  //   - no <w:sz> means the run inherits the body default size (often 9-10pt)
  //
  // Strategy:
  //   1. Start from the original rPr inner content (everything inside
  //      <w:rPr>...</w:rPr>) when provided, otherwise empty.
  //   2. Force <w:rFonts> to MS Gothic (overriding any proportional font).
  //   3. Inject <w:sz w:val="24"/> + <w:szCs w:val="24"/> ONLY if the
  //      preserved rPr does not already declare an explicit <w:sz>, so
  //      template-defined larger sizes are kept intact.
  let rPrInner = '';
  if (rPr) {
    const stripped = rPr.startsWith('<w:rPr>') && rPr.endsWith('</w:rPr>')
      ? rPr.slice('<w:rPr>'.length, rPr.length - '</w:rPr>'.length)
      : rPr;
    // Remove existing <w:rFonts .../> so we can replace with MS Gothic, and
    // strip any existing <w:sz>/<w:szCs> so undersized template runs (e.g.
    // inline {{#if}}☒{{else}}☐{{/if}} placeholders authored at 9-10pt in the
    // Insurance Disclosure "Coverage Requirements" section) don't produce
    // tiny, unreadable checkboxes after SDT conversion.
    rPrInner = stripped
      .replace(/<w:rFonts\b[^>]*\/>/g, '')
      .replace(/<w:sz\b[^>]*\/>/g, '')
      .replace(/<w:szCs\b[^>]*\/>/g, '');
  }

  const fontsTag = '<w:rFonts w:ascii="MS Gothic" w:hAnsi="MS Gothic" w:eastAsia="MS Gothic" w:cs="MS Gothic" w:hint="eastAsia"/>';
  // Always force a readable checkbox size (12pt = w:sz 24) so generated SDT
  // checkboxes match the template's native interactive checkboxes regardless
  // of the surrounding paragraph's font size.
  const sizeTags = '<w:sz w:val="24"/><w:szCs w:val="24"/>';

  const wrappedRPr = `<w:rPr>${fontsTag}${sizeTags}${rPrInner}</w:rPr>`;

  return `<w:sdt><w:sdtPr>${wrappedRPr}<w14:checkbox><w14:checked w14:val="${checkedVal}"/><w14:checkedState w14:val="2611" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r>${wrappedRPr}<w:t>${displayChar}</w:t></w:r></w:sdtContent></w:sdt>`;
}

/**
 * Post-processing pass: convert any <w:r> whose <w:t> contains ONLY a
 * checkbox glyph (☐, ☑, or ☒) into a native Word SDT checkbox.
 * This runs after all merge-tag and label-based replacements are complete,
 * so every checkbox glyph — regardless of origin — becomes interactive.
 */
function convertGlyphsToSdtCheckboxes(xml: string): string {
  if (xml.indexOf('☐') === -1 && xml.indexOf('☑') === -1 && xml.indexOf('☒') === -1) {
    return xml;
  }

  let count = 0;
  // Match ONLY a single run whose content is exactly: optional <w:rPr>, one
  // checkbox glyph text node, then closing </w:r>. The prior pattern could
  // overrun across many paragraphs until the first glyph in the document,
  // corrupting existing <w:sdt> blocks in RE851A.
  const runWithGlyphOnly = /<w:r\b[^>]*>\s*(?:<w:rPr>((?:(?!<\/w:rPr>|<w:r\b|<w:p\b|<w:tbl\b)[\s\S])*?)<\/w:rPr>)?\s*<w:t[^>]*>([☐☑☒])<\/w:t>\s*<\/w:r>/g;

  // To avoid nesting <w:sdt> inside existing <w:sdt> (which corrupts the document),
  // extract existing SDT blocks using depth-aware matching, process the remaining
  // content, then restore them. Uses a valid XML placeholder character (\uFFFD)
  // instead of \uFFFE (which is illegal in XML 1.0 and causes document corruption).
  const sdtPlaceholders: string[] = [];
  const sdtMarkerPrefix = '\uFFFD_SDT_PLACEHOLDER_';
  const sdtMarkerSuffix = '_END';

  // Depth-aware SDT extraction: handle nested <w:sdt> blocks correctly
  // by finding matching open/close pairs from innermost outward.
  let safeguardedXml = xml;
  let extractionPass = 0;
  const MAX_EXTRACTION_PASSES = 20;
  while (extractionPass < MAX_EXTRACTION_PASSES) {
    // Find SDT blocks that do NOT contain other <w:sdt> (i.e., innermost first)
    const innerSdtPattern = /<w:sdt\b[^>]*>(?:(?!<w:sdt\b)[\s\S])*?<\/w:sdt>/g;
    let foundAny = false;
    safeguardedXml = safeguardedXml.replace(innerSdtPattern, (sdtBlock) => {
      foundAny = true;
      const idx = sdtPlaceholders.length;
      sdtPlaceholders.push(sdtBlock);
      return `${sdtMarkerPrefix}${idx}${sdtMarkerSuffix}`;
    });
    if (!foundAny) break;
    extractionPass++;
  }

  safeguardedXml = safeguardedXml.replace(runWithGlyphOnly, (_match, innerRPr, glyph) => {
    const isChecked = glyph === '☑' || glyph === '☒';
    count++;
    return buildSdtCheckboxXml(isChecked, innerRPr || undefined);
  });

  // Restore SDT blocks (reverse order to handle nesting correctly — inner restored first)
  for (let pass = 0; pass < MAX_EXTRACTION_PASSES; pass++) {
    const markerPattern = new RegExp(
      escapeRegex(sdtMarkerPrefix) + '(\\d+)' + escapeRegex(sdtMarkerSuffix),
      'g'
    );
    if (!markerPattern.test(safeguardedXml)) break;
    safeguardedXml = safeguardedXml.replace(
      new RegExp(escapeRegex(sdtMarkerPrefix) + '(\\d+)' + escapeRegex(sdtMarkerSuffix), 'g'),
      (_m, idx) => sdtPlaceholders[parseInt(idx, 10)] || ''
    );
  }

  // DEFENSIVE FINAL SWEEP: under no circumstances may the placeholder marker
  // (which contains \uFFFD) reach the output XML. \uFFFD inside element /
  // attribute names is rejected by strict XML parsers (Google Docs) and
  // produces "File could not open" errors. If any survived (e.g. extraction
  // depth exceeded MAX_EXTRACTION_PASSES), restore from the stored block or
  // strip to empty as a last resort.
  if (safeguardedXml.includes(sdtMarkerPrefix)) {
    safeguardedXml = safeguardedXml.replace(
      new RegExp(escapeRegex(sdtMarkerPrefix) + '(\\d+)' + escapeRegex(sdtMarkerSuffix), 'g'),
      (_m, idx) => sdtPlaceholders[parseInt(idx, 10)] || ''
    );
  }
  // Belt-and-suspenders: nuke any stray \uFFFD that may have leaked in from
  // any other source. \uFFFD is the Unicode replacement char and is not
  // valid inside XML names.
  if (safeguardedXml.includes('\uFFFD')) {
    safeguardedXml = safeguardedXml.replace(/\uFFFD/g, '');
  }

  if (count > 0) {
    debugLog(`[tag-parser] Converted ${count} checkbox glyphs to SDT checkboxes`);
  }
  return safeguardedXml;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Escape characters that have special meaning in XML so resolved field
 * values cannot break the well-formedness of word/document.xml.
 *
 * NOTE: Newlines are intentionally NOT converted here. Emitting
 * `</w:t><w:br/><w:t xml:space="preserve">` is only valid when the value
 * is being injected inside an open <w:t> element. When the substitution
 * site is outside a text run (e.g. between runs, inside table-cell
 * markup, or inside an SDT wrapper), that fragment produces an orphan
 * </w:t> and an unclosed <w:t>, which Word rejects with
 * "File could not open. Try refreshing the page."
 *
 * Callers should use `formatValueForInsertion(value, surroundingXml, index)`
 * (below) so newline handling is decided based on the actual call site.
 */
export function escapeXmlValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Determine whether a position in the XML lies inside an open <w:t> element.
 * Returns true when the most recent <w:t ...> open tag before `index` has no
 * matching </w:t> close tag between it and `index`.
 */
export function isInsideTextRun(xml: string, index: number): boolean {
  const lastOpen = xml.lastIndexOf('<w:t', index);
  if (lastOpen === -1) return false;
  const tagEnd = xml.indexOf('>', lastOpen);
  if (tagEnd === -1 || tagEnd >= index) return false;
  const tagHead = xml.substring(lastOpen, tagEnd + 1);
  // Must be <w:t> or <w:t ...> — not <w:tbl>, <w:tr>, <w:tc>, <w:tab/>, etc.
  if (!/^<w:t(\s[^>]*)?>$/.test(tagHead)) return false;
  const lastClose = xml.lastIndexOf('</w:t>', index);
  return lastClose < lastOpen;
}

/**
 * Format a resolved field value for safe insertion into Word XML at the given
 * position. Escapes XML-special characters; converts newlines into a Word
 * in-run line break ONLY when the insertion point is inside an open <w:t>.
 * Otherwise newlines collapse to a single space so the package stays valid.
 */
export function formatValueForInsertion(
  value: string,
  surroundingXml: string,
  index: number,
): string {
  const escaped = escapeXmlValue(value);
  if (!escaped.includes('\n')) return escaped;
  if (isInsideTextRun(surroundingXml, index)) {
    return escaped.replace(/\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
  }
  return escaped.replace(/\n/g, ' ');
}

function buildXmlFlexibleLabelPattern(label: string): string {
  const parts = label.split(/\s+/).filter(Boolean).map(escapeRegex);
  if (parts.length === 0) return '';
  return parts.join('(?:\\s|<[^>]+>)*');
}

function replaceStaticCheckboxLabel(
  content: string,
  label: string,
  checkboxValue: string,
): { content: string; replaced: boolean } {
  const labelPattern = buildXmlFlexibleLabelPattern(label);
  if (!labelPattern) {
    return { content, replaced: false };
  }

  // Strategy: find a <w:t> containing a checkbox glyph that is followed
  // (possibly with intervening XML tags / whitespace) by the label text,
  // then ONLY replace the glyph character inside its <w:t> element.
  // This preserves font styling (<w:rPr>) and run boundaries.
  //
  // PERF NOTE: Previous implementation ran an additional O(N) glyph-dedup
  // regex over the entire content after EACH successful replacement here.
  // That dedup is already performed once at the document level inside
  // replaceMergeTags (see "// Dedup: after merge tag replacement..." block)
  // and again at the document level by the caller of this function. Doing
  // it again per-label inside this hot path was the dominant CPU cost on
  // large form templates (e.g. RE885 HUD-1) and led to "CPU Time exceeded"
  // failures. Removing the redundant pass changes no output bytes — the
  // global dedup still runs once and produces the identical result.
  const glyphInWtPattern = new RegExp(
    `(<w:t[^>]*>)([^<]*?)([☐☑☒])([^<]*?</w:t>)((?:\\s|<[^>]+>)*?${labelPattern})(?![A-Za-z])`,
    'gi'
  );

  if (glyphInWtPattern.test(content)) {
    glyphInWtPattern.lastIndex = 0;
    const result = content.replace(glyphInWtPattern, (_match, wtOpen, pre, _glyph, wtTail, labelPart) => {
      return `${wtOpen}${pre}${checkboxValue}${wtTail}${labelPart}`;
    });
    return { content: result, replaced: true };
  }

  // Support templates where the visible checkbox glyph appears after the label
  // (e.g. "Lender(s) as Additional Insured☑") rather than before it.
  const trailingGlyphPattern = new RegExp(
    `(${labelPattern})((?:\\s|<[^>]+>)*)([☐☑☒])`,
    'gi'
  );

  if (trailingGlyphPattern.test(content)) {
    trailingGlyphPattern.lastIndex = 0;
    const result = content.replace(trailingGlyphPattern, (_match, labelText, spacing) => {
      return `${labelText}${spacing}${checkboxValue}`;
    });
    return { content: result, replaced: true };
  }

  // Fallback: plain-text glyph adjacent to label (no <w:t> wrapper)
  const plainPattern = new RegExp(`([☐☑☒])((?:\\s|<[^>]+>)*)(${labelPattern})(?![A-Za-z])`, 'gi');
  if (!plainPattern.test(content)) {
    return { content, replaced: false };
  }
  plainPattern.lastIndex = 0;
  const result = content.replace(plainPattern, (_match, _glyph, spacing, labelText) => {
    return `${checkboxValue}${spacing}${labelText}`;
  });
  return { content: result, replaced: true };
}

// Run the paragraph-scoped, paragraph-/soft-break-respecting glyph dedup
// ONCE at the end of label-based replacement. This consolidates duplicate
// adjacent ☐/☑/☒ glyphs that arise when both a merge tag AND a static
// glyph land in the same logical line.
function dedupAdjacentCheckboxGlyphs(xml: string): string {
  return xml.replace(
    /([☐☑☒])((?:\s|<(?!\/w:p\b|w:p[\s>\/]|w:br[\s>\/])[^>]*>)*?)([☐☑☒])((?:\s|<(?!\/w:p\b|w:p[\s>\/]|w:br[\s>\/])[^>]*>)*?)/g,
    (_m, g1, mid, _g2, trail) => `${g1}${mid}${trail}`
  );
}


/**
 * Perform label-based replacement for templates without explicit merge tags.
 */
export function replaceLabelBasedFields(
  content: string,
  fieldValues: Map<string, FieldValueData>,
  fieldTransforms: Map<string, string>,
  labelMap: Record<string, LabelMapping>,
  replacedFieldKeys?: Set<string>,
  mergeTagMap?: Record<string, string>,
  validFieldKeys?: Set<string>
): { content: string; replacementCount: number } {
  let replacementCount = 0;
  const labelEntries = Object.entries(labelMap);

  if (labelEntries.length === 0) {
    return { content, replacementCount };
  }

  const replacedFieldKeyLowers = replacedFieldKeys
    ? new Set([...replacedFieldKeys].map((key) => key.toLowerCase()))
    : null;
  const contentLower = content.toLowerCase();
  const candidateLabels = labelEntries
    .map(([label, mapping]) => ({
      label,
      mapping,
      quickNeedle: getLabelQuickNeedle(label, mapping),
    }))
    .filter(({ quickNeedle }) => !quickNeedle || contentLower.includes(quickNeedle))
    .sort((a, b) => b.label.length - a.label.length);

  if (candidateLabels.length === 0) {
    return { content, replacementCount };
  }

  // Track resolved keys that have already been replaced by labels in this pass
  const labelResolvedKeys = new Set<string>();

  // Pre-compute per-candidate metadata used inside the hot loop so we don't
  // recompute per-paragraph: lower-cased fieldKey for dedup, and a flag for
  // whether the field is boolean (drives the static-checkbox path).
  const enrichedCandidates = candidateLabels.map((c) => ({
    ...c,
    fieldKeyLower: c.mapping.fieldKey.toLowerCase(),
  }));

  // Build a single concatenated needle scan: a paragraph that contains NONE
  // of the candidate quickNeedles and has no checkbox glyph can skip the
  // entire candidate loop. Underscore filler alone is intentionally NOT a
  // reason to run every label candidate; HUD-1 / RE885 has many underscore
  // table cells, and treating each one as label work was the DOCX render
  // bottleneck. Labels that truly target underscores still have their own
  // quickNeedle (for example "as of" or replaceNext text), so output stays
  // unchanged while underscore-only rows are skipped.
  const allNeedles = enrichedCandidates
    .map((c) => c.quickNeedle)
    .filter((n): n is string => !!n && n.length > 0);
  const hasNeedlelessCandidate = enrichedCandidates.some((c) => !c.quickNeedle);

  const processedContent = processParaByPara(content, (segment) => {
    // Paragraph-level fast skip: if this paragraph has no checkbox glyphs and
    // none of the candidate label needles appear inside it, no candidate can
    // possibly match. This avoids the inner O(candidates) loop on the vast
    // majority of paragraphs, including underscore-heavy RE885 table rows.
    const hasCheckboxGlyph =
      segment.indexOf("☐") !== -1 || segment.indexOf("☑") !== -1 || segment.indexOf("☒") !== -1;
    let segmentLower: string | null = null;
    if (!hasCheckboxGlyph && !hasNeedlelessCandidate) {
      segmentLower = segment.toLowerCase();
      let anyNeedle = false;
      for (const n of allNeedles) {
        if (segmentLower.indexOf(n) !== -1) { anyNeedle = true; break; }
      }
      if (!anyNeedle) return segment;
    }

    let result = segment;
    let resultLower = segmentLower ?? result.toLowerCase();

    for (const { label, mapping, quickNeedle, fieldKeyLower } of enrichedCandidates) {
      if (replacedFieldKeyLowers?.has(fieldKeyLower)) {
        continue;
      }

      if (quickNeedle && resultLower.indexOf(quickNeedle) === -1) {
        continue;
      }

      const resolvedKey = mergeTagMap && validFieldKeys
        ? resolveFieldKeyWithMap(mapping.fieldKey, mergeTagMap, validFieldKeys)
        : mapping.fieldKey;
      const resolvedKeyLower = resolvedKey.toLowerCase();

      // Dedup: skip if the resolved canonical key was already replaced by a merge tag
      if (resolvedKey !== mapping.fieldKey && replacedFieldKeyLowers?.has(resolvedKeyLower)) {
        continue;
      }

      // Dedup: skip if another label already replaced this same resolved key in this pass
      if (labelResolvedKeys.has(resolvedKeyLower)) {
        continue;
      }

      const resolved = getFieldData(resolvedKey, fieldValues);
      const fieldData = resolved?.data || null;

      if (fieldData && fieldData.dataType === 'boolean') {
        const checkboxResult = replaceStaticCheckboxLabel(
          result,
          label,
          formatCheckbox(fieldData.rawValue),
        );

        if (checkboxResult.replaced) {
          result = checkboxResult.content;
          resultLower = result.toLowerCase();
          replacementCount++;
          labelResolvedKeys.add(resolvedKeyLower);
          debugLog(`[tag-parser] Checkbox label-replaced "${label}" -> "${formatCheckbox(fieldData.rawValue)}"`);
          continue;
        }
      }

      if (!fieldData || fieldData.rawValue === null) {
        if (mapping.replaceNext) {
          const textToReplace = mapping.replaceNext;
          const escapedText = textToReplace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          // Build the regex once and reuse for both .test and .replace.
          const replaceNextPattern = new RegExp(`\\b${escapedText}\\b`, "gi");
          if (replaceNextPattern.test(result)) {
            replaceNextPattern.lastIndex = 0;
            result = result.replace(replaceNextPattern, (match, offset) => {
              const after = result.substring(offset + match.length, offset + match.length + 200);
              if (/^\s*(?:<[^>]*>\s*)*\{\{/.test(after)) {
                return match;
              }
              const textAfter = after.replace(/<[^>]*>/g, '').trim();
              if (textAfter.length > 0) {
                return match;
              }
              return "";
            });
            resultLower = result.toLowerCase();
            replacementCount++;
            debugLog(`[tag-parser] Label "${label}" -> No data; blanked "${textToReplace}"`);
          }
        } else if (label === "as of _") {
          const asOfPattern = /as of\s*_+/gi;
          if (asOfPattern.test(result)) {
            result = result.replace(asOfPattern, "as of ");
            resultLower = result.toLowerCase();
            replacementCount++;
            debugLog(`[tag-parser] Label "${label}" -> No data; blanked "as of ___"`);
          }
        }
        continue;
      }

      const transform = fieldTransforms.get(mapping.fieldKey);
      let formattedValue: string;
      if (transform) {
        formattedValue = applyTransform(fieldData.rawValue, transform);
      } else {
        formattedValue = formatByDataType(fieldData.rawValue, fieldData.dataType);
      }
      // Strip leading "$" from currency values — the template already contains a literal "$" prefix
      if (fieldData.dataType === 'currency' && formattedValue.startsWith('$')) {
        formattedValue = formattedValue.substring(1);
      }

      // XML-escape resolved value for safe injection. Newlines are preserved
      // as literal "\n" here and converted to Word XML in-run breaks ONLY at
      // insertion sites that are inside an open <w:t> element (see
      // formatValueForInsertion). This prevents orphan </w:t> tags that
      // otherwise corrupt the generated .docx.
      formattedValue = escapeXmlValue(formattedValue);

      const insertAt = (src: string, offset: number) =>
        formatValueForInsertion(formattedValue, src, offset).replace(/\$/g, '$$$$');

      if (label === "as of _") {
        const asOfPattern = /as of\s*_+/gi;
        if (asOfPattern.test(result)) {
          result = result.replace(asOfPattern, (match, offset: number) =>
            `as of ${insertAt(result, offset + match.length)}`);
          resultLower = result.toLowerCase();
          replacementCount++;
          labelResolvedKeys.add(resolvedKeyLower);
          debugLog(`[tag-parser] Label-replaced "as of ___" -> "${formattedValue}"`);
        }
        continue;
      }

      if (mapping.replaceNext) {
        const textToReplace = mapping.replaceNext;
        const escapedText = textToReplace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Build once, reuse for both .test and .replace.
        const replaceNextPattern = new RegExp(`\\b${escapedText}\\b`, 'gi');

        if (replaceNextPattern.test(result)) {
          replaceNextPattern.lastIndex = 0;
          let colonDetected = false;

          result = result.replace(replaceNextPattern, (match, offset) => {
            const after = result.substring(offset + match.length, offset + match.length + 200);
            if (/^\s*(?:<[^>]*>\s*)*\{\{/.test(after)) {
              return match;
            }
            const immediateAfter = after.replace(/<[^>]*>/g, '').trimStart();
            if (immediateAfter.startsWith(':')) {
              colonDetected = true;
              return match;
            }
            return formatValueForInsertion(formattedValue, result, offset);
          });

          if (colonDetected) {
            const fullPattern = new RegExp(
              `(\\b${escapedText}\\b(?:\\s|<[^>]*>)*:\\s*)(_+|\\s*)`,
              'gi'
            );
            result = result.replace(fullPattern, (match, prefix: string, _filler: string, offset: number) =>
              `${prefix}${insertAt(result, offset + prefix.length)} `);
          }

          resultLower = result.toLowerCase();
          replacementCount++;
          labelResolvedKeys.add(resolvedKeyLower);
          debugLog(`[tag-parser] Label-replaced "${textToReplace}" -> "${formattedValue}"`);
        }
        continue;
      }

      const labelEscaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const labelPattern = new RegExp(`(${labelEscaped})(\\s*)`, 'gi');

      if (labelPattern.test(result)) {
        labelPattern.lastIndex = 0;
        result = result.replace(labelPattern, (match, g1: string, g2: string, offset: number) =>
          `${g1}${g2}${insertAt(result, offset + match.length)} `);
        resultLower = result.toLowerCase();
        replacementCount++;
        labelResolvedKeys.add(resolvedKeyLower);
        debugLog(`[tag-parser] Label-replaced "${label}" -> "${formattedValue}"`);
      } else if (label.endsWith(':')) {
        const labelNoColon = label.slice(0, -1);
        const labelNoColonEscaped = labelNoColon.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const colonTolerantPattern = new RegExp(`(${labelNoColonEscaped})(?:\\s|<[^>]+>)*:`, 'gi');

        if (colonTolerantPattern.test(result)) {
          colonTolerantPattern.lastIndex = 0;
          result = result.replace(colonTolerantPattern, (match, _g1: string, offset: number) =>
            `${match}${insertAt(result, offset + match.length)} `);
          resultLower = result.toLowerCase();
          replacementCount++;
          labelResolvedKeys.add(resolvedKeyLower);
          debugLog(`[tag-parser] Label-replaced (colon-tolerant) "${label}" -> "${formattedValue}"`);
        }
      }
    }

    return result;
  });

  // Single end-of-pass paragraph-/soft-break-scoped glyph dedup.
  // Replaces the redundant per-label dedup that used to run inside
  // replaceStaticCheckboxLabel (the hot path's CPU sink on RE885).
  const finalContent = replacementCount > 0
    ? dedupAdjacentCheckboxGlyphs(processedContent)
    : processedContent;

  return { content: finalContent, replacementCount };
}

/**
 * Evaluate whether a conditional field value is truthy.
 * Checks: non-null, non-empty string, boolean true, non-zero number.
 * Also supports checking if any field with a given prefix has data (entity existence).
 */
// Module-level cache for entity-existence prefix lookups
let _entityPrefixCache: Map<string, boolean> | null = null;
let _entityPrefixCacheSource: Map<string, FieldValueData> | null = null;

function buildEntityPrefixCache(fieldValues: Map<string, FieldValueData>): Map<string, boolean> {
  if (_entityPrefixCache && _entityPrefixCacheSource === fieldValues) {
    return _entityPrefixCache;
  }
  const prefixes = new Map<string, boolean>();
  for (const [k, v] of fieldValues.entries()) {
    if (v.rawValue === null || v.rawValue === "") continue;
    const kLower = k.toLowerCase();
    // Extract all possible prefixes: e.g. "co_borrower1.first_name" -> "co_borrower1"
    const dotIdx = kLower.indexOf(".");
    if (dotIdx > 0) {
      prefixes.set(kLower.substring(0, dotIdx), true);
    }
    const underIdx = kLower.indexOf("_");
    // For underscore prefixes, try first segment that contains digits
    const match = kLower.match(/^([a-z_]+\d+)/);
    if (match) {
      prefixes.set(match[1], true);
    }
  }
  _entityPrefixCache = prefixes;
  _entityPrefixCacheSource = fieldValues;
  return prefixes;
}

function getConditionalAliasCandidates(fieldKey: string): string[] {
  const normalized = fieldKey.trim();
  const lower = normalized.toLowerCase();

  if (lower === "ln_p_balloonpayment") {
    return [normalized, "ln_p_balloonPaymen", "loan_terms.balloon_payment"];
  }

  if (lower === "ln_p_balloonpaymen") {
    return [normalized, "ln_p_balloonPayment", "loan_terms.balloon_payment"];
  }

  if (lower === "loan_terms.balloon_payment") {
    return [normalized, "ln_p_balloonPaymen", "ln_p_balloonPayment"];
  }

  // Subordination Provision — RE851A Yes/No checkbox.
  // CSR persists this under `loan_terms.subordination_provision` while the
  // template references `ln_p_subordinationProvision`. Bridge both directions.
  if (lower === "ln_p_subordinationprovision") {
    return [normalized, "loan_terms.subordination_provision"];
  }
  if (lower === "loan_terms.subordination_provision") {
    return [normalized, "ln_p_subordinationProvision"];
  }

  // "Is Broker Also a Borrower?" — RE851A Part 2 A/B capacity checkboxes.
  // Prefer the actual CSR persistence key first so the conditional always sees
  // the user's selection, then fall back to engine-derived siblings and legacy
  // aliases. Order matters — the first key that has saved deal data wins.
  if (lower === "or_p_isbrkborrower") {
    return [
      "origination_app.doc.is_broker_also_borrower_yes",
      "or_p_isBrokerAlsoBorrower_yes",
      "or_p_brkCapacityPrincipal",
      normalized,
    ];
  }
  if (
    lower === "origination_app.doc.is_broker_also_borrower_yes" ||
    lower === "or_p_isbrokeralsoborrower_yes"
  ) {
    return [
      "origination_app.doc.is_broker_also_borrower_yes",
      "or_p_isBrokerAlsoBorrower_yes",
      "or_p_brkCapacityPrincipal",
      "or_p_isBrkBorrower",
      normalized,
    ];
  }

  return [normalized];
}

/**
 * Resolve the raw, normalized field value for use in `(eq ...)` comparisons.
 * Mirrors the alias-fallback logic of `isConditionTruthy` but returns the
 * raw stringified value (lower-cased, trimmed) instead of a boolean. Returns
 * an empty string when no data is present so equality against "" works.
 */
function resolveRawValueForEq(
  fieldKey: string,
  fieldValues: Map<string, FieldValueData>,
  mergeTagMap: Record<string, string>,
  validFieldKeys?: Set<string>,
): string {
  const aliasCandidates = getConditionalAliasCandidates(fieldKey);
  let canonicalKey = resolveFieldKeyWithMap(fieldKey, mergeTagMap, validFieldKeys);
  let resolved = getFieldData(canonicalKey, fieldValues);
  if (!resolved?.data || resolved.data.rawValue === null || resolved.data.rawValue === "") {
    for (const aliasKey of aliasCandidates) {
      const aliasCanonicalKey = resolveFieldKeyWithMap(aliasKey, mergeTagMap, validFieldKeys);
      const aliasResolved = getFieldData(aliasCanonicalKey, fieldValues);
      if (aliasResolved?.data && aliasResolved.data.rawValue !== null && aliasResolved.data.rawValue !== "") {
        canonicalKey = aliasCanonicalKey;
        resolved = aliasResolved;
        break;
      }
    }
  }
  if (!resolved?.data) return "";
  const raw = resolved.data.rawValue;
  if (raw === null) return "";
  if (typeof raw === "boolean") return raw ? "true" : "false";
  if (typeof raw === "number") return String(raw);
  return String(raw).trim();
}

/**
 * Evaluate Handlebars-style `(eq FIELD LITERAL)` sub-expressions.
 *
 * Accepts:
 *   (eq ln_p_subordinationProvision true)
 *   (eq ln_p_subordinationProvision "true")
 *   (eq loan_terms.subordination_provision 'false')
 *   (eq SOME_FIELD "Individual")
 *
 * Comparison rules (case-insensitive):
 *   - true / "true" / "yes" / "y" / "1" / "checked" / "on" all map to TRUE
 *   - false / "false" / "no" / "n" / "0" / "unchecked" / "off" map to FALSE
 *   - For mixed boolean ↔ string compares, both sides are normalized to the
 *     above truthy/falsy sets when possible.
 *   - Otherwise plain string equality (case-insensitive) is used.
 */
function evaluateEqExpression(
  expr: string,
  fieldValues: Map<string, FieldValueData>,
  mergeTagMap: Record<string, string>,
  validFieldKeys?: Set<string>,
): boolean | null {
  // (eq FIELD LITERAL) — LITERAL is bareword OR "..." OR '...'
  // Tolerate Word-autocorrected smart quotes around the literal.
  const normalizedExpr = expr
    .replace(/&quot;/g, '"')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
  const m = normalizedExpr.match(/^\s*eq\s+([A-Za-z0-9_.]+)\s+(?:"([^"]*)"|'([^']*)'|([A-Za-z0-9_.\-]+))\s*$/i);
  if (!m) return null;
  const fieldKey = m[1];
  const literal = (m[2] ?? m[3] ?? m[4] ?? "").trim();
  const literalLower = literal.toLowerCase();
  const fieldValueRaw = resolveRawValueForEq(fieldKey, fieldValues, mergeTagMap, validFieldKeys);
  const fieldValueLower = fieldValueRaw.toLowerCase();

  const TRUE_SET = new Set(["true", "yes", "y", "1", "checked", "on"]);
  const FALSE_SET = new Set(["false", "no", "n", "0", "unchecked", "off", ""]);

  const literalIsTrue = TRUE_SET.has(literalLower);
  const literalIsFalse = FALSE_SET.has(literalLower);
  const fieldIsTrue = TRUE_SET.has(fieldValueLower);
  const fieldIsFalse = FALSE_SET.has(fieldValueLower);

  if (literalIsTrue || literalIsFalse) {
    if (fieldIsTrue || fieldIsFalse) {
      return (literalIsTrue && fieldIsTrue) || (literalIsFalse && fieldIsFalse);
    }
  }
  return fieldValueLower === literalLower;
}

/**
 * Split the children of an (or …) / (and …) sexp into balanced sub-expressions.
 * Input is the inside of the wrapper, e.g. for `(or (eq A "x") (eq B "y"))`
 * we receive `(eq A "x") (eq B "y")` (after the leading `or`/`and` token is
 * already consumed by the caller). Returns an array of inner sexp strings
 * WITHOUT their outer parens — e.g. `["eq A \"x\"", "eq B \"y\""]`. Bare-word
 * children (no parens) are also supported. Quoted strings are honored so a
 * literal containing parens or whitespace doesn't confuse the splitter.
 */
function splitBalancedSexps(body: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = body.length;
  while (i < n) {
    while (i < n && /\s/.test(body[i])) i++;
    if (i >= n) break;
    if (body[i] === "(") {
      let depth = 0;
      const start = i;
      let inStr: string | null = null;
      while (i < n) {
        const ch = body[i];
        if (inStr) {
          if (ch === inStr) inStr = null;
        } else if (ch === '"' || ch === "'") {
          inStr = ch;
        } else if (ch === "(") {
          depth++;
        } else if (ch === ")") {
          depth--;
          if (depth === 0) { i++; break; }
        }
        i++;
      }
      // Strip outer parens
      out.push(body.substring(start + 1, i - 1).trim());
    } else {
      // Bare token (a field key referenced as a truthy check)
      const start = i;
      while (i < n && !/\s/.test(body[i])) i++;
      out.push(body.substring(start, i).trim());
    }
  }
  return out.filter(Boolean);
}

/**
 * Evaluate a Handlebars sub-expression body (the part inside the outermost
 * parens of `{{#if (...)}}`). Supports:
 *   - eq FIELD LITERAL                                  (delegates to evaluateEqExpression)
 *   - or  (sexp1) (sexp2) …                             (any true → true)
 *   - and (sexp1) (sexp2) …                             (all true → true)
 *   - not (sexp)                                        (logical negation)
 *   - bare FIELD                                        (truthy check)
 * Returns null when the expression cannot be parsed.
 */
function evaluateSubExpression(
  expr: string,
  fieldValues: Map<string, FieldValueData>,
  mergeTagMap: Record<string, string>,
  validFieldKeys?: Set<string>,
): boolean | null {
  const trimmed = expr.trim();
  // (or …) / (and …) / (not …)
  const headMatch = trimmed.match(/^(or|and|not)\b\s*([\s\S]*)$/i);
  if (headMatch) {
    const op = headMatch[1].toLowerCase();
    const children = splitBalancedSexps(headMatch[2]);
    if (children.length === 0) return null;
    const evaluated: boolean[] = [];
    for (const child of children) {
      // Bare-word child → truthy check on the field value
      let v: boolean | null;
      if (/^[A-Za-z0-9_.]+$/.test(child)) {
        v = isConditionTruthy(child, fieldValues, mergeTagMap, validFieldKeys);
      } else {
        v = evaluateSubExpression(child, fieldValues, mergeTagMap, validFieldKeys);
      }
      if (v === null) return null;
      evaluated.push(v);
    }
    if (op === "or") return evaluated.some(Boolean);
    if (op === "and") return evaluated.every(Boolean);
    if (op === "not") return !evaluated[0];
  }
  // (eq FIELD LITERAL)
  if (/^eq\s+/i.test(trimmed)) {
    return evaluateEqExpression(trimmed, fieldValues, mergeTagMap, validFieldKeys);
  }
  // Bare field key
  if (/^[A-Za-z0-9_.]+$/.test(trimmed)) {
    return isConditionTruthy(trimmed, fieldValues, mergeTagMap, validFieldKeys);
  }
  return null;
}

/**
 * Find the first `{{#if (…)}}` or `{{#unless (…)}}` opener whose parens are
 * balanced, then locate its matching `{{/if}}` / `{{/unless}}`. Returns the
 * full block details so the caller can rewrite it. Returns null if no such
 * block is found.
 */
function findBalancedSexpBlock(
  source: string,
): { start: number; end: number; tag: "if" | "unless"; expr: string; body: string } | null {
  const openerRe = /\{\{#(if|unless)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = openerRe.exec(source)) !== null) {
    const tag = m[1] as "if" | "unless";
    // Walk balanced parens starting at the '(' inside the tag
    let i = m.index + m[0].length - 1; // position of '('
    let depth = 0;
    let inStr: string | null = null;
    let exprStart = i + 1;
    let exprEnd = -1;
    while (i < source.length) {
      const ch = source[i];
      if (inStr) {
        if (ch === inStr) inStr = null;
      } else if (ch === '"' || ch === "'") {
        inStr = ch;
      } else if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
        if (depth === 0) { exprEnd = i; break; }
      }
      i++;
    }
    if (exprEnd === -1) continue;
    // Expect `}}` (with optional whitespace) right after the closing paren
    const afterParen = source.substring(exprEnd + 1);
    const closerOpen = afterParen.match(/^\s*\}\}/);
    if (!closerOpen) continue;
    const blockBodyStart = exprEnd + 1 + closerOpen[0].length;
    // Find matching {{/if}} or {{/unless}} (innermost — track nesting of same tag)
    const closeTag = `{{/${tag}}}`;
    const openTagRe = new RegExp(`\\{\\{#${tag}\\b`, "g");
    openTagRe.lastIndex = blockBodyStart;
    let scan = blockBodyStart;
    let nesting = 1;
    while (scan < source.length) {
      const closeIdx = source.indexOf(closeTag, scan);
      if (closeIdx === -1) break;
      openTagRe.lastIndex = scan;
      let nextOpen: RegExpExecArray | null = null;
      while ((nextOpen = openTagRe.exec(source)) !== null) {
        if (nextOpen.index >= closeIdx) { nextOpen = null; break; }
        nesting++;
        scan = nextOpen.index + nextOpen[0].length;
      }
      // Consume this close
      nesting--;
      if (nesting === 0) {
        return {
          start: m.index,
          end: closeIdx + closeTag.length,
          tag,
          expr: source.substring(exprStart, exprEnd).trim(),
          body: source.substring(blockBodyStart, closeIdx),
        };
      }
      scan = closeIdx + closeTag.length;
    }
  }
  return null;
}

function isConditionTruthy(
  fieldKey: string,
  fieldValues: Map<string, FieldValueData>,
  mergeTagMap: Record<string, string>,
  validFieldKeys?: Set<string>
): boolean {
  const aliasCandidates = getConditionalAliasCandidates(fieldKey);
  let canonicalKey = resolveFieldKeyWithMap(fieldKey, mergeTagMap, validFieldKeys);
  let resolved = getFieldData(canonicalKey, fieldValues);

  // Always probe aliases — if any alias key actually has saved deal data,
  // prefer it over a canonical key whose data slot is empty/missing.
  // This fixes RE851A "IS BROKER ALSO A BORROWER?" where the canonical
  // dictionary key exists but only the UI persistence key has the saved value.
  if (!resolved?.data || resolved.data.rawValue === null || resolved.data.rawValue === "") {
    for (const aliasKey of aliasCandidates) {
      const aliasCanonicalKey = resolveFieldKeyWithMap(aliasKey, mergeTagMap, validFieldKeys);
      const aliasResolved = getFieldData(aliasCanonicalKey, fieldValues);
      if (aliasResolved?.data && aliasResolved.data.rawValue !== null && aliasResolved.data.rawValue !== "") {
        canonicalKey = aliasCanonicalKey;
        resolved = aliasResolved;
        debugLog(`[tag-parser] Conditional alias fallback: ${fieldKey} -> ${aliasCanonicalKey}`);
        break;
      }
    }
  }

  if (resolved?.data) {
    const raw = resolved.data.rawValue;
    if (raw === null || raw === "") return false;
    if (typeof raw === "string") {
      const v = raw.trim().toLowerCase();
      if (["true", "yes", "y", "1", "checked", "on"].includes(v)) return true;
      if (["false", "no", "n", "0", "unchecked", "off", ""].includes(v)) return false;
      // Unknown non-empty string — treat as truthy (legacy behavior).
      return true;
    }
    if (typeof raw === "number") return raw !== 0;
    return Boolean(raw);
  }

  // Entity-existence check using pre-built prefix cache (O(1) lookup)
  const prefixCache = buildEntityPrefixCache(fieldValues);
  const lowerKey = canonicalKey.toLowerCase();
  if (prefixCache.has(lowerKey)) return true;

  return false;
}

/**
 * Clean up paragraphs that contain no visible text content after tag removal.
 * Targets paragraphs whose <w:t> elements are all empty or whitespace-only,
 * removing them to prevent blank gaps in the generated document.
 * Only cleans within a localized region around `centerIndex` to avoid
 * stripping intentional spacing paragraphs elsewhere.
 */
function cleanEmptyParagraphsNear(content: string, centerIndex: number, radius = 500): string {
  const cleanupStart = Math.max(0, centerIndex - radius);
  const cleanupEnd = Math.min(content.length, centerIndex + radius);
  const before = content.substring(0, cleanupStart);
  const region = content.substring(cleanupStart, cleanupEnd);
  const after = content.substring(cleanupEnd);

  // Match paragraphs that have NO text content (all <w:t> elements are empty/whitespace)
  const cleanedRegion = region.replace(
    /<w:p\b[^>]*>(?:\s*<w:pPr>[\s\S]*?<\/w:pPr>)?(?:\s*<w:r\b[^>]*>(?:\s*<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<w:t[^>]*>\s*<\/w:t>\s*<\/w:r>)*\s*<\/w:p>/g,
    (paraMatch) => {
      // Double-check: extract all text from <w:t> elements
      const textContent = paraMatch.replace(/<[^>]*>/g, '').trim();
      if (textContent === '') {
        debugLog(`[tag-parser] Removing empty paragraph after tag cleanup (${paraMatch.length} bytes)`);
        return '';
      }
      return paraMatch;
    }
  );

  return before + cleanedRegion + after;
}

/**
 * Process conditional blocks: {{#if field_key}}...{{/if}} and {{#unless field_key}}...{{/unless}}
 * 
 * Removes entire XML paragraphs (<w:p>...</w:p>) when conditions are false,
 * ensuring no blank gaps remain. Supports nesting via iterative innermost-first processing.
 */
export function processConditionalBlocks(
  content: string,
  fieldValues: Map<string, FieldValueData>,
  mergeTagMap: Record<string, string>,
  validFieldKeys?: Set<string>
): string {
  let result = content;
  let iterations = 0;
  const MAX_ITERATIONS = 100;

  while (iterations < MAX_ITERATIONS) {
    // Cheap pre-checks: skip the expensive regex/sexp scans entirely when the
    // remaining content has no opener at all. This dramatically speeds up large
    // templates (e.g. RE885) that contain hundreds of merge tags but only a
    // handful of conditionals — without this guard, each iteration still
    // scanned the full XML 5+ times even after all conditionals were resolved.
    const hasIfOpener = result.indexOf('{{#if') !== -1;
    const hasUnlessOpener = result.indexOf('{{#unless') !== -1;
    if (!hasIfOpener && !hasUnlessOpener) break;

    // Pre-pre-pass: resolve any {{#if (…)}} / {{#unless (…)}} whose head is
    // (or …), (and …), (not …), or a nested combination thereof. The simple
    // (eq …) pattern below cannot match these, and leaving them unresolved
    // would let the safety-net stripper drop the opener and leave residue.
    // Cheap pre-check: only walk the s-expression scanner when at least one
    // opener uses the `(` sub-expression form. This avoids the O(N) sexp
    // walker running every iteration on templates that have no sexpressions.
    const hasSexpOpener =
      (hasIfOpener && /\{\{#if\s*\(/.test(result)) ||
      (hasUnlessOpener && /\{\{#unless\s*\(/.test(result));
    const sexpBlock = hasSexpOpener ? findBalancedSexpBlock(result) : null;
    if (sexpBlock) {
      const evalResult = evaluateSubExpression(sexpBlock.expr, fieldValues, mergeTagMap, validFieldKeys);
      // Only rewrite when we successfully evaluated; otherwise let the (eq …)
      // pattern below take its normal path so behavior matches the prior
      // implementation for any expression types we don't yet support.
      const isOrAndNot = /^(or|and|not)\b/i.test(sexpBlock.expr.trim());
      if (evalResult !== null && isOrAndNot) {
        const truthyEval = evalResult;
        const truthy = sexpBlock.tag === "unless" ? !truthyEval : truthyEval;
        const elseIdx = sexpBlock.body.indexOf('{{else}}');
        let kept = "";
        if (truthy) {
          kept = elseIdx !== -1 ? sexpBlock.body.substring(0, elseIdx) : sexpBlock.body;
        } else if (elseIdx !== -1) {
          kept = sexpBlock.body.substring(elseIdx + '{{else}}'.length);
        }
        const insertionPoint = sexpBlock.start;
        result = result.substring(0, sexpBlock.start) + kept + result.substring(sexpBlock.end);
        result = cleanEmptyParagraphsNear(result, insertionPoint);
        debugLog(`[tag-parser] Conditional {{#${sexpBlock.tag} (${sexpBlock.expr})}} = ${truthy}`);
        iterations++;
        continue;
      }
    }

    // Pre-pass: handle `(eq FIELD LITERAL)` sub-expressions for the innermost
    // {{#if (eq ...)}}…{{/if}} block. We rewrite it to either the true or
    // else branch so the simple {{#if KEY}} matcher below sees clean content.
    // Same for {{#unless (eq ...)}}.
    // Cheap pre-check: only run the (eq …) regexes when an `(eq ` literal is
    // actually present. Avoids two full-string regex scans per iteration on
    // large templates that have no eq sub-expressions.
    const hasEqSexp = hasSexpOpener && (
      (result.indexOf('(eq') !== -1 && result.indexOf('(eq ') !== -1) ||
      (result.indexOf('(ne') !== -1 && result.indexOf('(ne ') !== -1)
    );
    // Match either `eq` or `ne` heads. `ne` is treated as the negation of `eq`.
    // Literal forms accepted: &quot;…&quot;, "…", '…', smart-quoted “…”/‘…’,
    // or a bareword. Word's autocorrect frequently converts straight quotes
    // around the LITERAL into curly quotes (U+201C/U+201D, U+2018/U+2019) —
    // without smart-quote support every conditional silently falls through.
    const eqIfPattern = /\{\{#if\s+\(\s*((eq|ne)\s+[A-Za-z0-9_.]+\s+(?:&quot;[^"<]*?&quot;|"[^"]*"|'[^']*'|[\u201C\u201D][^\u201C\u201D<]*?[\u201C\u201D]|[\u2018\u2019][^\u2018\u2019<]*?[\u2018\u2019]|[A-Za-z0-9_.\-]+))\s*\)\s*\}\}([\s\S]*?)\{\{\/if\}\}/;
    const eqUnlessPattern = /\{\{#unless\s+\(\s*((eq|ne)\s+[A-Za-z0-9_.]+\s+(?:&quot;[^"<]*?&quot;|"[^"]*"|'[^']*'|[\u201C\u201D][^\u201C\u201D<]*?[\u201C\u201D]|[\u2018\u2019][^\u2018\u2019<]*?[\u2018\u2019]|[A-Za-z0-9_.\-]+))\s*\)\s*\}\}([\s\S]*?)\{\{\/unless\}\}/;
    const eqIfMatch = hasEqSexp ? eqIfPattern.exec(result) : null;
    const eqUnlessMatch = hasEqSexp ? eqUnlessPattern.exec(result) : null;
    if (eqIfMatch || eqUnlessMatch) {
      const useUnless = !eqIfMatch || (eqUnlessMatch !== null && eqUnlessMatch.index < (eqIfMatch?.index ?? Infinity));
      const m = (useUnless ? eqUnlessMatch : eqIfMatch) as RegExpExecArray;
      // Convert (ne FIELD LIT) to (eq FIELD LIT) for evaluation, then negate.
      const head = m[2].toLowerCase();
      const eqExpr = (head === 'ne' ? m[1].replace(/^\s*ne\b/i, 'eq') : m[1])
        .replace(/&quot;/g, '"')
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2018\u2019]/g, "'");
      let truthyEval = evaluateEqExpression(eqExpr, fieldValues, mergeTagMap, validFieldKeys) ?? false;
      if (head === 'ne') truthyEval = !truthyEval;
      const truthy = useUnless ? !truthyEval : truthyEval;
      const blockContent = m[3];
      const elseIdx = blockContent.indexOf('{{else}}');
      let kept = "";
      if (truthy) {
        kept = elseIdx !== -1 ? blockContent.substring(0, elseIdx) : blockContent;
      } else if (elseIdx !== -1) {
        kept = blockContent.substring(elseIdx + '{{else}}'.length);
      }
      const insertionPoint = m.index;
      result = result.substring(0, m.index) + kept + result.substring(m.index + m[0].length);
      result = cleanEmptyParagraphsNear(result, insertionPoint);
      debugLog(`[tag-parser] Conditional {{#${useUnless ? "unless" : "if"} (${m[1]})}} = ${truthy}`);
      iterations++;
      continue;
    }

    const ifPattern = /\{\{#if\s+([A-Za-z0-9_.]+)\}\}([\s\S]*?)\{\{\/if\}\}/;
    const unlessPattern = /\{\{#unless\s+([A-Za-z0-9_.]+)\}\}([\s\S]*?)\{\{\/unless\}\}/;

    const ifMatch = hasIfOpener ? ifPattern.exec(result) : null;
    const unlessMatch = hasUnlessOpener ? unlessPattern.exec(result) : null;

    if (!ifMatch && !unlessMatch) break;

    if (ifMatch && (!unlessMatch || ifMatch.index < unlessMatch.index)) {
      const fieldKey = ifMatch[1];
      const blockContent = ifMatch[2];
      const truthy = isConditionTruthy(fieldKey, fieldValues, mergeTagMap, validFieldKeys);
      debugLog(`[tag-parser] Conditional {{#if ${fieldKey}}} = ${truthy}`);

      // Check for {{else}} within the block
      const elseIndex = blockContent.indexOf('{{else}}');

      if (truthy) {
        // Keep the true branch (content before {{else}}, or all if no else)
        const keepContent = elseIndex !== -1 ? blockContent.substring(0, elseIndex) : blockContent;
        const insertionPoint = ifMatch.index;
        result = result.substring(0, ifMatch.index) + keepContent + result.substring(ifMatch.index + ifMatch[0].length);
        // Clean up empty paragraphs left behind by the removed {{#if}} and {{/if}} tags
        result = cleanEmptyParagraphsNear(result, insertionPoint);
      } else {
        if (elseIndex !== -1) {
          // Keep the else branch (content after {{else}})
          const elseContent = blockContent.substring(elseIndex + '{{else}}'.length);
          const insertionPoint = ifMatch.index;
          result = result.substring(0, ifMatch.index) + elseContent + result.substring(ifMatch.index + ifMatch[0].length);
          // Clean up empty paragraphs left behind by removed {{else}} / {{/if}} tags
          result = cleanEmptyParagraphsNear(result, insertionPoint);
        } else {
          // No else branch — remove block and clean up surrounding empty paragraphs
          result = removeConditionalBlock(result, ifMatch.index, ifMatch[0].length);
        }
      }
    } else if (unlessMatch) {
      const fieldKey = unlessMatch[1];
      const blockContent = unlessMatch[2];
      const truthy = isConditionTruthy(fieldKey, fieldValues, mergeTagMap, validFieldKeys);
      debugLog(`[tag-parser] Conditional {{#unless ${fieldKey}}} = ${!truthy} (inverted)`);

      // Check for {{else}} within the block
      const elseIndex = blockContent.indexOf('{{else}}');

      if (!truthy) {
        const keepContent = elseIndex !== -1 ? blockContent.substring(0, elseIndex) : blockContent;
        const insertionPoint = unlessMatch.index;
        result = result.substring(0, unlessMatch.index) + keepContent + result.substring(unlessMatch.index + unlessMatch[0].length);
        result = cleanEmptyParagraphsNear(result, insertionPoint);
      } else {
        if (elseIndex !== -1) {
          const elseContent = blockContent.substring(elseIndex + '{{else}}'.length);
          const insertionPoint = unlessMatch.index;
          result = result.substring(0, unlessMatch.index) + elseContent + result.substring(unlessMatch.index + unlessMatch[0].length);
          result = cleanEmptyParagraphsNear(result, insertionPoint);
        } else {
          result = removeConditionalBlock(result, unlessMatch.index, unlessMatch[0].length);
        }
      }
    }

    iterations++;
  }

  if (iterations >= MAX_ITERATIONS) {
    console.warn("[tag-parser] Hit max iterations for conditional processing — possible malformed tags");
  }

  // Safety net: strip any unmatched conditional markers that survived
  // (e.g. an {{#if x}} with no {{/if}}). Leaving them in place would either
  // render as literal text or, worse, leave broken paragraph fragments that
  // can corrupt word/document.xml. We only remove the markers themselves
  // and keep the surrounding content unchanged.
  result = result.replace(/\{\{#if\s+[A-Za-z0-9_.]+\}\}/g, "");
  result = result.replace(/\{\{#unless\s+[A-Za-z0-9_.]+\}\}/g, "");
  result = result.replace(/\{\{\/if\}\}/g, "");
  result = result.replace(/\{\{\/unless\}\}/g, "");
  result = result.replace(/\{\{else\}\}/g, "");

  // Tolerate malformed openers missing whitespace after `#if` / `#unless`
  // (e.g. `{{#ifpr_li_ant_balloonYes_N_S}}`) — strip the opener so it does
  // not print verbatim. The paired `{{/if}}` is already removed above.
  result = result.replace(/\{\{#if[A-Za-z0-9_.]+\}\}/g, "");
  result = result.replace(/\{\{#unless[A-Za-z0-9_.]+\}\}/g, "");

  // Tolerate `{{/if}` / `{{/unless}` (single trailing brace) malformed close.
  result = result.replace(/\{\{\/if\}(?!\})/g, "");
  result = result.replace(/\{\{\/unless\}(?!\})/g, "");

  // Extended safety net: also strip Handlebars-style sub-expression openers
  // such as {{#if (eq ld_p_lenderType "Individual")}} or {{#unless (ne ...)}}.
  // The engine does not evaluate sub-expressions, so leaving these in would
  // print as literal text in the generated document.
  result = result.replace(/\{\{#if\s*\([^}]*?\)\s*\}\}/g, "");
  result = result.replace(/\{\{#unless\s*\([^}]*?\)\s*\}\}/g, "");
  result = result.replace(/\{\{#each\s*\([^}]*?\)\s*\}\}/g, "");

  // Extended safety net: strip BARE (unwrapped) conditional directives that
  // template authors sometimes leave inside DOCX paragraphs as plain text,
  // e.g. a paragraph whose run text is exactly:
  //   #if (eq ld_p_lenderType "Individual")
  // Without this, the literal control text appears in the generated document.
  // We only remove text inside <w:t>…</w:t> runs whose entire content matches
  // a conditional directive; surrounding prose is never touched.
  result = result.replace(
    /<w:t(\s[^>]*)?>\s*(?:#if|#unless|#each)\s*\([^<]*?\)\s*<\/w:t>/g,
    (m) => m.replace(/>\s*(?:#if|#unless|#each)\s*\([^<]*?\)\s*</, "><"),
  );
  result = result.replace(
    /<w:t(\s[^>]*)?>\s*(?:#if|#unless|#each)\s+[A-Za-z0-9_.]+\s*<\/w:t>/g,
    (m) => m.replace(/>\s*(?:#if|#unless|#each)\s+[A-Za-z0-9_.]+\s*</, "><"),
  );
  result = result.replace(
    /<w:t(\s[^>]*)?>\s*(?:\/if|\/unless|\/each|else)\s*<\/w:t>/g,
    (m) => m.replace(/>\s*(?:\/if|\/unless|\/each|else)\s*</, "><"),
  );

  return result;
}

/**
 * Remove a conditional block and clean up empty XML paragraphs.
 * 
 * When a block spans multiple paragraphs, removing its content may leave
 * empty <w:p> elements. This function removes those to prevent blank gaps.
 */
function removeConditionalBlock(content: string, startIndex: number, matchLength: number): string {
  // First, expand the removal range to include the containing paragraph(s)
  // if those paragraphs contain ONLY the conditional tag content
  
  let removeStart = startIndex;
  let removeEnd = startIndex + matchLength;

  // Check if the opening tag sits in a paragraph by itself
  // Look backwards for <w:p or <w:p ... to find paragraph start
  const beforeMatch = content.substring(Math.max(0, startIndex - 500), startIndex);
  const pOpenMatch = beforeMatch.match(/.*(<w:p\b[^>]*>(?:\s*<w:pPr>[\s\S]*?<\/w:pPr>)?(?:\s*<w:r\b[^>]*>(?:\s*<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<w:t[^>]*>)?\s*)$/);
  
  if (pOpenMatch) {
    // Check if the text before the tag in this paragraph is only XML structure (no actual text)
    const preamble = pOpenMatch[1];
    const textBefore = preamble.replace(/<[^>]*>/g, '').trim();
    if (textBefore === '') {
      removeStart = startIndex - pOpenMatch[1].length;
    }
  }

  // Check if closing tag ends at a paragraph boundary
  const afterMatch = content.substring(removeEnd, removeEnd + 500);
  const pCloseMatch = afterMatch.match(/^(\s*(?:<\/w:t>\s*<\/w:r>)?\s*<\/w:p>)/);
  if (pCloseMatch) {
    removeEnd = removeEnd + pCloseMatch[1].length;
  }

  let result = content.substring(0, removeStart) + content.substring(removeEnd);

  // Clean up empty paragraphs only near the removed block (within 500 chars)
  // to avoid stripping intentional spacing paragraphs elsewhere in the document
  const cleanupStart = Math.max(0, removeStart - 500);
  const cleanupEnd = Math.min(result.length, removeStart + 500);
  const before = result.substring(0, cleanupStart);
  const region = result.substring(cleanupStart, cleanupEnd);
  const after = result.substring(cleanupEnd);
  const cleanedRegion = region.replace(/<w:p\b[^>]*>(?:\s*<w:pPr>[\s\S]*?<\/w:pPr>)?\s*<\/w:p>/g, '');
  result = before + cleanedRegion + after;

  return result;
}

/**
 * Process native Word SDT (Structured Document Tag) checkboxes.
 * Finds <w:sdt> blocks containing <w14:checkbox>, reads the <w:tag> value,
 * resolves it to a field key, and toggles the checked state + display glyph.
 * For tagless SDT checkboxes, attempts to match nearby label text from labelMap.
 */
export function processSdtCheckboxes(
  content: string,
  fieldValues: Map<string, FieldValueData>,
  mergeTagMap: Record<string, string>,
  validFieldKeys?: Set<string>,
  labelMap?: Record<string, LabelMapping>
): string {
  // Match entire <w:sdt>…</w:sdt> blocks that contain a w14:checkbox element
  const sdtPattern = /<w:sdt\b[\s\S]*?<\/w:sdt>/g;

  return content.replace(sdtPattern, (sdtBlock, offset) => {
    // Only process SDTs that are checkboxes
    if (!/<w14:checkbox\b/.test(sdtBlock)) return sdtBlock;

    // Extract the tag value (the mapping key)
    const tagMatch = /<w:tag\s+w:val="([^"]+)"/i.exec(sdtBlock);

    let canonicalKey: string | null = null;

    if (tagMatch) {
      // Tagged SDT — resolve via tag name
      const tagName = tagMatch[1];
      canonicalKey = resolveFieldKeyWithMap(tagName, mergeTagMap, validFieldKeys);
    } else if (labelMap) {
      // Tagless SDT — look at surrounding text in the same table row or paragraph
      // to find a matching label from the labelMap
      const afterSdt = content.substring(offset + sdtBlock.length, offset + sdtBlock.length + 1000);
      // Extract plain text from the region after this SDT (same row / paragraph)
      const rowEnd = afterSdt.indexOf('</w:tr>');
      const paraEnd = afterSdt.indexOf('</w:p>');
      const searchEnd = Math.min(
        rowEnd >= 0 ? rowEnd : afterSdt.length,
        paraEnd >= 0 ? paraEnd : afterSdt.length,
        500
      );
      const searchRegion = afterSdt.substring(0, searchEnd);
      const textFragments = searchRegion.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) || [];
      const plainText = textFragments
        .map((t) => t.replace(/<[^>]+>/g, ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Try to find a matching label
      const normalizedPlainText = plainText.toLowerCase();
      const sortedLabelEntries = Object.entries(labelMap)
        .sort((a, b) => b[0].length - a[0].length);

      for (const [label, mapping] of sortedLabelEntries) {
        const normalizedLabel = label.toLowerCase().replace(/\s+/g, ' ').trim();
        if (normalizedPlainText.includes(normalizedLabel)) {
          canonicalKey = mapping.fieldKey;
          debugLog(`[tag-parser] Tagless SDT checkbox matched label "${label}" -> ${canonicalKey}`);
          break;
        }
      }

      if (!canonicalKey) {
        debugLog("[tag-parser] SDT checkbox found but no <w:tag> and no label match — skipping");
        return sdtBlock;
      }
    } else {
      debugLog("[tag-parser] SDT checkbox found but no <w:tag> — skipping");
      return sdtBlock;
    }

    const resolved = getFieldData(canonicalKey, fieldValues);

    // Determine boolean state — default to unchecked when no data exists
    let isChecked = false;
    if (resolved?.data) {
      const raw = resolved.data.rawValue;
      if (typeof raw === "string") {
        isChecked = ["true", "1", "yes", "y", "checked", "on"].includes(raw.toLowerCase().trim());
      } else if (typeof raw === "number") {
        isChecked = raw !== 0;
      } else {
        isChecked = Boolean(raw);
      }
    }

    const checkedVal = isChecked ? "1" : "0";
    const displayChar = isChecked ? "\u2611" : "\u2610"; // ☑ or ☐

    debugLog(`[tag-parser] SDT checkbox "${tagMatch?.[1] || '(tagless)'}" -> ${canonicalKey} = ${isChecked} (${displayChar})`);

    // 1. Toggle <w14:checked w14:val="..."/>
    let result = sdtBlock.replace(
      /(<w14:checked\s+w14:val=")([^"]*)("\s*\/>)/,
      `$1${checkedVal}$3`
    );

    result = result.replace(
      /(<w14:checkedState\s+w14:val=")([^"]*)("\s+w14:font="MS Gothic"\s*\/>)/,
      '$12611$3'
    );

    result = result.replace(
      /(<w14:uncheckedState\s+w14:val=")([^"]*)("\s+w14:font="MS Gothic"\s*\/>)/,
      '$12610$3'
    );

    // 2. Replace the display character inside <w:sdtContent>
    result = result.replace(
      /(<w:sdtContent\b[\s\S]*?<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/,
      `$1${displayChar}$3`
    );

    return result;
  });
}

/**
 * Process {{#each collection}}...{{/each}} iteration blocks.
 * 
 * Finds all entities matching the collection prefix (e.g., "property" matches
 * property1, property2, etc.) and repeats the block content for each entity,
 * resolving inner tags like {{address}} to propertyN.address.
 */
export function processEachBlocks(
  content: string,
  fieldValues: Map<string, FieldValueData>,
  mergeTagMap: Record<string, string>,
  validFieldKeys?: Set<string>
): string {
  let result = content;
  let iterations = 0;
  const MAX_ITERATIONS = 20;

  while (iterations < MAX_ITERATIONS) {
    const eachPattern = /\{\{#each\s+([A-Za-z0-9_.]+)\}\}([\s\S]*?)\{\{\/each\}\}/;
    const eachMatch = eachPattern.exec(result);

    if (!eachMatch) break;

    const collectionPrefix = eachMatch[1]; // e.g., "property"
    const blockTemplate = eachMatch[2]; // content between {{#each}} and {{/each}}

    debugLog(`[tag-parser] Processing {{#each ${collectionPrefix}}}`);

    // Find all indexed entities matching this prefix (e.g., property1, property2, ...)
    const entityIndices = new Set<number>();
    const prefixLower = collectionPrefix.toLowerCase();

    // Use simple string matching instead of RegExp construction per key
    for (const [key] of fieldValues.entries()) {
      const keyLower = key.toLowerCase();
      if (!keyLower.startsWith(prefixLower)) continue;
      // Extract digits immediately after the prefix, followed by "."
      const rest = keyLower.substring(prefixLower.length);
      const dotIdx = rest.indexOf(".");
      if (dotIdx <= 0) continue;
      const numPart = rest.substring(0, dotIdx);
      if (/^\d+$/.test(numPart)) {
        entityIndices.add(parseInt(numPart, 10));
      }
    }

    // Sort indices numerically
    const sortedIndices = [...entityIndices].sort((a, b) => a - b);
    debugLog(`[tag-parser] Found ${sortedIndices.length} entities for "${collectionPrefix}": [${sortedIndices.join(', ')}]`);

    if (sortedIndices.length === 0) {
      // No entities found — remove the entire block
      result = result.substring(0, eachMatch.index) + result.substring(eachMatch.index + eachMatch[0].length);
    } else {
      // For each entity, clone the block and replace inner field references
      const expandedBlocks: string[] = [];

      for (const idx of sortedIndices) {
        let blockContent = blockTemplate;
        const entityPrefix = `${collectionPrefix}${idx}`; // e.g., "property1"

        // Find all merge tags within the block: {{fieldName}}, {{fieldName|transform}}, «fieldName»
        const innerCurlyTags = [...blockContent.matchAll(/\{\{([^}#/|]+)(?:\|([^}]+))?\}\}/g)];
        const innerChevronTags = [...blockContent.matchAll(/«([^»]+)»/g)];

        for (const tag of innerCurlyTags) {
          const innerFieldName = tag[1].trim();
          // Skip control tags
          if (innerFieldName.startsWith('#') || innerFieldName.startsWith('/') || innerFieldName === 'else') continue;

          const qualifiedKey = `${entityPrefix}.${innerFieldName}`; // e.g., "property1.address"
          const transform = tag[2]?.trim() || null;

          // Resolve the qualified key
          const canonicalKey = resolveFieldKeyWithMap(qualifiedKey, mergeTagMap, validFieldKeys);
          const resolved = getFieldData(canonicalKey, fieldValues);

          let resolvedValue = "";
          if (resolved?.data) {
            if (transform) {
              resolvedValue = applyTransform(resolved.data.rawValue, transform);
            } else {
              resolvedValue = formatByDataType(resolved.data.rawValue, resolved.data.dataType);
            }
          }

          // XML-escape resolved value before injecting into document XML.
          // Without this, values containing &, <, > break word/document.xml.
          // Use context-aware newline handling so we never emit an orphan
          // </w:t> outside an open text run (Word rejects such files).
          {
            const tagText = tag[0];
            const parts = blockContent.split(tagText);
            if (parts.length > 1) {
              let rebuilt = parts[0];
              for (let pi = 1; pi < parts.length; pi++) {
                rebuilt += formatValueForInsertion(resolvedValue, rebuilt, rebuilt.length);
                rebuilt += parts[pi];
              }
              blockContent = rebuilt;
            }
          }
        }

        for (const tag of innerChevronTags) {
          const innerFieldName = tag[1].trim();
          const qualifiedKey = `${entityPrefix}.${innerFieldName}`;
          const canonicalKey = resolveFieldKeyWithMap(qualifiedKey, mergeTagMap, validFieldKeys);
          const resolved = getFieldData(canonicalKey, fieldValues);

          let resolvedValue = "";
          if (resolved?.data) {
            resolvedValue = formatByDataType(resolved.data.rawValue, resolved.data.dataType);
          }

          {
            const tagText = tag[0];
            const parts = blockContent.split(tagText);
            if (parts.length > 1) {
              let rebuilt = parts[0];
              for (let pi = 1; pi < parts.length; pi++) {
                rebuilt += formatValueForInsertion(resolvedValue, rebuilt, rebuilt.length);
                rebuilt += parts[pi];
              }
              blockContent = rebuilt;
            }
          }
        }

        expandedBlocks.push(blockContent);
      }

      // Separate each iteration safely for Word XML:
      // - Paragraph blocks already contain their own structure, so concatenate directly
      // - Inline blocks inside <w:t> need an in-run Word break (<w:br/>)
      // - Fallback to plain newline when not in a text-run context
      const hasParagraphs = expandedBlocks.some(b => b.includes('<w:p>') || b.includes('<w:p '));
      const insideTextRun = (() => {
        const beforeIndex = eachMatch.index;
        const lastOpenText = result.lastIndexOf('<w:t', beforeIndex);
        const lastCloseText = result.lastIndexOf('</w:t>', beforeIndex);
        return lastOpenText > lastCloseText;
      })();

      const separator = hasParagraphs
        ? ''
        : insideTextRun
          ? '</w:t><w:br/><w:t xml:space="preserve">'
          : '\n';

      const expandedContent = expandedBlocks.join(separator);
      result = result.substring(0, eachMatch.index) + expandedContent + result.substring(eachMatch.index + eachMatch[0].length);
    }

    iterations++;
  }

  if (iterations >= MAX_ITERATIONS) {
    console.warn("[tag-parser] Hit max iterations for {{#each}} processing — stripping any remaining unmatched block markers to keep XML valid");
  }

  // Safety net: if any unmatched {{#each ...}} / {{/each}} markers survived
  // (malformed template, MAX_ITERATIONS hit, etc.), strip the literal markers
  // so they cannot end up rendered as text or mistaken for XML by Word.
  // Removing only the markers (not the content between them) preserves layout.
  result = result.replace(/\{\{#each\s+[A-Za-z0-9_.]+\}\}/g, "");
  result = result.replace(/\{\{\/each\}\}/g, "");

  return result;
}

/**
 * Main function to replace all merge tags in content
 * @param validFieldKeys - Set of valid field keys from field_dictionary for direct matching
 */
export function replaceMergeTags(
  content: string,
  fieldValues: Map<string, FieldValueData>,
  fieldTransforms: Map<string, string>,
  mergeTagMap: Record<string, string>,
  labelMap: Record<string, LabelMapping>,
  validFieldKeys?: Set<string>,
  templateName?: string
): string {
  // Template-specific gating. The numerous RE851A safety passes below each
  // perform multiple full-document regex sweeps. On large unrelated templates
  // (e.g. RE885 HUD-1, ~628KB word/document.xml) that work added enough CPU
  // cost to push the Edge Function past its 2s isolate budget — surfacing as
  // "Generation timed out (CPU limit exceeded)". Gating each block by
  // template name removes the cost on non-matching templates while keeping
  // RE851A output bit-for-bit identical (every gated block was already
  // anchored to RE851A-only labels).
  const __tplName = templateName || "";
  const is851A = /851a/i.test(__tplName);
  // Phase timing: when DOC_PERF env flag set OR content > 200KB, emit per-phase
  // durations so we can pinpoint the exact bottleneck for large templates
  // (e.g. RE885 word/document.xml ~635KB). Cheap (Date.now) and bounded to one
  // log per call.
  const __perfEnabled =
    content.length > 200_000 ||
    (typeof Deno !== 'undefined' && Deno.env?.get?.('DOC_PERF') === '1');
  const __phases: Array<{ name: string; ms: number }> = [];
  let __tPhase = __perfEnabled ? Date.now() : 0;
  const __mark = (name: string) => {
    if (!__perfEnabled) return;
    const now = Date.now();
    __phases.push({ name, ms: now - __tPhase });
    __tPhase = now;
  };

  const contentLower = content.toLowerCase();
  const hasMergeMarkers = content.includes('{{') || content.includes('}}') || content.includes('«') || content.includes('»') || content.includes('MERGEFIELD') || content.includes('w:fldChar') || content.includes('w:fldSimple') || content.includes('w:instrText');
  const hasCheckboxes = content.includes('<w14:checkbox') && content.includes('<w:sdt');
  const hasRelevantLabel = Object.entries(labelMap).some(([label, mapping]) => {
    const quickNeedle = getLabelQuickNeedle(label, mapping);
    return quickNeedle ? contentLower.includes(quickNeedle) : false;
  });
  __mark('preCheck');

  if (!hasMergeMarkers && !hasCheckboxes && !hasRelevantLabel) {
    return content;
  }

  // First normalize the XML to handle fragmented merge fields
  let result = normalizeWordXml(content, templateName);
  __mark('normalizeWordXml');

  // Document-wide consolidation for control tags whose {{ ... }} brackets get
  // split by Word across multiple <w:r> or <w:p> boundaries. The paragraph-
  // scoped pass in normalizeWordXml() does not catch tags whose opening "{{"
  // and closing "}}" land in different paragraphs (common in table cells like
  // RE851A's Balloon Payment YES/NO checkboxes). We only collapse XML markup
  // between recognized control tokens — surrounding prose is never touched.
  //
  // Cheap pre-check: the regex below is `\{\{([\s\S]{0,400}?)\}\}` over the
  // whole document, which on large templates (RE885 ~635KB) iterates over
  // every {{...}} and runs a 400-char window scan. It only acts on
  // recognized control tokens (#if / #unless / else / /if / /unless), so
  // when none of those substrings exist anywhere in the document we can
  // skip the pass entirely. Intact `{{field}}` placeholders are unaffected.
  const __hasControlTokens =
    result.indexOf("#if") !== -1 ||
    result.indexOf("#unless") !== -1 ||
    result.indexOf("else") !== -1 ||
    result.indexOf("/if") !== -1 ||
    result.indexOf("/unless") !== -1;
  if (__hasControlTokens) {
    const stripXmlBetween = (raw: string): string =>
      raw.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

    result = result.replace(/\{\{([\s\S]{0,400}?)\}\}/g, (full, inner: string) => {
      // Only act if the inner span actually contains XML markup (i.e. fragmented).
      if (!inner.includes("<")) return full;
      const cleaned = stripXmlBetween(inner);
      if (/^#if\s+[A-Za-z0-9_.]+$/.test(cleaned)) {
        debugLog(`[tag-parser] Cross-run consolidated {{${cleaned}}}`);
        return `{{${cleaned}}}`;
      }
      if (/^#unless\s+[A-Za-z0-9_.]+$/.test(cleaned)) {
        debugLog(`[tag-parser] Cross-run consolidated {{${cleaned}}}`);
        return `{{${cleaned}}}`;
      }
      // Also consolidate `{{#if (eq FIELD "literal")}}` / `{{#unless (eq ...)}}`
      // helpers split across runs. Restrict the literal to safe characters so we
      // never accidentally swallow unrelated content.
      if (/^#if\s+\(\s*eq\s+[A-Za-z0-9_.]+\s+(?:"[^"]*"|'[^']*'|[A-Za-z0-9_.\-]+)\s*\)$/.test(cleaned)) {
        debugLog(`[tag-parser] Cross-run consolidated {{${cleaned}}}`);
        return `{{${cleaned}}}`;
      }
      if (/^#unless\s+\(\s*eq\s+[A-Za-z0-9_.]+\s+(?:"[^"]*"|'[^']*'|[A-Za-z0-9_.\-]+)\s*\)$/.test(cleaned)) {
        debugLog(`[tag-parser] Cross-run consolidated {{${cleaned}}}`);
        return `{{${cleaned}}}`;
      }

      if (cleaned === "else" || cleaned === "/if" || cleaned === "/unless") {
        debugLog(`[tag-parser] Cross-run consolidated {{${cleaned}}}`);
        return `{{${cleaned}}}`;
      }
      return full;
    });
  }

  // Unconditional safety net: strip BARE Handlebars-style control directives
  // that template authors sometimes leave in DOCX paragraphs as plain text
  // (i.e. NOT wrapped in {{ }}), e.g. a paragraph whose run text reads:
  //     #if (eq ld_p_lenderType "Individual")
  // The engine cannot evaluate such directives and they would otherwise print
  // verbatim. We only clear matching <w:t> run text; the surrounding run and
  // paragraph wrappers are kept so the template's layout/spacing is preserved.
  if (__hasControlTokens) {
    result = result.replace(
      /<w:t(\s[^>]*)?>\s*(?:#if|#unless|#each)\s*\([^<]*?\)\s*<\/w:t>/g,
      (m) => m.replace(/>\s*(?:#if|#unless|#each)\s*\([^<]*?\)\s*</, "><"),
    );
    result = result.replace(
      /<w:t(\s[^>]*)?>\s*(?:#if|#unless|#each)\s+[A-Za-z0-9_.]+\s*<\/w:t>/g,
      (m) => m.replace(/>\s*(?:#if|#unless|#each)\s+[A-Za-z0-9_.]+\s*</, "><"),
    );
    result = result.replace(
      /<w:t(\s[^>]*)?>\s*(?:\/if|\/unless|\/each|else)\s*<\/w:t>/g,
      (m) => m.replace(/>\s*(?:\/if|\/unless|\/each|else)\s*</, "><"),
    );
  }
  __mark('controlConsolidation');

  if (result.includes('{{#each')) {
    result = processEachBlocks(result, fieldValues, mergeTagMap, validFieldKeys);
  }
  __mark('eachBlocks');

  if (result.includes('{{#if') || result.includes('{{#unless')) {
    result = processConditionalBlocks(result, fieldValues, mergeTagMap, validFieldKeys);
  }
  __mark('conditionalBlocks');

  if (result.includes('<w14:checkbox') && result.includes('<w:sdt')) {
    result = processSdtCheckboxes(result, fieldValues, mergeTagMap, validFieldKeys, labelMap);
  }
  __mark('sdtCheckboxes');

  // RE851A Part 2 fallback: some authored templates use literal bracket
  // markers ("[ ]", "[x]", "[X]") instead of checkbox glyphs (☐/☑) next to
  // the A. / B. broker-capacity labels. The downstream label-based replacer
  // only knows how to swap glyph characters, so we normalize bracket markers
  // immediately preceding any boolean label in labelMap into the equivalent
  // glyph here. The replacement is strictly bounded to the marker region —
  // surrounding text, spacing, and XML structure are preserved unchanged.
  if (is851A && result.includes('[') && result.includes(']')) {
    const booleanLabels = Object.entries(labelMap)
      .filter(([, mapping]) => {
        const fd = fieldValues.get(mapping.fieldKey);
        return fd?.dataType === 'boolean';
      })
      .map(([label]) => label)
      .sort((a, b) => b.length - a.length);

    for (const label of booleanLabels) {
      const labelPattern = buildXmlFlexibleLabelPattern(label);
      if (!labelPattern) continue;
      // [ ] or [x]/[X] possibly wrapped in XML, then optional whitespace/XML,
      // then the label text. Only the bracket marker is rewritten.
      const bracketBeforeLabel = new RegExp(
        `(<w:t[^>]*>)([^<]*?)\\[\\s*([xX]?)\\s*\\]([^<]*?</w:t>)((?:\\s|<[^>]+>)*?${labelPattern})(?![A-Za-z])`,
        'g'
      );
      result = result.replace(
        bracketBeforeLabel,
        (_m, wtOpen, pre, mark, wtTail, labelPart) => {
          const glyph = mark ? '☑' : '☐';
          return `${wtOpen}${pre}${glyph}${wtTail}${labelPart}`;
        }
      );
      // Plain-text fallback (no <w:t> wrapper) — same scoping, marker only.
      const plainBracketBeforeLabel = new RegExp(
        `\\[\\s*([xX]?)\\s*\\]((?:\\s|<[^>]+>)*?)(${labelPattern})(?![A-Za-z])`,
        'g'
      );
      result = result.replace(
        plainBracketBeforeLabel,
        (_m, mark, spacing, labelText) => {
          const glyph = mark ? '☑' : '☐';
          return `${glyph}${spacing}${labelText}`;
        }
      );
    }
  }

  if (result.includes('{{') || result.includes('}}')) {
    const openBraceCount = (result.match(/\{\{/g) || []).length;
    const closeBraceCount = (result.match(/\}\}/g) || []).length;
    if (openBraceCount > 0 || closeBraceCount > 0) {
      debugLog(`[tag-parser] After normalization: ${openBraceCount} opening {{ and ${closeBraceCount} closing }} detected`);
    }
  }

  // Parse and replace merge tags
  const tags = parseWordMergeFields(result);
  __mark('parseMergeFields');

  // Track which field keys were successfully replaced by merge tags
  // so label-based replacement can skip them (prevents label aliases from
  // damaging static document titles like "Loan No", "Current Lender", etc.)
  const replacedFieldKeys = new Set<string>();
  
  // Pre-resolve all tags and build a replacement map for single-pass replacement
  const tagReplacementMap = new Map<string, string>();
  const resolvedDataKeys = new Set<string>();
  for (const tag of tags) {
    // Use validFieldKeys for direct field_key resolution
    const canonicalKey = resolveFieldKeyWithMap(tag.tagName, mergeTagMap, validFieldKeys);
    // Resolve further through migration to find the "ultimate" field key
    const ultimateKey = resolveFieldKeyWithMap(canonicalKey, mergeTagMap, validFieldKeys);
    const ultimateKeyLower = ultimateKey.toLowerCase();
    
    // Always track merge tag fields so labels don't overwrite static titles
    replacedFieldKeys.add(canonicalKey);
    replacedFieldKeys.add(ultimateKey);
    if (canonicalKey !== ultimateKey) {
      debugLog(`[tag-parser] Tag ${tag.tagName}: canonical=${canonicalKey}, ultimate=${ultimateKey}`);
    }

    // Dedup: if another merge tag already resolved to same ultimate key, blank this one.
    // Exception: RE851A repeats pr_li_sourceOfPayment in mixed field syntaxes; blanking
    // the later occurrence leaves the visible "If NO, source of funds..." line empty.
    const allowRepeatedTextTag = is851A && ultimateKeyLower === "pr_li_sourceofpayment";
    if (!allowRepeatedTextTag && resolvedDataKeys.has(ultimateKeyLower)) {
      debugLog(`[tag-parser] Dedup: skipping ${tag.tagName} (ultimate ${ultimateKey} already resolved)`);
      tagReplacementMap.set(tag.fullMatch, "");
      continue;
    }
    if (!allowRepeatedTextTag) {
      resolvedDataKeys.add(ultimateKeyLower);
    }

    // Use ultimateKey for data lookup (gets multi-property value when available)
    const resolved = getFieldData(ultimateKey, fieldValues) || getFieldData(canonicalKey, fieldValues);
    const fieldData = resolved?.data;
    let resolvedValue = "";
    
    if (resolved?.key && resolved.key !== canonicalKey) {
      replacedFieldKeys.add(resolved.key);
    }
    
    if (fieldData) {
      const transformKey = resolved?.key || canonicalKey;
      const transform = tag.inlineTransform || fieldTransforms.get(transformKey);
      
      if (transform) {
        resolvedValue = applyTransform(fieldData.rawValue, transform);
      } else {
        resolvedValue = formatByDataType(fieldData.rawValue, fieldData.dataType);
      }
      // Strip leading "$" from currency values — the template already contains a literal "$" prefix
      if (fieldData.dataType === 'currency' && resolvedValue.startsWith('$')) {
        resolvedValue = resolvedValue.substring(1);
      }
      debugLog(`[tag-parser] Replacing ${tag.tagName} -> ${transformKey} = "${resolvedValue.substring(0, 50)}"`);
    } else {
      debugLog(`[tag-parser] No data for ${tag.tagName} (canonical: ${canonicalKey}, ultimate: ${ultimateKey})`);
    }
    
    // XML-escape the value to prevent corruption from &, <, >, ", ' characters.
    // Newline handling is deferred until insertion (see combinedRegex below) so
    // we never emit </w:t><w:br/><w:t> outside an open text run, which would
    // produce orphan tags and cause Word to refuse to open the file.
    const xmlSafeValue = escapeXmlValue(resolvedValue);
    tagReplacementMap.set(tag.fullMatch, xmlSafeValue);
  }

  // Single-pass replacement using a generic delimiter scanner instead of an
  // alternation regex of every parsed tag literal. The previous approach built
  // `new RegExp(escapedPatterns.join('|'), 'g')` with hundreds of branches on
  // dense templates (RE885 ~250+ {{...}} placeholders) which forces the regex
  // engine to attempt each alternative at every position — a major CPU sink.
  // The replacement scanner walks the document ONCE and looks each match up in
  // the map (O(1)). Behavior is identical: unknown matches pass through.
  if (tagReplacementMap.size > 0) {
    const tagScanRe = /\{\{[^{}\n]{1,400}?\}\}|«[^«»\n]{1,400}?»/g;
    result = result.replace(tagScanRe, (match, offset: number) => {
      const replacement = tagReplacementMap.get(match);
      if (replacement === undefined) return match;
      if (!replacement.includes('\n')) return replacement;
      // Context-aware newline handling: only emit Word's in-run break form
      // when we're substituting inside an open <w:t> element. Otherwise the
      // </w:t><w:br/><w:t> fragment would create orphan tags and corrupt
      // the file.
      if (isInsideTextRun(result, offset)) {
        return replacement.replace(/\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
      }
      return replacement.replace(/\n/g, ' ');
    });

    // Dedup: after merge tag replacement, collapse adjacent duplicate checkbox
    // glyphs that arise when a merge tag resolves to ☑/☐ next to a static ☐
    // already present in the template. Skip entirely when no glyphs exist
    // anywhere in the document — the lazy regex scan is otherwise O(N) over
    // ~635KB on RE885 even though no merge tag in that template emits a glyph.
    if (
      result.indexOf('\u2610') !== -1 ||
      result.indexOf('\u2611') !== -1 ||
      result.indexOf('\u2612') !== -1
    ) {
      result = result.replace(
        /([☐☑☒])((?:\s|<(?!\/w:p\b|w:p[\s>\/]|w:br[\s>\/])[^>]*>)*?)([☐☑☒])/g,
        (_m, g1, mid, _g2) => `${g1}${mid}`
      );
    }
  }
  
  __mark('mergeTagReplace');

  // Always run label-based replacement after merge tag replacement
  debugLog(`[tag-parser] Running label-based replacement (${tags.length} merge tags were processed, ${replacedFieldKeys.size} fields already resolved)`);
  const labelResult = replaceLabelBasedFields(result, fieldValues, fieldTransforms, labelMap, replacedFieldKeys, mergeTagMap, validFieldKeys);
  result = labelResult.content;
  debugLog(`[tag-parser] Label-based replacement completed: ${labelResult.replacementCount} replacements`);
  __mark('labelReplace');

  // Final safety net: remove only merge tags that were explicitly parsed
  // and had no data. Do NOT globally remove all {{...}} patterns — that can
  // blank tags that normalization failed to consolidate but are still valid.
  // Skip the no-data cleanup pass entirely when no `{{` markers remain in the
  // result — the combined-regex pass above already replaced every parsed tag
  // (including no-data ones, which were mapped to ""). For large templates
  // (e.g. RE885) this avoids re-resolving 100+ field keys for nothing and
  // was a major contributor to CPU exhaustion.
  if (tags.length > 0 && result.indexOf('{{') !== -1) {
    // Reuse the replacement map built above instead of re-resolving every tag
    // (which was O(N) over every parsed merge tag and dominated CPU on large
    // templates such as RE885 with 300+ HUD-1 fee tags).
    const noDataPatterns: string[] = [];
    for (const [fullMatch, replacement] of tagReplacementMap.entries()) {
      if (replacement !== "") continue;
      // Only emit a pattern if the literal is actually still present in `result`
      // (the combined-regex pass above replaced it for almost every tag).
      if (result.indexOf(fullMatch) === -1) continue;
      noDataPatterns.push(fullMatch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }
    if (noDataPatterns.length > 0) {
      debugLog(`[tag-parser] Cleaning ${noDataPatterns.length} no-data tags`);
      const noDataRegex = new RegExp(noDataPatterns.join('|'), 'g');
      result = result.replace(noDataRegex, '');
    }
  }

  // Post-replacement cleanup: remove paragraphs that now contain only empty
  // text runs (their merge tags were replaced with "" by no-data cleanup).
  // Cheap precheck: paragraphs are only removed when they contain an empty
  // <w:t></w:t> run, so when the document has no such empty run we can skip
  // walking every paragraph entirely.
  if (/<w:t[^>]*>\s*<\/w:t>/.test(result)) {
    let emptyParaCount = 0;
    result = processParaByPara(result, (para) => {
      // Extract all text content from the paragraph
      const textContent = para.replace(/<[^>]*>/g, '').trim();
      if (textContent !== '') return para;

      // Paragraph has no visible text — but only remove it if it previously
      // contained a merge tag (i.e., has empty <w:t> elements that likely
      // held tags). Paragraphs that were always empty are intentional spacing.
      if (/<w:t[^>]*>\s*<\/w:t>/.test(para) && /<w:r\b/.test(para)) {
        emptyParaCount++;
        return '';
      }
      return para;
    });
    if (emptyParaCount > 0) {
      debugLog(`[tag-parser] Removed ${emptyParaCount} empty paragraphs after tag replacement`);
    }
  }

  // Recovery: every <w:tc> must contain at least one <w:p> (OOXML requirement).
  // The empty-paragraph cleanup above can strip the sole <w:p> from a cell whose
  // only content was a merge tag that resolved to "". Re-insert <w:p/> so Word
  // can open the document.
  {
    let cellsRepaired = 0;
    result = result.replace(/<w:tc(\s[^>]*)?>([\s\S]*?)<\/w:tc>/g, (full, _attrs, inner) => {
      if (/<w:p[\s>\/]/.test(inner)) return full;
      cellsRepaired++;
      return full.replace(/<\/w:tc>$/, '<w:p/></w:tc>');
    });
    if (cellsRepaired > 0) {
      debugLog(`[tag-parser] Repaired ${cellsRepaired} table cells missing required <w:p>`);
    }
  }

  // Clean up orphaned {{ that remain as literal text after tag replacement.
  // These are artifacts of Word XML fragmentation where {{ was in a separate run
  // from the field code structure. The tag was resolved but {{ survived as text.
  // Only remove {{ that are NOT followed by }} within the same <w:t> context
  // (i.e., they are genuinely orphaned, not part of a valid {{tag}}).
  // Cheap precheck: skip the full <w:t> sweep when no `{{` literal remains.
  if (result.indexOf('{{') !== -1) {
    let orphanCount = 0;
    result = result.replace(/<w:t([^>]*)>([^<]*)<\/w:t>/g, (fullMatch, attrs, textContent) => {
      // If text contains {{ but NOT a complete {{...}} tag, strip the orphaned {{
      if (textContent.includes('{{') && !/\{\{[A-Za-z0-9_.| ]+\}\}/.test(textContent)) {
        const cleaned = textContent.replace(/\{\{/g, '');
        if (cleaned !== textContent) {
          orphanCount++;
          if (!cleaned.trim()) {
            // If the text is now empty or whitespace-only, preserve space
            return `<w:t${attrs}>${cleaned}</w:t>`;
          }
          return `<w:t${attrs}>${cleaned}</w:t>`;
        }
      }
      return fullMatch;
    });
    if (orphanCount > 0) {
      debugLog(`[tag-parser] Cleaned ${orphanCount} orphaned {{ from text runs`);
    }
  }

  // Clean up orphaned }} that remain as literal text after tag replacement.
  // Mirror of the orphaned {{ cleanup above — handles cases where Word splits
  // }} into a separate run from the resolved tag content.
  if (result.indexOf('}}') !== -1) {
    let orphanCount = 0;
    result = result.replace(/<w:t([^>]*)>([^<]*)<\/w:t>/g, (fullMatch, attrs, textContent) => {
      if (textContent.includes('}}') && !/\{\{[A-Za-z0-9_.| ]+\}\}/.test(textContent)) {
        const cleaned = textContent.replace(/\}\}/g, '');
        if (cleaned !== textContent) {
          orphanCount++;
          return `<w:t${attrs}>${cleaned}</w:t>`;
        }
      }
      return fullMatch;
    });
    if (orphanCount > 0) {
      debugLog(`[tag-parser] Cleaned ${orphanCount} orphaned }} from text runs`);
    }
  }

  // RE851A — Subordination Provision Yes/No safety pass.
  // Strictly scoped to the literal row containing
  // "There are subordination provisions". Within that local XML window only,
  // force the Yes/No checkbox state to match the CSR value of
  // ln_p_subordinationProvision (CSR persists this under
  // loan_terms.subordination_provision; both keys are normalized upstream).
  // Supports both static glyphs (☐/☑/☒) and native Word SDT checkboxes
  // (<w:sdt>/<w14:checkbox>), with the checkbox appearing before OR after
  // the Yes/No label. No other Yes/No checkbox pairs in RE851A are touched.
  if (is851A) {
    const subData =
      getFieldData("ln_p_subordinationProvision", fieldValues)?.data
      || getFieldData("loan_terms.subordination_provision", fieldValues)?.data;
    let isSubordination: boolean | null = null;
    if (subData) {
      const raw = subData.rawValue;
      if (raw === null || raw === "") {
        isSubordination = null;
      } else if (typeof raw === "string") {
        const v = raw.trim().toLowerCase();
        if (["true", "yes", "y", "1", "checked", "on"].includes(v)) isSubordination = true;
        else if (["false", "no", "n", "0", "unchecked", "off"].includes(v)) isSubordination = false;
      } else if (typeof raw === "number") {
        isSubordination = raw !== 0;
      } else {
        isSubordination = Boolean(raw);
      }
    }

    if (isSubordination !== null) {
      const yesGlyph = isSubordination ? "☑" : "☐";
      const noGlyph = isSubordination ? "☐" : "☑";
      const yesChecked = isSubordination;
      const noChecked = !isSubordination;

      // Locate the anchor "There are subordination provisions", tolerant of
      // intervening XML/whitespace between the words.
      const anchorParts = ["There", "are", "subordination", "provisions"];
      const anchorPattern = anchorParts
        .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("(?:\\s|<[^>]+>)*");
      const anchorRe = new RegExp(anchorPattern, "gi");

      // Toggle a single <w:sdt>...</w:sdt> checkbox block to the desired state.
      // Updates BOTH the internal w14:checked value and the displayed glyph
      // inside <w:sdtContent>. If <w14:checked> is missing entirely (some
      // templates omit it for the unchecked default), inject it inside the
      // <w14:checkbox> element so Word reflects the new state.
      // Strip stray TEXT inside <w:rPr>...</w:rPr> while preserving any nested
      // tags (rFonts, color, sz, etc.). The RE851A v5+ template was authored
      // with a literal ☑ glyph typed inside <w:rPr> of <w:sdt>/<w:sdtContent>
      // run-property containers. That text content is structurally invalid
      // but Word renders it as visible characters next to the checkbox,
      // producing phantom "☑☑" prefixes that no toggle can affect because
      // they live OUTSIDE <w:t>. Removing only the bare text — never tags —
      // is XML-safe and leaves all formatting intact.
      const stripRPrText = (sdtBlock: string): string =>
        sdtBlock.replace(
          /(<w:rPr\b[^>]*>)([\s\S]*?)(<\/w:rPr>)/g,
          (_m, open, inner, close) => {
            // Remove text that is NOT inside a tag: split on tags, keep tags,
            // drop bare text fragments.
            const cleaned = inner.replace(/(<[^>]+>)|[^<]+/g, (seg: string) =>
              seg.startsWith("<") ? seg : "",
            );
            return `${open}${cleaned}${close}`;
          },
        );

      const toggleSdtBlock = (sdtBlock: string, isChecked: boolean): string => {
        if (!/<w14:checkbox\b/.test(sdtBlock)) return sdtBlock;
        const checkedVal = isChecked ? "1" : "0";
        const displayChar = isChecked ? "\u2611" : "\u2610";

        // First, sanitize stray glyph text leaked into <w:rPr> containers.
        let updated = stripRPrText(sdtBlock);

        // Self-closing form: <w14:checked w14:val="0"/>
        const selfClosing = /(<w14:checked\s+w14:val=")([^"]*)("\s*\/>)/;
        // Open/close form: <w14:checked w14:val="0"></w14:checked>
        const openClose = /(<w14:checked\s+w14:val=")([^"]*)(">\s*<\/w14:checked>)/;
        if (selfClosing.test(updated)) {
          updated = updated.replace(selfClosing, `$1${checkedVal}$3`);
        } else if (openClose.test(updated)) {
          updated = updated.replace(openClose, `$1${checkedVal}$3`);
        } else {
          // <w14:checked> missing — inject it as the first child of the
          // <w14:checkbox> element. Handles both <w14:checkbox> and
          // <w14:checkbox ...> opening forms.
          updated = updated.replace(
            /(<w14:checkbox\b[^>]*>)/,
            `$1<w14:checked w14:val="${checkedVal}"/>`,
          );
        }

        // Update the displayed glyph inside <w:sdtContent> (first <w:t>).
        updated = updated.replace(
          /(<w:sdtContent\b[\s\S]*?<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/,
          `$1${displayChar}$3`,
        );
        return updated;
      };

      // Single-SDT matcher: matches one <w:sdt>...</w:sdt> block WITHOUT
      // crossing into another <w:sdt> opener. The previous broad matcher
      // (`<w:sdt ...</w:sdt>`) was lazy but could still span across the
      // sibling Yes-checkbox SDT when locating the No label, causing both
      // checkboxes to be replaced by a single toggled block — leaving the
      // No checkbox stale. Negative lookahead `(?:(?!<w:sdt\b)[\s\S])*?`
      // guarantees the captured block is exactly one SDT.
      const SINGLE_SDT = `<w:sdt\\b(?:(?!<w:sdt\\b)[\\s\\S])*?<\\/w:sdt>`;

      // Force any <w:sdt> checkbox immediately preceding the literal word
      // (Yes/No) — across XML/whitespace only — to the desired state.
      const forceSdtBeforeWord = (
        windowXml: string,
        word: "Yes" | "No",
        isChecked: boolean,
      ): string => {
        const wordRe = `\\b${word}\\b`;
        const sdtBeforeWord = new RegExp(
          `(${SINGLE_SDT})((?:\\s|<(?!w:sdt\\b|\\/w:p\\b|w:p[\\s>\\/])[^>]+>)*?${wordRe})`,
          "g",
        );
        return windowXml.replace(sdtBeforeWord, (_m, sdtBlock, tail) => {
          return `${toggleSdtBlock(sdtBlock, isChecked)}${tail}`;
        });
      };

      // Force any <w:sdt> checkbox immediately following the literal word
      // (Yes/No) — across XML/whitespace only, never crossing a paragraph.
      const forceSdtAfterWord = (
        windowXml: string,
        word: "Yes" | "No",
        isChecked: boolean,
      ): string => {
        const wordRe = `\\b${word}\\b`;
        const sdtAfterWord = new RegExp(
          `(${wordRe})((?:\\s|<(?!w:sdt\\b|\\/w:p\\b|w:p[\\s>\\/])[^>]+>)*?)(${SINGLE_SDT})`,
          "g",
        );
        return windowXml.replace(sdtAfterWord, (_m, head, mid, sdtBlock) => {
          return `${head}${mid}${toggleSdtBlock(sdtBlock, isChecked)}`;
        });
      };

      // Force a static glyph (☐/☑/☒) immediately before the word.
      const forceGlyphBeforeWord = (
        windowXml: string,
        word: "Yes" | "No",
        glyph: string,
      ): string => {
        const wordRe = `\\b${word}\\b`;
        const inlineXmlOnly = `(?:\\s|<(?!w:sdt\\b|\\/w:sdt\\b|\\/w:p\\b|w:p[\\s>\\/])[^>]+>)*?`;
        // 0) Glyph and label inside the SAME <w:t> run (e.g. "☐ Yes").
        const glyphSameWt = new RegExp(
          `(<w:t[^>]*>)([^<]*?)([☐☑☒])(\\s*${wordRe}[^<]*</w:t>)`,
          "g",
        );
        let next = windowXml.replace(
          glyphSameWt,
          (_m, wtOpen, pre, _g, tail) => `${wtOpen}${pre}${glyph}${tail}`,
        );
        // 1) Glyph inside <w:t> followed by the word in a later run.
        const glyphInWt = new RegExp(
          `(<w:t[^>]*>)([^<]*?)([☐☑☒])([^<]*?</w:t>)(${inlineXmlOnly}${wordRe})`,
          "g",
        );
        next = next.replace(
          glyphInWt,
          (_m, wtOpen, pre, _g, wtTail, labelPart) =>
            `${wtOpen}${pre}${glyph}${wtTail}${labelPart}`,
        );
        // 2) Plain-text glyph (no <w:t> wrapper) directly before the word.
        const glyphPlain = new RegExp(
          `([☐☑☒])(${inlineXmlOnly})(${wordRe})`,
          "g",
        );
        next = next.replace(
          glyphPlain,
          (_m, _g, mid, labelText) => `${glyph}${mid}${labelText}`,
        );
        return next;
      };

      // Force a static glyph (☐/☑/☒) immediately after the word.
      const forceGlyphAfterWord = (
        windowXml: string,
        word: "Yes" | "No",
        glyph: string,
      ): string => {
        const wordRe = `\\b${word}\\b`;
        const inlineXmlOnly = `(?:\\s|<(?!w:sdt\\b|\\/w:sdt\\b|\\/w:p\\b|w:p[\\s>\\/])[^>]+>)*?`;
        const glyphInWt = new RegExp(
          `(${wordRe})(${inlineXmlOnly}<w:t[^>]*>)([^<]*?)([☐☑☒])([^<]*?</w:t>)`,
          "g",
        );
        let next = windowXml.replace(
          glyphInWt,
          (_m, head, mid, pre, _g, wtTail) =>
            `${head}${mid}${pre}${glyph}${wtTail}`,
        );
        const glyphPlain = new RegExp(
          `(${wordRe})(${inlineXmlOnly})([☐☑☒])`,
          "g",
        );
        next = next.replace(
          glyphPlain,
          (_m, head, mid, _g) => `${head}${mid}${glyph}`,
        );
        return next;
      };

      // Section-scoped window: start at the anchor and extend up to the next
      // major RE851A section marker (Part 4 onwards) so the Yes/No
      // checkboxes are reached even when Word pushes them onto a later
      // paragraph or column/page (RE851A v5 places them ~5–6KB after the
      // anchor, well past the previous fixed 3KB window). Fall back to a
      // generous 12KB cap if no section marker is found.
      const SECTION_END_MARKERS = [
        "PART 4", "PART\u00A04",
        "MULTI-LENDER TRANSACTIONS",
        "PART 5", "PART\u00A05",
      ];
      const WINDOW_HARD_CAP = 12000;
      let scanFrom = 0;
      let rebuilt = "";
      let anchorMatch: RegExpExecArray | null;
      let touched = false;
      anchorRe.lastIndex = 0;
      while ((anchorMatch = anchorRe.exec(result)) !== null) {
        const winStart = anchorMatch.index;
        // Find the nearest downstream section marker (text-only check is
        // imprecise vs XML, but acceptable here — markers are unique).
        let sectionEnd = result.length;
        for (const marker of SECTION_END_MARKERS) {
          const idx = result.indexOf(marker, winStart + 1);
          if (idx > 0 && idx < sectionEnd) sectionEnd = idx;
        }
        const winEnd = Math.min(result.length, sectionEnd, winStart + WINDOW_HARD_CAP);
        rebuilt += result.substring(scanFrom, winStart);
        let windowXml = result.substring(winStart, winEnd);

        // Defense-in-depth: sanitize stray TEXT inside <w:rPr> for EVERY
        // <w:sdt> block in the section window. The RE851A v5+ template has
        // literal ☑ glyph text typed inside the <w:rPr> children of both
        // <w:sdtPr> and <w:sdtContent><w:r>. Word renders that text outside
        // <w:t>, producing phantom glyphs no toggle can affect. We strip
        // bare text only — all child tags (rFonts, color, sz, etc.) are
        // preserved bit-for-bit. Scoped to the subordination section window.
        let sanitizedSdts = 0;
        windowXml = windowXml.replace(
          /<w:sdt\b(?:(?!<w:sdt\b)[\s\S])*?<\/w:sdt>/g,
          (sdtBlock) => {
            if (!/<w14:checkbox\b/.test(sdtBlock)) return sdtBlock;
            const cleaned = sdtBlock.replace(
              /(<w:rPr\b[^>]*>)([\s\S]*?)(<\/w:rPr>)/g,
              (_m, open, inner, close) => {
                const stripped = inner.replace(
                  /(<[^>]+>)|[^<]+/g,
                  (seg: string) => (seg.startsWith("<") ? seg : ""),
                );
                return `${open}${stripped}${close}`;
              },
            );
            if (cleaned !== sdtBlock) sanitizedSdts++;
            return cleaned;
          },
        );

        // Native Word SDT checkboxes — both label orientations.
        windowXml = forceSdtBeforeWord(windowXml, "Yes", yesChecked);
        windowXml = forceSdtBeforeWord(windowXml, "No", noChecked);
        windowXml = forceSdtAfterWord(windowXml, "Yes", yesChecked);
        windowXml = forceSdtAfterWord(windowXml, "No", noChecked);

        // Static glyphs — both label orientations.
        windowXml = forceGlyphBeforeWord(windowXml, "Yes", yesGlyph);
        windowXml = forceGlyphBeforeWord(windowXml, "No", noGlyph);
        windowXml = forceGlyphAfterWord(windowXml, "Yes", yesGlyph);
        windowXml = forceGlyphAfterWord(windowXml, "No", noGlyph);

        // Final-final pass — paragraph-scoped Yes/No glyph normalization.
        // Some RE851A authoring leaves the Subordination Provision row using
        // clean Handlebars text checkboxes ({{#if KEY}}☑{{else}}☐{{/if}} Yes)
        // that Word may split across runs in shapes the cross-run consolidator
        // does not catch. After conditional eval + the existing safety net
        // strips control markers, the paragraph can end up with BOTH branch
        // glyphs (☑ AND ☐) present before the literal "Yes" or "No". The
        // forceGlyph* helpers above only touch the closest glyph to the label;
        // if a stray opposite glyph survives elsewhere in the same paragraph
        // the user sees a wrong checkbox. Here we walk every <w:p> inside the
        // section window that ends in " Yes" or " No" (after stripping XML),
        // remove ALL checkbox glyphs from it, then re-insert exactly the
        // desired glyph immediately before the label run. Any leftover
        // {{#if/else/#if/.../if}} text remnants are also scrubbed. Scoped
        // strictly to this row — no other paragraph is touched.
        let normalizedParas = 0;
        windowXml = windowXml.replace(
          /<w:p\b[\s\S]*?<\/w:p>/g,
          (para) => {
            const plain = para.replace(/<[^>]*>/g, "");
            const trimmed = plain.replace(/\s+/g, " ").trim();
            // Detect presence of Yes / No labels inside the paragraph. The
            // RE851A v5+ shape places BOTH labels in the same Word paragraph
            // separated by a soft line break (<w:br/>), so we cannot require
            // the paragraph to *end* in Yes or No anymore. Instead match the
            // tight checkbox row pattern: a label preceded by either a
            // checkbox glyph or a Handlebars control marker.
            const hasYes = /(?:[☐☑☒]|\}\})\s*Yes\b/.test(trimmed)
              || /(?:^|\s)Yes\b/.test(trimmed);
            const hasNo = /(?:[☐☑☒]|\}\})\s*No\b/.test(trimmed)
              || /(?:^|\s)No\b/.test(trimmed);
            // Quick reject: must contain at least one label *and* either a
            // checkbox glyph or an unresolved Handlebars #if marker
            // referencing the subordination key. This prevents the
            // normalizer from touching unrelated prose paragraphs in the
            // same window (e.g. the "If YES, explain here..." sentence).
            if (!hasYes && !hasNo) return para;
            const hasCheckboxArtifact = /[☐☑☒]/.test(trimmed)
              || /\{\{\s*#if\s+ln_p_subordinationProvision\s*\}\}/i.test(trimmed)
              || /\{\{\s*#if\s+loan_terms\.subordination_provision\s*\}\}/i.test(trimmed);
            if (!hasCheckboxArtifact) return para;
            // Skip paragraphs that already use native Word SDT checkboxes —
            // those are fully handled by the SDT-toggle helpers above.
            if (/<w:sdt\b/.test(para)) return para;
            // Reject paragraphs that look like the explanatory sentence
            // ("If YES, explain here or on an attachment.") or any other
            // prose row. The Yes/No checkbox cell text is short even when
            // both rows share the paragraph.
            const lenWithoutHbs = trimmed
              .replace(/\{\{[^}]*\}\}/g, "")
              .trim().length;
            if (lenWithoutHbs > 40) return para;
            // Reject if the paragraph contains a different complete word
            // beyond the labels and an optional checkbox glyph cluster.
            // Allowed visible words after stripping Handlebars+glyphs:
            // only "Yes" / "No" (case-sensitive, the RE851A authored form).
            const wordsOnly = trimmed
              .replace(/\{\{[^}]*\}\}/g, " ")
              .replace(/[☐☑☒]/g, " ")
              .replace(/[^A-Za-z]+/g, " ")
              .trim()
              .split(/\s+/)
              .filter(Boolean);
            const allowedWords = new Set(["Yes", "No"]);
            for (const w of wordsOnly) {
              if (!allowedWords.has(w)) return para;
            }

            let p = para;
            // 1. Strip any residual Handlebars control markers in <w:t> runs.
            p = p.replace(
              /<w:t([^>]*)>([^<]*)<\/w:t>/g,
              (m, attrs, text) => {
                let cleaned = text;
                cleaned = cleaned.replace(/\{\{\s*#if\s+[A-Za-z0-9_.]+\s*\}\}/g, "");
                cleaned = cleaned.replace(/\{\{\s*\/if\s*\}\}/g, "");
                cleaned = cleaned.replace(/\{\{\s*else\s*\}\}/g, "");
                cleaned = cleaned.replace(/\{\{\s*#unless\s+[A-Za-z0-9_.]+\s*\}\}/g, "");
                cleaned = cleaned.replace(/\{\{\s*\/unless\s*\}\}/g, "");
                if (cleaned === text) return m;
                return `<w:t${attrs}>${cleaned}</w:t>`;
              },
            );
            // 2. Remove ALL checkbox glyphs inside <w:t> in this paragraph.
            p = p.replace(
              /<w:t([^>]*)>([^<]*)<\/w:t>/g,
              (m, attrs, text) => {
                if (!/[☐☑☒]/.test(text)) return m;
                const cleaned = text.replace(/[☐☑☒]/g, "");
                return `<w:t${attrs}>${cleaned}</w:t>`;
              },
            );
            // 3. Inject the correct glyph immediately before EACH label run
            //    that exists in this paragraph. Treat Yes and No
            //    independently so a single Word paragraph carrying both
            //    rows (separated by <w:br/>) gets BOTH checkboxes set.
            const injectGlyphBeforeLabel = (
              xml: string,
              labelWord: "Yes" | "No",
              glyph: string,
            ): { xml: string; injected: boolean } => {
              const labelRunRe = new RegExp(
                `(<w:r\\b[^>]*>(?:<w:rPr>[\\s\\S]*?<\\/w:rPr>)?\\s*<w:t(?:\\s[^>]*)?>)([^<]*\\b${labelWord}\\b[^<]*)(<\\/w:t>\\s*<\\/w:r>)`,
              );
              if (!labelRunRe.test(xml)) return { xml, injected: false };
              const next = xml.replace(labelRunRe, (_m, head, txt, tail) => {
                const leadWs = (txt.match(/^\s*/) || [""])[0];
                const rest = txt.substring(leadWs.length);
                return `${head}${leadWs}${glyph} ${rest}${tail}`;
              });
              return { xml: next, injected: next !== xml };
            };
            let injectedAny = false;
            if (hasYes) {
              const r = injectGlyphBeforeLabel(p, "Yes", yesGlyph);
              p = r.xml;
              injectedAny = injectedAny || r.injected;
            }
            if (hasNo) {
              const r = injectGlyphBeforeLabel(p, "No", noGlyph);
              p = r.xml;
              injectedAny = injectedAny || r.injected;
            }
            if (injectedAny) normalizedParas++;
            return p;
          },
        );

        // Final pass — RE851A live layout: a paragraph containing only the
        // literal label "Yes" or "No" (case-sensitive) with NO checkbox glyph,
        // NO Handlebars marker and NO native SDT block. The previous passes
        // require an existing glyph/SDT/Handlebars marker to act, so a label
        // such as a bare "No" cell renders without any checkbox. Here we
        // detect those bare label paragraphs and inject the desired glyph
        // immediately before the label run. Strictly scoped to Yes/No-only
        // paragraphs; no prose row is touched.
        let injectedBareParas = 0;
        windowXml = windowXml.replace(
          /<w:p\b[\s\S]*?<\/w:p>/g,
          (para) => {
            if (/<w:sdt\b/.test(para)) return para;
            if (/[☐☑☒]/.test(para)) return para;
            if (/\{\{/.test(para)) return para;
            const plain = para.replace(/<[^>]*>/g, "");
            const trimmed = plain.replace(/\s+/g, " ").trim();
            if (!trimmed) return para;
            // Allowed visible words: only "Yes" / "No" (case-sensitive).
            const words = trimmed.split(/[^A-Za-z]+/).filter(Boolean);
            if (words.length === 0 || words.length > 2) return para;
            const allowed = new Set(["Yes", "No"]);
            for (const w of words) if (!allowed.has(w)) return para;
            const hasYesLabel = words.includes("Yes");
            const hasNoLabel = words.includes("No");

            const injectBareGlyph = (
              xml: string,
              labelWord: "Yes" | "No",
              glyph: string,
            ): { xml: string; injected: boolean } => {
              const labelRunRe = new RegExp(
                `(<w:r\\b[^>]*>(?:<w:rPr>[\\s\\S]*?<\\/w:rPr>)?\\s*<w:t(?:\\s[^>]*)?>)([^<]*\\b${labelWord}\\b[^<]*)(<\\/w:t>\\s*<\\/w:r>)`,
              );
              if (!labelRunRe.test(xml)) return { xml, injected: false };
              const next = xml.replace(labelRunRe, (_m, head, txt, tail) => {
                const leadWs = (txt.match(/^\s*/) || [""])[0];
                const rest = txt.substring(leadWs.length);
                return `${head}${leadWs}${glyph} ${rest}${tail}`;
              });
              return { xml: next, injected: next !== xml };
            };

            let p = para;
            let injected = false;
            if (hasYesLabel) {
              const r = injectBareGlyph(p, "Yes", yesGlyph);
              p = r.xml;
              injected = injected || r.injected;
            }
            if (hasNoLabel) {
              const r = injectBareGlyph(p, "No", noGlyph);
              p = r.xml;
              injected = injected || r.injected;
            }
            if (injected) injectedBareParas++;
            return p;
          },
        );

        console.log(
          `[tag-parser] Subordination Provision safety pass executed: isSubordination=${isSubordination}, windowLen=${winEnd - winStart}, sanitizedSdts=${sanitizedSdts}, normalizedParas=${normalizedParas}, injectedBareParas=${injectedBareParas}`,
        );

        rebuilt += windowXml;
        scanFrom = winEnd;
        anchorRe.lastIndex = winEnd;
        touched = true;
      }
      if (touched) {
        rebuilt += result.substring(scanFrom);
        result = rebuilt;
      }
    }
  }

  // RE851A Part 3 — Amortization (CHECK ONE) safety pass.
  //
  // The Amortization dropdown (ln_p_amortiza / loan_terms.amortization) drives
  // a derived set of mutually-exclusive booleans (ln_p_amortized,
  // ln_p_amortizedPartially, ln_p_interestOnly, ln_p_constantAmortization,
  // ln_p_addOnInterest, ln_p_other). After all merge-tag, conditional, and
  // label replacements have run, force the checkbox immediately preceding
  // each Amortization label to match the derived state. This guarantees
  // exactly one checked box and all other Amortization checkboxes unchecked.
  //
  // Label-collision safety: the bare label "AMORTIZED" is matched with a
  // negative lookahead so it can NEVER target the line containing
  // "AMORTIZED PARTIALLY". Labels are also processed longest-first as a
  // defense-in-depth measure. The pass updates two checkbox shapes only:
  //   (a) a checkbox glyph (☐/☑/☒) inside the most recent <w:t> before the
  //       label, OR
  //   (b) the most recent native <w:sdt><w14:checkbox>…</w:sdt> block before
  //       the label (both the w14:checked state and the visible glyph).
  //
  // Other RE851A sections, labels, formatting, and XML structure are
  // preserved unchanged.
  if (is851A) {
    const readBool = (key: string): boolean | null => {
      const d = getFieldData(key, fieldValues)?.data;
      if (!d) return null;
      const raw = d.rawValue;
      if (raw === null || raw === "") return null;
      if (typeof raw === "string") {
        const v = raw.trim().toLowerCase();
        if (["true", "yes", "y", "1", "checked", "on"].includes(v)) return true;
        if (["false", "no", "n", "0", "unchecked", "off"].includes(v)) return false;
        return null;
      }
      if (typeof raw === "number") return raw !== 0;
      return Boolean(raw);
    };

    const amortStates: Array<{ key: string; labels: string[] }> = [
      { key: "ln_p_amortized", labels: ["FULLY AMORTIZED", "AMORTIZED"] },
      { key: "ln_p_amortizedPartially", labels: ["AMORTIZED PARTIALLY", "PARTIALLY AMORTIZED"] },
      { key: "ln_p_interestOnly", labels: ["INTEREST ONLY"] },
      { key: "ln_p_constantAmortization", labels: ["CONSTANT AMORTIZATION"] },
      { key: "ln_p_addOnInterest", labels: ["ADD-ON INTEREST", "ADD ON INTEREST"] },
      { key: "ln_p_other", labels: ["Other"] },
    ];

    // Only apply the safety pass when at least one derived boolean is present
    // (i.e. the dropdown was set). Otherwise leave the template untouched.
    const anyDerived = amortStates.some(({ key }) => readBool(key) !== null);
    if (anyDerived) {
      const buildXmlFlex = (label: string) =>
        label.split(/\s+/).filter(Boolean)
          .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("(?:\\s|<[^>]+>)*");

      // Right-context guard. For the bare "AMORTIZED" label we MUST refuse to
      // match anything that is followed (after optional XML/whitespace) by
      // the word "PARTIALLY", otherwise this pass would overwrite the
      // Partially Amortized checkbox state set by its own (longer-label)
      // pass earlier in this loop.
      const rightGuard = (label: string): string => {
        if (label.toUpperCase() === "AMORTIZED") {
          return "(?!(?:\\s|<[^>]+>)+PARTIALLY\\b)(?![A-Za-z])";
        }
        return "(?![A-Za-z])";
      };

      // Update the w14:checked state + visible display glyph inside the
      // most recent native SDT checkbox block found before the label.
      // Scoped to a single <w:sdt>…</w:sdt> block — never touches sibling
      // SDTs or surrounding content.
      const updateSdtBlock = (sdt: string, isChecked: boolean): string => {
        const checkedVal = isChecked ? "1" : "0";
        const glyphChar = isChecked ? "\u2611" : "\u2610";
        let next = sdt.replace(
          /(<w14:checked\s+w14:val=")[01](")/i,
          `$1${checkedVal}$2`,
        );
        // Update the visible glyph inside <w:sdtContent>...<w:t>X</w:t>...
        next = next.replace(
          /(<w:sdtContent\b[\s\S]*?<w:t[^>]*>)[☐☑☒](<\/w:t>[\s\S]*?<\/w:sdtContent>)/,
          `$1${glyphChar}$2`,
        );
        return next;
      };

      const forceCheckboxForLabel = (xml: string, label: string, isChecked: boolean): string => {
        const labelPattern = buildXmlFlex(label);
        if (!labelPattern) return xml;
        const guard = rightGuard(label);
        const glyph = isChecked ? "\u2611" : "\u2610";

        // 1) Glyph inside <w:t> followed by the label across XML/whitespace.
        //    Only the glyph character is rewritten — surrounding text and
        //    formatting runs are untouched.
        const glyphInWt = new RegExp(
          `(<w:t[^>]*>)([^<]*?)([☐☑☒])([^<]*?</w:t>)((?:\\s|<[^>]+>)*?${labelPattern})${guard}`,
          "gi",
        );
        let next = xml.replace(glyphInWt, (_m, wtOpen, pre, _g, wtTail, labelPart) =>
          `${wtOpen}${pre}${glyph}${wtTail}${labelPart}`,
        );

        // 2) Plain-text glyph (no <w:t> wrapper) directly before the label.
        const glyphPlain = new RegExp(
          `([☐☑☒])((?:\\s|<[^>]+>)*?)(${labelPattern})${guard}`,
          "gi",
        );
        next = next.replace(glyphPlain, (_m, _g, mid, labelText) =>
          `${glyph}${mid}${labelText}`,
        );

        // 3) Native Word SDT checkbox immediately before the label. We
        //    rewrite the SDT's w14:checked state AND its visible glyph so
        //    Word renders the correct selection. The match is anchored with
        //    a backreference-free full SDT block (depth-1; no nested SDTs in
        //    the RE851A amortization area).
        const sdtBeforeLabel = new RegExp(
          `(<w:sdt\\b(?:(?!<w:sdt\\b)[\\s\\S])*?<w14:checkbox\\b[\\s\\S]*?<\\/w:sdt>)((?:\\s|<[^>]+>)*?${labelPattern})${guard}`,
          "gi",
        );
        next = next.replace(sdtBeforeLabel, (_m, sdtBlock, labelPart) =>
          `${updateSdtBlock(sdtBlock, isChecked)}${labelPart}`,
        );

        return next;
      };

      // Sort labels longest-first so "AMORTIZED PARTIALLY" is processed
      // before "AMORTIZED" — combined with the negative lookahead in
      // rightGuard("AMORTIZED"), this fully isolates the two labels.
      const ordered = amortStates
        .flatMap(({ key, labels }) => labels.map((label) => ({ key, label })))
        .sort((a, b) => b.label.length - a.label.length);

      for (const { key, label } of ordered) {
        const state = readBool(key);
        if (state === null) continue;
        result = forceCheckboxForLabel(result, label, state);
      }

      console.log(
        `[generate-document] Forced RE851A Amortization checkboxes: ${amortStates
          .map(({ key }) => `${key}=${readBool(key)}`)
          .join(", ")}`,
      );
    }
  }

  // RE851A — Payable (Monthly / Annually) safety pass.
  // Strictly scoped to the literal RE851A "Monthly" and "Annually" labels.
  // After all merge-tag, conditional, label, bracket, broker-capacity, and
  // servicing-agent logic has run, force the glyph immediately preceding
  // each label to the correct state derived from the CSR Loan -> Servicing
  // Details -> Payable dropdown:
  //   Monthly   → ☑ "Monthly",  ☐ "Annually"
  //   Annually  → ☐ "Monthly",  ☑ "Annually"
  // Other dropdown values (e.g. Quarterly) leave the Monthly/Annually
  // glyphs untouched. Surrounding text, formatting, and XML structure are
  // preserved unchanged — only the glyph character toggles.
  if (is851A) {
    const payableRaw =
      getFieldData("loan_terms.servicing.payable_annually", fieldValues)?.data?.rawValue
      ?? getFieldData("loan_terms.servicing.payable", fieldValues)?.data?.rawValue
      ?? getFieldData("origination_svc.payable", fieldValues)?.data?.rawValue
      ?? "";
    const payable = String(payableRaw).trim().toLowerCase();
    let payableMode: "monthly" | "annually" | null = null;
    if (payable === "monthly") payableMode = "monthly";
    else if (payable === "annually" || payable === "annual" || payable === "yearly") payableMode = "annually";

    if (payableMode !== null) {
      const monthlyGlyph  = payableMode === "monthly"  ? "☑" : "☐";
      const annuallyGlyph = payableMode === "annually" ? "☑" : "☐";

      const buildXmlFlex = (label: string) =>
        label.split(/\s+/).filter(Boolean)
          .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("(?:\\s|<[^>]+>)*");

      // Word-boundary guards on BOTH sides so we never match "Monthly" as
      // part of a longer word (e.g. "Bimonthly", "Annually" as part of
      // "Semiannually") or match labels where the preceding character is a
      // letter (avoiding accidental hits inside other paragraphs that may
      // contain the word).
      const monthlyPattern  = `(?<![A-Za-z])${buildXmlFlex("Monthly")}(?![A-Za-z])`;
      const annuallyPattern = `(?<![A-Za-z])${buildXmlFlex("Annually")}(?![A-Za-z])`;

      const forceGlyphBeforeLabel = (xml: string, labelPattern: string, glyph: string): string => {
        // 1) Glyph inside a <w:t> immediately followed (across XML/whitespace)
        //    by the literal label. Replace ONLY the glyph character.
        const glyphInWt = new RegExp(
          `(<w:t[^>]*>)([^<]*?)([☐☑☒])([^<]*?</w:t>)((?:\\s|<[^>]+>)*?${labelPattern})`,
          "gi",
        );
        let next = xml.replace(glyphInWt, (_m, wtOpen, pre, _g, wtTail, labelPart) =>
          `${wtOpen}${pre}${glyph}${wtTail}${labelPart}`,
        );

        // 2) Plain-text glyph (no <w:t> wrapper) directly before the label.
        const glyphPlain = new RegExp(
          `([☐☑☒])((?:\\s|<[^>]+>)*?)(${labelPattern})`,
          "gi",
        );
        next = next.replace(glyphPlain, (_m, _g, mid, labelText) =>
          `${glyph}${mid}${labelText}`,
        );
        return next;
      };

      result = forceGlyphBeforeLabel(result, monthlyPattern,  monthlyGlyph);
      result = forceGlyphBeforeLabel(result, annuallyPattern, annuallyGlyph);

      console.log(
        `[generate-document] Forced RE851A Payable glyphs: payable="${payable}", monthly=${monthlyGlyph}, annually=${annuallyGlyph}`,
      );
    }
  }

  // RE851A Part 2 — broker-capacity A/B paragraph-split normalization.
  //
  // When the RE851A template authors place the A. Agent / B. Principal
  // checkbox lines inside the SAME <w:p> separated only by a soft line
  // break (<w:br/>, Shift+Enter), the post-processing pipeline (SDT
  // conversion, label-based replacement, deduplication) is fragile because
  // both glyphs share a single paragraph context. The user-reported failure
  // mode is that Option B's checkbox is missing or never flips to ☑ when
  // or_p_isBrkBorrower=true.
  //
  // To make rendering robust REGARDLESS of how the template author broke
  // the line, we promote any soft break that sits between the literal
  // "A. Agent in arranging a loan" and "B. ... Principal as a borrower"
  // labels into a real paragraph boundary. The original <w:pPr> (if any)
  // is cloned onto both halves so paragraph formatting is preserved, and
  // we explicitly enforce 0pt before/after with single line spacing per
  // requirement so no extra spacing is introduced between A and B.
  //
  // Strictly scoped to this single A./B. row — no other paragraphs or
  // sections of the document are touched.
  if (is851A) {
    const splitParaRe = /<w:p\b([^>]*)>([\s\S]*?)<\/w:p>/g;
    result = result.replace(splitParaRe, (full, pAttrs, inner) => {
      // Plain text of the paragraph — used to detect both labels are present.
      const plain = inner.replace(/<[^>]*>/g, "");
      const hasA = /A\.\s*Agent in arranging a loan/i.test(plain);
      const hasB = /B\.\s*\*?\s*Principal as a borrower/i.test(plain);
      if (!hasA || !hasB) return full;
      // Must contain at least one soft break to split on.
      if (!/<w:br\b[^>]*\/>/i.test(inner)) return full;

      // Extract <w:pPr> (paragraph properties) if present so we can clone it.
      const pPrMatch = inner.match(/^(\s*<w:pPr>[\s\S]*?<\/w:pPr>)/);
      const pPr = pPrMatch ? pPrMatch[1] : "";
      const body = pPr ? inner.slice(pPr.length) : inner;

      // Split the body on the FIRST <w:br/> that sits between A and B.
      // We look for a <w:br/> whose left side contains "A. Agent..." and
      // right side contains "B. ... Principal...". The simplest reliable
      // approach: split on every <w:br/> and find the boundary where the
      // accumulated left plain-text contains the A label and the right
      // plain-text contains the B label.
      const brSplit = body.split(/(<w:br\b[^>]*\/>)/i);
      let splitIdx = -1;
      for (let i = 1; i < brSplit.length; i += 2) {
        const left = brSplit.slice(0, i).join("").replace(/<[^>]*>/g, "");
        const right = brSplit.slice(i + 1).join("").replace(/<[^>]*>/g, "");
        if (
          /A\.\s*Agent in arranging a loan/i.test(left) &&
          /B\.\s*\*?\s*Principal as a borrower/i.test(right)
        ) {
          splitIdx = i;
          break;
        }
      }
      if (splitIdx < 0) return full;

      const leftBody = brSplit.slice(0, splitIdx).join("");
      const rightBody = brSplit.slice(splitIdx + 1).join("");

      // Build a paragraph-properties block that enforces:
      //   • Spacing Before = 0 pt
      //   • Spacing After  = 0 pt
      //   • Line spacing   = Single (240 twentieths of a point, auto rule)
      // If the original paragraph had its own <w:pPr>, merge our spacing
      // override INTO it so other formatting (alignment, indentation, run
      // properties etc.) is preserved unchanged.
      const spacingTag = `<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>`;
      let mergedPPr: string;
      if (pPr) {
        if (/<w:spacing\b[^/]*\/>/.test(pPr)) {
          mergedPPr = pPr.replace(/<w:spacing\b[^/]*\/>/, spacingTag);
        } else {
          mergedPPr = pPr.replace(/<w:pPr>/, `<w:pPr>${spacingTag}`);
        }
      } else {
        mergedPPr = `<w:pPr>${spacingTag}</w:pPr>`;
      }

      return (
        `<w:p${pAttrs}>${mergedPPr}${leftBody}</w:p>` +
        `<w:p${pAttrs}>${mergedPPr}${rightBody}</w:p>`
      );
    });
  }


  // RE851A Part 2 — broker-capacity A/B safety pass.
  // Strictly scoped to the literal "A. Agent in arranging..." and
  // "B. [optional *]Principal as a borrower..." labels. After all merge-tag,
  // conditional, label, and bracket replacements have run, force the glyph
  // immediately preceding each label to the correct state derived from
  // or_p_isBrkBorrower. This prevents a leftover static unchecked glyph
  // (or a stale conditional remnant) from masking the user's CSR selection.
  // Surrounding text, formatting, and XML structure are preserved unchanged.
  if (is851A) {
    const brkData =
      getFieldData("or_p_isBrkBorrower", fieldValues)?.data
      || getFieldData("or_p_brkCapacityPrincipal", fieldValues)?.data
      || getFieldData("origination_app.doc.is_broker_also_borrower_yes", fieldValues)?.data
      || getFieldData("or_p_isBrokerAlsoBorrower_yes", fieldValues)?.data;
    let isBrkBorrower: boolean | null = null;
    if (brkData) {
      const raw = brkData.rawValue;
      if (raw === null || raw === "") {
        isBrkBorrower = null;
      } else if (typeof raw === "string") {
        const v = raw.trim().toLowerCase();
        if (["true", "yes", "y", "1", "checked", "on"].includes(v)) isBrkBorrower = true;
        else if (["false", "no", "n", "0", "unchecked", "off"].includes(v)) isBrkBorrower = false;
      } else if (typeof raw === "number") {
        isBrkBorrower = raw !== 0;
      } else {
        isBrkBorrower = Boolean(raw);
      }
    }

    if (isBrkBorrower !== null) {
      // Per UI spec: "Is Broker Also a Borrower?" Yes means the broker is
      // acting as a Principal (a borrower on the loan), so:
      //   Yes → A. Agent unchecked, B. Principal checked
      //   No  → A. Agent checked,   B. Principal unchecked
      // This matches both the label-binding path (or_p_brkCapacityAgent /
      // or_p_brkCapacityPrincipal) and any inline {{#if or_p_isBrkBorrower}}
      // conditionals authored directly in the template.
      const aGlyph = isBrkBorrower ? "☐" : "☑"; // A. Agent (1st)
      const bGlyph = isBrkBorrower ? "☑" : "☐"; // B. Principal (2nd)
      const labelA = "A. Agent in arranging a loan";
      // Allow optional "*" before "Principal" to match the live RE851A wording.
      const labelBCore = "Principal as a borrower";

      const buildXmlFlex = (label: string) =>
        label.split(/\s+/).filter(Boolean)
          .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("(?:\\s|<[^>]+>)*");

      const aPattern = buildXmlFlex(labelA);
      const bPattern = `B\\.(?:\\s|<[^>]+>)*\\*?(?:\\s|<[^>]+>)*${buildXmlFlex(labelBCore)}`;

      const forceGlyphBeforeLabel = (xml: string, labelPattern: string, glyph: string): string => {
        // 1) Glyph inside a <w:t> immediately followed (across XML/whitespace)
        //    by the literal label. Replace ONLY the glyph character.
        const glyphInWt = new RegExp(
          `(<w:t[^>]*>)([^<]*?)([☐☑☒])([^<]*?</w:t>)((?:\\s|<[^>]+>)*?${labelPattern})(?![A-Za-z])`,
          "gi",
        );
        let next = xml.replace(glyphInWt, (_m, wtOpen, pre, _g, wtTail, labelPart) =>
          `${wtOpen}${pre}${glyph}${wtTail}${labelPart}`,
        );

        // 2) Plain-text glyph (no <w:t> wrapper) directly before the label.
        const glyphPlain = new RegExp(
          `([☐☑☒])((?:\\s|<[^>]+>)*?)(${labelPattern})(?![A-Za-z])`,
          "gi",
        );
        next = next.replace(glyphPlain, (_m, _g, mid, labelText) =>
          `${glyph}${mid}${labelText}`,
        );
        return next;
      };

      result = forceGlyphBeforeLabel(result, aPattern, aGlyph);
      result = forceGlyphBeforeLabel(result, bPattern, bGlyph);
      console.log(
        `[generate-document] Forced RE851A broker-capacity glyphs: isBrkBorrower=${isBrkBorrower}, A=${aGlyph}, B=${bGlyph}`,
      );

      // Local paragraph-scoped dedup: collapse two adjacent glyphs separated
      // only by intra-paragraph XML/whitespace into the FIRST one (which we
      // just forced to the correct state). This handles templates that have
      // both a static glyph AND a conditionally-rendered glyph on the same
      // A/B line.
      result = result.replace(
        /([☐☑☒])((?:\s|<(?!\/w:p\b|w:p[\s>\/]|w:br[\s>\/])[^>]*>)*?)([☐☑☒])((?:\s|<(?!\/w:p\b|w:p[\s>\/]|w:br[\s>\/])[^>]*>)*?)(A\.(?:\s|<[^>]+>)*Agent|B\.(?:\s|<[^>]+>)*\*?(?:\s|<[^>]+>)*Principal)/g,
        (_m, g1, mid1, _g2, mid2, labelHead) => `${g1}${mid1}${mid2}${labelHead}`,
      );
    }
  }

  // RE851A — Servicing Agent safety pass.
  // Strictly scoped to the three literal RE851A servicing-section labels.
  // After all merge-tag, conditional, label, bracket, and broker-capacity
  // logic has run, force the glyph immediately preceding each label to the
  // correct state derived from the CSR Servicing Agent dropdown:
  //   Lender                    → ☑ "THERE ARE NO SERVICING ARRANGEMENTS"
  //   Broker                    → ☑ "BROKER IS THE SERVICING AGENT"
  //   Company / Other Servicer  → ☑ "ANOTHER QUALIFIED PARTY WILL SERVICE THE LOAN"
  // All other servicing glyphs become ☐. This guarantees exactly one ☑
  // even when the template's {{#if (eq …)}} blocks were broken across
  // <w:r>/<w:t>/SDT runs and left a static ☐ behind. Surrounding text,
  // formatting, and XML structure are preserved unchanged — only the
  // glyph character toggles.
  if (is851A) {
    const agentRaw =
      getFieldData("sv_p_servicingAgent", fieldValues)?.data?.rawValue
      ?? getFieldData("oo_svc_servicingAgent", fieldValues)?.data?.rawValue
      ?? getFieldData("origination_svc.servicing_agent", fieldValues)?.data?.rawValue
      ?? getFieldData("loan_terms.servicing_agent", fieldValues)?.data?.rawValue
      ?? "";
    const agent = String(agentRaw).trim().toLowerCase();
    let mode: "lender" | "broker" | "other" | null = null;
    if (agent === "lender") mode = "lender";
    else if (agent === "broker") mode = "broker";
    else if (agent === "company" || agent === "other servicer" || agent === "other") mode = "other";

    if (mode !== null) {
      const lenderGlyph = mode === "lender" ? "☑" : "☐";
      const brokerGlyph = mode === "broker" ? "☑" : "☐";
      const otherGlyph  = mode === "other"  ? "☑" : "☐";

      const buildXmlFlex = (label: string) =>
        label.split(/\s+/).filter(Boolean)
          .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("(?:\\s|<[^>]+>)*");

      const lenderPattern = buildXmlFlex("THERE ARE NO SERVICING ARRANGEMENTS");
      const brokerPattern = buildXmlFlex("BROKER IS THE SERVICING AGENT");
      const otherPattern  = buildXmlFlex("ANOTHER QUALIFIED PARTY WILL SERVICE THE LOAN");

      const forceGlyphBeforeLabel = (xml: string, labelPattern: string, glyph: string): string => {
        // 1) Glyph inside a <w:t> immediately followed (across XML/whitespace)
        //    by the literal label. Replace ONLY the glyph character.
        const glyphInWt = new RegExp(
          `(<w:t[^>]*>)([^<]*?)([☐☑☒])([^<]*?</w:t>)((?:\\s|<[^>]+>)*?${labelPattern})(?![A-Za-z])`,
          "gi",
        );
        let next = xml.replace(glyphInWt, (_m, wtOpen, pre, _g, wtTail, labelPart) =>
          `${wtOpen}${pre}${glyph}${wtTail}${labelPart}`,
        );

        // 2) Plain-text glyph (no <w:t> wrapper) directly before the label.
        const glyphPlain = new RegExp(
          `([☐☑☒])((?:\\s|<[^>]+>)*?)(${labelPattern})(?![A-Za-z])`,
          "gi",
        );
        next = next.replace(glyphPlain, (_m, _g, mid, labelText) =>
          `${glyph}${mid}${labelText}`,
        );
        return next;
      };

      result = forceGlyphBeforeLabel(result, lenderPattern, lenderGlyph);
      result = forceGlyphBeforeLabel(result, brokerPattern, brokerGlyph);
      result = forceGlyphBeforeLabel(result, otherPattern,  otherGlyph);

      console.log(
        `[generate-document] Forced RE851A servicing-agent glyphs: agent="${agent}", lender=${lenderGlyph}, broker=${brokerGlyph}, other=${otherGlyph}`,
      );
    }
  }

  __mark('postReplaceCleanup');

  // Glyph standardization: replace any ballot-box-with-X (☒) with check
  // (☑) so the "checked" state renders consistently across all generated
  // documents. Logic unchanged — display glyph only.
  if (result.indexOf('\u2612') !== -1) {
    result = result.replace(/\u2612/g, '\u2611');
  }

  // Final pass: convert any remaining checkbox glyphs (☐/☑) in <w:r>
  // elements into native Word SDT checkboxes so they are editable/clickable.
  result = convertGlyphsToSdtCheckboxes(result);
  __mark('convertGlyphsToSdt');

  if (__perfEnabled && __phases.length > 0) {
    const total = __phases.reduce((s, p) => s + p.ms, 0);
    const top = __phases
      .slice()
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 5)
      .map((p) => `${p.name}=${p.ms}ms`)
      .join(', ');
    console.log(
      `[tag-parser] phases total=${total}ms size=${content.length}B top5: ${top}`,
    );
  }

  return result;
}
