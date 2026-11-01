/*
 * The page-transition presets on a View Transition: the browser snapshots the document before and after
 * an update, and the snapshots (::view-transition-old / -new) play the preset's keyframes through Web
 * Animations — the same pair PageTransition plays on live layers. For whole-document changes in any
 * router: React Router, Next.js, a plain history.pushState. Browser only; without View Transitions the
 * update simply runs.
 */
import { getDirection } from '../primitives';
import { coverRadius, pageTransitionSpec, pageTransitionTempo, reducedPageTransition, type PageTransitionDirection, type PageTransitionPreset } from './page-transitions';
import { isMotionReduced } from './preference';
import { parseTime } from './profile';
import { resolveRenderTier, type PageTransitionTierSetting } from './render-tier';
import './PageTransition.css';

/** What document.startViewTransition() returns (typed here for TypeScript DOM libs that lack it). */
export interface ViewTransitionLike {
  ready: Promise<void>;
  finished: Promise<void>;
  skipTransition(): void;
}

export interface ViewTransitionPresetOptions {
  preset?: PageTransitionPreset;
  direction?: PageTransitionDirection;
  /** Length, ms. Default: the preset's own, at the theme's tempo (`--ui-duration` on <html>). */
  duration?: number;
  /** Where `circle` grows from, viewport px (the click). Default: the middle of the screen. */
  origin?: { x: number; y: number };
  /** gpu — the full preset; cpu — its one-layer variant; auto — cpu on machines without GPU compositing. */
  tier?: PageTransitionTierSetting;
}

/** On <html> while a preset plays: PageTransition.css turns off the browser's own cross-fade and stacks the pair. */
export const VIEW_TRANSITION_ATTRIBUTE = 'data-ui-page-transition';
const DEPTH = '--ui-page-transition-depth';

let current: ViewTransitionLike | null = null;

/**
 * Plays a preset on a View Transition that has just started. Call it right after
 * document.startViewTransition(), before the transition is ready, so the browser's default cross-fade
 * never shows: `animateViewTransition(document.startViewTransition(update), { preset: 'cube' })`.
 * Animates the root snapshot (the whole page); elements with a view-transition-name of their own keep
 * their default motion, so a header named apart stays in place while the content changes. In a hidden
 * tab it skips the animation: the update still applies.
 */
export function animateViewTransition(transition: ViewTransitionLike, { preset = 'fade', direction = 'forward', duration, origin, tier = 'auto' }: ViewTransitionPresetOptions = {}) {
  if (document.visibilityState === 'hidden') {
    transition.skipTransition();
    return;
  }
  const root = document.documentElement;
  const reduced = isMotionReduced(root);
  const resolved = resolveRenderTier(tier);
  const width = window.innerWidth;
  const height = window.innerHeight;
  const point = origin ?? { x: width / 2, y: height / 2 };
  const spec = reduced
    ? reducedPageTransition()
    : pageTransitionSpec(preset, { direction, rtl: getDirection(root) === 'rtl', origin: point, radius: coverRadius(point, width, height), tier: resolved });
  const tempo = pageTransitionTempo(parseTime(getComputedStyle(root).getPropertyValue('--ui-duration')));
  const length = reduced ? spec.duration : (duration ?? Math.round(spec.duration * (resolved === 'cpu' ? Math.min(tempo, 1) : tempo)));
  current = transition;
  root.setAttribute(VIEW_TRANSITION_ATTRIBUTE, spec.top);
  if (spec.perspective) root.style.setProperty(DEPTH, `${spec.perspective}px`);
  else root.style.removeProperty(DEPTH);
  const timing = { duration: length, fill: 'both' as const };
  transition.ready
    .then(() => {
      if (current !== transition) return;
      // A snapshot that stays put gets no animation (the CSS above already holds the browser's own).
      if (spec.exit.keyframes.length) root.animate(spec.exit.keyframes, { ...timing, easing: spec.exit.easing, pseudoElement: '::view-transition-old(root)' });
      if (spec.enter.keyframes.length) root.animate(spec.enter.keyframes, { ...timing, easing: spec.enter.easing, pseudoElement: '::view-transition-new(root)' });
    })
    .catch(() => {});
  transition.finished
    .catch(() => {})
    .finally(() => {
      if (current !== transition) return;
      current = null;
      root.removeAttribute(VIEW_TRANSITION_ATTRIBUTE);
      root.style.removeProperty(DEPTH);
    });
}

type TransitionDocument = Document & { startViewTransition?: (update: () => void | Promise<void>) => ViewTransitionLike };

/**
 * Runs `update` (the route change) inside a View Transition that plays `preset`; where View Transitions
 * are missing it just runs `update`. Resolves once the change, and its animation, are done.
 */
export function startPageTransition(update: () => void | Promise<void>, options?: ViewTransitionPresetOptions): Promise<void> {
  const doc = document as TransitionDocument;
  if (!doc.startViewTransition || document.visibilityState === 'hidden') return Promise.resolve().then(update);
  const transition = doc.startViewTransition(update);
  animateViewTransition(transition, options);
  return transition.finished.catch(() => {});
}
