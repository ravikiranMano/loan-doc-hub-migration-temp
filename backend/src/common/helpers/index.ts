import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from '../constants';

export function paginate(page = 1, pageSize = DEFAULT_PAGE_SIZE) {
  const normalizedPage = Math.max(1, page);
  const take = Math.min(Math.max(pageSize, MIN_PAGE_SIZE), MAX_PAGE_SIZE);
  const skip = (normalizedPage - 1) * take;
  return { take, skip };
}

export function formatPaginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number,
) {
  return {
    data,
    meta: {
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      hasNextPage: page * pageSize < total,
      hasPreviousPage: page > 1,
    },
  };
}

export function buildOrderBy(
  sortBy: string | undefined,
  sortOrder: 'asc' | 'desc' = 'desc',
): Record<string, 'asc' | 'desc'> {
  if (!sortBy) return { created_at: 'desc' };
  return { [sortBy]: sortOrder };
}
