import { DEFAULT_SEARCH_LIMIT } from '../constants/limits.constants';

/** Parse a comma-separated query param into a trimmed, non-empty string array. */
export function parseCommaSeparated(value?: string): string[] | undefined {
  if (!value?.trim()) return undefined;
  const items = value.split(',').map((s) => s.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

/** Parse an optional positive integer query param; returns undefined for missing/invalid values. */
export function parseOptionalPositiveInt(value?: string): number | undefined {
  if (value == null || value === '') return undefined;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return n;
}

/** Parse optional page + limit (or pageSize alias) from query strings. */
export function parsePaginationQuery(
  page?: string,
  limit?: string,
  pageSize?: string,
): { page?: number; limit?: number } {
  return {
    page: parseOptionalPositiveInt(page),
    limit: parseOptionalPositiveInt(limit ?? pageSize),
  };
}

/** Parse search/browse limit with a centralized default. */
export function parseSearchLimit(
  value?: string,
  defaultLimit: number = DEFAULT_SEARCH_LIMIT,
): number {
  return parseOptionalPositiveInt(value) ?? defaultLimit;
}
