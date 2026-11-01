'use client';

import { useEffect, useRef, useState, type ComponentPropsWithRef } from 'react';
import { cx, getDirection, mergeRefs } from '../primitives';
import { withRef, useLayoutEffect } from '../primitives/react-compat';
import { isMotionReduced, useMotionReduced } from './preference';
import { readMotionProfile } from './profile';
import { knownRenderTier, onRenderTier, type PageTransitionTierSetting } from './render-tier';
import { observeIntersection, onLayoutShift } from './scheduler';
import { scrollEffectSpec, stackRanges, viewRangeProgress, type ScrollEffectPreset, type ScrollEffectSpec, type ScrollEffectTier, type ScrollRangePoint } from './scroll-effects';
import './ScrollEffect.css';

/*
 * ScrollEffect is in the free core, Reveal and Stagger are not: the few helpers it shares with them in
 * timeline.ts, entrance.ts and useReveal.ts are repeated here in the small, so the free package carries none
 * of those modules (nor their exports).
 */

export interface ScrollEffectProps extends ComponentPropsWithRef<'div'> {
  /**
   * How the content answers the scroll: enters as it scrolls into view (`fade-up`, `scale-in`…), follows the
   * scroll while it passes (`parallax`, `progress`, `stack`, `horizontal`, `text-fill`…) or leaves as it
   * scrolls out at the top (`fade-out`…). Seven presets are free; the other seventeen need ValyroUI Pro.
   */
  preset?: ScrollEffectPreset;
  /** Multiplies the preset's travel, turn, zoom and blur: 0.5 is half as far, 2 twice as far. */
  strength?: number;
  /** The stretch of the scroll that plays it, in CSS animation-range terms: `['entry 0%', 'cover 50%']`. Default: the preset's own. */
  range?: [ScrollRangePoint, ScrollRangePoint];
  /**
   * gpu — the full preset; cpu — its one-layer variant for machines that composite on the processor
   * (virtual machines, remote desktops, software WebGL); auto — cpu on such machines and on devices with two
   * cores or 2 GB of memory or less, detected while the browser is idle; gpu elsewhere.
   */
  tier?: PageTransitionTierSetting;
  /** Off: the content stays at rest and nothing is animated. */
  disabled?: boolean;
}

interface TimelineHost {
  ViewTimeline?: new (options: { subject: Element; axis?: 'block' | 'inline' }) => AnimationTimeline;
  ScrollTimeline?: new (options: { source: Element; axis?: 'block' | 'inline' }) => AnimationTimeline;
}

type Range = readonly [string, string];

/** One element that moves: its keyframes and, on a view timeline, its stretch of the scroll. */
interface Track {
  element: HTMLElement;
  keyframes: Keyframe[];
  range?: Range;
}

const timelines = () => globalThis as typeof globalThis & TimelineHost;

/** Whether the browser plays animations on scroll timelines from script: view() and animation-range in CSS, and the constructors. */
const hasScrollTimelines = () =>
  typeof CSS !== 'undefined' &&
  !!CSS.supports?.('animation-timeline: view()') &&
  CSS.supports('animation-range: cover') &&
  typeof timelines().ViewTimeline === 'function' &&
  typeof timelines().ScrollTimeline === 'function';

/** Entrances start a little before the element is fully on screen, as Reveal's do. */
const ENTRY_MARGIN = '0px 0px -8% 0px';

const SCROLLS = /^(auto|scroll|overlay)$/;
const CLIPS = /^(auto|scroll|hidden|overlay)$/;

/**
 * The box a view() timeline of `element` follows: the nearest ancestor whose overflow clips, whether or not
 * it scrolls, or null for the page. When that is not the box the reader scrolls, the listener stays.
 */
function timelineBox(element: Element): HTMLElement | null {
  for (let node = element.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(node);
    if (CLIPS.test(overflowX) || CLIPS.test(overflowY)) return node;
  }
  return null;
}

/** The nearest ancestor the reader scrolls vertically, or null for the page. */
function scrollerOf(element: Element): HTMLElement | null {
  for (let node = element.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    if (SCROLLS.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

/** The sum of offsetTop up the offset parents, until `stop`: layout positions, which transforms don't change. */
function offsetsTo(element: HTMLElement, stop: HTMLElement | null) {
  let top = 0;
  for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) {
    if (node === stop) return { top, reached: true };
    top += node.offsetTop;
  }
  return { top, reached: false };
}

/**
 * Where the element's box sits in its scroller's content, px — as laid out, not as drawn, so its own
 * animated transform never feeds back into its progress.
 */
function contentTop(element: HTMLElement, scroller: HTMLElement | null): number {
  const own = offsetsTo(element, scroller);
  if (!scroller || own.reached) return own.top;
  return own.top - offsetsTo(scroller, null).top - scroller.clientTop;
}

const viewportHeight = (scroller: HTMLElement | null) => (scroller ? scroller.clientHeight : document.documentElement.clientHeight);
const scrollTopOf = (scroller: HTMLElement | null) => (scroller ? scroller.scrollTop : (document.scrollingElement ?? document.documentElement).scrollTop);

/** The box ScrollEffect wraps the content in, for the presets that move it rather than the element itself. */
const innerOf = (root: HTMLElement) =>
  root.querySelector<HTMLElement>(':scope > .ui-scroll-effect__inner, :scope > .ui-scroll-effect__text, :scope > .ui-scroll-effect__pin > .ui-scroll-effect__track');

const childrenOf = (root: HTMLElement) => Array.from(root.children).filter((node): node is HTMLElement => node instanceof HTMLElement);

interface Settings {
  build: (travel: number) => ScrollEffectSpec;
  range?: Range;
  tier: ScrollEffectTier;
}

/** horizontal: the frame takes the scrollport's height, the element that plus the travel. Returns the travel. */
function measureHorizontal(root: HTMLElement, scroller: HTMLElement | null): number {
  const pin = root.querySelector<HTMLElement>(':scope > .ui-scroll-effect__pin');
  const track = pin?.firstElementChild as HTMLElement | null;
  if (!pin || !track) return 0;
  root.style.setProperty('--_viewport', `${viewportHeight(scroller)}px`);
  const travel = Math.max(0, track.offsetWidth - pin.clientWidth);
  root.style.setProperty('--_travel', `${travel}px`);
  return travel;
}

/** The elements that move and their keyframes and stretches, for the layout as it is laid out now. */
function tracksOf(root: HTMLElement, spec: ScrollEffectSpec, scroller: HTMLElement | null, override?: Range): Track[] {
  const range = override ?? spec.range;
  if (spec.target === 'self') return [{ element: root, keyframes: spec.keyframes, range }];
  if (spec.target === 'child') {
    const inner = innerOf(root);
    return inner ? [{ element: inner, keyframes: spec.keyframes, range }] : [];
  }
  const children = childrenOf(root);
  if (spec.layout !== 'stack') return children.map((element, i) => ({ element, keyframes: spec.layer?.(i, children.length) ?? spec.keyframes, range }));
  // Sticky cards: each but the last recedes from when it sticks until the next card sticks over it.
  const gap = parseFloat(getComputedStyle(root).rowGap) || 0;
  let next = parseFloat(getComputedStyle(root).paddingTop) || 0;
  const tops = children.map((card) => {
    const top = next;
    next += card.offsetHeight + gap;
    return top;
  });
  const ranges = stackRanges(tops, children.map((card) => parseFloat(getComputedStyle(card).top) || 0), viewportHeight(scroller));
  return ranges.map(([start, end], i) => ({ element: children[i], keyframes: spec.keyframes, range: [`cover ${start}px`, `cover ${end}px`] as const }));
}

/**
 * Plays the effect on `root` until the returned cleanup: on a scroll timeline where the browser has them
 * (nothing runs per frame), else on a timer once in view (entrances) or following a scroll listener that is
 * attached only while the element is on screen. Layouts that depend on sizes (stack, horizontal) start over
 * when the element, its track or the window is resized.
 */
function runEffect(root: HTMLElement, { build, range, tier }: Settings): () => void {
  const scroller = scrollerOf(root);
  const first = build(0);
  if (!first.keyframes.length && !first.layer) return () => {};
  const native = hasScrollTimelines() && (first.timeline === 'scroll' || timelineBox(root) === scroller);
  root.setAttribute('data-active', '');
  if (tier === 'cpu') root.setAttribute('data-tier', 'cpu');

  let stopRun = () => {};
  let measured = '';
  const start = () => {
    const travel = first.layout === 'horizontal' ? measureHorizontal(root, scroller) : 0;
    const spec = first.layout === 'horizontal' ? build(travel) : first;
    const tracks = tracksOf(root, spec, scroller, range);
    // The sizes the stretches came from: a resize that changes none of them changes nothing.
    const key = `${travel}|${tracks.map((track) => track.range?.join(' ')).join(',')}`;
    if (key === measured) return;
    measured = key;
    stopRun();
    stopRun = native ? playOnTimeline(root, spec, tracks, scroller) : spec.fallback === 'play' ? playOnEntry(root, tracks, spec, scroller, tier) : followScroll(root, spec, tracks, scroller);
  };
  start();

  // Printing gets the content at rest, in its static layout.
  const beforePrint = () => {
    stopRun();
    stopRun = () => {};
    measured = '';
    root.removeAttribute('data-active');
  };
  const afterPrint = () => {
    root.setAttribute('data-active', '');
    start();
  };
  window.addEventListener('beforeprint', beforePrint);
  window.addEventListener('afterprint', afterPrint);

  // The pinned frame clips the track: a control tabbed to in a card off to the side must be scrolled into sight.
  const onFocus = (event: FocusEvent) => {
    if (root.hasAttribute('data-active')) bringIntoTrack(root, event.target as Element, scroller);
  };
  if (first.layout === 'horizontal') root.addEventListener('focusin', onFocus);

  let stopResize = () => {};
  if (first.layout === 'stack' || first.layout === 'horizontal') {
    let frame = 0;
    const later = () => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        start();
      });
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(later);
    observer?.observe(root);
    const track = root.querySelector('.ui-scroll-effect__track');
    if (track) observer?.observe(track);
    if (scroller) observer?.observe(scroller);
    window.addEventListener('resize', later, { passive: true });
    stopResize = () => {
      observer?.disconnect();
      window.removeEventListener('resize', later);
      cancelAnimationFrame(frame);
    };
  }

  return () => {
    stopResize();
    stopRun();
    root.removeEventListener('focusin', onFocus);
    window.removeEventListener('beforeprint', beforePrint);
    window.removeEventListener('afterprint', afterPrint);
    root.removeAttribute('data-active');
    root.removeAttribute('data-tier');
    root.style.removeProperty('--_viewport');
    root.style.removeProperty('--_travel');
  };
}

/**
 * horizontal: scrolls the page (or the scroller) to where the card holding `target` sits in the middle of the
 * pinned frame — the track's position is the scroll position, so that is how it moves. Offsets, not boxes:
 * the card's place along the track before the track's transform.
 */
function bringIntoTrack(root: HTMLElement, target: Element, scroller: HTMLElement | null) {
  const pin = root.querySelector<HTMLElement>(':scope > .ui-scroll-effect__pin');
  const track = pin?.firstElementChild as HTMLElement | null;
  const card = track ? childrenOf(track).find((child) => child.contains(target)) : undefined;
  if (!pin || !track || !card) return;
  const travel = Math.max(0, track.offsetWidth - pin.clientWidth);
  if (!travel) return;
  // From the side the track starts on: the left, or the right in right-to-left writing.
  const left = card.offsetLeft - track.offsetLeft;
  const start = getDirection(root) === 'rtl' ? track.offsetWidth - left - card.offsetWidth : left;
  const shift = Math.min(travel, Math.max(0, start - (pin.clientWidth - card.offsetWidth) / 2));
  // The element's top `shift` px above the top of the scrollport: the point of its pinned stretch that shows the card.
  const top = contentTop(root, scroller) + shift;
  if (scroller) scroller.scrollTop = top;
  else window.scrollTo({ top, behavior: 'instant' });
}

/** The browser drives the animations from the scroll position: no listener, no script per frame. */
function playOnTimeline(root: HTMLElement, spec: ScrollEffectSpec, tracks: Track[], scroller: HTMLElement | null): () => void {
  const { ViewTimeline, ScrollTimeline } = timelines();
  if (!ViewTimeline || !ScrollTimeline) return () => {};
  const timeline =
    spec.timeline === 'scroll'
      ? new ScrollTimeline({ source: scroller ?? document.scrollingElement ?? document.documentElement, axis: 'block' })
      : new ViewTimeline({ subject: root, axis: 'block' });
  const animations = tracks.map(({ element, keyframes, range }) => {
    const options: KeyframeAnimationOptions & { rangeStart?: string; rangeEnd?: string } = { timeline, fill: 'both', easing: spec.easing };
    if (spec.timeline === 'view' && range) {
      options.rangeStart = range[0];
      options.rangeEnd = range[1];
    }
    return element.animate(keyframes, options);
  });
  return () => animations.forEach((animation) => animation.cancel());
}

/** Where each track is in its stretch now, 0–1, measured as the scroll timeline would measure it. */
function progressOf(root: HTMLElement, spec: ScrollEffectSpec, tracks: Track[], scroller: HTMLElement | null): number[] {
  if (spec.timeline === 'scroll') {
    const source = scroller ?? document.scrollingElement ?? document.documentElement;
    const room = source.scrollHeight - source.clientHeight;
    const progress = room > 0 ? Math.min(1, Math.max(0, source.scrollTop / room)) : 1;
    return tracks.map(() => progress);
  }
  const box = { top: contentTop(root, scroller) - scrollTopOf(scroller), height: root.offsetHeight, viewport: viewportHeight(scroller) };
  return tracks.map((track) => viewRangeProgress(track.range ?? ['cover 0%', 'cover 100%'], box));
}

/** Paused animations whose time follows the scroll, written once a frame and only while the element is on screen. */
function followScroll(root: HTMLElement, spec: ScrollEffectSpec, tracks: Track[], scroller: HTMLElement | null): () => void {
  const LENGTH = 1000;
  const animations = tracks.map(({ element, keyframes }) => {
    const animation = element.animate(keyframes, { duration: LENGTH, fill: 'both', easing: spec.easing });
    animation.pause();
    return animation;
  });
  let frame = 0;
  const write = () => {
    frame = 0;
    progressOf(root, spec, tracks, scroller).forEach((progress, i) => (animations[i].currentTime = progress * LENGTH));
  };
  // The first frame is drawn right, before anything scrolls.
  write();
  const schedule = () => {
    frame ||= requestAnimationFrame(write);
  };
  let stopListening: (() => void) | null = null;
  // Off screen nothing listens; a hidden tab runs no frames.
  const stopWatching = observeIntersection(
    root,
    (entry) => {
      if (entry.isIntersecting) {
        stopListening ??= onLayoutShift(schedule);
        schedule();
      } else {
        stopListening?.();
        stopListening = null;
      }
    },
    { rootMargin: '25% 0px' },
  );
  return () => {
    stopWatching();
    stopListening?.();
    cancelAnimationFrame(frame);
    animations.forEach((animation) => animation.cancel());
  };
}

interface Entrance {
  /** Plays from the first keyframe (ignored unless held there). */
  play(): void;
  /** Holds the element at the first keyframe again. */
  reset(): void;
  /** Shows the element as it is and lets go of it. */
  finish(): void;
}

/** Holds `element` at the first keyframe until play(); once played, the animation lets go and its own styles are back. */
function holdEntrance(element: HTMLElement, keyframes: Keyframe[], timing: { duration: number; easing: string }): Entrance {
  let animation: Animation | null = null;
  let held = false;
  const hold = () => {
    animation?.cancel();
    animation = element.animate(keyframes, { duration: Math.max(1, timing.duration), easing: timing.easing, fill: 'backwards' });
    animation.pause();
    animation.currentTime = 0;
    held = true;
  };
  hold();
  return {
    play() {
      if (!held || !animation) return;
      held = false;
      const current = animation;
      current.onfinish = () => {
        if (animation === current) animation = null;
      };
      current.play();
    },
    reset() {
      if (!held) hold();
    },
    finish() {
      animation?.cancel();
      animation = null;
      held = false;
    },
  };
}

/**
 * Entrances without scroll timelines: the motion plays on a timer once the element comes into view (as
 * Reveal does) and resets when it goes back below. An element already past its stretch is shown as it is,
 * the way a scroll timeline would show it.
 */
function playOnEntry(root: HTMLElement, tracks: Track[], spec: ScrollEffectSpec, scroller: HTMLElement | null, tier: ScrollEffectTier): () => void {
  if (progressOf(root, spec, tracks, scroller).every((progress) => progress >= 1)) return () => {};
  const profile = readMotionProfile(root);
  const timing = { duration: tier === 'cpu' ? Math.min(profile.enter, 260) : profile.enter, easing: spec.easing };
  const entrances = tracks.map(({ element, keyframes }) => holdEntrance(element, keyframes, timing));
  const play = () => entrances.forEach((entrance) => entrance.play());
  const stop = observeIntersection(
    root,
    (entry) => {
      if (entry.isIntersecting) play();
      else if (entry.boundingClientRect.top >= (entry.rootBounds?.bottom ?? window.innerHeight)) entrances.forEach((entrance) => entrance.reset());
    },
    { rootMargin: ENTRY_MARGIN },
  );
  // Keyboard focus never waits for the scroll.
  root.addEventListener('focusin', play);
  return () => {
    stop();
    root.removeEventListener('focusin', play);
    entrances.forEach((entrance) => entrance.finish());
  };
}

/**
 * Motion driven by the scroll: content that enters as it scrolls into view, follows the scroll while it
 * passes — parallax, a reading progress bar, sticky cards that recede, a pinned track that runs sideways,
 * text that fills line by line — or leaves as it scrolls out, with one of twenty-four presets. Each preset is
 * Web Animation keyframes on a scroll-driven timeline (the engine of CSS `animation-timeline: view()` /
 * `scroll()`), so the browser plays it from the scroll position with no script per frame; without scroll
 * timelines, entrances play on a timer as they come into view and the rest follow a listener that runs
 * only while the element is on screen and never in a hidden tab. Transform and opacity first (the masks,
 * text-fill and blur say so in their cost). On machines without GPU compositing each preset plays its
 * one-layer CPU variant. Reduced motion: the content at rest, only the progress bar keeps following.
 */
export const ScrollEffect = withRef(function ScrollEffect({ preset = 'fade-up', strength = 1, range, tier = 'auto', disabled = false, className, children, ref, ...rest }: ScrollEffectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reduced = useMotionReduced(rootRef);
  // auto: the GPU preset until the machine check, run while the browser is idle, says otherwise.
  const [machine, setMachine] = useState<ScrollEffectTier | undefined>(() => (tier === 'auto' ? knownRenderTier() : undefined));
  const playing: ScrollEffectTier = tier === 'auto' ? (machine ?? 'gpu') : tier;
  const layout = scrollEffectSpec(preset).layout;
  const [from, to] = range ?? [];

  useEffect(() => {
    if (tier !== 'auto' || machine) return;
    return onRenderTier(setMachine);
  }, [tier, machine]);

  // Sticky cards step down by their index (--_i), with or without motion: the stack is layout.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || layout !== 'stack') return;
    const cards = childrenOf(root);
    cards.forEach((card, i) => card.style.setProperty('--_i', String(i)));
    return () => cards.forEach((card) => card.style.removeProperty('--_i'));
  });

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || disabled || typeof root.animate !== 'function') return;
    const options = { rtl: getDirection(root) === 'rtl', strength, tier: playing };
    // Reduced motion: at rest. A progress bar is a position, not decoration: it keeps following.
    if ((reduced || isMotionReduced(root)) && !scrollEffectSpec(preset, options).indicator) return;
    return runEffect(root, {
      build: (travel) => scrollEffectSpec(preset, { ...options, travel }),
      range: from && to ? [from, to] : undefined,
      tier: playing,
    });
  }, [preset, strength, from, to, playing, disabled, reduced]);

  let content = children;
  if (layout === 'clip') content = <div className="ui-scroll-effect__inner">{children}</div>;
  else if (layout === 'text') content = <span className="ui-scroll-effect__text">{children}</span>;
  else if (layout === 'horizontal') {
    content = (
      // At rest (reduced motion, disabled) the frame is a plain sideways scroll area: a keyboard reaches it even when no card
      // inside takes focus. Pinned, it only clips, and the page scroll moves the track.
      <div className="ui-scroll-effect__pin" tabIndex={disabled || reduced ? 0 : undefined}>
        <div className="ui-scroll-effect__track">{children}</div>
      </div>
    );
  }

  return (
    <div {...rest} ref={mergeRefs(rootRef, ref)} className={cx('ui-scroll-effect', className)} data-preset={preset} data-layout={layout}>
      {content}
    </div>
  );
});
