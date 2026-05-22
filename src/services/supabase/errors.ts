import type { PostgrestError } from '@supabase/supabase-js';

export class SupabaseServiceError extends Error {
  constructor(
    message: string,
    public readonly cause?: PostgrestError | Error
  ) {
    super(message);
    this.name = 'SupabaseServiceError';
  }
}

export function assertOk<T>(result: { data: T; error: PostgrestError | null }): T {
  if (result.error) {
    throw new SupabaseServiceError(result.error.message, result.error);
  }
  return result.data;
}

export function assertOkNullable<T>(result: {
  data: T | null;
  error: PostgrestError | null;
}): T | null {
  if (result.error) {
    throw new SupabaseServiceError(result.error.message, result.error);
  }
  return result.data;
}
