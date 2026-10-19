/**
 * Pure layout math behind ResizablePanels. A layout is one size per panel, in percent of
 * the group's free space (the group minus its handles); a valid layout sums to 100.
 */

export interface PanelConstraints {
  /** Size before any interaction; panels without one share what the others leave. */
  defaultSize?: number;
  minSize: number;
  maxSize: number;
  collapsible: boolean;
  /** Size of a collapsed panel; below `minSize`. */
  collapsedSize: number;
}

/** A panel limit: percent of the group's free space, or pixels as a `'240px'` string. */
export type PanelSize = number | `${number}px`;

export const isPixelSize = (size: PanelSize | undefined): size is `${number}px` => typeof size === 'string';

/**
 * Percent that `size` stands for when the panels share `free` pixels. A pixel size needs a measured group:
 * until then (`free` ≤ 0), or when it doesn't parse, it resolves to undefined so the default limit applies.
 */
export function resolvePanelSize(size: PanelSize | undefined, free: number): number | undefined {
  if (!isPixelSize(size)) return size;
  const px = parseFloat(size);
  return Number.isFinite(px) && free > 0 ? (px / free) * 100 : undefined;
}

const EPSILON = 1e-6;

export const fuzzyEqual = (a: number, b: number, epsilon = EPSILON) => Math.abs(a - b) < epsilon;

export function layoutsEqual(a: readonly number[], b: readonly number[]) {
  return a.length === b.length && a.every((size, i) => fuzzyEqual(size, b[i]));
}

const sum = (sizes: readonly number[]) => sizes.reduce((total, size) => total + size, 0);
const clampSize = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Fills defaults and orders the limits: 0 ≤ collapsedSize ≤ minSize ≤ maxSize ≤ 100. */
export function normalizeConstraints(input: Partial<PanelConstraints>): PanelConstraints {
  const minSize = clampSize(input.minSize ?? 0, 0, 100);
  const maxSize = clampSize(input.maxSize ?? 100, minSize, 100);
  return {
    defaultSize: input.defaultSize,
    minSize,
    maxSize,
    collapsible: !!input.collapsible,
    collapsedSize: clampSize(input.collapsedSize ?? 0, 0, minSize),
  };
}

export function isCollapsed(size: number, constraints: PanelConstraints) {
  return constraints.collapsible && constraints.collapsedSize < constraints.minSize && fuzzyEqual(size, constraints.collapsedSize);
}

/** Smallest size the panel can take: its collapsed size when collapsible. */
export function lowestSize(constraints: PanelConstraints) {
  return constraints.collapsible ? constraints.collapsedSize : constraints.minSize;
}

/**
 * The size a panel settles at when asked for `size`: within its limits, and a collapsible
 * panel below its minimum snaps closed past the halfway point, open before it.
 */
export function constrainSize(size: number, constraints: PanelConstraints): number {
  const { minSize, maxSize, collapsible, collapsedSize } = constraints;
  if (size < minSize - EPSILON) {
    if (!collapsible) return minSize;
    return size < (collapsedSize + minSize) / 2 ? collapsedSize : minSize;
  }
  return Math.min(size, maxSize);
}

/**
 * Turns any list of sizes into a valid layout: missing or broken values become 0, the total
 * is scaled to 100, every size is constrained, and the rounding remainder goes to panels in
 * order (open ones first, so collapsed panels stay collapsed when possible).
 */
export function validateLayout(sizes: readonly number[], constraints: readonly PanelConstraints[]): number[] {
  const n = constraints.length;
  if (n === 0) return [];
  let next = constraints.map((_, i) => {
    const size = sizes[i];
    return Number.isFinite(size) && size > 0 ? size : 0;
  });
  const total = sum(next);
  if (total <= 0) next = next.map(() => 100 / n);
  else if (!fuzzyEqual(total, 100)) next = next.map((size) => (size * 100) / total);
  next = next.map((size, i) => constrainSize(size, constraints[i]));

  let remainder = 100 - sum(next);
  for (const includeCollapsed of [false, true]) {
    for (let i = 0; i < n && !fuzzyEqual(remainder, 0); i++) {
      const c = constraints[i];
      if (!includeCollapsed && isCollapsed(next[i], c)) continue;
      const size = clampSize(next[i] + remainder, c.minSize, c.maxSize);
      remainder -= size - next[i];
      next[i] = size;
    }
  }
  return next;
}

/** Layout from the panels' `defaultSize`s; panels without one split the rest evenly. */
export function defaultLayout(constraints: readonly PanelConstraints[]): number[] {
  const known = sum(constraints.map((c) => c.defaultSize ?? 0));
  const unknown = constraints.filter((c) => c.defaultSize === undefined).length;
  const share = unknown ? Math.max(0, 100 - known) / unknown : 0;
  return validateLayout(
    constraints.map((c) => c.defaultSize ?? share),
    constraints,
  );
}

export interface ResizeOptions {
  /**
   * Keyboard steps and imperative calls: a collapsed neighbour opens to at least its minimum
   * and one at its minimum closes, instead of waiting for the halfway point of a drag.
   */
  discrete?: boolean;
}

/**
 * Moves the handle between panels `pivot` and `pivot + 1` by `delta` percent (positive grows
 * the panel before it). The shrinking side gives up space nearest panel first, cascading to
 * the next one at its minimum; the growing side takes it the same way, but only the nearest
 * panel may open from collapsed. Returns `base` itself when nothing can move.
 */
export function resizeLayout(
  base: readonly number[],
  constraints: readonly PanelConstraints[],
  pivot: number,
  delta: number,
  { discrete = false }: ResizeOptions = {},
): number[] {
  const n = base.length;
  if (pivot < 0 || pivot >= n - 1 || !Number.isFinite(delta) || fuzzyEqual(delta, 0)) return base as number[];

  const before = Array.from({ length: pivot + 1 }, (_, k) => pivot - k);
  const after = Array.from({ length: n - pivot - 1 }, (_, k) => pivot + 1 + k);
  const [grow, shrink] = delta > 0 ? [before, after] : [after, before];
  let amount = Math.abs(delta);

  const nearestGrow = constraints[grow[0]];
  if (isCollapsed(base[grow[0]], nearestGrow)) {
    const gap = nearestGrow.minSize - base[grow[0]];
    if (!discrete && amount < gap / 2) return base as number[];
    amount = Math.max(amount, gap);
  }
  const nearestShrink = constraints[shrink[0]];
  if (discrete && nearestShrink.collapsible && fuzzyEqual(base[shrink[0]], nearestShrink.minSize)) {
    amount = Math.max(amount, base[shrink[0]] - nearestShrink.collapsedSize);
  }

  // What the growing side can absorb; collapsed panels past the nearest one stay closed.
  const capacity = sum(
    grow.map((i, k) => (k > 0 && isCollapsed(base[i], constraints[i]) ? 0 : constraints[i].maxSize - base[i])),
  );
  amount = Math.min(amount, capacity);
  if (amount <= EPSILON) return base as number[];

  const next = base.slice();
  let taken = 0;
  for (const i of shrink) {
    const want = amount - taken;
    if (want <= EPSILON) break;
    const c = constraints[i];
    let size = Math.min(base[i], constrainSize(base[i] - want, c));
    // Snapping closed would free more than the other side can take: stop at the minimum.
    if (base[i] - size > capacity - taken + EPSILON) size = Math.min(base[i], Math.max(c.minSize, base[i] - (capacity - taken)));
    taken += base[i] - size;
    next[i] = size;
  }
  if (taken <= EPSILON) return base as number[];

  let given = 0;
  for (let k = 0; k < grow.length; k++) {
    const want = taken - given;
    if (want <= EPSILON) break;
    const i = grow[k];
    const c = constraints[i];
    if (k > 0 && isCollapsed(base[i], c)) continue;
    const size = Math.min(c.maxSize, base[i] + want);
    // The nearest panel is collapsed and the other side could not free enough to open it.
    if (size < c.minSize - EPSILON) return base as number[];
    given += size - base[i];
    next[i] = size;
  }
  return fuzzyEqual(given, taken) ? next : (base as number[]);
}

/** Sets panel `index` to `size` by moving its handle (the one after it, or before the last panel). */
export function resizePanel(
  layout: readonly number[],
  constraints: readonly PanelConstraints[],
  index: number,
  size: number,
  options?: ResizeOptions,
): number[] {
  const delta = size - layout[index];
  return index < layout.length - 1
    ? resizeLayout(layout, constraints, index, delta, options)
    : resizeLayout(layout, constraints, index - 1, -delta, options);
}

/* ── Persistence (autoSaveId) ── */

export interface LayoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const storageKey = (autoSaveId: string) => `ui-resizable-panels:${autoSaveId}`;

/**
 * The layout saved for this set of panels, or null. One storage entry per `autoSaveId` keeps
 * a layout for every panel combination (`panelKey`), so conditional panels restore correctly.
 * Throws when storage is unavailable or holds invalid JSON.
 */
export function readSavedLayout(storage: LayoutStorage, autoSaveId: string, panelKey: string, count: number): number[] | null {
  const raw = storage.getItem(storageKey(autoSaveId));
  if (!raw) return null;
  const saved: unknown = JSON.parse(raw);
  if (!saved || typeof saved !== 'object') return null;
  const sizes = (saved as Record<string, unknown>)[panelKey];
  if (!Array.isArray(sizes) || sizes.length !== count || !sizes.every((s) => typeof s === 'number' && Number.isFinite(s))) {
    return null;
  }
  return sizes;
}

/** Stores `sizes` for `panelKey`, keeping the layouts of other panel combinations. Throws like storage does. */
export function writeSavedLayout(storage: LayoutStorage, autoSaveId: string, panelKey: string, sizes: readonly number[]) {
  const key = storageKey(autoSaveId);
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed as Record<string, unknown>;
  } catch {
    // Corrupt JSON was already reported when restoring (readSavedLayout throws); this write replaces it.
    saved = {};
  }
  saved[panelKey] = sizes.map((size) => Math.round(size * 1000) / 1000);
  storage.setItem(key, JSON.stringify(saved));
}
