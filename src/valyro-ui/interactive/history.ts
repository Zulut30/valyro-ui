/*
 * Undo/redo stacks of whole snapshots, for the editors of the interactive blocks (Gradient Mixer, Pixel Painter,
 * Sticker Board). Pure: every call returns new stacks, nothing is mutated.
 */

export interface History<T> {
  /** Older snapshots, the most recent last. */
  past: T[];
  /** Undone snapshots, the next one to redo last. */
  future: T[];
}

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [] });

/** Records `previous` as one action before a change: keeps at most `limit` entries and drops the redo stack. */
export function record<T>(history: History<T>, previous: T, limit: number): History<T> {
  const max = Math.max(0, Math.floor(limit));
  if (max === 0) return emptyHistory();
  return { past: [...history.past, previous].slice(-max), future: [] };
}

/** One step back from `current`, or null at the start of the history. */
export function undo<T>(history: History<T>, current: T): { history: History<T>; value: T } | null {
  if (!history.past.length) return null;
  const value = history.past[history.past.length - 1];
  return { value, history: { past: history.past.slice(0, -1), future: [...history.future, current] } };
}

/** One step forward from `current`, or null at the end of the history. */
export function redo<T>(history: History<T>, current: T): { history: History<T>; value: T } | null {
  if (!history.future.length) return null;
  const value = history.future[history.future.length - 1];
  return { value, history: { past: [...history.past, current], future: history.future.slice(0, -1) } };
}
