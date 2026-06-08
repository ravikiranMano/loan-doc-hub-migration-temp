import { NotFoundException } from '@nestjs/common';

/** Throw a consistent NotFoundException when an entity lookup returns null/undefined. */
export function assertFound<T>(
  entity: T | null | undefined,
  label: string,
  id: string,
): T {
  if (entity == null) {
    throw new NotFoundException(`${label} '${id}' not found`);
  }
  return entity;
}
