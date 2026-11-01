'use client';

import { useRef, type RefObject } from 'react';
import { animateSpring, themeSlowMs } from './spring';
import { usePresence } from './usePresence';
import { useLayoutEffect } from './react-compat';

/** Longest theme --ui-duration-slow (400 ms) plus a margin: a folding group stays mounted that long. */
const FOLD_MS = 450;

const FOLD_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

/** CSS transitions height to and from `auto` (interpolate-size): the fold runs in CSS (styles/motion.css, data-ui-fold). */
const cssFolds = typeof CSS !== 'undefined' && CSS.supports?.('interpolate-size', 'allow-keywords') === true;

/** The theme's standard curve for an element (`--ui-ease`), as a Web Animations easing. */
function themeEase(element: Element) {
  const value = getComputedStyle(element).getPropertyValue('--ui-ease').trim();
  return value && (typeof CSS === 'undefined' || CSS.supports?.('transition-timing-function', value) !== false) ? value : FOLD_EASE;
}

/**
 * A disclosure's content (a tree branch, a JSON node) that unfolds and folds: height and fade, so the rows
 * below glide instead of jumping. Where CSS transitions to `auto` (interpolate-size) the browser plays it from
 * `data-ui-fold={cssFold}` (styles/motion.css), with no JavaScript; elsewhere Web Animations play it from
 * the measured height. The group stays mounted until the fold has played; render it while `isMounted`, with
 * `ref`, `data-state={state}`, `data-ui-fold={cssFold}` and `inert` when closed. `readyRef` is false during
 * the owner's first commit, so groups open from the start just show. `spring`: unfolds on the smooth spring;
 * otherwise on the theme's curve and duration. Durations follow --ui-duration-slow, so the themes'
 * reduced-motion block (1 ms) makes it instant. `collapsed` (px): the height it folds to instead of 0 (a
 * "show more" preview), which stays visible, so it keeps its opacity; style the closed height in CSS too.
 */
export function useFold<T extends HTMLElement>(open: boolean, readyRef: RefObject<boolean>, spring = false, collapsed = 0) {
  const { isMounted, state } = usePresence(open, FOLD_MS);
  const ref = useRef<T>(null);
  // Off in the owner's first commit, so a group open from the start has no entrance.
  const cssFold = cssFolds && readyRef.current ? (spring ? 'spring' : '') : undefined;

  useLayoutEffect(() => {
    const group = ref.current;
    if (cssFolds || !group || !readyRef.current || typeof group.animate !== 'function') return;
    const height = `${group.scrollHeight}px`;
    // A group reopened mid-fold drops the fold (it fills forwards) before unfolding.
    for (const running of group.getAnimations()) running.cancel();
    // Clipped only while it moves: open, the rows' focus rings may reach past the group.
    group.style.overflow = 'hidden';
    const settle = (animation: Animation | undefined) =>
      animation?.finished.then(
        () => {
          if (state === 'open') group.style.overflow = '';
        },
        () => {},
      );
    const low = `${collapsed}px`;
    const fade = collapsed > 0 ? {} : { opacity: state === 'open' ? [0, 1] : [1, 0] };
    if (state === 'open') {
      const keyframes = { height: [low, height], ...fade };
      settle(
        spring
          ? animateSpring(group, keyframes, 'smooth')
          : group.animate(keyframes, { duration: themeSlowMs(group), easing: themeEase(group) }),
      );
    } else {
      group.animate({ height: [height, low], ...fade }, { duration: themeSlowMs(group), easing: FOLD_EASE, fill: 'forwards' });
    }
  }, [state, readyRef, spring, collapsed]);

  return { ref, isMounted, state, cssFold };
}
