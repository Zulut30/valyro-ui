'use client';

import { useState, type KeyboardEvent } from 'react';
import { createPrefixMatcher, findTypeaheadIndex, useTypeahead } from './typeahead';
import { getDirection } from './utils';

export interface ListNavigationOptions {
  count: number;
  isDisabled?: (index: number) => boolean;
  /** Label used for type-ahead. */
  getLabel?: (index: number) => string;
  /**
   * Locale whose collator compares type-ahead queries with labels: case and accents are ignored the way that
   * language does it ("e" finds "Éclair"). Defaults to the browser's.
   */
  locale?: string;
  onSelect?: (index: number) => void;
  loop?: boolean;
  orientation?: 'vertical' | 'horizontal';
  initialIndex?: number;
}

const never = () => false;

/** Rows PageUp / PageDown move in a vertical list (React Aria moves by the visible page; ten is a fair page). */
const PAGE_SIZE = 10;

/**
 * The first enabled index after `from` in direction `delta`. `from` may be -1 or
 * `count` to search from either end. Returns `from` when nothing further is
 * enabled (end of a non-looping list), or -1 when `from` itself is out of range.
 */
export function stepIndex(
  count: number,
  from: number,
  delta: 1 | -1,
  isDisabled: (index: number) => boolean = never,
  loop = true,
): number {
  for (let i = 1; i <= count; i++) {
    let next = from + delta * i;
    if (loop) next = ((next % count) + count) % count;
    else if (next < 0 || next >= count) break;
    if (!isDisabled(next)) return next;
  }
  return from >= 0 && from < count ? from : -1;
}

let defaultMatcher: ((label: string, query: string) => boolean) | null = null;

/**
 * Type-ahead match for `query`, compared with the browser locale's collator (case and accents ignored). A single
 * character searches after the active item so repeated presses cycle; repeating one character ("aaa") also cycles;
 * a longer query refines the current match. Returns -1 if none. For another locale use `findTypeaheadIndex` with
 * `createPrefixMatcher(locale)`.
 */
export function findTypeaheadMatch(
  count: number,
  query: string,
  activeIndex: number,
  getLabel: (index: number) => string,
  isDisabled: (index: number) => boolean = never,
): number {
  defaultMatcher ??= createPrefixMatcher();
  return findTypeaheadIndex(count, query, activeIndex, getLabel, defaultMatcher, isDisabled);
}

/**
 * Keyboard model for menus/listboxes: arrows, Home/End, Enter/Space, type-ahead.
 * Keep DOM focus on the container (or input) and mark the active row with
 * `data-highlighted` + `aria-activedescendant`. Type-ahead builds one query from the keys typed within a second
 * ("new y" → "New York") and compares it with the labels through `Intl.Collator` for `locale`.
 */
export function useListNavigation({
  count,
  isDisabled = never,
  getLabel,
  onSelect,
  loop = true,
  orientation = 'vertical',
  initialIndex = -1,
  locale,
}: ListNavigationOptions) {
  const [rawIndex, setActiveIndex] = useState(initialIndex);
  const typeahead = useTypeahead(locale);
  // The list can shrink under a stale index (filtering); never expose or select a row that is gone.
  const activeIndex = rawIndex >= 0 && rawIndex < count ? rawIndex : -1;

  const step = (from: number, delta: 1 | -1) => stepIndex(count, from, delta, isDisabled, loop);
  const first = () => stepIndex(count, -1, 1, isDisabled, loop);
  const last = () => stepIndex(count, count, -1, isDisabled, loop);
  const inRange = (i: number) => i >= 0 && i < count;
  /** Up to a page of enabled rows from `from`, stopping at the ends (no wrap). */
  const page = (from: number, delta: 1 | -1) => {
    let index = inRange(from) ? from : delta > 0 ? -1 : count;
    for (let moved = 0; moved < PAGE_SIZE; moved++) {
      const next = stepIndex(count, index, delta, isDisabled, false);
      if (next === index || next === -1) break;
      index = next;
    }
    return inRange(index) ? index : from;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (count === 0) return;
    const rtl = orientation === 'horizontal' && getDirection(event.currentTarget as Element) === 'rtl';
    const nextKey = orientation === 'vertical' ? 'ArrowDown' : rtl ? 'ArrowLeft' : 'ArrowRight';
    const prevKey = orientation === 'vertical' ? 'ArrowUp' : rtl ? 'ArrowRight' : 'ArrowLeft';
    // While the user is typing a query, Space is part of it ("New York"), not a selection.
    const typing = !!getLabel && typeahead.isTyping();

    const selectKey = event.key === 'Enter' || (event.key === ' ' && !typing);
    if (selectKey) {
      if (activeIndex >= 0 && !isDisabled(activeIndex)) {
        event.preventDefault();
        onSelect?.(activeIndex);
      }
      return;
    }

    switch (event.key) {
      case nextKey:
        event.preventDefault();
        setActiveIndex((i) => (inRange(i) ? step(i, 1) : first()));
        return;
      case prevKey:
        event.preventDefault();
        setActiveIndex((i) => (inRange(i) ? step(i, -1) : last()));
        return;
      case 'Home':
        event.preventDefault();
        setActiveIndex(first());
        return;
      case 'PageDown':
      case 'PageUp':
        if (orientation !== 'vertical') break;
        event.preventDefault();
        setActiveIndex((i) => page(i, event.key === 'PageDown' ? 1 : -1));
        return;
      case 'End':
        event.preventDefault();
        setActiveIndex(last());
        return;
    }

    const query = getLabel ? typeahead.type(event) : null;
    if (query === null || !getLabel) return;
    if (event.key === ' ') event.preventDefault();
    const match = findTypeaheadIndex(count, query, activeIndex, getLabel, typeahead.matches, isDisabled);
    if (match !== -1) setActiveIndex(match);
  };

  return { activeIndex, setActiveIndex, onKeyDown };
}
