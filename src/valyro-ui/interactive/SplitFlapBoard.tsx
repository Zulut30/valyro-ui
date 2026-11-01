'use client';

import { useEffect, useMemo, useRef, useState, type ComponentPropsWithRef, type CSSProperties } from 'react';
import { cx, mergeRefs, useLatest } from '../primitives';
import { useId, useLayoutEffect, withRef } from '../primitives/react-compat';
import { useLabels } from '../agents/labels';
import { useMotionReduced } from '../motion-kit/preference';
import { changedFlaps, flapDelays, flapMotion, flippable, flapTotal, layoutFlaps, type FlapAlign, type FlapOverflow } from './splitflap';
import './SplitFlapBoard.css';

export type { FlapAlign, FlapOverflow } from './splitflap';

export interface SplitFlapBoardLabels {
  /** Read instead of the value when it is empty. */
  empty: string;
}

const DEFAULT_LABELS: SplitFlapBoardLabels = {
  empty: 'No value',
};

export interface SplitFlapBoardProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** The text to show. The app computes it (a countdown, a status); the board only displays it. */
  value: string;
  /** Fixed number of cells per row, for a stable width. Default: as many as the value has characters. */
  columns?: number;
  /** Position of the value inside the fixed grid. Default `start`. */
  align?: FlapAlign;
  /** With `columns`: longer text wraps by words onto more rows (`wrap`, default) or is cut (`truncate`). */
  overflow?: FlapOverflow;
  /** Tempo of one flip, ms: the fall takes about 40% of it, the landing settles in the rest. Default 320. */
  duration?: number;
  /** Delay between consecutive changed cells, ms. Default 30. */
  stagger?: number;
  /** `polite` reads every new value aloud; `off` (default) leaves it to be read on demand. */
  announce?: 'off' | 'polite';
  /** Name of the reading, shown above the board, such as "Doors open in". */
  label?: string;
  /** Look: `dense` (default) dark tiles, `sign` large tiles of a station sign, `minimal` flat tiles without frames. */
  variant?: 'dense' | 'sign' | 'minimal';
  /** Called once the latest value is fully on the board (after its flips, or at once without motion). */
  onSettled?: (value: string) => void;
  labels?: Partial<SplitFlapBoardLabels>;
}

const rowsKey = (rows: string[][]) => rows.map((row) => row.join('\u0000')).join('\u0001');

/**
 * A mechanical split-flap board: when the value changes, only the cells whose character changed flip, the top half
 * folding down over the next character, one cell after another. A value that arrives mid-flip takes over at once,
 * so fast updates end on the latest value without a queue. Assistive technology reads the whole value as one string;
 * the halves are decorative.
 */
export const SplitFlapBoard = withRef(function SplitFlapBoard({
  value,
  columns,
  align = 'start',
  overflow = 'wrap',
  duration = 320,
  stagger = 30,
  announce = 'off',
  label,
  variant = 'dense',
  onSettled,
  labels,
  className,
  style,
  ref,
  ...rest
}: SplitFlapBoardProps) {
  const copy = useLabels(DEFAULT_LABELS, labels);
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const reduced = useMotionReduced(rootRef);
  const layout = useMemo(() => layoutFlaps(value, columns, align, overflow), [value, columns, align, overflow]);
  const key = rowsKey(layout.rows);
  const motion = useMemo(() => flapMotion(duration), [duration]);
  // `shown` is the grid on the board; `from` is the grid it is flipping away from (null when still); `faded` the grid a
  // calm change (reduced motion) crossfades from.
  const [board, setBoard] = useState({ key, shown: layout.rows, from: null as string[][] | null, faded: null as string[][] | null, generation: 0 });
  const settledRef = useLatest(onSettled);
  const valueRef = useLatest(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingSettle = useRef(false);

  useLayoutEffect(() => {
    if (board.key === key) return;
    clearTimeout(timer.current);
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const still = reduced || hidden || duration <= 0;
    // A value that arrives mid-flip flips on from the last target: no queue of stale values.
    const from = still ? null : board.shown;
    const faded = still && !hidden && duration > 0 ? board.shown : null;
    setBoard({ key, shown: layout.rows, from, faded, generation: board.generation + 1 });
    const total = from ? flapTotal(changedFlaps(from, layout.rows), motion.fold + motion.land, stagger) : 0;
    if (!total) {
      pendingSettle.current = true;
      return;
    }
    timer.current = setTimeout(() => {
      setBoard((current) => (current.key === key ? { ...current, from: null } : current));
      settledRef.current?.(valueRef.current);
    }, total);
  }, [key]);

  // A change without flips (reduced motion, a hidden tab, nothing to flip) settles after it is painted.
  useEffect(() => {
    if (!pendingSettle.current) return;
    pendingSettle.current = false;
    settledRef.current?.(valueRef.current);
  }, [board]);

  // Back on a hidden tab: show the latest value at once instead of finishing a flip nobody saw.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      setBoard((current) => (current.from ? { ...current, from: null } : current));
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(timer.current);
    };
  }, []);

  const changed = board.from ? changedFlaps(board.from, board.shown) : null;
  const faded = board.faded ? changedFlaps(board.faded, board.shown) : null;
  const delays = changed ? flapDelays(changed, stagger) : null;
  const empty = !value.trim();
  const width = board.shown[0]?.length ?? 1;

  return (
    <div
      ref={mergeRefs(ref, rootRef)}
      role="group"
      aria-labelledby={label ? `${uid}-label` : undefined}
      className={cx('ui-split-flap', className)}
      data-variant={variant}
      data-empty={empty || undefined}
      data-flipping={changed ? '' : undefined}
      style={
        {
          ...style,
          '--_fold-time': `${motion.fold}ms`,
          '--_land-time': `${motion.land}ms`,
          '--_fold-ease': motion.foldEasing,
          '--_land-ease': motion.landEasing,
          '--_columns': width,
        } as CSSProperties
      }
      {...rest}
    >
      {label && (
        <span className="ui-split-flap__label" id={`${uid}-label`}>
          {label}
        </span>
      )}
      <span className="ui-sr-only" aria-live={announce === 'polite' ? 'polite' : undefined} aria-atomic={announce === 'polite' ? true : undefined}>
        {empty ? copy.empty : value}
      </span>
      <div className="ui-split-flap__board" aria-hidden="true">
        {board.shown.map((row, r) => (
          <div className="ui-split-flap__row" key={r}>
            {row.map((char, c) => {
              const flip = !!changed?.[r]?.[c];
              const prev = board.from?.[r]?.[c] ?? ' ';
              const plain = !flippable(char) || !flippable(prev);
              const fade = !!faded?.[r]?.[c];
              return (
                <span
                  // A calm change remounts the cell, so its fade plays again.
                  key={fade ? `${c}-${board.generation}` : c}
                  className="ui-split-flap__cell"
                  data-flip={(flip && !plain) || undefined}
                  data-plain={plain || undefined}
                  data-blank={char === ' ' || undefined}
                  data-fade={fade || undefined}
                  style={flip ? ({ '--_delay': `${delays![r][c]}ms` } as CSSProperties) : undefined}
                >
                  <span className="ui-split-flap__top">{char}</span>
                  <span className="ui-split-flap__bottom">{flip && !plain ? prev : char}</span>
                  {flip && !plain && (
                    <>
                      <span key={`fold-${board.generation}`} className="ui-split-flap__fold">
                        {prev}
                      </span>
                      <span key={`land-${board.generation}`} className="ui-split-flap__land">
                        {char}
                      </span>
                    </>
                  )}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
});
