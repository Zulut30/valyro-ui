/*
 * Arithmetic of Priority Budget. Every value is converted to whole steps first (a step of 0.5 becomes one unit), so
 * the sums never drift from rounding, and the redistribution is the same for the same input and action.
 */

export type BudgetMode = 'pool' | 'redistribute';

export interface BudgetLimits {
  id: string;
  min: number;
  max: number;
}

export type BudgetConfigError =
  | { code: 'step' }
  | { code: 'total' }
  | { code: 'duplicate'; id: string }
  | { code: 'range'; id: string }
  | { code: 'multiple'; id: string }
  | { code: 'missing'; id: string }
  | { code: 'outOfRange'; id: string }
  | { code: 'overTotal' }
  | { code: 'notTotal' }
  | { code: 'unreachable' };

const decimals = (value: number) => {
  const text = String(value);
  if (text.includes('e-')) return Number(text.split('e-')[1]);
  return text.includes('.') ? text.split('.')[1].length : 0;
};

/** Converts between values and whole units of the step's decimal precision. */
export function budgetScale(step: number) {
  const scale = 10 ** Math.min(decimals(step), 9);
  const toUnits = (value: number) => Math.round(value * scale);
  const fromUnits = (units: number) => units / scale;
  return { scale, stepUnits: toUnits(step), toUnits, fromUnits };
}

/** What is wrong with a budget profile, or an empty list. The component shows these, it never repairs them. */
export function budgetErrors(
  items: readonly BudgetLimits[],
  total: number,
  step: number,
  mode: BudgetMode,
  values: Readonly<Record<string, number>>,
): BudgetConfigError[] {
  if (!(Number.isFinite(step) && step > 0)) return [{ code: 'step' }];
  const { toUnits, stepUnits, scale } = budgetScale(step);
  const multiple = (value: number) => Number.isFinite(value) && Math.abs(value * scale - toUnits(value)) < 1e-6 && toUnits(value) % stepUnits === 0;
  const errors: BudgetConfigError[] = [];
  if (!(total >= 0) || !multiple(total)) errors.push({ code: 'total' });
  const seen = new Set<string>();
  let sumMin = 0;
  let sumMax = 0;
  let sum = 0;
  for (const item of items) {
    if (seen.has(item.id)) {
      errors.push({ code: 'duplicate', id: item.id });
      continue;
    }
    seen.add(item.id);
    if (!(item.min <= item.max)) errors.push({ code: 'range', id: item.id });
    else if (!multiple(item.min) || !multiple(item.max)) errors.push({ code: 'multiple', id: item.id });
    sumMin += toUnits(item.min);
    sumMax += toUnits(item.max);
    const value = values[item.id];
    if (value === undefined || !Number.isFinite(value)) {
      errors.push({ code: 'missing', id: item.id });
      continue;
    }
    if (!multiple(value)) errors.push({ code: 'multiple', id: item.id });
    else if (value < item.min || value > item.max) errors.push({ code: 'outOfRange', id: item.id });
    sum += toUnits(value);
  }
  if (errors.length) return errors;
  const totalUnits = toUnits(total);
  if (sumMin > totalUnits || (mode === 'redistribute' && sumMax < totalUnits)) return [{ code: 'unreachable' }];
  if (mode === 'pool' && sum > totalUnits) return [{ code: 'overTotal' }];
  if (mode === 'redistribute' && sum !== totalUnits) return [{ code: 'notTotal' }];
  return [];
}

export interface BudgetChange {
  values: Record<string, number>;
  /** The change actually applied to the item, after its own range and what the others could give or take. */
  applied: number;
  /** True when the requested value could not be reached in full. */
  limited: boolean;
}

/**
 * Sets `id` to `requested` (snapped to the step, clamped to its range):
 *   pool          the change comes out of, or goes back to, the free remainder; the others stay;
 *   redistribute  the others pay for it, evenly in whole steps among the unlocked ones with room, the leftover
 *                 steps going to them in item order; whatever no one can absorb is not applied.
 * A locked item does not move. Values of items not in `items` are carried over untouched.
 */
export function changeBudget(
  items: readonly BudgetLimits[],
  total: number,
  step: number,
  mode: BudgetMode,
  values: Readonly<Record<string, number>>,
  locked: readonly string[],
  id: string,
  requested: number,
): BudgetChange {
  const { toUnits, fromUnits, stepUnits } = budgetScale(step);
  const item = items.find((entry) => entry.id === id);
  const unchanged = { values: { ...values }, applied: 0, limited: true };
  if (!item || locked.includes(id) || !Number.isFinite(requested)) return unchanged;

  const units = Object.fromEntries(items.map((entry) => [entry.id, toUnits(values[entry.id] ?? entry.min)]));
  const lo = toUnits(item.min);
  const hi = toUnits(item.max);
  const snapped = Math.round(toUnits(requested) / stepUnits) * stepUnits;
  const target = Math.min(hi, Math.max(lo, snapped));
  let delta = target - units[id];

  if (mode === 'pool') {
    const used = items.reduce((sum, entry) => sum + units[entry.id], 0);
    const free = toUnits(total) - used;
    if (delta > 0) delta = Math.min(delta, Math.max(0, free));
    units[id] += delta;
  } else {
    // The others move the opposite way: down to their minimum when this one grows, up to their maximum when it shrinks.
    const others = items.filter((entry) => entry.id !== id && !locked.includes(entry.id));
    const room = (entry: BudgetLimits) => (delta > 0 ? units[entry.id] - toUnits(entry.min) : toUnits(entry.max) - units[entry.id]);
    const capacity = others.reduce((sum, entry) => sum + Math.max(0, room(entry)), 0);
    const steps = Math.floor(Math.min(Math.abs(delta), capacity) / stepUnits);
    delta = Math.sign(delta) * steps * stepUnits;
    let left = steps;
    while (left > 0) {
      const open = others.filter((entry) => room(entry) >= stepUnits);
      if (!open.length) break;
      const share = Math.floor(left / open.length);
      const round = left;
      for (const [index, entry] of open.entries()) {
        const take = Math.min(share || (index < round ? 1 : 0), Math.floor(room(entry) / stepUnits));
        if (take <= 0) continue;
        units[entry.id] += (delta > 0 ? -1 : 1) * take * stepUnits;
        left -= take;
        if (left <= 0) break;
      }
    }
    units[id] += delta;
  }

  const next: Record<string, number> = { ...values };
  for (const entry of items) next[entry.id] = fromUnits(units[entry.id]);
  const applied = fromUnits(delta);
  return { values: next, applied, limited: units[id] !== target };
}

/** Sum of the items' values, in whole units then back, so 0.1 + 0.2 stays 0.3. */
export function budgetSum(items: readonly BudgetLimits[], values: Readonly<Record<string, number>>, step: number) {
  const { toUnits, fromUnits } = budgetScale(step);
  return fromUnits(items.reduce((sum, entry) => sum + toUnits(values[entry.id] ?? 0), 0));
}
