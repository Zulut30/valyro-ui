'use client';

import { useEffect, type RefObject } from 'react';
import { isInDismissIgnoredRegion } from './useDismissableLayer';

const TABBABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

/** A radio stops Tab only when checked, or as the first of a group with nothing checked (the browser's own order). */
function isRadioStop(radio: HTMLInputElement, scope: HTMLElement) {
  if (radio.checked || !radio.name) return true;
  const group = Array.from(scope.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(radio.name)}"]`));
  return !group.some((r) => r.checked) && group[0] === radio;
}

export function getTabbables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) =>
      // Roving-tabindex items (inactive tabs, a combobox's toggle, a field's clear button) are not Tab stops.
      el.tabIndex >= 0 &&
      !el.closest('[inert]') &&
      el.getClientRects().length > 0 &&
      !(el instanceof HTMLInputElement && el.type === 'radio' && !isRadioStop(el, container)),
  );
}

// Only the most recently activated trap handles Tab (nested dialogs).
const traps: HTMLElement[] = [];

export interface FocusTrapOptions {
  initialFocusRef?: RefObject<HTMLElement | null>;
  restoreFocus?: boolean;
  /**
   * Where focus goes on release when the element focused before activation is gone (a deleted row's button).
   * Without it, focus moves to the first Tab stop in that element's nearest ancestor still on the page.
   */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /**
   * Modal containment: focus that lands outside by any means (a screen reader's virtual cursor, a click on the
   * page, script) is brought back to the last focused element inside, not only Tab. Off for non-modal layers,
   * where moving focus out is how the user leaves them.
   */
  contain?: boolean;
}

function isFocusable(element: Element | null | undefined): element is HTMLElement {
  return element instanceof HTMLElement && element.isConnected && element.tabIndex >= -1 && !element.closest('[inert]');
}

/** Ancestors of `element` that stay meaningful on the page (not body or html), nearest first. */
function ancestorsOf(element: Element | null) {
  const list: HTMLElement[] = [];
  for (let el = element?.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) list.push(el);
  return list;
}

/** Keeps Tab focus inside `ref` while active and restores focus on release. */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  { initialFocusRef, restoreFocus = true, returnFocusRef, contain = false }: FocusTrapOptions = {},
) {
  useEffect(() => {
    const container = ref.current;
    if (!active || !container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Recorded now: once that element is removed, its detached parents no longer lead back into the page.
    const fallbackScopes = ancestorsOf(previouslyFocused);
    traps.push(container);

    const target = initialFocusRef?.current ?? getTabbables(container)[0] ?? container;
    target.focus({ preventScroll: true });
    let lastFocused: HTMLElement | null = container.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || traps[traps.length - 1] !== container) return;
      // A layer opened inside (a popover, a menu, a listbox) already moved focus itself.
      if (event.defaultPrevented) return;
      // Focus parked in a non-modal region above the modal (e.g. a toast reached via F8) may tab on there.
      if (isInDismissIgnoredRegion(document.activeElement)) return;
      const items = getTabbables(container);
      if (items.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      // Focus in another portaled layer that this one does not hold (a popover opened from the dialog): that layer
      // owns Tab; pulling focus back here would leave it open behind.
      const layer = current instanceof HTMLElement ? current.closest('[data-ui-portal]') : null;
      if (layer && !layer.contains(container) && !container.contains(layer)) return;
      const outside = !container.contains(current);
      if (event.shiftKey && (current === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };

    /** Focus inside is remembered; focus outside comes back while this is the top trap. */
    const onFocusIn = (event: FocusEvent) => {
      const node = event.target as Node | null;
      if (node && container.contains(node)) {
        lastFocused = node as HTMLElement;
        return;
      }
      if (!contain || traps[traps.length - 1] !== container || !node) return;
      if (isInDismissIgnoredRegion(node)) return;
      // A popover or menu opened from the modal lives in its own portal and owns focus while open.
      const layer = node instanceof Element ? node.closest('[data-ui-portal]') : null;
      if (layer && !layer.contains(container) && !container.contains(layer)) return;
      const back = isFocusable(lastFocused) && container.contains(lastFocused) ? lastFocused : getTabbables(container)[0] ?? container;
      back.focus({ preventScroll: true });
    };

    // The focused element removed from under the user (a list item deleted inside the modal): focus falls to the
    // body without a focusin, so it is caught on the way out.
    const onFocusOut = (event: FocusEvent) => {
      if (!contain || event.relatedTarget || !container.contains(event.target as Node)) return;
      const left = event.target as HTMLElement;
      requestAnimationFrame(() => {
        if (left.isConnected || traps[traps.length - 1] !== container || !container.isConnected) return;
        const active = document.activeElement;
        if (active && active !== document.body && active !== document.documentElement) return;
        (getTabbables(container)[0] ?? container).focus({ preventScroll: true });
      });
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    container.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      container.removeEventListener('focusout', onFocusOut);
      traps.splice(traps.indexOf(container), 1);
      if (!restoreFocus) return;
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
        return;
      }
      // The opener is gone (deleted, or its menu closed): the explicit target, else the nearest place it lived.
      const explicit = returnFocusRef?.current;
      if (isFocusable(explicit)) {
        explicit.focus({ preventScroll: true });
        return;
      }
      const scope = fallbackScopes.find((el) => el.isConnected && !el.closest('[inert]'));
      const fallback = scope && (getTabbables(scope)[0] ?? (isFocusable(scope) && scope.tabIndex >= 0 ? scope : undefined));
      fallback?.focus({ preventScroll: true });
    };
    // initialFocusRef and returnFocusRef are read once on activation and release by design.
  }, [active, ref, restoreFocus, contain]);
}
