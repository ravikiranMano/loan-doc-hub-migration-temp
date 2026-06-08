import PizZip from 'pizzip';

const WORD_XML_PART = /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/;
const CHECKBOX_GLYPHS = '\u2610\u2611\u2612';

function processParaByPara(xml: string, fn: (para: string) => string): string {
  const chunks: string[] = [];
  let pos = 0;

  while (pos < xml.length) {
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

    if (pStart > pos) chunks.push(xml.substring(pos, pStart));

    const pEnd = xml.indexOf('</w:p>', pStart);
    if (pEnd === -1) {
      chunks.push(xml.substring(pStart));
      break;
    }

    const paraEnd = pEnd + 6;
    chunks.push(fn(xml.substring(pStart, paraEnd)));
    pos = paraEnd;
  }

  return chunks.join('');
}

function hasFragmentedMergeTagCandidates(xml: string): boolean {
  const hasXmlInside = (open: string, close: string, maxSpan: number): boolean => {
    let start = xml.indexOf(open);
    while (start !== -1) {
      const end = xml.indexOf(close, start + open.length);
      if (end === -1) return false;
      const innerStart = start + open.length;
      if (end - start <= maxSpan && xml.indexOf('<', innerStart) !== -1 && xml.indexOf('<', innerStart) < end) {
        return true;
      }
      start = xml.indexOf(open, end + close.length);
    }
    return false;
  };

  return (
    hasXmlInside('{{', '}}', 800) ||
    hasXmlInside('\u00AB', '\u00BB', 500) ||
    /\{(?:\s|<[^>]+>)+\{/.test(xml) ||
    /\}(?:\s|<[^>]+>)+\}/.test(xml)
  );
}

function consolidateFragmentedTagsInParagraphs(xml: string): string {
  return processParaByPara(xml, (para) => {
    if (!para.includes('{') && !para.includes('\u00AB')) return para;

    const tTexts: string[] = [];
    para.replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g, (_, text: string) => {
      tTexts.push(text);
      return '';
    });

    if (tTexts.length < 2) return para;

    const joined = tTexts.join('');
    const tagPattern = /\{\{[^{}]+\}\}|\u00AB[A-Za-z0-9_.]+\u00BB/g;
    const joinedTags = joined.match(tagPattern) ?? [];
    if (joinedTags.length === 0) return para;

    const allComplete = joinedTags.every((tag) => tTexts.some((t) => t.includes(tag)));
    if (allComplete) return para;

    let isFirst = true;
    return para.replace(/<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g, (_match, attrs: string | undefined) => {
      if (isFirst) {
        isFirst = false;
        return `<w:t xml:space="preserve">${joined}</w:t>`;
      }
      return `<w:t${attrs ?? ''}></w:t>`;
    });
  });
}

/** Paragraph-scoped tag alignment (ported from edge tag-parser fragmentation suite). */
function alignParagraphTags(para: string): string {
  if (!para.includes('{') && !para.includes('\u00AB') && !para.includes('instrText')) return para;
  if (!para.includes('instrText') && !hasFragmentedMergeTagCandidates(para)) return para;

  let p = para;

  const fragmentedPattern = /«((?:<(?!\/w:p>|w:p[\s>\/])[^>]*>|\s)*?)([A-Za-z0-9_.]+)((?:<(?!\/w:p>|w:p[\s>\/])[^>]*>|\s)*?)»/g;
  p = p.replace(fragmentedPattern, (_m, _pre, fieldName: string) => `«${fieldName}»`);

  p = p.replace(/«((?:\s*<\/w:t>\s*<\/w:r>\s*<w:r(?:[^>]*)>\s*<w:t(?:[^>]*)>)+)/g, () => '«');
  p = p.replace(/((?:\s*<\/w:t>\s*<\/w:r>\s*<w:r(?:[^>]*)>\s*<w:t(?:[^>]*)>)+)»/g, () => '»');

  const splitOpenBraces =
    /\{((?:\s*<\/w:t>\s*<\/w:r>\s*<w:r[^>]*>(?:\s*<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<w:t[^>]*>)+)\{/g;
  p = p.replace(splitOpenBraces, (match, runBreak: string) => {
    if (/<\/w:p>/.test(runBreak) || /<w:p[\s>]/.test(runBreak)) return match;
    if (/<w:t[^>]*>[^<]*[A-Za-z0-9$#@!%^&*][^<]*<\/w:t>/.test(runBreak)) return match;
    return '{{';
  });

  const splitCloseBraces =
    /\}((?:\s*<\/w:t>\s*<\/w:r>\s*<w:r[^>]*>(?:\s*<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<w:t[^>]*>)+)\}/g;
  p = p.replace(splitCloseBraces, (match, runBreak: string) => {
    if (/<\/w:p>/.test(runBreak) || /<w:p[\s>]/.test(runBreak)) return match;
    if (/<w:t[^>]*>[^<]*[A-Za-z0-9$#@!%^&*][^<]*<\/w:t>/.test(runBreak)) return match;
    return '}}';
  });

  const curlyFragmentedPattern = /\{\{((?:[A-Za-z0-9_.|()= '"\/#^]|&quot;|<(?!\/w:p>|w:p[\s>\/])[^>]*>|\s)*?)\}\}/g;
  p = p.replace(curlyFragmentedPattern, (match, innerContent: string) => {
    const cleanText = innerContent.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (!cleanText) return match;
    if (/^#/.test(cleanText) || cleanText === 'else' || cleanText.startsWith('/')) return match;

    const pipeIdx = cleanText.indexOf('|');
    if (pipeIdx > 0) {
      const fieldName = cleanText.substring(0, pipeIdx).replace(/\s/g, '');
      const transform = cleanText.substring(pipeIdx + 1).replace(/\s/g, '');
      if (/^[A-Za-z0-9_.]+$/.test(fieldName) && /^[A-Za-z0-9_]+$/.test(transform)) {
        return innerContent.includes('<') ? `{{${fieldName}|${transform}}}` : match;
      }
    }

    const compact = cleanText.replace(/\s+/g, '');
    if (/^[A-Za-z0-9_.]+$/.test(compact)) {
      return innerContent.includes('<') ? `{{${compact}}}` : match;
    }

    return match;
  });

  const checkboxIfElsePattern = new RegExp(
    '\\{\\{(?:<[^>]*>|\\s)*?#if(?:<[^>]*>|\\s)+([A-Za-z0-9_.]+)(?:<[^>]*>|\\s)*?\\}\\}' +
      '([\\s\\S]*?)([' +
      CHECKBOX_GLYPHS +
      '])([\\s\\S]*?)' +
      '\\{\\{(?:<[^>]*>|\\s)*?else(?:<[^>]*>|\\s)*?\\}\\}' +
      '([\\s\\S]*?)([' +
      CHECKBOX_GLYPHS +
      '])([\\s\\S]*?)' +
      '\\{\\{(?:<[^>]*>|\\s)*?\\/(?:<[^>]*>|\\s)*?if(?:<[^>]*>|\\s)*?\\}\\}',
    'g',
  );
  p = p.replace(checkboxIfElsePattern, (match, fieldName: string, midA: string, glyphTrue: string, midB: string, midC: string, glyphFalse: string, midD: string) => {
    if (/<\/w:p>|<w:p[\s>\/]/.test(match)) return match;
    const controlTagRe = /\{\{\s*(?:#if\b|#unless\b|#each\b|else\b|\/if\b|\/unless\b|\/each\b)/;
    const extraGlyphRe = new RegExp(`[${CHECKBOX_GLYPHS}]`);
    for (const seg of [midA, midB, midC, midD]) {
      const segNoXml = String(seg ?? '').replace(/<[^>]*>/g, '');
      if (controlTagRe.test(segNoXml)) return match;
      if (extraGlyphRe.test(segNoXml)) return match;
    }
    return `{{#if ${fieldName}}}${glyphTrue}{{else}}${glyphFalse}{{/if}}`;
  });

  const checkboxFallbackPattern = new RegExp(
    '\\{\\{\\s*#if\\s+([A-Za-z0-9_.]+)\\s*\\}\\}' +
      '((?:(?!\\{\\{)[\\s\\S])*?)([' +
      CHECKBOX_GLYPHS +
      '])((?:(?!\\{\\{)[\\s\\S])*?)' +
      '\\{\\{\\s*else\\s*\\}\\}' +
      '((?:(?!\\{\\{)[\\s\\S])*?)([' +
      CHECKBOX_GLYPHS +
      '])((?:(?!\\{\\{)[\\s\\S])*?)' +
      '\\{\\{\\s*\\/if\\s*\\}\\}',
    'g',
  );
  p = p.replace(checkboxFallbackPattern, (match, fieldName: string, _a: string, glyphTrue: string, _b: string, _c: string, glyphFalse: string) => {
    if (/<\/w:p>|<w:p[\s>\/]/.test(match)) return match;
    return `{{#if ${fieldName}}}${glyphTrue}{{else}}${glyphFalse}{{/if}}`;
  });

  {
    const Q = `(?:&quot;|"|'|[\\u201C\\u201D\\u2018\\u2019])`;
    const eqIfFragmented = new RegExp(
      '\\{\\{(?:<[^>]*>|\\s)*?#(if|unless)(?:<[^>]*>|\\s)+\\((?:<[^>]*>|\\s)*(eq|ne)(?:<[^>]*>|\\s)+' +
        '([A-Za-z0-9_.]+)(?:<[^>]*>|\\s)+' +
        Q +
        '([^<&"\'\\u201C\\u201D\\u2018\\u2019]*)' +
        Q +
        '(?:<[^>]*>|\\s)*\\)(?:<[^>]*>|\\s)*\\}\\}',
      'g',
    );
    p = p.replace(eqIfFragmented, (match, kind: string, op: string, field: string, lit: string) => {
      if (!match.includes('<')) return match;
      if (/<\/w:p>|<w:p[\s>\/]/.test(match)) return match;
      return `{{#${kind} (${op} ${field} "${lit}")}}`;
    });
  }

  const ifFragmented = /\{\{((?:<[^>]*>|\s)*?)#if\s*((?:<[^>]*>|\s)*?)([A-Za-z0-9_.]+)((?:<[^>]*>|\s)*?)\}\}/g;
  p = p.replace(ifFragmented, (_m, _pre, _mid, fieldName: string) => `{{#if ${fieldName}}}`);

  p = p.replace(/\{\{#if((?:<[^>]*>|\s)+)([A-Za-z0-9_.]+)((?:<[^>]*>|\s)*)\}\}/g, (_m, _mid, fieldName: string) => `{{#if ${fieldName}}}`);

  const unlessFragmented = /\{\{((?:<[^>]*>|\s)*?)#unless\s*((?:<[^>]*>|\s)*?)([A-Za-z0-9_.]+)((?:<[^>]*>|\s)*?)\}\}/g;
  p = p.replace(unlessFragmented, (_m, _pre, _mid, fieldName: string) => `{{#unless ${fieldName}}}`);

  p = p.replace(/\{\{#unless((?:<[^>]*>|\s)+)([A-Za-z0-9_.]+)((?:<[^>]*>|\s)*)\}\}/g, (_m, _mid, fieldName: string) => `{{#unless ${fieldName}}}`);

  p = p.replace(/\{\{((?:<[^>]*>|\s)*?)\/((?:<[^>]*>|\s)*?)if((?:<[^>]*>|\s)*?)\}\}/g, () => '{{/if}}');
  p = p.replace(/\{\{((?:<[^>]*>|\s)*?)\/((?:<[^>]*>|\s)*?)unless((?:<[^>]*>|\s)*?)\}\}/g, () => '{{/unless}}');
  p = p.replace(/\{\{((?:<[^>]*>|\s)*?)else((?:<[^>]*>|\s)*?)\}\}/g, () => '{{else}}');
  p = p.replace(/\{\{((?:<[^>]*>|\s)+)else((?:<[^>]*>|\s)*)\}\}/g, () => '{{else}}');

  const eachFragmented = /\{\{((?:<[^>]*>|\s)*?)#each\s*((?:<[^>]*>|\s)*?)([A-Za-z0-9_.]+)((?:<[^>]*>|\s)*?)\}\}/g;
  p = p.replace(eachFragmented, (_m, _pre, _mid, collectionName: string) => `{{#each ${collectionName}}}`);

  p = p.replace(/\{\{((?:<[^>]*>|\s)*?)\/((?:<[^>]*>|\s)*?)each((?:<[^>]*>|\s)*?)\}\}/g, () => '{{/each}}');

  return p;
}

/** Merge split Word runs and consolidate fragmented tags for docxtemplater. */
export function mergeSplitRuns(xml: string): string {
  let result = processParaByPara(xml, alignParagraphTags);
  if (hasFragmentedMergeTagCandidates(result)) {
    result = consolidateFragmentedTagsInParagraphs(result);
  }
  return result;
}

export function trimTagSpaces(text: string): string {
  return text
    .replace(/\{\{\s+/g, '{{')
    .replace(/\s+\}\}/g, '}}')
    .replace(/\{\{#\s+/g, '{{#')
    .replace(/\{\{\^\s+/g, '{{^')
    .replace(/\{\{\/\s+/g, '{{/');
}

function normalizeQuotes(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
}

/** RE851A encumbrance tags: {{pr_li_rem_priority_{N}_{S}}} → {{pr_li_rem_priority_1_1}} by document order. */
function resolveLienPlaceholderTags(xml: string): string {
  const FIELD_BASES = [
    'priority',
    'interestRate', 'interest_rate', 'intRate',
    'beneficiary', 'lienHolder', 'holder',
    'originalAmount', 'principalBalance', 'monthlyPayment',
    'maturityDate', 'maturity_date', 'matDate',
    'balloonAmount', 'balloonYes', 'balloonNo', 'balloonUnknown',
    'amountOwing', 'amount_owing', 'amount', 'owing',
  ].sort((a, b) => b.length - a.length);

  const fieldAlt = FIELD_BASES.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const token = `pr_li_(rem|ant)_(${fieldAlt})_\\{[PN]\\}_\\{S\\}`;
  const tokenProp = `pr_li_(rem|ant)_(${fieldAlt})_\\{[PN]\\}(?!_\\{S\\})`;

  const P = 1;
  const slotCounter = new Map<string, number>();
  const nextSlot = (fam: string, base: string): number => {
    const k = `${P}|${fam}|${base}`;
    const n = (slotCounter.get(k) ?? 0) + 1;
    slotCounter.set(k, n);
    return n;
  };

  const rewriteJoined = (joined: string): string => {
    if (!joined.includes('{N}') && !joined.includes('{P}') && !joined.includes('{S}')) return joined;

    let out = joined;
    const replaceToken = (fam: string, base: string): string => {
      const s = nextSlot(fam, base);
      return `{{pr_li_${fam}_${base}_${P}_${s}}}`;
    };

    out = out.replace(new RegExp(`\\$?\\{\\{\\s*${token}\\s*\\}\\}`, 'g'), (_m, fam: string, base: string) => replaceToken(fam, base));
    out = out.replace(new RegExp(`\\$?\\{\\{\\s*${token}`, 'g'), (_m, fam: string, base: string) => replaceToken(fam, base));
    out = out.replace(new RegExp(`${token}\\s*\\}\\}`, 'g'), (_m, fam: string, base: string) => replaceToken(fam, base));
    out = out.replace(new RegExp(`${token}`, 'g'), (_m, fam: string, base: string) => replaceToken(fam, base));
    out = out.replace(new RegExp(`\\$?\\{\\{\\s*${tokenProp}\\s*\\}\\}`, 'g'), (_m, fam: string, base: string) => `{{pr_li_${fam}_${base}_${P}}}`);
    out = out.replace(new RegExp(`${tokenProp}`, 'g'), (_m, fam: string, base: string) => `{{pr_li_${fam}_${base}_${P}}}`);

    out = out.replace(/\$\{\{/g, '${{');
    out = out.replace(/\{\{\s*\{\{/g, '{{');
    out = out.replace(/\}\}\s*\}\}/g, '}}');
    out = out.replace(/\}\}\}/g, '}}');
    return out;
  };

  return processParaByPara(xml, (para) => {
    if (!para.includes('{N}') && !para.includes('{P}') && !para.includes('{S}')) return para;

    const tTexts: string[] = [];
    para.replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g, (_, text: string) => {
      tTexts.push(text);
      return '';
    });

    const joined = tTexts.join('');
    const rewritten = rewriteJoined(joined);
    if (rewritten === joined) return para;

    let isFirst = true;
    return para.replace(/<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g, (_match, attrs: string | undefined) => {
      if (isFirst) {
        isFirst = false;
        return `<w:t xml:space="preserve">${rewritten}</w:t>`;
      }
      return `<w:t${attrs ?? ''}></w:t>`;
    });
  });
}

/** RE851A / RE851D alignment fixes applied at template conversion time. */
function applyRe851AlignmentFixes(text: string): string {
  let out = text;
  out = out.replace(
    /\(\s*eq\s+(pr_p_occupanc(?:_(?:N|[1-5]))?)\s*"\s*Owner\s*"\s*\)/gi,
    '(eq $1 "Owner Occupied")',
  );
  out = out.replace(
    /(\(\s*(?:eq|ne)\s+pr_p_perform(?:e|ed)By(?:_(?:N|[1-5]))?)\s*"\s*([^"<]*?)\s*"\s*\)/gi,
    '$1 "$2")',
  );
  out = out.replace(/\{\{\/if\}(?!\})/g, '{{/if}}');
  out = out.replace(/\{\{\/unless\}(?!\})/g, '{{/unless}}');
  return out;
}

export function convertV1Conditionals(text: string): string {
  let out = normalizeQuotes(text);

  // {{#if (or (eq field "A") (eq field "B"))}} → {{#field == 'A' || field == 'B'}}
  out = out.replace(
    /\{\{#if\s+\(or\s+\(eq\s+([A-Za-z0-9_.]+)\s+"([^"]*)"\)\s+\(eq\s+\1\s+"([^"]*)"\)\)\s*\}\}/g,
    "{{#$1 == '$2' || $1 == '$3'}}",
  );
  out = out.replace(
    /\{\{#if\s+\(or\s+\(eq\s+([A-Za-z0-9_.]+)\s+'([^']*)'\)\s+\(eq\s+\1\s+'([^']*)'\)\)\s*\}\}/g,
    "{{#$1 == '$2' || $1 == '$3'}}",
  );

  out = out.replace(
    /\{\{#if\s+\(eq\s+([A-Za-z0-9_.]+)\s+"([^"]*)"\)\s*\}\}/g,
    "{{#$1 == '$2'}}",
  );
  out = out.replace(
    /\{\{#if\s+\(eq\s+([A-Za-z0-9_.]+)\s+'([^']*)'\)\s*\}\}/g,
    "{{#$1 == '$2'}}",
  );

  out = out.replace(/\{\{#unless\s+([A-Za-z0-9_.]+)\s*\}\}/g, '{{^$1}}');
  out = out.replace(/\{\{#each\s+([A-Za-z0-9_.]+)\s*\}\}/g, '{{#$1}}');
  out = out.replace(/\{\{#if\s+([A-Za-z0-9_.]+)\s*\}\}/g, '{{#$1}}');
  out = out.replace(/\{\{else\}\}/g, '{{__V2_ELSE__}}');
  out = closeIfBlocks(out);

  return out;
}

function closeIfBlocks(text: string): string {
  const stack: string[] = [];
  let result = '';
  let lastIndex = 0;
  const tagRe = /\{\{(#|\^|\/|__V2_ELSE__)([^}]*)\}\}/g;
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(text)) !== null) {
    result += text.slice(lastIndex, m.index);
    const kind = m[1];
    const inner = m[2].trim();

    if (kind === '#') {
      stack.push(inner);
      result += `{{#${inner}}}`;
    } else if (kind === '^') {
      stack.push(inner);
      result += `{{^${inner}}}`;
    } else if (kind === '__V2_ELSE__') {
      const open = stack.pop();
      if (open) {
        result += `{{/${open}}}{{^${open}}}`;
        stack.push(open);
      } else {
        result += '{{else}}';
      }
    } else if (kind === '/') {
      const open = stack.pop();
      result += open ? `{{/${open}}}` : '{{/}}';
    }
    lastIndex = tagRe.lastIndex;
  }
  result += text.slice(lastIndex);
  return result;
}

export function convertXmlPart(xml: string): string {
  let out = mergeSplitRuns(xml);
  out = resolveLienPlaceholderTags(out);
  out = applyRe851AlignmentFixes(out);
  out = trimTagSpaces(out);
  out = convertV1Conditionals(out);
  return out;
}

export function convertDocxBuffer(input: Buffer): Buffer {
  const zip = new PizZip(input);
  for (const name of Object.keys(zip.files)) {
    if (!WORD_XML_PART.test(name)) continue;
    const file = zip.file(name);
    if (!file) continue;
    zip.file(name, convertXmlPart(file.asText()));
  }
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
}

export function extractMergeTagsFromXml(xml: string): string[] {
  const merged = mergeSplitRuns(xml);
  const tags = new Set<string>();
  const re = /\{\{([#/^]?)([^}]+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(merged)) !== null) {
    const prefix = m[1];
    const body = m[2].trim();
    if (!body || body === 'else') continue;
    if (prefix === '#' || prefix === '^' || prefix === '/') tags.add(body);
    else if (/^[A-Za-z][A-Za-z0-9_.]*$/.test(body)) tags.add(body);
    else if (body.includes('==') || body.includes('||')) tags.add(body);
  }
  return [...tags].sort();
}

export function inspectDocxParse(buffer: Buffer): { ok: boolean; errors: string[]; tagCount: number } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const inspectFactory = require('docxtemplater/js/inspect-module.js') as
      | (() => { getAllTags(): Record<string, unknown> })
      | { default?: () => { getAllTags(): Record<string, unknown> } };
    const factory =
      typeof inspectFactory === 'function'
        ? inspectFactory
        : typeof inspectFactory?.default === 'function'
          ? inspectFactory.default
          : null;
    if (!factory) return { ok: false, errors: ['inspect-module load failed'], tagCount: 0 };

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const expressionParser = require('docxtemplater/expressions.js') as {
      configure: (o: object) => (tag: string) => unknown;
    };

    const inspectModule = factory();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Docxtemplater = require('docxtemplater').default ?? require('docxtemplater');

    new Docxtemplater(new PizZip(buffer), {
      modules: [inspectModule],
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '{{', end: '}}' },
      parser: expressionParser.configure({ filters: {} }),
    });

    const tree = inspectModule.getAllTags();
    return { ok: true, errors: [], tagCount: flattenTagTree(tree).length };
  } catch (err: unknown) {
    return { ok: false, errors: extractDocxtemplaterErrors(err), tagCount: 0 };
  }
}

function flattenTagTree(tree: Record<string, unknown>, out: string[] = []): string[] {
  for (const [key, val] of Object.entries(tree)) {
    const k = key.trim();
    if (k) out.push(k);
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      flattenTagTree(val as Record<string, unknown>, out);
    }
  }
  return out;
}

function extractDocxtemplaterErrors(err: unknown): string[] {
  if (!err || typeof err !== 'object') return [String(err)];
  const e = err as Record<string, unknown>;
  const props = e.properties as Record<string, unknown> | undefined;
  const errors = props?.errors;
  if (Array.isArray(errors) && errors.length) {
    return errors.map((sub: unknown) => {
      if (!sub || typeof sub !== 'object') return String(sub);
      const s = sub as Record<string, unknown>;
      const sp = s.properties as Record<string, unknown> | undefined;
      return String(sp?.explanation ?? s.message ?? sub);
    });
  }
  return [String(e.message ?? err)];
}
