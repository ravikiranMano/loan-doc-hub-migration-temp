import { supabase } from '@/services/supabase/client';

const PAGE_SIZE = 1000;

/**
 * Fetches all rows from a Supabase table, paginating in batches of 1,000
 * to work around PostgREST's max-rows limit.
 */
export async function fetchAllRows<T = unknown>(
  buildQuery: (client: typeof supabase) => { range: (from: number, to: number) => Promise<{ data: unknown; error: unknown }> }
): Promise<T[]> {
  const allRows: T[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await buildQuery(supabase).range(from, to);

    if (error) throw error;

    const rows = (data || []) as T[];
    allRows.push(...rows);

    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return allRows;
}
