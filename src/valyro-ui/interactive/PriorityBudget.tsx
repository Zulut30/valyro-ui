'use client';

import { useEffect, useMemo, useRef, useState, type ComponentPropsWithRef, type CSSProperties } from 'react';
import { cx, useControllableState } from '../primitives';
import { useId, useLayoutEffect, withRef } from '../primitives/react-compat';
import { AlertCircleIcon, LockIcon, RotateCcwIcon } from '../icons';
import { Button } from '../basic/Button';
import { Slider } from '../forms/Slider';
import { NumberInput } from '../forms-advanced/NumberInput';
import { useLabels } from '../agents/labels';
import { useMotionReduced } from '../motion-kit/preference';
import { budgetErrors, budgetScale, budgetSum, changeBudget, type BudgetConfigError, type BudgetMode } from './budget';
import { RollingValue } from './rolling-value';
import { SoftFold } from './soft-fold';
import { createSpringDrive } from './spring-drive';
import './PriorityBudget.css';

export type { BudgetMode, BudgetConfigError } from './budget';

export interface BudgetItem {
  /** Stable id: the key in `value`. */
  id: string;
  /** Name of the item; also names its slider and field. */
  label: string;
  /** Lowest value, a multiple of `step`. */
  min: number;
  /** Highest value, a multiple of `step`. */
  max: number;
  /** The reader may lock this item so redistribution leaves it alone. */
  lockable?: boolean;
  /** Colour of its band in the distribution bar (any CSS colour). Default: a hue from its position. */
  color?: string;
}

export type BudgetChangeReason = 'slider' | 'input' | 'reset';

export interface BudgetChangeDetail {
  reason: BudgetChangeReason;
  /** The item the reader changed; absent for a reset. */
  id?: string;
  /** What the reader asked for. */
  requested?: number;
  /** The change actually applied to that item. */
  applied?: number;
  /** True when the request was cut short by a range, the remainder or what the others could give. */
  limited?: boolean;
}

export interface PriorityBudgetLabels {
  region: string;
  total: string;
  allocated: string;
  remaining: string;
  reset: string;
  locked: string;
  atMin: string;
  atMax: string;
  exhausted: string;
  /** Redistribution: the other items cannot give or take any more. */
  noRoom: string;
  /** Lock button of an item. */
  lock: (label: string) => string;
  increase: (label: string) => string;
  decrease: (label: string) => string;
  /** Range under the item name. */
  range: (min: string, max: string) => string;
  configError: string;
  errors: {
    step: string;
    total: string;
    duplicate: (id: string) => string;
    range: (label: string) => string;
    multiple: (label: string) => string;
    missing: (label: string) => string;
    outOfRange: (label: string) => string;
    overTotal: string;
    notTotal: string;
    unreachable: string;
  };
}

const DEFAULT_LABELS: PriorityBudgetLabels = {
  region: 'Budget',
  total: 'Total',
  allocated: 'Allocated',
  remaining: 'Remaining',
  reset: 'Reset',
  locked: 'Locked',
  atMin: 'At its minimum',
  atMax: 'At its maximum',
  exhausted: 'Budget used up',
  noRoom: 'The others cannot give more',
  lock: (label) => `Lock ${label}`,
  increase: (label) => `Increase ${label}`,
  decrease: (label) => `Decrease ${label}`,
  range: (min, max) => `${min}–${max}`,
  configError: 'This budget cannot be set up',
  errors: {
    step: 'The step must be a positive number.',
    total: 'The total must be a non-negative multiple of the step.',
    duplicate: (id) => `The id “${id}” is used twice.`,
    range: (label) => `${label}: the minimum is above the maximum.`,
    multiple: (label) => `${label}: values must be multiples of the step.`,
    missing: (label) => `${label}: no starting value.`,
    outOfRange: (label) => `${label}: the starting value is outside its range.`,
    overTotal: 'The starting values add up to more than the total.',
    notTotal: 'In redistribute mode the starting values must add up to the total.',
    unreachable: 'The minimums and maximums cannot add up to the total.',
  },
};

export interface PriorityBudgetProps extends Omit<ComponentPropsWithRef<'div'>, 'defaultValue' | 'onChange' | 'children'> {
  /** The items sharing the budget, in display (and redistribution) order. */
  items: BudgetItem[];
  /** The shared resource: points, hours, percent. */
  total: number;
  /** Smallest change, shared by every item; values, limits and the total are its multiples. Default 1. */
  step?: number;
  /**
   * `pool` (default): a change spends or returns the free remainder, the other items stay. `redistribute`: the sum is
   * always `total`, the other unlocked items pay for a change evenly, leftover steps in item order.
   */
  mode?: BudgetMode;
  /** Values by item id. The accepted values are shown; a change is only requested through `onValueChange`. */
  value?: Record<string, number>;
  /** Starting profile when uncontrolled; also what Reset returns to. */
  defaultValue?: Record<string, number>;
  onValueChange?: (value: Record<string, number>, detail: BudgetChangeDetail) => void;
  /** Ids of locked items: redistribution never moves them, and they cannot be changed. */
  lockedIds?: string[];
  defaultLockedIds?: string[];
  onLockedIdsChange?: (ids: string[]) => void;
  /** Formats a value for display. Default: the number with the step's decimals. */
  formatValue?: (value: number) => string;
  /** Turns every control off. */
  disabled?: boolean;
  labels?: Partial<PriorityBudgetLabels>;
}

const errorText = (error: BudgetConfigError, copy: PriorityBudgetLabels, labelOf: (id: string) => string) => {
  switch (error.code) {
    case 'duplicate':
      return copy.errors.duplicate(error.id);
    case 'range':
    case 'multiple':
    case 'missing':
    case 'outOfRange':
      return copy.errors[error.code](labelOf(error.id));
    default:
      return copy.errors[error.code];
  }
};

/** Following the values without overshooting the total: critically damped, settles in about a third of a second. */
const BAR_SPRING = { stiffness: 320, damping: 2 * Math.sqrt(320) };
/**
 * A big change at once (a reset, a typed value): a softer critically damped spring, so a long move does not start with
 * a jolt — a stiff spring's pull is strongest at the start, and over a long way that is a hard start.
 */
const BAR_LONG_SPRING = { stiffness: 110, damping: 2 * Math.sqrt(110) };
/** Share of the bar (percent) past which a change counts as big. */
const LONG_MOVE = 12;

/**
 * The distribution bar. Its bands follow the values with a soft spring, written to the DOM per frame, so dragging a
 * slider moves them smoothly instead of restarting a CSS transition on every step. The first shares are rendered on
 * the server and kept in the markup, so React never fights the frames.
 */
function BudgetBar({ items, shares }: { items: BudgetItem[]; shares: number[] }) {
  const barRef = useRef<HTMLDivElement>(null);
  const reduced = useMotionReduced(barRef);
  const first = useRef(shares).current;
  const drive = useMemo(
    () =>
      createSpringDrive(
        first,
        (values) => {
          const bands = barRef.current?.children;
          if (!bands) return;
          values.forEach((share, i) => {
            const band = bands[i] as HTMLElement | undefined;
            if (band) band.style.inlineSize = `${Math.max(0, share).toFixed(3)}%`;
          });
        },
        0.01,
      ),
    // One drive per bar (it is keyed by the number of items).
    [],
  );
  const key = shares.map((share) => share.toFixed(4)).join(' ');
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (reduced) {
      drive.set(shares);
      return;
    }
    const longest = Math.max(0, ...shares.map((share, i) => Math.abs(share - (drive.value[i] ?? share))));
    drive.to(shares, { spring: longest > LONG_MOVE ? BAR_LONG_SPRING : BAR_SPRING });
  }, [key]);
  useEffect(() => () => drive.stop(), [drive]);
  return (
    <div ref={barRef} className="ui-priority-budget__bar" aria-hidden="true">
      {items.map((item, index) => (
        <span
          key={item.id}
          className="ui-priority-budget__segment"
          style={{ inlineSize: `${first[index] ?? 0}%`, '--_hue': index * 67, '--_color': item.color } as CSSProperties}
          data-colored={item.color ? true : undefined}
        />
      ))}
    </div>
  );
}

/**
 * Several items share one limited budget: character points, hours of a week, shares of a plan. Every input path (the
 * slider, the number field and its step buttons) goes through one calculation in whole steps, so the sum never
 * drifts. A profile that cannot work is shown as an error, never silently repaired.
 */
export const PriorityBudget = withRef(function PriorityBudget({
  items,
  total,
  step = 1,
  mode = 'pool',
  value: valueProp,
  defaultValue,
  onValueChange,
  lockedIds: lockedProp,
  defaultLockedIds = [],
  onLockedIdsChange,
  formatValue,
  disabled = false,
  labels,
  className,
  style,
  ref,
  ...rest
}: PriorityBudgetProps) {
  const copy = useLabels(DEFAULT_LABELS, labels);
  const uid = useId();
  // Without a profile every item starts at its minimum (a redistribute budget then usually reports an error).
  const initial = useMemo(() => defaultValue ?? Object.fromEntries(items.map((item) => [item.id, item.min])), [defaultValue, items]);
  const [values, setValues] = useControllableState<Record<string, number>>({ value: valueProp, defaultValue: initial });
  const [locked, setLocked] = useControllableState<string[]>({ value: lockedProp, defaultValue: defaultLockedIds, onChange: onLockedIdsChange });
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);

  const decimals = String(step).includes('.') ? String(step).split('.')[1].length : 0;
  const format = formatValue ?? ((n: number) => n.toFixed(decimals));
  const errors = budgetErrors(items, total, step, mode, values);
  const broken = errors.length > 0;
  const allocated = budgetSum(items, values, step);
  const { toUnits, fromUnits } = budgetScale(step);
  const remaining = fromUnits(toUnits(total) - toUnits(allocated));
  const labelOf = (id: string) => items.find((item) => item.id === id)?.label ?? id;

  const commit = (next: Record<string, number>, detail: BudgetChangeDetail) => {
    setValues(next);
    onValueChange?.(next, detail);
  };

  const request = (id: string, requested: number, reason: BudgetChangeReason) => {
    if (broken || disabled) return;
    const change = changeBudget(items, total, step, mode, values, locked, id, requested);
    const item = items.find((entry) => entry.id === id)!;
    const current = values[id];
    if (change.limited) {
      const text =
        requested > item.max ? copy.atMax : requested < item.min ? copy.atMin : mode === 'pool' ? copy.exhausted : copy.noRoom;
      setNotice({ id, text });
    } else setNotice(null);
    if (change.values[id] === current) return;
    commit(change.values, { reason, id, requested, applied: change.applied, limited: change.limited });
  };

  const reset = () => {
    if (!defaultValue) return;
    setNotice(null);
    commit({ ...defaultValue }, { reason: 'reset' });
  };

  const toggleLock = (id: string) => setLocked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div
      ref={ref}
      role="group"
      aria-label={copy.region}
      className={cx('ui-priority-budget', className)}
      data-mode={mode}
      data-state={broken ? 'error' : remaining === 0 ? 'exhausted' : 'free'}
      style={style}
      {...rest}
    >
      <div className="ui-priority-budget__summary" aria-live="polite">
        <div className="ui-priority-budget__stat">
          <span className="ui-priority-budget__stat-label">{copy.total}</span>
          <span className="ui-priority-budget__stat-value">{format(total)}</span>
        </div>
        <div className="ui-priority-budget__stat">
          <span className="ui-priority-budget__stat-label">{copy.allocated}</span>
          <RollingValue className="ui-priority-budget__stat-value" value={allocated} format={format} step={step} />
        </div>
        <div className="ui-priority-budget__stat" data-tone={remaining === 0 ? 'done' : remaining < 0 ? 'over' : undefined}>
          <span className="ui-priority-budget__stat-label">{copy.remaining}</span>
          <RollingValue className="ui-priority-budget__stat-value" value={remaining} format={format} step={step} />
        </div>
        {defaultValue && (
          <Button className="ui-priority-budget__reset" size="sm" variant="ghost" leftIcon={<RotateCcwIcon />} onClick={reset} disabled={disabled}>
            {copy.reset}
          </Button>
        )}
      </div>

      <BudgetBar key={items.length} items={items} shares={items.map((item) => (total > 0 ? Math.max(0, ((values[item.id] ?? 0) / total) * 100) : 0))} />
      <ul className="ui-priority-budget__legend" aria-hidden="true">
        {items.map((item, index) => (
          <li key={item.id} className="ui-priority-budget__legend-item">
            <span
              className="ui-priority-budget__swatch"
              style={{ '--_hue': index * 67, '--_color': item.color } as CSSProperties}
              data-colored={item.color ? true : undefined}
            />
            {item.label}
          </li>
        ))}
      </ul>

      <SoftFold open={broken}>
        <div className="ui-priority-budget__error" role="alert">
          <AlertCircleIcon aria-hidden="true" />
          <div>
            <strong>{copy.configError}</strong>
            <ul>
              {errors.map((error, index) => (
                <li key={index}>{errorText(error, copy, labelOf)}</li>
              ))}
            </ul>
          </div>
        </div>
      </SoftFold>

      <ul className="ui-priority-budget__items">
        {items.map((item, index) => {
          const current = values[item.id] ?? item.min;
          const isLocked = locked.includes(item.id);
          const off = disabled || broken || isLocked;
          const status = isLocked
            ? copy.locked
            : notice?.id === item.id
              ? notice.text
              : current <= item.min
                ? copy.atMin
                : current >= item.max
                  ? copy.atMax
                  : null;
          const nameId = `${uid}-name-${index}`;
          const statusId = `${uid}-status-${index}`;
          return (
            <li key={item.id} className="ui-priority-budget__item" data-locked={isLocked || undefined}>
              <div className="ui-priority-budget__item-head">
                <span
                  className="ui-priority-budget__swatch"
                  style={{ '--_hue': index * 67, '--_color': item.color } as CSSProperties}
                  data-colored={item.color ? true : undefined}
                  aria-hidden="true"
                />
                <span className="ui-priority-budget__name" id={nameId}>
                  {item.label}
                </span>
                <span className="ui-priority-budget__range">{copy.range(format(item.min), format(item.max))}</span>
                {item.lockable && (
                  <button
                    type="button"
                    className="ui-priority-budget__lock"
                    aria-pressed={isLocked}
                    aria-label={copy.lock(item.label)}
                    disabled={disabled || broken}
                    onClick={() => toggleLock(item.id)}
                  >
                    <LockIcon aria-hidden="true" />
                  </button>
                )}
              </div>
              <div className="ui-priority-budget__controls">
                <Slider
                  className="ui-priority-budget__slider"
                  aria-labelledby={nameId}
                  aria-describedby={status ? statusId : undefined}
                  min={item.min}
                  max={item.max}
                  step={step}
                  value={current}
                  onValueChange={(next) => request(item.id, next, 'slider')}
                  formatValue={format}
                  disabled={off}
                />
                <NumberInput
                  className="ui-priority-budget__input"
                  size="sm"
                  aria-labelledby={nameId}
                  min={item.min}
                  max={item.max}
                  step={step}
                  value={current}
                  onValueChange={(next) => next !== null && request(item.id, next, 'input')}
                  disabled={off}
                  labels={{ increment: copy.increase(item.label), decrement: copy.decrease(item.label) }}
                />
              </div>
              <span className="ui-priority-budget__status" id={statusId} data-empty={status ? undefined : true}>
                {/* Keyed by its text: a new note fades in where the old one was. */}
                {status && (
                  <span key={status} className="ui-priority-budget__status-text">
                    {status}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
});
