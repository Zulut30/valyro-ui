import { rubberBand } from './spring-drive';

/*
 * Swipe Action Card gesture rules, in logical terms: a positive offset moves the card toward the inline end and
 * uncovers the start actions; a negative one uncovers the end actions. Pure, so every rule is tested.
 */

export type SwipeSide = 'start' | 'end';
export type SwipeZone = 'closed' | 'revealed' | 'armed';

/** Movement (px) before the gesture picks an axis. */
export const AXIS_SLOP = 8;

/**
 * The axis a gesture locks to once it moved past the slop: `y` (and the page scrolls) unless the movement is clearly
 * horizontal, so diagonal flicks never act. Null while undecided.
 */
export function lockAxis(dx: number, dy: number, slop = AXIS_SLOP): 'x' | 'y' | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < slop) return null;
  return ax > ay * 1.5 ? 'x' : 'y';
}

/** Physical horizontal movement to a logical offset (mirrored in right-to-left pages). */
export const logicalOffset = (dx: number, rtl: boolean) => (rtl ? -dx : dx);

/** The side whose actions an offset uncovers. */
export const sideOf = (offset: number): SwipeSide => (offset >= 0 ? 'start' : 'end');

export interface SwipeLimits {
  /** Width of the start and end action trays, px (0 without actions on that side). */
  start: number;
  end: number;
  /** Width of the card, px. */
  card: number;
  /** Sides that allow a full swipe. */
  full: Partial<Record<SwipeSide, boolean>>;
}

/** Distance (share of the card) past which a full swipe arms. */
export const FULL_SHARE = 0.6;

/**
 * Offset while dragging: one to one up to the tray, then a smooth rubber band; a side without actions gives way only a
 * little; a side with a full-swipe action follows the finger to the card's edge.
 */
export function dragOffset(raw: number, limits: SwipeLimits): number {
  const side = sideOf(raw);
  const tray = limits[side];
  const sign = raw >= 0 ? 1 : -1;
  const distance = Math.abs(raw);
  if (!tray) return sign * rubberBand(distance, 0, 28);
  const max = limits.full[side] ? limits.card : tray;
  return sign * rubberBand(distance, max, Math.max(48, max * 0.35));
}

/** Where the full swipe arms on a side, px. */
export const armDistance = (side: SwipeSide, limits: SwipeLimits) => Math.max(limits[side] + 48, limits.card * FULL_SHARE);

/** What releasing at `offset` does: arm the full swipe, keep the tray open, or close. */
export function zoneOf(offset: number, limits: SwipeLimits): SwipeZone {
  const side = sideOf(offset);
  const tray = limits[side];
  const distance = Math.abs(offset);
  if (!tray) return 'closed';
  if (limits.full[side] && distance >= armDistance(side, limits)) return 'armed';
  return distance >= tray / 2 ? 'revealed' : 'closed';
}

export type SwipeRelease = { kind: 'full'; side: SwipeSide } | { kind: 'open'; side: SwipeSide; offset: number } | { kind: 'close' };

/**
 * The outcome of letting go at `offset` with `velocity` (px/ms, logical): a full swipe runs only when released armed;
 * otherwise the card goes where it was heading, projected a little ahead (a flick opens or closes a tray even short of
 * half of it, a flick back closes it).
 */
export function releaseOf(offset: number, velocity: number, limits: SwipeLimits): SwipeRelease {
  if (zoneOf(offset, limits) === 'armed') return { kind: 'full', side: sideOf(offset) };
  const projected = offset + velocity * 160;
  if (Math.sign(projected) !== Math.sign(offset) && offset !== 0) return { kind: 'close' };
  const side = sideOf(projected);
  const tray = limits[side];
  if (tray && Math.abs(projected) >= tray / 2) return { kind: 'open', side, offset: (side === 'start' ? 1 : -1) * tray };
  return { kind: 'close' };
}

/**
 * A countdown that pauses: `remaining` ms left when paused. Used for the undo bar, which focus and hover hold open.
 */
export function remainingAfter(remaining: number, startedAt: number, now: number): number {
  return Math.max(0, remaining - (now - startedAt));
}
