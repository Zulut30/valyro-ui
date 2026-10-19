'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type FocusEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { useControllableState } from '../primitives/useControllableState';
import { getDirection, inlineArrowStep, useEventCallback } from '../primitives/utils';
import { createVelocityTracker } from '../primitives/velocity';
import { withUserProps, type UserProps } from '../primitives/prop-getters';
import { useLayoutEffect } from '../primitives/react-compat';
import { pageCount, pageFromScroll, resolveSlidesPerView, stepPage, type SlidesPerView } from './carousel-math';

/*
 * The behaviour of Carousel without its markup (WAI-ARIA APG carousel): a scroll-snap track whose page follows
 * swipes, trackpads and keyboard scrolling, previous / next (wrapping with `loop`), arrows / Home / End on the
 * focused track (mirrored under dir="rtl"), a mouse drag with a flick, page indicators, and autoplay that pauses on
 * hover, focus, a hidden tab and reduced motion (until the user presses play), with a rotation control. Moves the
 * user makes are read out by a polite live region, silent while the slides rotate. Carousel renders with it.
 */

export interface CarouselLabels {
  /** Spoken in place of "region" for the carousel. */
  roleDescription: string;
  /** Spoken in place of "group" for each slide. */
  slideRoleDescription: string;
  /** Name of each slide, e.g. "2 of 6". */
  slide: (index: number, count: number) => string;
  /** Name of the scrolling slide container. */
  slides: string;
  /** Name of the dot / thumbnail group. */
  pagination: string;
  goTo: (index: number) => string;
  previous: string;
  next: string;
  /** Rotation control while stopped / while rotating. */
  play: string;
  pause: string;
}

export const defaultCarouselLabels: CarouselLabels = {
  roleDescription: 'carousel',
  slideRoleDescription: 'slide',
  slide: (index, count) => `${index + 1} of ${count}`,
  slides: 'Slides',
  pagination: 'Choose slide',
  goTo: (index) => `Go to slide ${index + 1}`,
  previous: 'Previous slide',
  next: 'Next slide',
  play: 'Start automatic slide show',
  pause: 'Stop automatic slide show',
};

export interface CarouselOptions {
  /** Number of slides. */
  count: number;
  /** Slides visible at once: a number (fractions peek at the next slide) or `{ minWidth: count }` by carousel width. Default 1. */
  slidesPerView?: SlidesPerView;
  /** Space between slides in px, as the track lays them out. Default 16. */
  gap?: number;
  /** Index of the first visible slide (the page). */
  index?: number;
  defaultIndex?: number;
  onIndexChange?: (index: number) => void;
  /** Previous / next wrap around at the ends. */
  loop?: boolean;
  /** Advance automatically: `true` (every 5 s) or an interval in ms. */
  autoplay?: boolean | number;
  /** `center`: every slide is a page and rests in the middle. Default `start`. */
  align?: 'start' | 'center';
  labels?: Partial<CarouselLabels>;
}

export interface CarouselState {
  /** The current page: the first visible slide (or the centred one). */
  index: number;
  /** Snap positions: one per slide when centred, else as many as it takes to show every slide. */
  pages: number;
  /** Slides per view at the measured width. */
  perView: number;
  goTo: (page: number) => void;
  previous: () => void;
  next: () => void;
  /** Previous / next are possible (always, with `loop`). */
  canGoPrevious: boolean;
  canGoNext: boolean;
  /** Autoplay is set (an interval) and there is more than one page: show the rotation control. */
  autoplay: boolean;
  /** The slides advance right now. */
  rotating: boolean;
  /** The user paused, or reduced motion is on and they never pressed play: the control offers play. */
  stopped: boolean;
  /** The rotation control's press. */
  togglePlay: () => void;
  /** Whether a slide is in view (the current one when centred). */
  isSlideVisible: (index: number) => boolean;
  /** The `<section>`: role description, the width measure and the pause on hover and focus. */
  getRootProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & { ref: (node: HTMLElement | null) => void };
  /** The scrolling track: a named, focusable group with the keys, the drag and the page from the scroll position. */
  getTrackProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & { ref: (node: HTMLElement | null) => void };
  /** A slide: a group named "n of N" with the slide role description. Its first child sets the page width. */
  getSlideProps: (index: number, props?: UserProps) => HTMLAttributes<HTMLElement> & { 'data-current'?: true; 'data-active'?: true };
  getPreviousProps: (props?: UserProps) => ButtonHTMLAttributes<HTMLButtonElement> & { ref: (node: HTMLButtonElement | null) => void };
  getNextProps: (props?: UserProps) => ButtonHTMLAttributes<HTMLButtonElement> & { ref: (node: HTMLButtonElement | null) => void };
  /** The play / pause control. */
  getRotationProps: (props?: UserProps) => ButtonHTMLAttributes<HTMLButtonElement>;
  /** The group of dots or thumbnails (a scrolling strip keeps the current one in view). */
  getIndicatorsProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & { ref: (node: HTMLElement | null) => void };
  /** A dot (one per page) or a thumbnail (one per slide): goes to its page. */
  getIndicatorProps: (index: number, props?: UserProps) => ButtonHTMLAttributes<HTMLButtonElement>;
  /** The visually hidden live region that reads out the slide a move landed on. */
  getLiveRegionProps: (props?: UserProps) => HTMLAttributes<HTMLElement>;
}

const DEFAULT_INTERVAL = 5000;
const DRAG_SLOP = 6;

/** A stable ref callback that fills `ref`. */
function useCallbackRef<E>() {
  const ref = useRef<E | null>(null);
  const [set] = useState(() => (node: E | null) => {
    ref.current = node;
  });
  return [ref, set] as const;
}

export function useCarousel({
  count,
  slidesPerView = 1,
  gap = 16,
  index: indexProp,
  defaultIndex = 0,
  onIndexChange,
  loop = false,
  autoplay = false,
  align = 'start',
  labels: labelsProp,
}: CarouselOptions): CarouselState {
  const labels = { ...defaultCarouselLabels, ...labelsProp };
  const [width, setWidth] = useState(0);
  const perView = resolveSlidesPerView(slidesPerView, width);
  const centered = align === 'center';
  // Centred, the track is padded by half the free space, so every slide (the last one too) can rest in the middle.
  const pages = centered ? count : pageCount(count, perView);
  const [indexState, setIndex] = useControllableState({ value: indexProp, defaultValue: defaultIndex, onChange: onIndexChange });
  const index = Math.min(Math.max(0, indexState), Math.max(0, pages - 1));

  const [rootRef, setRoot] = useCallbackRef<HTMLElement>();
  const [trackRef, setTrack] = useCallbackRef<HTMLElement>();
  const [indicatorsRef, setIndicators] = useCallbackRef<HTMLElement>();
  const [prevRef, setPrev] = useCallbackRef<HTMLButtonElement>();
  const [nextRef, setNext] = useCallbackRef<HTMLButtonElement>();
  // Page the track is scrolled to (or heading for), so scroll events and index changes don't fight.
  const shownPage = useRef(index);
  const [announcement, setAnnouncement] = useState('');

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const measure = () => setWidth(root.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [rootRef]);

  const metrics = useCallback(() => {
    const track = trackRef.current;
    const first = track?.firstElementChild as HTMLElement | null;
    if (!track || !first) return null;
    return { track, step: first.offsetWidth + gap, max: track.scrollWidth - track.clientWidth };
  }, [gap, trackRef]);

  const scrollToPage = useCallback(
    (page: number, smooth = true) => {
      const m = metrics();
      if (!m) return;
      shownPage.current = page;
      const target = page >= pages - 1 ? m.max : page * m.step;
      const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      // RTL tracks scroll towards negative offsets.
      const sign = getDirection(m.track) === 'rtl' ? -1 : 1;
      m.track.scrollTo({ left: sign * target, behavior: smooth && !reduced ? 'smooth' : 'auto' });
    },
    [metrics, pages],
  );

  // Follow index changes made from outside (and keep the position when the layout changes).
  useEffect(() => {
    if (shownPage.current !== index) scrollToPage(index);
  }, [index, scrollToPage]);
  useEffect(() => {
    scrollToPage(shownPage.current, false);
  }, [perView, width, scrollToPage]);

  const goTo = (page: number, announceIt = true) => {
    if (page === index) return;
    setIndex(page);
    scrollToPage(page);
    if (announceIt) setAnnouncement(labels.slide(page, pages));
  };

  // The page settles from the scroll position (swipes, trackpads, keyboard scrolling).
  const frame = useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const m = metrics();
      if (!m || drag.current) return;
      const page = pageFromScroll(Math.abs(m.track.scrollLeft), m.step, m.max, pages);
      if (page === shownPage.current && page !== index) return;
      shownPage.current = page;
      if (page !== index) setIndex(page);
    });
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  /* ── Autoplay (paused on hover, focus, hidden tab, reduced motion or by the user) ── */
  const interval = autoplay === true ? DEFAULT_INTERVAL : typeof autoplay === 'number' ? autoplay : 0;
  const [userPaused, setUserPaused] = useState<boolean | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);

  useEffect(() => {
    if (!interval) return;
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(query.matches);
    const visibility = () => setPageHidden(document.hidden);
    sync();
    query.addEventListener('change', sync);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      query.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [interval]);

  // Stopped means: the user pressed pause, or reduced motion is on and they never pressed play.
  const stopped = userPaused ?? reducedMotion;
  const rotating = interval > 0 && !stopped && !hovered && !focused && !pageHidden && pages > 1;
  const advance = useEventCallback(() => goTo(stepPage(index, 1, pages, true), false));
  useEffect(() => {
    if (!rotating) return;
    const timer = setInterval(advance, interval);
    return () => clearInterval(timer);
  }, [rotating, interval, advance]);

  /* ── Mouse drag (touch and trackpads scroll natively) ── */
  const drag = useRef<{ x: number; scroll: number; moved: number } | null>(null);
  const [tracker] = useState(() => createVelocityTracker());
  const suppressClick = useRef(false);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || pages <= 1) return;
    drag.current = { x: event.clientX, scroll: event.currentTarget.scrollLeft, moved: 0 };
    tracker.reset();
    tracker.add(event.clientX, event.timeStamp);
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = event.clientX - d.x;
    d.moved = Math.max(d.moved, Math.abs(dx));
    if (d.moved < DRAG_SLOP) return;
    if (!event.currentTarget.hasAttribute('data-dragging')) {
      event.currentTarget.setAttribute('data-dragging', '');
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    event.currentTarget.scrollLeft = d.scroll - dx;
    tracker.add(event.clientX, event.timeStamp);
  };
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved < DRAG_SLOP) return;
    event.currentTarget.removeAttribute('data-dragging');
    suppressClick.current = true;
    const m = metrics();
    if (!m) return;
    const rtl = getDirection(m.track) === 'rtl';
    // A flick moves on one page; otherwise the nearest page wins.
    const velocity = tracker.velocity(event.timeStamp) * (rtl ? -1 : 1);
    const nearest = pageFromScroll(Math.abs(m.track.scrollLeft), m.step, m.max, pages);
    const page = Math.abs(velocity) > 0.3 ? stepPage(shownPage.current, velocity < 0 ? 1 : -1, pages, false) : nearest;
    if (page !== index) {
      setIndex(page);
      setAnnouncement(labels.slide(page, pages));
    }
    scrollToPage(page);
  };

  const onTrackKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.target !== event.currentTarget) return;
    const step = inlineArrowStep(event.key, getDirection(event.currentTarget));
    let page: number | null = null;
    if (step) page = stepPage(index, step, pages, loop);
    else if (event.key === 'Home') page = 0;
    else if (event.key === 'End') page = pages - 1;
    if (page === null) return;
    event.preventDefault();
    goTo(page);
  };

  // Keep the current dot or thumbnail in view inside its strip (without scrolling the page).
  useEffect(() => {
    const strip = indicatorsRef.current;
    const thumb = strip?.children[index] as HTMLElement | undefined;
    if (!strip || !thumb) return;
    const start = thumb.offsetLeft - strip.offsetLeft;
    if (start < strip.scrollLeft || start + thumb.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: start - (strip.clientWidth - thumb.offsetWidth) / 2, behavior: reducedMotion ? 'auto' : 'smooth' });
    }
  }, [index, reducedMotion, indicatorsRef]);

  const canGoPrevious = loop || index > 0;
  const canGoNext = loop || index < pages - 1;
  const previous = () => goTo(stepPage(index, -1, pages, loop));
  const next = () => goTo(stepPage(index, 1, pages, loop));
  // An arrow disables (and hides) at its end: focus moves to the other arrow. After the re-render: with two
  // slides the other arrow is still disabled now and would refuse focus.
  const onPreviousClick = () => {
    previous();
    if (!loop && stepPage(index, -1, pages, loop) === 0) requestAnimationFrame(() => nextRef.current?.focus());
  };
  const onNextClick = () => {
    next();
    if (!loop && stepPage(index, 1, pages, loop) === pages - 1) requestAnimationFrame(() => prevRef.current?.focus());
  };
  const isSlideVisible = (i: number) => (centered ? i === index : i >= index && i < index + Math.ceil(perView));

  return {
    index,
    pages,
    perView,
    goTo: (page) => goTo(page),
    previous,
    next,
    canGoPrevious,
    canGoNext,
    autoplay: interval > 0 && pages > 1,
    rotating,
    stopped,
    togglePlay: () => setUserPaused(!stopped),
    isSlideVisible,
    getRootProps: (props) =>
      withUserProps(
        {
          ref: setRoot,
          'aria-roledescription': labels.roleDescription,
          onPointerEnter: () => setHovered(true),
          onPointerLeave: () => setHovered(false),
          onFocus: () => setFocused(true),
          onBlur: (event: FocusEvent<HTMLElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
          },
        },
        props,
      ) as never,
    getTrackProps: (props) =>
      withUserProps(
        {
          ref: setTrack,
          role: 'group',
          'aria-label': labels.slides,
          tabIndex: 0,
          onScroll,
          onKeyDown: onTrackKeyDown,
          onPointerDown,
          onPointerMove,
          onPointerUp,
          onPointerCancel: onPointerUp,
          onClickCapture: (event: MouseEvent) => {
            // A drag that ends over a link or button is not a click.
            if (!suppressClick.current) return;
            suppressClick.current = false;
            event.preventDefault();
            event.stopPropagation();
          },
          onDragStart: (event: { preventDefault: () => void }) => event.preventDefault(),
        },
        props,
      ) as never,
    getSlideProps: (i, props) =>
      withUserProps(
        {
          role: 'group',
          'aria-roledescription': labels.slideRoleDescription,
          'aria-label': labels.slide(i, count),
          'data-current': isSlideVisible(i) || undefined,
          'data-active': i === index || undefined,
        },
        props,
      ) as never,
    getPreviousProps: (props) =>
      withUserProps({ ref: setPrev, type: 'button', 'aria-label': labels.previous, disabled: !canGoPrevious, onClick: onPreviousClick }, props) as never,
    getNextProps: (props) =>
      withUserProps({ ref: setNext, type: 'button', 'aria-label': labels.next, disabled: !canGoNext, onClick: onNextClick }, props) as never,
    getRotationProps: (props) =>
      withUserProps({ type: 'button', 'aria-label': stopped ? labels.play : labels.pause, onClick: () => setUserPaused(!stopped) }, props) as never,
    getIndicatorsProps: (props) => withUserProps({ ref: setIndicators, role: 'group', 'aria-label': labels.pagination }, props) as never,
    getIndicatorProps: (i, props) =>
      withUserProps(
        {
          type: 'button',
          'aria-label': labels.goTo(i),
          'aria-current': i === index || undefined,
          onClick: () => goTo(Math.min(i, pages - 1)),
        },
        props,
      ) as never,
    getLiveRegionProps: (props) =>
      withUserProps({ 'aria-live': rotating ? 'off' : 'polite', 'aria-atomic': true, children: announcement }, props) as never,
  };
}
