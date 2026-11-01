'use client';

import { useRef } from 'react';
import { useLayoutEffect } from './react-compat';

/*
 * Removing an item from a list without losing keyboard focus (a tag's ×, Delete on a chip): when focus was in
 * the removed item, it goes to the item that takes its place, else the one before it, else a fallback (the
 * input of a tags field). The list re-renders in between, so the move waits for the next commit.
 */

/** Index, in the list after the removal, that should take focus: the next item, else the previous, else -1. */
export function focusAfterRemoval(count: number, removed: number): number {
  const left = count - 1;
  if (left <= 0) return -1;
  return Math.min(removed, left - 1);
}

export interface RemovableListOptions {
  /** The focus target of an item in the current list (its remove button, the item itself). */
  getElement: (index: number) => HTMLElement | null | undefined;
  /** Where focus goes when the list is left empty. */
  fallback?: () => HTMLElement | null | undefined;
}

export interface RemovableList {
  /**
   * Call before removing item `index` of a list of `count` (then remove it in the same event): if focus was
   * inside `element` (default: the item's focus target), it moves on after the next commit.
   */
  removeAt: (index: number, count: number, element?: Element | null) => void;
}

/** Focus management for lists whose items can be removed (tags, chips, attachments, rows). */
export function useRemovableList({ getElement, fallback }: RemovableListOptions): RemovableList {
  const pending = useRef<number | null>(null);
  const latest = useRef({ getElement, fallback });
  latest.current = { getElement, fallback };

  useLayoutEffect(() => {
    const target = pending.current;
    if (target == null) return;
    pending.current = null;
    const { getElement: element, fallback: last } = latest.current;
    const next = target >= 0 ? element(target) : null;
    (next ?? last?.())?.focus();
  });

  return {
    removeAt: (index, count, element) => {
      if (typeof document === 'undefined') return;
      const holder = element ?? getElement(index);
      const active = document.activeElement;
      // A pointer removal on a browser that does not focus buttons (Safari) leaves focus on <body>.
      const lost = !active || active === document.body;
      if (lost || (holder && active && holder.contains(active))) pending.current = focusAfterRemoval(count, index);
    },
  };
}
