/*
 * Which snapshot Version Scrubber shows, by id: a reorder keeps it, a removal follows a documented rule.
 */

export interface ResolvedVersion {
  /** Index in the current list, or -1. */
  index: number;
  /** The controlled id is not in the list: shown as an error until the app passes a valid one. */
  invalid: boolean;
}

/**
 * The selected id in `ids`. A controlled id that disappeared is an error (the app decides); an uncontrolled one falls
 * back to the first remaining snapshot. An empty list selects nothing and is not an error.
 */
export function resolveVersion(ids: readonly string[], value: string | undefined, controlled: boolean): ResolvedVersion {
  if (ids.length === 0) return { index: -1, invalid: false };
  const index = value === undefined ? -1 : ids.indexOf(value);
  if (index >= 0) return { index, invalid: false };
  return controlled ? { index: -1, invalid: true } : { index: 0, invalid: false };
}

/** Indexes worth loading around `index`: itself and its neighbours, never the whole list. */
export function neighbourIndexes(index: number, count: number, radius = 1): number[] {
  const out: number[] = [];
  if (index < 0) return out;
  for (let i = Math.max(0, index - radius); i <= Math.min(count - 1, index + radius); i++) out.push(i);
  return out;
}

/** Up to `limit` evenly spread tick indexes, always the first and the last. */
export function tickIndexes(count: number, limit = 12): number[] {
  if (count <= 0) return [];
  if (count <= limit) return Array.from({ length: count }, (_, i) => i);
  const out = new Set<number>();
  for (let k = 0; k < limit; k++) out.add(Math.round((k * (count - 1)) / (limit - 1)));
  return [...out];
}
