/** Split an array into fixed-size chunks for batched DB/API operations. */
export function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize < 1) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}
