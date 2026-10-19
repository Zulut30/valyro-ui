'use client';

import { Children, useCallback, useEffect, useRef, useState, type ComponentPropsWithRef, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon } from '../icons';
import {
  createVelocityTracker,
  cx,
  getDirection,
  inlineArrowStep,
  mergeRefs,
  useControllableState,
  useEventCallback,
} from '../primitives';
import { IconButton } from '../basic/IconButton';
import { pageCount, pageFromScroll, resolveSlidesPerView, stepPage, type SlidesPerView } from './carousel-math';
import '../primitives/motion.css';
import './Carousel.css';
import { withRef, useLayoutEffect, inertAttr } from '../primitives/react-compat';

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

export interface CarouselProps extends Omit<ComponentPropsWithRef<'section'>, 'children' | 'onChange'> {
  /** One child per slide. */
  children: ReactNode;
  /** Slides visible at once: a number (fractions peek at the next slide) or `{ minWidth: count }` by carousel width. */
  slidesPerView?: SlidesPerView;
  /** Space between slides in px (default 16). */
  gap?: number;
  /** Index of the first visible slide (controlled). */
  index?: number;
  defaultIndex?: number;
  onIndexChange?: (index: number) => void;
  /** Previous/next wrap around at the ends. */
  loop?: boolean;
  /**
   * Advance automatically: `true` (every 5 s) or an interval in ms. Pauses on hover and focus, and
   * stays off when the user prefers reduced motion until they press play.
   */
  autoplay?: boolean | number;
  /**
   * Previous / next buttons over the slides (default true). With a mouse they appear on hover or
   * keyboard focus (touch screens always show them); `'always'` keeps them visible at rest too.
   */
  showArrows?: boolean | 'always';
  /**
   * Where the current slide rests: `start` (default) or `center`, with the neighbours peeking on both
   * sides and fading out at the edges. With `center` every slide is a snap position.
   */
  align?: 'start' | 'center';
  /** Dots, a thumbnail strip (with `renderThumbnail`), or nothing (default dots). */
  indicators?: 'dots' | 'thumbnails' | 'none';
  /** Content of the thumbnail button for the slide at `index`; required for `indicators="thumbnails"`. */
  renderThumbnail?: (index: number) => ReactNode;
  /**
   * `spring`: the current slide stands out — the others shrink, dim and stay inert on a spring — and the active dot
   * stretches into a pill with a bounce. Pairs well with a fractional `slidesPerView` (1.3) that shows the
   * neighbours. `default`: plain slides.
   */
  animation?: 'default' | 'spring';
  labels?: Partial<CarouselLabels>;
}

const DEFAULT_INTERVAL = 5000;
const DRAG_SLOP = 6;

/**
 * Scroll-snap carousel: swipe or drag, arrows, dots or thumbnails, several slides per view and
 * optional autoplay with a rotation control (WAI-ARIA APG carousel pattern).
 */
export const Carousel = withRef(function Carousel({
  children,
  slidesPerView = 1,
  gap = 16,
  index: indexProp,
  defaultIndex = 0,
  onIndexChange,
  loop = false,
  autoplay = false,
  showArrows = true,
  align = 'start',
  indicators = 'dots',
  animation = 'default',
  renderThumbnail,
  labels: labelsProp,
  className,
  style,
  ref,
  ...rest
}: CarouselProps) {
  const labels = { ...defaultCarouselLabels, ...labelsProp };
  const slides = Children.toArray(children);
  const count = slides.length;
  const [width, setWidth] = useState(0);
  const perView = resolveSlidesPerView(slidesPerView, width);
  const centered = align === 'center';
  // Centred, the track is padded by half the free space, so every slide (the last one too) can rest in the middle.
  const pages = centered ? count : pageCount(count, perView);
  const [indexState, setIndex] = useControllableState({ value: indexProp, defaultValue: defaultIndex, onChange: onIndexChange });
  const index = Math.min(Math.max(0, indexState), Math.max(0, pages - 1));

  const rootRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbsRef = useRef<HTMLDivElement>(null);
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  // Page the track is scrolled to (or heading for), so scroll events and index changes don't fight.
  const shownPage = useRef(index);
  const [announce, setAnnounce] = useState('');

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => setWidth(root.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const metrics = useCallback(() => {
    const track = trackRef.current;
    const first = track?.firstElementChild as HTMLElement | null;
    if (!track || !first) return null;
    return { track, step: first.offsetWidth + gap, max: track.scrollWidth - track.clientWidth };
  }, [gap]);

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
    if (announceIt) setAnnounce(labels.slide(page, pages));
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

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || pages <= 1) return;
    drag.current = { x: event.clientX, scroll: event.currentTarget.scrollLeft, moved: 0 };
    tracker.reset();
    tracker.add(event.clientX, event.timeStamp);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
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
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
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
      setAnnounce(labels.slide(page, pages));
    }
    scrollToPage(page);
  };

  const onTrackKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const step = inlineArrowStep(event.key, getDirection(event.currentTarget));
    let page: number | null = null;
    if (step) page = stepPage(index, step, pages, loop);
    else if (event.key === 'Home') page = 0;
    else if (event.key === 'End') page = pages - 1;
    if (page === null) return;
    event.preventDefault();
    goTo(page);
  };

  // Keep the active thumbnail in view inside its strip (without scrolling the page).
  useEffect(() => {
    const strip = thumbsRef.current;
    const thumb = strip?.children[index] as HTMLElement | undefined;
    if (!strip || !thumb) return;
    const start = thumb.offsetLeft - strip.offsetLeft;
    if (start < strip.scrollLeft || start + thumb.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: start - (strip.clientWidth - thumb.offsetWidth) / 2, behavior: reducedMotion ? 'auto' : 'smooth' });
    }
  }, [index, reducedMotion]);

  const atStart = !loop && index === 0;
  const atEnd = !loop && index >= pages - 1;
  // The control shows the user's choice; hover and focus only pause the rotation for a moment.
  const RotationIcon = stopped ? PlayIcon : PauseIcon;

  return (
    <section
      aria-roledescription={labels.roleDescription}
      {...rest}
      ref={mergeRefs(rootRef, ref)}
      className={cx('ui-carousel', className)}
      style={{ ...style, '--_per-view': perView, '--_gap': `${gap}px` } as CSSProperties}
      data-indicators={indicators}
      data-align={centered ? 'center' : undefined}
      data-arrows={showArrows === 'always' ? 'always' : undefined}
      data-motion={animation === 'spring' ? 'spring' : undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <div className="ui-carousel__stage">
        {/* Controls come first in the tab order, as the APG pattern asks. */}
        {interval > 0 && pages > 1 && (
          <IconButton
            className="ui-carousel__rotation"
            size="sm"
            round
            variant="secondary"
            icon={<RotationIcon />}
            label={stopped ? labels.play : labels.pause}
            onClick={() => setUserPaused(!stopped)}
          />
        )}
        {showArrows && pages > 1 && (
          <>
            <IconButton
              className="ui-carousel__arrow"
              data-side="start"
              round
              variant="secondary"
              icon={<ChevronLeftIcon />}
              label={labels.previous}
              ref={prevRef}
              disabled={atStart}
              onClick={() => {
                const page = stepPage(index, -1, pages, loop);
                goTo(page);
                // The arrow disables (and hides) at the first slide: keep focus on the stage's other arrow.
                // After the re-render: with two slides the other arrow is still disabled now and would refuse focus.
                if (!loop && page === 0) requestAnimationFrame(() => nextRef.current?.focus());
              }}
            />
            <IconButton
              className="ui-carousel__arrow"
              data-side="end"
              round
              variant="secondary"
              icon={<ChevronRightIcon />}
              label={labels.next}
              ref={nextRef}
              disabled={atEnd}
              onClick={() => {
                const page = stepPage(index, 1, pages, loop);
                goTo(page);
                if (!loop && page === pages - 1) requestAnimationFrame(() => prevRef.current?.focus());
              }}
            />
          </>
        )}
        <div
          ref={trackRef}
          role="group"
          aria-label={labels.slides}
          tabIndex={0}
          className="ui-carousel__track"
          onScroll={onScroll}
          onKeyDown={onTrackKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClickCapture={(event) => {
            // A drag that ends over a link or button is not a click.
            if (!suppressClick.current) return;
            suppressClick.current = false;
            event.preventDefault();
            event.stopPropagation();
          }}
          onDragStart={(event) => event.preventDefault()}
        >
          {slides.map((slide, i) => (
            <div
              key={i}
              role="group"
              aria-roledescription={labels.slideRoleDescription}
              aria-label={labels.slide(i, count)}
              className="ui-carousel__slide"
              data-current={(centered ? i === index : i >= index && i < index + Math.ceil(perView)) || undefined}
              data-active={i === index || undefined}
              // Spring dims every slide but the current one; a dimmed slide is inactive until it becomes current.
              inert={inertAttr((animation === 'spring' && i !== index) || undefined)}
            >
              {slide}
            </div>
          ))}
        </div>
      </div>

      {indicators === 'dots' && pages > 1 && (
        <div role="group" aria-label={labels.pagination} className="ui-carousel__dots">
          {Array.from({ length: pages }, (_, i) => (
            <button
              key={i}
              type="button"
              className="ui-carousel__dot"
              aria-label={labels.goTo(i)}
              aria-current={i === index || undefined}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
      )}

      {indicators === 'thumbnails' && renderThumbnail && (
        <div ref={thumbsRef} role="group" aria-label={labels.pagination} className="ui-carousel__thumbs">
          {Array.from({ length: count }, (_, i) => (
            <button
              key={i}
              type="button"
              className="ui-carousel__thumb"
              aria-label={labels.goTo(i)}
              aria-current={i === index || undefined}
              onClick={() => goTo(Math.min(i, pages - 1))}
            >
              {renderThumbnail(i)}
            </button>
          ))}
        </div>
      )}

      <div className="ui-sr-only" aria-live={rotating ? 'off' : 'polite'} aria-atomic="true">
        {announce}
      </div>
    </section>
  );
});
