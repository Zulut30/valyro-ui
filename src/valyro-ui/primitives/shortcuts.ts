/*
 * Keyboard shortcuts as data: "mod+k", "shift+?", "g, i" (a sequence). `mod` is ⌘ on Apple platforms and
 * Ctrl elsewhere. Parsing, matching and the three ways to show one: key caps (Kbd), the `aria-keyshortcuts`
 * value and the words a screen reader says. Pure functions, no DOM (isApplePlatform reads `navigator` only
 * when it exists).
 */

export interface KeyStroke {
  key: string;
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

const ALIASES: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  del: 'delete',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  spacebar: 'space',
  option: 'alt',
  opt: 'alt',
  cmd: 'meta',
  command: 'meta',
  control: 'ctrl',
};

const normal = (token: string) => {
  const t = token.trim().toLowerCase();
  return ALIASES[t] ?? t;
};

/** "mod+shift+k" → one stroke; "g, i" or "g then i" → a sequence of strokes ("mod+," stays one stroke). */
export function parseShortcut(keys: string): KeyStroke[] {
  return keys
    .split(/\s*,\s+|\s+then\s+/i)
    .filter(Boolean)
    .map((chord) => {
      // "+" alone (or "shift++") is the plus key.
      const parts = chord.replace(/\+\+$/, '+plus').split('+').map(normal);
      const stroke: KeyStroke = { key: '', mod: false, ctrl: false, alt: false, shift: false, meta: false };
      for (const part of parts) {
        if (part === 'mod' || part === 'ctrl' || part === 'alt' || part === 'shift' || part === 'meta') stroke[part] = true;
        else stroke.key = part === 'plus' ? '+' : part;
      }
      return stroke;
    });
}

export interface KeyEventLike {
  key: string;
  /** The physical key ("KeyK", "Digit1"): matches letters and digits on a non-Latin layout. */
  code?: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/** Whether a key event is this stroke on the given platform. Shift is not compared for symbol keys ("?"). */
export function matchesStroke(stroke: KeyStroke, event: KeyEventLike, mac: boolean): boolean {
  let key = event.key === ' ' ? 'space' : event.key.toLowerCase();
  // A Cyrillic, Greek… layout types "л" where the shortcut says "k": take the Latin letter of the
  // physical key. Only for non-ASCII input, so AZERTY's "a" (the Q key) still means "a".
  if (key !== stroke.key && event.code && key.length === 1 && key > '\u007f') {
    const physical = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(event.code);
    if (physical) key = (physical[1] ?? physical[2]).toLowerCase();
  }
  if (key !== stroke.key) return false;
  const wantCtrl = stroke.ctrl || (stroke.mod && !mac);
  const wantMeta = stroke.meta || (stroke.mod && mac);
  const symbol = stroke.key.length === 1 && !/[a-z0-9]/.test(stroke.key);
  return event.ctrlKey === wantCtrl && event.metaKey === wantMeta && event.altKey === stroke.alt && (symbol || event.shiftKey === stroke.shift);
}

/** Whether the reader is on macOS / iOS, where `mod` is ⌘. False on the server. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return /Mac|iPhone|iPad|iPod/i.test(data?.platform || navigator.platform || navigator.userAgent || '');
}

/** `symbols`: ⌘⇧K. `text`: Ctrl+Shift+K. */
export type ShortcutFormat = 'symbols' | 'text';
export type ShortcutPlatform = 'mac' | 'other';

// [Mac symbol, Mac text, other symbol, other text]
const CAPS: Record<string, [string, string, string, string]> = {
  mod: ['⌘', 'Cmd', 'Ctrl', 'Ctrl'],
  meta: ['⌘', 'Cmd', 'Win', 'Win'],
  ctrl: ['⌃', 'Ctrl', 'Ctrl', 'Ctrl'],
  alt: ['⌥', 'Option', 'Alt', 'Alt'],
  shift: ['⇧', 'Shift', '⇧', 'Shift'],
  enter: ['↵', 'Enter', '↵', 'Enter'],
  escape: ['Esc', 'Esc', 'Esc', 'Esc'],
  backspace: ['⌫', 'Backspace', '⌫', 'Backspace'],
  delete: ['⌦', 'Del', 'Del', 'Del'],
  tab: ['⇥', 'Tab', '⇥', 'Tab'],
  space: ['Space', 'Space', 'Space', 'Space'],
  arrowup: ['↑', '↑', '↑', '↑'],
  arrowdown: ['↓', '↓', '↓', '↓'],
  arrowleft: ['←', '←', '←', '←'],
  arrowright: ['→', '→', '→', '→'],
};

const capitalize = (token: string) => (token.length === 1 ? token.toUpperCase() : token[0].toUpperCase() + token.slice(1));

const strokeTokens = (stroke: KeyStroke) => {
  const tokens: string[] = [];
  if (stroke.mod) tokens.push('mod');
  if (stroke.ctrl) tokens.push('ctrl');
  if (stroke.meta) tokens.push('meta');
  if (stroke.alt) tokens.push('alt');
  if (stroke.shift) tokens.push('shift');
  if (stroke.key) tokens.push(stroke.key);
  return tokens;
};

/**
 * Key caps of a stroke for display, modifiers first: ["⌘", "K"] or ["Ctrl", "K"]. `format` defaults to symbols on
 * Apple platforms and text elsewhere.
 */
export function strokeCaps(stroke: KeyStroke, mac: boolean, format: ShortcutFormat = mac ? 'symbols' : 'text'): string[] {
  const column = (mac ? 0 : 2) + (format === 'symbols' ? 0 : 1);
  return strokeTokens(stroke).map((token) => CAPS[token]?.[column] ?? capitalize(token));
}

export interface ShortcutDisplayOptions {
  /** Default: `other` (Ctrl). Pass `isApplePlatform() ? 'mac' : 'other'` after mount. */
  platform?: ShortcutPlatform;
  /** Default: symbols on Mac, text elsewhere. */
  format?: ShortcutFormat;
}

/** Key caps per stroke: "mod+k, g" → [["⌘", "K"], ["G"]]. */
export function shortcutCaps(shortcut: string, { platform = 'other', format }: ShortcutDisplayOptions = {}): string[][] {
  const mac = platform === 'mac';
  return parseShortcut(shortcut).map((stroke) => strokeCaps(stroke, mac, format ?? (mac ? 'symbols' : 'text')));
}

/** The shortcut as one string: "⌘⇧K" (symbols), "Ctrl+Shift+K" (text); strokes of a sequence apart by a space. */
export function formatShortcut(shortcut: string, options: ShortcutDisplayOptions = {}): string {
  const format = options.format ?? (options.platform === 'mac' ? 'symbols' : 'text');
  return shortcutCaps(shortcut, { ...options, format })
    .map((caps) => caps.join(format === 'symbols' ? '' : '+'))
    .join(' ');
}

const ARIA: Record<string, [mac: string, other: string]> = {
  mod: ['Meta', 'Control'],
  meta: ['Meta', 'Meta'],
  ctrl: ['Control', 'Control'],
  alt: ['Alt', 'Alt'],
  shift: ['Shift', 'Shift'],
  enter: ['Enter', 'Enter'],
  escape: ['Escape', 'Escape'],
  backspace: ['Backspace', 'Backspace'],
  delete: ['Delete', 'Delete'],
  tab: ['Tab', 'Tab'],
  space: ['Space', 'Space'],
  arrowup: ['ArrowUp', 'ArrowUp'],
  arrowdown: ['ArrowDown', 'ArrowDown'],
  arrowleft: ['ArrowLeft', 'ArrowLeft'],
  arrowright: ['ArrowRight', 'ArrowRight'],
};

/**
 * The `aria-keyshortcuts` value of a shortcut: "Meta+Shift+K" on Mac, "Control+Shift+K" elsewhere. A sequence has
 * no aria-keyshortcuts form, so only its first stroke is returned.
 */
export function ariaShortcut(shortcut: string, { platform = 'other' }: Pick<ShortcutDisplayOptions, 'platform'> = {}): string {
  const stroke = parseShortcut(shortcut)[0];
  if (!stroke) return '';
  const mac = platform === 'mac';
  return strokeTokens(stroke)
    .map((token) => ARIA[token]?.[mac ? 0 : 1] ?? (token.length === 1 ? token.toUpperCase() : capitalize(token)))
    .join('+');
}

/** Words a screen reader says for keys, by token (`mod`, `shift`, `enter`, a letter…). */
export interface ShortcutKeyNames {
  /** `mod` on Apple platforms. */
  command: string;
  control: string;
  option: string;
  alt: string;
  shift: string;
  windows: string;
  enter: string;
  escape: string;
  backspace: string;
  delete: string;
  tab: string;
  space: string;
  up: string;
  down: string;
  left: string;
  right: string;
  plus: string;
}

export const DEFAULT_SHORTCUT_KEY_NAMES: ShortcutKeyNames = {
  command: 'Command',
  control: 'Control',
  option: 'Option',
  alt: 'Alt',
  shift: 'Shift',
  windows: 'Windows',
  enter: 'Enter',
  escape: 'Escape',
  backspace: 'Backspace',
  delete: 'Delete',
  tab: 'Tab',
  space: 'Space',
  up: 'Up arrow',
  down: 'Down arrow',
  left: 'Left arrow',
  right: 'Right arrow',
  plus: 'Plus',
};

export interface SpokenShortcutOptions extends Pick<ShortcutDisplayOptions, 'platform'> {
  names?: Partial<ShortcutKeyNames>;
  /** Word between the strokes of a sequence. Default "then". */
  then?: string;
}

/** What a screen reader should say: "Command Shift K", "Control Shift K", "G then I". */
export function spokenShortcut(shortcut: string, { platform = 'other', names, then = 'then' }: SpokenShortcutOptions = {}): string {
  const n = { ...DEFAULT_SHORTCUT_KEY_NAMES, ...names };
  const mac = platform === 'mac';
  const word = (token: string): string => {
    switch (token) {
      case 'mod':
        return mac ? n.command : n.control;
      case 'meta':
        return mac ? n.command : n.windows;
      case 'ctrl':
        return n.control;
      case 'alt':
        return mac ? n.option : n.alt;
      case 'arrowup':
        return n.up;
      case 'arrowdown':
        return n.down;
      case 'arrowleft':
        return n.left;
      case 'arrowright':
        return n.right;
      case '+':
        return n.plus;
      default:
        return token in n ? n[token as keyof ShortcutKeyNames] : capitalize(token);
    }
  };
  return parseShortcut(shortcut)
    .map((stroke) => strokeTokens(stroke).map(word).join(' '))
    .join(` ${then} `);
}

/** Keys of a simplified keyboard, for the visual map. */
export const KEYBOARD_ROWS: readonly (readonly string[])[] = [
  ['escape', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'backspace'],
  ['tab', 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', '\\'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'", 'enter'],
  ['shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', '?'],
  ['ctrl', 'alt', 'meta', 'space', 'arrowleft', 'arrowup', 'arrowdown', 'arrowright'],
];

/** Keys of the visual map a stroke presses: `mod` is the ⌘ key on Apple platforms and Ctrl elsewhere. */
export function strokeKeys(stroke: KeyStroke, mac: boolean): string[] {
  const keys: string[] = [];
  if (stroke.mod) keys.push(mac ? 'meta' : 'ctrl');
  if (stroke.ctrl) keys.push('ctrl');
  if (stroke.meta) keys.push('meta');
  if (stroke.alt) keys.push('alt');
  if (stroke.shift) keys.push('shift');
  if (stroke.key) keys.push(stroke.key);
  return keys;
}
