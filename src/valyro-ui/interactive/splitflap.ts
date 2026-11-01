/*
 * Text layout of Split-Flap Board: user-perceived characters (graphemes), a fixed grid, alignment, wrapping and
 * which cells changed between two values. Pure, so the board's rules are tested without a DOM.
 */

export type FlapAlign = 'start' | 'center' | 'end';
export type FlapOverflow = 'wrap' | 'truncate';

const BLANK = ' ';

type Segmenter = { segment: (text: string) => Iterable<{ segment: string }> };
let segmenter: Segmenter | null | undefined;

/** Characters as the reader sees them: a flag, an accented letter or a family emoji is one cell. */
export function graphemes(text: string): string[] {
  if (segmenter === undefined) {
    const Ctor = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => Segmenter }).Segmenter;
    segmenter = Ctor ? new Ctor(undefined, { granularity: 'grapheme' }) : null;
  }
  if (segmenter) return Array.from(segmenter.segment(text), (part) => part.segment);
  // Without Intl.Segmenter: code points, with combining marks kept on their letter.
  const out: string[] = [];
  for (const char of Array.from(text)) {
    if (out.length && /^\p{M}$/u.test(char)) out[out.length - 1] += char;
    else out.push(char);
  }
  return out;
}

/**
 * Whether a character flips: one letter, digit, punctuation mark, symbol or space. Emoji and other compound
 * graphemes are shown as plain text in their cell, without the split halves.
 */
export function flippable(char: string): boolean {
  if (char === BLANK) return true;
  if (Array.from(char).length !== 1) return /^\p{L}\p{M}+$/u.test(char);
  return /^[\p{L}\p{N}\p{P}\p{S}]$/u.test(char) && !/\p{Extended_Pictographic}/u.test(char);
}

/** Collapses runs of whitespace (line breaks included) to single spaces: the board is one line per row. */
const normalise = (text: string) => graphemes(text.replace(/\s+/g, ' '));

function pad(row: string[], columns: number, align: FlapAlign): string[] {
  const free = columns - row.length;
  if (free <= 0) return row.slice(0, columns);
  const before = align === 'end' ? free : align === 'center' ? Math.floor(free / 2) : 0;
  return [...Array<string>(before).fill(BLANK), ...row, ...Array<string>(free - before).fill(BLANK)];
}

/** Greedy word wrap into rows of `columns` cells; a word longer than a row is split. */
function wrap(chars: string[], columns: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  const words: string[][] = [];
  let word: string[] = [];
  for (const char of chars) {
    if (char === BLANK) {
      if (word.length) words.push(word);
      word = [];
    } else word.push(char);
  }
  if (word.length) words.push(word);
  for (let w of words) {
    while (w.length > columns) {
      if (row.length) rows.push(row);
      rows.push(w.slice(0, columns));
      w = w.slice(columns);
      row = [];
    }
    if (!w.length) continue;
    const needed = row.length ? row.length + 1 + w.length : w.length;
    if (needed > columns) {
      rows.push(row);
      row = [...w];
    } else row = row.length ? [...row, BLANK, ...w] : [...w];
  }
  if (row.length || !rows.length) rows.push(row);
  return rows;
}

export interface FlapLayout {
  /** Cells by row. */
  rows: string[][];
  /** Text was cut to fit (`overflow="truncate"`). */
  truncated: boolean;
}

/**
 * The grid for a value. Without `columns` it is one row as long as the value (at least one cell, so an empty board
 * keeps its height); with `columns` every row has exactly that many cells, aligned, and longer text wraps by words or
 * is cut.
 */
export function layoutFlaps(value: string, columns?: number, align: FlapAlign = 'start', overflow: FlapOverflow = 'wrap'): FlapLayout {
  const chars = normalise(value);
  if (!columns || columns < 1) return { rows: [chars.length ? chars : [BLANK]], truncated: false };
  const width = Math.floor(columns);
  if (overflow === 'truncate' || chars.length <= width) {
    return { rows: [pad(chars, width, align)], truncated: chars.length > width };
  }
  return { rows: wrap(chars, width).map((row) => pad(row, width, align)), truncated: false };
}

/**
 * For each cell of `next`, whether it differs from the same cell of `prev` (a cell that did not exist before counts
 * as changed from a blank). Unchanged cells keep still.
 */
export function changedFlaps(prev: string[][], next: string[][]): boolean[][] {
  return next.map((row, r) => row.map((char, c) => (prev[r]?.[c] ?? BLANK) !== char));
}

/** Stagger order: the n-th changed cell, left to right and row by row, starts n·stagger later. */
export function flapDelays(changed: boolean[][], stagger: number): number[][] {
  let n = 0;
  return changed.map((row) => row.map((flag) => (flag ? stagger * n++ : 0)));
}

/** Total time from the first flap to the last one landing, ms. */
export function flapTotal(changed: boolean[][], duration: number, stagger: number): number {
  const count = changed.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  return count ? duration + stagger * (count - 1) : 0;
}

export interface FlapMotion {
  /** The top flap falling over, ms. */
  fold: number;
  /** The bottom flap landing and settling, ms. */
  land: number;
  /** CSS easings: the fall accelerates like a hinged flap; the landing carries on at that speed and settles with a small bounce. */
  foldEasing: string;
  landEasing: string;
}

const motionCache = new Map<number, FlapMotion>();

/**
 * The flip of one cell as one motion: the top half falls with gravity (angle ∝ t²) and passes the vertical at full
 * speed; the bottom half continues at exactly that speed into a lightly damped spring, so there is no stop at the seam
 * and the flap bounces once against its stop. Sampled into CSS `linear()` easings; pure and cached per duration.
 */
export function flapMotion(duration: number): FlapMotion {
  const key = Math.max(40, Math.round(duration));
  const cached = motionCache.get(key);
  if (cached) return cached;
  const seconds = key / 1000;
  const fold = seconds * 0.42;
  const foldPoints = Array.from({ length: 13 }, (_, i) => Math.round((i / 12) ** 2 * 10000) / 10000);
  // Normalised land progress: 0 at the vertical, 1 flat. The fall ends at d/dt (t/F)² = 2/F; in land units
  // (both halves turn 90°) that is the same 2/F per second.
  const omega = 10.5 / seconds;
  const zeta = 0.58;
  const stiffness = omega * omega;
  const damping = 2 * zeta * omega;
  const dt = 1 / 2000;
  let x = 0;
  let v = 2 / fold;
  const samples: number[] = [0];
  let t = 0;
  let settled = 0;
  const limit = seconds * 4;
  while (t < limit) {
    v += (-stiffness * (x - 1) - damping * v) * dt;
    x += v * dt;
    t += dt;
    samples.push(x);
    if (Math.abs(x - 1) > 0.002 || Math.abs(v) > 0.05) settled = t;
  }
  const land = Math.max(dt, settled);
  const count = Math.round(land / dt);
  const landPoints: string[] = [];
  const steps = 36;
  for (let i = 0; i <= steps; i++) {
    const value = i === steps ? 1 : samples[Math.min(samples.length - 1, Math.round((count * i) / steps))];
    landPoints.push(String(Math.round(value * 10000) / 10000));
  }
  const motion: FlapMotion = {
    fold: Math.round(fold * 1000),
    land: Math.round(land * 1000),
    foldEasing: `linear(${foldPoints.join(', ')})`,
    landEasing: `linear(${landPoints.join(', ')})`,
  };
  motionCache.set(key, motion);
  return motion;
}
