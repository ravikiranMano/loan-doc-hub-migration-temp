/** Parsed from docxtemplater InspectModule getAllTags() tree keys. */
export interface TemplateConditionInfo {
  /** Raw section expression, e.g. `ld_p_lenderType == 'Individual'`. */
  expression: string;
  /** Primary field used in the condition, when parseable. */
  driverField: string | null;
  operator: string | null;
  compareValue: string | null;
  /** Merge field keys nested under this condition in the tag tree. */
  fieldKeys: string[];
  /** Filled on inspect API from deal data (not from DOCX). */
  driverValue?: string;
  driverResolved?: boolean;
  /** Whether driverValue satisfies operator/compareValue on this deal. */
  matchesCompare?: boolean;
}

export interface TemplateInspectResult {
  mergeFieldKeys: string[];
  conditions: TemplateConditionInfo[];
  tagTree: Record<string, unknown>;
}

const MERGE_FIELD_KEY = /^[A-Za-z][A-Za-z0-9_.]*$/;

/** Simple placeholder keys only (excludes `#if`, section expressions, etc.). */
export function isMergeFieldKey(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed === 'else' || trimmed === '/if') return false;
  return MERGE_FIELD_KEY.test(trimmed);
}

/** Section/condition keys from getAllTags (expressions, loops). */
export function isConditionExpression(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed || isMergeFieldKey(trimmed)) return false;
  return true;
}

export function parseConditionExpression(expression: string): Pick<
  TemplateConditionInfo,
  'driverField' | 'operator' | 'compareValue'
> {
  const expr = normalizeSectionKey(expression);
  const quoted = expr.match(
    /^([A-Za-z][A-Za-z0-9_.]*)\s*(===|!==|==|!=)\s*'([^']*)'\s*$/,
  );
  if (quoted) {
    return { driverField: quoted[1], operator: quoted[2], compareValue: quoted[3] };
  }
  const doubleQuoted = expr.match(
    /^([A-Za-z][A-Za-z0-9_.]*)\s*(===|!==|==|!=)\s*"([^"]*)"\s*$/,
  );
  if (doubleQuoted) {
    return { driverField: doubleQuoted[1], operator: doubleQuoted[2], compareValue: doubleQuoted[3] };
  }
  const bare = expr.match(/^([A-Za-z][A-Za-z0-9_.]*)\s*$/);
  if (bare) {
    return { driverField: bare[1], operator: null, compareValue: null };
  }
  return { driverField: null, operator: null, compareValue: null };
}

function isNestedTagContainer(value: unknown): value is Record<string, unknown> {
  return (
    value != null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length > 0
  );
}

/** Strip docxtemplater section prefix (# loop, ^ inverted). */
function normalizeSectionKey(key: string): string {
  return key.trim().replace(/^[#^]/, '');
}

function collectMergeKeysUnder(node: Record<string, unknown>, out: Set<string>): void {
  for (const [key, value] of Object.entries(node)) {
    const trimmed = key.trim();
    const isNestedContainer = isNestedTagContainer(value);
    // Loop/section parents (e.g. `properties` under {{#properties}}) are containers, not merge keys.
    if (isMergeFieldKey(trimmed) && !isNestedContainer) out.add(trimmed);
    if (isNestedContainer) {
      collectMergeKeysUnder(value, out);
    }
  }
}

/** Walk getAllTags() tree and build condition rows from non-merge parent keys. */
export function extractConditionsFromTagTree(
  tagTree: Record<string, unknown>,
): TemplateConditionInfo[] {
  const byExpression = new Map<string, Set<string>>();

  const registerSection = (expression: string, value: Record<string, unknown>) => {
    const fields = new Set<string>();
    collectMergeKeysUnder(value, fields);
    const existing = byExpression.get(expression) ?? new Set<string>();
    fields.forEach((f) => existing.add(f));
    byExpression.set(expression, existing);
  };

  const walk = (node: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(node)) {
      const trimmed = key.trim();
      const loopKey = normalizeSectionKey(trimmed);

      if (isNestedTagContainer(value) && isMergeFieldKey(loopKey)) {
        // {{#properties}} — driver name is a valid identifier but has nested merge keys.
        registerSection(loopKey, value);
        walk(value);
        continue;
      }

      if (!isConditionExpression(key)) {
        if (isNestedTagContainer(value)) walk(value);
        continue;
      }
      const expr = trimmed;
      if (isNestedTagContainer(value)) {
        registerSection(expr, value);
      }
    }
  };

  walk(tagTree);

  return [...byExpression.entries()]
    .map(([expression, fieldSet]) => {
      const parsed = parseConditionExpression(expression);
      return {
        expression,
        ...parsed,
        fieldKeys: [...fieldSet].sort(),
      };
    })
    .sort((a, b) => a.expression.localeCompare(b.expression));
}

export function collectMergeFieldKeys(tagTree: Record<string, unknown>): string[] {
  const out = new Set<string>();
  collectMergeKeysUnder(tagTree, out);
  return [...out].sort();
}

export function buildTemplateInspectResult(tagTree: Record<string, unknown>): TemplateInspectResult {
  return {
    tagTree,
    mergeFieldKeys: collectMergeFieldKeys(tagTree),
    conditions: extractConditionsFromTagTree(tagTree),
  };
}
