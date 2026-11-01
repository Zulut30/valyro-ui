/*
 * Where a search query occurs in a text, as character ranges of the original string: for highlighting hits
 * (Highlight, a log search, a command list). Matching ignores case and accents by default, like the kit's
 * Select and Combobox filters, so "елка" finds "Ёлка" and "cafe" finds "Café" — and the range covers the
 * original "Ё…" / "é", not the folded copy. Pure functions, no DOM.
 */

/** `[start, end)` of a hit in UTF-16 units of the original text; `term` is the index of the query term it matched. */
export type TextRange = readonly [start: number, end: number, term?: number];

export interface FindMatchesOptions {
  /** Default true. */
  ignoreCase?: boolean;
  /** "e" matches "é", "е" matches "ё". Default true. */
  ignoreAccents?: boolean;
  /** Only hits that are whole words (letters and digits of any script around them do not continue the hit). */
  wholeWord?: boolean;
  /** Only the first hit in the text. */
  first?: boolean;
  /** Locale for lower-casing (Turkish İ/ı). Default: the language-neutral rules. */
  locale?: string;
}

/** Escapes a string for use inside a regular expression. */
export const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const COMBINING = /\p{M}/u;
const WORD = /[\p{L}\p{N}_]/u;
// Letters whose diacritic makes them a different letter, not an accented one: Cyrillic й/Й keep their breve.
const KEEP = new Set(['й', 'Й']);

interface Folded {
  text: string;
  /** For each UTF-16 unit of `text`: start and end of the original code point it came from. */
  from: number[];
  to: number[];
}

function fold(source: string, ignoreCase: boolean, ignoreAccents: boolean, locale?: string): Folded {
  let text = '';
  const from: number[] = [];
  const to: number[] = [];
  let index = 0;
  for (const char of source) {
    const end = index + char.length;
    let out = char;
    if (ignoreAccents && !KEEP.has(char)) {
      out = '';
      // A combining mark of decomposed text folds to nothing; findMatches extends a hit over it.
      for (const part of char.normalize('NFD')) if (!COMBINING.test(part)) out += part;
    }
    if (ignoreCase) out = locale ? out.toLocaleLowerCase(locale) : out.toLowerCase();
    for (let i = 0; i < out.length; i++) {
      from.push(index);
      to.push(end);
    }
    text += out;
    index = end;
  }
  return { text, from, to };
}

const isWordAt = (text: string, index: number, before: boolean) => {
  if (before) {
    if (index <= 0) return false;
    const code = text.codePointAt(index - 1)!;
    // The unit before may be the low half of a surrogate pair.
    const char = code >= 0xdc00 && code <= 0xdfff && index >= 2 ? String.fromCodePoint(text.codePointAt(index - 2)!) : String.fromCodePoint(code);
    return WORD.test(char);
  }
  if (index >= text.length) return false;
  return WORD.test(String.fromCodePoint(text.codePointAt(index)!));
};

/**
 * Sorts ranges and merges the ones that overlap or touch into one (the `term` of the earlier range wins, of the longer one on a tie), so marks
 * never nest.
 */
export function mergeRanges(ranges: readonly TextRange[]): TextRange[] {
  const sorted = [...ranges].filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const out: TextRange[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range[0] <= last[1]) {
      if (range[1] > last[1]) out[out.length - 1] = last[2] === undefined ? [last[0], range[1]] : [last[0], range[1], last[2]];
    } else out.push(range);
  }
  return out;
}

/**
 * Hits of `query` (one term or several) in `text` as ranges of the original text, sorted and merged. Empty and
 * blank terms match nothing. One pass to fold the text, then a plain search per term: linear in the text's length.
 */
export function findMatches(text: string, query: string | readonly string[], options: FindMatchesOptions = {}): TextRange[] {
  const { ignoreCase = true, ignoreAccents = true, wholeWord = false, first = false, locale } = options;
  const terms = (typeof query === 'string' ? [query] : query).map((term) => term.trim());
  if (!text || terms.every((term) => !term)) return [];
  const folded = fold(text, ignoreCase, ignoreAccents, locale);
  // A hit ends after the combining marks of its last letter ("e" + U+0301 stays one mark).
  const extend = (end: number) => {
    let at = end;
    while (at < text.length && COMBINING.test(String.fromCodePoint(text.codePointAt(at)!))) at += String.fromCodePoint(text.codePointAt(at)!).length;
    return at;
  };
  const hits: TextRange[] = [];
  terms.forEach((term, termIndex) => {
    if (!term) return;
    const needle = fold(term.normalize('NFC'), ignoreCase, ignoreAccents, locale).text;
    if (!needle) return;
    let at = folded.text.indexOf(needle);
    while (at !== -1) {
      const start = folded.from[at];
      const end = extend(folded.to[at + needle.length - 1]);
      if (!wholeWord || (!isWordAt(text, start, true) && !isWordAt(text, end, false))) {
        hits.push([start, end, termIndex]);
        if (first) break;
        at = folded.text.indexOf(needle, at + needle.length);
      } else at = folded.text.indexOf(needle, at + 1);
    }
  });
  const merged = mergeRanges(hits);
  return first ? merged.slice(0, 1) : merged;
}
