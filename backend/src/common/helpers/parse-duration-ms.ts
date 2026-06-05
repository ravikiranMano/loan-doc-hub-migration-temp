/** Parse JWT-style duration strings (e.g. 15m, 1h, 7d) to milliseconds. */
export function parseDurationMs(value: string, fallbackMs: number): number {
  const trimmed = value?.trim();
  if (!trimmed) return fallbackMs;

  const match = /^(\d+)(s|m|h|d)$/i.exec(trimmed);
  if (!match) return fallbackMs;

  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return amount * multipliers[unit];
}
