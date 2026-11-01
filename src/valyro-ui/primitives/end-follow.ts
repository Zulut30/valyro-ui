/*
 * Streaming panes follow their end until the reader scrolls up. A distance threshold alone missed a slow trackpad or
 * finger nudge (it never left the threshold), so the next chunk pulled the view back down. Here any upward scroll
 * releases, reaching the end picks the follow up again, and the wheel, a finger and the keys release before their
 * scroll event lands, so a chunk arriving in between cannot win. Internal; shared by ScrollArea (`follow`) and the
 * streaming AI panes (through ai/follow.ts).
 */
import type { KeyboardEvent, TouchEvent, WheelEvent } from 'react';

export interface EndFollow {
  following: boolean;
  /** scrollTop at the last scroll event, to tell up from down. */
  top: number;
  touchY: number;
}

export const createEndFollow = (): EndFollow => ({ following: true, top: 0, touchY: 0 });

/**
 * The axis a pane follows: `y` (the default) its bottom, `x` its inline end (a timeline growing sideways). On `x`,
 * `top` and `touchY` hold the inline offset (a magnitude, so RTL reads the same) and the finger's x.
 */
export type EndFollowAxis = 'x' | 'y';

const isRtl = (el: HTMLElement) => typeof getComputedStyle === 'function' && getComputedStyle(el).direction === 'rtl';
const offsetOf = (el: HTMLElement, axis: EndFollowAxis) => (axis === 'y' ? el.scrollTop : Math.abs(el.scrollLeft));
const rangeOf = (el: HTMLElement, axis: EndFollowAxis) => (axis === 'y' ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth);

/** Call from the pane's scroll event. */
export function trackEndFollow(el: HTMLElement, follow: EndFollow, threshold: number, axis: EndFollowAxis = 'y') {
  const offset = offsetOf(el, axis);
  if (rangeOf(el, axis) - offset <= threshold) follow.following = true;
  else if (offset < follow.top) follow.following = false;
  follow.top = offset;
}

const RELEASE_KEYS = new Set(['ArrowUp', 'PageUp', 'Home']);

/** Wheel, touch and key handlers for the pane (or an ancestor, given how to find the pane). */
export function endFollowHandlers(pane: () => HTMLElement | null | undefined, follow: () => EndFollow | undefined, axis: EndFollowAxis = 'y') {
  // Nothing to scroll back to (short content, or already at the top): keep following.
  const release = () => {
    const el = pane();
    const state = follow();
    if (el && state && offsetOf(el, axis) > 0) state.following = false;
  };
  /** +1 when a positive x delta (rightwards) heads back to the start: the inline start is on the right in RTL. */
  const backSign = () => {
    const el = pane();
    return el && isRtl(el) ? 1 : -1;
  };
  return {
    onWheel: (event: WheelEvent) => {
      if (axis === 'y') {
        if (event.deltaY < 0) release();
      } else if (event.deltaX * backSign() > 0 || (event.shiftKey && event.deltaY < 0)) release();
    },
    onTouchStart: (event: TouchEvent) => {
      const state = follow();
      const touch = event.touches[0];
      if (state) state.touchY = (axis === 'y' ? touch?.clientY : touch?.clientX) ?? 0;
    },
    onTouchMove: (event: TouchEvent) => {
      const touch = event.touches[0];
      const at = (axis === 'y' ? touch?.clientY : touch?.clientX) ?? 0;
      const from = follow()?.touchY ?? Infinity;
      // The finger moving down scrolls the content up; sideways, moving towards the inline end scrolls back.
      if (axis === 'y' ? at > from : Number.isFinite(from) && (at - from) * backSign() < 0) release();
    },
    onKeyDown: (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, [contenteditable]')) return;
      const back = axis === 'y' ? RELEASE_KEYS.has(event.key) : event.key === 'Home' || event.key === (backSign() > 0 ? 'ArrowRight' : 'ArrowLeft');
      if (back) release();
    },
  };
}
