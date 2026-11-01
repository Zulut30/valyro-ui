/*
 * Compare Tray: the selection rules shared by the tray and the catalog buttons, and how a field value is shown.
 */

export type CompareToggleResult = 'added' | 'removed' | 'limit';

/**
 * Adds or removes `id` in a compare selection. A repeated id never makes a copy; at `maxItems` a new id is refused
 * (nothing already picked is replaced). Returns a new array; ids already repeated in the input are folded to their
 * first occurrence.
 */
export function toggleCompare(selected: readonly string[], id: string, maxItems = 3): { ids: string[]; result: CompareToggleResult } {
  const current = [...new Set(selected)];
  if (current.includes(id)) return { ids: current.filter((x) => x !== id), result: 'removed' };
  if (current.length >= maxItems) return { ids: current, result: 'limit' };
  return { ids: [...current, id], result: 'added' };
}

export interface CompareFieldLike {
  unit?: string;
}

/**
 * Text of one value: null or undefined (and an empty string) is missing — the caller shows “No data” — while 0 and
 * false are real values. A unit is appended after a space. Strings with units ("10 GB") are shown as they are, never
 * compared as numbers.
 */
export function compareCell(value: unknown, field: CompareFieldLike, locale?: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  let text: string;
  if (typeof value === 'number') text = Number.isFinite(value) ? value.toLocaleString(locale) : String(value);
  else if (typeof value === 'boolean') text = value ? '✓' : '✕';
  else text = String(value);
  return field.unit ? `${text} ${field.unit}` : text;
}

/**
 * The chips to show: the previous order, keeping the ids that are leaving (`leaving`) where they were so they can fold
 * away in place, then the ids that are new, in the order of `next`.
 */
export function mergeShown(prev: readonly string[], next: readonly string[], leaving: ReadonlySet<string>): string[] {
  const keep = new Set(next);
  const shown = prev.filter((id) => keep.has(id) || leaving.has(id));
  for (const id of next) if (!shown.includes(id)) shown.push(id);
  return shown;
}
