'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject, type TouchEvent, type WheelEvent } from 'react';
import { getDirection, isMotionReduced, useLatest, type Direction } from '../primitives/utils';
import { useId, useLayoutEffect } from '../primitives/react-compat';
import { useNodeRef, withUserProps, type UserProps } from '../primitives/prop-getters';
import { useControllableState } from '../primitives/useControllableState';
import { SPRINGS, stepSpring } from '../primitives/spring';
import { createEndFollow, endFollowHandlers, trackEndFollow } from '../primitives/end-follow';
import { observeScrollEdges, type ScrollEdgeDistances } from '../primitives/scroll-edges';
import { edgeDepth, followStart, scrollFromThumb, thumbGeometry, thumbOffset, trackPageTarget } from './scroll-area';

/*
 * The behaviour of ScrollArea without its markup: overlay scrollbars (thumb follows the scroll, drags 1:1, a click
 * on the track pages with a spring), edge hints that grow with the distance to each edge, and the follow mode of
 * chats and logs (the end stays in view while content grows; any scroll back releases it, reaching the end picks it
 * up again). Scrolling never re-renders: thumbs, edges and the scrolling state are written to the DOM once a frame;
 * React state changes only when overflow, the ends or the follow state change.
 */

export type ScrollAreaOrientation = 'vertical' | 'horizontal' | 'both';
export type ScrollAreaVisibility = 'hover' | 'scroll' | 'auto' | 'always';
export type ScrollAreaAxis = 'x' | 'y';
export type ScrollAreaEdge = 'top' | 'bottom' | 'start' | 'end';
/** `spring`: the kit's smooth spring (instant under reduced motion); `instant`: jump. */
export type ScrollAreaBehavior = 'spring' | 'instant';

export interface ScrollAreaOptions {
  /** Axes that scroll. Default `vertical`. */
  orientation?: ScrollAreaOrientation;
  /** Following the end (controlled); pair with `onFollowChange`. Passing this or `defaultFollow` turns follow mode on. */
  follow?: boolean;
  defaultFollow?: boolean;
  onFollowChange?: (follow: boolean) => void;
  /** Distance from the end, px, that counts as being at it. Default 32. */
  threshold?: number;
  /** Where it opens; `end` is applied before the first paint. Default `start`, or `end` while following. */
  initialScroll?: 'start' | 'end';
  /** Called once each time an edge is reached. */
  onEdgeReached?: (edge: ScrollAreaEdge) => void;
  /** Ms before the overlay bars hide. Default 600. */
  hideDelay?: number;
  /** When the overlay bars show. Default `hover`. */
  visibility?: ScrollAreaVisibility;
  /** Accessible name of the viewport, applied (with `role="region"`) only while it overflows. */
  label?: string;
}

export interface ScrollAreaState {
  /** Follow mode is on (`follow` or `defaultFollow` was passed). */
  followMode: boolean;
  /** The end is being followed. */
  following: boolean;
  setFollowing: (follow: boolean) => void;
  /** Content overflows on each axis; both false until mounted. */
  overflow: { x: boolean; y: boolean };
  /** At the start / end of the main axis (vertical, or inline for `horizontal`). */
  atStart: boolean;
  atEnd: boolean;
  /** The end is further than `threshold` away: the "scroll to end" button shows. */
  awayFromEnd: boolean;
  /** `initialScroll="end"` has not been applied yet (the viewport stays hidden). */
  pending: boolean;
  /** Scrolls to the end of the main axis (and turns following back on); resolves true once there, false if interrupted. */
  scrollToEnd: (options?: { behavior?: ScrollAreaBehavior }) => Promise<boolean>;
  scrollToStart: (options?: { behavior?: ScrollAreaBehavior }) => Promise<boolean>;
  /** Scrolls to offsets (`left` is from the inline start, so RTL reads the same). */
  scrollTo: (target: { top?: number; left?: number; behavior?: ScrollAreaBehavior }) => Promise<boolean>;
  /** Id of the viewport, for `aria-controls`. */
  viewportId: string;
  /** The scrolling element once mounted. */
  viewportRef: RefObject<HTMLDivElement | null>;
  getRootProps: <P extends UserProps>(props?: P) => P & Record<string, unknown>;
  getViewportProps: <P extends UserProps>(props?: P) => P & Record<string, unknown>;
  getContentProps: <P extends UserProps>(props?: P) => P & Record<string, unknown>;
  getScrollbarProps: <P extends UserProps>(axis: ScrollAreaAxis, props?: P) => P & Record<string, unknown>;
  getThumbProps: <P extends UserProps>(axis: ScrollAreaAxis, props?: P) => P & Record<string, unknown>;
  getCornerProps: <P extends UserProps>(props?: P) => P & Record<string, unknown>;
  getScrollButtonProps: <P extends UserProps>(props?: P) => P & Record<string, unknown>;
}

interface Glide {
  value: number;
  velocity: number;
  /** The offset written last; a different reading means the reader scrolled meanwhile. */
  written: number;
  target: () => number;
  /** A follow glide stops as soon as following is released. */
  follow: boolean;
  resolvers: ((done: boolean) => void)[];
}

interface Drag {
  axis: ScrollAreaAxis;
  pointer: number;
  scroll: number;
  /** Scroll px per thumb px. */
  ratio: number;
}

/** A scroll event within this many ms means "still scrolling". */
const SCROLL_IDLE_MS = 140;
const EDGES: Record<ScrollAreaAxis, [ScrollAreaEdge, ScrollAreaEdge]> = { y: ['top', 'bottom'], x: ['start', 'end'] };
const NO_OVERFLOW = { x: false, y: false };
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

export function useScrollArea(options: ScrollAreaOptions = {}): ScrollAreaState {
  const {
    orientation = 'vertical',
    follow,
    defaultFollow,
    onFollowChange,
    threshold = 32,
    initialScroll,
    onEdgeReached,
    hideDelay = 600,
    visibility = 'hover',
    label,
  } = options;
  const followMode = follow !== undefined || defaultFollow !== undefined;
  const [following, setFollowingState] = useControllableState({ value: follow, defaultValue: defaultFollow ?? false, onChange: onFollowChange });
  const main: ScrollAreaAxis = orientation === 'horizontal' ? 'x' : 'y';
  const opening = initialScroll ?? (followMode && following ? 'end' : 'start');
  const [pending, setPending] = useState(opening === 'end');
  // Null until measured, so the server and the first client render carry no overflow attributes.
  const [measuredOverflow, setOverflow] = useState<{ x: boolean; y: boolean } | null>(null);
  const overflow = measuredOverflow ?? NO_OVERFLOW;
  const [ends, setEnds] = useState({ atStart: true, atEnd: true, awayFromEnd: false });

  const id = useId();
  const viewportId = `${id}-viewport`;
  const [rootRef, setRoot] = useNodeRef<HTMLDivElement>();
  const [viewportRef, setViewport] = useNodeRef<HTMLDivElement>();
  const [contentRef, setContent] = useNodeRef<HTMLDivElement>();
  const [barYRef, setBarY] = useNodeRef<HTMLDivElement>();
  const [barXRef, setBarX] = useNodeRef<HTMLDivElement>();
  const [thumbYRef, setThumbY] = useNodeRef<HTMLDivElement>();
  const [thumbXRef, setThumbX] = useNodeRef<HTMLDivElement>();

  const settings = useLatest({ threshold, hideDelay, visibility, orientation, followMode, main, onEdgeReached });
  const followingRef = useLatest(following);
  const setFollowingRef = useLatest(setFollowingState);

  // Everything the frame loop and the handlers share, outside React.
  const live = useRef({
    follow: { ...createEndFollow(), following: followMode && following },
    dir: 'ltr' as Direction,
    glides: {} as Partial<Record<ScrollAreaAxis, Glide>>,
    frame: 0,
    last: 0,
    drag: null as Drag | null,
    selecting: false,
    hover: false,
    barHover: false,
    scrolling: false,
    scrollTimer: 0 as ReturnType<typeof setTimeout> | 0,
    hideTimer: 0 as ReturnType<typeof setTimeout> | 0,
    visible: false,
    reached: { top: true, bottom: false, start: true, end: false } as Record<ScrollAreaEdge, boolean>,
    measured: false,
    overflow: null as { x: boolean; y: boolean } | null,
    ends: { atStart: true, atEnd: true, awayFromEnd: false },
    edgeVars: '',
  });

  /* ---------------------------------------------------------------------------- reading and writing offsets */

  const getOffset = useCallback((el: HTMLElement, axis: ScrollAreaAxis) => (axis === 'y' ? el.scrollTop : Math.abs(el.scrollLeft)), []);
  const getRange = useCallback(
    (el: HTMLElement, axis: ScrollAreaAxis) => Math.max(0, axis === 'y' ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth),
    [],
  );
  const setOffset = useCallback((el: HTMLElement, axis: ScrollAreaAxis, value: number) => {
    if (axis === 'y') el.scrollTop = value;
    else el.scrollLeft = live.current.dir === 'rtl' ? -value : value;
  }, []);

  /** Syncs React's follow state with the live one (after a scroll, a key, the wheel). */
  const publishFollow = useCallback(() => {
    if (!settings.current.followMode) return;
    const now = live.current.follow.following;
    if (now !== followingRef.current) setFollowingRef.current(now);
  }, [settings, followingRef, setFollowingRef]);

  /* ---------------------------------------------------------------------------- scrollbar visibility */

  const applyBars = useCallback(() => {
    const s = live.current;
    const mode = settings.current.visibility;
    const show =
      mode === 'always' || mode === 'auto'
        ? true
        : mode === 'hover'
          ? s.hover || s.scrolling || !!s.drag || s.barHover
          : s.scrolling || !!s.drag || s.barHover;
    const write = (visible: boolean) => {
      s.visible = visible;
      for (const bar of [barYRef.current, barXRef.current]) bar?.setAttribute('data-state', visible ? 'visible' : 'hidden');
    };
    if (s.hideTimer) clearTimeout(s.hideTimer);
    s.hideTimer = 0;
    if (show) write(true);
    else if (s.visible) s.hideTimer = setTimeout(() => write(false), settings.current.hideDelay);
    else write(false);
  }, [settings, barXRef, barYRef]);

  /* ---------------------------------------------------------------------------- one frame of geometry */

  const paint = useCallback(
    (d: ScrollEdgeDistances) => {
      const s = live.current;
      const root = rootRef.current;
      const el = viewportRef.current;
      if (!root || !el) return;
      const { orientation: o } = settings.current;
      const over = { x: d.overflowX && o !== 'vertical', y: d.overflowY && o !== 'horizontal' };
      // Reads first (track lengths), then writes.
      const barY = barYRef.current;
      const barX = barXRef.current;
      const trackY = barY?.clientHeight ?? 0;
      const trackX = barX?.clientWidth ?? 0;
      const viewH = el.clientHeight;
      const viewW = el.clientWidth;
      const contentH = el.scrollHeight;
      const contentW = el.scrollWidth;

      // Edge hints: a share 0…1 of the depth, growing with the distance.
      const vars = [over.y ? edgeDepth(d.top) : 0, over.y ? edgeDepth(d.bottom) : 0, over.x ? edgeDepth(d.start) : 0, over.x ? edgeDepth(d.end) : 0].map(
        (v) => Math.round(v * 1000) / 1000,
      );
      const key = vars.join();
      if (key !== s.edgeVars) {
        s.edgeVars = key;
        root.style.setProperty('--_edge-top', String(vars[0]));
        root.style.setProperty('--_edge-bottom', String(vars[1]));
        root.style.setProperty('--_edge-start', String(vars[2]));
        root.style.setProperty('--_edge-end', String(vars[3]));
      }

      const thumbY = thumbYRef.current;
      if (thumbY && trackY > 0) {
        const g = thumbGeometry(viewH, contentH, trackY);
        thumbY.style.setProperty('--_thumb-size', `${g.size}px`);
        thumbY.style.transform = `translate3d(0, ${thumbOffset(d.top, viewH, contentH, g.travel)}px, 0)`;
      }
      const thumbX = thumbXRef.current;
      if (thumbX && trackX > 0) {
        const g = thumbGeometry(viewW, contentW, trackX);
        const offset = thumbOffset(d.start, viewW, contentW, g.travel);
        thumbX.style.setProperty('--_thumb-size', `${g.size}px`);
        thumbX.style.transform = `translate3d(${s.dir === 'rtl' ? -offset : offset}px, 0, 0)`;
      }

      if (!s.overflow || over.x !== s.overflow.x || over.y !== s.overflow.y) {
        s.overflow = over;
        setOverflow(over);
      }

      const { main: axis, threshold: near } = settings.current;
      const [startEdge, endEdge] = EDGES[axis];
      const mainOver = over[axis];
      const toEnd = d[endEdge];
      const nextEnds = { atStart: !mainOver || d[startEdge] <= 1, atEnd: !mainOver || toEnd <= 1, awayFromEnd: mainOver && toEnd > near };
      if (nextEnds.atStart !== s.ends.atStart || nextEnds.atEnd !== s.ends.atEnd || nextEnds.awayFromEnd !== s.ends.awayFromEnd) {
        s.ends = nextEnds;
        setEnds(nextEnds);
      }

      // Each edge once per arrival; the first measurement only records where it opened.
      for (const ax of ['y', 'x'] as const) {
        for (const edge of EDGES[ax]) {
          const reached = over[ax] && d[edge] <= 1;
          if (reached && !s.reached[edge] && s.measured) settings.current.onEdgeReached?.(edge);
          s.reached[edge] = reached;
        }
      }
      s.measured = true;
    },
    [settings, rootRef, viewportRef, barXRef, barYRef, thumbXRef, thumbYRef],
  );

  /* ---------------------------------------------------------------------------- spring glides */

  const finish = useCallback((axis: ScrollAreaAxis, done: boolean) => {
    const glide = live.current.glides[axis];
    if (!glide) return;
    delete live.current.glides[axis];
    for (const resolve of glide.resolvers) resolve(done);
  }, []);

  const stopGlides = useCallback(
    (onlyNonFollow = false) => {
      for (const axis of ['x', 'y'] as const) {
        const glide = live.current.glides[axis];
        if (glide && !(onlyNonFollow && glide.follow)) finish(axis, false);
      }
    },
    [finish],
  );

  const tick = useCallback(
    (now: number) => {
      const s = live.current;
      s.frame = 0;
      const el = viewportRef.current;
      if (!el) return;
      const dt = Math.min(0.064, Math.max(0, (now - s.last) / 1000));
      s.last = now;
      let active = false;
      for (const axis of ['x', 'y'] as const) {
        const glide = s.glides[axis];
        if (!glide) continue;
        if (glide.follow && !s.follow.following) {
          finish(axis, false);
          continue;
        }
        // The reader scrolled on their own (keys, a scroll bar of the page): their scroll wins.
        if (Math.abs(getOffset(el, axis) - glide.written) > 2) {
          finish(axis, false);
          continue;
        }
        active = true;
        // Selecting text or dragging a thumb holds the glide where it is.
        if (s.selecting || s.drag) {
          glide.velocity = 0;
          continue;
        }
        const target = Math.min(glide.target(), getRange(el, axis));
        const settled = stepSpring(glide, target, dt, SPRINGS.smooth, 0.5);
        setOffset(el, axis, glide.value);
        glide.written = getOffset(el, axis);
        if (settled) {
          active = false;
          finish(axis, true);
        }
      }
      if (Object.keys(s.glides).length > 0 || active) s.frame = requestAnimationFrame(tick);
    },
    [viewportRef, finish, getOffset, getRange, setOffset],
  );

  /** Scrolls `axis` to `target()` (re-read every frame, so a growing end is chased with the current velocity). */
  const glide = useCallback(
    (axis: ScrollAreaAxis, target: () => number, opts: { behavior?: ScrollAreaBehavior; follow?: boolean } = {}) =>
      new Promise<boolean>((resolve) => {
        const s = live.current;
        const el = viewportRef.current;
        if (!el) return resolve(false);
        if (opts.behavior === 'instant' || isMotionReduced(el)) {
          finish(axis, false);
          setOffset(el, axis, Math.min(target(), getRange(el, axis)));
          return resolve(true);
        }
        const existing = s.glides[axis];
        if (existing) {
          // Retarget: keep the position and the velocity.
          existing.target = target;
          existing.follow = !!opts.follow;
          existing.resolvers.push(resolve);
        } else {
          const current = getOffset(el, axis);
          const start = opts.follow ? followStart(current, target(), axis === 'y' ? el.clientHeight : el.clientWidth) : current;
          if (start !== current) setOffset(el, axis, start);
          s.glides[axis] = { value: start, velocity: 0, written: getOffset(el, axis), target, follow: !!opts.follow, resolvers: [resolve] };
        }
        if (!s.frame) {
          s.last = performance.now();
          s.frame = requestAnimationFrame(tick);
        }
      }),
    [viewportRef, finish, getOffset, getRange, setOffset, tick],
  );

  const followEnd = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return Promise.resolve(false);
    const axis = settings.current.main;
    return glide(axis, () => getRange(el, axis), { follow: true });
  }, [viewportRef, settings, glide, getRange]);

  /* ---------------------------------------------------------------------------- mount: measure, observe */

  useLayoutEffect(() => {
    const el = viewportRef.current;
    const root = rootRef.current;
    if (!el || !root) return;
    const s = live.current;
    s.dir = getDirection(root);
    if (pending) {
      setOffset(el, settings.current.main, getRange(el, settings.current.main));
      setPending(false);
    }
    s.follow.top = getOffset(el, settings.current.main);
    const content = contentRef.current;
    const stop = observeScrollEdges(
      el,
      (d, change) => {
        paint(d);
        if (change.scrolled) {
          const { followMode: on, threshold: near, main: axis } = settings.current;
          if (on) {
            trackEndFollow(el, s.follow, near, axis);
            publishFollow();
          }
          s.scrolling = true;
          root.setAttribute('data-scrolling', '');
          if (s.scrollTimer) clearTimeout(s.scrollTimer);
          s.scrollTimer = setTimeout(() => {
            s.scrollTimer = 0;
            s.scrolling = false;
            root.removeAttribute('data-scrolling');
            applyBars();
          }, SCROLL_IDLE_MS);
          applyBars();
        }
        if (change.resized && settings.current.followMode && s.follow.following && getRange(el, settings.current.main) - getOffset(el, settings.current.main) > 0.5) {
          void followEnd();
        }
      },
      { observe: content ? [content] : undefined },
    );
    applyBars();
    return () => {
      stop();
      if (s.frame) cancelAnimationFrame(s.frame);
      s.frame = 0;
      if (s.scrollTimer) clearTimeout(s.scrollTimer);
      if (s.hideTimer) clearTimeout(s.hideTimer);
      for (const axis of ['x', 'y'] as const) finish(axis, false);
    };
    // Mount-time setup; `pending` is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orientation, viewportRef, rootRef, contentRef, paint, publishFollow, applyBars, followEnd, finish, getOffset, getRange, setOffset, settings]);

  // Following turned on from outside (a prop, setFollowing, the button): glide to the end.
  const wasFollowing = useRef(followMode && following);
  useEffect(() => {
    const now = followMode && following;
    const before = wasFollowing.current;
    wasFollowing.current = now;
    live.current.follow.following = now;
    if (now && !before) void followEnd();
    if (!now) {
      const g = live.current.glides[main];
      if (g?.follow) finish(main, false);
    }
  }, [followMode, following, followEnd, finish, main]);

  // Text selection: while the mouse button is down inside the viewport, a follow glide holds still.
  useEffect(() => {
    const up = () => {
      live.current.selecting = false;
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  /* ---------------------------------------------------------------------------- imperative API */

  const setFollowing = useCallback(
    (next: boolean) => {
      live.current.follow.following = next;
      setFollowingState(next);
    },
    [setFollowingState],
  );

  const scrollToEnd = useCallback(
    (opts: { behavior?: ScrollAreaBehavior } = {}) => {
      const el = viewportRef.current;
      if (!el) return Promise.resolve(false);
      const axis = settings.current.main;
      if (settings.current.followMode) {
        live.current.follow.following = true;
        wasFollowing.current = true;
        setFollowingState(true);
      }
      return glide(axis, () => getRange(el, axis), { behavior: opts.behavior, follow: settings.current.followMode });
    },
    [viewportRef, settings, setFollowingState, glide, getRange],
  );

  const scrollToStart = useCallback(
    (opts: { behavior?: ScrollAreaBehavior } = {}) => {
      if (settings.current.followMode) setFollowing(false);
      return glide(settings.current.main, () => 0, { behavior: opts.behavior });
    },
    [settings, setFollowing, glide],
  );

  const scrollTo = useCallback(
    ({ top, left, behavior }: { top?: number; left?: number; behavior?: ScrollAreaBehavior }) => {
      const runs: Promise<boolean>[] = [];
      if (top !== undefined) runs.push(glide('y', () => Math.max(0, top), { behavior }));
      if (left !== undefined) runs.push(glide('x', () => Math.max(0, left), { behavior }));
      return Promise.all(runs).then((all) => all.every(Boolean));
    },
    [glide],
  );

  /* ---------------------------------------------------------------------------- handlers */

  const followHandlers = useMemo(
    () => endFollowHandlers(() => viewportRef.current, () => (settings.current.followMode ? live.current.follow : undefined), main),
    [viewportRef, settings, main],
  );

  const onViewportWheel = useCallback(
    (event: WheelEvent) => {
      followHandlers.onWheel(event);
      stopGlides(true);
      publishFollow();
    },
    [followHandlers, stopGlides, publishFollow],
  );
  const onViewportTouchStart = useCallback(
    (event: TouchEvent) => {
      followHandlers.onTouchStart(event);
      stopGlides(true);
    },
    [followHandlers, stopGlides],
  );
  const onViewportTouchMove = useCallback(
    (event: TouchEvent) => {
      followHandlers.onTouchMove(event);
      publishFollow();
    },
    [followHandlers, publishFollow],
  );
  const onViewportKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!SCROLL_KEYS.has(event.key) || event.target !== event.currentTarget) {
        followHandlers.onKeyDown(event);
        publishFollow();
        return;
      }
      followHandlers.onKeyDown(event);
      stopGlides(true);
      publishFollow();
    },
    [followHandlers, stopGlides, publishFollow],
  );
  const onViewportPointerDown = useCallback((event: ReactPointerEvent) => {
    if (event.pointerType === 'mouse' && event.button === 0) live.current.selecting = true;
  }, []);

  const onRootPointerEnter = useCallback(
    (event: ReactPointerEvent) => {
      if (event.pointerType === 'touch') return;
      live.current.hover = true;
      applyBars();
    },
    [applyBars],
  );
  const onRootPointerLeave = useCallback(
    (event: ReactPointerEvent) => {
      if (event.pointerType === 'touch') return;
      live.current.hover = false;
      live.current.barHover = false;
      applyBars();
    },
    [applyBars],
  );

  const scrollbarHandlers = useCallback(
    (axis: ScrollAreaAxis) => ({
      onPointerEnter: (event: ReactPointerEvent) => {
        if (event.pointerType === 'touch') return;
        live.current.barHover = true;
        applyBars();
      },
      onPointerLeave: () => {
        live.current.barHover = false;
        applyBars();
      },
      // A press on the track (not the thumb) pages towards it with a spring.
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (event.button !== 0 || event.target !== event.currentTarget) return;
        const el = viewportRef.current;
        const thumb = axis === 'y' ? thumbYRef.current : thumbXRef.current;
        if (!el || !thumb) return;
        event.preventDefault();
        const bar = event.currentTarget.getBoundingClientRect();
        const knob = thumb.getBoundingClientRect();
        const rtl = live.current.dir === 'rtl';
        const click = axis === 'y' ? event.clientY - bar.top : rtl ? bar.right - event.clientX : event.clientX - bar.left;
        const thumbStart = axis === 'y' ? knob.top - bar.top : rtl ? bar.right - knob.right : knob.left - bar.left;
        const size = axis === 'y' ? knob.height : knob.width;
        const viewport = axis === 'y' ? el.clientHeight : el.clientWidth;
        const content = axis === 'y' ? el.scrollHeight : el.scrollWidth;
        const target = trackPageTarget(getOffset(el, axis), viewport, content, click, thumbStart, size);
        void glide(axis, () => target);
      },
    }),
    [applyBars, viewportRef, thumbXRef, thumbYRef, getOffset, glide],
  );

  const endDrag = useCallback(
    (thumb: HTMLElement) => {
      const drag = live.current.drag;
      if (!drag) return;
      live.current.drag = null;
      thumb.removeAttribute('data-dragging');
      (drag.axis === 'y' ? barYRef.current : barXRef.current)?.removeAttribute('data-dragging');
      applyBars();
    },
    [barXRef, barYRef, applyBars],
  );

  const thumbHandlers = useCallback(
    (axis: ScrollAreaAxis) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;
        const el = viewportRef.current;
        const bar = axis === 'y' ? barYRef.current : barXRef.current;
        if (!el || !bar) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        finish(axis, false);
        const track = axis === 'y' ? bar.clientHeight : bar.clientWidth;
        const viewport = axis === 'y' ? el.clientHeight : el.clientWidth;
        const content = axis === 'y' ? el.scrollHeight : el.scrollWidth;
        const { travel } = thumbGeometry(viewport, content, track);
        const scroll = getOffset(el, axis);
        live.current.drag = {
          axis,
          pointer: axis === 'y' ? event.clientY : event.clientX,
          scroll,
          ratio: travel > 0 ? scrollFromThumb(travel, viewport, content, travel) / travel : 0,
        };
        bar.setAttribute('data-dragging', '');
        event.currentTarget.setAttribute('data-dragging', '');
        applyBars();
      },
      onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
        const drag = live.current.drag;
        const el = viewportRef.current;
        if (!drag || drag.axis !== axis || !el) return;
        const sign = axis === 'x' && live.current.dir === 'rtl' ? -1 : 1;
        const delta = ((axis === 'y' ? event.clientY : event.clientX) - drag.pointer) * sign;
        setOffset(el, axis, Math.min(getRange(el, axis), Math.max(0, drag.scroll + delta * drag.ratio)));
      },
      onPointerUp: (event: ReactPointerEvent<HTMLElement>) => endDrag(event.currentTarget),
      onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => endDrag(event.currentTarget),
      onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => endDrag(event.currentTarget),
    }),
    [viewportRef, barXRef, barYRef, finish, getOffset, getRange, setOffset, applyBars, endDrag],
  );

  /* ---------------------------------------------------------------------------- prop getters */

  const overflowing = overflow.x || overflow.y;
  const corner = orientation === 'both' && overflow.x && overflow.y;

  return {
    followMode,
    following: followMode && following,
    setFollowing,
    overflow,
    atStart: ends.atStart,
    atEnd: ends.atEnd,
    awayFromEnd: ends.awayFromEnd,
    pending,
    scrollToEnd,
    scrollToStart,
    scrollTo,
    viewportId,
    viewportRef,
    getRootProps: (props) =>
      withUserProps(
        {
          ref: setRoot,
          'data-orientation': orientation,
          'data-overflow-x': measuredOverflow ? String(measuredOverflow.x) : undefined,
          'data-overflow-y': measuredOverflow ? String(measuredOverflow.y) : undefined,
          'data-following': (followMode && following) || undefined,
          'data-pending': pending || undefined,
          onPointerEnter: onRootPointerEnter,
          onPointerLeave: onRootPointerLeave,
        },
        props,
      ) as never,
    getViewportProps: (props) =>
      withUserProps(
        {
          ref: setViewport,
          id: viewportId,
          // Focusable and named only while there is something to scroll (axe scrollable-region-focusable).
          tabIndex: overflowing ? 0 : undefined,
          role: overflowing && label ? 'region' : undefined,
          'aria-label': overflowing && label ? label : undefined,
          onWheel: onViewportWheel,
          onTouchStart: onViewportTouchStart,
          onTouchMove: onViewportTouchMove,
          onKeyDown: onViewportKeyDown,
          onPointerDown: onViewportPointerDown,
        },
        props,
      ) as never,
    getContentProps: (props) => withUserProps({ ref: setContent }, props) as never,
    getScrollbarProps: (axis, props) =>
      withUserProps(
        {
          ref: axis === 'y' ? setBarY : setBarX,
          'aria-hidden': true,
          'data-orientation': axis === 'y' ? 'vertical' : 'horizontal',
          'data-overflow': String(overflow[axis]),
          'data-corner': corner || undefined,
          ...scrollbarHandlers(axis),
        },
        props,
      ) as never,
    getThumbProps: (axis, props) =>
      withUserProps({ ref: axis === 'y' ? setThumbY : setThumbX, 'data-orientation': axis === 'y' ? 'vertical' : 'horizontal', ...thumbHandlers(axis) }, props) as never,
    getCornerProps: (props) => withUserProps({ 'aria-hidden': true, 'data-visible': corner || undefined }, props) as never,
    getScrollButtonProps: (props) =>
      withUserProps(
        {
          'aria-controls': viewportId,
          'data-orientation': main === 'y' ? 'vertical' : 'horizontal',
          onClick: () => void scrollToEnd(),
        },
        props,
      ) as never,
  };
}
