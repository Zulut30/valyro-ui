'use client';

import { useEffect, type RefObject } from 'react';
import { DISMISS_IGNORE_ATTRIBUTE } from './useDismissableLayer';
import { LIVE_ANNOUNCER_ATTRIBUTE } from './liveAnnouncer';

/*
 * While a modal is open, everything outside it is hidden from screen readers with `aria-hidden`, as React Aria's
 * ariaHideOutside does: `aria-modal` alone is ignored by some readers (VoiceOver on iOS, older NVDA), whose virtual
 * cursor would wander into the page behind. Only the ancestors' other children are hidden, so the modal's own path
 * stays exposed. Counts per element let nested modals stack; an `aria-hidden` the page set itself is left alone.
 * Kept readable: the live announcer, regions above modals (toasts, `[data-ui-dismiss-ignore]`) and layers opened
 * while the modal is up (`[data-ui-portal]`: its popovers, menus, a nested dialog), which hide the rest themselves.
 */

const KEEP = `[${LIVE_ANNOUNCER_ATTRIBUTE}], [${DISMISS_IGNORE_ATTRIBUTE}]`;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE', 'NOSCRIPT']);

const counts = new WeakMap<Element, number>();
/** Active calls, newest last: only the newest one hides nodes added to the page. */
const stack: object[] = [];

/**
 * Hides from assistive technology every element under `root` (default `document.body`) that is neither one of
 * `targets`, inside one, nor an ancestor of one. Returns the function that undoes it.
 */
export function ariaHideOutside(targets: readonly Element[], root: Element = document.body): () => void {
  const visible = targets.filter(Boolean);
  const hidden = new Set<Element>();
  const token = {};

  const hide = (element: Element) => {
    if (SKIP_TAGS.has(element.tagName) || element.matches(KEEP)) return;
    const count = counts.get(element) ?? 0;
    // Already hidden by the page: not ours to undo.
    if (count === 0 && element.getAttribute('aria-hidden') === 'true') return;
    if (count === 0) element.setAttribute('aria-hidden', 'true');
    counts.set(element, count + 1);
    hidden.add(element);
  };

  const walk = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      if (visible.some((target) => target === child)) continue;
      if (visible.some((target) => child.contains(target))) walk(child);
      else hide(child);
    }
  };
  walk(root);

  const observer =
    typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver((records) => {
          if (stack[stack.length - 1] !== token) return;
          for (const record of records) {
            if (record.type !== 'childList') continue;
            for (const node of Array.from(record.addedNodes)) {
              if (!(node instanceof Element) || !node.isConnected) continue;
              // Inside a target or an already hidden subtree, or on the targets' own path: nothing to do.
              if (visible.some((target) => target.contains(node) || node.contains(target))) continue;
              if ([...hidden].some((element) => element.contains(node))) continue;
              // Layers opened while the modal is up came from it (or hide the rest themselves).
              if (node.hasAttribute('data-ui-portal') || node.querySelector(':scope > [data-ui-portal]')) continue;
              hide(node);
            }
          }
        });
  observer?.observe(root, { childList: true, subtree: true });
  stack.push(token);

  return () => {
    observer?.disconnect();
    stack.splice(stack.indexOf(token), 1);
    for (const element of hidden) {
      const count = (counts.get(element) ?? 1) - 1;
      if (count > 0) {
        counts.set(element, count);
      } else {
        counts.delete(element);
        element.removeAttribute('aria-hidden');
      }
    }
    hidden.clear();
  };
}

/** Hides everything outside `refs` from screen readers while `active` (see `ariaHideOutside`). */
export function useAriaHideOutside(refs: readonly RefObject<Element | null>[], active: boolean) {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    const targets = refs.map((ref) => ref.current).filter((el): el is Element => !!el);
    if (targets.length === 0) return;
    return ariaHideOutside(targets);
    // The refs are read when the layer opens, like the focus trap's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
