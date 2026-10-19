/** Text helpers for TagsInput. */

/** Separators that split pasted text into several tags. */
export const PASTE_SEPARATORS = /[,;\n\t]+/;

/**
 * Tag candidates after pasting `pasted` over the `[start, end)` selection of `text`:
 * the paste lands at the caret, so text around it joins the first and last pieces.
 */
export function pasteTags(text: string, start: number, end: number, pasted: string): string[] {
  return (text.slice(0, start) + pasted + text.slice(end)).split(PASTE_SEPARATORS);
}
