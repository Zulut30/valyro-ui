'use client';

import { useMemo, type ComponentPropsWithRef, type ReactNode } from 'react';
import { cx } from '../primitives';
import { withRef } from '../primitives/react-compat';
import { findMatches, mergeRanges, type TextRange } from '../primitives/text-match';
import './Highlight.css';

export type HighlightTone = 'accent' | 'warning' | 'success' | 'danger' | 'info';

export interface HighlightLabels {
  /** Read before each hit when `announce` is on. */
  start: string;
  /** Read after each hit when `announce` is on. */
  end: string;
}

export const defaultHighlightLabels: HighlightLabels = { start: 'highlight start', end: 'highlight end' };

export interface HighlightProps extends Omit<ComponentPropsWithRef<'span'>, 'children'> {
  /** The text to search in. */
  children: string;
  /** One term or several (each may get its own `tone`). Empty or blank: plain text. */
  query?: string | readonly string[];
  /** Ready-made hit ranges `[start, end]` (a fuzzy search, server hits); they win over `query`. */
  ranges?: readonly TextRange[];
  /** Default true. */
  ignoreCase?: boolean;
  /** "елка" finds "Ёлка", "cafe" finds "Café". Default true, as the kit's Select and Combobox filter. */
  ignoreAccents?: boolean;
  /** Only whole words (any script). */
  wholeWord?: boolean;
  /** Mark only the first hit. */
  first?: boolean;
  /** Colour of the marks; an array gives each query term its own (cycling). Default `accent`. */
  tone?: HighlightTone | readonly HighlightTone[];
  /** Index of the current hit (find in page): it gets the strong colour and `data-current`. */
  current?: number;
  /** Locale for case folding (Turkish İ). */
  locale?: string;
  /** Screen readers do not announce <mark>: wrap each hit in hidden "highlight start / end" words. */
  announce?: boolean;
  labels?: Partial<HighlightLabels>;
}

/**
 * Text with the hits of a search marked. Matching ignores case and accents and still marks the original letters
 * ("Орёл" for "орел", "Zürich" for "zurich"); several terms can take their own tones; ready-made ranges serve
 * fuzzy and server search; `current` marks the hit a find-in-page bar is on.
 */
export const Highlight = withRef(function Highlight({
  children,
  query,
  ranges: rangesProp,
  ignoreCase = true,
  ignoreAccents = true,
  wholeWord = false,
  first = false,
  tone = 'accent',
  current,
  locale,
  announce = false,
  labels,
  className,
  ...rest
}: HighlightProps) {
  const text = typeof children === 'string' ? children : String(children ?? '');
  const queryKey = typeof query === 'string' ? query : query?.join('\u0000');
  const ranges = useMemo(
    () => (rangesProp ? mergeRanges(rangesProp) : query ? findMatches(text, query, { ignoreCase, ignoreAccents, wholeWord, first, locale }) : []),
    // `query` as an array literal is a new object on every render; its content is the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, queryKey, rangesProp, ignoreCase, ignoreAccents, wholeWord, first, locale],
  );
  const t = { ...defaultHighlightLabels, ...labels };
  const tones = typeof tone === 'string' ? [tone] : tone.length > 0 ? tone : ['accent' as const];

  const parts: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([start, end, term], index) => {
    const from = Math.max(start, at);
    const to = Math.min(end, text.length);
    if (to <= from) return;
    if (from > at) parts.push(text.slice(at, from));
    parts.push(
      <mark
        key={from}
        className="ui-highlight__mark"
        data-tone={tones[(term ?? 0) % tones.length]}
        data-current={index === current || undefined}
      >
        {announce && <span className="ui-sr-only">{`${t.start} `}</span>}
        {text.slice(from, to)}
        {announce && <span className="ui-sr-only">{` ${t.end}`}</span>}
      </mark>,
    );
    at = to;
  });
  if (at < text.length) parts.push(text.slice(at));

  return (
    <span {...rest} className={cx('ui-highlight', className)}>
      {parts}
    </span>
  );
});
