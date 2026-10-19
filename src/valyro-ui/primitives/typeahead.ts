'use client';

import { useEffect, useMemo, useRef } from 'react';

/*
 * Type-ahead for lists, trees and grids, as React Aria does it: keys typed within `timeout` build one query
 * ("new y" → "New York"), and labels are compared with the locale's collator at base strength, so "e" finds
 * "Éclair", "o" finds "Österreich" and case never matters.
 */

const DEFAULT_TIMEOUT = 1000;

/** `(label, query) => boolean`: whether `label` starts with `query`, ignoring case and accents for `locale`. */
export function createPrefixMatcher(locale?: string) {
  const collator = new Intl.Collator(locale, { usage: 'search', sensitivity: 'base' });
  return (label: string, query: string) => {
    const text = label.trim().normalize('NFC');
    const search = query.normalize('NFC');
    return search.length > 0 && collator.compare(text.slice(0, search.length), search) === 0;
  };
}

/**
 * `(text, query) => boolean`: whether `text` contains `query` anywhere, ignoring case and accents for `locale`, as
 * React Aria's useFilter `contains` does ("resume" finds "Résumé", "strasse" does not find "Straße" in de, where ß
 * is its own letter). For filtering a combobox or a command list as the user types.
 */
export function createContainsMatcher(locale?: string) {
  const collator = new Intl.Collator(locale, { usage: 'search', sensitivity: 'base' });
  return (text: string, query: string) => {
    const needle = query.normalize('NFC');
    if (needle.length === 0) return true;
    const haystack = text.normalize('NFC');
    for (let scan = 0; scan + needle.length <= haystack.length; scan++) {
      if (collator.compare(needle, haystack.slice(scan, scan + needle.length)) === 0) return true;
    }
    return false;
  };
}

/**
 * Index of the item `query` selects, or -1. A query of one repeated character ("a", "aaa") cycles through the items
 * starting with it, after `activeIndex`; a longer query refines the current match, so it may stay on `activeIndex`.
 */
export function findTypeaheadIndex(
  count: number,
  query: string,
  activeIndex: number,
  getLabel: (index: number) => string,
  matches: (label: string, query: string) => boolean,
  isDisabled: (index: number) => boolean = () => false,
): number {
  if (count === 0 || !query) return -1;
  const chars = Array.from(query);
  const search = chars.every((ch) => ch === chars[0]) ? chars[0] : query;
  const start = search.length > 1 ? Math.max(activeIndex, 0) : activeIndex + 1;
  for (let i = 0; i < count; i++) {
    const index = (((start + i) % count) + count) % count;
    if (!isDisabled(index) && matches(getLabel(index), search)) return index;
  }
  return -1;
}

export interface Typeahead {
  /** Adds a printable key to the query and returns the whole query, or null for keys that do not type. */
  type: (event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }) => string | null;
  /** Whether a query is being typed: Space then belongs to it ("New York") instead of selecting. */
  isTyping: () => boolean;
  matches: (label: string, query: string) => boolean;
}

/** The query buffer and matcher for one widget; the query clears `timeout` ms after the last key. */
export function useTypeahead(locale?: string, timeout = DEFAULT_TIMEOUT): Typeahead {
  const state = useRef({ text: '', timer: 0 as ReturnType<typeof setTimeout> | 0 });
  useEffect(() => () => clearTimeout(state.current.timer || undefined), []);
  const matches = useMemo(() => createPrefixMatcher(locale), [locale]);
  return useMemo(
    () => ({
      type: (event) => {
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return null;
        const current = state.current;
        if (event.key === ' ' && !current.text) return null;
        clearTimeout(current.timer || undefined);
        current.text += event.key;
        current.timer = setTimeout(() => (current.text = ''), timeout);
        return current.text;
      },
      isTyping: () => state.current.text !== '',
      matches,
    }),
    [matches, timeout],
  );
}
