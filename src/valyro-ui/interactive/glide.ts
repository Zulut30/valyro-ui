'use client';

import { useEffect, useRef } from 'react';
import { isMotionReduced, themeSlowMs } from '../primitives';
import { useLayoutEffect } from '../primitives/react-compat';

/*
 * Height that glides when the content inside changes (another level of an explanation, another note): the block
 * moves from the height it had to the new one on a soft curve instead of jumping, so what is below it glides too.
 * Opening from nothing and folding away is useFold's job; this is for content swapped in place.
 */

/** Soft deceleration: no hard start, no hard stop. */
export const SOFT_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const GLIDE_ID = 'ui-height-glide';

/**
 * Ref for an element whose height glides from its previous value whenever `key` changes. Reduced motion (or no Web
 * Animations): the new height at once. Interrupted mid-glide, it continues from where it is.
 */
export function useHeightGlide<T extends HTMLElement>(key: unknown) {
  const ref = useRef<T>(null);
  const last = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const running = typeof el.getAnimations === 'function' ? el.getAnimations().filter((a) => a.id === GLIDE_ID) : [];
    // Mid-glide the element is as tall as the running animation holds it: that is where the next glide starts.
    const from = running.length ? el.getBoundingClientRect().height : last.current;
    running.forEach((animation) => animation.cancel());
    const to = el.getBoundingClientRect().height;
    last.current = to;
    if (from === null || Math.abs(from - to) < 1 || typeof el.animate !== 'function' || isMotionReduced(el)) return;
    el.style.overflow = 'hidden';
    const animation = el.animate({ height: [`${from}px`, `${to}px`] }, { duration: themeSlowMs(el) * 1.25, easing: SOFT_EASE });
    animation.id = GLIDE_ID;
    animation.finished.then(
      () => {
        el.style.overflow = '';
      },
      () => {},
    );
  }, [key]);

  // Size changes that are not a swap (the container got narrower) only update the starting point.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const busy = typeof el.getAnimations === 'function' && el.getAnimations().some((a) => a.id === GLIDE_ID);
      if (!busy) last.current = el.getBoundingClientRect().height;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return ref;
}
