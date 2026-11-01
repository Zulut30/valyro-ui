'use client';

import { Fragment, type ComponentPropsWithRef } from 'react';
import { cx } from '../primitives';
import { useSyncExternalStore, withRef } from '../primitives/react-compat';
import {
  DEFAULT_SHORTCUT_KEY_NAMES,
  isApplePlatform,
  shortcutCaps,
  spokenShortcut,
  type ShortcutFormat,
  type ShortcutKeyNames,
  type ShortcutPlatform,
} from '../primitives/shortcuts';
import './Kbd.css';

export interface KbdLabels extends ShortcutKeyNames {
  /** Said between the strokes of a sequence ("G then I") and shown between them. */
  then: string;
}

export const defaultKbdLabels: KbdLabels = { ...DEFAULT_SHORTCUT_KEY_NAMES, then: 'then' };

export interface KbdProps extends ComponentPropsWithRef<'kbd'> {
  /**
   * A whole combination as one string: "mod+k", "shift+enter", "mod+shift+p", or a sequence "g, i". `mod` is ⌘ on
   * Apple platforms and Ctrl elsewhere. Without it, the children are one key: `<Kbd>Esc</Kbd>`.
   */
  shortcut?: string;
  /** Force the platform's key names. Default: detected after hydration (the server and the first render show `other`). */
  platform?: ShortcutPlatform;
  /** `symbols` ⌘⇧K, `text` Ctrl + Shift + K. Default: symbols on Mac, text elsewhere. */
  format?: ShortcutFormat;
  /** Key height and text size. */
  size?: 'sm' | 'md';
  /** Words screen readers say for the keys of `shortcut`, and the "then" of a sequence. */
  labels?: Partial<KbdLabels>;
}

const noopSubscribe = () => () => {};
const detectPlatform = (): ShortcutPlatform => (isApplePlatform() ? 'mac' : 'other');
const serverPlatform = (): ShortcutPlatform => 'other';

/**
 * A keyboard key or a whole shortcut. `shortcut="mod+shift+k"` shows ⌘⇧K on a Mac and Ctrl + Shift + K elsewhere
 * (nested `<kbd>` per key, as HTML specifies for combinations), and screen readers hear "Command Shift K" instead of
 * the symbols. It only shows keys: handle the shortcut itself in your code (CommandPalette's hotkey does).
 */
export const Kbd = withRef(function Kbd({ shortcut, platform: platformProp, format: formatProp, size = 'md', labels, className, children, ...rest }: KbdProps) {
  // The server cannot know the reader's platform: it and the hydrating render show the neutral form, then a Mac
  // reader's keys turn into ⌘ symbols.
  const detected = useSyncExternalStore(noopSubscribe, detectPlatform, serverPlatform);
  if (shortcut === undefined) {
    return (
      <kbd {...rest} className={cx('ui-kbd', className)} data-size={size}>
        {children}
      </kbd>
    );
  }
  const t = { ...defaultKbdLabels, ...labels };
  const platform = platformProp ?? detected;
  const format = formatProp ?? (platform === 'mac' ? 'symbols' : 'text');
  const strokes = shortcutCaps(shortcut, { platform, format });
  const spoken = spokenShortcut(shortcut, { platform, names: t, then: t.then });
  return (
    <kbd {...rest} className={cx('ui-kbd', className)} data-size={size} data-combo="" data-format={format} dir="ltr">
      <span className="ui-sr-only">{spoken}</span>
      {strokes.map((caps, strokeIndex) => (
        <Fragment key={strokeIndex}>
          {strokeIndex > 0 && (
            <span className="ui-kbd__then" aria-hidden="true">
              {t.then}
            </span>
          )}
          {caps.map((cap, capIndex) => (
            <Fragment key={capIndex}>
              {capIndex > 0 && format === 'text' && (
                <span className="ui-kbd__plus" aria-hidden="true">
                  +
                </span>
              )}
              <kbd className="ui-kbd__key" aria-hidden="true">
                {cap}
              </kbd>
            </Fragment>
          ))}
        </Fragment>
      ))}
    </kbd>
  );
});
