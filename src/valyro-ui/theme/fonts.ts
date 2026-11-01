/**
 * Self-hosted font families: `src/lib/fonts/<id>.css` (published as `ui-kit/fonts/<id>.css`) plus
 * `src/lib/fonts/<id>/` with the woff2 files and the licence (OFL.txt; LICENSE.txt for a font that is not open
 * source). Each CSS file declares `'<family>'` (latin, latin-ext and, where the font has it, cyrillic subsets) and a metric-matched local
 * `'<family> Fallback'`, so swapping in the webfont does not shift the layout.
 * A theme lists the files its font stacks need in `ThemeInfo.fonts` (src/lib/theme/themes.ts).
 */
export interface FontInfo {
  /** File name: `fonts/<id>.css`. */
  readonly id: string;
  /** The CSS font-family name. */
  readonly family: string;
  /** Has Russian letters; without them Cyrillic text uses the next family in the stack. */
  readonly cyrillic: boolean;
}

export const fonts = [
  { id: 'geist', family: 'Geist', cyrillic: true },
  { id: 'geist-mono', family: 'Geist Mono', cyrillic: true },
  { id: 'atkinson-hyperlegible-next', family: 'Atkinson Hyperlegible Next', cyrillic: false },
  { id: 'jetbrains-mono', family: 'JetBrains Mono', cyrillic: true },
] as const satisfies readonly FontInfo[];

export type FontId = (typeof fonts)[number]['id'];

export function findFont(id: string): FontInfo | undefined {
  return fonts.find((font) => font.id === id);
}
