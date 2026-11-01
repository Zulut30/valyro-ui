'use client';

import { colorModeScript, type ColorModeScriptOptions } from './color-mode';

export interface ColorModeScriptProps extends ColorModeScriptOptions {
  /** The nonce of your Content Security Policy (`script-src 'nonce-…'`). */
  nonce?: string;
}

/**
 * Put it in <head>, before the stylesheets: an inline script that paints the saved mode (or the OS mode for
 * `system`) on <html> before the first frame, so a server-rendered or prerendered page never flashes light before
 * turning dark. Use the same `storageKey` / `storage` as ThemeProvider. For an index.html or a framework head that
 * takes a string, use `colorModeScript(options)`.
 *
 * ```tsx
 * <html lang="en" suppressHydrationWarning>
 *   <head><ColorModeScript defaultMode="system" /></head>
 *   <body><ThemeProvider defaultMode="system">…</ThemeProvider></body>
 * </html>
 * ```
 */
export function ColorModeScript({ nonce, ...options }: ColorModeScriptProps) {
  // Browsers hide a nonce from the DOM after parsing, so the hydrating render never matches it.
  return <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: colorModeScript(options) }} />;
}
