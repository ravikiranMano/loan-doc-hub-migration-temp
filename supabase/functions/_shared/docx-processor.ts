/**
 * DOCX Processing Utilities
 * 
 * Handles ZIP/XML manipulation for Word documents,
 * including decompression, XML processing, and recompression.
 */

import * as fflate from "https://esm.sh/fflate@0.8.2";
import type { DocxProcessingOptions, FieldValueData, LabelMapping } from "./types.ts";
import { replaceMergeTags } from "./tag-parser.ts";

const DOC_GEN_DEBUG = Deno.env.get("DOC_GEN_DEBUG") === "true";
const debugLog = (...args: unknown[]) => {
  if (DOC_GEN_DEBUG) {
    console.log(...args);
  }
};

/**
 * Process a DOCX file by replacing merge tags with field values.
 * @param docxBuffer - The source DOCX file bytes
 * @param validFieldKeys - Set of valid field keys from field_dictionary for direct matching
 */
const PROCESSED_XML_COMPRESSION_LEVEL = 0;
const UNCHANGED_XML_COMPRESSION_LEVEL = 0;

/**
 * Lossless cleanup of authoring noise that bloats document.xml without
 * affecting rendering or merge logic. Mirrors the cleanup applied at upload
 * time, but runs at generation time too so already-uploaded large templates
 * (e.g. RE851D V12.x ~4.4MB) stay within the Edge Function CPU budget.
 *
 * Removes:
 *   - <mc:Fallback>...</mc:Fallback> blocks (legacy VML duplicates of
 *     modern DrawingML in mc:AlternateContent — Word renders mc:Choice).
 *   - <mc:AlternateContent> wrappers when only mc:Choice remains.
 *   - All w:rsid* attributes (Word revision-save IDs).
 *   - <w:proofErr .../> spell/grammar markers.
 *   - <w:lastRenderedPageBreak/> hints (recomputed by Word on open).
 *   - _GoBack proof bookmarks.
 *
 * Paragraphs, runs, tables, sections, styles, SDTs, drawings, hyperlinks,
 * and merge tags are preserved unchanged.
 */
function stripAuthoringNoise(xml: string): string {
  let out = xml.replace(/<mc:Fallback\b[^>]*>[\s\S]*?<\/mc:Fallback>/g, "");

  let prev: string;
  let safety = 0;
  do {
    prev = out;
    out = out.replace(
      /<mc:AlternateContent[^>]*>\s*<mc:Choice\b[^>]*>([\s\S]*?)<\/mc:Choice>\s*<\/mc:AlternateContent>/g,
      "$1",
    );
    safety++;
  } while (out !== prev && safety < 8);

  out = out.replace(/\s+w:rsid[A-Za-z]*="[0-9A-Fa-f]+"/g, "");
  out = out.replace(/<w:proofErr\b[^/>]*\/>/g, "");
  out = out.replace(/<w:lastRenderedPageBreak\s*\/>/g, "");
  out = out.replace(
    /<w:bookmarkStart\b[^/>]*w:name="_GoBack"[^/>]*\/>/g,
    "",
  );

  return out;
}

function hasLikelyMergeWork(xml: string, labelMap: Record<string, LabelMapping>): boolean {
  if (
    xml.includes("{{") ||
    xml.includes("}}") ||
    xml.includes("«") ||
    xml.includes("»") ||
    xml.includes("MERGEFIELD") ||
    xml.includes("w:fldChar") ||
    xml.includes("w:fldSimple") ||
    xml.includes("w:instrText") ||
    (xml.includes("<w14:checkbox") && xml.includes("<w:sdt"))
  ) {
    return true;
  }

  if (Object.keys(labelMap).length === 0) {
    return false;
  }

  const xmlLower = xml.toLowerCase();
  return Object.entries(labelMap).some(([label, mapping]) => {
    const quickNeedle = (mapping.replaceNext || (label === "as of _"
      ? "as of"
      : label.endsWith(":")
        ? label.slice(0, -1)
        : label)).toLowerCase();
    return quickNeedle.length > 0 && xmlLower.includes(quickNeedle);
  });
}

const W14_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';

function setParagraphJustification(para: string, value: string): string {
  if (/<w:jc\b[^>]*\/>/.test(para)) {
    return para.replace(/<w:jc\b[^>]*\/>/, `<w:jc w:val="${value}"/>`);
  }
  const pPrOpen = para.match(/<w:pPr\b[^>]*>/);
  if (pPrOpen) {
    return para.replace(pPrOpen[0], `${pPrOpen[0]}<w:jc w:val="${value}"/>`);
  }
  return para.replace(/<w:p\b([^>]*)>/, `<w:p$1><w:pPr><w:jc w:val="${value}"/></w:pPr>`);
}

function normalizeRe885OtherLienAmountCells(xml: string): string {
  if (!xml.includes("pr_p_currentBalanc") && !xml.includes("li_lt_anticipatedAmount")) return xml;
  return xml.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (cell) => {
    if (!cell.includes("pr_p_currentBalanc") && !cell.includes("li_lt_anticipatedAmount")) return cell;
    return cell.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (para) => setParagraphJustification(para, "center"));
  });
}

/**
 * If the processed XML contains any w14:* token (typically introduced by
 * convertGlyphsToSdtCheckboxes injecting <w14:checkbox> blocks) but the
 * part's root element does not declare the w14 namespace, inject the
 * declaration into the root opening tag. Without this, Google Docs and
 * strict XML parsers reject the file as namespace-invalid even though
 * Word's tolerant parser may still open it.
 *
 * This is a localized string edit on the root opening tag only — it does
 * NOT change content, formatting, layout, or template structure.
 */
function ensureW14Namespace(xml: string, partName: string): string {
  // Quick exit: no w14: usage means no injection needed.
  if (!/(<|\s)w14:/.test(xml)) return xml;

  // Determine root element name for this part.
  let rootName: string | null = null;
  if (partName === 'word/document.xml') rootName = 'w:document';
  else if (partName.startsWith('word/header')) rootName = 'w:hdr';
  else if (partName.startsWith('word/footer')) rootName = 'w:ftr';
  else if (partName.startsWith('word/footnotes')) rootName = 'w:footnotes';
  else if (partName.startsWith('word/endnotes')) rootName = 'w:endnotes';
  if (!rootName) return xml;

  // Match the root opening tag (first occurrence).
  const rootOpenRegex = new RegExp(`<${rootName.replace(':', '\\:')}\\b([^>]*)>`);
  const match = xml.match(rootOpenRegex);
  if (!match) return xml;

  const attrs = match[1] || '';
  // If w14 already declared, no-op.
  if (/\bxmlns:w14\s*=/.test(attrs)) return xml;

  // Inject xmlns:w14 (and add w14 to mc:Ignorable if present so older
  // readers ignore the new prefix gracefully).
  let newAttrs = attrs + ` xmlns:w14="${W14_NS}"`;
  const ignorableMatch = newAttrs.match(/\bmc:Ignorable\s*=\s*"([^"]*)"/);
  if (ignorableMatch) {
    const tokens = ignorableMatch[1].split(/\s+/).filter(Boolean);
    if (!tokens.includes('w14')) {
      tokens.push('w14');
      newAttrs = newAttrs.replace(
        /\bmc:Ignorable\s*=\s*"[^"]*"/,
        `mc:Ignorable="${tokens.join(' ')}"`
      );
    }
  }

  return xml.replace(rootOpenRegex, `<${rootName}${newAttrs}>`);
}

export async function processDocx(
  docxBuffer: Uint8Array,
  fieldValues: Map<string, FieldValueData>,
  fieldTransforms: Map<string, string>,
  mergeTagMap: Record<string, string>,
  labelMap: Record<string, LabelMapping>,
  validFieldKeys?: Set<string>,
  options: DocxProcessingOptions = {},
): Promise<Uint8Array> {
  // Detailed per-stage timing — printed at end so production logs always
  // show the breakdown for the slowest templates (e.g. RE885 / HUD-1).
  const t0 = performance.now();
  const templateName = options.templateName || "DOCX";
  const is885 = /885/i.test(templateName);
  const partTimings: Array<{ part: string; bytes: number; replaceMs: number; w14Ms: number; sigMs: number }> = [];

  const decompressed = fflate.unzipSync(docxBuffer);
  const tUnzip = performance.now();
  const processedFiles: fflate.Zippable = {};
  const decoder = new TextDecoder("utf-8");
  const encoder = new TextEncoder();

  for (const [filename, content] of Object.entries(decompressed)) {
    if (filename.endsWith(".xml") || filename.endsWith(".rels")) {
      // Only run merge tag replacement on content-bearing XML parts.
      // Processing styles, numbering, settings, themes, etc. risks corrupting
      // their XML structure (no merge tags exist there anyway).
      const isContentPart = filename === "word/document.xml" ||
        filename.startsWith("word/header") ||
        filename.startsWith("word/footer") ||
        filename.startsWith("word/footnotes") ||
        filename.startsWith("word/endnotes");

      if (isContentPart) {
        debugLog(`[docx-processor] Processing content XML: ${filename} (${content.length} bytes)`);
        const decodedXml = decoder.decode(content);

        // Defensive cleanup for large content parts: strip authoring noise
        // (mc:Fallback duplicates, rsids, proofErr, lastRenderedPageBreak)
        // before any regex pass runs. Only applied when the part exceeds
        // ~1MB so small templates pay no measurable cost.
        let originalXml = decodedXml;
        if (decodedXml.length > 1_000_000) {
          const tClean = performance.now();
          const cleaned = stripAuthoringNoise(decodedXml);
          if (cleaned.length < decodedXml.length) {
            originalXml = cleaned;
            console.log(
              `[docx-processor] stripped authoring noise from ${filename}: ${decodedXml.length}B -> ${cleaned.length}B in ${Math.round(performance.now() - tClean)}ms`,
            );
          }
        }

        const inputXml = is885 && filename === "word/document.xml"
          ? normalizeRe885OtherLienAmountCells(originalXml)
          : originalXml;

        if (!hasLikelyMergeWork(inputXml, labelMap)) {
          processedFiles[filename] = [content, { level: UNCHANGED_XML_COMPRESSION_LEVEL }];
          continue;
        }

        const tPartStart = performance.now();
        let processedXml = replaceMergeTags(inputXml, fieldValues, fieldTransforms, mergeTagMap, labelMap, validFieldKeys, options.templateName);
        const tAfterReplace = performance.now();

        // If the post-pass injected w14:* (e.g. <w14:checkbox>) into a part
        // whose root does not declare the w14 namespace, inject the
        // declaration. Required for Google Docs / strict parsers to open.
        processedXml = ensureW14Namespace(processedXml, filename);
        const tAfterW14 = performance.now();

        // Post-process: ensure Signature paragraph has a page break before it,
        // but ONLY if the original template already contains page breaks or section
        // breaks. Single-page templates (like Addendum to LPDS) must not have
        // page breaks injected, as that would push content to a second page.
        if (filename === "word/document.xml") {
          const hasExistingPageBreaks = originalXml.includes('w:pageBreakBefore') ||
            originalXml.includes('<w:br w:type="page"') ||
            originalXml.includes('w:type="nextPage"') ||
            originalXml.includes('w:type="oddPage"') ||
            originalXml.includes('w:type="evenPage"');
          if (hasExistingPageBreaks) {
            processedXml = ensureSignaturePageBreak(processedXml);
          } else {
            debugLog("[docx-processor] Skipping signature page-break injection (single-page template — no existing page breaks).");
          }
        }
        const tAfterSig = performance.now();

        partTimings.push({
          part: filename,
          bytes: content.length,
          replaceMs: Math.round(tAfterReplace - tPartStart),
          w14Ms: Math.round(tAfterW14 - tAfterReplace),
          sigMs: Math.round(tAfterSig - tAfterW14),
        });

        if (processedXml === originalXml) {
          processedFiles[filename] = [content, { level: UNCHANGED_XML_COMPRESSION_LEVEL }];
        } else {
          processedFiles[filename] = [encoder.encode(processedXml), { level: PROCESSED_XML_COMPRESSION_LEVEL }];
        }
      } else {
        // Non-content XML: preserve original bytes with minimal recompression to reduce CPU time
        processedFiles[filename] = [content, { level: UNCHANGED_XML_COMPRESSION_LEVEL }];
      }
    } else {
      // Binary files: store without recompression to preserve exact bytes
      processedFiles[filename] = [content, { level: 0 }];
    }
  }
  const tAfterParts = performance.now();

  const compressed = fflate.zipSync(processedFiles);
  const tAfterZip = performance.now();

  // Per-stage timing summary. Highlights the slowest XML part so future
  // CPU-budget regressions are immediately visible in production logs.
  try {
    const slowest = partTimings.length > 0
      ? partTimings.reduce((a, b) => (a.replaceMs > b.replaceMs ? a : b))
      : null;
    const totalReplaceMs = partTimings.reduce((s, p) => s + p.replaceMs, 0);
    console.log(
      `[docx-processor] timings: unzip=${Math.round(tUnzip - t0)}ms ` +
      `partsTotal=${Math.round(tAfterParts - tUnzip)}ms ` +
      `(replaceMs=${totalReplaceMs} across ${partTimings.length} parts) ` +
      `zip=${Math.round(tAfterZip - tAfterParts)}ms` +
      (slowest ? ` slowestPart=${slowest.part} (${slowest.bytes}B, replace=${slowest.replaceMs}ms)` : "")
    );
    if (is885) {
      console.log(
        `[885] DOCX Render: ${Math.round(tAfterParts - tUnzip)} ms ` +
        `(replace=${totalReplaceMs} ms, parts=${partTimings.length}` +
        (slowest ? `, slowest=${slowest.part}:${slowest.replaceMs} ms` : "") +
        `)`
      );
    }
  } catch { /* never fail generation on logging */ }


  // Defensive integrity check. Validate the XML strings we already produced
  // BEFORE zipping, instead of unzipping the freshly compressed output again.
  // The previous "verify by unzip" path held a second full copy of every
  // content-bearing part in memory simultaneously with the zipped buffer,
  // which on 5-property RE851D documents (~4MB document.xml) was enough to
  // trip the edge function's memory limit. Validating the source strings is
  // equivalent for the integrity properties we care about (well-formed root,
  // tag balance, no stray placeholder markers, w14 namespace declared).
  try {
    const verifyDecoder = new TextDecoder("utf-8");
    const getPartXml = (partName: string): string | null => {
      const entry = (processedFiles as Record<string, unknown>)[partName];
      if (!entry) return null;
      const bytes = Array.isArray(entry)
        ? (entry as [Uint8Array, unknown])[0]
        : (entry as Uint8Array);
      if (!bytes || bytes.length === 0) return null;
      return verifyDecoder.decode(bytes);
    };

    if (!getPartXml("word/document.xml")) {
      throw new Error("DOCX_INTEGRITY: word/document.xml missing from generated package");
    }

    const contentPartNames = Object.keys(processedFiles).filter((filename) =>
      (filename === "word/document.xml" ||
        filename.startsWith("word/header") ||
        filename.startsWith("word/footer") ||
        filename.startsWith("word/footnotes") ||
        filename.startsWith("word/endnotes")) &&
      filename.endsWith(".xml")
    );

    for (const partName of contentPartNames) {
      const xml = getPartXml(partName);
      if (!xml) continue;
      validateContentXmlPart(partName, xml);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.startsWith("DOCX_INTEGRITY")) {
      throw new Error(`DOCX_INTEGRITY: ${message}`);
    }
    throw err;
  }

  return compressed;
}

/**
 * Validate a single content XML part for the structural properties that,
 * when violated, cause Word/Google Docs to refuse opening the .docx file.
 * Throws an Error prefixed with "DOCX_INTEGRITY:" on any failure.
 *
 * Exported so post-render mutation passes (e.g. RE851D safety passes that
 * run AFTER processDocx returns) can re-validate the final XML before the
 * file is uploaded — otherwise mutations made after processDocx's internal
 * check could ship a corrupted document marked as a successful generation.
 */
export function validateContentXmlPart(partName: string, xml: string): void {
  const trimmed = xml.trim();

  if (!trimmed.startsWith("<?xml")) {
    throw new Error(`DOCX_INTEGRITY: ${partName} does not start with <?xml prolog`);
  }

  let rootClose: string | null = null;
  if (partName === "word/document.xml") rootClose = "</w:document>";
  else if (partName.startsWith("word/header")) rootClose = "</w:hdr>";
  else if (partName.startsWith("word/footer")) rootClose = "</w:ftr>";
  else if (partName.startsWith("word/footnotes")) rootClose = "</w:footnotes>";
  else if (partName.startsWith("word/endnotes")) rootClose = "</w:endnotes>";

  if (rootClose && !trimmed.endsWith(rootClose)) {
    throw new Error(`DOCX_INTEGRITY: ${partName} is truncated (missing ${rootClose})`);
  }

  try {
    const parsed = new DOMParser().parseFromString(trimmed, "application/xml");
    const parserError = parsed.getElementsByTagName("parsererror")[0];
    if (parserError) {
      const message = parserError.textContent?.replace(/\s+/g, " ").trim() || "XML parse error";
      throw new Error(message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`DOCX_INTEGRITY: ${partName} is not well-formed XML (${message})`);
  }

  const countOpens = (s: string, tag: string) => {
    const re = new RegExp(`<${tag}(\\s[^>]*[^/])?>`, 'g');
    return (s.match(re) || []).length;
  };
  const countCloses = (s: string, tag: string) =>
    (s.match(new RegExp(`</${tag}>`, 'g')) || []).length;

  // Expanded balance check: include table & SDT structural tags whose
  // imbalance is the most common cause of "Xml parsing error" in
  // post-render-mutated RE851D documents.
  for (const tag of ['w:p', 'w:r', 'w:t', 'w:tc', 'w:tr', 'w:tbl', 'w:sdt']) {
    const opens = countOpens(xml, tag);
    const closes = countCloses(xml, tag);
    if (opens !== closes) {
      // Locate first imbalance: walk the XML and find the position where
      // open/close counts diverge so logs include actionable context.
      let openSoFar = 0;
      let closeSoFar = 0;
      const openRe = new RegExp(`<${tag}(\\s[^>]*[^/])?>`, 'g');
      const closeRe = new RegExp(`</${tag}>`, 'g');
      let firstSuspect = -1;
      const events: Array<{ pos: number; kind: 'open' | 'close' }> = [];
      let m: RegExpExecArray | null;
      while ((m = openRe.exec(xml)) !== null) events.push({ pos: m.index, kind: 'open' });
      while ((m = closeRe.exec(xml)) !== null) events.push({ pos: m.index, kind: 'close' });
      events.sort((a, b) => a.pos - b.pos);
      for (const ev of events) {
        if (ev.kind === 'open') openSoFar++;
        else closeSoFar++;
        if (closeSoFar > openSoFar && firstSuspect === -1) {
          firstSuspect = ev.pos;
          break;
        }
      }
      if (firstSuspect !== -1) {
        const sliceStart = Math.max(0, firstSuspect - 200);
        const sliceEnd = Math.min(xml.length, firstSuspect + 200);
        console.error(
          `[docx-processor] DOCX_INTEGRITY context for <${tag}> in ${partName} ` +
            `at offset ${firstSuspect}: …${xml.slice(sliceStart, sliceEnd)}…`,
        );
      }
      throw new Error(
        `DOCX_INTEGRITY: ${partName} has unbalanced <${tag}> tags (open=${opens}, close=${closes})`
      );
    }
  }

  if (xml.includes('\uFFFD')) {
    throw new Error(`DOCX_INTEGRITY: ${partName} contains stray U+FFFD replacement char`);
  }
  if (xml.includes('_SDT_PLACEHOLDER_')) {
    throw new Error(`DOCX_INTEGRITY: ${partName} contains unrestored SDT placeholder marker`);
  }

  if (/(<|\s)w14:/.test(xml)) {
    let rootOpenRegex: RegExp | null = null;
    if (partName === "word/document.xml") rootOpenRegex = /<w:document\b([^>]*)>/;
    else if (partName.startsWith("word/header")) rootOpenRegex = /<w:hdr\b([^>]*)>/;
    else if (partName.startsWith("word/footer")) rootOpenRegex = /<w:ftr\b([^>]*)>/;
    else if (partName.startsWith("word/footnotes")) rootOpenRegex = /<w:footnotes\b([^>]*)>/;
    else if (partName.startsWith("word/endnotes")) rootOpenRegex = /<w:endnotes\b([^>]*)>/;

    if (rootOpenRegex) {
      const m = xml.match(rootOpenRegex);
      if (!m || !/\bxmlns:w14\s*=/.test(m[1] || '')) {
        throw new Error(
          `DOCX_INTEGRITY: ${partName} uses w14:* but root element is missing xmlns:w14 declaration`
        );
      }
    }
  }
}

export function repairOrphanedSdtOpen(xml: string): { xml: string; repaired: number } {
  const openRe = /<w:sdt\b[^>]*>/g;
  const closeRe = /<\/w:sdt>/g;
  const events: Array<{ pos: number; end: number; kind: 'open' | 'close' }> = [];
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(xml)) !== null) events.push({ pos: m.index, end: m.index + m[0].length, kind: 'open' });
  while ((m = closeRe.exec(xml)) !== null) events.push({ pos: m.index, end: m.index + m[0].length, kind: 'close' });
  events.sort((a, b) => a.pos - b.pos);
  const stack: Array<{ pos: number; end: number }> = [];
  for (const ev of events) {
    if (ev.kind === 'open') stack.push({ pos: ev.pos, end: ev.end });
    else stack.pop();
  }
  if (stack.length !== 1) return { xml, repaired: 0 };
  const orphan = stack[0];
  const nextStructural = xml.slice(orphan.end, orphan.end + 400);
  if (!/^\s*(?:<w:sdtPr\b|<w:sdtContent\b)/.test(nextStructural)) return { xml, repaired: 0 };
  return { xml: xml.slice(0, orphan.pos) + xml.slice(orphan.end), repaired: 1 };
}

/**
 * OOXML requires every <w:tc> (table cell) to contain at least one <w:p>.
 * Post-render safety passes can splice runs in/out and occasionally leave
 * a cell without a paragraph; insert an empty <w:p/> so Word can open the
 * file. Returns the (possibly modified) XML and the number of repairs.
 */
export function repairTableCellParagraphs(xml: string): { xml: string; repaired: number } {
  let repaired = 0;
  const out = xml.replace(/<w:tc(\s[^>]*)?>([\s\S]*?)<\/w:tc>/g, (full, _attrs, inner) => {
    if (/<w:p[\s>\/]/.test(inner)) return full;
    repaired++;
    return full.replace(/<\/w:tc>$/, '<w:p/></w:tc>');
  });
  return { xml: out, repaired };
}

function processWordParagraphs(xml: string, fn: (para: string) => string): string {
  const chunks: string[] = [];
  let pos = 0;

  while (pos < xml.length) {
    const pStart = xml.indexOf("<w:p", pos);
    if (pStart === -1) {
      chunks.push(xml.substring(pos));
      break;
    }

    if (pStart > pos) {
      chunks.push(xml.substring(pos, pStart));
    }

    const pEnd = xml.indexOf("</w:p>", pStart);
    if (pEnd === -1) {
      chunks.push(xml.substring(pStart));
      break;
    }

    const paraEnd = pEnd + 6;
    const para = xml.substring(pStart, paraEnd);
    chunks.push(fn(para));
    pos = paraEnd;
  }

  return chunks.join("");
}

/**
 * Ensure the paragraph containing "Signature:" + underscores always starts on a new page.
 * Injects <w:pageBreakBefore w:val="1"/> into its <w:pPr> block if not already present.
 */
function ensureSignaturePageBreak(xml: string): string {
  let foundSignatureParagraph = false;
  let injectedPageBreak = false;

  const updatedXml = processWordParagraphs(xml, (para) => {
    if (foundSignatureParagraph) return para;
    if (!para.includes("Signature") || !para.includes("_")) return para;

    const textOnly = para.replace(/<[^>]*>/g, "");
    if (!textOnly.includes("Signature:") || !textOnly.includes("_")) {
      return para;
    }

    foundSignatureParagraph = true;

    if (para.includes("w:pageBreakBefore")) {
      return para;
    }

    injectedPageBreak = true;

    const pPrMatch = para.match(/(<w:pPr\b[^>]*>)/);
    if (pPrMatch) {
      return para.replace(
        pPrMatch[1],
        pPrMatch[1] + '<w:pageBreakBefore w:val="1"/>'
      );
    }

    return para.replace(
      /(<w:p\b[^>]*>)/,
      '$1<w:pPr><w:pageBreakBefore w:val="1"/></w:pPr>'
    );
  });

  if (!foundSignatureParagraph) {
    debugLog("[docx-processor] No Signature paragraph found; skipping page-break injection.");
  } else if (injectedPageBreak) {
    debugLog("[docx-processor] Injected pageBreakBefore into Signature paragraph.");
  } else {
    debugLog("[docx-processor] Signature paragraph already has pageBreakBefore.");
  }

  return updatedXml;
}

/**
 * Extract XML content from a DOCX file without processing
 * Useful for validation and tag extraction
 */
export function extractDocxXml(docxBuffer: Uint8Array): Map<string, string> {
  const decompressed = fflate.unzipSync(docxBuffer);
  const xmlContents = new Map<string, string>();
  const decoder = new TextDecoder("utf-8");

  for (const [filename, content] of Object.entries(decompressed)) {
    if (filename.endsWith(".xml") || filename.endsWith(".rels")) {
      xmlContents.set(filename, decoder.decode(content));
    }
  }

  return xmlContents;
}

/**
 * Get the main document XML from a DOCX file
 */
export function getMainDocumentXml(docxBuffer: Uint8Array): string | null {
  const xmlContents = extractDocxXml(docxBuffer);
  
  // The main document is typically at word/document.xml
  return xmlContents.get("word/document.xml") || null;
}
