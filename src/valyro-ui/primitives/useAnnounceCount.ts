'use client';

import { useEffect, useRef } from 'react';
import { announce } from './liveAnnouncer';

export interface AnnounceCountOptions {
  /** Announces only while true: the popup is open and the field has focus. */
  active: boolean;
  /** The text read, e.g. `(n) => \`${n} results available\``. */
  message: (count: number) => string;
  /** The query: each change of it or of the count, and each opening, schedules one announcement. */
  key?: unknown;
  /** Quiet time after the last change before reading, so typing a word is one announcement. Default 500 ms. */
  delay?: number;
}

/**
 * Reads how many results a filtered list holds, as React Aria's combobox does ("5 results available"): moving
 * `aria-activedescendant` is silent in some screen readers (VoiceOver), so without it the user types blind. Waits
 * for a pause in typing, and skips zero: the empty state is a status region that speaks for itself.
 */
export function useAnnounceCount(count: number, { active, message, key, delay = 500 }: AnnounceCountOptions) {
  const latest = useRef({ count, message });
  latest.current = { count, message };
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      const { count: current, message: text } = latest.current;
      if (current > 0) announce(text(current), 'polite', 3000);
    }, delay);
    return () => clearTimeout(timer);
  }, [active, key, count, delay]);
}
